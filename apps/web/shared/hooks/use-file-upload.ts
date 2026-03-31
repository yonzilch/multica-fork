"use client";

import { useState, useCallback } from "react";
import { toast } from "sonner";
import { api } from "@/shared/api";
import type { Attachment } from "@/shared/types";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/json",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/wav",
  "application/zip",
]);

function isAllowedType(type: string): boolean {
  // Empty MIME type (browser couldn't determine) — let the server sniff and decide.
  if (!type) return true;
  const mediaType = type.split(";")[0] ?? "";
  return ALLOWED_TYPES.has(mediaType.trim().toLowerCase());
}

export interface UploadResult {
  filename: string;
  link: string;
}

export interface UploadContext {
  issueId?: string;
  commentId?: string;
}

export function useFileUpload() {
  const [uploading, setUploading] = useState(false);

  const upload = useCallback(
    async (file: File, ctx?: UploadContext): Promise<UploadResult | null> => {
      if (file.size > MAX_FILE_SIZE) {
        throw new Error("File exceeds 10 MB limit");
      }
      if (!isAllowedType(file.type)) {
        throw new Error(`File type not allowed: ${file.type}`);
      }

      setUploading(true);
      try {
        const att: Attachment = await api.uploadFile(file, {
          issueId: ctx?.issueId,
          commentId: ctx?.commentId,
        });
        return { filename: att.filename, link: att.url };
      } finally {
        setUploading(false);
      }
    },
    [],
  );

  const uploadWithToast = useCallback(
    async (file: File, ctx?: UploadContext): Promise<UploadResult | null> => {
      try {
        return await upload(file, ctx);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed");
        return null;
      }
    },
    [upload],
  );

  return { upload, uploadWithToast, uploading };
}
