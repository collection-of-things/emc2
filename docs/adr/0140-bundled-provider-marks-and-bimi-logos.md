# ADR 0140 — Bundled provider marks and BIMI sender logos

Date 2026-11-23

Status Proposed, pending maintainer review.

## Context

ADR 0139 restored brand colors on provider marks, but Fastmail and Yahoo were
still letter tiles and every other mail host showed the generic envelope, so
accounts on common providers were not recognizable at a glance. Sender logos
had a gap too: a domain the theSVG registry does not know fell straight to the
favicon service even when the domain publishes its own BIMI logo record.

## Decision

- Bundle provider marks instead of fetching them in the renderer.
  `src/ui/provider-marks.ts` embeds twelve SVGs downloaded from theSVG
  (licence CC0-1.0, except microsoft-outlook which is MIT) as data URLs, so
  account marks need no network.
- Detect the brand from the account's email domain only. Fastmail and Yahoo
  accounts use their marks by provider type, and a custom IMAP account picks
  up a mark when its address ends in a recognized domain (Outlook, Proton,
  Zoho, AOL, GMX, Yandex, Tuta, mailbox.org, HEY, Posteo, Fastmail or Yahoo).
- The IMAP host is not sent to the renderer, so a custom domain hosted at one
  of these providers keeps the generic envelope. Branding is never inferred
  from the IMAP host.
- Sender logos resolve in the order theSVG registry, then the domain's own
  BIMI record, then the favicon service. A BIMI logo is written to the same
  on-disk cache and served through the inert `/api/logo` route like a
  registry icon.
- BIMI is unverified: the VMC certificate (`a=` tag) is not validated, so a
  BIMI mark is trusted no more than the favicon fallback it sits beside.
- The BIMI fetch carries the same SSRF protections as remote images: HTTPS
  only, redirects refused, DNS pinned to an address that passes the public
  range check (loopback, private and reserved ranges rejected before any
  request), status exactly 200, `image/svg+xml` content type, no content
  encoding, a 128 KB body cap and an SVG sniff on the first bytes.

Privacy: the logo host of a sender's domain is contacted once per domain,
and the renderer requests no logos at all while privacy is on.

Not done: contact photos and Gravatar remain out of scope.

## Consequences

- The renderer ships a few more kilobytes of inline SVG; no network latency
  or availability concern exists for account marks.
- A BIMI logo can reflect whatever the sender's domain publishes at lookup
  time, like a favicon can. It is no more trustworthy than that fallback.
- Logo misses are only remembered when both the registry and BIMI answer
  with nothing, so a temporary BIMI failure does not suppress retries.

## Verification

- `npx tsx --test --test-concurrency=1 --test-timeout=120000
  server/bimi.test.ts server/logos.test.ts server/avatars.test.ts
  src/provider-marks.test.tsx src/message-style.test.tsx
  src/navigation.test.tsx src/draft-recovery.test.tsx
  src/onboarding.test.tsx src/mail-account-status.test.tsx`
- `npx tsc --noEmit` (one pre-existing error in
  `server/attachment-envelope.test.ts`, unrelated).
- Every theSVG slug was downloaded and checked to be SVG markup before it
  was embedded.
