import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Mail, McpSettings } from "../shared/types.js";
import type { AgentGrant } from "../shared/workspace.js";

test("Handled is local and undoable, and assistants manage the Inbox only within their grant", async t => {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-inbox-management-"));
  process.env.MAIL_DATA_DIR = directory;
  process.env.MAIL_DATA_KEY = Buffer.alloc(32, 13).toString("base64");
  process.env.MAIL_CONFIG_PATH = path.join(directory, "synthetic-settings.env");
  process.env.MAIL_DESKTOP_TOKEN = "synthetic-inbox-session";
  const { put, get, all, closeStore } = await import("./store.js");
  const { providers } = await import("./providers.js");
  for (const provider of [providers.imap, providers.gmail])
    t.mock.method(provider, "update", async () => { assert.fail("Handled and inbox rules must not contact a provider"); });
  const { startServer } = await import("./index.js");
  const server = await startServer(0);
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); closeStore(); rmSync(directory, { recursive: true, force: true }); });
  const address = server.address(); assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { "Content-Type": "application/json", "X-Desktop-Token": "synthetic-inbox-session" };
  const { csrf } = await (await fetch(`${base}/api/state`, { headers })).json() as { csrf: string };
  const authorized = { ...headers, "X-CSRF-Token": csrf };
  put("account", "a", { id: "a", email: "me@example.test", provider: "gmail", credentials: {} });
  put("account", "b", { id: "b", email: "other@example.test", provider: "gmail", credentials: {} });
  const base_mail: Mail = { id: "a:ci", accountId: "a", remoteId: "ci", sender: "Forge CI", address: "ci@forge.example.test",
    to: "me@example.test", subject: "Build failed on main", body: "Synthetic failure", preview: "Synthetic failure", date: 10,
    unread: true, archived: false, category: "important", relevance: 2, reason: "Action required", snoozedUntil: null };
  put("mail", base_mail.id, base_mail);
  put("mail", "a:sent", { ...base_mail, id: "a:sent", remoteId: "sent", direction: "sent", address: "me@example.test", to: "Friend <friend@example.test>" });
  put("mail", "a:friend", { ...base_mail, id: "a:friend", remoteId: "friend", address: "friend@example.test", subject: "Weekend" });
  put("mail", "b:ci", { ...base_mail, id: "b:ci", accountId: "b" });

  await t.test("the user's Handled leaves the provider alone and Undo restores the exact row", async () => {
    const response = await fetch(`${base}/api/messages/a:ci`, { method: "PATCH", headers: authorized, body: JSON.stringify({ action: "handle" }) });
    assert.equal(response.status, 200);
    const { undo } = await response.json() as { undo: { id: string; accountId: string; token: string } };
    assert.equal(get("mail", "a:ci")!.handled?.by, "you");
    const state = await (await fetch(`${base}/api/state`, { headers })).json() as { messages: { id: string; handled?: unknown }[] };
    assert.ok(state.messages.find(m => m.id === "a:ci")?.handled, "summaries carry the handled state");
    assert.equal((await fetch(`${base}/api/messages/a:ci/undo`, { method: "POST", headers: authorized, body: JSON.stringify({ accountId: undo.accountId, token: undo.token }) })).status, 200);
    assert.deepEqual(get("mail", "a:ci"), base_mail);
    assert.equal((await fetch(`${base}/api/messages/a:sent`, { method: "PATCH", headers: authorized, body: JSON.stringify({ action: "handle" }) })).status, 400, "sent mail cannot be handled");
  });

  const configured = await fetch(`${base}/api/mcp`, { method: "PATCH", headers: authorized, body: JSON.stringify({ enabled: true }) });
  assert.equal(configured.status, 200);
  assert.ok((await configured.json() as McpSettings).enabled);
  const grant = async (tools: string[]) => {
    const response = await fetch(`${base}/api/agent/grants`, { method: "POST", headers: authorized, body: JSON.stringify({ name: "Synthetic inbox agent", accountIds: ["a"], tools }) });
    assert.equal(response.status, 201);
    return (await response.json() as AgentGrant).token!;
  };
  const call = async (token: string, name: string, args: object) => {
    const response = await fetch(`${base}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
    assert.equal(response.status, 200);
    const { result } = await response.json() as { result: { content: { text: string }[]; isError?: boolean } };
    return { error: !!result.isError, value: JSON.parse(result.content[0].text) };
  };

  await t.test("mark_handled needs its own grant and stays within granted accounts", async () => {
    const reader = await grant(["list_emails"]);
    assert.equal((await call(reader, "mark_handled", { id: "a:ci", reason: "Fixed" })).value.code, "MCP_PERMISSION_REQUIRED");
    const agent = await grant(["list_emails", "mark_handled"]);
    assert.equal((await call(agent, "mark_handled", { id: "b:ci", reason: "Fixed" })).error, true);
    assert.equal(get("mail", "b:ci")!.handled, undefined);
    const handled = await call(agent, "mark_handled", { id: "a:ci", reason: "CI fix pushed in synthetic PR" });
    assert.equal(handled.error, false);
    assert.deepEqual(Object.keys(handled.value.email).sort(), ["handled", "id"], "the Handled grant alone does not reveal mail content");
    assert.deepEqual({ ...get("mail", "a:ci")!.handled, at: 0 }, { at: 0, by: "agent", agentId: get("agent", all("agent").find(a => a.token === agent)!.id)!.id, agentName: "Synthetic inbox agent", reason: "CI fix pushed in synthetic PR" });
    assert.equal(all("proposal").length, 0, "no review proposal is created");
    const inbox = await call(agent, "list_emails", { view: "inbox" });
    assert.ok(!inbox.value.emails.some((m: { id: string }) => m.id === "a:ci"), "handled mail leaves the MCP Inbox view");
    assert.equal((await call(agent, "unmark_handled", { id: "a:ci" })).error, false);
    assert.equal(get("mail", "a:ci")!.handled, undefined);
  });

  await t.test("assistant inbox rules apply immediately but never demote correspondents or change Teach rules", async () => {
    const agent = await grant(["manage_inbox_rules"]);
    const set = await call(agent, "set_inbox_rule", { accountId: "a", sender: "ci@forge.example.test", tab: "updates", reason: "CI notices the assistant handles" });
    assert.equal(set.error, false, JSON.stringify(set.value));
    const rule = all("rule")[0];
    assert.equal(rule.tab, "updates"); assert.ok(rule.agentId); assert.equal(rule.category, "other");
    assert.equal(get("mail", "a:ci")!.category, "other", "cached mail moves immediately");
    assert.equal((await call(agent, "set_inbox_rule", { accountId: "b", sender: "ci@forge.example.test", tab: "updates", reason: "x" })).value.code, "MCP_PERMISSION_REQUIRED");
    const friend = await call(agent, "set_inbox_rule", { accountId: "a", sender: "friend@example.test", tab: "promotions", reason: "x" });
    assert.equal(friend.value.code, "MCP_RULE_REFUSED");
    assert.equal((await call(agent, "set_inbox_rule", { accountId: "a", sender: "friend@example.test", tab: "primary", reason: "Keep close" })).error, false);
    put("rule", "teach", { id: "teach", accountId: "a", sender: "boss@example.test", instruction: "Mine", category: "important", relevance: 3 });
    assert.equal((await call(agent, "set_inbox_rule", { accountId: "a", sender: "boss@example.test", tab: "updates", reason: "x" })).value.code, "MCP_RULE_REFUSED");
    assert.equal((await call(agent, "remove_inbox_rule", { id: "teach" })).value.code, "MCP_RULE_REFUSED");
    const listed = await call(agent, "list_inbox_rules", { accountId: "a" });
    assert.deepEqual(listed.value.rules.map((r: { sender: string; createdBy: string }) => `${r.sender}:${r.createdBy}`).sort(),
      ["boss@example.test:you", "ci@forge.example.test:assistant", "friend@example.test:assistant"]);
    const { matchingRule } = await import("../shared/rules.js");
    const bossMail = { ...base_mail, address: "boss@example.test", subject: "Weekly report" };
    const overlapping = { id: "overlap", accountId: "a", sender: "boss@example.test", instruction: "x", category: "other" as const, relevance: 1 as const,
      condition: { field: "subject" as const, contains: "report" }, agentId: "synthetic", createdAt: Date.now() + 1000 };
    assert.equal(matchingRule(bossMail, [...all("rule"), overlapping])!.id, "teach", "a Teach rule outranks a more specific assistant rule");
    const { captureBackup, sealBackup } = await import("./workspace-backup.js");
    await sealBackup(captureBackup(), "synthetic backup password");
    assert.equal((await call(agent, "remove_inbox_rule", { id: rule.id })).error, false);
    assert.equal(get("rule", rule.id), undefined);
    assert.equal(get("mail", "a:ci")!.category, "important", "removing the rule re-sorts cached mail");
  });
});
