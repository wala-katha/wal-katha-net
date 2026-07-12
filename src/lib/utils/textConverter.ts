import { slug } from "github-slugger";
import { marked } from "marked";

// 1. Slugify (ලින්ක් සෑදීම සඳහා)
export const slugify = (content: string) => {
  if (!content || typeof content !== "string") return "";
  return slug(content);
};

// 1.1 ✅ NEW: sanitizeUrlPath — URL path segment එකක් (post id, slug, category
//     name ආදිය) href/id ලෙස පාවිච්චි කරන්න කලින් "safe" කිරීම සඳහා.
//     මෙය leading/trailing slashes, ඉරට්ටේ slashes (//), සහ අනවශ්‍ය
//     whitespace ඉවත් කරයි. FeaturedSlider.astro වගේ තැන්වල hardcoded
//     "id" values වලට trailing slash එකක් accidentally එකතු වුනොත්
//     (`"some-post/"`), href={`/blog/${slide.id}/`} කරනකොට double-slash
//     (`//`) හැදෙන එක මෙයින් සදහටම වළක්වයි — root-cause level fix එකක්.
export const sanitizeUrlPath = (content: string): string => {
  if (!content || typeof content !== "string") return "";
  return content
    .trim()
    .replace(/^\/+/, "")   // ආරම්භයේ ඇති slash(es) ඉවත් කිරීම
    .replace(/\/+$/, "")   // අවසානයේ ඇති slash(es) ඉවත් කිරීම
    .replace(/\/{2,}/g, "/"); // මැදින් ඇති ඉරට්ටේ slashes එකකට හැරවීම
};

// 1.2 ✅ NEW: buildUrl — base path එකකට segment එකක් "safe" විදිහට
//     ඈඳගැනීම සඳහා. හැම තැනකම trailing-slash convention එකම (config.json
//     trailing_slash: false → slash නැතුව) manual විදිහට enforce කරයි.
//     උදා: buildUrl("/blog", "some-post/") -> "/blog/some-post"
export const buildUrl = (base: string, segment: string): string => {
  const cleanBase = base.replace(/\/+$/, "");
  const cleanSegment = sanitizeUrlPath(segment);
  return `${cleanBase}/${cleanSegment}`;
};

// 2. Markdownify (Markdown සිට HTML දක්වා ආරක්ෂිතව පරිවර්තනය)
export const markdownify = (content: string, div?: boolean) => {
  if (!content || typeof content !== "string") return "";
  return div ? marked.parse(content) : marked.parseInline(content);
};

// 3. Humanize (පෙළ පිරිසිදු කර කියවිය හැකි ලෙස සකස් කිරීම)
export const humanize = (content: string) => {
  if (!content || typeof content !== "string") return "";
  return content
    .replace(/^[\s_]+|[\s_]+$/g, "")
    .replace(/[_\s]+/g, " ")
    .replace(/[-\s]+/g, " ")
    .replace(/^[a-z]/, function (m) {
      return m.toUpperCase();
    });
};

// 4. Titleify (සෑම වචනයකම මුල් අකුර කැපිටල් කර මාතෘකා සෑදීම)
export const titleify = (content: string) => {
  if (!content || typeof content !== "string") return "";
  const humanized = humanize(content);
  return humanized
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

// 5. Plainify (SEO විස්තර - Meta Description සඳහා HTML/Markdown සම්පූර්ණයෙන්ම අයින් කිරීම)
export const plainify = (content: string) => {
  if (!content || typeof content !== "string") return "";
  
  try {
    const parseMarkdown = marked.parse(content);
    // TypeScript දෝෂ මඟහරවා ගැනීමට string එකක් බව ස්ථිර කිරීම
    const markdownString = typeof parseMarkdown === "string" ? parseMarkdown : String(parseMarkdown);
    
    const filterBrackets = markdownString.replace(/<\/?[^>]+(>|$)/gm, "");
    const filterSpaces = filterBrackets.replace(/[\r\n]\s*[\r\n]/gm, "");
    const stripHTML = htmlEntityDecoder(filterSpaces);
    return stripHTML;
  } catch (error) {
    return content; // යම් හෙයකින් දෝෂයක් ආවොත් මුල් පෙළම ලබා දේ (Auto-Fix)
  }
};

// HTML Entities ආරක්ෂිතව ඉවත් කිරීමේ ශ්‍රිතය
const htmlEntityDecoder = (htmlWithEntities: string) => {
  if (!htmlWithEntities) return "";
  
  const entityList: { [key: string]: string } = {
    "&nbsp;": " ",
    "&lt;": "<",
    "&gt;": ">",
    "&amp;": "&",
    "&quot;": '"',
    "&#39;": "'",
  };
  
  return htmlWithEntities.replace(
    /(&amp;|&lt;|&gt;|&quot;|&#39;|&nbsp;)/g,
    (entity: string): string => {
      return entityList[entity] || entity;
    }
  );
};
