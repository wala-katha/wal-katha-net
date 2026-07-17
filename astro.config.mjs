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

export default defineConfig({
  // 🎯 100% Dynamic Base URL Fetching from config.json
  site: config.site.base_url ? config.site.base_url : "https://www.walakatha.net",
  base: config.site.base_path ? config.site.base_path : "/",
  trailingSlash: config.site.trailing_slash ? "always" : "never",

  image: {
    service: sharpImageService(),
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
