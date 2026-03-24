import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Issue, ListIssuesResponse } from "@multica/types";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/issues",
}));

// Mock next/link
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: any;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Mock workspace feature
vi.mock("@/features/workspace", () => ({
  useActorName: () => ({
    getMemberName: (id: string) => (id === "user-1" ? "Test User" : "Unknown"),
    getAgentName: (id: string) => (id === "agent-1" ? "Claude Agent" : "Unknown Agent"),
    getActorName: (type: string, id: string) =>
      type === "member" ? "Test User" : "Claude Agent",
    getActorInitials: () => "TU",
  }),
}));

// Mock WebSocket context
vi.mock("@/features/realtime", () => ({
  useWSEvent: vi.fn(),
  useWS: () => ({ subscribe: vi.fn(() => () => {}) }),
  WSProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock api
const mockListIssues = vi.fn();
const mockCreateIssue = vi.fn();
const mockUpdateIssue = vi.fn();

vi.mock("@/shared/api", () => ({
  api: {
    listIssues: (...args: any[]) => mockListIssues(...args),
    createIssue: (...args: any[]) => mockCreateIssue(...args),
    updateIssue: (...args: any[]) => mockUpdateIssue(...args),
  },
}));

const issueDefaults = {
  parent_issue_id: null,
  acceptance_criteria: [],
  context_refs: [],
  repository: null,
  position: 0,
};

const mockIssues: Issue[] = [
  {
    ...issueDefaults,
    id: "issue-1",
    workspace_id: "ws-1",
    title: "Implement auth",
    description: "Add JWT authentication",
    status: "todo",
    priority: "high",
    assignee_type: "member",
    assignee_id: "user-1",
    creator_type: "member",
    creator_id: "user-1",
    due_date: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
  {
    ...issueDefaults,
    id: "issue-2",
    workspace_id: "ws-1",
    title: "Design landing page",
    description: null,
    status: "in_progress",
    priority: "medium",
    assignee_type: "agent",
    assignee_id: "agent-1",
    creator_type: "member",
    creator_id: "user-1",
    due_date: "2026-02-01T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
  {
    ...issueDefaults,
    id: "issue-3",
    workspace_id: "ws-1",
    title: "Write tests",
    description: null,
    status: "backlog",
    priority: "low",
    assignee_type: null,
    assignee_id: null,
    creator_type: "member",
    creator_id: "user-1",
    due_date: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
];

import IssuesPage from "./page";

describe("IssuesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state initially", () => {
    mockListIssues.mockReturnValueOnce(new Promise(() => {}));
    render(<IssuesPage />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("renders issues in board view after loading", async () => {
    mockListIssues.mockResolvedValueOnce({
      issues: mockIssues,
      total: 3,
    } as ListIssuesResponse);

    render(<IssuesPage />);

    await waitFor(() => {
      expect(screen.getByText("Implement auth")).toBeInTheDocument();
    });

    expect(screen.getByText("Design landing page")).toBeInTheDocument();
    expect(screen.getByText("Write tests")).toBeInTheDocument();
    expect(screen.getByText("All Issues")).toBeInTheDocument();
  });

  it("renders board columns", async () => {
    mockListIssues.mockResolvedValueOnce({
      issues: mockIssues,
      total: 3,
    } as ListIssuesResponse);

    render(<IssuesPage />);

    await waitFor(() => {
      // Status labels appear in both filter dropdown and board columns
      expect(screen.getAllByText("Backlog").length).toBeGreaterThanOrEqual(1);
    });

    expect(screen.getAllByText("Todo").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("In Progress").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("In Review").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Done").length).toBeGreaterThanOrEqual(1);
  });

  it("switches to list view", async () => {
    mockListIssues.mockResolvedValueOnce({
      issues: mockIssues,
      total: 3,
    } as ListIssuesResponse);

    const user = userEvent.setup();
    render(<IssuesPage />);

    await waitFor(() => {
      expect(screen.getByText("Implement auth")).toBeInTheDocument();
    });

    // Find the List button and click it
    const listButton = screen.getByText("List");
    await user.click(listButton);

    // Issues should still be visible
    expect(screen.getByText("Implement auth")).toBeInTheDocument();
    expect(screen.getByText("Design landing page")).toBeInTheDocument();
  });

  it("shows 'New Issue' button", async () => {
    mockListIssues.mockResolvedValueOnce({
      issues: [],
      total: 0,
    } as ListIssuesResponse);

    render(<IssuesPage />);

    await waitFor(() => {
      expect(screen.getByText("New Issue")).toBeInTheDocument();
    });
  });

  it("shows create dialog when New Issue is clicked", async () => {
    mockListIssues.mockResolvedValueOnce({
      issues: [],
      total: 0,
    } as ListIssuesResponse);

    const user = userEvent.setup();
    render(<IssuesPage />);

    await waitFor(() => {
      expect(screen.getByText("New Issue")).toBeInTheDocument();
    });

    await user.click(screen.getByText("New Issue"));

    // Dialog should open with title input
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Issue title")).toBeInTheDocument();
    });
    expect(screen.getByText("Create Issue")).toBeInTheDocument();
  });

  it("creates an issue via the dialog", async () => {
    mockListIssues.mockResolvedValueOnce({
      issues: [],
      total: 0,
    } as ListIssuesResponse);

    const newIssue: Issue = {
      ...issueDefaults,
      id: "issue-new",
      workspace_id: "ws-1",
      title: "New test issue",
      description: null,
      status: "todo",
      priority: "none",
      assignee_type: null,
      assignee_id: null,
      creator_type: "member",
      creator_id: "user-1",
      due_date: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    mockCreateIssue.mockResolvedValueOnce(newIssue);

    const user = userEvent.setup();
    render(<IssuesPage />);

    await waitFor(() => {
      expect(screen.getByText("New Issue")).toBeInTheDocument();
    });

    await user.click(screen.getByText("New Issue"));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Issue title")).toBeInTheDocument();
    });

    await user.type(screen.getByPlaceholderText("Issue title"), "New test issue");
    await user.click(screen.getByText("Create Issue"));

    await waitFor(() => {
      expect(mockCreateIssue).toHaveBeenCalledWith({
        title: "New test issue",
        status: "todo",
        priority: "none",
      });
    });
  });

  it("handles API error gracefully", async () => {
    mockListIssues.mockRejectedValueOnce(new Error("Network error"));

    render(<IssuesPage />);

    // Should finish loading without crashing
    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });
  });
});
