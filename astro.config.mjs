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
  // 2026-08 UPDATE (SEO Site Checkup "HTML Page Size Test" fix,
  // root-cause reversal of an earlier over-correction):
  //
  // ROOT CAUSE: "inlineStylesheets: 'always'" was previously set here
  // to fix a narrower PageSpeed Insights "Render-blocking requests"
  // audit item, by forcing Astro to embed the ENTIRE compiled CSS
  // bundle (Tailwind output + base.css/components.css/navigation.css/
  // buttons.css/safe.css/utilities.css/small-screen-fixes.css) as an
  // inline <style> block inside every page's HTML <head>, instead of
  // a separate cacheable .css file.
  //
  // This directly caused two confirmed, measured regressions found by
  // SEO Site Checkup on the live homepage:
  //   1. "HTML Page Size Test" FAILED - homepage HTML grew to 59.29 KB
  //      (vs the 33 KB average of top 100 sites, only 23% pass rate).
  //      A prior fix (see src/styles/index-overrides.css's own
  //      documented history) had already reduced homepage HTML to
  //      ~37.35 KB by extracting inline CSS to an external file -
  //      "inlineStylesheets: always" silently reversed that entire
  //      win by re-inlining everything.
  //   2. Lost repeat-visit CSS caching - public/_headers already sets
  //      "/*.css -> Cache-Control: public, max-age=31536000,
  //      immutable" for exactly this bundle, but that header is
  //      useless once the CSS is inlined into HTML instead of served
  //      as its own file: every single page navigation (home -> post
  //      -> category -> etc.) now re-downloads the FULL CSS bundle as
  //      part of that page's HTML, uncompressed-relative-savings,
  //      instead of loading it once from cache.
  //   3. Likely contributed to a separate "Media Query Responsive
  //      Test" false-negative on some automated checkers, which only
  //      scan external <link rel="stylesheet"> files for "@media"
  //      rules and do not deep-parse inline <style> block contents.
  //
  // PERMANENT FIX: reverted to "auto" (Astro's own documented smart
  // default) - Astro decides per-stylesheet whether to inline (only
  // for genuinely small stylesheets) or link externally, restoring
  // both the smaller HTML payload and the year-long immutable CSS
  // cache for repeat visitors, while still allowing Astro to inline
  // any small stylesheet automatically. If a future, more targeted
  // render-blocking-CSS fix is needed, the correct approach is an
  // async-CSS-loading pattern (rel="preload" + onload swap) scoped to
  // just the critical-path stylesheet, not a blanket "always inline
  // everything" site-wide switch.
  build: {
    format: "directory",
    inlineStylesheets: "auto",
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
  // hand-tuned, PageSpeed-driven "widths"/"sizes" props (see the
  // "postGridImageSizes" calculation and its W3C-validator-driven
  // "densities" -> "widths"+"sizes" migration history in
  // Posts.astro). Turning this on site-wide without auditing every
  // <Image> usage individually risks silently overriding those
  // deliberate, already-optimized values. Removing the dead key is
  // therefore the correct, zero-risk fix - it changes nothing
  // functionally (since the key never worked), while eliminating
  // invalid/confusing configuration from the codebase. If site-wide
  // native responsive images are wanted in the future, that should
  // be a deliberate, separately-scoped migration across every
  // <Image>-using component.
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
