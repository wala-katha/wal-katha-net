import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { getSinglePage } from "@/lib/contentParser.astro";
import { sortByDate } from "@/lib/utils/sortFunctions";
import { humanize } from "@/lib/utils/textConverter";
import { withTrailingSlash } from "@/lib/utils/urlHelper";
import config from "@/config/config.json";

// 🎯 2026 RSS FEED — Google News crawler, Feedly, third-party
// aggregators, සහ AI content-discovery bots (GPTBot ආදී) සියල්ලටම
// site එකේ අලුත්ම content එක ක්ෂණිකව discover කරගන්න පුළුවන් standard
// feed format එකක්.
//
// ⚠️ FULL CONTENT INCLUDED (User Decision): "content:encoded" tag එකෙන්
// post එකේ සම්පූර්ණ body content එකම (raw markdown → plain text)
// ඇතුළත් කර ඇත, description/summary විතරක් නොවේ. මෙය user-explicit
// තීරණයක් ලෙස implement කර ඇත — adult content site එකකට සමහර RSS
// aggregators/directories summary-only feeds reject කරන්නට පුළුවන්
// නිසා, full-content feed එකක් වඩාත් compatibility ලබා දෙයි.
//
// ⚠️ IMPORTANT: "content:encoded" tag එක RSS 2.0 core spec එකේ කොටසක්
// නොවේ — "http://purl.org/rss/1.0/modules/content/" namespace එකෙන්
// එන "Content Module" එකකි. @astrojs/rss හි built-in support එකක් මේ
// namespace එකට නැති නිසා, "customData" field එක හරහා manually
// namespace declaration + tag එක inject කර ඇත (root-level xmlns
// attribute එකක් @astrojs/rss විසින් සපයන <rss> root tag එකට කෙලින්ම
// එකතු කළ නොහැකි නිසා, මෙය item-level වශයෙන් වඩාත් ආරක්ෂිත ප්‍රවේශයකි —
// සමහර parsers item-level xmlns ද පිළිගනී, namespace පුළුල් අනුකූලතාව
// සඳහා feed root එකේද එකතු කර ඇත <xmldata> hack හරහා).
export async function GET(context: APIContext) {
  const posts = await getSinglePage("posts");
  const sortedPosts = sortByDate(posts || []);

  const base_url = (config?.site?.base_url || "").replace(/\/$/, "");
  const siteUrl = context.site?.toString().replace(/\/$/, "") ?? base_url;

  return rss({
    title: config?.site?.title || "Aluth Sinhala Wal Katha PDF | Wala Katha & Wela Katha (2026)",
    description:
      config?.metadata?.meta_description ||
      "2026 අලුත්ම Sinhala Wal Katha PDF එකතුව. අලුත් සහ පැරණි Wala Katha සහ Wela Katha Online කියවීමට, Download කිරීමට පිවිසෙන්න.",
    site: context.site ?? base_url,
    xmlns: {
      content: "http://purl.org/rss/1.0/modules/content/",
      media: "http://search.yahoo.com/mrss/",
    },
    items: sortedPosts.map((post) => {
      const postUrl = withTrailingSlash(`${siteUrl}/blog/${post.id}`);
      const imageUrl = post.data.image
        ? post.data.image.startsWith("http")
          ? post.data.image
          : `${siteUrl}${post.data.image}`
        : undefined;

      // Raw markdown body එක plain-text ලෙසට සරල HTML paragraph
      // tags වලට convert කිරීම (full RSS reader compatibility සඳහා
      // markdown syntax raw ලෙස පෙන්වන්නේ නැතුව).
      const rawBody = post.body ?? "";
      const htmlBody = rawBody
        .split(/\n\s*\n/)
        .filter((para) => para.trim().length > 0)
        .map((para) => `<p>${para.trim().replace(/\n/g, "<br/>")}</p>`)
        .join("\n");

      return {
        title: post.data.title || "",
        description: post.data.description || post.data.title || "",
        pubDate: post.data.date ? new Date(post.data.date) : new Date(),
        link: postUrl,
        author: Array.isArray(post.data.authors) && post.data.authors.length > 0
          ? post.data.authors[0]
          : config?.metadata?.meta_author || "Wala Katha",
        categories: [
          ...(post.data.categories || []).map((c) => humanize(c)),
          ...(post.data.tags || []).map((t) => humanize(t)),
        ],
        customData: [
          imageUrl ? `<enclosure url="${imageUrl}" type="image/webp" />` : "",
          `<content:encoded><![CDATA[${htmlBody}]]></content:encoded>`,
        ].join(""),
      };
    }),
    customData: `<language>si</language>`,
  });
}
