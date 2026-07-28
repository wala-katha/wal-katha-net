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
  // 🎯 CONFIRMED DEPLOYMENT TARGET: Cloudflare Pages (Git
  // integration / auto-deploy on push). This is NOT a Cloudflare
  // Workers (wrangler deploy) deployment — wrangler.jsonc's
  // "assets.html_handling" setting has ZERO effect on this live
  // site, since that config only applies to Workers Static Assets
  // deployments, not Pages Git-integration builds (confirmed via
  // Cloudflare's own docs at
  // developers.cloudflare.com/workers/static-assets/routing/).
  //
  // Cloudflare Pages ALWAYS 308-redirects a no-trailing-slash
  // directory-style request (e.g. "/blog/foo") to the trailing-slash
  // version ("/blog/foo/") when the build output uses the default
  // "directory" format (page/index.html files) — this is fixed,
  // non-configurable Pages platform behavior. The site's own
  // src/lib/utils/urlHelper.ts (withTrailingSlash) and Base.astro
  // (ensureTrailingSlash) already generate every internal link,
  // canonical tag, and sitemap URL WITH a trailing slash to match
  // this reality.
  //
  // trailingSlash: "always" here (driven by config.json's
  // site.trailing_slash = true) makes the LOCAL "astro dev" / "astro
  // preview" dev-server route-matching behavior identical to actual
  // production Cloudflare Pages behavior — Astro's own docs
  // recommend pairing trailingSlash: "always" with the default
  // build.format: "directory" for exactly this reason. This does
  // NOT change the production static build output (which was already
  // correct), it only fixes local dev/preview accuracy so links
  // that work in production also work identically when testing
  // locally.
  // ==========================================================
  trailingSlash: config.site.trailing_slash ? "always" : "never",
  // 🎯 EXPLICIT, FUTURE-PROOF DECLARATION: "directory" is already
  // Astro's default build.format, but declaring it explicitly here
  // guarantees this pairing (trailingSlash: "always" + directory-style
  // output) can never silently drift apart if a future Astro major
  // version ever changes its default — self-healing against upstream
  // default changes.
  //
  // 🎯 NEW FIX (2026-07 — PageSpeed Insights "Render-blocking requests"
  // audit, Est savings 300ms): ROOT CAUSE: Base.astro's global
  // "@/styles/main.css" import (bundling base.css, components.css,
  // navigation.css, buttons.css, safe.css, utilities.css, and Tailwind's
  // compiled output) was being emitted as a separate hashed CSS file
  // (e.g. "/_astro/Base.[hash].css", ~19.2 KiB) referenced via a
  // render-blocking <link rel="stylesheet"> tag that Astro injects
  // automatically into every page's <head>. Because this filename is
  // build-time-hashed and injected by Astro itself (not authored
  // manually anywhere in this codebase), it cannot be preloaded via a
  // hardcoded <link rel="preload"> — the only correct, framework-level
  // fix is Astro's own documented "build.inlineStylesheets" option.
  //
  // PERMANENT FIX: "inlineStylesheets: 'always'" forces Astro to emit
  // this CSS as an inline <style> block directly inside the HTML
  // document instead of a separate network request — this completely
  // eliminates the render-blocking stylesheet request (and the
  // corresponding entry in the Network Dependency Tree) for EVERY page
  // site-wide, since every page shares the same Base.astro layout and
  // therefore the same compiled CSS bundle.
  //
  // TRADE-OFF (documented, not hidden): this increases raw HTML
  // document size by roughly the size of the CSS bundle. Cloudflare
  // Pages serves all HTML responses with automatic gzip/brotli
  // compression, so the real-world transferred-byte impact is smaller
  // than the raw KiB figures suggest — and removing a full
  // render-blocking round-trip (which directly delays LCP/FCP) is a
  // stronger performance win than the added inline-CSS parse cost.
  // Astro's own documentation recommends this exact option for exactly
  // this Lighthouse/PageSpeed audit.
  build: {
    format: "directory",
    inlineStylesheets: "always",
  },
  // 🎯 ASTRO 7 UPGRADE FIX: Astro 7.0 හි compressHTML default එක
  // JSX-style whitespace collapsing බවට වෙනස් වී ඇත (span/inline
  // elements අතර line-break spaces ඉවත් වේ). මෙම site එකේ ඇති Sinhala
  // prose content සහ comma-separated inline tags (Posts.astro,
  // PostSingle.astro) වල visual regression risk එකක් වළක්වා ගැනීමට,
  // Astro 6 හි පැරණි (compress) behavior එකම explicit ලෙස රඳවා ගනී.
  compressHTML: true,
  // ==========================================================
  // 🎯 CONFIRMED FIX (Astro 7.1.3, verified against installed
  // node_modules/astro/package.json version — 2026-07):
  //
  // ROOT CAUSE: "experimentalResponsiveImages: true" previously sat
  // here inside "image: {}". This was NEVER a valid Astro config
  // key at ANY point in Astro's history — the old (pre-5.10)
  // experimental syntax lived under a completely separate top-level
  // "experimental: { responsiveImages: true }" object, not under
  // "image.*". Astro's image-config schema silently ignores unknown
  // keys, so this line has always been a dead no-op — it never
  // enabled anything, in any Astro version this project has ever
  // run on.
  //
  // As of Astro 5.10.0 (PR #13917, "unflag responsive images"), the
  // entire experimental system was removed and replaced with a
  // stable "image.layout" + "image.responsiveStyles" API. Astro
  // 7.1.3 (this project's confirmed installed version) only
  // supports the NEW stable API — there is no experimental flag of
  // any kind left to enable.
  //
  // WHY IT IS NOT RE-ENABLED HERE: enabling the real stable feature
  // (image.layout: "constrained" + image.responsiveStyles: true)
  // would auto-inject srcset/sizes/CSS styles onto EVERY <Image>
  // component site-wide by default — including the ones in
  // Posts.astro and SimilarPosts.astro that already have carefully
  // hand-tuned, PageSpeed-driven "widths"/"sizes" props (see the
  // "postGridImageSizes" calculation and its W3C-validator-driven
  // "densities" -> "widths"+"sizes" migration history in
  // Posts.astro). Turning this on site-wide without auditing every
  // <Image> usage individually risks silently overriding those
  // deliberate, already-optimized values. Removing the dead key is
  // therefore the correct, zero-risk fix — it changes nothing
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
