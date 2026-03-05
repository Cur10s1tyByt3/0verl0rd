import fs from "fs/promises";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { authenticateRequest } from "../../auth";
import { AuditAction, logAudit } from "../../auditLog";
import * as clientManager from "../../clientManager";
import { logger } from "../../logger";
import { encodeMessage } from "../../protocol";

type RequestIpProvider = {
  requestIP: (req: Request) => { address?: string } | null | undefined;
};

type PendingHttpDownload = {
  commandId: string;
  clientId: string;
  path: string;
  fileName: string;
  total: number;
  receivedBytes: number;
  receivedOffsets: Set<number>;
  receivedChunks: Set<number>;
  chunkSize: number;
  expectedChunks: number;
  loggedTotal?: boolean;
  loggedFirstChunk?: boolean;
  tmpPath: string;
  fileHandle: any;
  resolve: (entry: PendingHttpDownload) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type DownloadIntent = {
  id: string;
  userId: string;
  clientId: string;
  path: string;
  expiresAt: number;
  timeout: ReturnType<typeof setTimeout>;
};

type FileDownloadRouteDeps = {
  DATA_DIR: string;
  secureHeaders: (contentType?: string) => Record<string, string>;
  sanitizeOutputName: (name: string) => string;
  pendingHttpDownloads: Map<string, PendingHttpDownload>;
  downloadIntents: Map<string, DownloadIntent>;
};

export async function handleFileDownloadRoutes(
  req: Request,
  url: URL,
  server: RequestIpProvider,
  deps: FileDownloadRouteDeps,
): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/file/download")) {
    return null;
  }

  if (req.method === "POST" && url.pathname === "/api/file/download") {
    const user = await authenticateRequest(req);
    if (!user) {
      return new Response("Unauthorized", { status: 401 });
    }
    if (user.role !== "admin" && user.role !== "operator") {
      return new Response("Forbidden: Admin or operator access required", { status: 403 });
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return new Response("Bad request", { status: 400 });
    }

    const downloadId = typeof body?.downloadId === "string" ? body.downloadId : "";
    logger.debug("[filebrowser] http download request", {
      downloadId,
      userId: user.userId,
      ip: server.requestIP(req)?.address || "unknown",
    });
    if (!downloadId) {
      return new Response("Bad request", { status: 400 });
    }

    const intent = deps.downloadIntents.get(downloadId);
    if (!intent || intent.userId !== user.userId || intent.expiresAt < Date.now()) {
      logger.debug("[filebrowser] http download intent missing", {
        downloadId,
        userId: user.userId,
        intentUserId: intent?.userId,
        expiresAt: intent?.expiresAt,
      });
      return new Response("Not found", { status: 404 });
    }

    deps.downloadIntents.delete(downloadId);
    clearTimeout(intent.timeout);

    const clientId = intent.clientId;
    const downloadPath = intent.path;

    const target = clientManager.getClient(clientId);
    if (!target) {
      logger.debug("[filebrowser] http download target offline", {
        downloadId,
        clientId,
      });
      return new Response("Client offline", { status: 404 });
    }

    const commandId = uuidv4();
    const downloadDir = path.join(deps.DATA_DIR, "downloads");
    await fs.mkdir(downloadDir, { recursive: true });
    const tmpPath = path.join(downloadDir, `${commandId}.bin`);

    let fileName = path.basename(downloadPath) || "download.bin";
    try {
      fileName = deps.sanitizeOutputName(fileName);
    } catch {
      fileName = "download.bin";
    }

    const fileHandle = await fs.open(tmpPath, "w+");

    logger.debug("[filebrowser] http download start", {
      commandId,
      clientId,
      path: downloadPath,
      tmpPath,
    });

    const downloadPromise = new Promise<PendingHttpDownload>((resolve, reject) => {
      const timeout = setTimeout(() => {
        deps.pendingHttpDownloads.delete(commandId);
        void fileHandle.close();
        void fs.unlink(tmpPath).catch(() => {});
        reject(new Error("Download timed out"));
      }, 5 * 60_000);

      deps.pendingHttpDownloads.set(commandId, {
        commandId,
        clientId,
        path: downloadPath,
        fileName,
        total: 0,
        receivedBytes: 0,
        receivedOffsets: new Set(),
        receivedChunks: new Set(),
        chunkSize: 0,
        expectedChunks: 0,
        loggedTotal: false,
        loggedFirstChunk: false,
        tmpPath,
        fileHandle,
        resolve,
        reject,
        timeout,
      });
    });

    target.ws.send(
      encodeMessage({
        type: "command",
        commandType: "file_download",
        id: commandId,
        payload: { path: downloadPath },
      }),
    );

    logger.debug("[filebrowser] http download command sent", {
      commandId,
      clientId,
      path: downloadPath,
    });

    logAudit({
      timestamp: Date.now(),
      username: user.username,
      ip: server.requestIP(req)?.address || "unknown",
      action: AuditAction.FILE_DOWNLOAD,
      targetClientId: clientId,
      details: JSON.stringify({ path: downloadPath, via: "http" }),
      success: true,
    });

    let completed: PendingHttpDownload;
    try {
      completed = await downloadPromise;
    } catch (err) {
      logger.debug("[filebrowser] http download failed", {
        commandId,
        clientId,
        path: downloadPath,
        error: (err as Error)?.message || String(err),
      });
      return new Response((err as Error).message || "Download failed", { status: 500 });
    }

    logger.debug("[filebrowser] http download complete", {
      commandId,
      clientId,
      path: downloadPath,
      total: completed.total,
      receivedBytes: completed.receivedBytes,
      expectedChunks: completed.expectedChunks,
      receivedChunks: completed.receivedChunks.size,
    });

    const headers = {
      ...deps.secureHeaders("application/octet-stream"),
      "Content-Disposition": `attachment; filename="${completed.fileName}"`,
      "Cache-Control": "no-store",
    };

    setTimeout(() => {
      void fs.unlink(completed.tmpPath).catch(() => {});
    }, 5 * 60_000);

    return new Response(Bun.file(completed.tmpPath), { headers });
  }

  if (req.method === "POST" && url.pathname === "/api/file/download/request") {
    const user = await authenticateRequest(req);
    if (!user) {
      return new Response("Unauthorized", { status: 401 });
    }
    if (user.role !== "admin" && user.role !== "operator") {
      return new Response("Forbidden: Admin or operator access required", { status: 403 });
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return new Response("Bad request", { status: 400 });
    }

    const clientId = typeof body?.clientId === "string" ? body.clientId : "";
    const downloadPath = typeof body?.path === "string" ? body.path : "";
    if (!clientId || !downloadPath) {
      return new Response("Bad request", { status: 400 });
    }

    const target = clientManager.getClient(clientId);
    if (!target) {
      return new Response("Client offline", { status: 404 });
    }

    const downloadId = uuidv4();
    const expiresAt = Date.now() + 2 * 60_000;
    const timeout = setTimeout(() => {
      deps.downloadIntents.delete(downloadId);
    }, 2 * 60_000);

    deps.downloadIntents.set(downloadId, {
      id: downloadId,
      userId: user.userId,
      clientId,
      path: downloadPath,
      expiresAt,
      timeout,
    });

    return Response.json({ ok: true, downloadId });
  }

  return null;
}
