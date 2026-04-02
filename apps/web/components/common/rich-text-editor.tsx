"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { useEditor, EditorContent, ReactNodeViewRenderer } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import Typography from "@tiptap/extension-typography";
import Image from "@tiptap/extension-image";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import { Table } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Slice } from "@tiptap/pm/model";
import { cn } from "@/lib/utils";
import type { UploadResult } from "@/shared/hooks/use-file-upload";
import { BaseMentionExtension } from "./mention-extension";
import { createMentionSuggestion } from "./mention-suggestion";
import { CodeBlockView } from "./code-block-view";
import { markdownToHtml } from "./markdown-to-html";
import "./rich-text-editor.css";

const lowlight = createLowlight(common);

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
  onBlur?: () => void;
  onUploadFile?: (file: File) => Promise<UploadResult | null>;
}

interface RichTextEditorRef {
  getMarkdown: () => string;
  clearContent: () => void;
  focus: () => void;
  /** Upload a file and insert it into the editor (blob preview → upload → replace). */
  uploadFile: (file: File) => void;
}

const LinkExtension = Link.extend({ inclusive: false }).configure({
  openOnClick: true,
  autolink: true,
  linkOnPaste: false,
  HTMLAttributes: {
    class: "text-primary hover:underline cursor-pointer",
  },
});

const MentionExtension = BaseMentionExtension.configure({
  HTMLAttributes: { class: "mention" },
  suggestion: createMentionSuggestion(),
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
// Markdown paste extension — parse pasted markdown text as rich text
// ---------------------------------------------------------------------------

function createMarkdownPasteExtension() {
  return Extension.create({
    name: "markdownPaste",
    addProseMirrorPlugins() {
      const { editor } = this;
      return [
        new Plugin({
          key: new PluginKey("markdownPaste"),
          props: {
            clipboardTextParser(text, _context, plainText) {
              if (!plainText && editor.markdown) {
                const json = editor.markdown.parse(text);
                const node = editor.schema.nodeFromJSON(json);
                return Slice.maxOpen(node.content);
              }
              // Plain text fallback
              const p = editor.schema.nodes.paragraph!;
              const doc = editor.schema.nodes.doc!;
              const paragraph = p.create(null, text ? editor.schema.text(text) : undefined);
              return new Slice(doc.create(null, paragraph).content, 0, 0);
            },
          },
        }),
      ];
    },
  });
}

// ---------------------------------------------------------------------------
// File upload extension (paste + drop) with blob URL instant preview
// ---------------------------------------------------------------------------

function removeImageBySrc(editor: ReturnType<typeof useEditor>, src: string) {
  if (!editor) return;
  const { tr } = editor.state;
  let deleted = false;
  editor.state.doc.descendants((node, pos) => {
    if (deleted) return false;
    if (node.type.name === "image" && node.attrs.src === src) {
      tr.delete(pos, pos + node.nodeSize);
      deleted = true;
      return false;
    }
  });
  if (deleted) editor.view.dispatch(tr);
}

/**
 * Shared upload flow: insert blob preview → upload → replace with real URL.
 * Used by both paste/drop (at cursor) and button upload (at end of doc).
 */
async function uploadAndInsertFile(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor: any,
  file: File,
  handler: (file: File) => Promise<UploadResult | null>,
  pos?: number,
) {
  const isImage = file.type.startsWith("image/");

  if (isImage) {
    const blobUrl = URL.createObjectURL(file);
    const imgAttrs = { src: blobUrl, alt: file.name, uploading: true };
    if (pos !== undefined) {
      editor.chain().focus().insertContentAt(pos, { type: "image", attrs: imgAttrs }).run();
    } else {
      editor.chain().focus().setImage(imgAttrs).run();
    }

    try {
      const result = await handler(file);
      if (result) {
        const { tr } = editor.state;
        editor.state.doc.descendants((node: { type: { name: string }; attrs: { src: string } }, nodePos: number) => {
          if (node.type.name === "image" && node.attrs.src === blobUrl) {
            tr.setNodeMarkup(nodePos, undefined, {
              ...node.attrs,
              src: result.link,
              alt: result.filename,
              uploading: false,
            });
          }
        });
        editor.view.dispatch(tr);
      } else {
        removeImageBySrc(editor, blobUrl);
      }
    } catch {
      removeImageBySrc(editor, blobUrl);
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  } else {
    // Non-image: upload first, then insert link
    const result = await handler(file);
    if (!result) return;
    const linkText = `[${result.filename}](${result.link})`;
    if (pos !== undefined) {
      editor.chain().focus().insertContentAt(pos, linkText).run();
    } else {
      editor.chain().focus().insertContent(linkText).run();
    }
  }
}

function createFileUploadExtension(
  onUploadFileRef: React.RefObject<((file: File) => Promise<UploadResult | null>) | undefined>,
) {
  return Extension.create({
    name: "fileUpload",
    addProseMirrorPlugins() {
      const { editor } = this;

      const handleFiles = async (files: FileList) => {
        const handler = onUploadFileRef.current;
        if (!handler) return false;
        for (const file of Array.from(files)) {
          await uploadAndInsertFile(editor, file, handler);
        }
        return true;
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
      onBlur,
      onUploadFile,
    },
    ref,
  ) {
    const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
    const onUpdateRef = useRef(onUpdate);
    const onSubmitRef = useRef(onSubmit);
    const onBlurRef = useRef(onBlur);
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
    onBlurRef.current = onBlur;
    onUploadFileRef.current = onUploadFile;

    const editor = useEditor({
      immediatelyRender: false,
      editable,
      content: defaultValue ? markdownToHtml(defaultValue) : "",
      extensions: [
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
        Placeholder.configure({
          placeholder: placeholderText,
        }),
        LinkExtension,
        Typography,
        MentionExtension,
        Image.extend({
          addAttributes() {
            return {
              ...this.parent?.(),
              uploading: {
                default: false,
                renderHTML: (attrs) => (attrs.uploading ? { "data-uploading": "" } : {}),
                parseHTML: (el) => el.hasAttribute("data-uploading"),
              },
            };
          },
        }).configure({
          inline: false,
          allowBase64: false,
          HTMLAttributes: { style: "max-width: 100%; height: auto;" },
        }),
        Table.configure({ resizable: false }),
        TableRow,
        TableHeader,
        TableCell,
        Markdown,
        createMarkdownPasteExtension(),
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
      onBlur: () => {
        onBlurRef.current?.();
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
      uploadFile: (file: File) => {
        if (!editor || !onUploadFileRef.current) return;
        // Insert at end of doc to avoid replacing selection
        const endPos = editor.state.doc.content.size;
        uploadAndInsertFile(editor, file, onUploadFileRef.current, endPos);
      },
    }));

    if (!editor) return null;

    return <EditorContent editor={editor} />;
  },
);

export { RichTextEditor, type RichTextEditorProps, type RichTextEditorRef };
