import remarkAutoInternalLinks from "../lib/remarkAutoInternalLinks.mjs";

// FIXED (Astro "markdown.remarkPlugins option has been deprecated"
// warning): the top-level markdown.remarkPlugins shorthand in
// astro.config.mjs has been deprecated in favor of registering
// unified/remark plugins directly through an integration's
// astro:config:setup hook + updateConfig(). This integration is a
// zero-behavior-change replacement - it registers the exact same
// remarkAutoInternalLinks plugin (logic unchanged, see
// src/lib/remarkAutoInternalLinks.mjs), just through the currently
// recommended API surface instead of the deprecated config key.
// Any existing markdown.remarkPlugins entries already present in the
// resolved config (none, currently) are preserved and merged rather
// than overwritten, so this integration is safe to combine with
// other plugin-registering integrations in the future.
export default function markdownPlugins() {
  return {
    name: "markdown-plugins",
    hooks: {
      "astro:config:setup": ({ updateConfig, config }) => {
        const existingRemarkPlugins = config.markdown?.remarkPlugins ?? [];
        updateConfig({
          markdown: {
            remarkPlugins: [...existingRemarkPlugins, remarkAutoInternalLinks],
          },
        });
      },
    },
  };
}
