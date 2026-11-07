# ADR 0127: In-app agent with signed-in Claude Code, without an API key or MCP

Date: 2026-11-07
Status: Accepted by explicit user direction for the local candidate.
Superseded in part by [ADR 0128](0128-start-scan-and-anthropic-byok.md) (Claude Code provider removed). Installed
and native (macOS, Windows) acceptance are separate.
Extends [ADR 0045](0045-agent-review-byok.md) and
[ADR 0123](0123-automatic-assistant-replies.md). They are unchanged otherwise.

## Context

An assistant could prepare replies in the app only with a saved provider API
key. Approving its proposals also required MCP to be on, although the app made
them itself. Users wanted to start an agent in the app without a key and
without connecting MCP.

## Decision

- Add the provider `claude-code` ("Claude Code (signed in)"). The service runs
  the `claude` CLI already signed in on the device. It stores no key
  (`apiKey: ""`) and saves a plain model name only (default `sonnet`; names
  that start with `-` are refused, so a model cannot become a CLI option).
- Each run uses `claude -p --output-format json --tools "" --strict-mcp-config
  --setting-sources "" --no-session-persistence --system-prompt ...` in an
  empty temporary folder that is removed afterward. No tools, MCP servers,
  user settings or hooks load, so email content can only shape reply text.
- The child gets an allowlisted environment (PATH, home, locale, temp, proxy,
  `CLAUDE_CONFIG_DIR`, `ANTHROPIC_*`). App secrets such as `MAIL_DATA_KEY` and
  `MAIL_DESKTOP_TOKEN` never pass. PATH gains `~/.local/bin`,
  `~/.claude/local`, `/opt/homebrew/bin` and `/usr/local/bin`.
- Input is the same context as for HTTP providers (subject, sender, recipient,
  plain text up to 24,000 characters, instruction). Output is capped at 256 KiB
  and a 20,000-character body. Timeout is 120 seconds. Missing CLI, sign-in
  failure and invalid output create no proposal.
- Proposals prepared in the app (HTTP provider or Claude Code) carry
  `origin: "app"`. Approval and execution of those skip the MCP-enabled check.
  MCP-created proposals and older proposals without `origin` keep it.
- The automation card shows a Start agent button while automatic replies are
  off. Choosing Claude Code and saving turns automatic replies on once, like a
  first key (ADR 0123).
- Codex and OpenCode are not offered: their CLIs cannot turn the shell tool
  off, so injected mail could read local files into a draft.

## Consequences

Synthetic checks: `server/agent-provider.test.ts` (injected CLI runner),
`src/agent-automation.test.tsx`. A one-off local run with the real CLI and
synthetic mail produced a pending proposal and approved it with MCP off.
Windows `.cmd` shims and packaged macOS PATH discovery are unverified.
Reverting removes the provider; saved `claude-code` records then fail the save
schema and must be removed by the user.
