import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// Beasties (critters successor) - extracts real, page-specific
// above-the-fold CSS and inlines only that into each HTML file's
// <head>. The remaining CSS stays as an external stylesheet but is
// loaded non-blocking via preload:"swap" (Beasties auto-injects
// rel="preload" + onload swap + a <noscript> fallback link).
// Requires build.inlineStylesheets: "never" in astro.config.mjs so a
// real external <link rel="stylesheet"> exists in the built HTML for
// Beasties to read from and split.
function walkHtmlFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkHtmlFiles(full, out);
    } else if (entry.toLowerCase().endsWith(".html")) {
      out.push(full);
    }
  }
  return out;
}
export default function criticalCssInline() {
  return {
    name: "critical-css-inline",
    hooks: {
      "astro:build:done": async ({ dir, logger }) => {
        try {
          const { default: Beasties } = await import("beasties");
          const outDir = fileURLToPath(dir);
          const beasties = new Beasties({
            path: outDir,
            logLevel: "warn",
            preload: "swap",
            pruneSource: false,
            compress: true,
            reduceInlineStyles: false,
          });
          const files = walkHtmlFiles(outDir);
          let processed = 0;
          for (const file of files) {
            try {
              const html = readFileSync(file, "utf-8");
              const result = await beasties.process(html);
              writeFileSync(file, result, "utf-8");
              processed++;
            } catch (err) {
              logger.warn(
                `critical-css-inline: skipped ${path.relative(outDir, file)} - ${err && err.message}`
              );
            }
          }
          logger.info(
            `critical-css-inline: inlined critical CSS for ${processed}/${files.length} page(s).`
          );
        } catch (err) {
          // Self-healing: never fail the build over CSS optimization.
          console.warn(
            "critical-css-inline integration skipped due to an error:",
            err && err.message
          );
        }
      },
    },
  };
}
