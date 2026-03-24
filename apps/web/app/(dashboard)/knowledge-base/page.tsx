"use client";

import { useState } from "react";
import {
  FileText,
  Plus,
  Search,
  Link as LinkIcon,
} from "lucide-react";
import { Input } from "@multica/ui/components/ui/input";
import { Button } from "@multica/ui/components/ui/button";
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface KBDocument {
  id: string;
  title: string;
  content: string;
  createdBy: string;
  updatedAt: string;
  referencedBy: string[];
}

// ---------------------------------------------------------------------------
// Simple Markdown-ish renderer (handles headers, code blocks, tables, lists)
// ---------------------------------------------------------------------------

function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Code block
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) {
        codeLines.push(lines[i]!);
        i++;
      }
      i++; // skip closing ```
      elements.push(
        <pre
          key={`code-${i}`}
          className="my-3 overflow-x-auto rounded-md bg-muted px-4 py-3 text-[13px] leading-relaxed"
        >
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
      continue;
    }

    // Table (simplified: detect | pipes)
    if (line.includes("|") && line.trim().startsWith("|")) {
      const tableRows: string[] = [];
      while (i < lines.length && lines[i]!.includes("|") && lines[i]!.trim().startsWith("|")) {
        tableRows.push(lines[i]!);
        i++;
      }
      // Filter out separator rows (|---|---|)
      const dataRows = tableRows.filter((r) => !r.match(/^\|[\s-|]+\|$/));
      if (dataRows.length > 0) {
        const parseRow = (row: string) =>
          row.split("|").filter((c) => c.trim() !== "").map((c) => c.trim());
        const header = parseRow(dataRows[0]!);
        const body = dataRows.slice(1).map(parseRow);
        elements.push(
          <div key={`table-${i}`} className="my-3 overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b">
                  {header.map((h, hi) => (
                    <th key={hi} className="py-1.5 pr-4 text-left font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {body.map((row, ri) => (
                  <tr key={ri} className="border-b last:border-0">
                    {row.map((cell, ci) => (
                      <td key={ci} className="py-1.5 pr-4 text-foreground/80">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      continue;
    }

    // Heading
    if (line.startsWith("## ")) {
      elements.push(
        <h2 key={`h2-${i}`} className="mt-6 mb-2 text-[15px] font-semibold">
          {line.slice(3)}
        </h2>,
      );
      i++;
      continue;
    }
    if (line.startsWith("### ")) {
      elements.push(
        <h3 key={`h3-${i}`} className="mt-4 mb-1.5 text-[14px] font-medium">
          {line.slice(4)}
        </h3>,
      );
      i++;
      continue;
    }

    // List item
    if (/^- \[[ x]\] /.test(line)) {
      const checked = line.includes("[x]");
      const text = line.replace(/^- \[[ x]\] /, "");
      elements.push(
        <div key={`check-${i}`} className="flex items-center gap-2 py-0.5 text-[13px] text-foreground/80">
          <input type="checkbox" checked={checked} readOnly className="h-3.5 w-3.5 rounded" />
          <span>{text}</span>
        </div>
      );
      i++;
      continue;
    }
    if (line.startsWith("- ")) {
      elements.push(
        <div key={`li-${i}`} className="flex gap-2 py-0.5 text-[13px] text-foreground/80">
          <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-foreground/40" />
          <span>{renderInline(line.slice(2))}</span>
        </div>
      );
      i++;
      continue;
    }
    // Numbered list
    if (/^\d+\. /.test(line)) {
      const num = line.match(/^(\d+)\. /)![1]!;
      const text = line.replace(/^\d+\. /, "");
      elements.push(
        <div key={`ol-${i}`} className="flex gap-2 py-0.5 text-[13px] text-foreground/80">
          <span className="w-4 shrink-0 text-right text-muted-foreground">{num}.</span>
          <span>{text}</span>
        </div>
      );
      i++;
      continue;
    }

    // Empty line — guard is redundant since line is already asserted, but keeps TS happy
    if (line.trim() === "") {
      elements.push(<div key={`br-${i}`} className="h-2" />);
      i++;
      continue;
    }

    // Paragraph
    elements.push(
      <p key={`p-${i}`} className="text-[13px] leading-[1.7] text-foreground/85">
        {renderInline(line)}
      </p>
    );
    i++;
  }

  return elements;
}

function renderInline(text: string): React.ReactNode {
  // Handle inline code `...`
  const parts = text.split(/(`[^`]+`)/);
  return parts.map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={i} className="rounded bg-muted px-1 py-0.5 text-[12px]">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function DocListItem({
  doc,
  isSelected,
  onClick,
}: {
  doc: KBDocument;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-start gap-2.5 px-4 py-2.5 text-left transition-colors ${
        isSelected ? "bg-accent" : "hover:bg-accent/50"
      }`}
    >
      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium">{doc.title}</div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>{doc.createdBy}</span>
          <span>·</span>
          <span>{timeAgo(doc.updatedAt)}</span>
        </div>
      </div>
    </button>
  );
}

function DocDetail({ doc }: { doc: KBDocument }) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-8 py-8">
        {/* Title */}
        <h1 className="text-xl font-semibold tracking-tight">{doc.title}</h1>

        {/* Meta */}
        <div className="mt-2 flex items-center gap-3 text-[12px] text-muted-foreground">
          <span>By {doc.createdBy}</span>
          <span>·</span>
          <span>Updated {timeAgo(doc.updatedAt)}</span>
        </div>

        {/* Content */}
        <div className="mt-6">{renderMarkdown(doc.content)}</div>

        {/* Referenced by */}
        {doc.referencedBy.length > 0 && (
          <div className="mt-10 border-t pt-4">
            <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <LinkIcon className="h-3 w-3" />
              <span>Referenced by</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {doc.referencedBy.map((ref) => (
                <span
                  key={ref}
                  className="rounded bg-muted px-2 py-0.5 text-[12px] font-mono"
                >
                  {ref}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function KnowledgeBasePage() {
  const [documents] = useState<KBDocument[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [search, setSearch] = useState("");

  const filtered = search
    ? documents.filter((d) =>
        d.title.toLowerCase().includes(search.toLowerCase())
      )
    : documents;

  const selected = documents.find((d) => d.id === selectedId) ?? null;

  return (
    <div className="flex h-full">
      {/* Left: Document list */}
      <div className="w-72 shrink-0 overflow-y-auto border-r">
        <div className="flex h-11 items-center justify-between border-b px-4">
          <h1 className="text-sm font-semibold">Knowledge Base</h1>
          <Button variant="ghost" size="icon-xs">
            <Plus className="h-4 w-4 text-muted-foreground" />
          </Button>
        </div>

        {/* Search */}
        <div className="border-b px-3 py-2">
          <div className="flex items-center gap-2 rounded-md border bg-background px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search docs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border-0 bg-transparent shadow-none focus-visible:ring-0 flex-1 text-[13px]"
            />
          </div>
        </div>

        {/* Document list */}
        <div className="divide-y">
          {filtered.map((doc) => (
            <DocListItem
              key={doc.id}
              doc={doc}
              isSelected={doc.id === selectedId}
              onClick={() => setSelectedId(doc.id)}
            />
          ))}
          {filtered.length === 0 && (
            <div className="px-4 py-8 text-center text-[13px] text-muted-foreground">
              No documents found
            </div>
          )}
        </div>
      </div>

      {/* Right: Document content */}
      {selected ? (
        <DocDetail doc={selected} />
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Select a document
        </div>
      )}
    </div>
  );
}
