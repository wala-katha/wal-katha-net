import { existsSync, readFileSync, readdirSync, appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

const MAX_POSTS_FOR_HEADERS = 80;

function normalizeImagePath(image) {
  if (!image) return "";
  return image.startsWith("/") ? image : `/${image}`;
}

function readEligiblePosts(postsDir) {
  const posts = [];
  if (!existsSync(postsDir)) return posts;
  for (const file of readdirSync(postsDir)) {
    if (!/\.(md|mdx)$/i.test(file)) continue;
    if (file.startsWith("-")) continue;
    try {
      const raw = readFileSync(path.join(postsDir, file), "utf-8");
      const parsed = matter(raw);
      const data = parsed.data || {};
      if (data.draft === true) continue;
      const image = normalizeImagePath(typeof data.image === "string" ? data.image.trim() : "");
      if (!image) continue;
      const slug = file.replace(/\.[^.]+$/, "");
      const date = data.date ? new Date(data.date) : null;
      posts.push({
        slug,
        image,
        dateValue: date && !isNaN(date.getTime()) ? date.getTime() : 0,
      });
    } catch {
      continue;
    }
  }
  return posts;
}

// Astro integration: after the static build finishes, append per-post
// hero-image Link/preload header rules to dist/_headers. Cloudflare
// Pages replays these as HTTP 103 Early Hints once the "Early Hints"
// toggle is enabled on the zone (Speed > Optimization). Self-healing -
// wrapped so a failure here can never break the site build.
export default function earlyHintsPreload() {
  return {
    name: "early-hints-preload",
    hooks: {
      "astro:build:done": async ({ dir, logger }) => {
        try {
          const projectRoot = process.cwd();
          const postsDir = path.join(projectRoot, "src/content/posts");
          const outDir = fileURLToPath(dir);
          const headersPath = path.join(outDir, "_headers");

          const posts = readEligiblePosts(postsDir)
            .sort((a, b) => b.dateValue - a.dateValue)
            .slice(0, MAX_POSTS_FOR_HEADERS);

          if (posts.length === 0) {
            logger.info("early-hints-preload: no eligible posts found, skipping.");
            return;
          }

          if (!existsSync(headersPath)) {
            logger.warn("early-hints-preload: dist/_headers not found, skipping (public/_headers missing?).");
            return;
          }

          const blocks = posts
            .map((p) => `/blog/${p.slug}/\n  Link: <${p.image}>; rel=preload; as=image`)
            .join("\n\n");

          const section = [
            "",
            "## AUTO-GENERATED-EARLY-HINTS-START (early-hints-preload integration - do not edit manually)",
            "# Per-post hero-image preload Link headers, regenerated fresh on every",
            "# build. Cloudflare replays these as HTTP 103 Early Hints once",
            "# Speed > Optimization > Early Hints is enabled on the zone.",
            blocks,
            "## AUTO-GENERATED-EARLY-HINTS-END",
            "",
          ].join("\n");

          appendFileSync(headersPath, section, "utf-8");
          logger.info(`early-hints-preload: added Link preload headers for ${posts.length} post(s).`);
        } catch (err) {
          console.warn("early-hints-preload integration skipped due to an error:", err && err.message);
        }
      },
    },
  };
}
