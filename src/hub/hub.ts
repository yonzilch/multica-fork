import {
  GatewayClient,
  type ConnectionState,
  RequestAction,
  ResponseAction,
  StreamAction,
  type RequestPayload,
  type ResponseSuccessPayload,
  type ResponseErrorPayload,
} from "@multica/sdk";
import { AsyncAgent } from "../agent/async-agent.js";
import type { AgentOptions } from "../agent/types.js";
import { getHubId } from "./hub-identity.js";
import { setHub } from "./hub-singleton.js";
import { initSubagentRegistry, shutdownSubagentRegistry } from "../agent/subagent/index.js";
import { loadAgentRecords, addAgentRecord, removeAgentRecord } from "./agent-store.js";
import { RpcDispatcher, RpcError } from "./rpc/dispatcher.js";
import { createGetAgentMessagesHandler } from "./rpc/handlers/get-agent-messages.js";
import { createGetHubInfoHandler } from "./rpc/handlers/get-hub-info.js";
import { createListAgentsHandler } from "./rpc/handlers/list-agents.js";
import { createCreateAgentHandler } from "./rpc/handlers/create-agent.js";
import { createDeleteAgentHandler } from "./rpc/handlers/delete-agent.js";
import { createUpdateGatewayHandler } from "./rpc/handlers/update-gateway.js";
import { DeviceStore } from "./device-store.js";
import { createVerifyHandler } from "./rpc/handlers/verify.js";

export class Hub {
  private readonly agents = new Map<string, AsyncAgent>();
  private readonly agentSenders = new Map<string, string>();
  private readonly agentStreamIds = new Map<string, string>();
  private readonly agentStreamCounters = new Map<string, number>();
  private readonly rpc: RpcDispatcher;
  private client: GatewayClient;
  readonly deviceStore: DeviceStore;
  private _onConfirmDevice: ((deviceId: string, agentId: string) => Promise<boolean>) | null = null;
  url: string;
  readonly path: string;
  readonly hubId: string;

  /** Current Gateway connection state */
  get connectionState(): ConnectionState {
    return this.client.state;
  }

  constructor(url: string, path?: string) {
    this.url = url;
    this.path = path ?? "/ws";
    this.hubId = getHubId();
    this.deviceStore = new DeviceStore();

    this.rpc = new RpcDispatcher();
    this.rpc.register("verify", createVerifyHandler({
      hubId: this.hubId,
      deviceStore: this.deviceStore,
      onConfirmDevice: (deviceId, agentId) => {
        if (!this._onConfirmDevice) {
          // No UI confirm handler registered (CLI mode etc.) — auto-approve
          return Promise.resolve(true);
        }
        return this._onConfirmDevice(deviceId, agentId);
      },
    }));
    this.rpc.register("getAgentMessages", createGetAgentMessagesHandler());
    this.rpc.register("getHubInfo", createGetHubInfoHandler(this));
    this.rpc.register("listAgents", createListAgentsHandler(this));
    this.rpc.register("createAgent", createCreateAgentHandler(this));
    this.rpc.register("deleteAgent", createDeleteAgentHandler(this));
    this.rpc.register("updateGateway", createUpdateGatewayHandler(this));

    // Register as global singleton for cross-module access (subagent tools, announce flow)
    setHub(this);

    // Restore subagent registry from persistent state
    initSubagentRegistry();

    this.client = this.createClient(this.url);
    this.client.connect();
    this.restoreAgents();
  }

  /** Restore agents from persistent storage */
  private restoreAgents(): void {
    const records = loadAgentRecords();
    for (const record of records) {
      this.createAgent(record.id, { persist: false });
    }
    if (records.length > 0) {
      console.log(`[Hub] Restored ${records.length} agent(s)`);
    }
  }

  private createClient(url: string): GatewayClient {
    const client = new GatewayClient({
      url,
      path: this.path,
      deviceId: this.hubId,
      deviceType: "hub",
      autoReconnect: true,
      reconnectDelay: 1000,
    });

    client.onStateChange((state) => {
      console.log(`[Hub] Connection state: ${state}`);
    });

    client.onRegistered((deviceId) => {
      console.log(`[Hub] Registered as: ${deviceId}`);
    });

    client.onError((err) => {
      console.error(`[Hub] Connection error:`, err.message);
    });

    client.onMessage((msg) => {
      console.log(`[Hub] Received message: id=${msg.id} from=${msg.from} to=${msg.to} action=${msg.action} payload=${JSON.stringify(msg.payload)}`);

      // RPC request
      if (msg.action === RequestAction) {
        const payload = msg.payload as RequestPayload;
        // verify RPC is always allowed (it IS the verification step)
        if (payload.method === "verify") {
          void this.handleRpc(msg.from, payload);
          return;
        }
        // Other RPCs require verified device
        if (!this.deviceStore.isAllowed(msg.from)) {
          this.client.send<ResponseErrorPayload>(msg.from, ResponseAction, {
            requestId: payload.requestId,
            ok: false,
            error: { code: "UNAUTHORIZED", message: "Device not verified" },
          });
          return;
        }
        void this.handleRpc(msg.from, payload);
        return;
      }

      // Non-RPC messages also require verified device
      if (!this.deviceStore.isAllowed(msg.from)) {
        console.warn(`[Hub] Rejected message from unverified device: ${msg.from}`);
        return;
      }

      // Regular chat message
      const payload = msg.payload as { agentId?: string; content?: string } | undefined;
      const agentId = payload?.agentId;
      const content = payload?.content;
      if (!agentId || !content) {
        console.warn(`[Hub] Invalid payload, missing agentId or content`);
        return;
      }
      const agent = this.agents.get(agentId);
      if (agent && !agent.closed) {
        this.agentSenders.set(agentId, msg.from);
        agent.write(content);
      } else {
        console.warn(`[Hub] Agent not found or closed: ${agentId}`);
      }
    });

    client.onSendError((err) => {
      console.error(`[Hub] Send error: messageId=${err.messageId} code=${err.code} error=${err.error}`);
    });

    return client;
  }

  /** Register a confirmation handler for new device connections (called by Desktop UI) */
  setConfirmHandler(handler: ((deviceId: string, agentId: string) => Promise<boolean>) | null): void {
    this._onConfirmDevice = handler;
  }

  /** Register a one-time token for device verification (called when QR code is generated) */
  registerToken(token: string, agentId: string, expiresAt: number): void {
    this.deviceStore.registerToken(token, agentId, expiresAt);
  }

  /** 重连到新的 Gateway 地址 */
  reconnect(url: string): void {
    console.log(`[Hub] Reconnecting to ${url}`);
    this.client.disconnect();
    this.url = url;
    this.client = this.createClient(url);
    this.client.connect();
  }

  /** Create new Agent, or rebuild with existing ID */
  createAgent(id?: string, options?: { persist?: boolean; profileId?: string }): AsyncAgent {
    if (id) {
      const existing = this.agents.get(id);
      if (existing && !existing.closed) {
        return existing;
      }
    }

    const agent = new AsyncAgent({ sessionId: id, profileId: options?.profileId ?? "default" });
    this.agents.set(agent.sessionId, agent);

    // Persist to agent store (skip during restore to avoid duplicates)
    if (options?.persist !== false) {
      addAgentRecord({ id: agent.sessionId, createdAt: Date.now() });
    }

    // Internally consume agent output (AgentEvent stream + error Messages)
    void this.consumeAgent(agent);

    console.log(`Agent created: ${agent.sessionId}`);
    return agent;
  }

  private getMessageIdFromEvent(event: unknown): string | undefined {
    if (!event || typeof event !== "object") return undefined;
    const maybeMsg = (event as { message?: unknown }).message;
    if (!maybeMsg || typeof maybeMsg !== "object") return undefined;
    const id = (maybeMsg as { id?: unknown }).id;
    return typeof id === "string" && id.length > 0 ? id : undefined;
  }

  private beginStream(agentId: string, event: unknown): string {
    const explicitId = this.getMessageIdFromEvent(event);
    if (explicitId) {
      this.agentStreamIds.set(agentId, explicitId);
      return explicitId;
    }
    const next = (this.agentStreamCounters.get(agentId) ?? 0) + 1;
    this.agentStreamCounters.set(agentId, next);
    const fallback = `${agentId}:${next}`;
    this.agentStreamIds.set(agentId, fallback);
    return fallback;
  }

  private getActiveStreamId(agentId: string, event: unknown): string {
    return this.agentStreamIds.get(agentId) ?? this.getMessageIdFromEvent(event) ?? agentId;
  }

  private endStream(agentId: string): void {
    this.agentStreamIds.delete(agentId);
  }

  /** Internally read agent output and send via Gateway */
  private async consumeAgent(agent: AsyncAgent): Promise<void> {
    for await (const item of agent.read()) {
      const targetDeviceId = this.agentSenders.get(agent.sessionId);
      if (!targetDeviceId) continue;

      if ("content" in item) {
        // Legacy Message (error fallback)
        console.log(`[${agent.sessionId}] ${item.content}`);
        this.client.send(targetDeviceId, "message", {
          agentId: agent.sessionId,
          content: item.content,
        });
      } else {
        // Filter: only forward events useful for frontend rendering
        const maybeMessage = (item as { message?: { role?: string } }).message;
        const isAssistantMessage = maybeMessage?.role === "assistant";
        const shouldForward =
          ((item.type === "message_start" || item.type === "message_update" || item.type === "message_end") && isAssistantMessage)
          || item.type === "tool_execution_start"
          || item.type === "tool_execution_end";
        if (!shouldForward) continue;

        if (item.type === "message_start") {
          this.beginStream(agent.sessionId, item);
        }
        const streamId = this.getActiveStreamId(agent.sessionId, item);
        this.client.send(targetDeviceId, StreamAction, {
          streamId,
          agentId: agent.sessionId,
          event: item,
        });
        if (item.type === "message_end") {
          this.endStream(agent.sessionId);
        }
      }
    }
  }

  /** Handle RPC request and send response back via Gateway */
  private async handleRpc(from: string, request: RequestPayload): Promise<void> {
    const { requestId, method } = request;
    try {
      const result = await this.rpc.dispatch(method, request.params, from);
      this.client.send<ResponseSuccessPayload>(from, ResponseAction, {
        requestId,
        ok: true,
        payload: result,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = err instanceof RpcError ? err.code : "RPC_ERROR";
      console.error(`[Hub] RPC error: method=${method} code=${code} error=${message}`);
      this.client.send<ResponseErrorPayload>(from, ResponseAction, {
        requestId,
        ok: false,
        error: { code, message },
      });
    }
  }

  /** Create a subagent with specific options (isSubagent, systemPrompt, model) */
  createSubagent(sessionId: string, options: Omit<AgentOptions, "sessionId"> = {}): AsyncAgent {
    const existing = this.agents.get(sessionId);
    if (existing && !existing.closed) {
      return existing;
    }

    const agent = new AsyncAgent({
      ...options,
      sessionId,
      isSubagent: true,
    });
    this.agents.set(agent.sessionId, agent);

    // Subagents are ephemeral — don't persist to agent store
    void this.consumeAgent(agent);

    console.log(`[Hub] Subagent created: ${agent.sessionId}`);
    return agent;
  }

  getAgent(id: string): AsyncAgent | undefined {
    return this.agents.get(id);
  }

  listAgents(): string[] {
    return Array.from(this.agents.entries())
      .filter(([, a]) => !a.closed)
      .map(([id]) => id);
  }

  closeAgent(id: string): boolean {
    const agent = this.agents.get(id);
    if (!agent) return false;
    agent.close();
    this.agents.delete(id);
    this.agentSenders.delete(id);
    this.agentStreamIds.delete(id);
    this.agentStreamCounters.delete(id);
    removeAgentRecord(id);
    return true;
  }

  shutdown(): void {
    // Finalize subagent registry before closing agents
    shutdownSubagentRegistry();

    for (const [id, agent] of this.agents) {
      agent.close();
      this.agents.delete(id);
      this.agentSenders.delete(id);
      this.agentStreamIds.delete(id);
      this.agentStreamCounters.delete(id);
    }
    this.client.disconnect();
    console.log("Hub shut down");
  }
}
