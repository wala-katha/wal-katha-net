#!/usr/bin/env node
/**
 * AI image alt-text generator (Gemini Vision) - v4
 *
 * ==================================================================
 * v4 FIX ROUND - run #77 එකේ "Written: 0" එකට හේතු තුනක්:
 * ==================================================================
 *
 * FIX 1 - THINKING BUDGET (මේක තමයි ප්‍රධාන හේතුව):
 *   gemini-2.5-flash එක thinking model එකක්. ඒක internal reasoning
 *   එකට output tokens වියදම් කරනවා. maxOutputTokens: 256 එකෙන්
 *   thinking එකම ඉවර වෙලා, text part එකට ඉතුරු වෙන්නේ කැඩුණු
 *   කෑල්ලක් විතරයි -> finishReason: MAX_TOKENS. කලින් version එක
 *   finishReason check කළේ නෑ, ඒ නිසා ඒක "success" ලෙස ගෙන,
 *   ඊට පස්සේ "too short" කියලා reject කළා.
 *   දැන්: 2.5 models වලට thinkingConfig.thinkingBudget = 0,
 *   maxOutputTokens 1024 දක්වා, සහ MAX_TOKENS එක retry-worthy
 *   failure එකක් ලෙස හඳුනාගන්නවා.
 *
 * FIX 2 - SLUG REGEX:
 *   name.replace(/\.+$/, "") extension එක ඉවත් කළේ නෑ, ඒ නිසා
 *   slug එක "foo.md" වුණා (run #77 table එකේ පේනවා) සහ GSC
 *   byPage lookup එක /blog/foo.md/ හොයලා කවදාවත් හම්බවුණේ නෑ.
 *   දැන්: /\.[^.]+$/
 *
 * FIX 3 - KEY ROTATION:
 *   getAvailableKey() cursor එකක් නැතුව හැම විටම keys[0] දුන්නා -
 *   keys 15ක් තියෙද්දී එකක් විතරක් පාවිච්චි වුණා. දැන් round-robin.
 *
 * FIX 4 - DIAGNOSTICS:
 *   reject/skip වුණාම model එකේ RAW output එකයි finishReason එකයි
 *   log වෙනවා. කලින් ඒක නොතිබුණ නිසා run #77 එකේ මොකද වුණේ කියලා
 *   බලාගන්න බැරි වුණා. ALT_DEBUG=true දැම්මොත් සාර්ථක ඒවාටත් raw
 *   output එක පේනවා.
 *
 * FIX 5 - RETRY LOOP GUARD:
 *   කලින් "empty"/"blocked" වුණාම එකම model එක 30 වතාවක් retry
 *   වුණා. දැන් අනුපිළිවෙලින් දෙකක් fail වුණාම ඊළඟ model එකට යනවා.
 *
 * ------------------------------------------------------------------
 * ආපහු දැමූ SAFETY GUARDS (ඉවත් කරන්න එපා):
 *   - MINOR_TERM_PATTERNS: school/student/teen/uniform සහ ඒවාට
 *     අදාළ සිංහල පද. Adult content site එකක මේවා image alt text
 *     වල තිබීම Google ට zero-tolerance violation එකක් - site එකම
 *     deindex වෙන්න පුළුවන්. මේවා seed එකක් ලෙසවත් output එකක්
 *     ලෙසවත් පිළිගන්නේ නෑ.
 *   - UNSAFE instruction: model එකට පේන image එකේ වයස අවුරුදු 18ට
 *     අඩු කෙනෙක් හෝ පාසල් setting එකක් තියෙනවා නම් "UNSAFE" කියලා
 *     විතරක් reply කරන්න කියනවා -> ඒ image එක සම්පූර්ණයෙන් skip.
 *   - BRAND_PATTERNS: alt text වල "wal katha" වගේ brand terms
 *     තිබීම තමයි මුල් ප්‍රශ්නය. ඒක ආපහු එන්න දෙන්න බෑ.
 * ------------------------------------------------------------------
 *
 * දර්ශනය (v3 සිට එලෙසම): seed එක CONTEXT එකක් විතරයි, prefix
 * එකක් නෙවෙයි. Model එක image එක describe කරනවා. Model එක fail
 * වුණොත් කිසිම alt text එකක් ලියන්නේ නෑ - alt නැති image එකක්,
 * stuffed alt එකක් තියෙන එකකට වඩා හොඳයි.
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
const DEBUG = String(process.env.ALT_DEBUG) === "true";
const BODY_IMAGES_PER_POST = 2;
const MIN_MEANINGFUL = 18;
const MAX_LEN = 125;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const TIMEOUT_MS = 60000;
const MAX_OUTPUT_TOKENS = 1024;
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
const BRAND_PATTERNS = [
  /wal[\s._-]*katha/gi,
  /wala[\s._-]*katha/gi,
  /walkatha/gi,
  /walakatha/gi,
  /sinhala[\s._-]*wal\b/gi,
  /වල්[\s\u200d]*කතා/g,
  /වල[\s\u200d]*කතා/g,
  /වල්කතා/g,
  /වලකතා/g,
];
const FILLER_PATTERNS = [
  /\b(image|photo|picture|thumbnail|cover|banner)\b/gi,
  /පින්තූර(ය|යක්)?/g,
  /ඡායාරූප(ය|යක්)?/g,
  /රූප(ය|සටහන)?/g,
];

/**
 * MINOR-SAFETY BLOCKLIST - මේක ඉවත් කරන්න එපා.
 * Adult content site එකක මේ terms image alt text වල තිබීම Google ට
 * zero-tolerance policy violation එකක්, සහ manual action එකකින්
 * සම්පූර්ණ site එකම deindex වෙන්න පුළුවන්. Search Console appeal
 * එකකින් ආපහු ගන්න ඉතා අමාරුයි.
 */
const MINOR_TERM_PATTERNS = [
  /\bschool(girl|boy)?\b/i,
  /\bstudent\b/i,
  /\bteen(age(r|d)?)?\b/i,
  /\bpupil\b/i,
  /\buniform\b/i,
  /\bunderage\b/i,
  /\bminor\b/i,
  /\bchild(ren)?\b/i,
  /\bkid(s)?\b/i,
  /\bjuvenile\b/i,
  /\byouth\b/i,
  /\bclassroom\b/i,
  /\bcollege\s*girl\b/i,
  /පාසැ?ල්/,
  /ඉස්කෝලේ?/,
  /ශිෂ්‍ය(ාව|යා)?/,
  /සිසු(වා|විය|න්)?/,
  /නි[ල්ලි]\s*ඇඳුම/,
  /යෞවන/,
  /කුඩා\s*දැරිය/,
  /ළමා/,
  /දරුව(ා|න්)/,
];
const hasMinorTerm = (t) => MINOR_TERM_PATTERNS.some((re) => re.test(String(t || "")));

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
function stripBrand(text) {
  let out = String(text || "");
  for (const re of BRAND_PATTERNS) out = out.replace(re, " ");
  return tidy(out);
}
function stripFiller(text) {
  let out = String(text || "");
  for (const re of FILLER_PATTERNS) out = out.replace(re, " ");
  return tidy(out);
}
const hasBrand = (t) =>
  BRAND_PATTERNS.some((re) => new RegExp(re.source, re.flags.replace("g", "")).test(String(t || "")));
const meaningfulLength = (t) => String(t || "").replace(/[^\p{L}\p{N}]/gu, "").length;
const openingKey = (t) => tidy(t).toLowerCase().split(/\s+/).slice(0, OPENING_WORDS).join(" ");
const firstLine = (t) => String(t || "").replace(/\s+/g, " ").slice(0, 240);

/* ================= Gemini key pool ================= */
function collectKeys() {
  const names = ["GEMINI_API_KEY"];
  for (let i = 1; i <= 30; i++) names.push(`GEMINI_API_KEY_${i}`);
  const seen = new Set();
  const out = [];
  for (const n of names) {
    const v = (process.env[n] || "").trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push({ name: n, value: v, exhausted: false, cooldownUntil: 0, calls: 0, ok: 0 });
  }
  return out;
}
const keys = collectKeys();

// FIX 3: round-robin cursor. Run number එකෙන් පටන් ගන්නවා, ඒ නිසා
// අනුයාත runs වල එකම key එකෙන් පටන් ගන්නේ නෑ.
let cursor = clampInt(process.env.GITHUB_RUN_NUMBER, 0, 0, 10 ** 9) % Math.max(keys.length, 1);

async function getAvailableKey() {
  const usable = keys.filter((k) => !k.exhausted);
  if (!usable.length) return null;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[cursor++ % keys.length];
    if (!k.exhausted && k.cooldownUntil <= Date.now()) return k;
  }
  const soonest = Math.min(...usable.map((k) => k.cooldownUntil));
  const wait = Math.min(Math.max(soonest - Date.now(), 1000), 70000);
  console.log(`  ! all keys cooling down - waiting ${Math.round(wait / 1000)}s`);
  await sleep(wait);
  return usable.find((k) => k.cooldownUntil <= Date.now()) || null;
}

/* ================= model call ================= */
function buildGenerationConfig(model) {
  const cfg = { temperature: 0.5, topP: 0.9, maxOutputTokens: MAX_OUTPUT_TOKENS };
  // FIX 1: 2.5 series models thinking-enabled. Budget 0 කළාම output
  // tokens ඔක්කොම ඇත්ත පිළිතුරට යනවා. 2.0 සහ පැරණි models
  // thinkingConfig එක පිළිගන්නේ නෑ (400 INVALID_ARGUMENT), ඒ නිසා
  // conditional.
  if (/gemini-2\.5|gemini-3|flash-latest|pro-latest/.test(model)) {
    cfg.thinkingConfig = { thinkingBudget: 0 };
  }
  return cfg;
}

async function callModel(model, keyEntry, prompt, image) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }, { inline_data: { mime_type: image.mime, data: image.base64 } }],
      },
    ],
    generationConfig: buildGenerationConfig(model),
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
    // thinkingConfig එක model එක පිළිගත්තේ නැත්නම් ඒකත් model
    // mismatch එකක් ලෙස සලකලා ඊළඟ model එකට යනවා.
    if (res.status === 400 && lower.includes("thinking")) {
      return { ok: false, kind: "model", message: firstLine(text) };
    }
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
    return { ok: false, kind: "blocked", message: `promptFeedback: ${json.promptFeedback.blockReason}` };
  }
  const cand = json.candidates?.[0];
  if (!cand) return { ok: false, kind: "empty", message: "no candidate returned" };
  const finish = cand.finishReason || "";
  if (finish === "SAFETY" || finish === "PROHIBITED_CONTENT" || finish === "IMAGE_SAFETY") {
    return { ok: false, kind: "blocked", message: `finishReason: ${finish}` };
  }
  const out = (cand.content?.parts || []).map((p) => p.text || "").join(" ").trim();
  // FIX 1: thinking එකෙන් tokens ඉවර වුණාම මෙතනට කැඩුණු කෑල්ලක්
  // එනවා. ඒක "success" ලෙස පිළිගන්න බෑ.
  if (finish === "MAX_TOKENS" && meaningfulLength(out) < MIN_MEANINGFUL) {
    const used = json.usageMetadata || {};
    return {
      ok: false,
      kind: "truncated",
      message:
        `finishReason MAX_TOKENS with only ${meaningfulLength(out)} usable chars ` +
        `(thoughts=${used.thoughtsTokenCount ?? "?"}, output=${used.candidatesTokenCount ?? "?"}) ` +
        `raw="${firstLine(out)}"`,
    };
  }
  if (!out) return { ok: false, kind: "empty", message: `empty text part (finishReason=${finish || "none"})` };
  return { ok: true, text: out, finish, usage: json.usageMetadata || null };
}

async function generateAlt(prompt, image) {
  const errors = [];
  if (!keys.length) return { text: null, errors: ["no GEMINI_API_KEY* secrets available"] };
  for (const model of MODELS) {
    const attempts = Math.max(Math.min(keys.length, 6), 3);
    let softFails = 0;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const keyEntry = await getAvailableKey();
      if (!keyEntry) return { text: null, errors: [...errors, "all Gemini keys exhausted"] };
      keyEntry.calls++;
      const res = await callModel(model, keyEntry, prompt, image);
      if (res.ok) {
        keyEntry.ok++;
        return { text: res.text, model, keyName: keyEntry.name, finish: res.finish, usage: res.usage, errors };
      }
      errors.push(`${model}/${keyEntry.name}: [${res.kind}] ${res.message}`);
      if (res.kind === "quota" || res.kind === "auth") {
        keyEntry.exhausted = true;
        console.log(`  ! ${keyEntry.name} disabled for this run (${res.kind})`);
        continue;
      }
      if (res.kind === "rate") {
        keyEntry.cooldownUntil = Date.now() + 65000;
        continue;
      }
      if (res.kind === "model") break; // ඊළඟ model එකට
      if (res.kind === "server" || res.kind === "network") {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      // FIX 5: blocked / empty / truncated / other - දෙකක් අනුපිළිවෙලින්
      // fail වුණාම ඊළඟ model එකට. කලින් මේක 30 වතාවක් retry වුණා.
      if (++softFails >= 2) break;
    }
  }
  return { text: null, errors };
}

/* ================= frontmatter ================= */
const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

function parseScalar(fm, field) {
  const m = fm.match(new RegExp(`^${field}\\s*:\\s*(.+)$`, "m"));
  if (!m) return "";
  let v = m[1].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  v = v.replace(/\\"/g, '"').replace(/\\'/g, "'");
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
  const c = stripFiller(stripBrand(deslug(raw)));
  if (hasMinorTerm(c)) return "";
  if (c.toLowerCase() === "others") return "";
  return c;
}
function usableQuery(entry, usedSeeds) {
  if (!entry || entry.brandOnly) return false;
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
    return {
      seed: cleanCandidate(pageHit.clean || pageHit.query),
      origin: `gsc-page(${pageHit.impressions})`,
    };

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
    "5. Never use these words: wal katha, wala katha, walkatha, walakatha, වල් කතා, වල කතා,",
    "   image, photo, picture, පින්තූරය, ඡායාරූපය.",
    "6. No emoji, no hashtags, no repeated words.",
    "",
    "SAFETY OVERRIDE - this takes priority over every rule above.",
    "Reply with exactly the single word UNSAFE, and nothing else, if ANY of the following is true:",
    "  - anyone in the image looks, or could reasonably look, under 18 years old;",
    "  - the image shows a school, classroom, school uniform, student, or any youth setting;",
    "  - the image is sexually explicit;",
    "  - you are in any way unsure about the apparent age of anyone shown.",
    "In those cases do not describe the image at all. Reply only UNSAFE.",
  ];
  if (seed) {
    lines.push(
      "",
      `Optional context: this post is about "${seed}". You MAY use that wording only if it`,
      "genuinely fits the description naturally. If it does not fit, ignore it completely.",
      "Never force it in, and never place it at the start as a label.",
    );
  }
  return lines.join("\n");
}

/* ================= normalisation & acceptance ================= */
const LABEL_PREFIX_RE =
  /^\s*(inferred|inference|alt|alt[\s_-]*text|description|desc|output|answer|result|caption|sinhala)\s*[:=\-–]\s*/i;

function normaliseAlt(raw) {
  let out = String(raw || "")
    .split("\n")
    .map((l) => tidy(l))
    .find((l) => meaningfulLength(l) > 0) || "";
  out = out.replace(/`/g, "");
  out = tidy(out);
  for (let i = 0; i < 4; i++) {
    const before = out;
    out = tidy(out.replace(LABEL_PREFIX_RE, ""));
    if (out === before) break;
  }
  out = stripFiller(stripBrand(out));
  out = out.replace(/#[^\s#]+/g, "");
  const open = (out.match(/[([]/g) || []).length;
  const close = (out.match(/[)\]]/g) || []).length;
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

function acceptAlt(alt, seed, post, usedAlts, usedOpenings) {
  if (!alt) return "model returned nothing usable";
  if (meaningfulLength(alt) < MIN_MEANINGFUL)
    return `too short (${meaningfulLength(alt)} of ${MIN_MEANINGFUL} chars)`;
  if (hasBrand(alt)) return "contains a brand term";
  if (hasMinorTerm(alt)) return "SAFETY: contains a minor/school related term";
  if (usedAlts.has(alt.toLowerCase())) return "exact duplicate of another image";
  const op = openingKey(alt);
  if (op && usedOpenings.has(op)) return `opening phrase "${op}" repeated across posts`;
  if (seed) {
    const s = seed.toLowerCase();
    if (alt.toLowerCase().startsWith(s) && /^\s*[-–—:]/.test(alt.slice(seed.length))) {
      return "keyword-first template shape (stuffing risk)";
    }
    if (alt.toLowerCase().split(s).length - 1 > 1) return "seed keyword repeated (stuffing risk)";
  }
  const titleCore = stripBrand(post.title).toLowerCase();
  if (titleCore && meaningfulLength(titleCore) > 8 && alt.toLowerCase() === titleCore) {
    return "identical to the post title";
  }
  return null;
}

/* ================= main ================= */
(async () => {
  console.log(`Gemini keys: ${keys.length} | models: ${MODELS.join(" -> ")}`);
  console.log(`maxOutputTokens=${MAX_OUTPUT_TOKENS} | thinkingBudget=0 for 2.5-series`);
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
    console.log("No gsc-keywords.json yet - seeds from tags/categories, or none at all.");
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
      // FIX 2: extension එක ඇත්තටම ඉවත් කරනවා
      slug: name.replace(/\.[^.]+$/, ""),
      content,
      fm,
      title: parseScalar(fm, "title"),
      image: parseScalar(fm, "image"),
      imageAlt: parseScalar(fm, "image_alt"),
      imageKeyword: parseScalar(fm, "image_keyword"),
      date: parseScalar(fm, "date"),
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

  const isBadAlt = (a) =>
    !!a &&
    (hasBrand(a) || hasMinorTerm(a) || LABEL_PREFIX_RE.test(a) || meaningfulLength(a) < MIN_MEANINGFUL);

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
  let unsafeCount = 0;

  for (const post of needsWork) {
    if (generated >= LIMIT) break;

    const targets = [];
    if (OVERWRITE || !post.imageAlt || (FIX_BAD && isBadAlt(post.imageAlt))) {
      targets.push({ kind: "cover", raw: post.image });
    }
    if (INCLUDE_BODY) {
      for (const bm of [...post.content.matchAll(/!\[\]\(([^)\s]+)[^)]*\)/g)].slice(0, BODY_IMAGES_PER_POST)) {
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
        // FIX 4: හේතුව හැම විටම log කරනවා
        for (const e of (result.errors || []).slice(-4)) console.log(`     ${e}`);
        report.push({ slug: post.slug, kind: target.kind, origin, status: "skipped - model failed/refused" });
        continue;
      }

      if (DEBUG) console.log(`  raw[${result.model}] finish=${result.finish}: ${firstLine(result.text)}`);

      if (/^\s*unsafe\s*[.!]?\s*$/i.test(result.text) || /\bUNSAFE\b/.test(result.text)) {
        unsafeCount++;
        console.log(`UNSAFE ${post.slug} [${target.kind}] - vision model flagged this image. No alt written.`);
        report.push({
          slug: post.slug,
          kind: target.kind,
          origin,
          status: "SKIPPED - flagged UNSAFE by vision model (review this image manually)",
        });
        continue;
      }

      const alt = normaliseAlt(result.text);
      const reject = acceptAlt(alt, seed, post, usedAlts, usedOpenings);
      if (reject) {
        console.log(`REJECT ${post.slug} [${target.kind}] - ${reject}`);
        console.log(`     raw (finish=${result.finish}): ${firstLine(result.text)}`);
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
          target.match.replace("![]", `![${alt.replace(/[[\]]/g, "")}]`),
        );
      }
      await writeFile(post.file, post.content, "utf-8");

      generated++;
      console.log(
        `OK ${post.slug} [${target.kind}] seed=${origin} via ${result.model}/${result.keyName}\n   -> ${alt}`,
      );
      report.push({ slug: post.slug, kind: target.kind, origin, alt, status: "generated" });
    }
  }

  console.log("\nKey usage:");
  for (const k of keys) {
    if (k.calls) console.log(`  ${k.name}: ${k.ok}/${k.calls} ok${k.exhausted ? " (exhausted)" : ""}`);
  }

  const lines = [
    "## AI image alt text",
    "",
    `Written: **${generated}** | Candidates: ${needsWork.length} | Flagged UNSAFE: **${unsafeCount}** | Keys: ${keys.length}`,
    "",
    "Alt text එකක් ලියලා තියෙන්නේ model එක ඇත්තටම image එක describe කළොත් පමණි.",
    "Reject/skip වුණු ඒවාට alt text එකක් ලියලා නෑ - keyword stuffing වළක්වන්න ඒක හිතාමතාමයි.",
    "සම්පූර්ණ හේතුව workflow log එකේ (raw model output එකත් එහි තියෙනවා).",
    "",
  ];
  if (unsafeCount > 0) {
    lines.push(
      `> **අවධානය:** image ${unsafeCount}ක් UNSAFE ලෙස flag කළා. ඒවා manually review කරන්න.`,
      "",
    );
  }
  if (report.length) {
    lines.push(
      "| Post | Type | Seed origin | Alt text / status |",
      "| ---- | ---- | ----------- | ----------------- |",
      ...report.map(
        (r) => `| \`${r.slug}\` | ${r.kind} | ${r.origin || "-"} | ${(r.alt || r.status).replace(/\|/g, "\\|")} |`,
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
