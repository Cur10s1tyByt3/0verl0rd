export type PluginRpcCaller = {
  id: number;
  username: string;
  role: string;
};

export type WorkerInbound =
  | {
      type: "boot";
      pluginId: string;
      serverScript: string;
      dbPath: string;
      pluginRoot: string;
    }
  | {
      type: "event";
      clientId: string;
      event: string;
      payload: unknown;
    }
  | {
      type: "rpc";
      id: string;
      method: string;
      params: unknown;
      caller: PluginRpcCaller;
    }
  | {
      type: "build_hook";
      id: string;
      hook: string;
      payload: unknown;
    }
  | {
      type: "build_provider";
      id: string;
      payload: unknown;
    }
  | {
      type: "shutdown";
    };

export type WorkerOutbound =
  | { type: "ready"; capabilities?: string[] }
  | { type: "boot_error"; error: string }
  | { type: "rpc_reply"; id: string; ok: true; result: unknown }
  | { type: "rpc_reply"; id: string; ok: false; error: string }
  | { type: "build_hook_reply"; id: string; ok: true; result: unknown }
  | { type: "build_hook_reply"; id: string; ok: false; error: string }
  | { type: "build_provider_reply"; id: string; ok: true; result: unknown }
  | { type: "build_provider_reply"; id: string; ok: false; error: string }
  | {
      type: "build_provider_output";
      id: string;
      event: "output" | "status";
      text: string;
      level?: "debug" | "info" | "warn" | "error" | "success";
      progress?: number;
      etaSeconds?: number;
    }
  | { type: "broadcast"; channel: string; data: unknown }
  | { type: "log"; level: "debug" | "info" | "warn" | "error"; message: string };
