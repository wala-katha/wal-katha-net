import mdx from "@astrojs/mdx";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import AutoImport from "astro-auto-import";
import gtm from "astro-gtm-lite";
import { defineConfig, fontProviders, sharpImageService } from "astro/config";
import config from "./src/config/config.json";
import theme from "./src/config/theme.json";
import remarkAutoInternalLinks from "./src/lib/remarkAutoInternalLinks.mjs";
import redirectFixer from "./src/integrations/redirect-fixer.mjs";
import earlyHintsPreload from "./src/integrations/early-hints-preload.mjs";
import criticalCssInline from "./src/integrations/critical-css-inline.mjs";
// ==========================================================
// GIT-COMMIT-BASED REAL-TIME LASTMOD SYSTEM
// ==========================================================
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { slug as githubSlug } from "github-slugger";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = path.join(__dirname, "src/content");
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
      if (file.startsWith("-")) continue;
      postsFileListCache.push(path.join(dir, file));
    }
  } catch {
    postsFileListCache = [];
  }
  return postsFileListCache;
}
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
      // skip unreadable file
    }
  }
  const result = latest || getSiteWideLastMod();
  taxonomyLastModCache.set(cacheKey, result);
  return result;
}
function resolveLastModForUrl(pathname) {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return getSiteWideLastMod();
  const EXCLUDED_FIRST_SEGMENTS = ["categories", "tags", "page", "search", "blog", "authors", "about", "contact"];
  if (segments[0] === "blog" && segments[1]) {
    const f = findContentFile(path.join(CONTENT_DIR, "posts"), segments[1]);
    if (f) {
      const d = getGitLastMod(f);
      if (d) return d;
    }
    return getSiteWideLastMod();
  }
  if (segments[0] === "authors" && segments[1] && segments[1] !== "page") {
    const f = findContentFile(path.join(CONTENT_DIR, "authors"), segments[1]);
    if (f) {
      const d = getGitLastMod(f);
      if (d) return d;
    }
    return getSiteWideLastMod();
  }
  if (segments[0] === "about") {
    const d = getGitLastMod(path.join(CONTENT_DIR, "about", "-index.md"));
    return d || getSiteWideLastMod();
  }
  if (segments[0] === "contact") {
    const d = getGitLastMod(path.join(CONTENT_DIR, "contact", "-index.md"));
    return d || getSiteWideLastMod();
  }
  if (segments[0] === "categories" && segments[1] && segments[1] !== "page") {
    return getTaxonomyLastMod("categories", segments[1]);
  }
  if (segments[0] === "tags" && segments[1] && segments[1] !== "page") {
    return getTaxonomyLastMod("tags", segments[1]);
  }
  if (segments.length === 1 && !EXCLUDED_FIRST_SEGMENTS.includes(segments[0])) {
    const f = findContentFile(path.join(CONTENT_DIR, "pages"), segments[0]);
    if (f) {
      const d = getGitLastMod(f);
      if (d) return d;
    }
  }
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
  trailingSlash: config.site.trailing_slash ? "always" : "never",
  // ==========================================================
  // CRITICAL CSS STRATEGY (2026-08 UPDATE): switched from
  // inlineStylesheets: "always" (which inlined the ENTIRE ~19.6 KiB
  // compiled CSS bundle into every page, bloating HTML page size and
  // failing the "HTML Page Size Test") to "never" - CSS now stays as
  // a real external stylesheet link in the built HTML. The
  // criticalCssInline() integration below (astro:build:done hook,
  // powered by Beasties) then post-processes every built HTML file:
  // it extracts ONLY the real, page-specific above-the-fold CSS and
  // inlines that (a few KB, not the whole 19.6 KiB bundle), and loads
  // the remaining CSS non-blocking via rel="preload" + onload swap
  // (with a <noscript> fallback) - so first paint is never blocked by
  // an external stylesheet request (solving the original
  // render-blocking-requests problem "always" was added for) while
  // keeping HTML page size small (solving the page-size problem
  // "auto" was later added for, without reintroducing the render
  // block "auto" caused since this bundle exceeds its 4 KB inline
  // threshold).
  // ==========================================================
  build: {
    format: "directory",
    inlineStylesheets: "never",
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
    redirectFixer(),
    earlyHintsPreload(),
    // Critical CSS extraction + inlining (Beasties) - runs LAST so it
    // processes the fully-built HTML/CSS output from every prior step
    // (including earlyHintsPreload's own dist/_headers additions,
    // which it does not touch since it only rewrites .html files).
    criticalCssInline(),
    sitemap({
      changefreq: "weekly",
      priority: 0.7,
      serialize(item) {
        if (isExcludedFromSitemap(item.url)) {
          return undefined;
        }
        item.url = ensureSitemapTrailingSlash(item.url);
        try {
          const urlObj = new URL(item.url);
          const lastmod = resolveLastModForUrl(urlObj.pathname);
          if (lastmod) item.lastmod = lastmod;
        } catch {
          // leave lastmod unset for this URL only
        }
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
    remarkPlugins: [remarkAutoInternalLinks],
    shikiConfig: { theme: "one-dark-pro", wrap: true },
  },
});
