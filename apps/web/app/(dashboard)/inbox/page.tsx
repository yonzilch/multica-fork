"use client";

import { useState, useEffect, useCallback } from "react";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  CircleDot,
  GitPullRequest,
  MessageSquare,
  ArrowRightLeft,
} from "lucide-react";
import type { InboxItem, InboxItemType, InboxSeverity, InboxNewPayload } from "@multica/types";
import { Button } from "@multica/ui/components/ui/button";
import { api } from "@/shared/api";
import { useWSEvent } from "@/features/realtime";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const severityOrder: Record<InboxSeverity, number> = {
  action_required: 0,
  attention: 1,
  info: 2,
};

const typeIcons: Record<InboxItemType, typeof AlertCircle> = {
  agent_blocked: AlertCircle,
  review_requested: GitPullRequest,
  issue_assigned: CircleDot,
  agent_completed: CheckCircle2,
  mentioned: MessageSquare,
  status_change: ArrowRightLeft,
};

const severityColors: Record<InboxSeverity, string> = {
  action_required: "text-destructive",
  attention: "text-warning",
  info: "text-muted-foreground",
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function InboxListItem({
  item,
  isSelected,
  onClick,
}: {
  item: InboxItem;
  isSelected: boolean;
  onClick: () => void;
}) {
  const Icon = typeIcons[item.type] ?? CircleDot;
  const colorClass = severityColors[item.severity];

  return (
    <button
      onClick={onClick}
      className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors ${
        isSelected ? "bg-accent" : "hover:bg-accent/50"
      } ${!item.read ? "font-medium" : ""}`}
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${colorClass}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm">{item.title}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {timeAgo(item.created_at)}
          </span>
        </div>
        {(item.type === "agent_blocked" || item.type === "review_requested") && (
          <div className="mt-0.5 flex items-center gap-1.5">
            <Bot className="h-3 w-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Agent action</span>
          </div>
        )}
      </div>
      {!item.read && (
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
      )}
    </button>
  );
}

function InboxDetail({
  item,
  onMarkRead,
}: {
  item: InboxItem;
  onMarkRead: (id: string) => void;
}) {
  const Icon = typeIcons[item.type] ?? CircleDot;
  const colorClass = severityColors[item.severity];

  const severityLabel: Record<InboxSeverity, string> = {
    action_required: "Action required",
    attention: "Needs attention",
    info: "Info",
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Icon className={`mt-1 h-5 w-5 shrink-0 ${colorClass}`} />
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">{item.title}</h2>
          <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
            <span className={colorClass}>{severityLabel[item.severity]}</span>
            <span>·</span>
            <span>{timeAgo(item.created_at)}</span>
          </div>
        </div>
        {!item.read && (
          <Button
            variant="outline"
            size="xs"
            onClick={() => onMarkRead(item.id)}
            className="shrink-0"
          >
            Mark read
          </Button>
        )}
      </div>

      {/* Body */}
      {item.body && (
        <div className="mt-6 whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">
          {item.body}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function InboxPage() {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .listInbox()
      .then((data) => {
        const sorted = [...data].sort(
          (a, b) =>
            severityOrder[a.severity] - severityOrder[b.severity] ||
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        setItems(sorted);
        if (sorted.length > 0) setSelectedId(sorted[0]!.id);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useWSEvent(
    "inbox:new",
    useCallback((payload: unknown) => {
      const { item } = payload as InboxNewPayload;
      setItems((prev) => {
        if (prev.some((i) => i.id === item.id)) return prev;
        return [item, ...prev];
      });
    }, []),
  );

  const handleMarkRead = async (id: string) => {
    try {
      await api.markInboxRead(id);
      setItems((prev) =>
        prev.map((i) => (i.id === id ? { ...i, read: true } : i))
      );
    } catch (err) {
      console.error("Failed to mark read:", err);
    }
  };

  const selected = items.find((i) => i.id === selectedId) ?? null;
  const unreadCount = items.filter((i) => !i.read).length;

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Left column — inbox list */}
      <div className="w-80 shrink-0 overflow-y-auto border-r">
        <div className="flex h-12 items-center border-b px-4">
          <h1 className="text-sm font-semibold">Inbox</h1>
          {unreadCount > 0 && (
            <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
              {unreadCount}
            </span>
          )}
        </div>
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-sm text-muted-foreground">
            <p>No notifications yet</p>
          </div>
        ) : (
          <div className="divide-y">
            {items.map((item) => (
              <InboxListItem
                key={item.id}
                item={item}
                isSelected={item.id === selectedId}
                onClick={() => setSelectedId(item.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Right column — detail */}
      <div className="flex-1 overflow-y-auto">
        {selected ? (
          <InboxDetail item={selected} onMarkRead={handleMarkRead} />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            {items.length === 0
              ? "Your inbox is empty"
              : "Select an item to view details"}
          </div>
        )}
      </div>
    </div>
  );
}
