import { resolveTxt, lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { publicUnsubscribeAddress, unsubscribeUrl } from "../shared/unsubscribe.js";
import type { LogoImage } from "./logos.js";
import { registrableDomain } from "./registrable.js";

// BIMI is the DNS record a domain publishes to name its own logo. The
// certificate (`a=`) is not validated, so the mark ranks below the curated
// theSVG library and is trusted no more than the favicon fallback. The fetch
// contacts the sender-chosen logo host once per domain, and the bytes are
// served through the existing inert /api/logo route.

const requestTimeout = 8000;
const maxBytes = 128 * 1024;
const bodyPattern = /^\s*(?:<\?xml|<svg|<!doctype svg)/i;

// The host answered but its logo is not one we accept (status, type, size or
// content). Unlike a network failure, asking again soon gives the same answer.
export class BimiRefused extends Error {}
// DNS answers that mean the name has no record, rather than a failed lookup.
const noRecord = (error: unknown) => ["ENODATA", "ENOTFOUND"].includes(String((error as { code?: unknown } | null)?.code));

// A BIMI TXT record starts with v=BIMI1 and names the logo in l=. An empty
// or missing l= is a declination, not a logo, and answers null.
export function parseBimiRecord(txt: string): URL | null {
  const parts = txt.split(";");
  const [name, ...value] = (parts.shift() || "").split("=");
  if (name.trim().toLowerCase() !== "v" || value.join("=").trim().toLowerCase() !== "bimi1") return null;
  for (const part of parts) {
    const [tag, ...rest] = part.split("=");
    if (tag.trim().toLowerCase() === "l") {
      const location = rest.join("=").trim();
      return location ? unsubscribeUrl(location) ?? null : null;
    }
  }
  return null;
}

export type BimiDependencies = {
  resolveTxt: (name: string) => Promise<string[][]>;
  resolve: (host: string) => Promise<{ address: string; family: number }[]>;
  fetch: (url: URL, address: { address: string; family: number }, signal: AbortSignal) => Promise<Buffer>;
};

// The hostname stays intact for TLS verification and SNI; DNS is pinned to
// the address that passed the public-address check, as in remote-image.ts.
const fetchBimiLogo: BimiDependencies["fetch"] = (url, address, signal) => new Promise((resolve, reject) => {
  const outgoing = request(url, {
    method: "GET", agent: false, family: address.family, signal, timeout: requestTimeout, maxHeaderSize: 16384,
    lookup: (_host, _options, callback) => callback(null, address.address, address.family),
    headers: { Accept: "image/svg+xml", "User-Agent": "Mozilla/5.0" },
  }, response => {
    const type = String(response.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    if (response.statusCode !== 200 || type !== "image/svg+xml" || response.headers["content-encoding"]) {
      response.destroy();
      return reject(new BimiRefused("BIMI logo refused"));
    }
    const chunks: Buffer[] = [];
    let size = 0;
    response.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) response.destroy(new BimiRefused("BIMI logo limit"));
      else chunks.push(chunk);
    });
    response.on("error", reject);
    response.on("end", () => {
      const body = Buffer.concat(chunks);
      // Sniffed rather than trusted: the bytes are served to the renderer
      // from this origin, so they must be the vector shape they claim to be.
      if (!body.length || !bodyPattern.test(body.subarray(0, 256).toString("utf8"))) return reject(new BimiRefused("BIMI logo refused"));
      resolve(body);
    });
    response.on("close", () => { if (!response.complete) reject(new Error("BIMI logo closed")); });
  });
  outgoing.on("error", reject);
  outgoing.on("timeout", () => outgoing.destroy(new Error("BIMI logo timeout")));
  outgoing.end();
});

// DNS has no abort signal of its own, so a slow resolver is raced against the
// request deadline and cannot hold a logo worker past it.
function bounded<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error("BIMI lookup timeout"));
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

const defaults: BimiDependencies = {
  resolveTxt: (name) => resolveTxt(name),
  resolve: (host) => lookup(host, { all: true, verbatim: true }),
  fetch: fetchBimiLogo,
};

// The logo a domain publishes for itself: null when the domain has no usable
// logo, or "failed" when a lookup or download failed and is worth retrying
// later. The TXT lookup runs at default._bimi.<domain> and then the
// registrable domain; the logo host must resolve only to public addresses
// before it is fetched.
export type BimiResult = LogoImage | null | "failed";
export function bimiService(dependencies: BimiDependencies = defaults) {
  return async (domain: string): Promise<BimiResult> => {
    try {
      const signal = AbortSignal.timeout(requestTimeout);
      const candidates = [domain, registrableDomain(domain)];
      let failed = false;
      for (const candidate of [...new Set(candidates)]) {
        let records: string[][];
        try {
          records = await bounded(dependencies.resolveTxt(`default._bimi.${candidate}`), signal);
        } catch (error) {
          if (!noRecord(error)) failed = true;
          continue;
        }
        for (const chunks of records) {
          const url = parseBimiRecord(chunks.join(""));
          if (!url) continue;
          const host = url.hostname.replace(/^\[|\]$/g, "");
          let addresses: { address: string; family: number }[];
          try {
            addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await bounded(dependencies.resolve(host), signal);
          } catch (error) {
            return noRecord(error) ? null : "failed";
          }
          if (!addresses.length || addresses.some(({ address }) => !isIP(address) || !publicUnsubscribeAddress(address))) return null;
          // Every answer passed the check; try them in order, as a browser
          // falls back from an unreachable IPv6 address.
          let refused = false;
          for (const address of addresses) {
            try {
              const body = await dependencies.fetch(url, address, signal);
              return body.length ? { body, type: "image/svg+xml" } : null;
            } catch (error) {
              if (error instanceof BimiRefused) refused = true;
            }
          }
          return refused ? null : "failed";
        }
      }
      return failed ? "failed" : null;
    } catch {
      return "failed";
    }
  };
}
