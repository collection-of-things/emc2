# ADR 0129: One Start agent button, also on Agent review

Date: 2026-11-07
Status: Accepted by explicit user direction.
Amends the buttons in [ADR 0128](0128-start-scan-and-anthropic-byok.md). The scan endpoint is unchanged.

## Decision

Start agent and Start scan were separate buttons, which confused users. One
Start agent button now turns on automatic replies for new mail and then queues
a scan of unread inbox mail. A running assistant card shows Scan now instead.
The Agent review toolbar has Start agent too: it runs `startAgent` for every
assistant with `read_email`, `propose_draft` and a saved provider key, and
reports how many started and how many emails were queued, or that no
assistant has a key.

## Consequences

Synthetic checks in `src/agent-automation.test.tsx` and `src/workbench.test.tsx`.
