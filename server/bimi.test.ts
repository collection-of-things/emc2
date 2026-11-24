import { test } from "node:test";
import assert from "node:assert/strict";
import { BimiRefused, bimiService, parseBimiRecord, type BimiDependencies } from "./bimi.js";

// Every lookup and fetch is injected, so no test does real DNS or network.
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
const publicAddress = { address: "93.184.216.34", family: 4 };
const record = (location: string) => `v=BIMI1; l=${location}`;
// node:dns rejects with an error whose code names the outcome.
const dnsError = (code: string) => Object.assign(new Error(code), { code });

const service = (overrides: Partial<BimiDependencies> = {}, txt: Record<string, string[][]> = {}) => {
  const calls = { txt: [] as string[], fetch: 0 };
  const query = bimiService({
    resolveTxt: async (name) => {
      calls.txt.push(name);
      if (!(name in txt)) throw dnsError("ENODATA");
      return txt[name];
    },
    resolve: async () => [publicAddress],
    fetch: async () => { calls.fetch++; return svg; },
    ...overrides,
  });
  return { query, calls };
};

test("a BIMI record names its logo URL", () => {
  assert.equal(parseBimiRecord("v=BIMI1; l=https://brand-mail.com/logo.svg")?.href, "https://brand-mail.com/logo.svg");
  assert.equal(parseBimiRecord("v=BIMI1 ; a=; l=https://brand-mail.com/logo.svg")?.href, "https://brand-mail.com/logo.svg");
  assert.equal(parseBimiRecord("V=bimi1;L=https://brand-mail.com/logo.svg")?.href, "https://brand-mail.com/logo.svg");
});

test("a declination or foreign record returns no logo", () => {
  assert.equal(parseBimiRecord("v=BIMI1; l="), null);
  assert.equal(parseBimiRecord("v=BIMI1"), null);
  assert.equal(parseBimiRecord("v=spf1 include:example.com ~all"), null);
  assert.equal(parseBimiRecord("l=https://brand-mail.com/logo.svg; v=BIMI1"), null);
  assert.equal(parseBimiRecord("v=BIMI1; l=http://brand-mail.com/logo.svg"), null);
  assert.equal(parseBimiRecord("v=BIMI1; l=https://127.0.0.1/logo.svg"), null);
});

test("a valid record downloads the logo it names", async () => {
  const { query, calls } = await Promise.resolve(service({}, {
    "default._bimi.brand-mail.com": [[record("https://cdn.brand-mail.com/logo.svg")]],
  }));
  const logo = await query("brand-mail.com");
  assert.ok(logo && logo !== "failed");
  assert.equal(logo.body.toString(), svg.toString());
  assert.equal(calls.fetch, 1);
});

test("chunked TXT records are joined before parsing", async () => {
  const { query } = await Promise.resolve(service({}, {
    "default._bimi.brand-mail.com": [["v=BIMI1; ", "l=https://cdn.brand-mail.com/", "logo.svg"]],
  }));
  const logo = await query("brand-mail.com");
  assert.ok(logo && logo !== "failed");
  assert.equal(logo.type, "image/svg+xml");
});

test("a subdomain falls back to its registrable domain's record", async () => {
  const { query, calls } = await Promise.resolve(service({}, {
    "default._bimi.brand-mail.com": [[record("https://cdn.brand-mail.com/logo.svg")]],
  }));
  assert.ok(await query("mail.brand-mail.com"));
  assert.deepEqual(calls.txt, ["default._bimi.mail.brand-mail.com", "default._bimi.brand-mail.com"]);
});

test("a private or loopback logo host is refused without a fetch", async () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "192.168.0.1", "169.254.0.1"]) {
    const { query, calls } = await Promise.resolve(service({
      resolve: async () => [{ address, family: 4 }],
    }, {
      "default._bimi.brand-mail.com": [[record("https://cdn.brand-mail.com/logo.svg")]],
    }));
    assert.equal(await query("brand-mail.com"), null, `${address} refused`);
    assert.equal(calls.fetch, 0, `${address} never fetched`);
  }
});

test("a network failure while fetching is reported as failed, not as no logo", async () => {
  const { query } = await Promise.resolve(service({
    fetch: async () => { throw new Error("connection refused"); },
  }, {
    "default._bimi.brand-mail.com": [[record("https://cdn.brand-mail.com/logo.svg")]],
  }));
  assert.equal(await query("brand-mail.com"), "failed");
});

test("a logo the host serves but we refuse returns null", async () => {
  const { query } = await Promise.resolve(service({
    fetch: async () => { throw new BimiRefused("BIMI logo refused"); },
  }, {
    "default._bimi.brand-mail.com": [[record("https://cdn.brand-mail.com/logo.svg")]],
  }));
  assert.equal(await query("brand-mail.com"), null);
});

test("a TXT lookup that times out or fails is reported as failed", async () => {
  for (const code of ["ETIMEOUT", "ESERVFAIL"]) {
    const { query } = await Promise.resolve(service({
      resolveTxt: async () => { throw dnsError(code); },
    }));
    assert.equal(await query("brand-mail.com"), "failed", code);
  }
  const { query, calls } = await Promise.resolve(service());
  assert.equal(await query("mail.brand-mail.com"), null, "no record at either name");
  assert.equal(calls.txt.length, 2);
});

test("a record naming an unresolvable or missing host returns null", async () => {
  const { query } = await Promise.resolve(service({
    resolve: async () => { throw dnsError("ENOTFOUND"); },
  }, {
    "default._bimi.brand-mail.com": [[record("https://cdn.brand-mail.com/logo.svg")]],
  }));
  assert.equal(await query("brand-mail.com"), null);
  const empty = await Promise.resolve(service({
    resolve: async () => [],
  }, {
    "default._bimi.brand-mail.com": [[record("https://cdn.brand-mail.com/logo.svg")]],
  }));
  assert.equal(await empty.query("brand-mail.com"), null);
});
