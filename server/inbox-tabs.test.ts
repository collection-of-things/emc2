import { test } from "node:test";
import assert from "node:assert/strict";
import { correspondents, inboxTab, protectCorrespondent } from "../shared/inbox-tabs.js";

const mail = (patch: Partial<Parameters<typeof inboxTab>[0]>) => ({
  address: "someone@example.com", sender: "Someone", subject: "Hello", preview: "", reason: "", labelIds: [], ...patch,
});

test("codes, security notices, support threads and replies stay in Primary over Gmail's category", () => {
  for (const subject of ["Your verification code is 482913", "Security alert: new sign-in on Windows",
    "Re: Switch my login from GitHub", "Support ticket #4821 updated", "Reset your password",
    "Change your password soon", "Forgot password?", "Password reset required", "password change notice",
    "Your password changed", "Your password changes tonight"])
    assert.equal(inboxTab(mail({ subject, labelIds: ["CATEGORY_UPDATES"] })), "primary", subject);
});

test("an overlapping password-like subject stays linear and still classifies", () => {
  const hostile = "reset".repeat(20_000);
  assert.equal(inboxTab(mail({ subject: hostile })), "primary");
  assert.equal(inboxTab(mail({ subject: `${hostile} password` })), "primary");
});

test("Gmail categories, AI reasons and sender patterns choose the other tabs", () => {
  assert.equal(inboxTab(mail({ labelIds: ["CATEGORY_PROMOTIONS"] })), "promotions");
  assert.equal(inboxTab(mail({ labelIds: ["CATEGORY_FORUMS"] })), "newsletters");
  assert.equal(inboxTab(mail({ reason: "Receipt" })), "transactions");
  assert.equal(inboxTab(mail({ subject: "Your ChatGPT plan receipt" })), "transactions");
  assert.equal(inboxTab(mail({ address: "jobalerts-noreply@linkedin.com", subject: "Video Editor at Khayaal" })), "social");
  assert.equal(inboxTab(mail({ address: "hello@writer.substack.com", subject: "Notes" })), "newsletters");
  assert.equal(inboxTab(mail({ subject: "Weekend sale: 40% off everything" })), "promotions");
  assert.equal(inboxTab(mail({ address: "noreply@service.example", subject: "Deploy finished" })), "updates");
  assert.equal(inboxTab(mail({ subject: "Lunch on Friday?" })), "primary");
});

test("a Teach rule marking the sender important pins it to Primary", () => {
  const promo = mail({ address: "Deals@Shop.example", labelIds: ["CATEGORY_PROMOTIONS"] });
  assert.equal(inboxTab(promo, [{ sender: "deals@shop.example", category: "important" }]), "primary");
  assert.equal(inboxTab(promo, [{ sender: "deals@shop.example", category: "other" }]), "promotions");
});

test("live tabs use account conditions, exclusions and the same rule precedence as sorting", () => {
  const promo = { ...mail({ address: "deals@shop.example", subject: "Sale proposal", labelIds: ["CATEGORY_PROMOTIONS"] }), id: "a:1", accountId: "a" };
  const rules = [
    { id: "global", sender: promo.address, category: "important" as const },
    { id: "scoped", sender: promo.address, category: "other" as const, accountId: "a", condition: { field: "subject" as const, contains: "proposal" } },
  ];
  assert.equal(inboxTab(promo, rules), "promotions");
  assert.equal(inboxTab({ ...promo, accountId: "b" }, rules), "primary");
  assert.equal(inboxTab(promo, [{ ...rules[0], excludedMailIds: [promo.id] }]), "promotions");
});

test("a rule's explicit tab routes matching mail there", () => {
  const ci = mail({ address: "ci@forge.example", subject: "Build failed" });
  assert.equal(inboxTab(ci, [{ sender: "ci@forge.example", category: "other", tab: "updates" }]), "updates");
  assert.equal(inboxTab(ci, [{ sender: "ci@forge.example", category: "important", tab: "primary" }]), "primary");
});

test("people you have written to stay in Primary unless your own rule moves them", () => {
  const known = correspondents([
    { accountId: "a", direction: "sent", to: "Friend <Friend@Example.test>, other@example.test", cc: "copy@example.test" },
    { accountId: "a", to: "never@example.test" },
    { accountId: "b", direction: "sent", to: "elsewhere@example.test" },
  ]);
  const promo = { ...mail({ address: "friend@example.test", labelIds: ["CATEGORY_PROMOTIONS"] }), accountId: "a" };
  assert.equal(inboxTab(promo), "promotions");
  assert.equal(protectCorrespondent(inboxTab(promo), promo, known), "primary");
  assert.equal(protectCorrespondent("newsletters", { ...promo, address: "copy@example.test" }, known), "primary");
  assert.equal(protectCorrespondent("promotions", { ...promo, address: "never@example.test" }, known), "promotions", "received mail is not correspondence");
  assert.equal(protectCorrespondent("promotions", { ...promo, accountId: "b" }, known), "promotions", "correspondence is per account");
  const agentRule = { sender: "friend@example.test", category: "other" as const, tab: "updates" as const, agentId: "agent" };
  assert.equal(protectCorrespondent(inboxTab(promo, [agentRule]), promo, known, [agentRule]), "primary", "assistant rules cannot demote correspondents");
  const ownRule = { sender: "friend@example.test", category: "other" as const, tab: "updates" as const };
  assert.equal(protectCorrespondent(inboxTab(promo, [ownRule]), promo, known, [ownRule]), "updates", "the user's Teach rule wins");
});
