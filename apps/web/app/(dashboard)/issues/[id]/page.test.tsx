import { Suspense } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Issue, Comment } from "@multica/types";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/issues/issue-1",
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

// Mock auth store
vi.mock("@/features/auth", () => ({
  useAuthStore: (selector: (s: any) => any) =>
    selector({
      user: { id: "user-1", name: "Test User", email: "test@multica.ai" },
      isLoading: false,
    }),
}));

// Mock workspace feature
vi.mock("@/features/workspace", () => ({
  useWorkspaceStore: (selector: (s: any) => any) =>
    selector({
      workspace: { id: "ws-1", name: "Test WS" },
      workspaces: [{ id: "ws-1", name: "Test WS" }],
      members: [{ user_id: "user-1", name: "Test User", email: "test@multica.ai" }],
      agents: [{ id: "agent-1", name: "Claude Agent" }],
    }),
  useActorName: () => ({
    getMemberName: (id: string) => (id === "user-1" ? "Test User" : "Unknown"),
    getAgentName: (id: string) => (id === "agent-1" ? "Claude Agent" : "Unknown Agent"),
    getActorName: (type: string, id: string) => {
      if (type === "member" && id === "user-1") return "Test User";
      if (type === "agent" && id === "agent-1") return "Claude Agent";
      return "Unknown";
    },
    getActorInitials: (type: string, id: string) => {
      if (type === "member") return "TU";
      if (type === "agent") return "CA";
      return "??";
    },
  }),
}));

// Mock ws-context
vi.mock("@/features/realtime", () => ({
  useWSEvent: () => {},
}));

// Mock @multica/ui calendar (react-day-picker needs browser APIs)
vi.mock("@multica/ui/components/ui/calendar", () => ({
  Calendar: () => null,
}));

// Mock api
const mockGetIssue = vi.hoisted(() => vi.fn());
const mockListComments = vi.hoisted(() => vi.fn());
const mockCreateComment = vi.hoisted(() => vi.fn());
const mockUpdateComment = vi.hoisted(() => vi.fn());
const mockDeleteComment = vi.hoisted(() => vi.fn());
const mockDeleteIssue = vi.hoisted(() => vi.fn());
const mockUpdateIssue = vi.hoisted(() => vi.fn());

vi.mock("@/shared/api", () => ({
  api: {
    getIssue: (...args: any[]) => mockGetIssue(...args),
    listComments: (...args: any[]) => mockListComments(...args),
    createComment: (...args: any[]) => mockCreateComment(...args),
    updateComment: (...args: any[]) => mockUpdateComment(...args),
    deleteComment: (...args: any[]) => mockDeleteComment(...args),
    deleteIssue: (...args: any[]) => mockDeleteIssue(...args),
    updateIssue: (...args: any[]) => mockUpdateIssue(...args),
  },
}));

const mockIssue: Issue = {
  id: "issue-1",
  workspace_id: "ws-1",
  title: "Implement authentication",
  description: "Add JWT auth to the backend",
  status: "in_progress",
  priority: "high",
  assignee_type: "member",
  assignee_id: "user-1",
  creator_type: "member",
  creator_id: "user-1",
  parent_issue_id: null,
  acceptance_criteria: [],
  context_refs: [],
  repository: null,
  position: 0,
  due_date: "2026-06-01T00:00:00Z",
  created_at: "2026-01-15T00:00:00Z",
  updated_at: "2026-01-20T00:00:00Z",
};

const mockComments: Comment[] = [
  {
    id: "comment-1",
    issue_id: "issue-1",
    content: "Started working on this",
    type: "comment",
    author_type: "member",
    author_id: "user-1",
    created_at: "2026-01-16T00:00:00Z",
    updated_at: "2026-01-16T00:00:00Z",
  },
  {
    id: "comment-2",
    issue_id: "issue-1",
    content: "I can help with this",
    type: "comment",
    author_type: "agent",
    author_id: "agent-1",
    created_at: "2026-01-17T00:00:00Z",
    updated_at: "2026-01-17T00:00:00Z",
  },
];

import IssueDetailPage from "./page";

// React 19 use(Promise) needs the promise to resolve within act + Suspense
async function renderPage(id = "issue-1") {
  let result: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <Suspense fallback={<div>Suspense loading...</div>}>
        <IssueDetailPage params={Promise.resolve({ id })} />
      </Suspense>,
    );
  });
  return result!;
}

describe("IssueDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders issue details after loading", async () => {
    mockGetIssue.mockResolvedValueOnce(mockIssue);
    mockListComments.mockResolvedValueOnce(mockComments);
    await renderPage();

    await waitFor(() => {
      expect(
        screen.getByText("Implement authentication"),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByText("Add JWT auth to the backend"),
    ).toBeInTheDocument();
  });

  it("renders issue properties sidebar", async () => {
    mockGetIssue.mockResolvedValueOnce(mockIssue);
    mockListComments.mockResolvedValueOnce(mockComments);
    await renderPage();

    await waitFor(() => {
      expect(screen.getByText("Properties")).toBeInTheDocument();
    });

    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
  });

  it("renders comments", async () => {
    mockGetIssue.mockResolvedValueOnce(mockIssue);
    mockListComments.mockResolvedValueOnce(mockComments);
    await renderPage();

    await waitFor(() => {
      expect(
        screen.getByText("Started working on this"),
      ).toBeInTheDocument();
    });

    expect(screen.getByText("I can help with this")).toBeInTheDocument();
    expect(screen.getByText("Activity")).toBeInTheDocument();
  });

  it("shows 'Issue not found' for missing issue", async () => {
    mockGetIssue.mockRejectedValueOnce(new Error("Not found"));
    mockListComments.mockRejectedValueOnce(new Error("Not found"));
    await renderPage("nonexistent-id");

    await waitFor(() => {
      expect(screen.getByText("Issue not found")).toBeInTheDocument();
    });
  });

  it("submits a new comment", async () => {
    mockGetIssue.mockResolvedValueOnce(mockIssue);
    mockListComments.mockResolvedValueOnce(mockComments);

    const newComment: Comment = {
      id: "comment-3",
      issue_id: "issue-1",
      content: "New test comment",
      type: "comment",
      author_type: "member",
      author_id: "user-1",
      created_at: "2026-01-18T00:00:00Z",
      updated_at: "2026-01-18T00:00:00Z",
    };
    mockCreateComment.mockResolvedValueOnce(newComment);

    const user = userEvent.setup();
    await renderPage();

    await waitFor(() => {
      expect(
        screen.getByPlaceholderText("Leave a comment..."),
      ).toBeInTheDocument();
    });

    await user.type(
      screen.getByPlaceholderText("Leave a comment..."),
      "New test comment",
    );

    const form = screen
      .getByPlaceholderText("Leave a comment...")
      .closest("form")!;
    const submitBtn = form.querySelector(
      'button[type="submit"]',
    ) as HTMLElement;
    await user.click(submitBtn);

    await waitFor(() => {
      expect(mockCreateComment).toHaveBeenCalledWith(
        "issue-1",
        "New test comment",
      );
    });

    await waitFor(() => {
      expect(screen.getByText("New test comment")).toBeInTheDocument();
    });
  });

  it("renders breadcrumb navigation", async () => {
    mockGetIssue.mockResolvedValueOnce(mockIssue);
    mockListComments.mockResolvedValueOnce(mockComments);
    await renderPage();

    await waitFor(() => {
      expect(screen.getByText("Issues")).toBeInTheDocument();
    });

    const issuesLink = screen.getByText("Issues");
    expect(issuesLink.closest("a")).toHaveAttribute("href", "/issues");
  });
});
