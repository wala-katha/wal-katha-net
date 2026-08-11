import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// Build-time git-diff based 404->301 auto-redirect fixer.
// Follows the same self-healing (try/catch, never throw) pattern
// already used by astro.config.mjs's git-based lastmod resolver.

const AUTO_START = "## AUTO-GENERATED-REDIRECTS-START (redirect-fixer - do not edit manually)";
const AUTO_END = "## AUTO-GENERATED-REDIRECTS-END";

function runGit(cmd, cwd) {
  try {
    return execSync(cmd, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function slugFromPath(filePath) {
  const base = path.basename(filePath || "");
  if (!base || base.startsWith("-")) return null;
  return base.replace(/\.[^.]+$/, "");
}

// Same inline-array / YAML block-list frontmatter extraction pattern
// used in .github/workflows/google-indexing.yml, kept local since this
// runs as plain Node ESM inside the Astro/Vite build process.
function extractFirstArrayValue(content, fieldName) {
  const inline = content.match(new RegExp(fieldName + "\\s*:\\s*\\[([^\\]]*)\\]"));
  if (inline) {
    const items = inline[1]
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
    return items[0] || null;
  }
  const block = content.match(
    new RegExp(fieldName + "\\s*:\\s*\\n((?:[ \\t]*-[ \\t]*.+\\n?)+)")
  );
  if (block) {
    const lines = block[1]
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("-"));
    if (lines.length) {
      return lines[0].replace(/^-\s*/, "").trim().replace(/^["']|["']$/g, "");
    }
  }
  return null;
}

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\u0D80-\u0DFF_-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseDiffLines(diffOutput, root) {
  const rules = [];
  const lines = diffOutput.split("\n").filter(Boolean);

  for (const line of lines) {
    const parts = line.split("\t");
    const status = parts[0];

    if (status.startsWith("R") && parts.length >= 3) {
      const oldSlug = slugFromPath(parts[1]);
      const newSlug = slugFromPath(parts[2]);
      if (oldSlug && newSlug && oldSlug !== newSlug) {
        rules.push(`/blog/${oldSlug}/  /blog/${newSlug}/  301`);
      }
      continue;
    }

    if (status === "D" && parts.length >= 2) {
      const oldPath = parts[1];
      const oldSlug = slugFromPath(oldPath);
      if (!oldSlug) continue;

      let target = "/";
      const oldContent = runGit(`git show HEAD~1:"${oldPath}"`, root);
      if (oldContent) {
        const category = extractFirstArrayValue(oldContent, "categories");
        if (category) {
          const catSlug = slugify(category);
          if (catSlug) target = `/categories/${catSlug}/`;
        }
      }
      rules.push(`/blog/${oldSlug}/  ${target}  301`);
    }
  }

  return rules;
}

function mergeIntoRedirectsFile(redirectsPath, newRules) {
  let existing = "";
  if (existsSync(redirectsPath)) {
    existing = readFileSync(redirectsPath, "utf-8");
  }

  const startIdx = existing.indexOf(AUTO_START);
  const endIdx = existing.indexOf(AUTO_END);

  let priorAutoRules = [];
  let manualContent = existing;

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const autoBlock = existing.slice(startIdx + AUTO_START.length, endIdx);
    priorAutoRules = autoBlock
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    manualContent =
      existing.slice(0, startIdx).trimEnd() +
      "\n" +
      existing.slice(endIdx + AUTO_END.length).trimStart();
  }

  // De-duplicate by source path (first column) so a repeated slug
  // rename across multiple builds doesn't stack duplicate rules -
  // the newest rule for a given source path always wins.
  const bySource = new Map();
  for (const rule of [...priorAutoRules, ...newRules]) {
    const source = rule.split(/\s+/)[0];
    if (source) bySource.set(source, rule);
  }
  const combined = [...bySource.values()];

  if (combined.length === 0) return { written: false, count: 0 };

  const autoSection = [
    AUTO_START,
    "# redirect-fixer integration eken auto-generate karana ලද redirects.",
    "# Me block eka athulath content eka manual ලෙස wenas nokaranna.",
    ...combined,
    AUTO_END,
  ].join("\n");

  const finalContent = manualContent.trimEnd() + "\n\n" + autoSection + "\n";
  writeFileSync(redirectsPath, finalContent, "utf-8");

  return { written: true, count: combined.length };
}

export default function redirectFixer() {
  return {
    name: "redirect-fixer",
    hooks: {
      "astro:build:start": async ({ logger }) => {
        try {
          const root = process.cwd();
          const redirectsPath = path.join(root, "public", "_redirects");

          if (!runGit("git rev-parse --is-inside-work-tree", root)) {
            logger.warn("redirect-fixer: not a git repository, skipping.");
            return;
          }
          if (!runGit("git rev-parse HEAD~1", root)) {
            logger.warn("redirect-fixer: no parent commit (first commit or shallow clone), skipping.");
            return;
          }

          const diffOutput = runGit(
            'git diff -M --name-status HEAD~1 HEAD -- "src/content/posts/*.md" "src/content/posts/*.mdx"',
            root
          );

          if (!diffOutput) {
            logger.info("redirect-fixer: no post rename/delete detected in last commit.");
            return;
          }

          const newRules = parseDiffLines(diffOutput, root);

          if (newRules.length === 0) {
            logger.info("redirect-fixer: no redirect-worthy changes found.");
            return;
          }

          const result = mergeIntoRedirectsFile(redirectsPath, newRules);
          if (result.written) {
            logger.info(`redirect-fixer: public/_redirects updated with ${result.count} auto-redirect rule(s).`);
          }
        } catch (err) {
          console.warn("redirect-fixer integration skipped due to an error:", err && err.message);
        }
      },
    },
  };
}
