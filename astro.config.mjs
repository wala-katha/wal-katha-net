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
// 🎯 SEO — CRAWL BUDGET OPTIMIZATION: "/bookmarks" එකතු කරන ලද්දේ,
// එය user-specific/localStorage-driven content එකක් ලෙස Base.astro
// එකේදීම "noindex={true}" ලෙස flag කර ඇති නිසාය (see
// src/pages/bookmarks.astro). noindex දාපු පිටුවක් sitemap.xml එකේ
// listed කිරීම crawl budget එකේ අනවශ්‍ය waste එකක් — Google ම
// documentation එකේම "noindex pages should not be listed in your
// sitemap" කියලා recommend කරනවා. මෙය main content (posts, categories,
// tags, authors) indexing එකට කිසිම බලපෑමක් කරන්නේ නැත — ඒවා සියල්ලම
// සාමාන්‍ය පරිදිම indexed වේ.
//
// ⚠️ IMPORTANT: robots.txt එකට "/bookmarks" Disallow rule එකක් INTENTIONALLY
// එකතු කර නැත. robots.txt disallow කළොත් Googlebot ට එම පිටුවම crawl
// කරන්නවත් බැහැ — ඒ කියන්නේ එයාට "noindex" meta tag එකවත් දකින්න
// බැහැ, ඒක නිසා URL එක search results වල (snippet එකක් නැතුව) පේන්න
// පුළුවන් "Indexed, though blocked by robots.txt" කියන known SEO
// anti-pattern එකක් හැදෙන්න පුළුවන්. noindex meta tag එකම (Base.astro
// හරහා) නිවැරදිම ක්‍රමය — Google එයට page එක crawl කරන්න ඉඩදීලා,
// noindex directive එක දැක්කම index කරන්නේ නැතුව ඉවත් කරනවා.
const EXCLUDED_SITEMAP_PATHS = ["/elements", "/page/1", "/bookmarks"];
function isExcludedFromSitemap(url) {
  const path = url.replace(/^https?:\/\/[^/]+/, "").replace(/\/$/, "");
  return EXCLUDED_SITEMAP_PATHS.includes(path);
}
export default defineConfig({
  site: config.site.base_url ? config.site.base_url : "https://www.walakatha.net",
  base: config.site.base_path ? config.site.base_path : "/",
  trailingSlash: config.site.trailing_slash ? "always" : "never",
  build: {
    format: "directory",
  },
  compressHTML: true,
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
