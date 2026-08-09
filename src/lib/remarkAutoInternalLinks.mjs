// Build-time remark plugin.
// Scans every post's body content for keyword matches (post titles,
// categories, tags, and custom "keywords" frontmatter synonyms) and
// automatically injects internal hyperlinks. Runs once per markdown/
// mdx file inside src/content/posts/ during the Astro build. Never
// touches files outside that directory, never breaks the build on
// failure (self-healing, wrapped in try/catch everywhere).
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import matter from "gray-matter";
import { slug as slugify } from "github-slugger";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../../");
const POSTS_DIR = path.join(PROJECT_ROOT, "src/content/posts");

// Tuning constants. Lowered from the original 8/6 thresholds so more
// real titles/tags become link-eligible, while still staying above a
// safe minimum to avoid linking on trivially short/common words.
const MIN_TITLE_KEYWORD_LENGTH = 6;
const MIN_TAXONOMY_KEYWORD_LENGTH = 4;
const MIN_KEYWORD_SYNONYM_LENGTH = 4;
// Below this length, only a full word-boundary match (both sides) is
// accepted. At or above this length, a prefix match (boundary before
// the match only) is also accepted, so suffix/plural variations of a
// keyword (e.g. singular tag matching a plural mention) still link.
// Lowered to 5 now that the word-boundary check below correctly
// treats Sinhala dependent vowel signs as word characters - a
// shorter safe threshold captures more natural Sinhala suffix forms
// without any loss of boundary accuracy.
const PREFIX_MATCH_MIN_LENGTH = 5;
// Safe upper bound on auto-injected links per post - keeps this
// feature from ever looking like a link scheme to Google.
const MAX_LINKS_PER_POST = 5;

// Node types whose children must never be entered/linkified.
// blockquote covers the copyright notice at the end of every post.
const SKIP_RECURSE_TYPES = new Set([
  "blockquote",
  "heading",
  "code",
  "inlineCode",
  "html",
  "image",
  "imageReference",
  "link",
  "linkReference",
  "yaml",
  "mdxJsxTextElement",
  "mdxJsxFlowElement",
  "mdxTextExpression",
  "mdxFlowExpression",
  "mdxjsEsm",
]);

// Word-character test. Includes:
//  - \p{L} (any Unicode letter, Latin and Sinhala consonants alike)
//  - \p{N} (any Unicode digit)
//  - \p{Mn} and \p{Mc} (Unicode Nonspacing Mark / Spacing Combining
//    Mark categories) - REQUIRED for correct Sinhala boundary
//    detection. Sinhala dependent vowel signs ("pilla", e.g. ා ි ු ෙ)
//    are Unicode category Mc/Mn, NOT category L. Without these two
//    categories included, isWordChar() would wrongly treat the
//    character right after a consonant - but before its own attached
//    vowel sign - as a word boundary, splitting a single Sinhala
//    syllable/word in half during matching.
// Declared once at module scope (not inside the function) so the
// RegExp object is created a single time for the whole build, rather
// than being re-evaluated on every character checked across every
// post - this removes redundant work from what is otherwise a very
// hot path during large-site builds.
const WORD_CHAR_REGEX = /[\p{L}\p{N}\p{Mn}\p{Mc}]/u;
function isWordChar(ch) {
  if (!ch) return false;
  return WORD_CHAR_REGEX.test(ch);
}

// Same humanize logic as src/lib/utils/textConverter.ts, kept local
// since this file runs as plain Node ESM (astro.config.mjs context),
// not through the Vite/TS pipeline.
function humanize(content) {
  if (!content || typeof content !== "string") return "";
  return content
    .replace(/^[\s_]+|[\s_]+$/g, "")
    .replace(/[_\s]+/g, " ")
    .replace(/[-\s]+/g, " ")
    .replace(/^[a-z]/, (m) => m.toUpperCase());
}

function loadPostsMeta() {
  const posts = [];
  try {
    if (!fs.existsSync(POSTS_DIR)) return posts;
    for (const file of fs.readdirSync(POSTS_DIR)) {
      if (!/\.(md|mdx)$/i.test(file)) continue;
      if (file.startsWith("-")) continue;
      const fullPath = path.join(POSTS_DIR, file);
      try {
        const raw = fs.readFileSync(fullPath, "utf-8");
        const parsed = matter(raw);
        const data = parsed.data || {};
        if (data.draft === true) continue;
        posts.push({
          slug: file.replace(/\.[^.]+$/, ""),
          title: typeof data.title === "string" ? data.title.trim() : "",
          categories: Array.isArray(data.categories) ? data.categories : [],
          tags: Array.isArray(data.tags) ? data.tags : [],
          // Optional synonym list in frontmatter, e.g.:
          //   keywords: ["වචනය 1", "වචනය 2"]
          // Each entry links back to THIS post, same as its title
          // does, giving extra natural-language link opportunities
          // without needing an exact title/tag match.
          keywords: Array.isArray(data.keywords) ? data.keywords : [],
        });
      } catch {
        continue;
      }
    }
  } catch {
    return [];
  }
  return posts;
}

// Adds one taxonomy entry (category or tag) to the index. Pushes BOTH
// the raw, trimmed frontmatter value AND its humanize()-transformed
// display label as separate candidate keywords, when they differ.
// Rationale: humanize() only capitalizes the first Latin a-z letter
// and swaps dashes/underscores for spaces - it does not, and cannot,
// corrupt Sinhala Unicode text (Sinhala falls outside the a-z regex
// range entirely). The real reason taxonomy links were rarely landing
// is that post body text (natural Sinhala prose) almost never
// contains the humanized Latin-style label verbatim (e.g.
// "Family wala katha"). Indexing the raw slug-like value too gives a
// second, independent chance to match whatever form actually appears
// in a post's text, without ever weakening or bypassing the existing
// boundary-safety checks.
function pushTaxonomyEntries(entries, seenSlugs, rawValue, urlPrefix, targetPrefix) {
  const s = slugify(String(rawValue || ""));
  if (!s || seenSlugs.has(s)) return;
  seenSlugs.add(s);

  const targetKey = `${targetPrefix}:${s}`;
  const url = `${urlPrefix}/${s}/`;

  const trimmedRaw = String(rawValue || "").trim();
  const humanizedLabel = humanize(String(rawValue || ""));

  if (trimmedRaw.length >= MIN_TAXONOMY_KEYWORD_LENGTH) {
    entries.push({ keyword: trimmedRaw, url, targetKey });
  }
  if (
    humanizedLabel &&
    humanizedLabel.length >= MIN_TAXONOMY_KEYWORD_LENGTH &&
    humanizedLabel.toLowerCase() !== trimmedRaw.toLowerCase()
  ) {
    entries.push({ keyword: humanizedLabel, url, targetKey });
  }
}

function buildLinkIndex() {
  const posts = loadPostsMeta();
  const entries = [];

  // Title-based entries: post-to-post links.
  for (const post of posts) {
    if (post.title.length >= MIN_TITLE_KEYWORD_LENGTH) {
      entries.push({
        keyword: post.title,
        url: `/blog/${post.slug}/`,
        targetKey: `post:${post.slug}`,
      });
    }
    // Custom synonym keywords also point at this same post.
    for (const raw of post.keywords) {
      const kw = String(raw || "").trim();
      if (kw.length < MIN_KEYWORD_SYNONYM_LENGTH) continue;
      entries.push({
        keyword: kw,
        url: `/blog/${post.slug}/`,
        targetKey: `post:${post.slug}`,
      });
    }
  }

  // Category-based entries: link to the category archive page.
  const seenCategories = new Set();
  for (const post of posts) {
    for (const raw of post.categories) {
      pushTaxonomyEntries(entries, seenCategories, raw, "/categories", "category");
    }
  }

  // Tag-based entries: link to the tag archive page.
  const seenTags = new Set();
  for (const post of posts) {
    for (const raw of post.tags) {
      pushTaxonomyEntries(entries, seenTags, raw, "/tags", "tag");
    }
  }

  // Longest keyword first, so specific phrases win over short ones,
  // and de-duplicate identical (keyword,url) pairs that could arise
  // from title/keywords/raw-vs-humanized overlap.
  const seenPairs = new Set();
  const deduped = [];
  for (const e of entries.sort((a, b) => b.keyword.length - a.keyword.length)) {
    const pairKey = `${e.keyword.toLowerCase()}::${e.url}`;
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);
    deduped.push(e);
  }
  return deduped;
}

let cachedEntries = null;
function getEntries() {
  if (cachedEntries === null) {
    cachedEntries = buildLinkIndex();
  }
  return cachedEntries;
}

// Finds the first valid, boundary-safe occurrence of keyword inside
// value starting the scan at fromIndex. Returns { start, end } (end
// is exclusive) or null. A match is valid when:
//  - the character immediately before it is not a word character
//    (start boundary always required), AND
//  - EITHER the character immediately after the raw keyword span is
//    not a word character (a full, exact-word match, end === raw
//    match end), OR the keyword itself is long enough
//    (>= PREFIX_MATCH_MIN_LENGTH) to allow a prefix match - in that
//    case "end" is extended forward past any trailing word
//    characters (including Sinhala combining vowel signs, now
//    correctly recognized by isWordChar), so the ENTIRE natural word
//    becomes the anchor text instead of leaving a dangling, unlinked
//    suffix fragment right after the link.
function findBoundarySafeMatch(value, lowerValue, lowerKeyword, fromIndex) {
  let searchFrom = fromIndex;
  while (searchFrom <= lowerValue.length - lowerKeyword.length) {
    const idx = lowerValue.indexOf(lowerKeyword, searchFrom);
    if (idx === -1) return null;

    const beforeChar = value[idx - 1];
    const rawEnd = idx + lowerKeyword.length;
    const afterChar = value[rawEnd];
    const startOk = !isWordChar(beforeChar);
    const exactEndOk = !isWordChar(afterChar);
    const prefixOk = lowerKeyword.length >= PREFIX_MATCH_MIN_LENGTH;

    if (startOk && exactEndOk) {
      return { start: idx, end: rawEnd };
    }
    if (startOk && prefixOk && afterChar) {
      // Extend forward to consume the rest of the word (including any
      // trailing Sinhala combining vowel signs) so the full natural
      // token is linked, not just the matched prefix.
      let extendedEnd = rawEnd;
      while (extendedEnd < value.length && isWordChar(value[extendedEnd])) {
        extendedEnd += 1;
      }
      return { start: idx, end: extendedEnd };
    }
    searchFrom = idx + 1;
  }
  return null;
}

// Defensive, forward-compatible skip check: covers every explicitly
// known non-linkable node type (SKIP_RECURSE_TYPES), plus any
// currently-unknown MDX-family node type by prefix. MDX-related node
// types (JSX elements, expressions, ESM imports/exports) carry their
// element attributes in a separate "attributes" property that is
// never part of "children" in the first place, so this check was
// already safe against attribute corruption - this addition purely
// future-proofs against new MDX node type names appearing in a
// future mdast-util-mdx-jsx version without needing a manual update
// to SKIP_RECURSE_TYPES here.
function isSkippableNodeType(type) {
  if (SKIP_RECURSE_TYPES.has(type)) return true;
  return typeof type === "string" && type.startsWith("mdx");
}

function linkifyTextNode(node, context) {
  const value = node.value;
  if (!value || typeof value !== "string" || !value.trim()) {
    return [node];
  }
  if (context.linkCounter.count >= MAX_LINKS_PER_POST) {
    return [node];
  }

  const lowerValue = value.toLowerCase();

  for (const entry of context.entries) {
    if (context.linkCounter.count >= MAX_LINKS_PER_POST) break;
    if (entry.targetKey === `post:${context.currentSlug}`) continue;
    if (context.usedTargets.has(entry.targetKey)) continue;

    const lowerKeyword = entry.keyword.toLowerCase();
    if (!lowerKeyword) continue;

    const match = findBoundarySafeMatch(value, lowerValue, lowerKeyword, 0);
    if (!match) continue;

    const before = value.slice(0, match.start);
    const matched = value.slice(match.start, match.end);
    const after = value.slice(match.end);

    context.usedTargets.add(entry.targetKey);
    context.linkCounter.count += 1;

    const nodes = [];
    if (before) nodes.push({ type: "text", value: before });
    nodes.push({
      type: "link",
      url: entry.url,
      title: null,
      children: [{ type: "text", value: matched }],
    });
    if (after) {
      nodes.push(...linkifyTextNode({ type: "text", value: after }, context));
    }
    return nodes;
  }

  return [node];
}

function processChildren(children, context) {
  if (!Array.isArray(children)) return children;
  const result = [];
  for (const node of children) {
    if (!node) continue;
    if (node.type === "text") {
      result.push(...linkifyTextNode(node, context));
    } else if (isSkippableNodeType(node.type)) {
      result.push(node);
    } else if (Array.isArray(node.children)) {
      node.children = processChildren(node.children, context);
      result.push(node);
    } else {
      result.push(node);
    }
  }
  return result;
}

export default function remarkAutoInternalLinks() {
  const entries = getEntries();

  return (tree, file) => {
    try {
      if (!entries.length) return;

      const rawPath =
        (file && file.path) ||
        (file && Array.isArray(file.history) ? file.history[0] : "") ||
        "";
      const filePath = String(rawPath).replace(/\\/g, "/");
      if (!filePath.includes("/content/posts/")) return;

      const baseName = filePath.split("/").pop() || "";
      if (!baseName || baseName.startsWith("-")) return;

      const currentSlug = baseName.replace(/\.[^.]+$/, "");

      const context = {
        entries,
        currentSlug,
        usedTargets: new Set(),
        linkCounter: { count: 0 },
      };

      if (Array.isArray(tree.children)) {
        tree.children = processChildren(tree.children, context);
      }
    } catch (err) {
      console.warn("remarkAutoInternalLinks skipped for a file:", err && err.message);
    }
  };
}
