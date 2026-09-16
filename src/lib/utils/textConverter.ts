import { slug } from "github-slugger";
import { marked } from "marked";

// Invisible characters that leak in from editors (zero-width space/joiner,
// BOM, bidi marks, non-breaking space). They break URLs, slugs and meta text.
const INVISIBLE_CHARS_RE = /[\u200B-\u200D\uFEFF\u200E\u200F\u202A-\u202E\u2060]/g;

// Strip invisible chars and normalise NBSP to a real space.
const stripInvisible = (content: string): string =>
  content.replace(INVISIBLE_CHARS_RE, "").replace(/\u00A0/g, " ");

// Collapse every whitespace run (incl. newlines/tabs) into one space, then trim.
// This is what keeps trailing "\n" from marked out of <title> and <meta>.
const collapseWhitespace = (content: string): string =>
  content.replace(/\s+/g, " ").trim();

// 1. Slugify
export const slugify = (content: string) => {
  if (!content || typeof content !== "string") return "";
  return slug(stripInvisible(content));
};

// 1.1 sanitizeUrlPath - make a path segment safe before use in href/id.
// Removes leading/trailing slashes, collapses duplicate slashes, strips
// invisible chars so a pasted zero-width space cannot 404 a URL.
export const sanitizeUrlPath = (content: string): string => {
  if (!content || typeof content !== "string") return "";
  return stripInvisible(content)
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\/{2,}/g, "/");
};

// 1.2 buildUrl - join a base path and a segment safely.
// Returns the path WITHOUT a trailing slash; callers append one where the
// site's trailing-slash convention requires it.
export const buildUrl = (base: string, segment: string): string => {
  const cleanBase = stripInvisible(base).replace(/\/+$/, "");
  const cleanSegment = sanitizeUrlPath(segment);
  return cleanSegment ? `${cleanBase}/${cleanSegment}` : cleanBase;
};

// 2. Markdownify - Markdown to HTML.
export const markdownify = (content: string, div?: boolean) => {
  if (!content || typeof content !== "string") return "";
  return div ? marked.parse(content) : marked.parseInline(content);
};

// 3. Humanize - readable label from a slug or raw key.
export const humanize = (content: string) => {
  if (!content || typeof content !== "string") return "";
  return stripInvisible(content)
    .replace(/^[\s_]+|[\s_]+$/g, "")
    .replace(/[_\s]+/g, " ")
    .replace(/[-\s]+/g, " ")
    .replace(/^[a-z]/, function (m) {
      return m.toUpperCase();
    })
    .trim();
};

// 4. Titleify
export const titleify = (content: string) => {
  if (!content || typeof content !== "string") return "";
  const humanized = humanize(content);
  return humanized
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

// HTML entity decoding. Named entities first, then numeric (decimal and hex),
// so smart quotes and dashes never reach SERP output as raw "&#8217;".
const NAMED_ENTITIES: { [key: string]: string } = {
  "&nbsp;": " ",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#39;": "'",
  "&amp;": "&",
};

const htmlEntityDecoder = (htmlWithEntities: string) => {
  if (!htmlWithEntities) return "";

  // Single pass over the named set: alternation prevents "&amp;lt;" from
  // being double-decoded into "<".
  const named = htmlWithEntities.replace(
    /&(?:nbsp|lt|gt|quot|apos|amp|#39);/g,
    (entity: string): string => NAMED_ENTITIES[entity] || entity
  );

  // Numeric entities: decimal (&#8217;) and hex (&#x2019;).
  return named.replace(
    /&#(x[0-9a-fA-F]+|\d+);/g,
    (match: string, code: string): string => {
      const point = code.toLowerCase().startsWith("x")
        ? parseInt(code.slice(1), 16)
        : parseInt(code, 10);
      if (!Number.isFinite(point) || point < 1 || point > 0x10ffff) return match;
      try {
        return String.fromCodePoint(point);
      } catch (error) {
        return match;
      }
    }
  );
};

// 5. Plainify - plain text for <title> and <meta name="description">.
// marked.parse() wraps output in <p>...</p> plus a trailing newline. The old
// blank-line regex could not match a single trailing "\n", so it leaked into
// <title>. collapseWhitespace() removes it and normalises every inner
// newline/tab/double-space into one clean space.
export const plainify = (content: string) => {
  if (!content || typeof content !== "string") return "";

  try {
    const parsed = marked.parse(content);
    const markdownString = typeof parsed === "string" ? parsed : String(parsed);

    // Drop script/style bodies outright, then remove remaining tags.
    const withoutRisky = markdownString
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "");

    const withoutTags = withoutRisky.replace(/<\/?[^>]+(>|$)/gm, " ");
    const decoded = htmlEntityDecoder(withoutTags);

    return collapseWhitespace(stripInvisible(decoded));
  } catch (error) {
    return collapseWhitespace(stripInvisible(content));
  }
};
