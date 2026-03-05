import type { ServerWebSocket } from "bun";
import { v4 as uuidv4 } from "uuid";
import { hasAutoScriptRun, getAutoScriptsByTrigger, recordAutoScriptRun } from "../db";
import { logger } from "../logger";
import { metrics } from "../metrics";
import { encodeMessage } from "../protocol";
import type { SocketData } from "../sessions/types";
import type { ClientInfo } from "../types";
import { logAudit, AuditAction } from "../auditLog";
import { ALLOWED_SCRIPT_TYPES } from "./validation-constants";

export function dispatchAutoScriptsForConnection(
  info: ClientInfo,
  ws: ServerWebSocket<SocketData>,
): void {
  if (info.role !== "client") return;
  if (ws.data?.autoTasksRan) return;

  const isNewClient = ws.data?.wasKnown === false;
  const onConnect = getAutoScriptsByTrigger("on_connect");
  const onFirst = isNewClient ? getAutoScriptsByTrigger("on_first_connect") : [];
  const onConnectOnce = getAutoScriptsByTrigger("on_connect_once");
  const scripts = [...onConnect, ...onFirst, ...onConnectOnce];

  if (scripts.length === 0) {
    ws.data.autoTasksRan = true;
    return;
  }

  for (const script of scripts) {
    if (script.trigger === "on_connect_once") {
      if (hasAutoScriptRun(script.id, info.id)) {
        continue;
      }
      recordAutoScriptRun(script.id, info.id);
    }

    const scriptType = ALLOWED_SCRIPT_TYPES.has(script.scriptType)
      ? script.scriptType
      : "powershell";
    const cmdId = uuidv4();

    try {
      info.ws.send(
        encodeMessage({
          type: "command",
          commandType: "script_exec" as any,
          id: cmdId,
          payload: { script: script.script, type: scriptType },
        }),
      );
      metrics.recordCommand("script_exec");
      logAudit({
        timestamp: Date.now(),
        username: "system",
        ip: "server",
        action: AuditAction.SCRIPT_EXECUTE,
        targetClientId: info.id,
        success: true,
        details: `auto:${script.name} (${scriptType}) trigger=${script.trigger}`,
      });
      logger.info(`[auto-script] dispatched ${script.id} (${script.trigger}) to ${info.id}`);
    } catch (err) {
      logger.warn(`[auto-script] failed to dispatch ${script.id} to ${info.id}`, err);
      logAudit({
        timestamp: Date.now(),
        username: "system",
        ip: "server",
        action: AuditAction.SCRIPT_EXECUTE,
        targetClientId: info.id,
        success: false,
        details: `auto:${script.name} (${scriptType}) trigger=${script.trigger}`,
        errorMessage: (err as Error)?.message || "send failed",
      });
    }
  }

  ws.data.autoTasksRan = true;
}
