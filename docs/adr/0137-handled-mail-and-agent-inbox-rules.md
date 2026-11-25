# ADR 0137 — Handled mail and assistant-managed Inbox rules

Date 2026-11-23

Status Proposed, pending maintainer review.

## Context

Users want the Inbox to hold only mail that still needs them. Marketing and
newsletters already leave Primary (ADR 0024), but mail can stop needing the
user without being finished in the provider, for example a CI failure an
assistant fixed minutes later. Users also want an assistant to decide what
reaches them, without risking that personal correspondence is filtered away.

## Decision

- Add a local Handled state on cached mail (`handled: { at, by, agentId?,
  agentName?, reason? }`). Handled mail leaves the Inbox and every category tab
  and appears in a Handled view, shown in the sidebar only when it has mail.
  The provider mailbox is unchanged, like Snooze and pins. Undo uses the signed
  local receipts from the pin/snooze Undo. Sync and workspace backup preserve
  the state. A new reply is a new message and arrives in the Inbox.
- Done keeps archiving in the provider; Handled is an additional local action.
- Senders an account has written to, according to cached Sent mail, stay in
  Primary regardless of Gmail category, AI reason or sender pattern. Only the
  user's own Teach rule can move them.
- Rules gain an optional explicit `tab` and an `agentId` when an assistant
  created them.
- Two new grantable assistant permissions, both off by default:
  `mark_handled` (`mark_handled`, `unmark_handled`) and `manage_inbox_rules`
  (`list_inbox_rules`, `set_inbox_rule`, `remove_inbox_rule`). They apply
  immediately without an Agent review proposal because they change only local,
  reversible state. They are account-scoped, refuse to demote correspondents
  and cannot change or remove the user's Teach rules.

## Consequences

- An assistant can quietly hide mail; the reason, the assistant's name and the
  Handled view keep that visible and reversible. Users who want review can
  leave both permissions off.
- Correspondent detection uses cached Sent mail only, so people written to
  before the cache window may still be sorted by type until a new exchange.
- Handled state is per message and per device and is not sent to the provider.
