import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Mail, MailHandled } from "../shared/types.js";
import type { LocalMailUndo } from "../shared/local-mail-undo.js";
import { get, put, transaction, mailRecordVersion } from "./store.js";

const signingKey = randomBytes(32);
type LocalAction = "pin" | "unpin" | "snooze" | "unsnooze" | "handle" | "unhandle";
type Receipt = { id: string; accountId: string; remoteId: string; messageId?: string;
  version: string; field: "pinned" | "snoozedUntil" | "handled"; pinned?: boolean; snoozedUntil: number | null; handled?: MailHandled };
const signature = (payload: string) => createHmac("sha256", signingKey).update(payload).digest();
export class LocalMailUndoConflict extends Error {
  constructor() { super("Undo unavailable: the email changed or this action is no longer current."); }
}
const changed = () => new LocalMailUndoConflict();

export function updateLocalMail(id: string, action: LocalAction, until?: number, capture?: (receipt: LocalMailUndo) => void, handled?: Omit<MailHandled, "at">): Mail {
  return transaction(() => {
    const mail = get("mail", id);
    if (!mail) throw new Error("Message not found.");
    if (action === "snooze" && (!until || until < Date.now() || until > Date.now() + 366 * 86400000))
      throw new Error("Choose a snooze time within the next year.");
    const updated = { ...mail };
    const field = action === "pin" || action === "unpin" ? "pinned" : action === "handle" || action === "unhandle" ? "handled" : "snoozedUntil";
    if (action === "pin") updated.pinned = true;
    else if (action === "unpin") delete updated.pinned;
    else if (action === "handle") updated.handled = { ...(handled ?? { by: "you" }), at: Date.now() };
    else if (action === "unhandle") delete updated.handled;
    else updated.snoozedUntil = action === "snooze" ? until! : null;
    if (updated[field] === mail[field]) return mail;
    put("mail", id, updated);
    if (capture) {
      const receipt: Receipt = { id, accountId: mail.accountId, remoteId: mail.remoteId, messageId: mail.messageId,
        field, pinned: mail.pinned, snoozedUntil: mail.snoozedUntil, handled: mail.handled, version: mailRecordVersion(id)! };
      const payload = Buffer.from(JSON.stringify(receipt)).toString("base64url");
      capture({ id, accountId: mail.accountId, token: `${payload}.${signature(payload).toString("base64url")}` });
    }
    return updated;
  });
}

export function restoreLocalMail(id: string, accountId: string, token: string): Mail {
  let receipt: Receipt;
  try {
    const parts = token.split(".");
    if (parts.length !== 2) throw changed();
    const expected = signature(parts[0]);
    const supplied = Buffer.from(parts[1], "base64url");
    if (supplied.toString("base64url") !== parts[1] || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw changed();
    receipt = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as Receipt;
  } catch { throw changed(); }
  return transaction(() => {
    const mail = get("mail", id);
    if (!mail || receipt.id !== id || receipt.accountId !== accountId || mail.accountId !== accountId ||
      mail.remoteId !== receipt.remoteId || mail.messageId !== receipt.messageId || mailRecordVersion(id) !== receipt.version)
      throw changed();
    const updated = { ...mail };
    if (receipt.field === "pinned") {
      if (receipt.pinned === undefined) delete updated.pinned;
      else updated.pinned = receipt.pinned;
    } else if (receipt.field === "handled") {
      if (receipt.handled === undefined) delete updated.handled;
      else updated.handled = receipt.handled;
    } else updated.snoozedUntil = receipt.snoozedUntil;
    put("mail", id, updated);
    return updated;
  });
}
