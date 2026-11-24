import { test } from "node:test";
import assert from "node:assert/strict";
import { bimiService, parseBimiRecord, type BimiDependencies } from "./bimi.js";

// Every lookup and fetch is injected, so no test does real DNS or network.
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
const publicAddress = { address: "93.184.216.34", family: 4 };
const record = (location: string) => `v=BIMI1; l=${location}`;

const service = (overrides: Partial<BimiDependencies> = {}, txt: Record<string, string[][]> = {}) => {
  const calls = { txt: [] as string[], fetch: 0 };
  const query = bimiService({
    resolveTxt: async (name) => {
      calls.txt.push(name);
      if (!(name in txt)) throw new Error("ENODATA");
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
  assert.equal((await query("brand-mail.com"))?.body.toString(), svg.toString());
  assert.equal(calls.fetch, 1);
});

test("chunked TXT records are joined before parsing", async () => {
  const { query } = await Promise.resolve(service({}, {
    "default._bimi.brand-mail.com": [["v=BIMI1; ", "l=https://cdn.brand-mail.com/", "logo.svg"]],
  }));
  assert.equal((await query("brand-mail.com"))?.type, "image/svg+xml");
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

test("a failed fetch returns null", async () => {
  const { query } = await Promise.resolve(service({
    fetch: async () => { throw new Error("connection refused"); },
  }, {
    "default._bimi.brand-mail.com": [[record("https://cdn.brand-mail.com/logo.svg")]],
  }));
  assert.equal(await query("brand-mail.com"), null);
});

test("a record naming an unresolvable or missing host returns null", async () => {
  const { query } = await Promise.resolve(service({
    resolve: async () => { throw new Error("ENOTFOUND"); },
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
