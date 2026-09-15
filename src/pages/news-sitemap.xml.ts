import type { APIContext } from "astro";
import { getSinglePage } from "@/lib/contentParser.astro";
import { sortByDate } from "@/lib/utils/sortFunctions";
import { withTrailingSlash } from "@/lib/utils/urlHelper";
import config from "@/config/config.json";

// GOOGLE NEWS SITEMAP - dedicated sitemap with the Google News
// namespace (<news:news>), separate from the @astrojs/sitemap output.
//
// Google News accepts URLs published within roughly the last 2 days.
// Posts older than that drop out automatically on the next build.
//
// 2026 FIX: previously this emitted a completely empty <urlset> when
// nothing was published in the last 48h, which surfaces in Google
// Search Console as a 0-URL / unreadable sitemap. A bounded fallback
// now emits the newest posts (capped at MAX_FALLBACK_POSTS) so the
// endpoint is never empty, while still respecting the recency intent.

const RECENT_WINDOW_HOURS = 48;
const MAX_FALLBACK_POSTS = 5;

function stripInvisibleChars(value: string): string {
  return value
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/[\u200E\u200F\u202A-\u202E]/g, "")
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

export async function GET(context: APIContext) {
  const posts = await getSinglePage("posts");
  const sortedPosts = sortByDate(posts || []);

  const base_url = (config?.site?.base_url || "").replace(/\/$/, "");
  const siteUrl = context.site?.toString().replace(/\/$/, "") ?? base_url;
  const publicationName = config?.site?.title || "Wal Katha";

  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - RECENT_WINDOW_HOURS);

  const datedPosts = sortedPosts.filter((post) => {
    if (!post.data.date) return false;
    const d = new Date(post.data.date);
    return !Number.isNaN(d.getTime());
  });

  const recentPosts = datedPosts.filter(
    (post) => new Date(post.data.date!) >= cutoff
  );

  // Never emit a fully empty urlset - fall back to the newest posts.
  const selectedPosts =
    recentPosts.length > 0
      ? recentPosts
      : datedPosts.slice(0, MAX_FALLBACK_POSTS);

  const urlEntries = selectedPosts
    .map((post) => {
      const postUrl = withTrailingSlash(`${siteUrl}/blog/${post.id}`);
      const pubDate = new Date(post.data.date!).toISOString();
      const title = escapeXml(stripInvisibleChars(post.data.title || ""));

      return `  <url>
    <loc>${escapeXml(postUrl)}</loc>
    <news:news>
      <news:publication>
        <news:name>${escapeXml(publicationName)}</news:name>
        <news:language>si</news:language>
      </news:publication>
      <news:publication_date>${pubDate}</news:publication_date>
      <news:title>${title}</news:title>
    </news:news>
  </url>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${urlEntries}
</urlset>`;

  return new Response(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=1800",
    },
  });
}
