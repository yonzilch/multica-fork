"use client";

import { useRef, useState } from "react";
import { ArrowUp, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RichTextEditor, type RichTextEditorRef } from "@/components/common/rich-text-editor";
import { useFileUpload } from "@/shared/hooks/use-file-upload";

interface CommentInputProps {
  issueId: string;
  onSubmit: (content: string) => Promise<void>;
}

function CommentInput({ issueId, onSubmit }: CommentInputProps) {
  const editorRef = useRef<RichTextEditorRef>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isEmpty, setIsEmpty] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const { uploadWithToast, uploading } = useFileUpload();

  const handleUpload = (file: File) => uploadWithToast(file, { issueId });

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const result = await handleUpload(file);
    if (result) {
      editorRef.current?.insertFile(result.filename, result.link, file.type.startsWith("image/"));
    }
  };

  const handleSubmit = async () => {
    const content = editorRef.current?.getMarkdown()?.replace(/(\n\s*)+$/, "").trim();
    if (!content || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(content);
      editorRef.current?.clearContent();
      setIsEmpty(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative rounded-lg bg-card ring-1 ring-border">
      <div className="min-h-20 max-h-48 overflow-y-auto px-3 py-2 pb-8">
        <RichTextEditor
          ref={editorRef}
          placeholder="Leave a comment..."
          onUpdate={(md) => setIsEmpty(!md.trim())}
          onSubmit={handleSubmit}
          onUploadFile={handleUpload}
          debounceMs={100}
        />
      </div>
      <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="text-muted-foreground hover:text-foreground"
        >
          <Paperclip className="h-4 w-4" />
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFileSelect}
        />
        <Button
          size="icon-sm"
          disabled={isEmpty || submitting}
          onClick={handleSubmit}
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export { CommentInput };
