"use client";

import { useEffect, type ReactNode } from "react";
import { useAuthStore } from "./store";
import { useWorkspaceStore } from "@/features/workspace";
import { api } from "@/shared/api";

/**
 * Initializes auth + workspace state from localStorage on mount.
 * Must wrap the app to ensure stores are hydrated before children render.
 */
export function AuthInitializer({ children }: { children: ReactNode }) {
  const initialize = useAuthStore((s) => s.initialize);
  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);
  const hydrateWorkspace = useWorkspaceStore((s) => s.hydrateWorkspace);

  useEffect(() => {
    initialize();
  }, [initialize]);

  useEffect(() => {
    if (isLoading || !user) return;
    const wsId = localStorage.getItem("multica_workspace_id");

    api.listWorkspaces().then((wsList) => {
      hydrateWorkspace(wsList, wsId);
    }).catch(console.error);
  }, [user, isLoading, hydrateWorkspace]);

  return <>{children}</>;
}
