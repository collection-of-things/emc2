import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImapFlow } from "imapflow";
import { google } from "./google-api.js";
import type { Mail } from "../shared/types.js";

test("bulk read changes use one provider round trip per account and do not report a queued sync", async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-bulk-read-"));
  process.env.MAIL_DATA_DIR = directory;
  process.env.MAIL_DATA_KEY = Buffer.alloc(32, 7).toString("base64");
  const { put, get, remove, all, closeStore } = await import("./store.js");
  const { updateMessages, updateMessage, runMailWork } = await import("./mail-actions.js");
  t.after(() => { closeStore(); rmSync(directory, { recursive: true, force: true }); });

  const imapAccount = { id: "a", email: "me@example.test", provider: "imap" as const, credentials: { imapHost: "imap.example.test", password: "synthetic" } };
  const gmailAccount = { id: "g", email: "me@gmail.example.test", provider: "gmail" as const, credentials: { refreshToken: "synthetic" } };
  put("account", imapAccount.id, imapAccount);
  put("account", gmailAccount.id, gmailAccount);
  const mail = (accountId: string, remoteId: string, extra: Partial<Mail> = {}): Mail => ({
    id: `${accountId}:${remoteId}`, accountId, remoteId, sender: "Synthetic", address: "sender@example.test",
    to: "me@example.test", subject: remoteId, body: "", preview: "", date: 1, unread: true, archived: false,
    category: "important", relevance: 2, reason: "", snoozedUntil: null, labelIds: ["INBOX", "UNREAD"], ...extra });
  const COUNT = 50;
  const imapMail = Array.from({ length: COUNT }, (_, i) => mail("a", `1:${i + 1}`));
  const gmailMail = Array.from({ length: 5 }, (_, i) => mail("g", `gm${i}`));
  for (const item of [...imapMail, ...gmailMail]) put("mail", item.id, item);
  put("mail", "a:1:999", mail("a", "1:999"));
  put("mail", "a:2:7", mail("a", "2:7"));

  // Fake IMAP: every connect costs 25 ms, like a real login round trip.
  let connections = 0;
  const stores: { action: "add" | "remove"; uids: string }[] = [];
  t.mock.method(ImapFlow.prototype, "connect", async () => { connections++; await new Promise((resolve) => setTimeout(resolve, 25)); });
  t.mock.method(ImapFlow.prototype, "logout", async () => {});
  t.mock.method(ImapFlow.prototype, "close", () => {});
  t.mock.method(ImapFlow.prototype, "getMailboxLock", async function (this: ImapFlow, mailbox: string) {
    this.mailbox = { path: mailbox, delimiter: "/", flags: new Set(), uidValidity: 1n, uidNext: 2000, exists: COUNT };
    return { release() {} };
  });
  t.mock.method(ImapFlow.prototype, "messageFlagsAdd", async (uids: string) => { stores.push({ action: "add", uids }); return true; });
  t.mock.method(ImapFlow.prototype, "messageFlagsRemove", async (uids: string) => { stores.push({ action: "remove", uids }); return true; });
  const gmailCalls: { method: string; ids?: string[]; add?: string[]; remove?: string[] }[] = [];
  t.mock.method(google, "gmail", () => ({ users: { messages: {
    batchModify: async ({ requestBody }: { requestBody: { ids: string[]; addLabelIds?: string[]; removeLabelIds?: string[] } }) => {
      gmailCalls.push({ method: "batchModify", ids: requestBody.ids, add: requestBody.addLabelIds, remove: requestBody.removeLabelIds });
      return { data: {} };
    },
    modify: async () => { gmailCalls.push({ method: "modify" }); return { data: {} }; },
  } } }));

  const items = [...imapMail, ...gmailMail].map(({ id, accountId }) => ({ id, accountId }));
  const started = Date.now();
  const batch = updateMessages({ items: [...items, { id: "a:2:7", accountId: "a" }, { id: "missing", accountId: "a" }], operation: { action: "read" } });
  // A single-message action queued during the batch waits for one round trip, not one per message.
  const unrelated = updateMessage("a:1:999", { action: "read" });
  const result = await batch;
  const batchMs = Date.now() - started;
  await unrelated;

  const statuses = result.results.map((item) => item.status);
  assert.deepEqual(statuses.slice(0, COUNT + 5), Array(COUNT + 5).fill("done"));
  assert.equal(statuses[COUNT + 5], "unknown", "a changed UID validity falls back to the single-message path");
  assert.equal(statuses[COUNT + 6], "failed");
  assert.deepEqual(stores[0], { action: "add", uids: imapMail.map((m) => m.remoteId.split(":")[1]).join(",") });
  assert.equal(connections, 3, "one batch connection, one single-message fallback, one unrelated action");
  assert.ok(batchMs < COUNT * 25, `batch took ${batchMs} ms`);
  assert.deepEqual(gmailCalls, [{ method: "batchModify", ids: gmailMail.map((m) => m.remoteId), add: undefined, remove: ["UNREAD"] }]);
  for (const item of [...imapMail, ...gmailMail]) {
    assert.equal(get("mail", item.id)?.unread, false);
    assert.deepEqual(get("mail", item.id)?.labelIds, ["INBOX"]);
  }
  assert.equal(get("mail", "a:1:999")?.unread, false);
  assert.equal(get("mail", "a:2:7")?.unread, true);

  // Already-read mail needs no provider call; marking unread batches the reverse change.
  stores.length = 0; connections = 0; gmailCalls.length = 0;
  assert.deepEqual((await updateMessages({ items: items.slice(0, 3), operation: { action: "read" } })).results.map((item) => item.status), ["done", "done", "done"]);
  assert.equal(connections, 0);
  const unread = await updateMessages({ items, operation: { action: "unread" } });
  assert.ok(unread.results.every((item) => item.status === "done"));
  assert.deepEqual(stores.map((store) => store.action), ["remove"]);
  assert.equal(connections, 1);
  assert.deepEqual(gmailCalls.map((call) => [call.method, call.add]), [["batchModify", ["UNREAD"]]]);
  assert.equal(get("mail", imapMail[0].id)?.unread, true);

  // A lost provider response is uncertain for every message in that round trip and is never retried.
  t.mock.method(ImapFlow.prototype, "messageFlagsAdd", async () => { throw new Error("Synthetic lost response"); });
  const uncertain = await updateMessages({ items: items.slice(0, 2), operation: { action: "read" } });
  assert.deepEqual(uncertain.results.map((item) => item.status), ["unknown", "unknown"]);
  assert.equal(get("mail", imapMail[0].id)?.unread, true);

  // A sync waiting behind mail work does not report "syncing", so mail actions stay available.
  process.env.MAIL_CONFIG_PATH = path.join(directory, "synthetic-settings.env");
  process.env.MAIL_DESKTOP_TOKEN = "synthetic-bulk-read-session";
  for (const account of all("account")) remove("account", account.id);
  const { startServer } = await import("./index.js");
  const server = await startServer(0);
  try {
    const address = server.address(); assert.ok(address && typeof address === "object");
    const origin = `http://127.0.0.1:${address.port}`;
    const headers = { "Content-Type": "application/json", "X-Desktop-Token": "synthetic-bulk-read-session" };
    const state = async () => await (await fetch(`${origin}/api/state`, { headers })).json() as { csrf: string; syncing: boolean };
    const { csrf } = await state();
    let release = () => {};
    let running = () => {};
    const holding = new Promise<void>((resolve) => { running = resolve; });
    const gate = runMailWork(() => new Promise<void>((resolve) => { release = resolve; running(); }));
    await holding;
    const sync = fetch(`${origin}/api/sync`, { method: "POST", headers: { ...headers, "X-CSRF-Token": csrf } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal((await state()).syncing, false);
    release(); await gate;
    assert.equal((await sync).status, 200);
    assert.equal((await state()).syncing, false);
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});
