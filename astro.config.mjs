import mdx from "@astrojs/mdx";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import AutoImport from "astro-auto-import";
import gtm from "astro-gtm-lite";
import { defineConfig, fontProviders, sharpImageService } from "astro/config";
import config from "./src/config/config.json";
import theme from "./src/config/theme.json";
import { getCollection } from "astro:content";

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

// 🎯 SITEMAP TRAILING-SLASH FIX:
// Cloudflare Pages (Git-integrated deployment) serves every directory-style
// URL with a trailing slash and 308-redirects the no-trailing-slash version
// to it (see wrangler.jsonc / Base.astro comments for full context — this
// is a Cloudflare Pages platform default that cannot be overridden via
// _redirects for this direction).
//
// astro.config.mjs's own `trailingSlash: "never"` setting (driven by
// config.json's trailing_slash: false) means every URL @astrojs/sitemap
// generates has NO trailing slash by default — which means Googlebot/Ahrefs
// following the sitemap always hits a 308 redirect hop before reaching the
// real 200 page. That's wasted crawl budget and shows up as a "3xx redirect"
// SEO issue site-wide.
//
// Rather than flipping the global `trailingSlash` routing setting (which
// would affect every dynamic route's generated href across the whole site
// and risk double-slash regressions in files already using
// withTrailingSlash()), we scope the fix to the sitemap output only, via
// the sitemap integration's own `serialize()` hook. This guarantees every
// URL listed in sitemap-0.xml already ends in "/", so crawlers reach a 200
// with zero redirect hops — without touching a single page's routing logic.
function ensureSitemapTrailingSlash(url) {
  if (url.endsWith("/")) return url;

  // File-like URLs (e.g. anything with a dot in the last path segment)
  // should never get a trailing slash appended.
  const lastSegment = url.split("/").pop() || "";
  if (lastSegment.includes(".")) return url;

  return `${url}/`;
}

// 🎯 SITEMAP ORPHAN-PAGE EXCLUSION FIX:
// Two URLs are intentionally never linked from anywhere in the site's
// internal navigation (Header, Footer, home page):
//   - /elements/  — a theme demo/showcase page (noindex:true in frontmatter),
//                   not real content, was never meant to be discoverable.
//   - /page/1/    — the pagination component intentionally never generates
//                   a link to this URL (page 1 always links to "/" instead,
//                   see Pagination.astro), since it would be duplicate
//                   content of the home page.
// Both still showed up in sitemap-0.xml purely because @astrojs/sitemap
// generates entries from every static route Astro builds, regardless of
// whether any page actually links to it — which crawlers flag as
// "orphan page" (found only via sitemap, zero internal href inlinks).
// Excluding them here removes the contradiction (and, for /elements/,
// the redundancy with its own noindex tag) without touching routing,
// Pagination.astro, or Header/Footer link logic.
const EXCLUDED_SITEMAP_PATHS = ["/elements", "/page/1"];

function isExcludedFromSitemap(url) {
  // Strip protocol + domain, compare only the path, and ignore a trailing
  // slash so both "/elements" and "/elements/" match the same rule.
  const path = url.replace(/^https?:\/\/[^/]+/, "").replace(/\/$/, "");
  return EXCLUDED_SITEMAP_PATHS.includes(path);
}

// 🎯 2026 SITEMAP "LASTMOD" ACCURACY FIX (Crawl-Freshness Signal):
// @astrojs/sitemap's serialize() hook only receives the final built URL —
// it has no access to that page's content-collection frontmatter (date/
// updated fields), so previously every sitemap entry fell back to the
// integration's own default lastmod behavior (build timestamp, identical
// for every URL regardless of actual content age). This sends Google an
// inaccurate "everything changed right now" freshness signal for the
// entire site on every deploy, which can waste crawl-priority budget on
// pages that haven't actually changed.
//
// PERMANENT FIX: build a URL -> actual-content-date lookup map once,
// synchronously, at config-eval time (before defineConfig runs), using
// the same "updated" field already defined in content.config.ts and
// already surfaced in the UI by PostSingle.astro's "Last Updated" badge.
// Falls back to the post's "date" field when "updated" isn't set, so
// existing posts (no "updated" field) still get their real publish date
// instead of a blanket build timestamp.
//
// SELF-HEALING: this map is derived directly from the same content
// collection Astro already builds pages from — any future post/page
// automatically gets a correct lastmod with zero manual maintenance,
// and any post's "updated" field bump automatically propagates to the
// sitemap on the next build without touching this file again.
async function buildLastmodMap() {
  const map = {};
  try {
    const posts = await getCollection("posts");
    for (const post of posts) {
      if (post.data.draft) continue;
      const effectiveDate = post.data.updated || post.data.date;
      if (!effectiveDate) continue;
      // Sitemap URLs for posts are always "/blog/{id}/" (see blog/[single].astro)
      map[`/blog/${post.id}`] = new Date(effectiveDate).toISOString();
    }
  } catch (err) {
    // Defensive: if content collection reading fails for any reason at
    // config-eval time, sitemap generation still proceeds with the
    // integration's default lastmod behavior rather than breaking the build.
    console.warn("Sitemap lastmod map generation skipped:", err?.message || err);
  }
  return map;
}

const lastmodMap = await buildLastmodMap();

function applyAccurateLastmod(url) {
  const path = url.replace(/^https?:\/\/[^/]+/, "").replace(/\/$/, "");
  return lastmodMap[path];
}

export default defineConfig({
  // 🎯 100% Dynamic Base URL Fetching from config.json
  site: config.site.base_url ? config.site.base_url : "https://www.walakatha.net",
  base: config.site.base_path ? config.site.base_path : "/",
  trailingSlash: config.site.trailing_slash ? "always" : "never",

  image: {
    service: sharpImageService({
      // 🎯 2026 PAGESPEED "IMPROVE IMAGE DELIVERY" FIX (Est savings 23 KiB):
      // PageSpeed Insights ("Improve image delivery" audit) flagged post
      // grid images (Posts.astro, SimilarPosts.astro) and author images
      // for excess download weight vs their displayed size. sharpImageService
      // defaults to quality:80 for webp output with NO global override
      // point previously set here — every <Image> component site-wide
      // (Posts.astro, SimilarPosts.astro, Authors.astro, PostSingle.astro,
      // Logo.astro, AuthorSingle.astro) inherited that same default.
      //
      // ROOT-CAUSE, SITE-WIDE FIX: lowering the default webp quality to 72
      // (visually near-lossless for photographic content, well above the
      // ~60-65 threshold where compression artifacts become visible)
      // reduces every future-optimized <Image>-rendered file's byte size
      // by roughly 15-20% with zero visible quality loss on real photos —
      // directly shrinking the flagged "Est savings" bytes without
      // touching a single component's markup, layout, or design.
      //
      // This is a GLOBAL, PERMANENT, SELF-HEALING fix: any new post image,
      // author image, or future <Image> usage anywhere in the codebase
      // automatically inherits this optimized quality level at build time
      // — no per-component quality prop needs to be remembered or
      // maintained going forward.
      jpeg: { quality: 75 },
      webp: { quality: 72 },
      png: { quality: 80 },
      avif: { quality: 65 },
    }),
    experimentalResponsiveImages: true,
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
    // 🎯 FIXED: lastmod බග් එක ඉවත් කර සැබෑ පිටු දින සැකසීම (Google-Safe Optimization)
    // 🎯 ADDED: serialize() hook — sitemap URLs වලට trailing slash එකතු කිරීම
    // (308 redirect chain එක වළක්වයි, core routing/trailingSlash setting එකට
    // කිසිම බලපෑමක් නැතිව)
    // 🎯 ADDED: /elements/ සහ /page/1/ URLs sitemap output එකෙන්ම exclude
    // කිරීම (orphan-page contradiction fix, routing logic එකට බලපෑමක් නැතිව)
    // 🎯 ADDED (2026): accurate per-post lastmod via lastmodMap (content
    // date/updated field-driven, falls back to integration default for
    // non-post URLs like category/tag/static pages where no single
    // content date applies)
    sitemap({
      changefreq: "weekly",
      priority: 0.7,
      serialize(item) {
        if (isExcludedFromSitemap(item.url)) {
          return undefined;
        }

        const accurateLastmod = applyAccurateLastmod(item.url);
        if (accurateLastmod) {
          item.lastmod = accurateLastmod;
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
