import { test } from "node:test";
import assert from "node:assert/strict";
import { mailBrand, providerMarks } from "./ui/provider-marks";

// Every bundled mark is an inline SVG data URL, so the renderer draws
// provider marks without a network request.
test("every provider mark is an SVG data URL", () => {
  const brands = ["outlook", "proton", "zoho", "aol", "gmx", "yandex", "tuta", "mailbox", "hey", "posteo", "fastmail", "yahoo"] as const;
  for (const brand of brands) {
    const mark = providerMarks[brand];
    assert.ok(mark.startsWith("data:image/svg+xml,"), `${brand} is a bundled SVG`);
    assert.ok(decodeURIComponent(mark).includes("<svg"), `${brand} holds SVG markup`);
  }
});

test("provider type alone marks Fastmail and Yahoo", () => {
  assert.equal(mailBrand("fastmail"), "fastmail");
  assert.equal(mailBrand("yahoo"), "yahoo");
});

test("a custom IMAP account is marked by its email domain", () => {
  assert.equal(mailBrand("imap", "person@outlook.com"), "outlook");
  assert.equal(mailBrand("imap", "person@proton.me"), "proton");
  assert.equal(mailBrand("imap", "person@zohomail.com"), "zoho");
  assert.equal(mailBrand("imap", "person@aol.com"), "aol");
  assert.equal(mailBrand("imap", "person@gmx.de"), "gmx");
  assert.equal(mailBrand("imap", "person@yandex.ru"), "yandex");
  assert.equal(mailBrand("imap", "person@tutanota.com"), "tuta");
  assert.equal(mailBrand("imap", "person@mailbox.org"), "mailbox");
  assert.equal(mailBrand("imap", "person@hey.com"), "hey");
  assert.equal(mailBrand("imap", "person@posteo.de"), "posteo");
  assert.equal(mailBrand("imap", "person@fastmail.fm"), "fastmail");
  assert.equal(mailBrand("imap", "person@ymail.com"), "yahoo");
});

test("the email domain match is case-insensitive", () => {
  assert.equal(mailBrand("imap", "Person@OUTLOOK.com"), "outlook");
});

test("unrecognized providers and domains keep the drawn icons", () => {
  assert.equal(mailBrand("gmail"), null);
  assert.equal(mailBrand("gmail-imap"), null);
  assert.equal(mailBrand("icloud"), null);
  assert.equal(mailBrand("imap"), null);
  // A custom domain hosted at a known provider stays generic: the IMAP host
  // is not sent to the renderer, so only the email domain is read.
  assert.equal(mailBrand("imap", "person@company.example"), null);
});
