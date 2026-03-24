"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Bot,
  Cloud,
  Monitor,
  Plus,
  ListTodo,
  Wrench,
  FileText,
  Timer,
  Trash2,
  Save,
  Key,
  Link2,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  MoreHorizontal,
  Play,
  ChevronDown,
} from "lucide-react";
import type {
  Agent,
  AgentStatus,
  AgentTool,
  AgentTrigger,
  AgentTask,
  RuntimeDevice,
  CreateAgentRequest,
  UpdateAgentRequest,
} from "@multica/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@multica/ui/components/ui/dialog";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { Label } from "@multica/ui/components/ui/label";
import { api } from "@/shared/api";
import { useAuthStore } from "@/features/auth";
import { useWorkspaceStore } from "@/features/workspace";
import { useWSEvent } from "@/features/realtime";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const statusConfig: Record<AgentStatus, { label: string; color: string; dot: string }> = {
  idle: { label: "Idle", color: "text-muted-foreground", dot: "bg-muted-foreground" },
  working: { label: "Working", color: "text-success", dot: "bg-success" },
  blocked: { label: "Blocked", color: "text-warning", dot: "bg-warning" },
  error: { label: "Error", color: "text-destructive", dot: "bg-destructive" },
  offline: { label: "Offline", color: "text-muted-foreground/50", dot: "bg-muted-foreground/40" },
};

const taskStatusConfig: Record<string, { label: string; icon: typeof CheckCircle2; color: string }> = {
  queued: { label: "Queued", icon: Clock, color: "text-muted-foreground" },
  dispatched: { label: "Dispatched", icon: Play, color: "text-info" },
  running: { label: "Running", icon: Loader2, color: "text-success" },
  completed: { label: "Completed", icon: CheckCircle2, color: "text-success" },
  failed: { label: "Failed", icon: XCircle, color: "text-destructive" },
  cancelled: { label: "Cancelled", icon: XCircle, color: "text-muted-foreground" },
};

function getInitials(name: string): string {
  return name
    .split(/[\s-]+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function getRuntimeDevice(agent: Agent, runtimes: RuntimeDevice[]): RuntimeDevice | undefined {
  return runtimes.find((runtime) => runtime.id === agent.runtime_id);
}

// ---------------------------------------------------------------------------
// Create Agent Dialog
// ---------------------------------------------------------------------------

function CreateAgentDialog({
  runtimes,
  onClose,
  onCreate,
}: {
  runtimes: RuntimeDevice[];
  onClose: () => void;
  onCreate: (data: CreateAgentRequest) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedRuntimeId, setSelectedRuntimeId] = useState(runtimes[0]?.id ?? "");
  const [creating, setCreating] = useState(false);
  const [runtimeOpen, setRuntimeOpen] = useState(false);

  useEffect(() => {
    if (!selectedRuntimeId && runtimes[0]) {
      setSelectedRuntimeId(runtimes[0].id);
    }
  }, [runtimes, selectedRuntimeId]);

  const selectedRuntime = runtimes.find((d) => d.id === selectedRuntimeId) ?? null;

  const handleSubmit = async () => {
    if (!name.trim() || !selectedRuntime) return;
    setCreating(true);
    try {
      await onCreate({
        name: name.trim(),
        description: description.trim(),
        runtime_id: selectedRuntime.id,
        triggers: [{ id: generateId(), type: "on_assign", enabled: true, config: {} }],
      });
      onClose();
    } catch {
      setCreating(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Agent</DialogTitle>
          <DialogDescription>
            Create a new AI agent for your workspace.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-xs text-muted-foreground">Name</Label>
            <Input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Deep Research Agent"
              className="mt-1"
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            />
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Description</Label>
            <Input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this agent do?"
              className="mt-1"
            />
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Runtime</Label>
            <div className="relative mt-1.5">
              <Button
                type="button"
                variant="outline"
                onClick={() => setRuntimeOpen(!runtimeOpen)}
                disabled={runtimes.length === 0}
                className="flex w-full items-center gap-3 px-3 py-2.5 h-auto text-left text-sm"
              >
                {selectedRuntime?.runtime_mode === "cloud" ? (
                  <Cloud className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <Monitor className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">
                      {selectedRuntime?.name ?? "No runtime available"}
                    </span>
                    {selectedRuntime?.runtime_mode === "cloud" && (
                      <span className="shrink-0 rounded bg-info/10 px-1.5 py-0.5 text-[10px] font-medium text-info">
                        Cloud
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {selectedRuntime?.device_info ?? "Register a runtime before creating an agent"}
                  </div>
                </div>
                <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${runtimeOpen ? "rotate-180" : ""}`} />
              </Button>

              {runtimeOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setRuntimeOpen(false)} />
                  <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-lg border bg-popover p-1 shadow-md">
                    {runtimes.map((device) => (
                      <button
                        key={device.id}
                        onClick={() => {
                          setSelectedRuntimeId(device.id);
                          setRuntimeOpen(false);
                        }}
                        className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors ${
                          device.id === selectedRuntimeId ? "bg-accent" : "hover:bg-accent/50"
                        }`}
                      >
                        {device.runtime_mode === "cloud" ? (
                          <Cloud className="h-4 w-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <Monitor className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-medium">{device.name}</span>
                            {device.runtime_mode === "cloud" && (
                              <span className="shrink-0 rounded bg-info/10 px-1.5 py-0.5 text-[10px] font-medium text-info">
                                Cloud
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">{device.device_info}</div>
                        </div>
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${
                            device.status === "online" ? "bg-success" : "bg-muted-foreground/40"
                          }`}
                        />
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={creating || !name.trim() || !selectedRuntime}
          >
            {creating ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Agent List Item
// ---------------------------------------------------------------------------

function AgentListItem({
  agent,
  isSelected,
  onClick,
}: {
  agent: Agent;
  isSelected: boolean;
  onClick: () => void;
}) {
  const st = statusConfig[agent.status];

  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${
        isSelected ? "bg-accent" : "hover:bg-accent/50"
      }`}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-semibold">
        {getInitials(agent.name)}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{agent.name}</span>
          {agent.runtime_mode === "cloud" ? (
            <Cloud className="h-3 w-3 text-muted-foreground" />
          ) : (
            <Monitor className="h-3 w-3 text-muted-foreground" />
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
          <span className={`text-xs ${st.color}`}>{st.label}</span>
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Skills Tab
// ---------------------------------------------------------------------------

function SkillsTab({
  agent,
  onSave,
}: {
  agent: Agent;
  onSave: (skills: string) => Promise<void>;
}) {
  const [skills, setSkills] = useState(agent.skills);
  const [saving, setSaving] = useState(false);
  const isDirty = skills !== agent.skills;

  useEffect(() => {
    setSkills(agent.skills);
  }, [agent.id, agent.skills]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(skills);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Skills</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Define what this agent does and how it should accomplish tasks. Supports Markdown.
          </p>
        </div>
        {isDirty && (
          <Button
            onClick={handleSave}
            disabled={saving}
            size="xs"
          >
            <Save className="h-3 w-3" />
            {saving ? "Saving..." : "Save"}
          </Button>
        )}
      </div>
      <Textarea
        value={skills}
        onChange={(e) => setSkills(e.target.value)}
        placeholder={`# Agent Name\n\nDescribe what this agent does and how it should work.\n\n## Workflow\n1. Step one\n2. Step two\n3. Step three\n\n## Output Format\nDescribe the expected output...`}
        className="h-96 resize-none font-mono leading-relaxed"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tools Tab
// ---------------------------------------------------------------------------

function AddToolDialog({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (tool: AgentTool) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [authType, setAuthType] = useState<"oauth" | "api_key" | "none">("api_key");

  const handleAdd = () => {
    if (!name.trim()) return;
    onAdd({
      id: generateId(),
      name: name.trim(),
      description: description.trim(),
      auth_type: authType,
      connected: false,
      config: {},
    });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Add Tool</DialogTitle>
          <DialogDescription className="text-xs">
            Connect an external tool for this agent to use.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">Tool Name</Label>
            <Input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Google Search, Slack, GitHub"
              className="mt-1"
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Description</Label>
            <Input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this tool do?"
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Authentication</Label>
            <div className="mt-1.5 flex gap-2">
              {(["api_key", "oauth", "none"] as const).map((type) => (
                <Button
                  key={type}
                  variant={authType === type ? "outline" : "ghost"}
                  size="xs"
                  onClick={() => setAuthType(type)}
                  className={`flex-1 ${
                    authType === type
                      ? "border-primary bg-primary/5 font-medium"
                      : ""
                  }`}
                >
                  {type === "api_key" ? "API Key" : type === "oauth" ? "OAuth" : "None"}
                </Button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleAdd}
            disabled={!name.trim()}
          >
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ToolsTab({
  agent,
  onSave,
}: {
  agent: Agent;
  onSave: (tools: AgentTool[]) => Promise<void>;
}) {
  const [tools, setTools] = useState<AgentTool[]>(agent.tools ?? []);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTools(agent.tools ?? []);
  }, [agent.id, agent.tools]);

  const isDirty = JSON.stringify(tools) !== JSON.stringify(agent.tools ?? []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(tools);
    } finally {
      setSaving(false);
    }
  };

  const toggleConnect = (toolId: string) => {
    setTools((prev) =>
      prev.map((t) => (t.id === toolId ? { ...t, connected: !t.connected } : t)),
    );
  };

  const removeTool = (toolId: string) => {
    setTools((prev) => prev.filter((t) => t.id !== toolId));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Tools</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            External tools and APIs this agent can use during task execution.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isDirty && (
            <Button
              onClick={handleSave}
              disabled={saving}
              size="xs"
            >
              <Save className="h-3 w-3" />
              {saving ? "Saving..." : "Save"}
            </Button>
          )}
          <Button
            variant="outline"
            size="xs"
            onClick={() => setShowAdd(true)}
          >
            <Plus className="h-3 w-3" />
            Add Tool
          </Button>
        </div>
      </div>

      {tools.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
          <Wrench className="h-8 w-8 text-muted-foreground/40" />
          <p className="mt-3 text-sm text-muted-foreground">No tools configured</p>
          <Button
            onClick={() => setShowAdd(true)}
            size="xs"
            className="mt-3"
          >
            <Plus className="h-3 w-3" />
            Add Tool
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {tools.map((tool) => (
            <div
              key={tool.id}
              className="flex items-center gap-3 rounded-lg border px-4 py-3"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                {tool.auth_type === "oauth" ? (
                  <Link2 className="h-4 w-4 text-muted-foreground" />
                ) : tool.auth_type === "api_key" ? (
                  <Key className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Wrench className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{tool.name}</div>
                {tool.description && (
                  <div className="text-xs text-muted-foreground truncate">
                    {tool.description}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => toggleConnect(tool.id)}
                  className={
                    tool.connected
                      ? "bg-success/10 text-success"
                      : "bg-muted text-muted-foreground hover:bg-accent"
                  }
                >
                  {tool.connected ? "Connected" : "Connect"}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => removeTool(tool.id)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <AddToolDialog
          onClose={() => setShowAdd(false)}
          onAdd={(tool) => setTools((prev) => [...prev, tool])}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Triggers Tab
// ---------------------------------------------------------------------------

function TriggersTab({
  agent,
  onSave,
}: {
  agent: Agent;
  onSave: (triggers: AgentTrigger[]) => Promise<void>;
}) {
  const [triggers, setTriggers] = useState<AgentTrigger[]>(agent.triggers ?? []);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTriggers(agent.triggers ?? []);
  }, [agent.id, agent.triggers]);

  const isDirty = JSON.stringify(triggers) !== JSON.stringify(agent.triggers ?? []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(triggers);
    } finally {
      setSaving(false);
    }
  };

  const toggleTrigger = (triggerId: string) => {
    setTriggers((prev) =>
      prev.map((t) => (t.id === triggerId ? { ...t, enabled: !t.enabled } : t)),
    );
  };

  const removeTrigger = (triggerId: string) => {
    setTriggers((prev) => prev.filter((t) => t.id !== triggerId));
  };

  const addTrigger = (type: "on_assign" | "scheduled") => {
    const newTrigger: AgentTrigger = {
      id: generateId(),
      type,
      enabled: true,
      config: type === "scheduled" ? { cron: "0 9 * * 1-5", timezone: "UTC" } : {},
    };
    setTriggers((prev) => [...prev, newTrigger]);
  };

  const updateTriggerConfig = (triggerId: string, config: Record<string, unknown>) => {
    setTriggers((prev) =>
      prev.map((t) => (t.id === triggerId ? { ...t, config } : t)),
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Triggers</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure when this agent should start working.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isDirty && (
            <Button
              onClick={handleSave}
              disabled={saving}
              size="xs"
            >
              <Save className="h-3 w-3" />
              {saving ? "Saving..." : "Save"}
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {triggers.map((trigger) => (
          <div
            key={trigger.id}
            className="rounded-lg border px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                {trigger.type === "on_assign" ? (
                  <Bot className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Timer className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">
                  {trigger.type === "on_assign" ? "On Issue Assign" : "Scheduled"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {trigger.type === "on_assign"
                    ? "Runs when an issue is assigned to this agent"
                    : `Cron: ${(trigger.config as { cron?: string }).cron ?? "Not set"}`}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => toggleTrigger(trigger.id)}
                  className={`relative h-5 w-9 rounded-full transition-colors ${
                    trigger.enabled ? "bg-primary" : "bg-muted"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                      trigger.enabled ? "left-[18px]" : "left-0.5"
                    }`}
                  />
                </button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => removeTrigger(trigger.id)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {trigger.type === "scheduled" && (
              <div className="mt-3 grid grid-cols-2 gap-3 pl-12">
                <div>
                  <Label className="text-xs text-muted-foreground">
                    Cron Expression
                  </Label>
                  <Input
                    type="text"
                    value={(trigger.config as { cron?: string }).cron ?? ""}
                    onChange={(e) =>
                      updateTriggerConfig(trigger.id, {
                        ...trigger.config,
                        cron: e.target.value,
                      })
                    }
                    placeholder="0 9 * * 1-5"
                    className="mt-1 text-xs font-mono"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">
                    Timezone
                  </Label>
                  <Input
                    type="text"
                    value={(trigger.config as { timezone?: string }).timezone ?? ""}
                    onChange={(e) =>
                      updateTriggerConfig(trigger.id, {
                        ...trigger.config,
                        timezone: e.target.value,
                      })
                    }
                    placeholder="UTC"
                    className="mt-1 text-xs"
                  />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <Button
          variant="outline"
          size="xs"
          onClick={() => addTrigger("on_assign")}
          className="border-dashed text-muted-foreground hover:text-foreground"
        >
          <Bot className="h-3 w-3" />
          Add On Assign
        </Button>
        <Button
          variant="outline"
          size="xs"
          onClick={() => addTrigger("scheduled")}
          className="border-dashed text-muted-foreground hover:text-foreground"
        >
          <Timer className="h-3 w-3" />
          Add Scheduled
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tasks Tab
// ---------------------------------------------------------------------------

function TasksTab({ agent }: { agent: Agent }) {
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .listAgentTasks(agent.id)
      .then(setTasks)
      .catch(() => setTasks([]))
      .finally(() => setLoading(false));
  }, [agent.id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        Loading tasks...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Task Queue</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Issues assigned to this agent and their execution status.
        </p>
      </div>

      {tasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
          <ListTodo className="h-8 w-8 text-muted-foreground/40" />
          <p className="mt-3 text-sm text-muted-foreground">No tasks in queue</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Assign an issue to this agent to get started.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => {
            const config = taskStatusConfig[task.status] ?? taskStatusConfig.queued!;
            const Icon = config.icon;
            return (
              <div key={task.id} className="flex items-center gap-3 rounded-lg border px-4 py-3">
                <Icon className={`h-4 w-4 shrink-0 ${config.color}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">
                    Issue {task.issue_id.slice(0, 8)}...
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(task.created_at).toLocaleString()}
                  </div>
                </div>
                <span className={`text-xs font-medium ${config.color}`}>
                  {config.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent Detail
// ---------------------------------------------------------------------------

type DetailTab = "skills" | "tools" | "triggers" | "tasks";

const detailTabs: { id: DetailTab; label: string; icon: typeof FileText }[] = [
  { id: "skills", label: "Skills", icon: FileText },
  { id: "tools", label: "Tools", icon: Wrench },
  { id: "triggers", label: "Triggers", icon: Timer },
  { id: "tasks", label: "Tasks", icon: ListTodo },
];

function AgentDetail({
  agent,
  runtimes,
  onUpdate,
  onDelete,
}: {
  agent: Agent;
  runtimes: RuntimeDevice[];
  onUpdate: (id: string, data: Partial<Agent>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const st = statusConfig[agent.status];
  const runtimeDevice = getRuntimeDevice(agent, runtimes);
  const [activeTab, setActiveTab] = useState<DetailTab>("skills");
  const [showMenu, setShowMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-start gap-4 border-b px-6 py-5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted text-sm font-bold">
          {getInitials(agent.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold">{agent.name}</h2>
            <span className={`flex items-center gap-1.5 text-xs ${st.color}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
              {st.label}
            </span>
            <span className="flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {agent.runtime_mode === "cloud" ? (
                <Cloud className="h-3 w-3" />
              ) : (
                <Monitor className="h-3 w-3" />
              )}
              {runtimeDevice?.name ?? (agent.runtime_mode === "cloud" ? "Cloud" : "Local")}
            </span>
          </div>
          {agent.description && (
            <p className="mt-1 text-sm text-muted-foreground">{agent.description}</p>
          )}
        </div>
        <div className="relative">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setShowMenu(!showMenu)}
          >
            <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
          </Button>
          {showMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
              <div className="absolute right-0 top-8 z-50 w-40 rounded-lg border bg-popover p-1 shadow-md">
                <button
                  onClick={() => {
                    setShowMenu(false);
                    setConfirmDelete(true);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-destructive hover:bg-accent"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete Agent
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b px-6">
        {detailTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors ${
              activeTab === tab.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <tab.icon className="h-3.5 w-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === "skills" && (
          <SkillsTab
            agent={agent}
            onSave={(skills) => onUpdate(agent.id, { skills })}
          />
        )}
        {activeTab === "tools" && (
          <ToolsTab
            agent={agent}
            onSave={(tools) => onUpdate(agent.id, { tools })}
          />
        )}
        {activeTab === "triggers" && (
          <TriggersTab
            agent={agent}
            onSave={(triggers) => onUpdate(agent.id, { triggers })}
          />
        )}
        {activeTab === "tasks" && <TasksTab agent={agent} />}
      </div>

      {/* Delete Confirmation */}
      {confirmDelete && (
        <Dialog open onOpenChange={(v) => { if (!v) setConfirmDelete(false); }}>
          <DialogContent className="max-w-sm" showCloseButton={false}>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
                <AlertCircle className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">Delete agent?</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  This will permanently delete &quot;{agent.name}&quot; and all its configuration.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  setConfirmDelete(false);
                  onDelete(agent.id);
                }}
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AgentsPage() {
  const isLoading = useAuthStore((s) => s.isLoading);
  const workspace = useWorkspaceStore((s) => s.workspace);
  const agents = useWorkspaceStore((s) => s.agents);
  const refreshAgents = useWorkspaceStore((s) => s.refreshAgents);
  const [selectedId, setSelectedId] = useState<string>("");
  const [showCreate, setShowCreate] = useState(false);
  const [runtimes, setRuntimes] = useState<RuntimeDevice[]>([]);

  useEffect(() => {
    if (!workspace) {
      setRuntimes([]);
      return;
    }
    api
      .listRuntimes({ workspace_id: workspace.id })
      .then(setRuntimes)
      .catch(() => setRuntimes([]));
  }, [workspace]);

  // Select first agent on initial load
  useEffect(() => {
    if (agents.length > 0 && !selectedId) {
      setSelectedId(agents[0]!.id);
    }
  }, [agents, selectedId]);

  useWSEvent(
    "agent:status",
    useCallback(() => {
      refreshAgents();
    }, [refreshAgents]),
  );

  const handleCreate = async (data: CreateAgentRequest) => {
    const agent = await api.createAgent(data);
    await refreshAgents();
    setSelectedId(agent.id);
  };

  const handleUpdate = async (id: string, data: Record<string, unknown>) => {
    await api.updateAgent(id, data as UpdateAgentRequest);
    await refreshAgents();
  };

  const handleDelete = async (id: string) => {
    await api.deleteAgent(id);
    if (selectedId === id) {
      const remaining = agents.filter((a) => a.id !== id);
      setSelectedId(remaining[0]?.id ?? "");
    }
    await refreshAgents();
  };

  const selected = agents.find((a) => a.id === selectedId) ?? null;

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Left column — agent list */}
      <div className="w-72 shrink-0 overflow-y-auto border-r">
        <div className="flex h-12 items-center justify-between border-b px-4">
          <h1 className="text-sm font-semibold">Agents</h1>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setShowCreate(true)}
          >
            <Plus className="h-4 w-4 text-muted-foreground" />
          </Button>
        </div>
        {agents.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-12">
            <Bot className="h-8 w-8 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">No agents yet</p>
            <Button
              onClick={() => setShowCreate(true)}
              size="xs"
              className="mt-3"
            >
              <Plus className="h-3 w-3" />
              Create Agent
            </Button>
          </div>
        ) : (
          <div className="divide-y">
            {agents.map((agent) => (
              <AgentListItem
                key={agent.id}
                agent={agent}
                isSelected={agent.id === selectedId}
                onClick={() => setSelectedId(agent.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Right column — agent detail */}
      <div className="flex-1 overflow-hidden">
        {selected ? (
          <AgentDetail
            agent={selected}
            runtimes={runtimes}
            onUpdate={handleUpdate}
            onDelete={handleDelete}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
            <Bot className="h-10 w-10 text-muted-foreground/30" />
            <p className="mt-3 text-sm">Select an agent to view details</p>
            <Button
              onClick={() => setShowCreate(true)}
              size="xs"
              className="mt-3"
            >
              <Plus className="h-3 w-3" />
              Create Agent
            </Button>
          </div>
        )}
      </div>

      {showCreate && (
        <CreateAgentDialog
          runtimes={runtimes}
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
        />
      )}
    </div>
  );
}
