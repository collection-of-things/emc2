# ADR 0128: Start scan, Anthropic BYOK and removal of the Claude Code provider

Date: 2026-11-07
Status: Accepted by explicit user direction. Installed and real-account
acceptance are separate.
Supersedes the Claude Code provider in [ADR 0127](0127-in-app-agent-without-key-or-mcp.md).
Keeps ADR 0127's `origin: "app"` approval rule and Start agent button.

## Context

ADR 0127 ran the signed-in Claude Code CLI to draft replies. Using a consumer
Claude subscription from another app this way risks breaking its terms of use,
so the user asked to remove it and to use the Claude API with their own key.
Users with a saved key (for example OpenAI) also had no way to run the
assistant on demand: it ran only on new mail after a sync, and drafts prepared
before 0.2.33 still required MCP to approve.

## Decision

- Remove the `claude-code` provider. At startup, saved `claude-code` provider
  records are deleted (they hold no key) and those assistants' automatic
  replies are turned off with a visible last result.
- Add the `anthropic` provider (`https://api.anthropic.com`, default model
  `claude-opus-5-5`). It calls the Messages API with the official
  `@anthropic-ai/sdk`, through the same validated, DNS-pinned dispatcher as
  other providers, with no retries, no redirects and a 120-second deadline.
  It sends the same context and system prompt as other providers, no tools.
  It enables the server-side refusal fallback (`fallbacks: "default"`) on
  models that accept it. Only `end_turn` text becomes a proposal.
- Add Start scan (`POST /api/agent/grants/:id/automation/scan`). It queues one
  run of the assistant over its cached unread, unarchived received mail,
  newest first, even while automatic replies are off. It reuses the automation
  path: scope, instruction, daily limit, skip rules, permission rechecks and
  pending-proposal outcome. Without automation settings it saves defaults with
  the switch off.
- Drafts without `origin`, created before #241 merged (2026-11-07T16:48:45Z),
  from an assistant with a saved provider key count as app-prepared, so they
  approve with MCP off. MCP drafts stay untagged, so later untagged drafts
  still need MCP on. A scan during an update drain returns 503.

## Consequences

Synthetic checks in `server/agent-provider.test.ts` and
`src/agent-automation.test.tsx`. Real-provider calls are not part of the
synthetic suite. An MCP draft from an assistant that also has a saved key and
was created before that cutoff is treated as app-prepared; the user still reviews
and approves each one.
