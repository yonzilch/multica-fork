"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import Typography from "@tiptap/extension-typography";
import Mention from "@tiptap/extension-mention";
import Image from "@tiptap/extension-image";
import { Markdown } from "@tiptap/markdown";
import { Extension, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { cn } from "@/lib/utils";
import type { UploadResult } from "@/shared/hooks/use-file-upload";
import { createMentionSuggestion } from "./mention-suggestion";
import "./rich-text-editor.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RichTextEditorProps {
  defaultValue?: string;
  onUpdate?: (markdown: string) => void;
  placeholder?: string;
  editable?: boolean;
  className?: string;
  debounceMs?: number;
  onSubmit?: () => void;
  onUploadFile?: (file: File) => Promise<UploadResult | null>;
}

interface RichTextEditorRef {
  getMarkdown: () => string;
  clearContent: () => void;
  focus: () => void;
  insertFile: (filename: string, url: string, isImage: boolean) => void;
}

const LinkExtension = Link.configure({
  openOnClick: true,
  autolink: true,
  HTMLAttributes: {
    class: "text-primary hover:underline cursor-pointer",
  },
});

const MentionExtension = Mention.configure({
  HTMLAttributes: { class: "mention" },
  suggestion: createMentionSuggestion(),
}).extend({
  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(
        { "data-type": "mention" },
        this.options.HTMLAttributes,
        HTMLAttributes,
        {
          "data-mention-type": node.attrs.type ?? "member",
          "data-mention-id": node.attrs.id,
        },
      ),
      `@${node.attrs.label ?? node.attrs.id}`,
    ];
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      type: {
        default: "member",
        parseHTML: (el: HTMLElement) =>
          el.getAttribute("data-mention-type") ?? "member",
        renderHTML: () => ({}),
      },
    };
  },
  // @tiptap/markdown: custom tokenizer to parse [@Label](mention://type/id)
  markdownTokenizer: {
    name: "mention",
    level: "inline" as const,
    start(src: string) {
      return src.search(/\[@[^\]]+\]\(mention:\/\//);
    },
    tokenize(src: string) {
      const match = src.match(
        /^\[@([^\]]+)\]\(mention:\/\/(\w+)\/([^)]+)\)/,
      );
      if (!match) return undefined;
      return {
        type: "mention",
        raw: match[0],
        attributes: { label: match[1], type: match[2], id: match[3] },
      };
    },
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parseMarkdown: (token: any, helpers: any) => {
    return helpers.createNode("mention", token.attributes);
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  renderMarkdown: (node: any) => {
    const { id, label, type = "member" } = node.attrs || {};
    return `[@${label ?? id}](mention://${type}/${id})`;
  },
});

// ---------------------------------------------------------------------------
// Submit shortcut extension (Mod+Enter)
// ---------------------------------------------------------------------------

function createSubmitExtension(onSubmit: () => void) {
  return Extension.create({
    name: "submitShortcut",
    addKeyboardShortcuts() {
      return {
        "Mod-Enter": () => {
          onSubmit();
          return true;
        },
      };
    },
  });
}

// ---------------------------------------------------------------------------
// File upload extension (paste + drop)
// ---------------------------------------------------------------------------

function createFileUploadExtension(
  onUploadFileRef: React.RefObject<((file: File) => Promise<UploadResult | null>) | undefined>,
) {
  return Extension.create({
    name: "fileUpload",
    addProseMirrorPlugins() {
      const { editor } = this;

      const handleFiles = async (files: FileList, pos?: number) => {
        const handler = onUploadFileRef.current;
        if (!handler) return false;

        let handled = false;
        for (const file of Array.from(files)) {
          handled = true;
          try {
            const result = await handler(file);
            if (!result) continue;

            const isImage = file.type.startsWith("image/");
            if (isImage) {
              editor
                .chain()
                .focus()
                .setImage({ src: result.link, alt: result.filename })
                .run();
            } else {
              // Insert as a markdown link
              const linkText = `[${result.filename}](${result.link})`;
              if (pos !== undefined) {
                editor.chain().focus().insertContentAt(pos, linkText).run();
              } else {
                editor.chain().focus().insertContent(linkText).run();
              }
            }
          } catch {
            // Upload errors handled by the hook/caller via toast
          }
        }
        return handled;
      };

      return [
        new Plugin({
          key: new PluginKey("fileUpload"),
          props: {
            handlePaste(_view, event) {
              const files = event.clipboardData?.files;
              if (!files?.length) return false;
              if (!onUploadFileRef.current) return false;
              handleFiles(files);
              return true;
            },
            handleDrop(_view, event) {
              const files = (event as DragEvent).dataTransfer?.files;
              if (!files?.length) return false;
              if (!onUploadFileRef.current) return false;
              handleFiles(files);
              return true;
            },
          },
        }),
      ];
    },
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const RichTextEditor = forwardRef<RichTextEditorRef, RichTextEditorProps>(
  function RichTextEditor(
    {
      defaultValue = "",
      onUpdate,
      placeholder: placeholderText = "",
      editable = true,
      className,
      debounceMs = 300,
      onSubmit,
      onUploadFile,
    },
    ref,
  ) {
    const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
    const onUpdateRef = useRef(onUpdate);
    const onSubmitRef = useRef(onSubmit);
    const onUploadFileRef = useRef(onUploadFile);

    // Helper to get markdown from @tiptap/markdown extension.
    // Post-processes mention shortcodes [@ id="..." label="..."] → markdown
    // links, using the Tiptap JSON doc for type info, in case the
    // renderMarkdown override doesn't take effect.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const getEditorMarkdown = (ed: any): string => {
      const md: string = ed?.getMarkdown?.() ?? "";
      if (!md || !md.includes("[@ ")) return md;

      // Build type map from editor JSON (which always has the type attr)
      const json = ed?.getJSON?.();
      const typeMap = new Map<string, string>();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      function walk(node: any) {
        if (node?.type === "mention" && node.attrs?.id) {
          typeMap.set(node.attrs.id, node.attrs.type || "member");
        }
        if (node?.content) node.content.forEach(walk);
      }
      if (json) walk(json);

      return md.replace(
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
          const type = typeMap.get(id) || "member";
          const display = type === "issue" ? label : `@${label}`;
          return `[${display}](mention://${type}/${id})`;
        },
      );
    };

    // Keep refs in sync without recreating editor
    onUpdateRef.current = onUpdate;
    onSubmitRef.current = onSubmit;
    onUploadFileRef.current = onUploadFile;

    const editor = useEditor({
      immediatelyRender: false,
      editable,
      content: defaultValue || "",
      contentType: defaultValue ? "markdown" : undefined,
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          link: false,
        }),
        Placeholder.configure({
          placeholder: placeholderText,
        }),
        LinkExtension,
        Typography,
        MentionExtension,
        Image.configure({
          inline: false,
          allowBase64: false,
          HTMLAttributes: { style: "max-width: 100%; height: auto;" },
        }),
        Markdown,
        createSubmitExtension(() => onSubmitRef.current?.()),
        createFileUploadExtension(onUploadFileRef),
      ],
      onUpdate: ({ editor: ed }) => {
        if (!onUpdateRef.current) return;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          onUpdateRef.current?.(ed.getMarkdown());
        }, debounceMs);
      },
      editorProps: {
        handleDOMEvents: {
          click(_view, event) {
            if (event.metaKey || event.ctrlKey) {
              const link = (event.target as HTMLElement).closest("a");
              const href = link?.getAttribute("href");
              if (href && !href.startsWith("mention://")) {
                window.open(href, "_blank", "noopener,noreferrer");
                event.preventDefault();
                return true;
              }
            }
            return false;
          },
        },
        attributes: {
          class: cn("rich-text-editor text-sm outline-none", className),
        },
      },
    });

    // Cleanup debounce on unmount
    useEffect(() => {
      return () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
      };
    }, []);

    useImperativeHandle(ref, () => ({
      getMarkdown: () => editor?.getMarkdown() ?? "",
      clearContent: () => {
        editor?.commands.clearContent();
      },
      focus: () => {
        editor?.commands.focus();
      },
      insertFile: (filename: string, url: string, isImage: boolean) => {
        if (!editor) return;
        if (isImage) {
          editor.chain().focus().setImage({ src: url, alt: filename }).run();
        } else {
          editor.chain().focus().insertContent(`[${filename}](${url})`).run();
        }
      },
    }));

    if (!editor) return null;

    return <EditorContent editor={editor} />;
  },
);

export { RichTextEditor, type RichTextEditorProps, type RichTextEditorRef };
