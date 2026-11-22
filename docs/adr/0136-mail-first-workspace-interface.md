# ADR 0136 — Mail-first workspace interface

Date 2026-11-22

Status Proposed, pending maintainer review.

## Context

The interface needs clearer navigation, readable message hierarchy and distinct
selection states. The neutral palette in ADR 0135 provides the starting point.
Visual references from Slashy, Inbox Zero and Superhuman informed the layout.

## Decision

- Use a 216px sidebar with Compose above Mail, followed by Workspace and account
  filters. Place Drafts immediately beneath Inbox within the folding Mail group.
- Keep a desktop sidebar toggle in the 52px toolbar. Search expands beside the
  current view, and Commands retains its accessible name when its label hides.
- Give category, draft-account and workspace tabs filled active states.
- Distinguish the neutral mail-list cursor, opened split-reader message, bulk
  selection and keyboard focus. Unread messages use stronger sender and subject
  weights. Preserve the virtual list's measured row heights.
- Use a larger reader subject and sender avatar, a visible composer title,
  flush draft rows and consistent workspace and Settings spacing.
- Preserve theme tokens, privacy handling, reduced motion, phone drawers and
  44px phone targets. Mail operations continue through their existing handlers.

This updates the layout treatment described in ADRs 0024, 0111 and 0127.

## Consequences

Mail destinations lead the navigation. Users who fold Mail also fold Drafts.
The visible composer title consumes vertical space above the envelope.
The mobile focus order follows the same Mail-first navigation.

## Verification

Synthetic renderer tests cover sidebar navigation, composer keyboard traversal,
draft recovery, selection styling and virtualized list geometry. Light and dark
inbox captures use the same synthetic mailbox as the parent revision.
Installed builds and real-account flows require separate evidence.
