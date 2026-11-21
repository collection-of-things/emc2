import { defineConfig } from "astro/config";
import preact from "@astrojs/preact";

// Static landing page. The download and star counts are read in the browser
// straight from the public GitHub API, so the build needs no server. SITE_URL
// overrides the production origin for og:url and the canonical link.
export default defineConfig({
  site: process.env.SITE_URL || "https://emc2.collection-of-devs.workers.dev/",
  output: "static",
  server: { allowedHosts: [".trycloudflare.com"] },
  integrations: [preact()],
});
