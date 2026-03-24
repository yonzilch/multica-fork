"use client";

import { use, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronRight,
  GitBranch,
  Link2,
  Pencil,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@multica/ui/components/ui/alert-dialog";
import { Calendar } from "@multica/ui/components/ui/calendar";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@multica/ui/components/ui/popover";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { ActorAvatar } from "@multica/ui/components/common/actor-avatar";
import type { Issue, Comment, UpdateIssueRequest } from "@multica/types";
import { StatusPicker, PriorityPicker, AssigneePicker } from "@/features/issues/components";
import { api } from "@/shared/api";
import { useAuthStore } from "@/features/auth";
import { useActorName } from "@/features/workspace";
import { useWSEvent } from "@/features/realtime";
import type { CommentCreatedPayload, CommentUpdatedPayload, CommentDeletedPayload } from "@multica/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function shortDate(date: string | null): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Property row
// ---------------------------------------------------------------------------

function PropRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[32px] items-center gap-3 rounded-md px-2 -mx-2 hover:bg-accent/50 transition-colors">
      <span className="w-20 shrink-0 text-[13px] text-muted-foreground">{label}</span>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5 text-[13px]">
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Due Date Picker
// ---------------------------------------------------------------------------

function DueDatePicker({
  dueDate,
  onUpdate,
}: {
  dueDate: string | null;
  onUpdate: (updates: Partial<UpdateIssueRequest>) => void;
}) {
  const [open, setOpen] = useState(false);
  const date = dueDate ? new Date(dueDate) : undefined;
  const isOverdue = date ? date < new Date() : false;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="flex items-center gap-1.5 cursor-pointer rounded px-1 -mx-1 hover:bg-accent/30 transition-colors">
        {date ? (
          <span className={isOverdue ? "text-destructive" : ""}>
            {date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </span>
        ) : (
          <span className="text-muted-foreground">None</span>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <Calendar
          mode="single"
          selected={date}
          onSelect={(d: Date | undefined) => {
            onUpdate({ due_date: d ? d.toISOString() : null });
            setOpen(false);
          }}
        />
        {date && (
          <div className="border-t px-3 py-2">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                onUpdate({ due_date: null });
                setOpen(false);
              }}
              className="text-muted-foreground hover:text-foreground"
            >
              Clear date
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Acceptance Criteria Editor
// ---------------------------------------------------------------------------

function AcceptanceCriteriaEditor({
  criteria,
  onUpdate,
}: {
  criteria: string[];
  onUpdate: (updates: Partial<UpdateIssueRequest>) => void;
}) {
  const [newItem, setNewItem] = useState("");

  const addItem = () => {
    if (!newItem.trim()) return;
    onUpdate({ acceptance_criteria: [...criteria, newItem.trim()] });
    setNewItem("");
  };

  const removeItem = (index: number) => {
    onUpdate({ acceptance_criteria: criteria.filter((_, i) => i !== index) });
  };

  if (criteria.length === 0 && !newItem) {
    return null;
  }

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground">Acceptance Criteria</h3>
      <div className="space-y-1">
        {criteria.map((item, i) => (
          <div key={i} className="group flex items-start gap-2 text-sm">
            <span className="mt-0.5 text-muted-foreground">&bull;</span>
            <span className="flex-1">{item}</span>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => removeItem(i)}
              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>
      <form
        onSubmit={(e) => { e.preventDefault(); addItem(); }}
        className="flex items-center gap-2"
      >
        <input
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          placeholder="Add criteria..."
          className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
        />
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Context Refs Editor
// ---------------------------------------------------------------------------

function ContextRefsEditor({
  refs,
  onUpdate,
}: {
  refs: string[];
  onUpdate: (updates: Partial<UpdateIssueRequest>) => void;
}) {
  const [newRef, setNewRef] = useState("");

  const addRef = () => {
    if (!newRef.trim()) return;
    onUpdate({ context_refs: [...refs, newRef.trim()] });
    setNewRef("");
  };

  const removeRef = (index: number) => {
    onUpdate({ context_refs: refs.filter((_, i) => i !== index) });
  };

  if (refs.length === 0 && !newRef) {
    return null;
  }

  const isUrl = (s: string) => s.startsWith("http://") || s.startsWith("https://");

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground">Context References</h3>
      <div className="space-y-1">
        {refs.map((ref, i) => (
          <div key={i} className="group flex items-center gap-2 text-sm">
            <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            {isUrl(ref) ? (
              <a href={ref} target="_blank" rel="noopener noreferrer" className="flex-1 text-info hover:underline truncate">
                {ref}
              </a>
            ) : (
              <span className="flex-1 truncate">{ref}</span>
            )}
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => removeRef(i)}
              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>
      <form
        onSubmit={(e) => { e.preventDefault(); addRef(); }}
        className="flex items-center gap-2"
      >
        <input
          value={newRef}
          onChange={(e) => setNewRef(e.target.value)}
          placeholder="Add reference URL..."
          className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
        />
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Repository Editor
// ---------------------------------------------------------------------------

function RepositoryEditor({
  repository,
  onUpdate,
}: {
  repository: { url: string; branch?: string; path?: string } | null;
  onUpdate: (updates: Partial<UpdateIssueRequest>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [path, setPath] = useState("");

  const handleOpen = (v: boolean) => {
    if (v) {
      setUrl(repository?.url ?? "");
      setBranch(repository?.branch ?? "");
      setPath(repository?.path ?? "");
    }
    setOpen(v);
  };

  const save = () => {
    if (!url.trim()) {
      onUpdate({ repository: null });
    } else {
      onUpdate({
        repository: {
          url: url.trim(),
          branch: branch.trim() || undefined,
          path: path.trim() || undefined,
        },
      });
    }
    setOpen(false);
  };

  const clear = () => {
    onUpdate({ repository: null });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger className="flex items-center gap-1.5 cursor-pointer rounded px-1 -mx-1 hover:bg-accent/30 transition-colors">
        {repository ? (
          <>
            <GitBranch className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="truncate text-xs">{repository.branch ?? "main"}</span>
          </>
        ) : (
          <span className="text-muted-foreground text-xs">None</span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto min-w-48 p-3 space-y-2.5">
        <div className="text-xs font-medium">Repository</div>
        <div className="space-y-2">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/org/repo"
            className="text-xs"
            autoFocus
          />
          <Input
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder="Branch"
            className="text-xs"
          />
          <Input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="Path"
            className="text-xs"
          />
        </div>
        <div className="flex items-center justify-between pt-1">
          {repository && (
            <Button
              variant="ghost"
              size="xs"
              onClick={clear}
              className="text-muted-foreground hover:text-destructive"
            >
              Remove
            </Button>
          )}
          <Button
            size="xs"
            onClick={save}
            className="ml-auto"
          >
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function IssueDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const { getActorName, getActorInitials } = useActorName();
  const [issue, setIssue] = useState<Issue | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [commentText, setCommentText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");

  useEffect(() => {
    setIssue(null);
    setComments([]);
    setLoading(true);
    Promise.all([api.getIssue(id), api.listComments(id)])
      .then(([iss, cmts]) => {
        setIssue(iss);
        setComments(cmts);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  const handleSubmitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim() || submitting) return;
    setSubmitting(true);
    try {
      const comment = await api.createComment(id, commentText.trim());
      setComments((prev) => [...prev, comment]);
      setCommentText("");
    } catch (err) {
      console.error("Failed to create comment:", err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateField = useCallback(
    (updates: Partial<UpdateIssueRequest>) => {
      if (!issue) return;
      const prev = issue;
      setIssue((curr) => (curr ? ({ ...curr, ...updates } as Issue) : curr));
      api.updateIssue(id, updates).catch(() => {
        setIssue(prev);
        toast.error("Failed to update issue");
      });
    },
    [issue, id],
  );

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.deleteIssue(issue!.id);
      toast.success("Issue deleted");
      router.push("/issues");
    } catch {
      toast.error("Failed to delete issue");
      setDeleting(false);
    }
  };

  const startEditComment = (c: Comment) => {
    setEditingCommentId(c.id);
    setEditContent(c.content);
  };

  const handleSaveEditComment = async () => {
    if (!editingCommentId || !editContent.trim()) return;
    try {
      const updated = await api.updateComment(editingCommentId, editContent.trim());
      setComments((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setEditingCommentId(null);
    } catch {
      toast.error("Failed to update comment");
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    try {
      await api.deleteComment(commentId);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    } catch {
      toast.error("Failed to delete comment");
    }
  };

  // Real-time comment updates
  useWSEvent(
    "comment:created",
    useCallback((payload: unknown) => {
      const { comment } = payload as CommentCreatedPayload;
      if (comment.issue_id !== id) return;
      // Skip own comments — already added locally via API response
      if (comment.author_type === "member" && comment.author_id === user?.id) return;
      setComments((prev) => {
        if (prev.some((c) => c.id === comment.id)) return prev;
        return [...prev, comment];
      });
    }, [id, user?.id]),
  );

  useWSEvent(
    "comment:updated",
    useCallback((payload: unknown) => {
      const { comment } = payload as CommentUpdatedPayload;
      if (comment.issue_id === id) {
        setComments((prev) => prev.map((c) => (c.id === comment.id ? comment : c)));
      }
    }, [id]),
  );

  useWSEvent(
    "comment:deleted",
    useCallback((payload: unknown) => {
      const { comment_id, issue_id } = payload as CommentDeletedPayload;
      if (issue_id === id) {
        setComments((prev) => prev.filter((c) => c.id !== comment_id));
      }
    }, [id]),
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (!issue) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Issue not found
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* LEFT: Content area */}
      <div className="flex-1 overflow-y-auto">
        {/* Header bar */}
        <div className="sticky top-0 z-10 flex h-11 items-center justify-between border-b bg-background px-6 text-[13px]">
          <div className="flex items-center gap-1.5">
            <Link
              href="/issues"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Issues
            </Link>
            <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
            <span className="truncate text-muted-foreground">{issue.id.slice(0, 8)}</span>
          </div>
          <AlertDialog>
            <AlertDialogTrigger
              render={<Button variant="ghost" size="icon-xs" className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive" />}
            >
              <Trash2 className="h-4 w-4" />
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete issue</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete this issue and all its comments. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  disabled={deleting}
                  className="bg-destructive text-white hover:bg-destructive/90"
                >
                  {deleting ? "Deleting..." : "Delete"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        {/* Content */}
        <div className="mx-auto w-full max-w-3xl px-8 py-8">
          <div className="mb-1 text-[13px] text-muted-foreground">{issue.id.slice(0, 8)}</div>

          <h1 className="text-xl font-semibold leading-snug tracking-tight">
            {issue.title}
          </h1>

          {issue.description && (
            <div className="mt-5 text-[14px] leading-[1.7] text-foreground/85 whitespace-pre-wrap">
              {issue.description}
            </div>
          )}

          {(issue.acceptance_criteria.length > 0 || issue.context_refs.length > 0) && (
            <div className="space-y-4 mt-4">
              <AcceptanceCriteriaEditor
                criteria={issue.acceptance_criteria}
                onUpdate={handleUpdateField}
              />
              <ContextRefsEditor
                refs={issue.context_refs}
                onUpdate={handleUpdateField}
              />
            </div>
          )}

          <div className="my-8 border-t" />

          {/* Activity / Comments */}
          <div>
            <h2 className="text-[13px] font-medium">Activity</h2>

            <div className="mt-4">
              {comments.map((comment) => {
                const isOwn = comment.author_type === "member" && comment.author_id === user?.id;
                return (
                  <div key={comment.id} className="group relative py-3">
                    <div className="flex items-center gap-2.5">
                      <ActorAvatar
                        actorType={comment.author_type}
                        actorId={comment.author_id}
                        size={28}
                        getName={getActorName}
                        getInitials={getActorInitials}
                      />
                      <span className="text-[13px] font-medium">
                        {getActorName(comment.author_type, comment.author_id)}
                      </span>
                      <span className="text-[12px] text-muted-foreground">
                        {timeAgo(comment.created_at)}
                      </span>
                      {isOwn && (
                        <div className="ml-auto flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => startEditComment(comment)}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => handleDeleteComment(comment.id)}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                    </div>
                    {editingCommentId === comment.id ? (
                      <form onSubmit={(e) => { e.preventDefault(); handleSaveEditComment(); }} className="mt-2 pl-[38px]">
                        <input
                          autoFocus
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          className="w-full text-[13px] bg-transparent border-b outline-none"
                          onKeyDown={(e) => { if (e.key === "Escape") setEditingCommentId(null); }}
                        />
                      </form>
                    ) : (
                      <div className="mt-2 pl-[38px] text-[13px] leading-[1.6] text-foreground/85 whitespace-pre-wrap">
                        {comment.content}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Comment input */}
            <form onSubmit={handleSubmitComment} className="mt-2 border-t pt-4">
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Leave a comment..."
                  className="flex-1 text-[13px]"
                />
                <Button
                  type="submit"
                  size="icon"
                  disabled={!commentText.trim() || submitting}
                >
                  <Send className="h-3.5 w-3.5" />
                </Button>
              </div>
            </form>
          </div>
        </div>
      </div>

      {/* RIGHT: Properties sidebar */}
      <div className="w-60 shrink-0 overflow-y-auto border-l">
        <div className="p-4">
          <div className="mb-2 text-[12px] font-medium text-muted-foreground">
            Properties
          </div>

          <div className="space-y-0.5">
            <PropRow label="Status">
              <StatusPicker status={issue.status} onUpdate={handleUpdateField} />
            </PropRow>

            <PropRow label="Priority">
              <PriorityPicker priority={issue.priority} onUpdate={handleUpdateField} />
            </PropRow>

            <PropRow label="Assignee">
              <AssigneePicker
                assigneeType={issue.assignee_type}
                assigneeId={issue.assignee_id}
                onUpdate={handleUpdateField}
              />
            </PropRow>

            <PropRow label="Due date">
              <DueDatePicker dueDate={issue.due_date} onUpdate={handleUpdateField} />
            </PropRow>

            <PropRow label="Repository">
              <RepositoryEditor repository={issue.repository} onUpdate={handleUpdateField} />
            </PropRow>

            <PropRow label="Created by">
              <ActorAvatar
                actorType={issue.creator_type}
                actorId={issue.creator_id}
                size={18}
                getName={getActorName}
                getInitials={getActorInitials}
              />
              <span>{getActorName(issue.creator_type, issue.creator_id)}</span>
            </PropRow>
          </div>

          <div className="mt-4 border-t pt-3 space-y-0.5">
            <PropRow label="Created">
              <span className="text-muted-foreground">{shortDate(issue.created_at)}</span>
            </PropRow>
            <PropRow label="Updated">
              <span className="text-muted-foreground">{shortDate(issue.updated_at)}</span>
            </PropRow>
          </div>
        </div>
      </div>
    </div>
  );
}
