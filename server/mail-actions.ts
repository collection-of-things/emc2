import { AttachmentPreflightError } from "./attachment-bytes.js";
import { z } from "zod";
import type { LocalMailUndo } from "../shared/local-mail-undo.js";
import { updateLocalMail, restoreLocalMail } from "./local-mail-undo.js";
import { MAX_MAIL_BATCH, type MailBatchResponse } from "../shared/bulk-mail.js";
import { all, get, account, put, remove, holdAttachments, releaseAttachmentHold, cleanupUploads } from "./store.js";
import { providers, sendSchema, SentCopyError, updateGmailLabels, type SendInput } from "./providers.js";
import type { Mail, MailHandled } from "../shared/types.js";
import { recordRecentRecipients } from "./contacts.js";

let mailWork = Promise.resolve();
let quiesced = false;
const activeWork = new Set<Promise<unknown>>();
let queuedWork = 0;
let admittedWork = 0;
let lastCompletedAt = Date.now();
export function mailWorkActivity(): Readonly<{ queued: number; active: number; lastCompletedAt: number }> {
  return { queued: queuedWork, active: admittedWork - queuedWork, lastCompletedAt };
}
export function assertMailAvailable() {
  if (quiesced) throw new Error("Mail is paused for an application update. Try again shortly.");
}
export function mailIsQuiesced() { return quiesced; }
export function trackMailWork<T>(task: () => Promise<T>): Promise<T> {
  try { assertMailAvailable(); } catch (error) { return Promise.reject(error); }
  admittedWork++;
  let result: Promise<T>;
  try { result = Promise.resolve(task()); } catch (error) { result = Promise.reject(error); }
  activeWork.add(result);
  const completed = () => { activeWork.delete(result); admittedWork--; lastCompletedAt = Date.now(); };
  void result.then(completed, completed);
  return result;
}
export async function quiesceMailWork(timeout: number) {
  quiesced = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.allSettled([...activeWork, mailWork]),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Mail work did not finish before the update deadline.")), timeout);
      }),
    ]);
  } finally { clearTimeout(timer); }
}
export function resumeMailWork() { quiesced = false; }
// Sync and provider mutations must finish in order so stale metadata cannot undo a read.
export function runMailWork<T>(task: () => Promise<T>): Promise<T> {
  return trackMailWork(() => {
    queuedWork++;
    const result = mailWork.then(() => { queuedWork--; return task(); });
    mailWork = result.then(() => {}, () => {});
    return result;
  });
}

export const messageActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["pin", "unpin"]) }).strict(),
  z.object({ action: z.literal("handle"), reason: z.string().trim().min(1).max(500).optional() }).strict(),
  z.object({ action: z.literal("unhandle") }).strict(),
  z.object({
    action: z.enum(["read", "unread", "inbox", "archive", "snooze", "unsnooze", "trash"]),
    until: z
      .number()
      .int()
      .refine(
        (until) => until >= Date.now() && until <= Date.now() + 366 * 86400000,
        "Choose a snooze time within the next year.",
      )
      .optional(),
  }),
  z.object({
    action: z.literal("labels"),
    labelIds: z.array(z.string().min(1).max(200)).max(100),
  }),
]);

export function findMail(id: string) {
  const mail = get("mail", id);
  if (!mail) throw new Error("Message not found.");
  return mail;
}

export async function updateMessage(
  id: string,
  input: z.infer<typeof messageActionSchema>,
  beforeExecution?: () => void,
  providerStarted?: () => void,
  captureUndo?: (receipt: LocalMailUndo) => void,
  handledBy?: Omit<MailHandled, "at" | "reason">,
) {
  // Pinning is one local transaction, so it need not wait behind a long sync.
  // Sync writers re-read each record before writing, which keeps the pin.
  if (input.action === "pin" || input.action === "unpin")
    return trackMailWork(async () => {
      beforeExecution?.();
      findMail(id);
      return updateLocalMail(id, input.action, undefined, captureUndo);
    });
  // Handled is local, like a pin: it hides mail from the Inbox without a provider change.
  if (input.action === "handle" || input.action === "unhandle")
    return trackMailWork(async () => {
      beforeExecution?.();
      const mail = findMail(id);
      if (input.action === "handle" && mail.direction === "sent") throw new Error("Sent mail cannot be marked handled.");
      // The Handled view lists only Inbox mail, so handled archived mail would vanish from every view.
      if (input.action === "handle" && mail.archived) throw new Error("Archived mail cannot be marked handled. Move it to Inbox first.");
      return updateLocalMail(id, input.action, undefined, captureUndo,
        input.action === "handle" ? { ...(handledBy ?? { by: "you" }), ...(input.reason ? { reason: input.reason } : {}) } : undefined);
    });
  return runMailWork(async () => {
    beforeExecution?.();
    const m = findMail(id);
    if (input.action === "snooze" || input.action === "unsnooze")
      return updateLocalMail(id, input.action, "until" in input ? input.until : undefined, captureUndo);
    if (input.action === "read" && !m.unread || input.action === "unread" && m.unread || input.action === "inbox" && !m.archived) return m;
    if (input.action === "trash") {
      const a = account(m.accountId);
      providerStarted?.();
      await providers[a.provider].update(a, m, "trash");
      remove("mail", m.id);
      return m;
    }
    if (input.action === "labels") {
      const a = account(m.accountId);
      if (a.provider !== "gmail") throw new Error("Labels are only supported for Gmail accounts.");
      const customIds = all("label")
        .filter((label) => label.accountId === a.id && label.type === "user")
        .map((label) => label.id);
      if (input.labelIds.some((labelId) => !customIds.includes(labelId)))
        throw new Error("Choose custom labels from this Gmail account. Sync if a label is missing.");
      const labelIds = await updateGmailLabels(a, m, [...new Set(input.labelIds)], customIds);
      const updated = { ...findMail(id), labelIds, unread: labelIds.includes("UNREAD"), archived: !labelIds.includes("INBOX") };
      put("mail", m.id, updated);
      return updated;
    }
    let identity: void | { remoteId?: string; mailbox?: Mail["mailbox"] } = undefined;
    if (input.action === "read" || input.action === "unread" || input.action === "inbox" || input.action === "archive") {
      const a = account(m.accountId);
      providerStarted?.();
      identity = await providers[a.provider].update(a, m, input.action);
    }
    return saveProviderChange(id, input.action as "read" | "unread" | "inbox" | "archive", identity);
  });
}

function saveProviderChange(id: string, action: "read" | "unread" | "inbox" | "archive", identity?: void | { remoteId?: string; mailbox?: Mail["mailbox"] }) {
  const latest = findMail(id);
  const removedLabel = action === "read" ? "UNREAD" : action === "archive" ? "INBOX" : null;
  const updated = {
    ...latest,
    // Restoring to Inbox ends the recorded archive-folder binding.
    ...(action === "inbox" ? { mailbox: undefined } : {}),
    ...(identity || {}),
    labelIds: removedLabel ? latest.labelIds?.filter((labelId) => labelId !== removedLabel) : action === "unread" || action === "inbox" ? [...new Set([...(latest.labelIds || []), action === "unread" ? "UNREAD" : "INBOX"])] : latest.labelIds,
    unread: action === "read" ? false : action === "unread" ? true : latest.unread,
    archived: action === "inbox" ? false : action === "archive" || latest.archived,
    snoozedUntil: latest.snoozedUntil,
  };
  put("mail", id, updated);
  return updated;
}

export async function sendMail(value: unknown, beforeExecution?: () => void) {
  return trackMailWork(async () => {
    const input = sendSchema.parse(value);
    const a = account(input.accountId);
    beforeExecution?.();
    let hold: string | undefined;
    try { hold = holdAttachments(a.id, input.attachments); }
    catch { throw new AttachmentPreflightError("Attachment identity changed. Choose the file again before sending."); }
    const cleanup = () => {
      try { releaseAttachmentHold(hold); cleanupUploads(); return undefined; }
      catch { return "Email was sent, but attachment cleanup failed. Do not resend."; }
    };
    try {
      await providers[a.provider].send(a, input);
    } catch (error) {
      if (error instanceof SentCopyError) {
        rememberRecipients(input);
        const warning = cleanup();
        return { ok: true, warning: [error.message, warning].filter(Boolean).join(" ") };
      }
      if (error instanceof AttachmentPreflightError) { try { releaseAttachmentHold(hold); } catch {} }
      throw error;
    }
    rememberRecipients(input);
    const warning = cleanup();
    return { ok: true, ...(warning ? { warning } : {}) };
  });
}

// Delivery already succeeded, so a failed contact write must not turn it into a send error.
function rememberRecipients(input: SendInput) {
  try { recordRecentRecipients(input.accountId, [...input.to, ...(input.cc ?? []), ...(input.bcc ?? [])]); } catch { /* suggestions are optional */ }
}

export const mailBatchSchema = z.object({
  items: z.array(z.object({ id: z.string().min(1).max(500), accountId: z.string().min(1).max(500) }).strict())
    .min(1).max(MAX_MAIL_BATCH).refine(items => new Set(items.map(item => item.id)).size === items.length, "Choose each message once."),
  operation: messageActionSchema.refine(input => ["read", "unread", "archive", "inbox", "snooze", "pin", "unpin", "trash"].includes(input.action), "Unsupported batch action."),
}).strict();

type BatchItem = z.infer<typeof mailBatchSchema>["items"][number];
type BatchStatus = MailBatchResponse["results"][number]["status"];

export function updateMessages(value: unknown, beforeExecution?: () => void): Promise<MailBatchResponse> {
  const input = mailBatchSchema.parse(value);
  return trackMailWork(async () => {
    const statuses = new Map<string, BatchStatus>();
    const action = input.operation.action;
    const check = (item: BatchItem) => {
      beforeExecution?.();
      const mail = findMail(item.id);
      if (mail.accountId !== item.accountId) throw new Error("Message account changed.");
      if (mail.archived && action === "snooze")
        throw new Error("Archived mail cannot be snoozed. Move it to Inbox first.");
      if (mail.direction === "sent" && !["pin", "unpin", "trash"].includes(action))
        throw new Error("This action is unavailable for Sent mail.");
      return mail;
    };
    const single = action === "read" || action === "unread" ? await updateFlags(input.items, action, check, statuses) : input.items;
    for (const item of single) {
      let providerAttempted = false;
      try {
        await updateMessage(item.id, input.operation, () => { check(item); }, () => { providerAttempted = true; });
        statuses.set(item.id, "done");
      } catch {
        // Provider errors can follow a committed remote mutation. Never guess or retry.
        statuses.set(item.id, providerAttempted ? "unknown" : "failed");
      }
    }
    return { results: input.items.map((item) => ({ ...item, status: statuses.get(item.id) ?? "failed" })) };
  });
}

// Read state changes one provider round trip per account, so a large selection
// holds the mail queue briefly instead of once per message. Returns the items
// the provider could not batch.
async function updateFlags(items: BatchItem[], action: "read" | "unread", check: (item: BatchItem) => Mail, statuses: Map<string, BatchStatus>) {
  const accounts = new Map<string, BatchItem[]>();
  for (const item of items) accounts.set(item.accountId, [...(accounts.get(item.accountId) ?? []), item]);
  const single: BatchItem[] = [];
  for (const [accountId, group] of accounts) {
    await runMailWork(async () => {
      const pending: Mail[] = [];
      for (const item of group) {
        try {
          const mail = check(item);
          if (action === "read" ? mail.unread : !mail.unread) pending.push(mail);
          else statuses.set(item.id, "done");
        } catch { statuses.set(item.id, "failed"); }
      }
      if (!pending.length) return;
      let a: ReturnType<typeof account>;
      try { a = account(accountId); }
      catch { for (const mail of pending) statuses.set(mail.id, "failed"); return; }
      let untouched: Set<string>;
      try {
        untouched = new Set(await providers[a.provider].updateFlags(a, pending, action));
      } catch (error) {
        const skipped = new Set((error as { untouched?: string[] }).untouched ?? []);
        for (const mail of pending) {
          if (skipped.has(mail.id)) single.push(group.find((item) => item.id === mail.id)!);
          else statuses.set(mail.id, "unknown");
        }
        return;
      }
      for (const mail of pending) {
        if (untouched.has(mail.id)) { single.push(group.find((item) => item.id === mail.id)!); continue; }
        try { saveProviderChange(mail.id, action); statuses.set(mail.id, "done"); }
        catch { statuses.set(mail.id, "unknown"); }
      }
    });
  }
  return single;
}

export function undoMessage(id: string, accountId: string, token: string, beforeExecution?: () => void) {
  return runMailWork(async () => { beforeExecution?.(); return restoreLocalMail(id, accountId, token); });
}
