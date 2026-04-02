"use client";

import { useEffect, useRef, memo } from "react";
import { useEditor, EditorContent, ReactNodeViewRenderer } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import { Table } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import { cn } from "@/lib/utils";
import { BaseMentionExtension } from "./mention-extension";
import { CodeBlockView } from "./code-block-view";
import { markdownToHtml } from "./markdown-to-html";
import "./rich-text-editor.css";

const lowlight = createLowlight(common);

// ---------------------------------------------------------------------------
// Module-level extension singletons (prevent useEditor re-creation)
// ---------------------------------------------------------------------------

const extensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    link: false,
    codeBlock: false,
  }),
  CodeBlockLowlight.extend({
    addNodeView() {
      return ReactNodeViewRenderer(CodeBlockView);
    },
  }).configure({ lowlight }),
  Link.configure({
    openOnClick: false,
    autolink: false,
    HTMLAttributes: {
      class: "text-primary hover:underline cursor-pointer",
    },
  }),
  BaseMentionExtension.configure({
    HTMLAttributes: { class: "mention" },
  }),
  Image.configure({
    inline: false,
    allowBase64: false,
    HTMLAttributes: {
      class: "rounded-md my-2",
      style: "max-width: 100%; height: auto;",
    },
  }),
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
  Markdown,
];

// ---------------------------------------------------------------------------
// ReadonlyEditor
// ---------------------------------------------------------------------------

interface ReadonlyEditorProps {
  content: string;
  className?: string;
}

/**
 * ReadonlyEditor — lightweight Tiptap wrapper for displaying markdown content.
 *
 * Content is converted from markdown to HTML via `marked` before loading,
 * bypassing @tiptap/markdown's beta parser which drops complex content.
 * The Markdown extension is kept for getMarkdown() serialization only.
 */
const ReadonlyEditor = memo(function ReadonlyEditor({
  content,
  className,
}: ReadonlyEditorProps) {
  const prevContentRef = useRef(content);

  const editor = useEditor({
    immediatelyRender: false,
    editable: false,
    content: markdownToHtml(content),
    extensions,
    editorProps: {
      attributes: {
        class: cn("rich-text-editor readonly text-sm", className),
      },
      handleDOMEvents: {
        click(_view, event) {
          const target = event.target as HTMLElement;
          // Skip links inside NodeView wrappers — they handle their own clicks
          // (e.g. IssueMentionCard uses Next.js Link for client-side navigation)
          if (target.closest("[data-node-view-wrapper]")) return false;
          const link = target.closest("a");
          const href = link?.getAttribute("href");
          if (href && !href.startsWith("mention://")) {
            event.preventDefault();
            window.open(href, "_blank", "noopener,noreferrer");
            return true;
          }
          return false;
        },
      },
    },
  });

  // Update content when prop changes (e.g. after editing a comment)
  useEffect(() => {
    if (!editor || content === prevContentRef.current) return;
    prevContentRef.current = content;
    editor.commands.setContent(markdownToHtml(content));
  }, [editor, content]);

  if (!editor) return null;
  return <EditorContent editor={editor} />;
});

export { ReadonlyEditor, type ReadonlyEditorProps };
