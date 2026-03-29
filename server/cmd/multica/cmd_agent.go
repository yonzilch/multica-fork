package main

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"time"

	"github.com/spf13/cobra"

	"github.com/multica-ai/multica/server/internal/cli"
	"github.com/multica-ai/multica/server/internal/daemon"
)

var agentCmd = &cobra.Command{
	Use:   "agent",
	Short: "Manage agents",
}

var agentListCmd = &cobra.Command{
	Use:   "list",
	Short: "List agents in the workspace",
	RunE:  runAgentList,
}

func init() {
	agentCmd.AddCommand(agentListCmd)

	agentListCmd.Flags().String("output", "table", "Output format: table or json")
}

func newAPIClient(cmd *cobra.Command) (*cli.APIClient, error) {
	serverURL := resolveServerURL(cmd)
	workspaceID := resolveWorkspaceID(cmd)
	token := resolveToken()

	if serverURL == "" {
		return nil, fmt.Errorf("server URL not set: use --server-url flag, MULTICA_SERVER_URL env, or 'multica config set server_url <url>'")
	}

	client := cli.NewAPIClient(serverURL, workspaceID, token)
	// When running inside a daemon task, attribute actions to the agent.
	if agentID := os.Getenv("MULTICA_AGENT_ID"); agentID != "" {
		client.AgentID = agentID
	}
	return client, nil
}

func resolveServerURL(cmd *cobra.Command) string {
	val := cli.FlagOrEnv(cmd, "server-url", "MULTICA_SERVER_URL", "")
	if val != "" {
		return normalizeAPIBaseURL(val)
	}
	cfg, err := cli.LoadCLIConfig()
	if err != nil {
		return "http://localhost:8080"
	}
	if cfg.ServerURL != "" {
		return normalizeAPIBaseURL(cfg.ServerURL)
	}
	return "http://localhost:8080"
}

func normalizeAPIBaseURL(raw string) string {
	normalized, err := daemon.NormalizeServerBaseURL(raw)
	if err == nil {
		return normalized
	}
	return raw
}

func resolveWorkspaceID(cmd *cobra.Command) string {
	val := cli.FlagOrEnv(cmd, "workspace-id", "MULTICA_WORKSPACE_ID", "")
	if val != "" {
		return val
	}
	cfg, _ := cli.LoadCLIConfig()
	return cfg.WorkspaceID
}

func runAgentList(cmd *cobra.Command, _ []string) error {
	client, err := newAPIClient(cmd)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	var agents []map[string]any
	path := "/api/agents"
	if client.WorkspaceID != "" {
		path += "?" + url.Values{"workspace_id": {client.WorkspaceID}}.Encode()
	}
	if err := client.GetJSON(ctx, path, &agents); err != nil {
		return fmt.Errorf("list agents: %w", err)
	}

	output, _ := cmd.Flags().GetString("output")
	if output == "json" {
		return cli.PrintJSON(os.Stdout, agents)
	}

	headers := []string{"ID", "NAME", "STATUS", "RUNTIME"}
	rows := make([][]string, 0, len(agents))
	for _, a := range agents {
		rows = append(rows, []string{
			strVal(a, "id"),
			strVal(a, "name"),
			strVal(a, "status"),
			strVal(a, "runtime_mode"),
		})
	}
	cli.PrintTable(os.Stdout, headers, rows)
	return nil
}

func strVal(m map[string]any, key string) string {
	v, ok := m[key]
	if !ok || v == nil {
		return ""
	}
	return fmt.Sprintf("%v", v)
}
