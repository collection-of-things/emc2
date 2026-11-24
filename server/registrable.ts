// The registrable part of a hostname, shared by the logo registry and the
// BIMI lookup so subdomain addresses resolve to the domain's own record.

// Brand sites use two-part public suffixes often enough that ignoring them
// would resolve mail.bbc.co.uk to a registrable domain of co.uk.
const multiPartSuffixes = new Set([
  "ac.uk", "co.id", "co.il", "co.in", "co.jp", "co.ke", "co.kr", "co.nz",
  "co.th", "co.uk", "co.za", "com.ar", "com.au", "com.br", "com.cn",
  "com.hk", "com.mx", "com.my", "com.ng", "com.ph", "com.pl", "com.sg",
  "com.tr", "com.tw", "com.ua", "com.vn", "gov.uk", "ne.jp", "net.au",
  "org.au", "org.uk", "or.jp",
]);

export function registrableDomain(host: string): string {
  const labels = host.split(".");
  if (labels.length <= 2) return host;
  const width = multiPartSuffixes.has(labels.slice(-2).join(".")) ? 3 : 2;
  return labels.slice(-width).join(".");
}
