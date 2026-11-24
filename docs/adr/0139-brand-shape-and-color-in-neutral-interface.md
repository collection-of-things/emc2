# ADR 0139 — Brand shape and color in the neutral interface

Date 2026-11-22

Status Proposed, pending maintainer review.

## Context

After the neutral redesign in ADRs 0135 and 0136, co-maintainer feedback
reported that provider marks became grayscale and the interface lost
character. Provider marks had been flattened to a single `currentColor` fill,
so even the multicolor Gmail vector rendered as one muted tone, and the
uniform control radius carried no brand shape.

## Decision

- Restore brand colors on provider marks. Gmail keeps its multicolor vector,
  the iCloud cloud is blue, and Fastmail and Yahoo are letter tiles on their
  brand fill with white ink. Custom IMAP stays neutral. No stylesheet rule may
  re-fill provider SVG paths without a provider class.
- Apply the brand's asymmetric mark radius (`--radius-mark-sm`,
  `3px 10px 3px 10px`) to signature controls: the New message button, sidebar
  navigation buttons and their sliding wash and hover, the sidebar account
  card and its avatar, the Settings button, and the category, draft-account
  and work-view tabs.
- Avatars are no longer circles. A new `--radius-avatar` token
  (`18% 46% 18% 46%`) gives sender initials, sender logos and the skeleton
  placeholder the mark's corner shape at any size. The unread dot and provider
  badge keep their lower-right placement.
- Sorting statuses read as quiet chips on a hover tint; the attention reason
  stays the only accent chip.
- Each Inbox category keeps one fixed hue on its tab icon in every theme;
  Primary takes the accent. Tab buttons carry `data-tab` for the hue rules.
- Graphite gains four distinct avatar hues in dark and light so senders are
  told apart by color on the neutral palette; the Mass tone pairs stay.
- The sidebar lists Workspace above Mail again, then Accounts. This reverses
  the Mail-first group order in ADR 0136; Drafts stays beneath Inbox. The
  order changes only at a maintainer's request.

The accent picker and the Graphite default are unchanged, and no layout or
structure moves. This amends the monochrome provider-mark treatment and the
avatar shape adopted with the neutral redesign.

## Consequences

Provider brand colors are fixed values outside the theme tokens, so a custom
theme cannot restyle them. Avatars are no longer circles, which changes the
mark's silhouette wherever senders appear. The category icon hues are fixed
per category and do not follow the accent. Mobile and keyboard focus order
follows the Workspace-first group order again.

## Verification

Focused renderer tests including
`src/message-style.test.tsx` (provider-mark and tab-hue rules),
`src/navigation.test.tsx` (`data-tab` on tab buttons, the Workspace → Mail →
Accounts group-order assertion and the restored focus order),
`src/draft-recovery.test.tsx`, `src/region-focus.test.tsx`,
`src/appearance.test.tsx`, `src/list-windowing.test.tsx` and
`src/privacy-sweep.test.tsx` under the repository's `tsx --test` runner.

The PR records current automated results on the combined sidebar/glass and
branding revision. Visual screenshots, native material behavior and installed
build acceptance remain unverified for that revision.
