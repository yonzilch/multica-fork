import { Marked } from "marked";
import { preprocessLinks } from "@/components/markdown/linkify";

/**
 * Dedicated Marked instance for converting markdown → Tiptap-compatible HTML.
 *
 * Uses a separate instance (not the global `marked`) to avoid interfering with
 * @tiptap/markdown's internal marked instance. Custom renderer ensures output
 * matches Tiptap's ProseMirror schema requirements (e.g. block content in cells).
 */
const tiptapMarked = new Marked();

tiptapMarked.use({
  renderer: {
    // Tiptap's TableCell/TableHeader nodes require `content: "block+"`.
    // Default marked outputs bare inline content in <td>/<th>, which
    // ProseMirror silently drops. Wrap in <p> so it's valid block content.
    tablecell({ tokens, header }) {
      const tag = header ? "th" : "td";
      const content = this.parser.parseInline(tokens);
      return `<${tag}><p>${content}</p></${tag}>\n`;
    },
  },
});

// ---------------------------------------------------------------------------
// Mention preprocessing
// ---------------------------------------------------------------------------

/**
 * Convert mention link syntax to HTML spans matching Tiptap's Mention
 * extension parseHTML expectations (data-type, data-id, data-label, data-mention-type).
 */
function mentionsToHtml(text: string): string {
  return text.replace(
    /\[@?([^\]]+)\]\(mention:\/\/(\w+)\/([^)]+)\)/g,
    (_match, label: string, type: string, id: string) => {
      const prefix = type === "issue" ? "" : "@";
      return (
        `<span data-type="mention" data-id="${id}" data-label="${label}"` +
        ` data-mention-type="${type}">${prefix}${label}</span>`
      );
    },
  );
}

/**
 * Convert legacy mention shortcodes [@ id="UUID" label="LABEL"] to the
 * standard markdown link format before further processing.
 */
function preprocessMentionShortcodes(text: string): string {
  if (!text.includes("[@ ")) return text;
  return text.replace(
    /\[@\s+([^\]]*)\]/g,
    (match: string, attrString: string) => {
      const attrs: Record<string, string> = {};
      const re = /(\w+)="([^"]*)"/g;
      let m;
      while ((m = re.exec(attrString)) !== null) {
        if (m[1] && m[2] !== undefined) attrs[m[1]] = m[2];
      }
      const { id, label } = attrs;
      if (!id || !label) return match;
      return `[@${label}](mention://member/${id})`;
    },
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert a markdown string to Tiptap-compatible HTML.
 *
 * Pipeline:
 *   1. Legacy mention shortcodes → standard mention links
 *   2. Raw URLs → markdown links (linkify)
 *   3. Mention links → <span data-type="mention" ...> HTML
 *   4. Marked renders everything else (tables, lists, headings, code, hr…)
 *      with custom renderer ensuring ProseMirror schema compatibility
 *
 * The result is loaded into Tiptap as HTML (no contentType: "markdown"),
 * bypassing @tiptap/markdown's beta parser entirely. The Markdown extension
 * is still loaded for getMarkdown() serialization on save.
 */
export function markdownToHtml(markdown: string): string {
  if (!markdown) return "";
  const step1 = preprocessMentionShortcodes(markdown);
  const step2 = preprocessLinks(step1);
  const step3 = mentionsToHtml(step2);
  return tiptapMarked.parse(step3) as string;
}
