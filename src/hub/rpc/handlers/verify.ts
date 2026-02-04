import type { RpcHandler } from "../dispatcher.js";
import { RpcError } from "../dispatcher.js";
import type { DeviceStore } from "../../device-store.js";

interface VerifyContext {
  hubId: string;
  deviceStore: DeviceStore;
  /** Called for first-time connections. Returns true if user approves, false if rejected. */
  onConfirmDevice: (deviceId: string, agentId: string) => Promise<boolean>;
}

interface VerifyParams {
  token?: string;
}

export function createVerifyHandler(ctx: VerifyContext): RpcHandler {
  return async (params: unknown, from: string) => {
    // 1. Already in whitelist → pass through (reconnection, no confirmation needed)
    const allowed = ctx.deviceStore.isAllowed(from);
    if (allowed) {
      return { hubId: ctx.hubId, agentId: allowed.agentId };
    }

    // 2. Validate token
    const { token } = (params ?? {}) as VerifyParams;
    if (!token) {
      throw new RpcError("UNAUTHORIZED", "Device not authorized");
    }

    const result = ctx.deviceStore.consumeToken(token);
    if (!result) {
      throw new RpcError("UNAUTHORIZED", "Invalid or expired token");
    }

    // 3. Token valid → await Desktop user confirmation
    const confirmed = await ctx.onConfirmDevice(from, result.agentId);
    if (!confirmed) {
      throw new RpcError("REJECTED", "Connection rejected by user");
    }

    // 4. User confirmed → add to whitelist
    ctx.deviceStore.allowDevice(from, result.agentId);
    return { hubId: ctx.hubId, agentId: result.agentId };
  };
}
