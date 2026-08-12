import mdx from "@astrojs/mdx";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import AutoImport from "astro-auto-import";
import gtm from "astro-gtm-lite";
import { defineConfig, fontProviders, sharpImageService } from "astro/config";
import config from "./src/config/config.json";
import theme from "./src/config/theme.json";
import redirectFixer from "./src/integrations/redirect-fixer.mjs";
import earlyHintsPreload from "./src/integrations/early-hints-preload.mjs";
import markdownPlugins from "./src/integrations/markdown-plugins.mjs";
// ==========================================================
// GIT-COMMIT-BASED REAL-TIME LASTMOD SYSTEM
//
// ROOT CAUSE THIS SOLVES: the sitemap previously emitted zero
// <lastmod> tags at all. Google has no signal about which URLs
// actually changed recently, so editing a single word inside an
// existing post never triggered a faster recrawl priority - Google
// only re-visits on its own normal crawl schedule.
//
// THE FIX: instead of relying on frontmatter "date"/"updated"
// (which authors often forget to bump on a small edit), this reads
// the REAL git commit history of each content file directly at
// build time via `git log -1 --format=%cI -- <file>` (strict ISO
// 8601 committer date - the exact format <lastmod> requires). Any
// commit that touches a file - even a one-word fix - immediately
// updates that URL's lastmod on the next build/deploy, giving
// Google an accurate, always-current freshness signal.
//
// SELF-HEALING / NEVER BREAKS THE BUILD: every git call is wrapped
// in try/catch. If git is unavailable, the repo is a shallow clone
// with no history for a file, or a file was never committed yet,
// execution falls through to a safe fallback (the most recent
// commit touching src/content/posts/, or the build's own current
// timestamp as a last resort) - the sitemap is always valid XML,
// never blocks or fails the Cloudflare Pages build.
// ==========================================================
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { slug as githubSlug } from "github-slugger";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = path.join(__dirname, "src/content");
// Per-file git commit date cache - guarantees each file's `git log`
// command runs at most once per build, regardless of how many
// sitemap URLs reference it.
const gitLastModCache = new Map();
function getGitLastMod(absFilePath) {
  if (gitLastModCache.has(absFilePath)) return gitLastModCache.get(absFilePath);
  let result = null;
  try {
    if (existsSync(absFilePath)) {
      const out = execSync(`git log -1 --format=%cI -- "${absFilePath}"`, {
        cwd: __dirname,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (out) result = out;
    }
  } catch {
    // git unavailable / shallow clone / file untracked - handled by
    // caller's fallback chain, never throws.
    result = null;
  }
  gitLastModCache.set(absFilePath, result);
  return result;
}
function findContentFile(dir, slugValue) {
  for (const ext of [".md", ".mdx"]) {
    const p = path.join(dir, `${slugValue}${ext}`);
    if (existsSync(p)) return p;
  }
  return null;
}
// Site-wide fallback: most recent commit touching ANY post file.
// Used for the homepage, pagination pages, search page, and any
// unmapped URL, so they still get a meaningful, real lastmod instead
// of none at all.
let siteWideLastModCache = null;
function getSiteWideLastMod() {
  if (siteWideLastModCache) return siteWideLastModCache;
  try {
    const postsDir = path.join(CONTENT_DIR, "posts");
    const out = execSync(`git log -1 --format=%cI -- "${postsDir}"`, {
      cwd: __dirname,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    siteWideLastModCache = out || new Date().toISOString();
  } catch {
    siteWideLastModCache = new Date().toISOString();
  }
  return siteWideLastModCache;
}
// Reuses the exact same frontmatter-array-extraction pattern already
// proven in .github/workflows/google-indexing.yml's extractArrayField
// (inline "categories: [a, b]" AND YAML block-list "categories:\n  - a"
// formats), so category/tag matching here stays 100% consistent with
// how the rest of this codebase already parses this same frontmatter.
function extractArrayField(content, fieldName) {
  const inlineMatch = content.match(new RegExp(fieldName + "\\s*:\\s*\\[([^\\]]*)\\]"));
  if (inlineMatch) {
    return inlineMatch[1]
      .split(",")
      .map((item) => item.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  const blockRegex = new RegExp(fieldName + "\\s*:\\s*\\n((?:[ \\t]*-[ \\t]*.+\\n?)+)");
  const blockMatch = content.match(blockRegex);
  if (blockMatch) {
    return blockMatch[1]
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("-"))
      .map((line) => line.replace(/^-\s*/, "").trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  return [];
}
let postsFileListCache = null;
function getAllPostFiles() {
  if (postsFileListCache) return postsFileListCache;
  const dir = path.join(CONTENT_DIR, "posts");
  postsFileListCache = [];
  try {
    for (const file of readdirSync(dir)) {
      if (!/\.(md|mdx)$/i.test(file)) continue;
      if (file.startsWith("-")) continue; // skip -index.md system files
      postsFileListCache.push(path.join(dir, file));
    }
  } catch {
    postsFileListCache = [];
  }
  return postsFileListCache;
}
// Category/Tag archive pages don't map to a single file, so their
// lastmod is the MOST RECENT commit among every post that actually
// carries that category/tag in its frontmatter - an accurate
// freshness signal for the archive page's real content, not a
// hardcoded/static one.
const taxonomyLastModCache = new Map();
function getTaxonomyLastMod(fieldName, slugValue) {
  const cacheKey = `${fieldName}:${slugValue}`;
  if (taxonomyLastModCache.has(cacheKey)) return taxonomyLastModCache.get(cacheKey);
  let latest = null;
  for (const filePath of getAllPostFiles()) {
    try {
      const content = readFileSync(filePath, "utf-8");
      const values = extractArrayField(content, fieldName);
      const isMatch = values.some((v) => githubSlug(v) === slugValue);
      if (isMatch) {
        const d = getGitLastMod(filePath);
        if (d && (!latest || new Date(d) > new Date(latest))) {
          latest = d;
        }
      }
    } catch {
      // Unreadable/corrupt file - skip it, don't break the whole scan.
    }
  }
  const result = latest || getSiteWideLastMod();
  taxonomyLastModCache.set(cacheKey, result);
  return result;
}
// Master resolver: maps a sitemap URL's pathname back to the real
// content source(s) behind it, and returns the most accurate lastmod
// available. Every branch has a safe fallback, so this function can
// never return null/undefined/throw.
function resolveLastModForUrl(pathname) {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return getSiteWideLastMod(); // homepage "/"
  const EXCLUDED_FIRST_SEGMENTS = ["categories", "tags", "page", "search", "blog", "authors", "about", "contact"];
  // /blog/{slug}/
  if (segments[0] === "blog" && segments[1]) {
    const f = findContentFile(path.join(CONTENT_DIR, "posts"), segments[1]);
    if (f) {
      const d = getGitLastMod(f);
      if (d) return d;
    }
    return getSiteWideLastMod();
  }
  // /authors/{slug}/ (not /authors/page/N/)
  if (segments[0] === "authors" && segments[1] && segments[1] !== "page") {
    const f = findContentFile(path.join(CONTENT_DIR, "authors"), segments[1]);
    if (f) {
      const d = getGitLastMod(f);
      if (d) return d;
    }
    return getSiteWideLastMod();
  }
  // /about/
  if (segments[0] === "about") {
    const d = getGitLastMod(path.join(CONTENT_DIR, "about", "-index.md"));
    return d || getSiteWideLastMod();
  }
  // /contact/
  if (segments[0] === "contact") {
    const d = getGitLastMod(path.join(CONTENT_DIR, "contact", "-index.md"));
    return d || getSiteWideLastMod();
  }
  // /categories/{slug}/ (not /categories/{slug}/page/N/, not /categories/ index)
  if (segments[0] === "categories" && segments[1] && segments[1] !== "page") {
    return getTaxonomyLastMod("categories", segments[1]);
  }
  // /tags/{slug}/ (not /tags/{slug}/page/N/, not /tags/ index)
  if (segments[0] === "tags" && segments[1] && segments[1] !== "page") {
    return getTaxonomyLastMod("tags", segments[1]);
  }
  // Generic top-level "pages" collection routes (/privacy-policy/,
  // /copyright-credit-policy/, etc. - handled by [regular].astro)
  if (segments.length === 1 && !EXCLUDED_FIRST_SEGMENTS.includes(segments[0])) {
    const f = findContentFile(path.join(CONTENT_DIR, "pages"), segments[0]);
    if (f) {
      const d = getGitLastMod(f);
      if (d) return d;
    }
  }
  // Homepage, pagination pages, category/tag index pages, search page,
  // and anything else unmapped - fall back to the most recent post
  // commit site-wide.
  return getSiteWideLastMod();
}
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
// ==========================================================
// FIXED (CRITICAL - Cloudflare Pages build failure,
// "CannotFetchFontFile" 404 on fonts.gstatic.com):
//
// ROOT CAUSE: Astro's stable Fonts API (the "fonts" config array
// below) computes fallback font metrics at BUILD TIME by making a
// real network request to the font provider to download the actual
// font file bytes (needed to calculate size-adjust/ascent-override
// CSS via Capsize). With fontProviders.google(), that request goes
// directly to fonts.gstatic.com using a specific hashed file URL.
// Google periodically rotates these hashed URLs when a font family
// is re-published - an old hash that worked yesterday can start
// returning a hard 404 with zero warning, and since this happens
// during the Cloudflare Pages build step (not in the browser), a
// single flaky/rotated URL fails the ENTIRE site build.
//
// This exact class of problem (fonts.gstatic.com becoming
// unreliable for build-time fetches) is already documented and
// worked around elsewhere in this codebase - see
// src/lib/og/font.ts, which had to add a jsDelivr CDN fallback for
// the exact same reason when generating OG images with Satori.
//
// FIX: switched the provider from fontProviders.google() to
// fontProviders.bunny(). Bunny Fonts mirrors the entire Google
// Fonts catalog (same family names, same weights - "Mulish" is
// unaffected and needs zero other config changes) but is served
// from Bunny's own CDN infrastructure, which is not subject to the
// same hash-rotation behavior that broke the Google-hosted URL
// above. This removes the dependency on fonts.gstatic.com's
// build-time availability entirely, with a single provider swap and
// no binary font files needing to be committed to the repo.
// ==========================================================
const fontsConfig = Object.entries(theme.fonts.font_family)
  .filter(([key]) => !key.includes("_type"))
  .map(([key, fontStr]) => {
    const { name, weights } = parseFontString(fontStr);
    const typeKey = `${key}_type`;
    const fallback = theme.fonts.font_family[typeKey] || "sans-serif";
    return {
      name,
      cssVariable: `--font-${key}`,
      provider: fontProviders.bunny(),
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
    react(),
    // 404->301 auto-redirect fixer: scans the last git commit for
    // src/content/posts/ renames/deletes at astro:build:start and
    // writes/merges corresponding rules into public/_redirects
    // under an AUTO-GENERATED marker block. Self-healing - never
    // blocks or fails the build (see src/integrations/redirect-fixer.mjs).
    redirectFixer(),
    // Core Web Vitals: per-post hero-image Link/preload header
    // generator, appended to dist/_headers at build:done. Cloudflare
    // replays these as HTTP 103 Early Hints once "Speed > Optimization
    // > Early Hints" is enabled on the zone dashboard. Self-healing -
    // never blocks or fails the build (see
    // src/integrations/early-hints-preload.mjs).
    earlyHintsPreload(),
    // FIXED (Astro "markdown.remarkPlugins option has been deprecated"
    // warning): registers remarkAutoInternalLinks through the
    // recommended astro:config:setup + updateConfig integration
    // pattern instead of the deprecated top-level markdown.remarkPlugins
    // shorthand. See src/integrations/markdown-plugins.mjs.
    markdownPlugins(),
    sitemap({
      changefreq: "weekly",
      priority: 0.7,
      serialize(item) {
        if (isExcludedFromSitemap(item.url)) {
          return undefined;
        }
        item.url = ensureSitemapTrailingSlash(item.url);
        // GIT-COMMIT-BASED REAL-TIME LASTMOD: resolves the real,
        // most-recent commit date for whatever content backs this
        // URL (post/page/author/about/contact file, or the newest
        // matching post for category/tag archives), instead of a
        // frontmatter date the author might forget to update. Wrapped
        // defensively so a resolution failure NEVER removes/breaks an
        // otherwise-valid sitemap entry - it simply omits lastmod for
        // that one URL and continues.
        try {
          const urlObj = new URL(item.url);
          const lastmod = resolveLastModForUrl(urlObj.pathname);
          if (lastmod) item.lastmod = lastmod;
        } catch {
          // Self-healing: leave lastmod unset for this URL only.
        }
        return item;
      },
    }),
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
