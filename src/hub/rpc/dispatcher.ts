export type RpcHandler = (params: unknown, from: string) => unknown | Promise<unknown>;

export class RpcError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

export class RpcDispatcher {
  private readonly handlers = new Map<string, RpcHandler>();

  /** Register an RPC method handler */
  register(method: string, handler: RpcHandler): void {
    if (this.handlers.has(method)) {
      throw new Error(`RPC method already registered: ${method}`);
    }
    this.handlers.set(method, handler);
  }

  /** Dispatch an RPC request to its handler */
  async dispatch(method: string, params: unknown, from: string): Promise<unknown> {
    const handler = this.handlers.get(method);
    if (!handler) {
      throw new RpcError("METHOD_NOT_FOUND", `Unknown RPC method: ${method}`);
    }
    return handler(params, from);
  }
}
