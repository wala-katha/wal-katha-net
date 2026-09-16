import type { APIContext } from "astro";
import { getSinglePage } from "@/lib/contentParser.astro";
import { sortByDate } from "@/lib/utils/sortFunctions";
import { withTrailingSlash } from "@/lib/utils/urlHelper";
import config from "@/config/config.json";

// GOOGLE NEWS SITEMAP - dedicated sitemap carrying the Google News
// namespace (<news:news>), separate from the @astrojs/sitemap output.
//
// Google News only accepts URLs published within roughly the last 2 days.
// Anything older is ignored by the News crawler.
//
// 2026-09 FIX: the previous MAX_FALLBACK_POSTS=5 fallback emitted the 5
// newest posts *regardless of age* whenever nothing was published in the
// last 48h. Because the newest post here is dated 2026-08-07, the live
// sitemap was serving articles ~40 days old inside <news:news> blocks.
// Google Publisher Center treats that as a stale/invalid news feed.
//
// New behaviour is a two-tier, age-capped selection:
//   Tier 1 - everything published inside RECENT_WINDOW_HOURS (the spec).
//   Tier 2 - if tier 1 is empty, the newest posts that are still inside
//            FALLBACK_MAX_AGE_DAYS, capped at FALLBACK_MAX_POSTS.
//   Neither - emit a valid but empty <urlset>.
// An empty urlset is valid XML and only produces an informational note
// in Search Console. Serving 40-day-old "news" is strictly worse.

const RECENT_WINDOW_HOURS = 48;
const FALLBACK_MAX_AGE_DAYS = 7;
const FALLBACK_MAX_POSTS = 3;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function stripInvisibleChars(value: string): string {
  return value
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/[\u200E\u200F\u202A-\u202E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toTime(value: unknown): number | null {
  if (!value) return null;
  const d = new Date(value as string | number | Date);
  const t = d.getTime();
  if (Number.isNaN(t)) return null;
  const year = d.getUTCFullYear();
  if (year < 1990 || year > 2100) return null;
  return t;
}

export async function GET(context: APIContext) {
  const posts = await getSinglePage("posts");
  const sortedPosts = sortByDate(posts || []);

  const base_url = (config?.site?.base_url || "").replace(/\/$/, "");
  const siteUrl = context.site?.toString().replace(/\/$/, "") ?? base_url;
  const publicationName = config?.site?.title || "Wal Katha";
  const language = config?.settings?.default_language || "si";

  const now = Date.now();
  const recentCutoff = now - RECENT_WINDOW_HOURS * HOUR_MS;
  const fallbackCutoff = now - FALLBACK_MAX_AGE_DAYS * DAY_MS;

  // Normalise once: keep only posts with a usable publication date, and
  // drop anything dated in the future (a common frontmatter typo).
  const datedPosts = sortedPosts
    .map((post) => ({ post, time: toTime(post.data.date) }))
    .filter(
      (entry): entry is { post: (typeof sortedPosts)[number]; time: number } =>
        entry.time !== null && entry.time <= now
    );

  const recentPosts = datedPosts.filter((entry) => entry.time >= recentCutoff);

  const selectedPosts =
    recentPosts.length > 0
      ? recentPosts
      : datedPosts
          .filter((entry) => entry.time >= fallbackCutoff)
          .slice(0, FALLBACK_MAX_POSTS);

  const urlEntries = selectedPosts
    .map(({ post, time }) => {
      const postUrl = withTrailingSlash(`${siteUrl}/blog/${post.id}`);
      const pubDate = new Date(time).toISOString();
      const title = escapeXml(stripInvisibleChars(post.data.title || ""));

      return `  <url>
    <loc>${escapeXml(postUrl)}</loc>
    <news:news>
      <news:publication>
        <news:name>${escapeXml(publicationName)}</news:name>
        <news:language>${escapeXml(language)}</news:language>
      </news:publication>
      <news:publication_date>${pubDate}</news:publication_date>
      <news:title>${title}</news:title>
    </news:news>
  </url>`;
    })
    .join("\n");

  // Keep the body tight when there is nothing to report - no stray blank
  // line between <urlset> and </urlset>.
  const body = urlEntries ? `\n${urlEntries}\n` : "\n";

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">${body}</urlset>`;

  return new Response(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=1800",
    },
  });
}
