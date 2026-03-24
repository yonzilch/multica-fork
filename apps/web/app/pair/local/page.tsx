"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { DaemonPairingSession } from "@multica/types";
import { Button } from "@multica/ui/components/ui/button";
import { Label } from "@multica/ui/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
} from "@multica/ui/components/ui/select";
import { api } from "@/shared/api";
import { useAuthStore } from "@/features/auth";
import { useWorkspaceStore } from "@/features/workspace";

function formatExpiresAt(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function LocalDaemonPairPageContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);
  const workspace = useWorkspaceStore((s) => s.workspace);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const [session, setSession] = useState<DaemonPairingSession | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const nextLoginURL = useMemo(() => {
    const next = `/pair/local?token=${encodeURIComponent(token)}`;
    return `/login?next=${encodeURIComponent(next)}`;
  }, [token]);
  const selectedWorkspace = useMemo(
    () => workspaces.find((item) => item.id === selectedWorkspaceId) ?? null,
    [selectedWorkspaceId, workspaces],
  );

  useEffect(() => {
    if (!token) {
      setError("Missing pairing token.");
      setLoading(false);
      return;
    }

    setLoading(true);
    api.getDaemonPairingSession(token)
      .then((value) => {
        setSession(value);
        setSelectedWorkspaceId(value.workspace_id || workspace?.id || workspaces[0]?.id || "");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load pairing session."))
      .finally(() => setLoading(false));
  }, [token, workspace?.id, workspaces]);

  const approve = async () => {
    if (!token || !selectedWorkspaceId) return;
    setSubmitting(true);
    setError("");
    try {
      const approved = await api.approveDaemonPairingSession(token, {
        workspace_id: selectedWorkspaceId,
      });
      setSession(approved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve pairing session.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6 py-12">
      <div className="w-full max-w-xl rounded-2xl border bg-background p-8 shadow-sm">
        <div>
          <h1 className="text-2xl font-semibold">Connect Local Codex Runtime</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Approve this pairing request to register your local Codex runtime with a workspace.
          </p>
        </div>

        {loading || isLoading ? (
          <div className="mt-8 text-sm text-muted-foreground">Loading pairing session...</div>
        ) : error ? (
          <div className="mt-8 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : session ? (
          <>
            <div className="mt-6 rounded-xl border bg-muted/30 p-4">
              <div className="text-sm font-medium">{session.runtime_name}</div>
              <div className="mt-1 text-sm text-muted-foreground">
                {session.device_name}
                {session.runtime_version ? ` · ${session.runtime_version}` : ""}
              </div>
              <div className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
                {session.runtime_type}
              </div>
              <div className="mt-3 text-xs text-muted-foreground">
                Expires {formatExpiresAt(session.expires_at)}
              </div>
            </div>

            {!user ? (
              <div className="mt-6 space-y-3">
                <p className="text-sm text-muted-foreground">
                  Sign in first, then choose which workspace should own this local runtime.
                </p>
                <Link
                  href={nextLoginURL}
                  className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  Sign in to continue
                </Link>
              </div>
            ) : session.status === "approved" || session.status === "claimed" ? (
              <div className="mt-6 rounded-xl border border-success/30 bg-success/5 px-4 py-3 text-sm text-success">
                This runtime is linked to a workspace. Return to the daemon window to finish setup.
              </div>
            ) : session.status === "expired" ? (
              <div className="mt-6 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-warning">
                This pairing link expired. Restart the daemon to generate a new link.
              </div>
            ) : workspaces.length === 0 ? (
              <div className="mt-6 rounded-xl border px-4 py-3 text-sm text-muted-foreground">
                You do not have a workspace yet. Create one first, then reopen this pairing link.
              </div>
            ) : (
              <div className="mt-6 space-y-4">
                <div>
                  <Label className="mb-2">Workspace</Label>
                  <Select value={selectedWorkspaceId} onValueChange={(v) => setSelectedWorkspaceId(v ?? "")}>
                    <SelectTrigger className="w-full">
                      <span className="flex flex-1 text-left">
                        {selectedWorkspace?.name ?? "Select workspace"}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      {workspaces.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Button
                  type="button"
                  onClick={approve}
                  disabled={submitting || !selectedWorkspaceId}
                >
                  {submitting ? "Registering..." : "Register runtime"}
                </Button>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

export default function LocalDaemonPairPage() {
  return (
    <Suspense fallback={null}>
      <LocalDaemonPairPageContent />
    </Suspense>
  );
}
