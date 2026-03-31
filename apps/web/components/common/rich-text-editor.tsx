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
import { Extension } from "@tiptap/core";
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

// ---------------------------------------------------------------------------
// Submit shortcut extension (Mod+Enter)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Mention extension configured for markdown serialization
// Stores as: [@Label](mention://type/id)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Link extension — always serialize as [text](url), never <url> autolinks;
// support Cmd+Click / Ctrl+Click to open in new tab.
// ---------------------------------------------------------------------------

const LinkExtension = Link.configure({
  openOnClick: true,
  autolink: true,
  HTMLAttributes: {
    class: "text-primary hover:underline cursor-pointer",
  },
}).extend({
  addStorage() {
    return {
      markdown: {
        serialize: {
          open() {
            return "[";
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          close(_state: any, mark: any) {
            const href = (mark.attrs.href as string).replace(/[\(\)"]/g, "\\$&");
            const title = mark.attrs.title
              ? ` "${(mark.attrs.title as string).replace(/"/g, '\\"')}"`
              : "";
            return `](${href}${title})`;
          },
          mixable: true,
        },
        parse: {},
      },
    };
  },
});

const MentionExtension = Mention.configure({
  HTMLAttributes: { class: "mention" },
  suggestion: createMentionSuggestion(),
}).extend({
  renderHTML({ node, HTMLAttributes }) {
    return [
      "a",
      {
        ...HTMLAttributes,
        href: `mention://${node.attrs.type ?? "member"}/${node.attrs.id}`,
        "data-mention-type": node.attrs.type ?? "member",
        "data-mention-id": node.attrs.id,
      },
      `@${node.attrs.label ?? node.attrs.id}`,
    ];
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      type: {
        default: "member",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-mention-type") ?? "member",
      },
    };
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: { write: (s: string) => void }, node: { attrs: { label?: string; type?: string; id?: string } }) {
          state.write(
            `[@${node.attrs.label ?? node.attrs.id}](mention://${node.attrs.type ?? "member"}/${node.attrs.id})`,
          );
        },
        parse: {},
      },
    };
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

    // Helper to get markdown from @tiptap/markdown extension
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const getEditorMarkdown = (ed: any): string =>
      ed?.getMarkdown?.() ?? "";

    // Keep refs in sync without recreating editor
    onUpdateRef.current = onUpdate;
    onSubmitRef.current = onSubmit;
    onUploadFileRef.current = onUploadFile;

    const editor = useEditor({
      immediatelyRender: false,
      editable,
      content: defaultValue,
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
          onUpdateRef.current?.(getEditorMarkdown(ed));
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
      getMarkdown: () => getEditorMarkdown(editor),
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
