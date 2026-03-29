package daemon

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/multica-ai/multica/server/internal/cli"
	"github.com/multica-ai/multica/server/internal/daemon/execenv"
	"github.com/multica-ai/multica/server/internal/daemon/repocache"
	"github.com/multica-ai/multica/server/internal/daemon/usage"
	"github.com/multica-ai/multica/server/pkg/agent"
)

// workspaceState tracks registered runtimes for a single workspace.
type workspaceState struct {
	workspaceID string
	runtimeIDs  []string
}

// Daemon is the local agent runtime that polls for and executes tasks.
type Daemon struct {
	cfg       Config
	client    *Client
	repoCache *repocache.Cache
	logger    *slog.Logger

	mu           sync.Mutex
	workspaces   map[string]*workspaceState
	runtimeIndex map[string]Runtime // runtimeID -> Runtime for provider lookups
	reloading    sync.Mutex         // prevents concurrent reloadWorkspaces
}

// New creates a new Daemon instance.
func New(cfg Config, logger *slog.Logger) *Daemon {
	cacheRoot := filepath.Join(cfg.WorkspacesRoot, ".repos")
	return &Daemon{
		cfg:          cfg,
		client:       NewClient(cfg.ServerBaseURL),
		repoCache:    repocache.New(cacheRoot, logger),
		logger:       logger,
		workspaces:   make(map[string]*workspaceState),
		runtimeIndex: make(map[string]Runtime),
	}
}

// Run starts the daemon: resolves auth, registers runtimes, then polls for tasks.
func (d *Daemon) Run(ctx context.Context) error {
	// Bind health port early to detect another running daemon.
	healthLn, err := d.listenHealth()
	if err != nil {
		return err
	}

	agentNames := make([]string, 0, len(d.cfg.Agents))
	for name := range d.cfg.Agents {
		agentNames = append(agentNames, name)
	}
	d.logger.Info("starting daemon", "agents", agentNames, "server", d.cfg.ServerBaseURL)

	// Load auth token from CLI config.
	if err := d.resolveAuth(); err != nil {
		return err
	}

	// Load and register watched workspaces.
	if err := d.loadWatchedWorkspaces(ctx); err != nil {
		return err
	}

	runtimeIDs := d.allRuntimeIDs()
	if len(runtimeIDs) == 0 {
		return fmt.Errorf("no runtimes registered")
	}

	// Deregister runtimes on shutdown (uses a fresh context since ctx will be cancelled).
	defer d.deregisterRuntimes()

	// Start config watcher for hot-reload.
	go d.configWatchLoop(ctx)

	go d.heartbeatLoop(ctx)
	go d.usageScanLoop(ctx)
	go d.serveHealth(ctx, healthLn, time.Now())
	return d.pollLoop(ctx)
}

// deregisterRuntimes notifies the server that all runtimes are going offline.
func (d *Daemon) deregisterRuntimes() {
	runtimeIDs := d.allRuntimeIDs()
	if len(runtimeIDs) == 0 {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := d.client.Deregister(ctx, runtimeIDs); err != nil {
		d.logger.Warn("failed to deregister runtimes on shutdown", "error", err)
	} else {
		d.logger.Info("deregistered runtimes", "count", len(runtimeIDs))
	}
}

// resolveAuth loads the auth token from the CLI config.
func (d *Daemon) resolveAuth() error {
	cfg, err := cli.LoadCLIConfig()
	if err != nil {
		return fmt.Errorf("load CLI config: %w", err)
	}
	if cfg.Token == "" {
		d.logger.Warn("not authenticated — run 'multica login' to authenticate, then restart the daemon")
		return fmt.Errorf("not authenticated: run 'multica login' first")
	}
	d.client.SetToken(cfg.Token)
	d.logger.Info("authenticated")
	return nil
}

// loadWatchedWorkspaces reads watched workspaces from CLI config and registers runtimes.
func (d *Daemon) loadWatchedWorkspaces(ctx context.Context) error {
	cfg, err := cli.LoadCLIConfig()
	if err != nil {
		return fmt.Errorf("load CLI config: %w", err)
	}

	if len(cfg.WatchedWorkspaces) == 0 {
		return fmt.Errorf("no watched workspaces configured: run 'multica workspace watch <id>' to add one")
	}

	var registered int
	for _, ws := range cfg.WatchedWorkspaces {
		resp, err := d.registerRuntimesForWorkspace(ctx, ws.ID)
		if err != nil {
			d.logger.Error("failed to register runtimes", "workspace_id", ws.ID, "name", ws.Name, "error", err)
			continue
		}
		runtimeIDs := make([]string, len(resp.Runtimes))
		for i, rt := range resp.Runtimes {
			runtimeIDs[i] = rt.ID
			d.logger.Info("registered runtime", "workspace_id", ws.ID, "runtime_id", rt.ID, "provider", rt.Provider)
		}
		d.mu.Lock()
		d.workspaces[ws.ID] = &workspaceState{workspaceID: ws.ID, runtimeIDs: runtimeIDs}
		for _, rt := range resp.Runtimes {
			d.runtimeIndex[rt.ID] = rt
		}
		d.mu.Unlock()

		// Sync workspace repos to local cache.
		if d.repoCache != nil && len(resp.Repos) > 0 {
			if err := d.repoCache.Sync(ws.ID, repoDataToInfo(resp.Repos)); err != nil {
				d.logger.Warn("repo cache sync failed", "workspace_id", ws.ID, "error", err)
			}
		}

		d.logger.Info("watching workspace", "workspace_id", ws.ID, "name", ws.Name, "runtimes", len(resp.Runtimes), "repos", len(resp.Repos))
		registered++
	}

	if registered == 0 {
		return fmt.Errorf("failed to register runtimes for any of the %d watched workspace(s)", len(cfg.WatchedWorkspaces))
	}
	return nil
}

// allRuntimeIDs returns all runtime IDs across all watched workspaces.
func (d *Daemon) allRuntimeIDs() []string {
	d.mu.Lock()
	defer d.mu.Unlock()
	var ids []string
	for _, ws := range d.workspaces {
		ids = append(ids, ws.runtimeIDs...)
	}
	return ids
}

// findRuntime looks up a Runtime by its ID.
func (d *Daemon) findRuntime(id string) *Runtime {
	d.mu.Lock()
	defer d.mu.Unlock()
	if rt, ok := d.runtimeIndex[id]; ok {
		return &rt
	}
	return nil
}

// providerToRuntimeMap returns a mapping from provider name to runtime ID.
func (d *Daemon) providerToRuntimeMap() map[string]string {
	d.mu.Lock()
	defer d.mu.Unlock()
	m := make(map[string]string)
	for id, rt := range d.runtimeIndex {
		m[rt.Provider] = id
	}
	return m
}

func (d *Daemon) registerRuntimesForWorkspace(ctx context.Context, workspaceID string) (*RegisterResponse, error) {
	var runtimes []map[string]string
	for name, entry := range d.cfg.Agents {
		version, err := agent.DetectVersion(ctx, entry.Path)
		if err != nil {
			d.logger.Warn("skip registering runtime", "name", name, "error", err)
			continue
		}
		runtimes = append(runtimes, map[string]string{
			"name":    fmt.Sprintf("Local %s", strings.ToUpper(name[:1])+name[1:]),
			"type":    name,
			"version": version,
			"status":  "online",
		})
	}
	if len(runtimes) == 0 {
		return nil, fmt.Errorf("no agent runtimes could be registered")
	}

	req := map[string]any{
		"workspace_id": workspaceID,
		"daemon_id":    d.cfg.DaemonID,
		"device_name":  d.cfg.DeviceName,
		"runtimes":     runtimes,
	}

	resp, err := d.client.Register(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("register runtimes: %w", err)
	}
	if len(resp.Runtimes) == 0 {
		return nil, fmt.Errorf("register runtimes: empty response")
	}
	return resp, nil
}

// configWatchLoop periodically checks for config file changes and reloads workspaces.
func (d *Daemon) configWatchLoop(ctx context.Context) {
	configPath, err := cli.CLIConfigPath()
	if err != nil {
		d.logger.Warn("cannot watch config file", "error", err)
		return
	}

	var lastModTime time.Time
	if info, err := os.Stat(configPath); err == nil {
		lastModTime = info.ModTime()
	}

	ticker := time.NewTicker(DefaultConfigReloadInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			info, err := os.Stat(configPath)
			if err != nil {
				continue
			}
			if !info.ModTime().After(lastModTime) {
				continue
			}
			lastModTime = info.ModTime()
			d.reloadWorkspaces(ctx)
		}
	}
}

// reloadWorkspaces reconciles the active workspace set with the config file.
// NOTE: Token changes (e.g. re-login as a different user) are not picked up;
// the daemon must be restarted for a new auth token to take effect.
func (d *Daemon) reloadWorkspaces(ctx context.Context) {
	d.reloading.Lock()
	defer d.reloading.Unlock()

	cfg, err := cli.LoadCLIConfig()
	if err != nil {
		d.logger.Warn("reload config failed", "error", err)
		return
	}

	newIDs := make(map[string]string) // id -> name
	for _, ws := range cfg.WatchedWorkspaces {
		newIDs[ws.ID] = ws.Name
	}

	d.mu.Lock()
	currentIDs := make(map[string]bool)
	for id := range d.workspaces {
		currentIDs[id] = true
	}
	d.mu.Unlock()

	// Register runtimes for newly added workspaces.
	for id, name := range newIDs {
		if !currentIDs[id] {
			resp, err := d.registerRuntimesForWorkspace(ctx, id)
			if err != nil {
				d.logger.Error("register runtimes for new workspace failed", "workspace_id", id, "error", err)
				continue
			}
			runtimeIDs := make([]string, len(resp.Runtimes))
			for i, rt := range resp.Runtimes {
				runtimeIDs[i] = rt.ID
			}
			d.mu.Lock()
			d.workspaces[id] = &workspaceState{workspaceID: id, runtimeIDs: runtimeIDs}
			for _, rt := range resp.Runtimes {
				d.runtimeIndex[rt.ID] = rt
			}
			d.mu.Unlock()

			// Sync workspace repos to local cache.
			if d.repoCache != nil && len(resp.Repos) > 0 {
				if err := d.repoCache.Sync(id, repoDataToInfo(resp.Repos)); err != nil {
					d.logger.Warn("repo cache sync failed", "workspace_id", id, "error", err)
				}
			}

			d.logger.Info("now watching workspace", "workspace_id", id, "name", name)
		}
	}

	// Remove workspaces no longer in config.
	// NOTE: runtimes are not deregistered server-side; they will go offline
	// after heartbeats stop arriving (within HeartbeatInterval).
	for id := range currentIDs {
		if _, ok := newIDs[id]; !ok {
			d.mu.Lock()
			if ws, exists := d.workspaces[id]; exists {
				for _, rid := range ws.runtimeIDs {
					delete(d.runtimeIndex, rid)
				}
			}
			delete(d.workspaces, id)
			d.mu.Unlock()
			d.logger.Info("stopped watching workspace", "workspace_id", id)
		}
	}
}

func (d *Daemon) heartbeatLoop(ctx context.Context) {
	ticker := time.NewTicker(d.cfg.HeartbeatInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			for _, rid := range d.allRuntimeIDs() {
				resp, err := d.client.SendHeartbeat(ctx, rid)
				if err != nil {
					d.logger.Warn("heartbeat failed", "runtime_id", rid, "error", err)
					continue
				}

				// Handle pending ping requests.
				if resp.PendingPing != nil {
					rt := d.findRuntime(rid)
					if rt != nil {
						go d.handlePing(ctx, *rt, resp.PendingPing.ID)
					}
				}
			}
		}
	}
}

func (d *Daemon) handlePing(ctx context.Context, rt Runtime, pingID string) {
	d.logger.Info("ping requested", "runtime_id", rt.ID, "ping_id", pingID, "provider", rt.Provider)

	start := time.Now()

	entry, ok := d.cfg.Agents[rt.Provider]
	if !ok {
		d.client.ReportPingResult(ctx, rt.ID, pingID, map[string]any{
			"status":      "failed",
			"error":       fmt.Sprintf("no agent configured for provider %q", rt.Provider),
			"duration_ms": time.Since(start).Milliseconds(),
		})
		return
	}

	backend, err := agent.New(rt.Provider, agent.Config{
		ExecutablePath: entry.Path,
		Logger:         d.logger,
	})
	if err != nil {
		d.client.ReportPingResult(ctx, rt.ID, pingID, map[string]any{
			"status":      "failed",
			"error":       err.Error(),
			"duration_ms": time.Since(start).Milliseconds(),
		})
		return
	}

	pingCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	session, err := backend.Execute(pingCtx, "Respond with exactly one word: pong", agent.ExecOptions{
		MaxTurns: 1,
		Timeout:  60 * time.Second,
	})
	if err != nil {
		d.client.ReportPingResult(ctx, rt.ID, pingID, map[string]any{
			"status":      "failed",
			"error":       err.Error(),
			"duration_ms": time.Since(start).Milliseconds(),
		})
		return
	}

	// Drain messages
	go func() {
		for range session.Messages {
		}
	}()

	result := <-session.Result
	durationMs := time.Since(start).Milliseconds()

	if result.Status == "completed" {
		d.logger.Info("ping completed", "runtime_id", rt.ID, "ping_id", pingID, "duration_ms", durationMs)
		d.client.ReportPingResult(ctx, rt.ID, pingID, map[string]any{
			"status":      "completed",
			"output":      result.Output,
			"duration_ms": durationMs,
		})
	} else {
		errMsg := result.Error
		if errMsg == "" {
			errMsg = fmt.Sprintf("agent returned status: %s", result.Status)
		}
		d.logger.Warn("ping failed", "runtime_id", rt.ID, "ping_id", pingID, "error", errMsg)
		d.client.ReportPingResult(ctx, rt.ID, pingID, map[string]any{
			"status":      "failed",
			"error":       errMsg,
			"duration_ms": durationMs,
		})
	}
}

func (d *Daemon) usageScanLoop(ctx context.Context) {
	scanner := usage.NewScanner(d.logger)

	report := func() {
		records := scanner.Scan()
		if len(records) == 0 {
			return
		}

		// Build provider -> runtime ID mapping from current state.
		providerToRuntime := d.providerToRuntimeMap()

		// Group records by provider to send to the correct runtime.
		byProvider := make(map[string][]map[string]any)
		for _, r := range records {
			byProvider[r.Provider] = append(byProvider[r.Provider], map[string]any{
				"date":               r.Date,
				"provider":           r.Provider,
				"model":              r.Model,
				"input_tokens":       r.InputTokens,
				"output_tokens":      r.OutputTokens,
				"cache_read_tokens":  r.CacheReadTokens,
				"cache_write_tokens": r.CacheWriteTokens,
			})
		}

		for provider, entries := range byProvider {
			runtimeID, ok := providerToRuntime[provider]
			if !ok {
				d.logger.Debug("no runtime for provider, skipping usage report", "provider", provider)
				continue
			}
			if err := d.client.ReportUsage(ctx, runtimeID, entries); err != nil {
				d.logger.Warn("usage report failed", "provider", provider, "runtime_id", runtimeID, "error", err)
			} else {
				d.logger.Info("usage reported", "provider", provider, "runtime_id", runtimeID, "entries", len(entries))
			}
		}
	}

	// Initial scan on startup.
	report()

	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			report()
		}
	}
}

func (d *Daemon) pollLoop(ctx context.Context) error {
	pollOffset := 0
	pollCount := 0
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		runtimeIDs := d.allRuntimeIDs()
		if len(runtimeIDs) == 0 {
			if err := sleepWithContext(ctx, d.cfg.PollInterval); err != nil {
				return err
			}
			continue
		}

		claimed := false
		n := len(runtimeIDs)
		for i := 0; i < n; i++ {
			rid := runtimeIDs[(pollOffset+i)%n]
			task, err := d.client.ClaimTask(ctx, rid)
			if err != nil {
				d.logger.Warn("claim task failed", "runtime_id", rid, "error", err)
				continue
			}
			if task != nil {
				d.logger.Info("task received", "task_id", task.ID, "issue_id", task.IssueID)
				d.handleTask(ctx, *task)
				claimed = true
				pollOffset = (pollOffset + i + 1) % n
				break
			}
		}

		if !claimed {
			pollCount++
			if pollCount%20 == 1 {
				d.logger.Debug("poll: no tasks", "runtimes", runtimeIDs, "cycle", pollCount)
			}
			pollOffset = (pollOffset + 1) % n
			if err := sleepWithContext(ctx, d.cfg.PollInterval); err != nil {
				return err
			}
		} else {
			pollCount = 0
		}
	}
}

func (d *Daemon) handleTask(ctx context.Context, task Task) {
	d.mu.Lock()
	rt := d.runtimeIndex[task.RuntimeID]
	d.mu.Unlock()
	provider := rt.Provider
	d.logger.Info("picked task", "task_id", task.ID, "issue_id", task.IssueID, "provider", provider)

	if err := d.client.StartTask(ctx, task.ID); err != nil {
		d.logger.Error("start task failed", "task_id", task.ID, "error", err)
		return
	}

	_ = d.client.ReportProgress(ctx, task.ID, fmt.Sprintf("Launching %s", provider), 1, 2)

	result, err := d.runTask(ctx, task, provider)
	if err != nil {
		d.logger.Error("task failed", "task_id", task.ID, "error", err)
		if failErr := d.client.FailTask(ctx, task.ID, err.Error()); failErr != nil {
			d.logger.Error("fail task callback failed", "task_id", task.ID, "error", failErr)
		}
		return
	}

	_ = d.client.ReportProgress(ctx, task.ID, "Finishing task", 2, 2)

	// Check if the task was cancelled while it was running (e.g. issue
	// was reassigned). If so, skip reporting results — the server already
	// moved the task to 'cancelled' so complete/fail would fail anyway.
	if status, err := d.client.GetTaskStatus(ctx, task.ID); err == nil && status == "cancelled" {
		d.logger.Info("task was cancelled during execution, discarding result", "task_id", task.ID)
		return
	}

	switch result.Status {
	case "blocked":
		if err := d.client.FailTask(ctx, task.ID, result.Comment); err != nil {
			d.logger.Error("report blocked task failed", "task_id", task.ID, "error", err)
		}
	default:
		d.logger.Info("task completed", "task_id", task.ID, "status", result.Status)
		if err := d.client.CompleteTask(ctx, task.ID, result.Comment, result.BranchName, result.SessionID, result.WorkDir); err != nil {
			d.logger.Error("complete task failed", "task_id", task.ID, "error", err)
		}
	}
}

func (d *Daemon) runTask(ctx context.Context, task Task, provider string) (TaskResult, error) {
	entry, ok := d.cfg.Agents[provider]
	if !ok {
		return TaskResult{}, fmt.Errorf("no agent configured for provider %q", provider)
	}

	agentName := "agent"
	var skills []SkillData
	var instructions string
	if task.Agent != nil {
		agentName = task.Agent.Name
		skills = task.Agent.Skills
		instructions = task.Agent.Instructions
	}

	// Prepare isolated execution environment.
	// Repos are passed as metadata only — the agent checks them out on demand
	// via `multica repo checkout <url>`.
	taskCtx := execenv.TaskContextForEnv{
		IssueID:           task.IssueID,
		AgentName:         agentName,
		AgentInstructions: instructions,
		AgentSkills:       convertSkillsForEnv(skills),
		Repos:             convertReposForEnv(task.Repos),
	}

	// Try to reuse the workdir from a previous task on the same (agent, issue) pair.
	var env *execenv.Environment
	if task.PriorWorkDir != "" {
		env = execenv.Reuse(task.PriorWorkDir, provider, taskCtx, d.logger)
	}
	if env == nil {
		var err error
		env, err = execenv.Prepare(execenv.PrepareParams{
			WorkspacesRoot: d.cfg.WorkspacesRoot,
			TaskID:         task.ID,
			AgentName:      agentName,
			Provider:       provider,
			Task:           taskCtx,
		}, d.logger)
		if err != nil {
			return TaskResult{}, fmt.Errorf("prepare execution environment: %w", err)
		}
	}

	// Inject runtime-specific config (meta skill) so the agent discovers .agent_context/.
	if err := execenv.InjectRuntimeConfig(env.WorkDir, provider, taskCtx); err != nil {
		d.logger.Warn("execenv: inject runtime config failed (non-fatal)", "error", err)
	}
	// NOTE: No cleanup — workdir is preserved for reuse by future tasks on
	// the same (agent, issue) pair. The work_dir path is stored in DB on
	// task completion and passed back via PriorWorkDir on the next claim.

	prompt := BuildPrompt(task)

	// Pass the daemon's auth credentials and context so the spawned agent CLI
	// can call the Multica API and the local daemon (e.g. `multica repo checkout`).
	agentEnv := map[string]string{
		"MULTICA_TOKEN":        d.client.Token(),
		"MULTICA_SERVER_URL":   d.cfg.ServerBaseURL,
		"MULTICA_DAEMON_PORT":  fmt.Sprintf("%d", d.cfg.HealthPort),
		"MULTICA_WORKSPACE_ID": d.workspaceIDForRuntime(task.RuntimeID),
		"MULTICA_AGENT_NAME":   agentName,
		"MULTICA_AGENT_ID":     task.AgentID,
		"MULTICA_TASK_ID":      task.ID,
	}
	// Point Codex to the per-task CODEX_HOME so it discovers skills natively
	// without polluting the system ~/.codex/skills/.
	if env.CodexHome != "" {
		agentEnv["CODEX_HOME"] = env.CodexHome
	}
	backend, err := agent.New(provider, agent.Config{
		ExecutablePath: entry.Path,
		Env:            agentEnv,
		Logger:         d.logger,
	})
	if err != nil {
		return TaskResult{}, fmt.Errorf("create agent backend: %w", err)
	}

	d.logger.Info("starting agent", "provider", provider, "task_id", task.ID, "workdir", env.WorkDir, "reused", task.PriorWorkDir != "" && env.WorkDir == task.PriorWorkDir, "model", entry.Model, "timeout", d.cfg.AgentTimeout.String(), "resume_session", task.PriorSessionID)

	session, err := backend.Execute(ctx, prompt, agent.ExecOptions{
		Cwd:             env.WorkDir,
		Model:           entry.Model,
		Timeout:         d.cfg.AgentTimeout,
		ResumeSessionID: task.PriorSessionID,
	})
	if err != nil {
		return TaskResult{}, err
	}

	// Drain message channel (log tool uses, ignore text since Result has output)
	go func() {
		for msg := range session.Messages {
			switch msg.Type {
			case agent.MessageToolUse:
				d.logger.Debug("tool-use", "provider", provider, "tool", msg.Tool, "call_id", msg.CallID)
			case agent.MessageError:
				d.logger.Error("agent error", "provider", provider, "content", msg.Content)
			}
		}
	}()

	result := <-session.Result

	switch result.Status {
	case "completed":
		if result.Output == "" {
			return TaskResult{}, fmt.Errorf("%s returned empty output", provider)
		}
		return TaskResult{
			Status:    "completed",
			Comment:   result.Output,
			SessionID: result.SessionID,
			WorkDir:   env.WorkDir,
		}, nil
	case "timeout":
		return TaskResult{}, fmt.Errorf("%s timed out after %s", provider, d.cfg.AgentTimeout)
	default:
		errMsg := result.Error
		if errMsg == "" {
			errMsg = fmt.Sprintf("%s execution %s", provider, result.Status)
		}
		return TaskResult{Status: "blocked", Comment: errMsg}, nil
	}
}

// repoDataToInfo converts daemon RepoData to repocache RepoInfo.
func repoDataToInfo(repos []RepoData) []repocache.RepoInfo {
	info := make([]repocache.RepoInfo, len(repos))
	for i, r := range repos {
		info[i] = repocache.RepoInfo{URL: r.URL, Description: r.Description}
	}
	return info
}

// workspaceIDForRuntime returns the workspace ID that a runtime belongs to.
func (d *Daemon) workspaceIDForRuntime(runtimeID string) string {
	d.mu.Lock()
	defer d.mu.Unlock()
	for _, ws := range d.workspaces {
		for _, rid := range ws.runtimeIDs {
			if rid == runtimeID {
				return ws.workspaceID
			}
		}
	}
	return ""
}

func convertReposForEnv(repos []RepoData) []execenv.RepoContextForEnv {
	if len(repos) == 0 {
		return nil
	}
	result := make([]execenv.RepoContextForEnv, len(repos))
	for i, r := range repos {
		result[i] = execenv.RepoContextForEnv{URL: r.URL, Description: r.Description}
	}
	return result
}

func convertSkillsForEnv(skills []SkillData) []execenv.SkillContextForEnv {
	if len(skills) == 0 {
		return nil
	}
	result := make([]execenv.SkillContextForEnv, len(skills))
	for i, s := range skills {
		result[i] = execenv.SkillContextForEnv{
			Name:    s.Name,
			Content: s.Content,
		}
		for _, f := range s.Files {
			result[i].Files = append(result[i].Files, execenv.SkillFileContextForEnv{
				Path:    f.Path,
				Content: f.Content,
			})
		}
	}
	return result
}
