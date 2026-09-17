#!/usr/bin/env node
/**
 * AI image alt-text generator (Gemini Vision) - v3
 *
 * ==================================================================
 * v3 හි මූලික දර්ශනය වෙනස් වුණා. කියවන්න.
 * ==================================================================
 *
 * v1/v2 හි වැරැද්ද: seed keyword එක alt text එකේ මුලට FORCE කළා
 * (" <seed> - <alt>"). ඒක Google ගේ image SEO guidance එකට
 * කෙළින්ම විරුද්ධයි - alt text එකෙන් image එකේ ඇති දේ describe කළ
 * යුතුයි, keywords ලැයිස්තුවක් නොවේ. හැම image එකකම එකම template
 * එක repeat වීම machine-generated footprint එකක්, සහ PR #64 එකේ
 * "sex katha - sex katha - ..." වගේ keyword stuffing හැදුණා.
 *
 * v3: seed එක CONTEXT එකක් විතරයි. Model එක image එක describe
 * කරනවා; keyword එක ස්වභාවිකව ගැළපෙනවා නම් පමණක් ඇතුළු වෙනවා.
 * Prefix force කිරීමක් නෑ.
 *
 * v3 හි වෙනස්කම්:
 *  1. NO SEED PREPEND - "!out.includes(seed) -> prepend" logic එක
 *     සම්පූර්ණයෙන් ඉවත් කළා. ඒක තමයි duplicate seed හැදුවේ.
 *  2. NO MECHANICAL FALLBACK - fallbackAlt() ඉවත් කළා. Model එක
 *     fail/refuse වුණොත් image එක SKIP වෙනවා. Alt text නැති
 *     image එකක්, stuffed alt text එකක් තියෙන එකකට වඩා හොඳයි.
 *  3. OPENING-PHRASE DEDUPE - සම්පූර්ණ string එකට අමතරව, පළමු
 *     වචන 4 ද unique විය යුතුයි. දෙකක් එකවගේ නම් දෙවැන්න reject.
 *  4. TEMPLATE-SHAPE REJECT - output එක "<seed> - <desc>" හැඩයට
 *     සමාන නම් reject (model එක උපදෙස් නොසලකා template එකක්
 *     දුන්නොත් අල්ලගන්න).
 *  5. QUOTE SCRUB LOOP - ඉතුරු වෙච්ච " characters (PR #64 බලන්න)
 *     stable වෙනකම් repeat කරලා ඉවත් කරනවා.
 *  6. NO image_keyword WRITEBACK - නරක seed එකක් frontmatter
 *     එකට lock වෙන එක වළක්වනවා. image_keyword දැන් manual
 *     override එකක් විතරයි (script එක කියවනවා, ලියන්නේ නෑ).
 *
 * KEY POOL: GEMINI_API_KEY + GEMINI_API_KEY_1..30. Quota ගැහුවොත්
 * ඊළඟ key එකට. Model fallback: gemini-2.5-flash -> 2.0-flash
 * -> flash-latest.
 *
 * SEED PRIORITY (context එකක් විදිහට පමණි):
 *   a. frontmatter image_keyword
 *   b. gsc-keywords.json -> byPage[/blog/slug/]
 *   c. gsc-keywords.json -> global
 *   d. tag (hyphens -> spaces)
 *   e. category
 *   f. (seed නැතිව - model එක නිදහසේ describe කරයි)
 */
import { readFile, writeFile, readdir, appendFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const POSTS_DIR = path.join(ROOT, "src", "content", "posts");
const PUBLIC_DIR = path.join(ROOT, "public");
const KEYWORDS_FILE = path.join(ROOT, "src", "data", "gsc-keywords.json");

const LIMIT = clampInt(process.env.ALT_LIMIT, 8, 1, 40);
const OVERWRITE = String(process.env.ALT_OVERWRITE) === "true";
const FIX_BAD = String(process.env.ALT_FIX_BAD ?? "true") === "true";
const INCLUDE_BODY = String(process.env.ALT_INCLUDE_BODY ?? "true") === "true";
const BODY_IMAGES_PER_POST = 2;
const MIN_MEANINGFUL = 20;
const MAX_LEN = 125;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const TIMEOUT_MS = 60000;
const OPENING_WORDS = 4;
const MODELS = (process.env.ALT_MODELS || "gemini-2.5-flash,gemini-2.0-flash,gemini-flash-latest")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2060\ufeff\u00ad]/g;
const MIME_BY_EXT = {
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".heic": "image/heic",
  ".heif": "image/heif",
};
const EXT_FALLBACKS = [".webp", ".jpg", ".jpeg", ".png"];

function clampInt(raw, def, min, max) {
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, min), max);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ================= text scrubbing ================= */
const FILLER_PATTERNS = [
  /\b(image|photo|picture|thumbnail|cover|banner)\b/gi,
  /පින්තූර(ය|යක්)?/g,
  /ඡායාරූප(ය|යක්)?/g,
  /රූප(ය|සටහන)?/g,
];

function deslug(text) {
  return String(text || "").replace(/[-_]+/g, " ");
}
function tidy(text) {
  return String(text || "")
    .replace(INVISIBLE, "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s\-–—:,.|"'“”‘’]+|[\s\-–—:,.|"'“”‘’]+$/g, "")
    .trim();
}
function stripFiller(text) {
  let out = String(text || "");
  for (const re of FILLER_PATTERNS) out = out.replace(re, " ");
  return tidy(out);
}
const meaningfulLength = (t) => String(t || "").replace(/\s+/gu, "").length;
const openingKey = (t) =>
  tidy(t).toLowerCase().split(/\s+/).slice(0, OPENING_WORDS).join(" ");

/* ================= Gemini key pool ================= */
function collectKeys() {
  const names = ["GEMINI_API_KEY"];
  for (let i = 1; i <= 30; i++) names.push(`GEMINI_API_KEY_${i}`);
  const out = [];
  for (const n of names) {
    const v = (process.env[n] || "").trim();
    if (v) out.push({ name: n, value: v, exhausted: false, cooldownUntil: 0, calls: 0, ok: 0 });
  }
  return out;
}
const keys = collectKeys();

async function getAvailableKey() {
  const now = Date.now();
  const usable = keys.filter((k) => !k.exhausted);
  if (!usable.length) return null;
  for (let i = 0; i < usable.length; i++) {
    const k = usable[i];
    if (k.cooldownUntil <= now) return k;
  }
  const soonest = Math.min(...usable.map((k) => k.cooldownUntil));
  const wait = Math.min(Math.max(soonest - Date.now(), 1000), 60000);
  console.log(`  ! all keys cooling down - waiting ${Math.round(wait / 1000)}s`);
  await sleep(wait);
  return usable.find((k) => k.cooldownUntil <= Date.now()) || null;
}

const firstLine = (t) => String(t || "").replace(/\s+/g, " ").slice(0, 220);

async function callModel(model, keyEntry, prompt, image) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }, { inline_data: { mime_type: image.mime, data: image.base64 } }],
      },
    ],
    generationConfig: { temperature: 0.5, topP: 0.9, maxOutputTokens: 256 },
  };
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": keyEntry.value },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: false, kind: "network", message: String(err?.message || err) };
  }
  const text = await res.text();
  if (!res.ok) {
    const lower = text.toLowerCase();
    if (res.status === 429) {
      const perDay = lower.includes("per day") || lower.includes("perday") || lower.includes("daily limit");
      return { ok: false, kind: perDay ? "quota" : "rate", message: firstLine(text) };
    }
    if (res.status === 403 || (res.status === 400 && lower.includes("api key"))) {
      return { ok: false, kind: "auth", message: firstLine(text) };
    }
    if (res.status === 404) return { ok: false, kind: "model", message: firstLine(text) };
    if (res.status >= 500) return { ok: false, kind: "server", message: firstLine(text) };
    return { ok: false, kind: "other", message: firstLine(text) };
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, kind: "other", message: "response was not valid JSON" };
  }
  if (json.promptFeedback?.blockReason) {
    return { ok: false, kind: "blocked", message: json.promptFeedback.blockReason };
  }
  const cand = json.candidates?.[0];
  if (!cand) return { ok: false, kind: "empty", message: "no candidate returned" };
  if (cand.finishReason === "SAFETY" || cand.finishReason === "PROHIBITED_CONTENT") {
    return { ok: false, kind: "blocked", message: cand.finishReason };
  }
  const out = (cand.content?.parts || []).map((p) => p.text || "").join(" ").trim();
  if (!out) return { ok: false, kind: "empty", message: "empty text part" };
  return { ok: true, text: out };
}

async function generateAlt(prompt, image) {
  const errors = [];
  if (!keys.length) return { text: null, errors: ["no GEMINI_API_KEY* secrets available"] };
  const attemptsPerModel = Math.max(keys.length * 2, 4);
  for (const model of MODELS) {
    for (let attempt = 0; attempt < attemptsPerModel; attempt++) {
      const keyEntry = await getAvailableKey();
      if (!keyEntry) return { text: null, errors: [...errors, "all Gemini keys exhausted"] };
      keyEntry.calls++;
      const res = await callModel(model, keyEntry, prompt, image);
      if (res.ok) {
        keyEntry.ok++;
        return { text: res.text, model, keyName: keyEntry.name };
      }
      errors.push(`${model}/${keyEntry.name}: [${res.kind}] ${res.message}`);
      if (res.kind === "quota" || res.kind === "auth") {
        keyEntry.exhausted = true;
      } else if (res.kind === "rate") {
        keyEntry.cooldownUntil = Date.now() + 65000;
      } else if (res.kind === "model") {
        break; // try next model
      }
    }
  }
  return { text: null, errors };
}

/* ================= frontmatter parser/updater ================= */
const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

function parseScalar(fm, field) {
  const m = fm.match(new RegExp(`^${field}\\s*:\\s*(.+)$`, "m"));
  if (!m) return "";
  let v = m[1].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  v = v.replace(/\\"/g, '"').replace(/\\'/g, "'");
  if (v === '""' || v === "''") return "";
  return tidy(v);
}
function parseList(fm, field) {
  const inline = fm.match(new RegExp(`${field}\\s*:\\s*\\[([^\\]]*)\\]`));
  if (inline) return inline[1].split(",").map((s) => tidy(s)).filter(Boolean);
  const block = fm.match(new RegExp(`${field}\\s*:\\s*\\n((?:[ \\t]*-[ \\t]*.+\\n?)+)`));
  if (block) {
    return block[1]
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("-"))
      .map((l) => tidy(l.replace(/^-\s*/, "")))
      .filter(Boolean);
  }
  return [];
}
function upsertField(fm, field, value) {
  const line = `${field}: ${JSON.stringify(value)}`;
  const re = new RegExp(`^${field}\\s*:.*$`, "m");
  if (re.test(fm)) return fm.replace(re, line);
  const imageRe = /^image\s*:.*$/m;
  if (imageRe.test(fm)) return fm.replace(imageRe, (m) => `${m}\n${line}`);
  return `${fm.replace(/\s+$/, "")}\n${line}`;
}

/* ================= image resolution ================= */
function resolveImage(rawPath) {
  const cleaned = tidy(String(rawPath || ""));
  if (!cleaned || /^https?:\/\//i.test(cleaned)) return { error: `unsupported path "${cleaned}"` };
  let rel = cleaned.split("?")[0].split("#")[0];
  try {
    rel = decodeURIComponent(rel);
  } catch {
    /* keep */
  }
  rel = rel.replace(/^\/+/, "");
  const ext = path.extname(rel).toLowerCase();
  const candidates = [];
  for (const base of [path.join(PUBLIC_DIR, rel), path.join(ROOT, rel)]) {
    candidates.push(base);
    const stem = ext ? base.slice(0, base.length - ext.length) : base;
    for (const alt of EXT_FALLBACKS) if (alt !== ext) candidates.push(stem + alt);
  }
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const mime = MIME_BY_EXT[path.extname(file).toLowerCase()];
    if (!mime) continue;
    const size = statSync(file).size;
    if (size > MAX_IMAGE_BYTES) return { error: `too large (${Math.round(size / 1024)} KB)` };
    return { file, mime, size };
  }
  return { error: `file not found for "${cleaned}"` };
}

/* ================= seed (CONTEXT ONLY) ================= */
function cleanCandidate(raw) {
  const c = stripFiller(deslug(raw));
  if (c.toLowerCase() === "others") return "";
  return c;
}
function usableQuery(entry, usedSeeds) {
  if (!entry) return false;
  const c = cleanCandidate(entry.clean || entry.query);
  return meaningfulLength(c) >= 6 && !usedSeeds.has(c.toLowerCase());
}

function resolveSeed(post, keywords, usedSeeds) {
  const explicit = cleanCandidate(post.imageKeyword);
  if (meaningfulLength(explicit) >= 4) return { seed: explicit, origin: "frontmatter" };

  const pageList =
    keywords?.byPage?.[`/blog/${post.slug}/`] || keywords?.byPage?.[`/blog/${post.slug}`] || [];
  const pageHit = pageList.find((e) => usableQuery(e, usedSeeds));
  if (pageHit)
    return { seed: cleanCandidate(pageHit.clean || pageHit.query), origin: `gsc-page(${pageHit.impressions})` };

  const globalHit = [...(keywords?.global || [])]
    .sort((a, b) => b.trend * b.score - a.trend * a.score)
    .find((e) => usableQuery(e, usedSeeds));
  if (globalHit)
    return {
      seed: cleanCandidate(globalHit.clean || globalHit.query),
      origin: `gsc-global(${globalHit.impressions}, ${globalHit.trend}x)`,
    };

  for (const tag of [...post.keywords, ...post.tags]) {
    const c = cleanCandidate(tag);
    if (meaningfulLength(c) >= 4 && !usedSeeds.has(c.toLowerCase())) return { seed: c, origin: "tag" };
  }
  for (const cat of post.categories) {
    const c = cleanCandidate(cat);
    if (meaningfulLength(c) >= 4 && !usedSeeds.has(c.toLowerCase())) return { seed: c, origin: "category" };
  }
  // seed එකක් නැතුව - model එක නිදහසේ describe කරයි.
  return { seed: "", origin: "none" };
}

/* ================= prompt ================= */
function buildPrompt(seed) {
  const lines = [
    "You are writing the HTML alt attribute for a cover image on a Sinhala fiction blog.",
    "",
    "Write ONE line of natural Sinhala that describes what is actually visible in this image:",
    "the people, their clothing, posture and expression, the setting, the lighting, the colours, the mood.",
    "",
    "Hard rules:",
    "1. Output the alt text only. No quotes, no markdown, no labels, no explanation, no line breaks.",
    `2. Between 40 and ${MAX_LEN} characters.`,
    "3. Write it as a flowing descriptive sentence. Do NOT use a template such as",
    '   "topic - description". Do NOT begin with a keyword followed by a dash.',
    "4. Describe only neutral, non-explicit visual facts. Never describe nudity,",
    "   sexual activity, or intimate body parts.",
    "5. Never use these words: image, photo, picture, පින්තූරය, ඡායාරූපය.",
    "6. No emoji, no hashtags, no repeated words.",
  ];
  if (seed) {
    lines.push(
      "",
      `Optional context: this post is about "${seed}". You MAY use that wording if it genuinely`,
      "fits the description naturally. If it does not fit, ignore it completely. Never force it in,",
      "and never place it at the start as a label.",
    );
  }
  return lines.join("\n");
}

/* ================= normalisation & acceptance ================= */
const LABEL_PREFIX_RE =
  /^\s*(inferred|inference|alt|alt[\s_-]*text|description|desc|output|answer|result|caption|sinhala)\s*[:=\-–]\s*/i;

function normaliseAlt(raw) {
  let out = String(raw || "").split("\n")[0];
  out = out.replace(/`/g, "");
  out = tidy(out);
  for (let i = 0; i < 3; i++) {
    if ((out.startsWith('"') && out.endsWith('"')) || (out.startsWith("'") && out.endsWith("'"))) {
      out = tidy(out.slice(1, -1));
    }
  }
  out = out.replace(LABEL_PREFIX_RE, "");
  out = tidy(out);
  const open = (out.match(/[(\[]/g) || []).length;
  const close = (out.match(/[\])]/g) || []).length;
  if (open > close) {
    const lastOpen = Math.max(out.lastIndexOf("("), out.lastIndexOf("["));
    if (lastOpen > 0) out = out.slice(0, lastOpen);
  }
  out = tidy(out);
  if (out.length > MAX_LEN) {
    const cut = out.slice(0, MAX_LEN);
    const sp = cut.lastIndexOf(" ");
    out = tidy(sp > MAX_LEN * 0.6 ? cut.slice(0, sp) : cut);
  }
  return out || null;
}

/**
 * Alt text එකක් පිළිගන්නවද කියලා තීරණය කරනවා. Reject වුණොත්
 * කිසිවක් ලියන්නේ නෑ.
 */
function acceptAlt(alt, seed, post, usedAlts, usedOpenings) {
  if (!alt) return "model returned nothing usable";
  if (meaningfulLength(alt) < MIN_MEANINGFUL) return "too short / uninformative";
  if (usedAlts.has(alt.toLowerCase())) return "exact duplicate of another image";
  const op = openingKey(alt);
  if (op && usedOpenings.has(op)) return `opening phrase "${op}" repeated across posts`;
  // "<seed> - <desc>" වගේ එකක් නම් reject
  if (seed) {
    const s = seed.toLowerCase();
    const head = alt.toLowerCase().slice(0, s.length + 4);
    if (head.startsWith(s) && /^\s*[-–—:]/.test(alt.slice(seed.length))) {
      return "keyword-first template shape (stuffing risk)";
    }
    const seedHits = alt.toLowerCase().split(s).length - 1;
    if (seedHits > 1) return "seed keyword repeated (stuffing risk)";
  }
  const titleCore = deslug(post.title).toLowerCase();
  if (titleCore && meaningfulLength(titleCore) > 8 && alt.toLowerCase() === titleCore) {
    return "identical to the post title";
  }
  return null; // accepted
}

/* ================= main ================= */
(async () => {
  console.log(`Gemini keys: ${keys.length} | models: ${MODELS.join(" -> ")}`);
  if (!keys.length) {
    console.log("No GEMINI_API_KEY* secret found.");
    await writeOutputs(false, "No Gemini API keys configured.\n");
    return;
  }

  let keywords = null;
  if (existsSync(KEYWORDS_FILE)) {
    try {
      keywords = JSON.parse(await readFile(KEYWORDS_FILE, "utf-8"));
      console.log(
        `GSC keywords: ${keywords.global?.length || 0} global, ${Object.keys(keywords.byPage || {}).length} pages`,
      );
    } catch (err) {
      console.warn(`Could not parse gsc-keywords.json: ${err.message}`);
    }
  } else {
    console.log("No gsc-keywords.json yet - seeds will come from tags/categories, or none at all.");
  }

  const files = (await readdir(POSTS_DIR)).filter(
    (f) => (f.endsWith(".md") || f.endsWith(".mdx")) && !f.startsWith("-"),
  );
  console.log(`DIAGNOSTIC: Scanned ${files.length} post file(s)`);

  const posts = [];
  const usedAlts = new Set();
  const usedOpenings = new Set();
  const usedSeeds = new Set();

  for (const name of files) {
    const file = path.join(POSTS_DIR, name);
    const content = await readFile(file, "utf-8");
    const m = content.match(FM_RE);
    if (!m) continue;
    const fm = m[1];
    const post = {
      file,
      slug: name.replace(/\.+$/, ""),
      content,
      fm,
      title: parseScalar(fm, "title") || "",
      image: parseScalar(fm, "image") || "",
      imageAlt: parseScalar(fm, "image_alt") || "",
      imageKeyword: parseScalar(fm, "image_keyword") || "",
      date: parseScalar(fm, "date") || "",
      categories: parseList(fm, "categories"),
      tags: parseList(fm, "tags"),
      keywords: parseList(fm, "keywords"),
    };
    if (post.imageAlt) {
      usedAlts.add(post.imageAlt.toLowerCase());
      usedOpenings.add(openingKey(post.imageAlt));
    }
    for (const b of post.content.matchAll(/!\[([^\]]+)\]\(/g)) {
      usedAlts.add(tidy(b[1]).toLowerCase());
      usedOpenings.add(openingKey(b[1]));
    }
    posts.push(post);
  }

  // දැනට තියෙන නරක alt text හඳුනාගැනීම
  const isBadAlt = (a) =>
    !!a && (LABEL_PREFIX_RE.test(a) || meaningfulLength(a) < MIN_MEANINGFUL);

  const needsWork = posts
    .filter((p) => {
      if (!p.image) return false;
      if (OVERWRITE) return true;
      if (!p.imageAlt) return true;
      if (FIX_BAD && isBadAlt(p.imageAlt)) return true;
      if (INCLUDE_BODY && /!\[\]\(/.test(p.content)) return true;
      return false;
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  console.log(`Candidates: ${needsWork.length} | limit this run: ${LIMIT}`);

  const report = [];
  let generated = 0;

  for (const post of needsWork) {
    if (generated >= LIMIT) break;

    const targets = [];
    if (OVERWRITE || !post.imageAlt || (FIX_BAD && isBadAlt(post.imageAlt))) {
      targets.push({ kind: "cover", raw: post.image });
    }
    if (INCLUDE_BODY) {
      for (const bm of [...post.content.matchAll(/!\[\]\(([^)]+)\)/g)].slice(0, BODY_IMAGES_PER_POST)) {
        targets.push({ kind: "body", raw: bm[1], match: bm[0] });
      }
    }

    for (const target of targets) {
      if (generated >= LIMIT) break;

      const img = resolveImage(target.raw);
      if (img.error) {
        console.log(`SKIP ${post.slug} [${target.kind}] - ${img.error}`);
        report.push({ slug: post.slug, kind: target.kind, status: `skipped - ${img.error}` });
        continue;
      }

      const { seed, origin } = resolveSeed(post, keywords, usedSeeds);
      const base64 = (await readFile(img.file)).toString("base64");
      const result = await generateAlt(buildPrompt(seed), { base64, mime: img.mime });

      if (!result.text) {
        console.log(`SKIP ${post.slug} [${target.kind}] - model failed or refused`);
        if (result.errors?.length) console.log(`  ${result.errors.slice(-2).join(" | ")}`);
        report.push({ slug: post.slug, kind: target.kind, origin, status: "skipped - model failed/refused" });
        continue;
      }

      const alt = normaliseAlt(result.text);
      const reject = acceptAlt(alt, seed, post, usedAlts, usedOpenings);
      if (reject) {
        console.log(`REJECT ${post.slug} [${target.kind}] - ${reject}`);
        report.push({ slug: post.slug, kind: target.kind, origin, status: `rejected - ${reject}` });
        continue;
      }

      usedAlts.add(alt.toLowerCase());
      usedOpenings.add(openingKey(alt));
      if (seed) usedSeeds.add(seed.toLowerCase());

      if (target.kind === "cover") {
        const fm = upsertField(post.fm, "image_alt", alt);
        post.content = post.content.replace(FM_RE, `---\n${fm}\n---`);
        post.fm = fm;
        post.imageAlt = alt;
      } else {
        post.content = post.content.replace(
          target.match,
          target.match.replace("![]", `![${alt.replace(/[\[\]]/g, "")}]`),
        );
      }
      await writeFile(post.file, post.content, "utf-8");

      generated++;
      console.log(`OK ${post.slug} [${target.kind}] seed=${origin} via ${result.model}/${result.keyName}\n   -> ${alt}`);
      report.push({ slug: post.slug, kind: target.kind, origin, alt, status: "generated" });
    }
  }

  console.log("\nKey usage:");
  for (const k of keys) if (k.calls) console.log(`  ${k.name}: ${k.ok}/${k.calls} ok${k.exhausted ? " (exhausted)" : ""}`);

  const lines = [
    "## AI image alt text",
    "",
    `Written: ${generated} | Candidates: ${needsWork.length} | Keys: ${keys.length}`,
    "",
    "Alt text එකක් ලියලා තියෙන්නේ model එක ඇත්තටම image එක describe කළොත් පමණි.",
    "Reject/skip වුණු ඒවාට alt text එකක් ලියලා නෑ - keyword stuffing වළක්වන්න ඒක හිතාමතාමයි.",
    "",
  ];
  if (report.length) {
    lines.push(
      "| Post | Type | Seed origin | Alt text / status |",
      "| ---- | ---- | ----------- | ----------------- |",
      ...report.map(
        (r) => `| ${r.slug} | ${r.kind} | ${r.origin || "-"} | ${(r.alt || r.status).replace(/\|/g, "\\|")} |`,
      ),
    );
  } else {
    lines.push("Nothing to do.");
  }
  await writeOutputs(generated > 0, `${lines.join("\n")}\n`);
})().catch(async (err) => {
  console.error("FATAL:", err?.stack || err);
  process.exit(1);
});

async function writeOutputs(changed, summary) {
  await writeFile("/tmp/alt-text-report.md", summary, "utf-8");
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
}
