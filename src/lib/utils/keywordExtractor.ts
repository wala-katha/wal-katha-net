import { plainify } from "./textConverter";

const SINHALA_RANGE = "\u0D80-\u0DFF";
const WORD_REGEX = new RegExp(`[a-zA-Z${SINHALA_RANGE}]+`, "gu");

// SEO sadaha wadagath nowana ahaka damana wachana (Stopwords)
const STOPWORDS = new Set([
  "මම","මට","මගේ","මගෙ","ඔයා","ඔයාට","ඔයාගේ","එයා","එයාට","එයාගේ",
  "අපි","අපිට","අපේ","උන්","උනා","උනේ","උනොත්","කරන","කරා","කරාට",
  "කරලා","කරන්න","කියලා","කියල","කියන","කියා","තියෙන","තියෙනවා",
  "තිබ්බ","තිබුනා","තිබුනේ","නෑ","නැත","නැහැ","නොවේ","එක","එකක්",
  "එකේ","එකට","මේ","මෙය","මෙම","ඒ","ඒක","ඒකේ","ඒකට","මොකද","මොකක්ද",
  "කොහොම","කොහොමද","දැන්","ඉතින්","හැබැයි","නමුත්","වගේ","වැඩිය",
  "ගොඩක්","ටිකක්","හොඳට","හොද","හොදට","ලග","ලගට","එහෙම","එහෙම්ම",
  "එතකොට","ඉතිං","මොකෝ","කවුද","කොහෙද","දාන්න","දුන්න","ගිය","ගියා",
  "ආව","ආවා","හිටිය","හිටියා","ඉන්න","ඉන්නවා","වෙන්න","වුනා","වුනේ",
  "සහ","හා","ලා","ටත්","එකත්","මෙන්න","ඔන්න","මගෙන්","එයාගෙන්",
  "the","a","an","and","or","but","is","are","was","were","be","been",
  "to","of","in","on","at","for","with","as","by","that","this","it",
  "i","you","he","she","we","they","my","your","his","her","our","their",
]);

const MIN_WORD_LENGTH = 3;
const MIN_BIGRAM_FREQ = 2;
const MAX_EXTRACTED_KEYWORDS = 8;

// Mulu web adawiyatama poduwe rank kara ganeema (Method B) Global Force Keywords
const GLOBAL_FORCE_KEYWORDS = [
  "sinhala wal katha",
  "wal katha",
  "wala katha",
  "wela katha",
  "වැල් කතා",
  "වල් කතා",
  "වැල කතා",
];

// Tokenize plain text into words, filtering stopwords and short noise.
function tokenize(text: string): string[] {
  const matches = text.match(WORD_REGEX);
  if (!matches) return [];
  return matches
    .map((w) => w.trim())
    .filter((w) => w.length >= MIN_WORD_LENGTH)
    .filter((w) => !STOPWORDS.has(w.toLowerCase()));
}

// Extracts topical single-word and two-word entity candidates from a
// post's raw markdown body via term-frequency ranking. No network
// calls, no external NLP dependency - safe for every build.
export function extractKeywordsFromBody(body: string | undefined | null): string[] {
  if (!body || typeof body !== "string") return [];

  const parsed = plainify(body);
  const plainText = typeof parsed === "string" ? parsed : String(parsed ?? "");
  if (!plainText) return [];

  const tokens = tokenize(plainText);
  if (tokens.length === 0) return [];

  const unigramFreq = new Map<string, number>();
  for (const t of tokens) {
    const key = t.toLowerCase();
    unigramFreq.set(key, (unigramFreq.get(key) || 0) + 1);
  }

  const bigramFreq = new Map<string, number>();
  for (let i = 0; i < tokens.length - 1; i++) {
    const phrase = `${tokens[i]} ${tokens[i + 1]}`.toLowerCase();
    bigramFreq.set(phrase, (bigramFreq.get(phrase) || 0) + 1);
  }

  const rankedBigrams = [...bigramFreq.entries()]
    .filter(([, freq]) => freq >= MIN_BIGRAM_FREQ)
    .sort((a, b) => b[1] - a[1])
    .map(([phrase]) => phrase);

  const rankedUnigrams = [...unigramFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([word]) => word);

  const combined: string[] = [];
  const seen = new Set<string>();

  for (const phrase of rankedBigrams) {
    if (combined.length >= MAX_EXTRACTED_KEYWORDS) break;
    if (seen.has(phrase)) continue;
    seen.add(phrase);
    combined.push(phrase);
  }
  for (const word of rankedUnigrams) {
    if (combined.length >= MAX_EXTRACTED_KEYWORDS) break;
    if (seen.has(word)) continue;
    const partOfBigram = combined.some((phrase) => phrase.includes(word));
    if (partOfBigram) continue;
    seen.add(word);
    combined.push(word);
  }

  return combined;
}

// Merges Global Keywords (Method B) + Frontmatter Curated Keywords (Method A)
// with auto-extracted body keywords, capped to avoid meta-keyword stuffing.
export function buildMetaKeywords(
  curated: string[],
  body: string | undefined | null,
  maxTotal = 15
): string[] {
  const initialKeywords = [...(curated || []), ...GLOBAL_FORCE_KEYWORDS];

  const cleanCurated = initialKeywords.map((k) => k.trim()).filter(Boolean);
  const seenLower = new Set<string>();
  const result: string[] = [];

  for (const kw of cleanCurated) {
    const lower = kw.toLowerCase();
    if (!seenLower.has(lower)) {
      seenLower.add(lower);
      result.push(kw);
    }
  }

  const extracted = extractKeywordsFromBody(body);

  for (const kw of extracted) {
    if (result.length >= maxTotal) break;
    const lower = kw.toLowerCase();
    if (seenLower.has(lower)) continue;
    seenLower.add(lower);
    result.push(kw);
  }

  return result;
}
