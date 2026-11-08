# ADR 0130: Render styled mail in a shadow tree of the reader

Date: 2026-11-07
Status: Proposed; pending maintainer review.
Supersedes: the separate-document part of [ADR 0102](0102-isolated-sender-styles.md).
Its stylesheet grammar, bounds and opaque identifiers remain.
Keeps: [ADR 0013](0013-safe-formatted-mail-and-personal-privacy.md),
[ADR 0020](0020-explicit-images-with-hidden-text.md) and
[ADR 0125](0125-readable-hidden-sender-text.md).

## Context

ADR 0102 put mail with sender style rules in a blank sandboxed iframe sized to
its content. The iframe is a second document inside the reader's scroller,
which caused two reported faults:

- The frame's document does not inherit the app's hidden-scrollbar rule. A
  hidden image's placeholder kept its full declared width inside table cells,
  where a loaded image shrinks, so newsletters overflowed the frame sideways
  and showed a horizontal scrollbar until Show images was used.
- Wheel input over the mail sometimes stayed with the frame's scrollers instead
  of reaching the reader, so the reader only scrolled with the pointer outside
  the mail.

The iframe kept styles apart in both directions: sender selectors such as `p`
or `table` could not restyle the app, and the app's element rules could not
restyle the mail. A first revision of this decision rendered the mail
directly in the reader document under `@scope`. That confined sender rules,
but the app's own rules then reached into every message: links became
`inline-flex` and stopped wrapping, sender images became blocks, and the
reader's body font, line height, paragraph margins and subject heading size
replaced the mail's own defaults. A shadow tree keeps the one-document
scrolling and restores the isolation in both directions.

## Decision

Render mail with supported sender rules in an open shadow root attached to a
`.formatted-mail-frame` element in the reader document. Other formatted mail
keeps the themed reader in the light DOM. The shadow root adopts two
constructable stylesheets and drops them when the message unmounts. Request
CSP is unchanged: no `<style>` element is inserted.

- A base sheet starts the message root from browser defaults
  (`all: initial`, 14px times the text scale at 1.5, system UI font), as the
  separate document did. Only theme custom properties pass through. It also
  carries the reader pieces the mail renders: hidden scrollbars, focus rings,
  selection color and the privacy bars.
- The sender sheet wraps sender rules and the reader controls in
  `@scope ([data-mail-scope="<id>"]) to (.address)`.

- Anchor every sender selector at `:scope`, which stands in for the sender's
  html and body. Anchoring confines the rules and gives them enough
  specificity to override the reader's own element defaults, as they did in
  the separate document. Selectors with a non-leading html/body, or a sibling
  of it, are dropped.
- Address controls are the scope's lower boundary, so no sender rule can
  restyle or reveal a hidden address.
- Reader controls for links, quotes, code ink, prose measure and readable ink
  follow the sender rules in the same scope.
- Rewrite screen-width `@media` queries as `@container` queries. The shadow
  host is the container, so they measure the width of the message, not the
  window.
- Window key handlers read the original target from `composedPath()`, so
  Enter on a link or privacy control inside the mail is not treated as a
  list shortcut. Page selectors that must see styled mail, such as the
  reader's full-width `:has()` rule, match the frame.
- Keep readable-ink re-evaluation (ADR 0125) on render, resize and ancestor
  theme changes. Ink layers stop at the message root, and the host surface
  below it is composited separately.
- Size a blocked-image placeholder as `min(width, 100%)` with the declared
  aspect ratio, so it narrows exactly as its image would.
- Zoom mail wider than the reader down to fit, with a 0.5 floor, as desktop
  mail clients do. Content still too wide at the floor scrolls sideways inside
  the message, without a visible bar.

Engines without shadow roots or constructable stylesheets keep the themed
fallback text, as before. So do engines that parse the sender sheet to no
rules, which is how an engine without `@scope` drops it.

## Consequences

The reader is the only vertical scroller around a message, so wheel input and
the hidden-scrollbar rule behave the same over mail as elsewhere. Keyboard
forwarding, height measurement and theme copying for the frame are removed.
The shadow boundary keeps sender CSS out of the page and page CSS out of the
mail, so a new app element rule cannot change how mail renders. The selector
grammar and anchoring still bound what sender rules can do inside the
message. Reader styles that must apply inside the mail, such as the privacy
bars, are copied into the base sheet and must be kept in step with
`src/styles/base.css`.

## Proof

Synthetic tests check selector anchoring, container conversion, shadow-tree
sheet install and removal, address-boundary syntax, code ink, privacy, consent,
readable ink, placeholder shape and the fit calculation. An offscreen
Electron 44 harness rendered the bundled component inside the built app
stylesheet. Mail text used 14px/1.5 system UI, and links stayed inline and
wrapped. Icon images stayed on one line, and paragraph and list margins
matched the old document. The container query switched at the message width
without affecting the page. A 700px block zoomed to 0.674 in a 472px message
and stopped at 0.5 in 332px. No element inside the mail scrolled vertically,
no horizontal bar showed, and a wheel event over the mail scrolled the
reader. Privacy bars rendered veiled inside the shadow tree, with no sender
background reaching them.
Physical wheel input, installed builds and real accounts are separate proof.
