# ADR 0134: Recognized IMAP Sent folders for imports

Date: 2026-11-14
Status: Proposed for the Sent import fix.

## Context

Sent import requires a raw `\Sent` LIST flag. Some servers omit that flag,
while ImapFlow recognizes the Sent folder by its localized name. The existing
Sent-copy path already uses ImapFlow's `specialUse` metadata. Import rejects
the same folder and leaves recent Sent messages unavailable.

## Decision

Prefer the unique raw server-declared Sent folder. When no folder declares
`\Sent`, accept a unique `specialUse: "\\Sent"` candidate returned by ImapFlow.
LIST exposes only its winning candidate. Reuse the lockfile-pinned library's
name classifier on the other entries and reject any additional Sent match.
Do not add application-specific folder-name guesses or create a folder.
Reject ambiguous declarations or candidates, empty paths, Inbox and folders
marked non-selectable or nonexistent. Open the selected mailbox read-only.

Retain retrieval bounds, mailbox identity checks, qualified message IDs and
cached evidence on failure. This changes only explicit Sent import. Destructive
actions still require server-declared destinations under
[ADR 0017](0017-safe-trash-and-visible-mail-actions.md). Provider search and
Sent-copy behavior are unchanged.

## Verification

A synthetic regression reproduces rejection of a recognized folder without
the raw flag. It checks read-only opening, bounded recent-message retrieval,
server-declaration precedence, mailbox-qualified IDs and unsafe or ambiguous
folder rejection. It does not prove retrieval from a real account or behavior
in an installed build.

A dependency-level LIST regression covers `Sent` and `Sent Messages` without
raw flags: ImapFlow labels one winner, but import rejects before opening it.
The same harness checks a single recognized folder and raw-declaration precedence.
