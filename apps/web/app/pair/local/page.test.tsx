import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const {
  mockGetDaemonPairingSession,
  mockApproveDaemonPairingSession,
  mockWorkspace,
  mockAuthValue,
} = vi.hoisted(() => ({
  mockGetDaemonPairingSession: vi.fn(),
  mockApproveDaemonPairingSession: vi.fn(),
  mockWorkspace: {
    id: "05ce77f1-7c45-4735-b1f7-619347f7f76c",
    name: "Jiayuan's Workspace",
    slug: "jiayuan-05ce77f1",
    description: null,
    settings: {},
    created_at: "2026-03-24T00:00:00Z",
    updated_at: "2026-03-24T00:00:00Z",
  },
  mockAuthValue: {
    user: {
      id: "user-1",
      name: "Jiayuan",
      email: "jiayuan@example.com",
      avatar_url: null,
      created_at: "2026-03-24T00:00:00Z",
      updated_at: "2026-03-24T00:00:00Z",
    },
    workspaces: [] as Array<{
      id: string;
      name: string;
      slug: string;
      description: null;
      settings: Record<string, never>;
      created_at: string;
      updated_at: string;
    }>,
    workspace: null as null | {
      id: string;
      name: string;
      slug: string;
      description: null;
      settings: Record<string, never>;
      created_at: string;
      updated_at: string;
    },
    isLoading: false,
  },
}));

mockAuthValue.workspaces = [mockWorkspace];
mockAuthValue.workspace = mockWorkspace;

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("token=test-token"),
}));

vi.mock("@/shared/api", () => ({
  api: {
    getDaemonPairingSession: mockGetDaemonPairingSession,
    approveDaemonPairingSession: mockApproveDaemonPairingSession,
  },
}));

vi.mock("@/features/auth", () => ({
  useAuthStore: (selector: (s: any) => any) =>
    selector(mockAuthValue),
}));

vi.mock("@/features/workspace", () => ({
  useWorkspaceStore: (selector: (s: any) => any) =>
    selector(mockAuthValue),
}));

import LocalDaemonPairPage from "./page";

describe("LocalDaemonPairPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDaemonPairingSession.mockResolvedValue({
      token: "test-token",
      daemon_id: "local-daemon",
      device_name: "Jiayuans-MacBook-Pro.local",
      runtime_name: "Local Codex",
      runtime_type: "codex",
      runtime_version: "codex-cli 0.116.0",
      workspace_id: mockWorkspace.id,
      status: "pending",
      approved_at: null,
      claimed_at: null,
      expires_at: "2026-03-24T07:20:00Z",
      link_url: null,
    });
  });

  it("shows the selected workspace name instead of the raw id", async () => {
    render(<LocalDaemonPairPage />);

    await waitFor(() => {
      expect(mockGetDaemonPairingSession).toHaveBeenCalledWith("test-token");
    });

    expect(await screen.findByText("Jiayuan's Workspace")).toBeInTheDocument();
    expect(screen.queryByText(mockWorkspace.id)).not.toBeInTheDocument();
  });
});
