"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import {
  Columns3,
  List,
  Plus,
} from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  closestCorners,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Issue, IssueStatus, IssuePriority } from "@multica/types";
import { STATUS_CONFIG, PRIORITY_CONFIG, ALL_STATUSES, PRIORITY_ORDER } from "@/features/issues/config";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@multica/ui/components/ui/dialog";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Textarea } from "@multica/ui/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@multica/ui/components/ui/select";
import { ActorAvatar } from "@multica/ui/components/common/actor-avatar";
import { StatusIcon, PriorityIcon } from "@/features/issues/components";
import { api } from "@/shared/api";
import { useActorName } from "@/features/workspace";
import { useWSEvent } from "@/features/realtime";
import type { IssueCreatedPayload, IssueUpdatedPayload, IssueDeletedPayload } from "@multica/types";

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Board View — Card
// ---------------------------------------------------------------------------

function BoardCardContent({ issue }: { issue: Issue }) {
  const { getActorName, getActorInitials } = useActorName();
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <PriorityIcon priority={issue.priority} />
        <span>{issue.id.slice(0, 8)}</span>
      </div>
      <p className="mt-1.5 text-[13px] leading-snug">{issue.title}</p>
      <div className="mt-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {issue.assignee_type && issue.assignee_id && (
            <ActorAvatar
              actorType={issue.assignee_type}
              actorId={issue.assignee_id}
              size={20}
              getName={getActorName}
              getInitials={getActorInitials}
            />
          )}
        </div>
        {issue.due_date && (
          <span className="text-xs text-muted-foreground">
            {formatDate(issue.due_date)}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Draggable card wrapper
// ---------------------------------------------------------------------------

function DraggableBoardCard({ issue }: { issue: Issue }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: issue.id,
    data: { status: issue.status },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={isDragging ? "opacity-30" : ""}
      onClickCapture={(e) => {
        if (isDragging) e.stopPropagation();
      }}
    >
      <Link
        href={`/issues/${issue.id}`}
        className="block transition-colors hover:opacity-80"
      >
        <BoardCardContent issue={issue} />
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Droppable column
// ---------------------------------------------------------------------------

function DroppableColumn({
  status,
  issues,
}: {
  status: IssueStatus;
  issues: Issue[];
}) {
  const cfg = STATUS_CONFIG[status];
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div className="flex min-w-52 flex-1 flex-col">
      <div className="mb-2 flex items-center gap-2 px-1">
        <StatusIcon status={status} className="h-3.5 w-3.5" />
        <span className="text-xs font-medium">{cfg.label}</span>
        <span className="text-xs text-muted-foreground">{issues.length}</span>
      </div>
      <div
        ref={setNodeRef}
        className={`flex-1 space-y-1.5 overflow-y-auto rounded-lg p-1 transition-colors ${
          isOver ? "bg-accent/40" : ""
        }`}
      >
        {issues.map((issue) => (
          <DraggableBoardCard key={issue.id} issue={issue} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Board View (with DnD)
// ---------------------------------------------------------------------------

function BoardView({
  issues,
  onMoveIssue,
}: {
  issues: Issue[];
  onMoveIssue: (issueId: string, newStatus: IssueStatus) => void;
}) {
  const [activeIssue, setActiveIssue] = useState<Issue | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

  const visibleStatuses: IssueStatus[] = [
    "backlog",
    "todo",
    "in_progress",
    "in_review",
    "done",
  ];

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const issue = issues.find((i) => i.id === event.active.id);
      if (issue) setActiveIssue(issue);
    },
    [issues]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveIssue(null);
      const { active, over } = event;
      if (!over) return;

      const issueId = active.id as string;
      let targetStatus: IssueStatus | undefined;

      if (visibleStatuses.includes(over.id as IssueStatus)) {
        targetStatus = over.id as IssueStatus;
      } else {
        const targetIssue = issues.find((i) => i.id === over.id);
        if (targetIssue) targetStatus = targetIssue.status;
      }

      if (targetStatus) {
        const currentIssue = issues.find((i) => i.id === issueId);
        if (currentIssue && currentIssue.status !== targetStatus) {
          onMoveIssue(issueId, targetStatus);
        }
      }
    },
    [issues, onMoveIssue, visibleStatuses]
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-full gap-3 overflow-x-auto p-4">
        {visibleStatuses.map((status) => (
          <DroppableColumn
            key={status}
            status={status}
            issues={issues.filter((i) => i.status === status)}
          />
        ))}
      </div>

      <DragOverlay>
        {activeIssue ? (
          <div className="w-64 rotate-2 opacity-90 shadow-lg">
            <BoardCardContent issue={activeIssue} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

// ---------------------------------------------------------------------------
// List View
// ---------------------------------------------------------------------------

function ListRow({ issue }: { issue: Issue }) {
  const { getActorName, getActorInitials } = useActorName();
  return (
    <Link
      href={`/issues/${issue.id}`}
      className="flex h-9 items-center gap-2 px-4 text-[13px] transition-colors hover:bg-accent/50"
    >
      <PriorityIcon priority={issue.priority} />
      <span className="w-16 shrink-0 text-xs text-muted-foreground">
        {issue.id.slice(0, 8)}
      </span>
      <StatusIcon status={issue.status} className="h-3.5 w-3.5" />
      <span className="min-w-0 flex-1 truncate">{issue.title}</span>
      {issue.due_date && (
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatDate(issue.due_date)}
        </span>
      )}
      {issue.assignee_type && issue.assignee_id && (
        <ActorAvatar
          actorType={issue.assignee_type}
          actorId={issue.assignee_id}
          size={20}
          getName={getActorName}
          getInitials={getActorInitials}
        />
      )}
    </Link>
  );
}

function ListView({ issues }: { issues: Issue[] }) {
  const groupOrder: IssueStatus[] = [
    "in_review",
    "in_progress",
    "todo",
    "backlog",
    "done",
  ];

  return (
    <div className="overflow-y-auto">
      {groupOrder.map((status) => {
        const cfg = STATUS_CONFIG[status];
        const filtered = issues.filter((i) => i.status === status);
        if (filtered.length === 0) return null;
        return (
          <div key={status}>
            <div className="flex h-8 items-center gap-2 border-b px-4">
              <StatusIcon status={status} className="h-3.5 w-3.5" />
              <span className="text-xs font-medium">{cfg.label}</span>
              <span className="text-xs text-muted-foreground">{filtered.length}</span>
            </div>
            {filtered.map((issue) => (
              <ListRow key={issue.id} issue={issue} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create Issue Dialog
// ---------------------------------------------------------------------------

function CreateIssueDialog({ onCreated }: { onCreated: (issue: Issue) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<IssueStatus>("todo");
  const [priority, setPriority] = useState<IssuePriority>("none");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setTitle("");
    setDescription("");
    setStatus("todo");
    setPriority("none");
  };

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      const issue = await api.createIssue({
        title: title.trim(),
        description: description.trim() || undefined,
        status,
        priority,
      });
      onCreated(issue);
      reset();
      setOpen(false);
    } catch (err) {
      console.error("Failed to create issue:", err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger
        render={
          <Button size="sm">
            <Plus className="h-3.5 w-3.5" />
            New Issue
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Issue</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <Input
            autoFocus
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder="Issue title"
          />
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add description..."
            rows={3}
            className="resize-none"
          />
          <div className="flex items-center gap-3 flex-wrap">
            {/* Status selector */}
            <Select value={status} onValueChange={(v) => setStatus(v as IssueStatus)}>
              <SelectTrigger size="sm" className="text-xs">
                <StatusIcon status={status} className="h-3.5 w-3.5" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ALL_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{STATUS_CONFIG[s].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Priority selector */}
            <Select value={priority} onValueChange={(v) => setPriority(v as IssuePriority)}>
              <SelectTrigger size="sm" className="text-xs">
                <PriorityIcon priority={priority} />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITY_ORDER.map((p) => (
                  <SelectItem key={p} value={p}>{PRIORITY_CONFIG[p].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={handleSubmit}
            disabled={!title.trim() || submitting}
          >
            {submitting ? "Creating..." : "Create Issue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type ViewMode = "board" | "list";

export default function IssuesPage() {
  const [view, setView] = useState<ViewMode>("board");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<IssueStatus | "">("");
  const [filterPriority, setFilterPriority] = useState<IssuePriority | "">("");

  useEffect(() => {
    setLoading(true);
    api
      .listIssues({
        limit: 200,
        ...(filterStatus ? { status: filterStatus } : {}),
        ...(filterPriority ? { priority: filterPriority } : {}),
      })
      .then((res) => {
        setIssues(res.issues);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [filterStatus, filterPriority]);

  // Real-time updates
  useWSEvent(
    "issue:created",
    useCallback((payload: unknown) => {
      const { issue } = payload as IssueCreatedPayload;
      setIssues((prev) => {
        if (prev.some((i) => i.id === issue.id)) return prev;
        return [...prev, issue];
      });
    }, []),
  );

  useWSEvent(
    "issue:updated",
    useCallback((payload: unknown) => {
      const { issue } = payload as IssueUpdatedPayload;
      setIssues((prev) => prev.map((i) => (i.id === issue.id ? issue : i)));
    }, []),
  );

  useWSEvent(
    "issue:deleted",
    useCallback((payload: unknown) => {
      const { issue_id } = payload as IssueDeletedPayload;
      setIssues((prev) => prev.filter((i) => i.id !== issue_id));
    }, []),
  );

  const handleMoveIssue = useCallback(
    (issueId: string, newStatus: IssueStatus) => {
      // Optimistic update
      setIssues((prev) =>
        prev.map((issue) =>
          issue.id === issueId ? { ...issue, status: newStatus } : issue
        )
      );

      // Persist to API
      api.updateIssue(issueId, { status: newStatus }).catch((err) => {
        console.error("Failed to update issue:", err);
        // Revert on error
        api.listIssues({ limit: 200 }).then((res) => setIssues(res.issues));
      });
    },
    []
  );

  const handleIssueCreated = useCallback((issue: Issue) => {
    setIssues((prev) => {
      if (prev.some((i) => i.id === issue.id)) return prev;
      return [...prev, issue];
    });
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex h-11 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold">All Issues</h1>
          <div className="ml-2 flex items-center rounded-md border p-0.5">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setView("board")}
              className={
                view === "board"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }
            >
              <Columns3 className="h-3 w-3" />
              Board
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setView("list")}
              className={
                view === "list"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }
            >
              <List className="h-3 w-3" />
              List
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Select value={filterStatus || undefined} onValueChange={(v) => setFilterStatus((v ?? "") as IssueStatus | "")}>
              <SelectTrigger size="sm" className="text-xs">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All Status</SelectItem>
                {ALL_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{STATUS_CONFIG[s].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterPriority || undefined} onValueChange={(v) => setFilterPriority((v ?? "") as IssuePriority | "")}>
              <SelectTrigger size="sm" className="text-xs">
                <SelectValue placeholder="All Priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All Priority</SelectItem>
                {PRIORITY_ORDER.map((p) => (
                  <SelectItem key={p} value={p}>{PRIORITY_CONFIG[p].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <CreateIssueDialog onCreated={handleIssueCreated} />
      </div>

      <div className="flex-1 overflow-hidden">
        {view === "board" ? (
          <BoardView issues={issues} onMoveIssue={handleMoveIssue} />
        ) : (
          <ListView issues={issues} />
        )}
      </div>
    </div>
  );
}
