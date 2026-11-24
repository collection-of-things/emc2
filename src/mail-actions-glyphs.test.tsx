import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import type { Mail } from "../shared/types";
import { MailActions } from "./mail/MailActions";

// DESIGN.md gives each reader action a distinct glyph.
test("reader toolbar actions each draw a distinct glyph", () => {
  const mail: Mail = { id: "mail", accountId: "a", remoteId: "one", sender: "Team", address: "team@example.test", to: "me@example.test", subject: "Plan", preview: "", body: "", date: 1, unread: true, archived: false, snoozedUntil: null, relevance: 2, category: "important", reason: "", html: null, images: [], attachments: [] };
  const none = () => {};
  const html = renderToStaticMarkup(<MailActions mail={mail} opened reading={false} busy={false} syncing={false} snoozed={false}
    shortcut={() => "x"} onRead={none} onUnread={none} onReply={none} onArchive={none} onTrash={none} onSnooze={none} onUnsnooze={none}
    onClose={none} onPin={none} onHandle={none} onTrack={none} onSchedule={none} />);
  const { document } = new JSDOM(html).window;
  const glyphs = [...document.querySelectorAll(".tool-group button.tool")].map(button => [button.getAttribute("aria-label"), button.querySelector("svg")?.innerHTML]);
  assert.ok(glyphs.some(([label]) => label === "Mark handled"));
  const seen = new Map<string, string>();
  for (const [label, glyph] of glyphs) {
    assert.ok(glyph, `${label} draws a glyph`);
    assert.equal(seen.get(glyph), undefined, `${label} and ${seen.get(glyph)} share a glyph`);
    seen.set(glyph, label!);
  }
});
