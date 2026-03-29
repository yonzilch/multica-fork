package handler

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/logger"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

// IssueResponse is the JSON response for an issue.
type IssueResponse struct {
	ID                 string  `json:"id"`
	WorkspaceID        string  `json:"workspace_id"`
	Number             int32   `json:"number"`
	Identifier         string  `json:"identifier"`
	Title              string  `json:"title"`
	Description        *string `json:"description"`
	Status             string  `json:"status"`
	Priority           string  `json:"priority"`
	AssigneeType       *string `json:"assignee_type"`
	AssigneeID         *string `json:"assignee_id"`
	CreatorType        string  `json:"creator_type"`
	CreatorID          string  `json:"creator_id"`
	ParentIssueID      *string `json:"parent_issue_id"`
	Position           float64 `json:"position"`
	DueDate            *string `json:"due_date"`
	CreatedAt          string  `json:"created_at"`
	UpdatedAt          string  `json:"updated_at"`
}

type agentTriggerSnapshot struct {
	Type    string         `json:"type"`
	Enabled bool           `json:"enabled"`
	Config  map[string]any `json:"config"`
}

func issueToResponse(i db.Issue, issuePrefix string) IssueResponse {
	identifier := issuePrefix + "-" + strconv.Itoa(int(i.Number))
	return IssueResponse{
		ID:            uuidToString(i.ID),
		WorkspaceID:   uuidToString(i.WorkspaceID),
		Number:        i.Number,
		Identifier:    identifier,
		Title:         i.Title,
		Description:   textToPtr(i.Description),
		Status:        i.Status,
		Priority:      i.Priority,
		AssigneeType:  textToPtr(i.AssigneeType),
		AssigneeID:    uuidToPtr(i.AssigneeID),
		CreatorType:   i.CreatorType,
		CreatorID:     uuidToString(i.CreatorID),
		ParentIssueID: uuidToPtr(i.ParentIssueID),
		Position:      i.Position,
		DueDate:       timestampToPtr(i.DueDate),
		CreatedAt:     timestampToString(i.CreatedAt),
		UpdatedAt:     timestampToString(i.UpdatedAt),
	}
}

func (h *Handler) ListIssues(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	workspaceID := resolveWorkspaceID(r)
	if _, ok := h.requireWorkspaceMember(w, r, workspaceID, "workspace not found"); !ok {
		return
	}

	limit := 100
	offset := 0
	if l := r.URL.Query().Get("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil {
			limit = v
		}
	}
	if o := r.URL.Query().Get("offset"); o != "" {
		if v, err := strconv.Atoi(o); err == nil {
			offset = v
		}
	}

	// Parse optional filter params
	var statusFilter pgtype.Text
	if s := r.URL.Query().Get("status"); s != "" {
		statusFilter = pgtype.Text{String: s, Valid: true}
	}
	var priorityFilter pgtype.Text
	if p := r.URL.Query().Get("priority"); p != "" {
		priorityFilter = pgtype.Text{String: p, Valid: true}
	}
	var assigneeFilter pgtype.UUID
	if a := r.URL.Query().Get("assignee_id"); a != "" {
		assigneeFilter = parseUUID(a)
	}

	issues, err := h.Queries.ListIssues(ctx, db.ListIssuesParams{
		WorkspaceID: parseUUID(workspaceID),
		Limit:       int32(limit),
		Offset:      int32(offset),
		Status:      statusFilter,
		Priority:    priorityFilter,
		AssigneeID:  assigneeFilter,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list issues")
		return
	}

	prefix := h.getIssuePrefix(ctx, parseUUID(workspaceID))
	resp := make([]IssueResponse, len(issues))
	for i, issue := range issues {
		resp[i] = issueToResponse(issue, prefix)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"issues": resp,
		"total":  len(resp),
	})
}

func (h *Handler) GetIssue(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	issue, ok := h.loadIssueForUser(w, r, id)
	if !ok {
		return
	}
	prefix := h.getIssuePrefix(r.Context(), issue.WorkspaceID)
	writeJSON(w, http.StatusOK, issueToResponse(issue, prefix))
}

type CreateIssueRequest struct {
	Title              string  `json:"title"`
	Description        *string `json:"description"`
	Status             string  `json:"status"`
	Priority           string  `json:"priority"`
	AssigneeType       *string `json:"assignee_type"`
	AssigneeID         *string `json:"assignee_id"`
	ParentIssueID      *string `json:"parent_issue_id"`
	DueDate            *string `json:"due_date"`
}

func (h *Handler) CreateIssue(w http.ResponseWriter, r *http.Request) {
	var req CreateIssueRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Title == "" {
		writeError(w, http.StatusBadRequest, "title is required")
		return
	}

	workspaceID := resolveWorkspaceID(r)
	if _, ok := h.requireWorkspaceMember(w, r, workspaceID, "workspace not found"); !ok {
		return
	}

	// Get creator from context (set by auth middleware)
	creatorID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	status := req.Status
	if status == "" {
		status = "backlog"
	}
	priority := req.Priority
	if priority == "" {
		priority = "none"
	}

	var assigneeType pgtype.Text
	var assigneeID pgtype.UUID
	if req.AssigneeType != nil {
		assigneeType = pgtype.Text{String: *req.AssigneeType, Valid: true}
	}
	if req.AssigneeID != nil {
		assigneeID = parseUUID(*req.AssigneeID)
	}

	var parentIssueID pgtype.UUID
	if req.ParentIssueID != nil {
		parentIssueID = parseUUID(*req.ParentIssueID)
	}

	var dueDate pgtype.Timestamptz
	if req.DueDate != nil && *req.DueDate != "" {
		t, err := time.Parse(time.RFC3339, *req.DueDate)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid due_date format, expected RFC3339")
			return
		}
		dueDate = pgtype.Timestamptz{Time: t, Valid: true}
	}

	// Use a transaction to atomically increment the workspace issue counter
	// and create the issue with the assigned number.
	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create issue")
		return
	}
	defer tx.Rollback(r.Context())

	qtx := h.Queries.WithTx(tx)
	issueNumber, err := qtx.IncrementIssueCounter(r.Context(), parseUUID(workspaceID))
	if err != nil {
		slog.Warn("increment issue counter failed", append(logger.RequestAttrs(r), "error", err, "workspace_id", workspaceID)...)
		writeError(w, http.StatusInternalServerError, "failed to create issue")
		return
	}

	// Determine creator identity: agent (via X-Agent-ID header) or member.
	creatorType := "member"
	actualCreatorID := creatorID
	if agentID := r.Header.Get("X-Agent-ID"); agentID != "" {
		if agent, err := h.Queries.GetAgent(r.Context(), parseUUID(agentID)); err == nil && uuidToString(agent.WorkspaceID) == workspaceID {
			creatorType = "agent"
			actualCreatorID = agentID
		}
	}

	issue, err := qtx.CreateIssue(r.Context(), db.CreateIssueParams{
		WorkspaceID:        parseUUID(workspaceID),
		Title:              req.Title,
		Description:        ptrToText(req.Description),
		Status:             status,
		Priority:           priority,
		AssigneeType:       assigneeType,
		AssigneeID:         assigneeID,
		CreatorType:        creatorType,
		CreatorID:          parseUUID(actualCreatorID),
		ParentIssueID:      parentIssueID,
		Position:           0,
		DueDate:            dueDate,
		Number:             issueNumber,
	})
	if err != nil {
		slog.Warn("create issue failed", append(logger.RequestAttrs(r), "error", err, "workspace_id", workspaceID)...)
		writeError(w, http.StatusInternalServerError, "failed to create issue: "+err.Error())
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create issue")
		return
	}

	prefix := h.getIssuePrefix(r.Context(), issue.WorkspaceID)
	resp := issueToResponse(issue, prefix)
	slog.Info("issue created", append(logger.RequestAttrs(r), "issue_id", uuidToString(issue.ID), "title", issue.Title, "status", issue.Status, "workspace_id", workspaceID)...)
	h.publish(protocol.EventIssueCreated, workspaceID, creatorType, actualCreatorID, map[string]any{"issue": resp})

	// Only ready issues in todo are enqueued for agents.
	if issue.AssigneeType.Valid && issue.AssigneeID.Valid {
		if h.shouldEnqueueAgentTask(r.Context(), issue) {
			h.TaskService.EnqueueTaskForIssue(r.Context(), issue)
		}
	}

	writeJSON(w, http.StatusCreated, resp)
}

type UpdateIssueRequest struct {
	Title              *string  `json:"title"`
	Description        *string  `json:"description"`
	Status             *string  `json:"status"`
	Priority           *string  `json:"priority"`
	AssigneeType       *string  `json:"assignee_type"`
	AssigneeID         *string  `json:"assignee_id"`
	Position           *float64 `json:"position"`
	DueDate            *string  `json:"due_date"`
}

func (h *Handler) UpdateIssue(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	prevIssue, ok := h.loadIssueForUser(w, r, id)
	if !ok {
		return
	}
	userID := requestUserID(r)
	workspaceID := uuidToString(prevIssue.WorkspaceID)

	// Read body as raw bytes so we can detect which fields were explicitly sent.
	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to read request body")
		return
	}

	var req UpdateIssueRequest
	if err := json.Unmarshal(bodyBytes, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Track which fields were explicitly present in JSON (even if null)
	var rawFields map[string]json.RawMessage
	json.Unmarshal(bodyBytes, &rawFields)

	// Pre-fill nullable fields (bare sqlc.narg) with current values
	params := db.UpdateIssueParams{
		ID:           prevIssue.ID,
		AssigneeType: prevIssue.AssigneeType,
		AssigneeID:   prevIssue.AssigneeID,
		DueDate:      prevIssue.DueDate,
	}

	// COALESCE fields — only set when explicitly provided
	if req.Title != nil {
		params.Title = pgtype.Text{String: *req.Title, Valid: true}
	}
	if req.Description != nil {
		params.Description = pgtype.Text{String: *req.Description, Valid: true}
	}
	if req.Status != nil {
		params.Status = pgtype.Text{String: *req.Status, Valid: true}
	}
	if req.Priority != nil {
		params.Priority = pgtype.Text{String: *req.Priority, Valid: true}
	}
	if req.Position != nil {
		params.Position = pgtype.Float8{Float64: *req.Position, Valid: true}
	}
	// Nullable fields — only override when explicitly present in JSON
	if _, ok := rawFields["assignee_type"]; ok {
		if req.AssigneeType != nil {
			params.AssigneeType = pgtype.Text{String: *req.AssigneeType, Valid: true}
		} else {
			params.AssigneeType = pgtype.Text{Valid: false} // explicit null = unassign
		}
	}
	if _, ok := rawFields["assignee_id"]; ok {
		if req.AssigneeID != nil {
			params.AssigneeID = parseUUID(*req.AssigneeID)
		} else {
			params.AssigneeID = pgtype.UUID{Valid: false} // explicit null = unassign
		}
	}
	if _, ok := rawFields["due_date"]; ok {
		if req.DueDate != nil && *req.DueDate != "" {
			t, err := time.Parse(time.RFC3339, *req.DueDate)
			if err != nil {
				writeError(w, http.StatusBadRequest, "invalid due_date format, expected RFC3339")
				return
			}
			params.DueDate = pgtype.Timestamptz{Time: t, Valid: true}
		} else {
			params.DueDate = pgtype.Timestamptz{Valid: false} // explicit null = clear date
		}
	}

	issue, err := h.Queries.UpdateIssue(r.Context(), params)
	if err != nil {
		slog.Warn("update issue failed", append(logger.RequestAttrs(r), "error", err, "issue_id", id, "workspace_id", workspaceID)...)
		writeError(w, http.StatusInternalServerError, "failed to update issue: "+err.Error())
		return
	}

	prefix := h.getIssuePrefix(r.Context(), issue.WorkspaceID)
	resp := issueToResponse(issue, prefix)
	slog.Info("issue updated", append(logger.RequestAttrs(r), "issue_id", id, "workspace_id", workspaceID)...)

	assigneeChanged := (req.AssigneeType != nil || req.AssigneeID != nil) &&
		(prevIssue.AssigneeType.String != issue.AssigneeType.String || uuidToString(prevIssue.AssigneeID) != uuidToString(issue.AssigneeID))
	statusChanged := req.Status != nil && prevIssue.Status != issue.Status
	priorityChanged := req.Priority != nil && prevIssue.Priority != issue.Priority
	descriptionChanged := req.Description != nil && textToPtr(prevIssue.Description) != resp.Description
	titleChanged := req.Title != nil && prevIssue.Title != issue.Title
	prevDueDate := timestampToPtr(prevIssue.DueDate)
	dueDateChanged := prevDueDate != resp.DueDate && (prevDueDate == nil) != (resp.DueDate == nil) ||
		(prevDueDate != nil && resp.DueDate != nil && *prevDueDate != *resp.DueDate)

	// Determine actor identity: agent (via X-Agent-ID header) or member.
	actorType := "member"
	actorID := userID
	if agentID := r.Header.Get("X-Agent-ID"); agentID != "" {
		if agent, err := h.Queries.GetAgent(r.Context(), parseUUID(agentID)); err == nil && uuidToString(agent.WorkspaceID) == workspaceID {
			actorType = "agent"
			actorID = agentID
		}
	}

	h.publish(protocol.EventIssueUpdated, workspaceID, actorType, actorID, map[string]any{
		"issue":               resp,
		"assignee_changed":    assigneeChanged,
		"status_changed":      statusChanged,
		"priority_changed":    priorityChanged,
		"due_date_changed":    dueDateChanged,
		"description_changed": descriptionChanged,
		"title_changed":       titleChanged,
		"prev_title":          prevIssue.Title,
		"prev_assignee_type":  textToPtr(prevIssue.AssigneeType),
		"prev_assignee_id":    uuidToPtr(prevIssue.AssigneeID),
		"prev_status":         prevIssue.Status,
		"prev_priority":       prevIssue.Priority,
		"prev_due_date":       prevDueDate,
		"prev_description":    textToPtr(prevIssue.Description),
		"creator_type":        prevIssue.CreatorType,
		"creator_id":          uuidToString(prevIssue.CreatorID),
	})

	// Reconcile task queue when assignee changes (not on status changes —
	// agents manage issue status themselves via the CLI).
	if assigneeChanged {
		h.TaskService.CancelTasksForIssue(r.Context(), issue.ID)

		if h.shouldEnqueueAgentTask(r.Context(), issue) {
			h.TaskService.EnqueueTaskForIssue(r.Context(), issue)
		}
	}

	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) shouldEnqueueAgentTask(ctx context.Context, issue db.Issue) bool {
	if issue.Status != "todo" {
		return false
	}
	return h.isAgentTriggerEnabled(ctx, issue, "on_assign")
}

// shouldEnqueueOnComment returns true if a member comment on this issue should
// trigger the assigned agent. Conditions: issue is assigned to an agent, the
// agent has on_comment trigger enabled, and no task is already active.
func (h *Handler) shouldEnqueueOnComment(ctx context.Context, issue db.Issue) bool {
	// Don't trigger on terminal statuses.
	if issue.Status == "done" || issue.Status == "cancelled" {
		return false
	}
	if !h.isAgentTriggerEnabled(ctx, issue, "on_comment") {
		return false
	}
	// Coalescing queue: allow enqueue when a task is running (so the agent
	// picks up new comments on the next cycle) but skip if a pending task
	// already exists (natural dedup for rapid-fire comments).
	hasPending, err := h.Queries.HasPendingTaskForIssue(ctx, issue.ID)
	if err != nil || hasPending {
		return false
	}
	return true
}

// isAgentTriggerEnabled checks if an issue is assigned to an agent with a
// specific trigger type enabled. Returns true if the agent has no triggers
// configured (default-enabled behavior).
func (h *Handler) isAgentTriggerEnabled(ctx context.Context, issue db.Issue, triggerType string) bool {
	if !issue.AssigneeType.Valid || issue.AssigneeType.String != "agent" || !issue.AssigneeID.Valid {
		return false
	}

	agent, err := h.Queries.GetAgent(ctx, issue.AssigneeID)
	if err != nil || !agent.RuntimeID.Valid {
		return false
	}
	if agent.Triggers == nil || len(agent.Triggers) == 0 {
		return true
	}

	var triggers []agentTriggerSnapshot
	if err := json.Unmarshal(agent.Triggers, &triggers); err != nil {
		return false
	}
	for _, trigger := range triggers {
		if trigger.Type == triggerType && trigger.Enabled {
			return true
		}
	}
	return false
}

func (h *Handler) DeleteIssue(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	issue, ok := h.loadIssueForUser(w, r, id)
	if !ok {
		return
	}

	h.TaskService.CancelTasksForIssue(r.Context(), issue.ID)

	err := h.Queries.DeleteIssue(r.Context(), parseUUID(id))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete issue")
		return
	}

	userID := requestUserID(r)
	h.publish(protocol.EventIssueDeleted, uuidToString(issue.WorkspaceID), "member", userID, map[string]any{"issue_id": id})
	slog.Info("issue deleted", append(logger.RequestAttrs(r), "issue_id", id, "workspace_id", uuidToString(issue.WorkspaceID))...)
	w.WriteHeader(http.StatusNoContent)
}
