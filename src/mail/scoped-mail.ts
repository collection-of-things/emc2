import { useEffect, useLayoutEffect } from "react";
import { applyReadableInk, composite, parseColor, type Rgba } from "./readable-ink";

// Reader rules that sender CSS cannot override. They follow the sender rules in
// the same scope at equal or higher specificity, and code ink uses !important
// so a sender color cannot split it from its veil.
const controls = `
:scope{overflow-wrap:break-word}
:scope :is(img,table){max-width:100%}:scope img{height:auto}
:scope a{color:var(--link);text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:2px;text-decoration-color:color-mix(in srgb,var(--link) 60%,transparent)}:scope a:hover{text-decoration-color:currentColor}
:scope blockquote{margin:.75em 0;padding:0 0 0 14px;border-left:2px solid var(--accent);color:var(--text-2)}
:scope code{font-family:var(--font-mono);font-size:.92em;background:var(--veil)!important;color:var(--code-ink)!important;border-radius:3px;padding:0 4px}
:scope pre{font-family:var(--font-mono);font-size:calc(12px * var(--text-scale, 1));background:var(--veil)!important;border-radius:var(--radius-mark-sm);padding:10px 12px;color:var(--code-ink)!important;overflow-x:auto}
:scope pre code{background:none!important;padding:0;color:inherit!important}
:scope :is(code,pre) :not(img,.address,.formatted-mail-image-placeholder){color:inherit!important;background:transparent!important}
:scope :is(code,pre) a{text-decoration-color:color-mix(in srgb,currentColor 60%,transparent)}
:scope .formatted-mail-image-placeholder{display:inline-block;max-width:100%;vertical-align:middle;border-radius:4px;background:rgb(128 128 128 / 0.14);box-shadow:inset 0 0 0 1px rgb(128 128 128 / 0.26)}
:scope :is(p,ul,ol,blockquote,h1,h2,h3,h4,h5,h6,pre){max-width:70ch}:scope table :is(p,ul,ol,blockquote,h1,h2,h3,h4,h5,h6,pre){max-width:none}
:scope[data-ink=dark],:scope [data-ink=dark]{color:#1f1f1f!important}:scope[data-ink=light],:scope [data-ink=light]{color:#f5f5f5!important}
`;

// Sender rules reach only this message. Address controls are the scope's lower
// boundary, so no sender selector can restyle or reveal a hidden address.
export function scopedSheet(css: string, scope: string): string {
  return `@scope ([data-mail-scope="${scope}"]) to (.address) {\n${css}\n${controls}}`;
}

// Styles the shadow tree outside the sender scope. The page's styles stop at
// the shadow boundary, so the mail starts from browser defaults like a mail
// document and copies only the reader pieces it renders: hidden scrollbars,
// focus rings, selection and the privacy bars. Inherited host styles stop at
// the message root; only theme custom properties pass through.
const base = `
:where([data-mail-scope]){all:initial;display:block;font:calc(14px * var(--text-scale, 1))/1.5 system-ui,sans-serif;color:var(--text-body)}
*{scrollbar-width:none}::-webkit-scrollbar{display:none;width:0;height:0}
::selection{background:color-mix(in srgb,var(--accent) 35%,transparent)}
:focus-visible{outline:1px solid var(--accent);outline-offset:2px;border-radius:4px}
.address{cursor:pointer;user-select:none;border-radius:5px;transition:background-color 160ms var(--ease-out),box-shadow 160ms var(--ease-out)}
.address:not(.veiled):hover{box-shadow:inset 0 -1px 0 var(--line-2)}
.address.veiled{display:inline-block;max-width:100%;height:.9em;overflow:hidden;white-space:nowrap;vertical-align:-.05em;border-radius:3px;color:transparent;background:var(--veil);box-shadow:inset 0 0 0 1px var(--line-2)}
.address.veiled:hover{background:var(--veil-hover)}
.address.veiled.locked{cursor:default;background:var(--veil)}
`;

// Builds the shadow tree's sheets, or null when the engine cannot keep the
// scoped rules: no constructable sheets, or an engine without @scope, which
// drops the whole block without throwing. Request CSP allows no inline <style>.
export function mailSheets(view: (Window & typeof globalThis) | null, css: string, scope: string): CSSStyleSheet[] | null {
  const Sheet = view?.CSSStyleSheet;
  if (!Sheet || typeof Sheet.prototype.replaceSync !== "function") return null;
  try {
    const shared = new Sheet(), sender = new Sheet();
    shared.replaceSync(base);
    sender.replaceSync(scopedSheet(css, scope));
    return sender.cssRules.length ? [shared, sender] : null;
  } catch { return null; }
}

const WHITE: Rgba = [255, 255, 255, 1];
// Composite host backgrounds through the nearest opaque ancestor, falling back
// to the white canvas when every ancestor is translucent.
export function readerSurface(element: Element | null): Rgba {
  let surface: Rgba = [0, 0, 0, 0];
  for (let current = element; current; current = current.parentElement) {
    const color = parseColor(current.ownerDocument.defaultView!.getComputedStyle(current).backgroundColor);
    if (color) surface = composite(surface, color);
    if (surface[3] >= 1) return surface;
  }
  return composite(surface, WHITE);
}

// Sender colors keep their meaning, but text below 3:1 against its composited
// background is re-inked. Container queries, theme and preference changes can
// change either side, so marks are re-evaluated on resize, ancestor theme
// attributes and every render. The surface starts at the shadow host.
export function useReadableInk(root: HTMLElement | null, enabled: boolean) {
  useEffect(() => {
    if (!enabled || !root) return;
    const view = root.ownerDocument.defaultView as Window & typeof globalThis;
    const tree = root.getRootNode();
    const host = tree instanceof view.ShadowRoot ? tree.host : root.parentElement;
    const ink = () => applyReadableInk(root, readerSurface(host));
    ink();
    const resize = typeof view.ResizeObserver === "function" ? new view.ResizeObserver(ink) : undefined;
    resize?.observe(root);
    const theme = new view.MutationObserver(ink);
    for (let ancestor = host; ancestor; ancestor = ancestor.parentElement)
      theme.observe(ancestor, { attributes: true, attributeFilter: ["style", "class", "data-theme"] });
    return () => { resize?.disconnect(); theme.disconnect(); };
  });
}

export const MIN_FIT = 0.5;
// Fixed-width mail wider than the reader scales down to fit, as desktop mail
// clients do, instead of scrolling sideways. Below MIN_FIT it stays legible and
// scrolls instead. Zoom resets before measuring so the natural width is read.
export function fitWidth(root: HTMLElement) {
  root.style.zoom = "";
  const available = root.clientWidth, needed = root.scrollWidth;
  if (available > 0 && needed > available + 1) root.style.zoom = String(Math.max(MIN_FIT, available / needed));
}

export function useFitWidth(root: HTMLElement | null, inputs: readonly unknown[]) {
  useLayoutEffect(() => {
    if (!root) return;
    const view = root.ownerDocument.defaultView as Window & typeof globalThis;
    const fit = () => fitWidth(root);
    fit();
    // Reader width and late content (images) both resize the root. The
    // callback settles on the same zoom, so the observer does not loop.
    const resize = typeof view.ResizeObserver === "function" ? new view.ResizeObserver(fit) : undefined;
    resize?.observe(root);
    root.addEventListener("load", fit, true);
    return () => { resize?.disconnect(); root.removeEventListener("load", fit, true); root.style.zoom = ""; };
  }, [root, ...inputs]);
}
