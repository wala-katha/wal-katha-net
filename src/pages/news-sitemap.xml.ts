import type { APIContext } from "astro";
import { getSinglePage } from "@/lib/contentParser.astro";
import { sortByDate } from "@/lib/utils/sortFunctions";
import { withTrailingSlash } from "@/lib/utils/urlHelper";
import config from "@/config/config.json";

// 🎯 2026 GOOGLE NEWS SITEMAP — Standard @astrojs/sitemap output එකෙන්
// වෙනස්, Google News-specific XML namespace (<news:news>) සහිත
// dedicated sitemap එකකි.
//
// ⚠️ CRITICAL SPEC REQUIREMENT (Google News Sitemap Protocol):
// "Google News only accepts URLs published within the last 2 days"
// කියලා official Google Publisher documentation එකේම explicit ලෙස
// සඳහන් වේ. මේ නිසා මෙම endpoint එකෙන් සියලුම posts return කරන්නේ
// නැතුව, "date" field එක පසුගිය පැය 48ක් (2 days) ඇතුළත ඇති posts
// පමණක් filter කර ලබා දේ. පැරණි posts මෙම sitemap එකෙන් ස්වයංක්‍රීයව
// (automatic ලෙස, කිසිම manual පියවරක් නැතුව) ඉවත් වේ — මෙය
// self-healing design pattern එකකි: post එකක් publish වී දින 2ක්
// ගතවූ පසු, ඊළඟ build එකේදී එය automatic ලෙස මෙම sitemap එකෙන් අතුරුදහන්
// වන අතර, standard sitemap-index.xml (@astrojs/sitemap) එකේ එය
// ස්ථිරවම පවතී (එය Google News-specific නොවේ, සාමාන්‍ය search
// indexing සඳහා).
//
// ⚠️ NOTE: මෙම endpoint එක තනිවම Google News Top Stories carousel
// එකට qualify කරන්නේ නැත — Google News Publisher Center registration
// එකක් සහ content policy compliance එකක් අමතරව අවශ්‍ය වේ. මෙය
// technical infrastructure එක පමණි, එය සූදානම් කර තබයි.
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
  const publicationName = config?.site?.title || "Wala Katha";

  // Google News sitemap protocol — පසුගිය පැය 48ක් (2 days) ඇතුළත
  // publish වූ posts පමණක් filter කිරීම
  const twoDaysAgo = new Date();
  twoDaysAgo.setHours(twoDaysAgo.getHours() - 48);

  const recentPosts = sortedPosts.filter((post) => {
    if (!post.data.date) return false;
    const postDate = new Date(post.data.date);
    return postDate >= twoDaysAgo;
  });

  const urlEntries = recentPosts
    .map((post) => {
      const postUrl = withTrailingSlash(`${siteUrl}/blog/${post.id}`);
      const pubDate = new Date(post.data.date!).toISOString();
      const title = escapeXml(post.data.title || "");

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
    },
  });
}
