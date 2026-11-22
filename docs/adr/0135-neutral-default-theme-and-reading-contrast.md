# ADR 0135: Neutral default theme and reading contrast

Date: 2026-11-22
Status: Proposed; pending maintainer review.
Amends: [ADR 0125](0125-readable-hidden-sender-text.md), which set the
readable-ink bar at the WCAG large-text minimum of 3:1. The mail body is small
text, so the bar moves to 4.5:1. Related theming records are unchanged:
[ADR 0022](0022-window-materials-and-themes.md) and
[ADR 0035](0035-frosted-working-panes.md).

## Context

New profiles opened on the brand Mass palette: a near-black plum window, an
Energy accent and a bundled display face. Two problems showed up in use. Body
text was the weakest surface: the reader drew the mail body at 13px while
sender-styled mail and the reader's own body rule disagreed between 13px and
15px, and compact list rows at 24px clipped ascenders at larger text scales.
Sender text hidden in a matching color was re-inked only below 3:1, the WCAG
minimum for *large* text; mail body text is small text, so WCAG 2.2 1.4.3
asks for 4.5:1.

The brand also did reading work it did not need to do. The near-black plum
canvas, mauve text ramp and pink accent made every pane read as Mass. Apple
HIG prefers a slightly darker white and near-neutral surfaces inside a dark
interface, and Material guidance avoids pure black for the same reason:
saturated dark canvases vibrate under small text. Outlook reads mail on a
light paper surface inside its dark shell for the same reason.

## Decision

- New profiles default to the dark Graphite theme with the Blue accent
  (#7aa2ff in dark, #1d4ed8 in light). Stored preferences are untouched: an
  existing choice still wins on startup. Mass and Lumen remain installed
  themes, the app icon and lockup keep the brand artwork, and Energy remains
  the pinned primary fill for its accent.
- Graphite becomes a full near-black palette, not a text-ramp patch: #0c0c0e
  canvas, #161618 surfaces, a neutral gray text ramp and an 8% white selected
  wash in dark; the light Graphite palette gets the matching neutral set with
  a faint accent tint on selection.
- Compact wide rows grow from 24px to 28px; comfortable and narrow card rows
  are unchanged.
- The mail body is 15px at 1.5 line height everywhere: plain text, themed
  mail, the shadow tree's base font and the narrow breakpoint. This settles
  the 13px versus 15px split in DESIGN.md.
- Interface type uses the platform's system UI face. The bundled display
  face is no longer loaded for app text; Geist Mono stays for mono labels
  and Instrument Serif for its accent use.
- The readable-ink threshold rises from 3:1 to 4.5:1, the WCAG small-text
  minimum. Sender colors at 4.5:1 or better still keep their color; control
  outlines keep their separate 3:1 requirement.
- The opened email toolbar gains a per-message Light background toggle in the
  dark scheme. It draws the body on a light paper surface for that message
  only, and readable ink re-evaluates against the paper color. The choice
  resets when another message opens and is not persisted.
- The compose editor body draws on the same light paper surface in dark
  mode, keeping its accent focus bar and privacy veil. Header rows and the
  footer stay on the app theme.
- First-paint colors that stand in for the default theme (the BrowserWindow
  background, the Windows caption overlay and the page theme-color) move to
  the Graphite canvas; Mass artwork and the Mass theme's own tokens keep
  their brand values.

## Consequences

Deleting the active custom theme now returns to Graphite rather than Mass.
Sender colors between 3:1 and 4.5:1 — many muted newsletter footers — lose
their exact color to the fixed ink. The paper surface introduces one
light-colored element inside the dark window; its tokens are scoped to the
element so panes, glass transparency and privacy controls are unchanged. The
15px body makes long mails slightly taller to scroll. DESIGN.md's
frontmatter now describes the Graphite palette; the Mass block remains in
tokens.css for the optional theme.

## Proof

Unit tests cover the new defaults, the custom-theme fallback to Graphite,
the 28px compact height in the windowing geometry, the 4.5:1 threshold
boundary on both sides, and the paper toggle's class, pressed state, reset
and absence in light mode. Strict TypeScript and the full serial suite gate
the change. Installed first-paint timing and real monitor rendering are not
measured here.
