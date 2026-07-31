import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../../logger";
import type { WorkerInbound, WorkerOutbound, PluginRpcCaller } from "./types";

type Subscriber = {
  id: string;
  send: (sse: string) => void;
  close: () => void;
};

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type PluginInstance = {
  pluginId: string;
  worker: Worker;
  ready: Promise<void>;
  resolveReady: () => void;
  rejectReady: (err: Error) => void;
  isReady: boolean;
  pending: Map<string, PendingCall>;
  pendingBuildHooks: Map<string, PendingCall>;
  subscribers: Set<Subscriber>;
  startedAt: number;
};

const RPC_TIMEOUT_MS = 30_000;
const BUILD_HOOK_TIMEOUT_MS = 5 * 60_000;
const SHUTDOWN_GRACE_MS = 750;

export type PluginRuntime = {
  startPlugin: (pluginId: string) => Promise<void>;
  stopPlugin: (pluginId: string) => Promise<void>;
  restartPlugin: (pluginId: string) => Promise<void>;
  dispatchClientEvent: (
    clientId: string,
    pluginId: string,
    event: string,
    payload: unknown,
  ) => void;
  rpc: (
    pluginId: string,
    method: string,
    params: unknown,
    caller: PluginRpcCaller,
  ) => Promise<unknown>;
  runBuildHook: (pluginId: string, hook: string, payload: unknown) => Promise<unknown>;
  runBuildHookForAll: (hook: string, payload: unknown) => Promise<Array<{ pluginId: string; result: unknown }>>;
  subscribe: (
    pluginId: string,
    send: (sse: string) => void,
    close: () => void,
  ) => (() => void) | null;
  isRunning: (pluginId: string) => boolean;
  hasServerCode: (pluginId: string) => boolean;
  runningPluginIds: () => string[];
  shutdownAll: () => Promise<void>;
};

export type PluginRuntimeOptions = {
  pluginRoot: string;
  workerHostUrl: string; // file:// URL or absolute path that `new Worker()` accepts
  setLastError: (pluginId: string, error: string) => void;
};

export function createPluginRuntime(opts: PluginRuntimeOptions): PluginRuntime {
  const instances = new Map<string, PluginInstance>();

  function pluginServerScript(pluginId: string): string {
    return path.join(opts.pluginRoot, pluginId, "server.js");
  }

  function hasServerCode(pluginId: string): boolean {
    return existsSync(pluginServerScript(pluginId));
  }

  function isRunning(pluginId: string): boolean {
    return instances.has(pluginId);
  }

  async function startPlugin(pluginId: string): Promise<void> {
    if (instances.has(pluginId)) return;
    const script = pluginServerScript(pluginId);
    if (!existsSync(script)) return;

    const dataDir = path.join(opts.pluginRoot, pluginId, "data");
    await fs.mkdir(dataDir, { recursive: true });
    const dbPath = path.join(dataDir, "plugin.db");

    const worker = new Worker(opts.workerHostUrl);

    let resolveReady!: () => void;
    let rejectReady!: (err: Error) => void;
    const ready = new Promise<void>((res, rej) => {
      resolveReady = res;
      rejectReady = rej;
    });

    const inst: PluginInstance = {
      pluginId,
      worker,
      ready,
      resolveReady,
      rejectReady,
      isReady: false,
      pending: new Map(),
      pendingBuildHooks: new Map(),
      subscribers: new Set(),
      startedAt: Date.now(),
    };

    worker.onmessage = (e: MessageEvent<WorkerOutbound>) => {
      handleWorkerMessage(inst, e.data);
    };

    (worker as any).onerror = (event: any) => {
      const message = event?.message || event?.error?.message || String(event);
      logger.error(`[plugin:${pluginId}] worker error: ${message}`);
      opts.setLastError(pluginId, `worker crash: ${message}`);
      rejectReady(new Error(message));
      void stopPlugin(pluginId);
    };

    instances.set(pluginId, inst);

    const bootMsg: WorkerInbound = {
      type: "boot",
      pluginId,
      serverScript: script,
      dbPath,
      pluginRoot: opts.pluginRoot,
    };
    worker.postMessage(bootMsg);

    try {
      await ready;
      inst.isReady = true;
      logger.info(`[plugin:${pluginId}] server runtime ready (db=${path.basename(dbPath)})`);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error(`[plugin:${pluginId}] failed to start: ${error}`);
      opts.setLastError(pluginId, error);
      try { worker.terminate(); } catch {}
      instances.delete(pluginId);
      throw err;
    }
  }

  async function stopPlugin(pluginId: string): Promise<void> {
    const inst = instances.get(pluginId);
    if (!inst) return;
    instances.delete(pluginId);

    for (const sub of inst.subscribers) {
      try { sub.close(); } catch {}
    }
    inst.subscribers.clear();

    for (const pending of inst.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Plugin runtime stopped"));
    }
    inst.pending.clear();
    for (const pending of inst.pendingBuildHooks.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Plugin runtime stopped"));
    }
    inst.pendingBuildHooks.clear();

    try {
      const shutdownMsg: WorkerInbound = { type: "shutdown" };
      inst.worker.postMessage(shutdownMsg);
    } catch {}

    setTimeout(() => {
      try { inst.worker.terminate(); } catch {}
    }, SHUTDOWN_GRACE_MS);

    logger.info(`[plugin:${pluginId}] server runtime stopped`);
  }

  async function restartPlugin(pluginId: string): Promise<void> {
    if (instances.has(pluginId)) {
      await stopPlugin(pluginId);
    }
    await startPlugin(pluginId);
  }

  function dispatchClientEvent(
    clientId: string,
    pluginId: string,
    event: string,
    payload: unknown,
  ): void {
    const inst = instances.get(pluginId);
    if (!inst) return;
    const send = () => {
      try {
        const msg: WorkerInbound = { type: "event", clientId, event, payload };
        inst.worker.postMessage(msg);
      } catch (err) {
        logger.warn(
          `[plugin:${pluginId}] event dispatch failed: ${(err as Error).message}`,
        );
      }
    };
    if (inst.isReady) {
      send();
    } else {
      inst.ready.then(send).catch(() => {});
    }
  }


  function rpc(
    pluginId: string,
    method: string,
    params: unknown,
    caller: PluginRpcCaller,
  ): Promise<unknown> {
    const inst = instances.get(pluginId);
    if (!inst) {
      return Promise.reject(new Error("Plugin runtime not running"));
    }
    const callOnReady = () =>
      new Promise((resolve, reject) => {
        const id = uuidv4();
        const timer = setTimeout(() => {
          if (inst.pending.delete(id)) {
            reject(new Error(`RPC timeout: ${method}`));
          }
        }, RPC_TIMEOUT_MS);
        inst.pending.set(id, { resolve, reject, timer });
        const msg: WorkerInbound = { type: "rpc", id, method, params, caller };
        try {
          inst.worker.postMessage(msg);
        } catch (err) {
          clearTimeout(timer);
          inst.pending.delete(id);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    return inst.isReady ? callOnReady() : inst.ready.then(callOnReady);
  }

  function runBuildHook(
    pluginId: string,
    hook: string,
    payload: unknown,
  ): Promise<unknown> {
    const inst = instances.get(pluginId);
    if (!inst) {
      return Promise.reject(new Error("Plugin runtime not running"));
    }
    const callOnReady = () =>
      new Promise((resolve, reject) => {
        const id = uuidv4();
        const timer = setTimeout(() => {
          if (inst.pendingBuildHooks.delete(id)) {
            reject(new Error(`Build hook timeout: ${hook}`));
          }
        }, BUILD_HOOK_TIMEOUT_MS);
        inst.pendingBuildHooks.set(id, { resolve, reject, timer });
        const msg: WorkerInbound = { type: "build_hook", id, hook, payload };
        try {
          inst.worker.postMessage(msg);
        } catch (err) {
          clearTimeout(timer);
          inst.pendingBuildHooks.delete(id);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    return inst.isReady ? callOnReady() : inst.ready.then(callOnReady);
  }

  async function runBuildHookForAll(
    hook: string,
    payload: unknown,
  ): Promise<Array<{ pluginId: string; result: unknown }>> {
    const results: Array<{ pluginId: string; result: unknown }> = [];
    for (const pluginId of runningPluginIds()) {
      const result = await runBuildHook(pluginId, hook, payload);
      if (result !== null && result !== undefined) {
        results.push({ pluginId, result });
      }
    }
    return results;
  }

  function subscribe(
    pluginId: string,
    send: (sse: string) => void,
    close: () => void,
  ): (() => void) | null {
    const inst = instances.get(pluginId);
    if (!inst) return null;
    const sub: Subscriber = { id: uuidv4(), send, close };
    inst.subscribers.add(sub);
    return () => {
      inst.subscribers.delete(sub);
    };
  }

  function handleWorkerMessage(inst: PluginInstance, msg: WorkerOutbound) {
    if (msg.type === "ready") {
      inst.resolveReady();
      return;
    }
    if (msg.type === "boot_error") {
      opts.setLastError(inst.pluginId, msg.error);
      inst.rejectReady(new Error(msg.error));
      return;
    }
    if (msg.type === "rpc_reply") {
      const pending = inst.pending.get(msg.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      inst.pending.delete(msg.id);
      if (msg.ok) pending.resolve(msg.result);
      else pending.reject(new Error(msg.error));
      return;
    }
    if (msg.type === "build_hook_reply") {
      const pending = inst.pendingBuildHooks.get(msg.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      inst.pendingBuildHooks.delete(msg.id);
      if (msg.ok) pending.resolve(msg.result);
      else pending.reject(new Error(msg.error));
      return;
    }
    if (msg.type === "broadcast") {
      const safeChannel = String(msg.channel || "message").replace(/[\r\n]/g, "");
      const dataLine = JSON.stringify(msg.data ?? null);
      const sse = `event: ${safeChannel}\ndata: ${dataLine}\n\n`;
      for (const sub of inst.subscribers) {
        try { sub.send(sse); } catch {}
      }
      return;
    }
    if (msg.type === "log") {
      const tag = `[plugin:${inst.pluginId}]`;
      if (msg.level === "info") logger.info(`${tag} ${msg.message}`);
      else if (msg.level === "warn") logger.warn(`${tag} ${msg.message}`);
      else if (msg.level === "error") logger.error(`${tag} ${msg.message}`);
      else logger.debug(`${tag} ${msg.message}`);
    }
  }

  async function shutdownAll(): Promise<void> {
    const ids = Array.from(instances.keys());
    await Promise.all(ids.map((id) => stopPlugin(id)));
  }

  function runningPluginIds(): string[] {
    return Array.from(instances.keys()).sort();
  }

  return {
    startPlugin,
    stopPlugin,
    restartPlugin,
    dispatchClientEvent,
    rpc,
    runBuildHook,
    runBuildHookForAll,
    subscribe,
    isRunning,
    hasServerCode,
    runningPluginIds,
    shutdownAll,
  };
}
