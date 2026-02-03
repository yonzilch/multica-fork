/**
 * sessions_spawn tool — allows a parent agent to spawn subagent runs.
 *
 * Subagents run in isolated sessions with restricted tools.
 * Results are announced back to the parent when the child completes.
 */

import { v7 as uuidv7 } from "uuid";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { getHub } from "../../hub/hub-singleton.js";
import { buildSubagentSystemPrompt } from "../subagent/announce.js";
import { registerSubagentRun } from "../subagent/registry.js";

const SessionsSpawnSchema = Type.Object({
  task: Type.String({ description: "The task for the subagent to perform.", minLength: 1 }),
  label: Type.Optional(
    Type.String({ description: "Human-readable label for this background task." }),
  ),
  model: Type.Optional(
    Type.String({ description: "Override the LLM model for the subagent (e.g. 'gpt-4o', 'claude-sonnet')." }),
  ),
  cleanup: Type.Optional(
    Type.Union([Type.Literal("delete"), Type.Literal("keep")], {
      description: "Session cleanup after completion. 'delete' removes session files, 'keep' preserves for audit. Default: 'delete'.",
    }),
  ),
  timeoutSeconds: Type.Optional(
    Type.Number({
      description: "Execution timeout in seconds. The subagent will be terminated if it exceeds this.",
      minimum: 1,
    }),
  ),
});

type SessionsSpawnArgs = {
  task: string;
  label?: string;
  model?: string;
  cleanup?: "delete" | "keep";
  timeoutSeconds?: number;
};

export type SessionsSpawnResult = {
  status: "accepted" | "error";
  childSessionId?: string;
  runId?: string;
  error?: string;
};

export interface CreateSessionsSpawnToolOptions {
  /** Whether the current agent is itself a subagent */
  isSubagent?: boolean;
  /** Session ID of the current (requester) agent */
  sessionId?: string;
}

export function createSessionsSpawnTool(
  options: CreateSessionsSpawnToolOptions,
): AgentTool<typeof SessionsSpawnSchema, SessionsSpawnResult> {
  return {
    name: "sessions_spawn",
    label: "Spawn Subagent",
    description:
      "Spawn a background subagent to handle a specific task. The subagent runs in an isolated session with its own tool set. " +
      "When it completes, its findings are announced back to you automatically. " +
      "Use this for parallelizable work, long-running analysis, or tasks that benefit from isolation.",
    parameters: SessionsSpawnSchema,
    execute: async (_toolCallId, args) => {
      const { task, label, model, cleanup = "delete", timeoutSeconds } = args as SessionsSpawnArgs;

      // Guard: subagents cannot spawn subagents
      if (options.isSubagent) {
        return {
          content: [{ type: "text", text: "Error: sessions_spawn is not allowed from sub-agent sessions." }],
          details: {
            status: "error",
            error: "sessions_spawn is not allowed from sub-agent sessions",
          },
        };
      }

      const requesterSessionId = options.sessionId ?? "unknown";
      const runId = uuidv7();
      const childSessionId = uuidv7();

      // Build system prompt for the child
      const systemPrompt = buildSubagentSystemPrompt({
        requesterSessionId,
        childSessionId,
        label,
        task,
      });

      // Spawn child agent via Hub
      try {
        const hub = getHub();
        const childAgent = hub.createSubagent(childSessionId, {
          systemPrompt,
          model,
        });

        // Register the run for lifecycle tracking
        registerSubagentRun({
          runId,
          childSessionId,
          requesterSessionId,
          task,
          label,
          cleanup,
          timeoutSeconds,
        });

        // Write the task to the child (non-blocking)
        childAgent.write(task);

        return {
          content: [
            {
              type: "text",
              text: `Subagent spawned successfully.\n\nRun ID: ${runId}\nSession: ${childSessionId}\nTask: ${label || task.slice(0, 80)}\n\nThe subagent is now working in the background. You will receive its findings when it completes.`,
            },
          ],
          details: {
            status: "accepted",
            childSessionId,
            runId,
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error spawning subagent: ${message}` }],
          details: {
            status: "error",
            error: message,
          },
        };
      }
    },
  };
}
