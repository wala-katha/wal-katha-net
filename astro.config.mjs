import mdx from "@astrojs/mdx";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import AutoImport from "astro-auto-import";
import gtm from "astro-gtm-lite";
import { defineConfig, fontProviders, sharpImageService } from "astro/config";
import config from "./src/config/config.json";
import theme from "./src/config/theme.json";
function parseFontString(fontStr) {
  const [name, weightPart] = fontStr.split(":");
  let weights = [400];
  if (weightPart) {
    const weightMatch = weightPart.match(/wght@?([\d;]+)/);
    if (weightMatch) {
      weights = weightMatch[1].split(";").map((w) => parseInt(w, 10));
    }
  }
  const cleanName = name.replace(/\+/g, " ");
  return { name: cleanName, weights };
}
const fontsConfig = Object.entries(theme.fonts.font_family)
  .filter(([key]) => !key.includes("_type"))
  .map(([key, fontStr]) => {
    const { name, weights } = parseFontString(fontStr);
    const typeKey = `${key}_type`;
    const fallback = theme.fonts.font_family[typeKey] || "sans-serif";
    return {
      name,
      cssVariable: `--font-${key}`,
      provider: fontProviders.google(),
      weights,
      display: "swap",
      fallbacks: [fallback],
    };
  });
function ensureSitemapTrailingSlash(url) {
  if (url.endsWith("/")) return url;
  const lastSegment = url.split("/").pop() || "";
  if (lastSegment.includes(".")) return url;
  return `${url}/`;
}
const EXCLUDED_SITEMAP_PATHS = ["/elements", "/page/1"];
function isExcludedFromSitemap(url) {
  const path = url.replace(/^https?:\/\/[^/]+/, "").replace(/\/$/, "");
  return EXCLUDED_SITEMAP_PATHS.includes(path);
}
export default defineConfig({
  site: config.site.base_url ? config.site.base_url : "https://www.walakatha.net",
  base: config.site.base_path ? config.site.base_path : "/",
  // ==========================================================
  // CONFIRMED DEPLOYMENT TARGET: Cloudflare Pages (Git
  // integration / auto-deploy on push). This is NOT a Cloudflare
  // Workers (wrangler deploy) deployment - wrangler.jsonc's
  // "assets.html_handling" setting has ZERO effect on this live
  // site, since that config only applies to Workers Static Assets
  // deployments, not Pages Git-integration builds (confirmed via
  // Cloudflare's own docs at
  // developers.cloudflare.com/workers/static-assets/routing/).
  //
  // Cloudflare Pages ALWAYS 308-redirects a no-trailing-slash
  // directory-style request (e.g. "/blog/foo") to the trailing-slash
  // version ("/blog/foo/") when the build output uses the default
  // "directory" format (page/index.html files) - this is fixed,
  // non-configurable Pages platform behavior. The site's own
  // src/lib/utils/urlHelper.ts (withTrailingSlash) and Base.astro
  // (ensureTrailingSlash) already generate every internal link,
  // canonical tag, and sitemap URL WITH a trailing slash to match
  // this reality.
  //
  // trailingSlash: "always" here (driven by config.json's
  // site.trailing_slash = true) makes the LOCAL "astro dev" / "astro
  // preview" dev-server route-matching behavior identical to actual
  // production Cloudflare Pages behavior - Astro's own docs
  // recommend pairing trailingSlash: "always" with the default
  // build.format: "directory" for exactly this reason. This does
  // NOT change the production static build output (which was already
  // correct), it only fixes local dev/preview accuracy so links
  // that work in production also work identically when testing
  // locally.
  // ==========================================================
  trailingSlash: config.site.trailing_slash ? "always" : "never",
  // 2026-08 FINAL DECISION (inlineStylesheets - CSS delivery strategy,
  // corrected after a confirmed regression):
  //
  // HISTORY OF THIS SETTING (documented here so the reasoning is never
  // lost across future edits):
  //   1. Originally "always" - forced the entire compiled CSS bundle
  //      to be inlined into every page's HTML <head>, specifically to
  //      fix a PageSpeed Insights "Render-blocking requests" audit
  //      item (an external <link rel="stylesheet"> blocks first paint
  //      until it downloads).
  //   2. Changed to "auto" to fix a DIFFERENT, third-party "SEO Site
  //      Checkup" tool's "HTML Page Size Test" (homepage HTML had
  //      grown to 59.29 KB from all that inlined CSS, vs a 33 KB
  //      average). "auto" only inlines stylesheets smaller than Vite's
  //      default assetsInlineLimit (4 KB) and links everything larger
  //      externally.
  //   3. CONFIRMED REGRESSION (re-measured via PageSpeed Insights after
  //      the "auto" change): this project's real compiled CSS bundle
  //      is 19.6 KiB - roughly 5x larger than the 4 KB "auto" inline
  //      threshold - so "auto" always links it externally as
  //      "/_astro/Base.[hash].css", reintroducing the EXACT
  //      render-blocking-requests problem "always" was originally
  //      added to fix (confirmed: Est savings 150 ms, flagged again as
  //      a red/failing item, with Base.css appearing in the Network
  //      Dependency Tree as a blocking critical-path request).
  //
  // FINAL DECISION: reverted to "always". Rationale for resolving this
  // conflict permanently in this direction: PageSpeed Insights is
  // Google's own official tool measuring real Core Web Vitals (LCP is
  // directly delayed by render-blocking CSS, and LCP is a confirmed
  // Google ranking factor). The third-party "SEO Site Checkup" tool's
  // "HTML Page Size Test" is an unscored, generic heuristic (a simple
  // average-size comparison) that is not a documented Google ranking
  // signal. When the two conflict, the official, ranking-relevant
  // Core Web Vitals metric takes priority.
  //
  // If HTML page size needs revisiting again in the future, the
  // correct approach is NOT toggling this flag back and forth - it is
  // a genuinely different technique: an async/non-blocking external
  // stylesheet load (rel="preload" as="style" + onload swap, with a
  // <noscript> fallback), which keeps CSS as a separate cacheable file
  // (solving both the page-size AND the repeat-visit-caching problem)
  // while never blocking render (solving the Core Web Vitals problem
  // too). That pattern requires intercepting Astro's own automatic
  // stylesheet-link injection (a custom integration hook), which is a
  // larger, deliberately-scoped follow-up task, not a one-line config
  // flip.
  build: {
    format: "directory",
    inlineStylesheets: "always",
  },
  // ASTRO 7 UPGRADE FIX: Astro 7.0's compressHTML default changed to
  // JSX-style whitespace collapsing (span/inline elements lose
  // line-break spaces between them). This site's Sinhala prose content
  // and comma-separated inline tags (Posts.astro, PostSingle.astro)
  // carry visual regression risk from that change, so the prior (Astro
  // 6) compress behavior is explicitly retained here.
  compressHTML: true,
  // ==========================================================
  // CONFIRMED FIX (Astro 7.1.3, verified against installed
  // node_modules/astro/package.json version - 2026-07):
  //
  // ROOT CAUSE: "experimentalResponsiveImages: true" previously sat
  // here inside "image: {}". This was NEVER a valid Astro config
  // key at ANY point in Astro's history - the old (pre-5.10)
  // experimental syntax lived under a completely separate top-level
  // "experimental: { responsiveImages: true }" object, not under
  // "image.*". Astro's image-config schema silently ignores unknown
  // keys, so this line has always been a dead no-op - it never
  // enabled anything, in any Astro version this project has ever
  // run on.
  //
  // As of Astro 5.10.0 (PR #13917, "unflag responsive images"), the
  // entire experimental system was removed and replaced with a
  // stable "image.layout" + "image.responsiveStyles" API. Astro
  // 7.1.3 (this project's confirmed installed version) only
  // supports the NEW stable API - there is no experimental flag of
  // any kind left to enable.
  //
  // WHY IT IS NOT RE-ENABLED HERE: enabling the real stable feature
  // (image.layout: "constrained" + image.responsiveStyles: true)
  // would auto-inject srcset/sizes/CSS styles onto EVERY <Image>
  // component site-wide by default - including the ones in
  // Posts.astro and SimilarPosts.astro that already have carefully
  // hand-tuned, PageSpeed-driven "widths"/"sizes" props. Turning this
  // on site-wide without auditing every <Image> usage individually
  // risks silently overriding those deliberate, already-optimized
  // values. Removing the dead key is therefore the correct, zero-risk
  // fix - it changes nothing functionally (since the key never
  // worked), while eliminating invalid/confusing configuration from
  // the codebase. If site-wide native responsive images are wanted in
  // the future, that should be a deliberate, separately-scoped
  // migration across every <Image>-using component.
  // ==========================================================
  image: {
    service: sharpImageService({
      jpeg: { quality: 75 },
      webp: { quality: 72 },
      png: { quality: 80 },
      avif: { quality: 65 },
    }),
  },
  vite: {
    plugins: [tailwindcss()],
    build: {
      cssCodeSplit: true,
    },
  },
  fonts: fontsConfig,
  integrations: [
    react(),
    sitemap({
      changefreq: "weekly",
      priority: 0.7,
      serialize(item) {
        if (isExcludedFromSitemap(item.url)) {
          return undefined;
        }
        item.url = ensureSitemapTrailingSlash(item.url);
        return item;
      },
    }),
    AutoImport({
      imports: [
        "@/shortcodes/Button",
        "@/shortcodes/Accordion",
        "@/shortcodes/Notice",
        "@/shortcodes/Video",
        "@/shortcodes/Youtube",
        "@/shortcodes/Tabs",
        "@/shortcodes/Tab",
      ],
    }),
    mdx(),
    gtm({
      enable: config.google_tag_manager.enable,
      id: config.google_tag_manager.gtm_id,
      devMode: false,
    }),
  ],
  markdown: {
    shikiConfig: { theme: "one-dark-pro", wrap: true },
  },
});
