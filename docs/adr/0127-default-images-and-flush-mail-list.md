# ADR 0127: Load mail images by default and run list rows edge to edge

Date: 2026-11-16
Status: Owner-requested behavior; verification and review are recorded in its PR.
Supersedes: The per-opening image consent in [ADR 0009](0009-opt-in-message-images.md)
and [ADR 0020](0020-explicit-images-with-hidden-text.md). Their URL validation,
no-referrer policy, private-source suppression and caption redaction stay in force.

## Context

The owner asked for images to render by default, with a Show images control
beside the Privacy button to hide them. The reader's consent strip ("Remote
images can tell the sender you opened this email") sat above every message,
and a blocked image's placeholder dropped the sender's `display`, float and
margins, so text wrapped beside empty boxes and tracking pixels drew specks.

The owner also reported that the mail list looked unprofessional: selected
cards were inset with gaps at both pane edges, an empty checkbox column sat
left of every avatar, and sender names started 18px right of their subjects
because each card reserved a slot for the importance marker.

## Decision

Images load by default. A toolbar button beside Privacy toggles them for every
reader, conversation card and reply context, and the choice is saved in local
storage (`remote-images`). There is no in-message consent strip. A failed load
shows a quiet status with Try images again.

While personal information is hidden, images start hidden: image URLs can
carry the reader's own domain and pixels cannot be redacted, and privacy mode
exists for screen sharing. The same toolbar button shows them for that privacy
session; the choice is not saved, and turning privacy on again hides them.
Privacy mode still blocks image URLs that contain detected private information
and still masks alt text and captions.

Formatted mail renders its own images, so it never asks the provider for image
metadata it does not already have. Only plain-text and image-only views fetch
missing metadata, and only while images are on.

Hidden-image placeholders keep the sender's display, float, vertical alignment
and margins. Images 2px or smaller on a side keep their size and draw nothing.

List rows run edge to edge with square corners: hover and selection fills meet
both pane edges, and only text keeps a 16px inset. With a mouse, the selection
checkbox appears over the avatar on hover, keyboard focus or selection; touch
keeps a visible checkbox column. Unread dots badge the avatar in every layout.
The importance marker follows the sender name in flow. Hairlines separate rows
from the text start to the pane edge. Date groups, sidebar headings, counts and
timestamps use sentence-case or tabular numerals in the interface face instead
of uppercase mono. Single hairlines replace the etched double dividers, the
dark sidebar takes the darkest background, and sidebar icons stay muted until
selected.

## Consequences

Opening mail can tell remote senders that it was opened, and remote hosts can
see the request. The toolbar tooltip states this. Image pixels can contain
personal information that privacy mode does not redact. Users who want the
old behavior turn images off once; the choice persists.

Synthetic mounted tests cover the default load, the toolbar toggle, saved
preference, privacy suppression, late-response races and placeholder layout.
Native rendering, real remote-image delivery and the visual result in installed
builds are not verified by these tests.
