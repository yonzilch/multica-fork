package agent

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"time"
)

// A picoclaw backend mirroring openclaw’s JSON streaming protocol.
type picoclawBackend struct {
	cfg Config
}

func (b *picoclawBackend) Name() string { return "picoclaw" }

func (b *picoclawBackend) Execute(
	ctx context.Context,
	prompt string,
	opts ExecOptions,
) (*Session, error) {

	// Streaming channels
	msgCh := make(chan Message, 32)
	resCh := make(chan Result, 1)

	session := &Session{
		Messages: msgCh,
		Result:   resCh,
	}

	// --- Build args (same pattern as openclaw backend) ---
	args := []string{
		"agent",
		"--mode", "stream-json",
		"-m", prompt,
	}

	if opts.Model != "" {
		args = append(args, "--model", opts.Model)
	}
	if opts.SystemPrompt != "" {
		args = append(args, "--system-prompt", opts.SystemPrompt)
	}
	if opts.MaxTurns > 0 {
		args = append(args, "--max-turns", fmt.Sprint(opts.MaxTurns))
	}
	if opts.ResumeSessionID != "" {
		args = append(args, "--resume", opts.ResumeSessionID)
	}
	if opts.Timeout > 0 {
		args = append(args, "--timeout", opts.Timeout.String())
	}

	if opts.McpConfig != nil {
		args = append(args, "--mcp-config", string(opts.McpConfig))
	}

	if len(opts.CustomArgs) > 0 {
		args = append(args, opts.CustomArgs...)
	}

	// Executable path
	exe := b.cfg.ExecutablePath
	if exe == "" {
		exe = "picoclaw"
	}

	cmd := exec.CommandContext(ctx, exe, args...)

	if opts.Cwd != "" {
		cmd.Dir = opts.Cwd
	}

	// Environment variables
	if len(b.cfg.Env) != 0 {
		for k, v := range b.cfg.Env {
			cmd.Env = append(cmd.Env, fmt.Sprintf("%s=%s", k, v))
		}
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		close(msgCh)
		close(resCh)
		return nil, fmt.Errorf("picoclaw stdout pipe error: %w", err)
	}

	stderr, err := cmd.StderrPipe()
	if err != nil {
		close(msgCh)
		close(resCh)
		return nil, fmt.Errorf("picoclaw stderr pipe error: %w", err)
	}

	start := time.Now()

	if err := cmd.Start(); err != nil {
		close(msgCh)
		close(resCh)
		return nil, fmt.Errorf("picoclaw start error: %w", err)
	}

	// --- Stream stdout JSON events ---
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			line := scanner.Text()

			var m Message
			if err := json.Unmarshal([]byte(line), &m); err != nil {
				msgCh <- Message{
					Type:    MessageError,
					Content: fmt.Sprintf("invalid picoclaw JSON: %s", line),
				}
				continue
			}

			msgCh <- m
		}
	}()

	// --- Stream stderr as error/log events ---
	go func() {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			msgCh <- Message{Type: MessageError, Content: scanner.Text()}
		}
	}()

	// --- Final result ---
	go func() {
		err := cmd.Wait()
		duration := time.Since(start).Milliseconds()

		result := Result{
			Status:     "completed",
			Error:      "",
			SessionID:  "",
			DurationMs: duration,
			Usage:      map[string]TokenUsage{},
		}

		if err != nil {
			result.Status = "failed"
			result.Error = err.Error()
		}

		resCh <- result
		close(resCh)
		close(msgCh)
	}()

	return session, nil
}
