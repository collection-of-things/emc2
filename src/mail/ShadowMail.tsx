import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { mailSheets } from "./scoped-mail";

// Sender-styled mail renders in a shadow tree of the reader document (ADR 0130).
// The reader stays its only vertical scroller, and the shadow boundary keeps
// the page's styles out of the mail and the sender's styles out of the page.
// The frame is the container that sender width queries measure.
export function ShadowMail({ css, scope, fallback, children }: { css: string; scope: string; fallback: ReactNode; children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const [shadow, setShadow] = useState<ShadowRoot>();
  const [failed, setFailed] = useState(false);
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const sheets = mailSheets(element.ownerDocument.defaultView as (Window & typeof globalThis) | null, css, scope);
    let root: ShadowRoot | undefined;
    try { if (sheets) root = element.shadowRoot ?? element.attachShadow({ mode: "open" }); } catch { root = undefined; }
    if (!sheets || !root) { setFailed(true); return; }
    root.adoptedStyleSheets = sheets;
    setShadow(root);
    return () => { root.adoptedStyleSheets = []; };
  }, [css, scope]);
  if (failed) return <>{fallback}</>;
  return <div ref={host} className="formatted-mail-frame">{shadow && createPortal(children, shadow)}</div>;
}
