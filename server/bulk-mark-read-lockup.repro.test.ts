// Repro for the bulk mark-as-read lockup (triage evidence, not a fix).
// Selecting many messages and marking them read posts one /api/messages/batch
// request, but the server then performs one full provider update per message,
// serialized on the shared mail-work queue. For IMAP accounts every update is
// a fresh connect + mailbox lock + logout round trip, so a large selection
// stalls the queue — and every other mail action queued behind it — for as
// long as the batch crawls.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ImapFlow } from "imapflow";
import type { Mail } from "../shared/types.js";

test("bulk mark-as-read serializes one full IMAP connection per message and stalls unrelated work", async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "emc2-bulk-lockup-"));
  process.env.MAIL_DATA_DIR = directory;
  process.env.MAIL_DATA_KEY = Buffer.alloc(32, 7).toString("base64");
  const { put, closeStore } = await import("./store.js");
  const { updateMessages, updateMessage, runMailWork, mailWorkActivity } = await import("./mail-actions.js");
  t.after(() => { closeStore(); rmSync(directory, { recursive: true, force: true }); });

  const account = { id: "a", email: "me@example.test", provider: "imap" as const, credentials: { imapHost: "imap.example.test", password: "synthetic" } };
  put("account", account.id, account);
  const mail = (n: number): Mail => ({
    id: `a:1:${n}`, accountId: "a", remoteId: `1:${n}`,
    sender: "Synthetic", address: "sender@example.test", to: "me@example.test", subject: `Mail ${n}`,
    body: "", preview: "", date: 1, unread: true, archived: false,
    category: "important", relevance: 2, reason: "", snoozedUntil: null });
  const COUNT = 10;
  for (let n = 1; n <= COUNT; n++) put("mail", `a:1:${n}`, mail(n));

  // Fake IMAP: 25 ms per connect(), which a real login + handshake easily exceeds.
  const LATENCY = 25;
  const delay = () => new Promise((resolve) => setTimeout(resolve, LATENCY));
  let connections = 0;
  const flagsAdded: string[] = [];
  t.mock.method(ImapFlow.prototype, "connect", async function (this: ImapFlow) { connections++; await delay(); });
  t.mock.method(ImapFlow.prototype, "logout", async () => {});
  t.mock.method(ImapFlow.prototype, "close", () => {});
  t.mock.method(ImapFlow.prototype, "getMailboxLock", async function (this: ImapFlow, mailbox: string) {
    this.mailbox = { path: mailbox, delimiter: "/", flags: new Set(), uidValidity: 1n, uidNext: 100, exists: 1 };
    return { release() {} };
  });
  t.mock.method(ImapFlow.prototype, "messageFlagsAdd", async (uid: string) => { flagsAdded.push(uid); return true; });

  const items = Array.from({ length: COUNT }, (_, i) => ({ id: `a:1:${i + 1}`, accountId: "a" }));
  const started = Date.now();
  const batch = updateMessages({ items, operation: { action: "read" } });

  // While the batch crawls, the user marks a different message read.
  put("mail", "a:1:other", { ...mail(999), id: "a:1:other", remoteId: "1:999" });
  let unrelatedMs = -1;
  const unrelated = (async () => {
    const at = Date.now();
    await updateMessage("a:1:other", { action: "read" });
    unrelatedMs = Date.now() - at;
  })();
  // And a sync is requested (the IMAP watch fires on our own flag changes):
  // runMailWork queues it on the same chain while `syncing` is already true
  // server-side, which is what disables the row actions in the UI.
  const queuedDuringBatch = updateMessages({ items: [{ id: "a:1:1", accountId: "a" }], operation: { action: "unread" } })
    .then(() => mailWorkActivity().queued);

  const result = await batch;
  const batchMs = Date.now() - started;
  await Promise.all([unrelated, queuedDuringBatch]);

  assert.deepEqual(result.results.map((item) => item.status), Array(COUNT).fill("done"));
  // One provider update — and therefore one fresh IMAP connection — per message.
  assert.equal(connections, COUNT + 2, `expected ${COUNT} batch connections + unrelated + queued-unread, got ${connections}`);
  assert.equal(flagsAdded.length, COUNT + 1);
  // Serialized: 10 x ~25 ms of connection setup alone.
  assert.ok(batchMs >= COUNT * LATENCY, `batch took ${batchMs} ms; serialized round trips dominate`);
  // An unrelated single-message action queued behind in-flight provider work.
  t.diagnostic(`bulk mark-as-read: ${COUNT} messages, ${connections} IMAP connections, ${batchMs} ms serialized; unrelated action waited ${unrelatedMs} ms`);
  console.log(`[repro] ${COUNT}-item mark-as-read opened ${connections} IMAP connections over ${batchMs} ms; an unrelated mark-read waited ${unrelatedMs} ms behind the shared queue`);
});
