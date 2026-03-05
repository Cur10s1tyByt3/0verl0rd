import fs from "fs/promises";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { authenticateRequest } from "../../auth";
import { AuditAction, logAudit } from "../../auditLog";
import * as clientManager from "../../clientManager";
import { metrics } from "../../metrics";
import { encodeMessage } from "../../protocol";

type RequestIpProvider = {
  requestIP: (req: Request) => { address?: string } | null | undefined;
};

type DeployOs = "windows" | "mac" | "linux" | "unix" | "unknown";
type DeployUpload = {
  id: string;
  path: string;
  name: string;
  size: number;
  os: DeployOs;
};

type DeployRouteDeps = {
  DEPLOY_ROOT: string;
  deployUploads: Map<string, DeployUpload>;
  detectUploadOs: (filename: string, bytes: Uint8Array) => DeployOs;
  normalizeClientOs: (os?: string) => DeployOs;
};

export async function handleDeployRoutes(
  req: Request,
  url: URL,
  server: RequestIpProvider,
  deps: DeployRouteDeps,
): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/deploy")) {
    return null;
  }

  if (req.method === "POST" && url.pathname === "/api/deploy/upload") {
    const user = await authenticateRequest(req);
    if (!user) {
      return new Response("Unauthorized", { status: 401 });
    }
    if (user.role !== "admin") {
      return new Response("Forbidden: Admin access required", { status: 403 });
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return new Response("Bad request", { status: 400 });
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      return new Response("Missing file", { status: 400 });
    }

    const filename = path.basename(file.name || "upload.bin");
    const id = uuidv4();
    await fs.mkdir(deps.DEPLOY_ROOT, { recursive: true });
    const folder = path.join(deps.DEPLOY_ROOT, id);
    await fs.mkdir(folder, { recursive: true });
    const targetPath = path.join(folder, filename);
    const bytes = new Uint8Array(await file.arrayBuffer());
    await fs.writeFile(targetPath, bytes);

    const os = deps.detectUploadOs(filename, bytes);
    const entry: DeployUpload = {
      id,
      path: targetPath,
      name: filename,
      size: bytes.length,
      os,
    };
    deps.deployUploads.set(id, entry);

    return Response.json({ ok: true, uploadId: id, os, name: filename, size: bytes.length });
  }

  if (req.method === "POST" && url.pathname === "/api/deploy/run") {
    const user = await authenticateRequest(req);
    if (!user) {
      return new Response("Unauthorized", { status: 401 });
    }
    if (user.role !== "admin") {
      return new Response("Forbidden: Admin access required", { status: 403 });
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return new Response("Bad request", { status: 400 });
    }

    const uploadId = typeof body?.uploadId === "string" ? body.uploadId : "";
    const clientIds = Array.isArray(body?.clientIds) ? body.clientIds : [];
    const args = typeof body?.args === "string" ? body.args : "";
    const hideWindow = body?.hideWindow !== false;
    if (!uploadId || clientIds.length === 0) {
      return new Response("Bad request", { status: 400 });
    }

    const upload = deps.deployUploads.get(uploadId);
    if (!upload) {
      return new Response("Not found", { status: 404 });
    }

    const bytes = new Uint8Array(await fs.readFile(upload.path));
    const chunkSize = 256 * 1024;
    const results: Array<{ clientId: string; ok: boolean; reason?: string; command?: string }> = [];

    const formatCommandDisplay = (commandPath: string, commandArgs: string) => {
      const trimmedArgs = commandArgs.trim();
      const needsQuotes = commandPath.includes(" ");
      const displayCommand = needsQuotes ? `"${commandPath}"` : commandPath;
      if (!trimmedArgs) {
        return displayCommand;
      }
      return `${displayCommand} ${trimmedArgs}`;
    };

    for (const clientId of clientIds) {
      const target = clientManager.getClient(clientId);
      if (!target) {
        results.push({ clientId, ok: false, reason: "offline" });
        continue;
      }

      const clientOs = deps.normalizeClientOs(target.os);
      const osMismatch =
        upload.os !== "unknown" &&
        !(
          upload.os === clientOs ||
          (upload.os === "unix" && (clientOs === "linux" || clientOs === "mac"))
        );
      if (osMismatch) {
        results.push({ clientId, ok: false, reason: "os_mismatch" });
        continue;
      }

      const dir = clientOs === "windows"
        ? `C:\\Windows\\Temp\\Overlord\\${upload.id}`
        : `/tmp/overlord/${upload.id}`;
      const destPath = clientOs === "windows"
        ? `${dir}\\${upload.name}`
        : `${dir}/${upload.name}`;

      target.ws.send(
        encodeMessage({
          type: "command",
          commandType: "file_mkdir",
          id: uuidv4(),
          payload: { path: dir },
        }),
      );

      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
        target.ws.send(
          encodeMessage({
            type: "command",
            commandType: "file_upload",
            id: uuidv4(),
            payload: { path: destPath, data: chunk, offset, total: bytes.length },
          }),
        );
      }

      if (clientOs !== "windows") {
        target.ws.send(
          encodeMessage({
            type: "command",
            commandType: "file_chmod",
            id: uuidv4(),
            payload: { path: destPath, mode: "0755" },
          }),
        );
      }

      const displayCommand = formatCommandDisplay(destPath, args);

      target.ws.send(
        encodeMessage({
          type: "command",
          commandType: "silent_exec",
          id: uuidv4(),
          payload: { command: destPath, args, hideWindow },
        }),
      );

      metrics.recordCommand("silent_exec");
      logAudit({
        timestamp: Date.now(),
        username: user.username,
        ip: server.requestIP(req)?.address || "unknown",
        action: AuditAction.SILENT_EXECUTE,
        targetClientId: clientId,
        success: true,
        details: JSON.stringify({ uploadId, command: destPath, args }),
      });

      results.push({ clientId, ok: true, command: displayCommand });
    }

    return Response.json({ ok: true, results });
  }

  if (req.method === "POST" && url.pathname === "/api/deploy/update") {
    const user = await authenticateRequest(req);
    if (!user) {
      return new Response("Unauthorized", { status: 401 });
    }
    if (user.role !== "admin") {
      return new Response("Forbidden: Admin access required", { status: 403 });
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return new Response("Bad request", { status: 400 });
    }

    const uploadId = typeof body?.uploadId === "string" ? body.uploadId : "";
    const clientIds = Array.isArray(body?.clientIds) ? body.clientIds : [];
    if (!uploadId || clientIds.length === 0) {
      return new Response("Bad request", { status: 400 });
    }

    const upload = deps.deployUploads.get(uploadId);
    if (!upload) {
      return new Response("Not found", { status: 404 });
    }

    const bytes = new Uint8Array(await fs.readFile(upload.path));
    const chunkSize = 256 * 1024;
    const results: Array<{ clientId: string; ok: boolean; reason?: string }> = [];

    for (const clientId of clientIds) {
      const target = clientManager.getClient(clientId);
      if (!target) {
        results.push({ clientId, ok: false, reason: "offline" });
        continue;
      }

      const clientOs = deps.normalizeClientOs(target.os);
      const osMismatch =
        upload.os !== "unknown" &&
        !(
          upload.os === clientOs ||
          (upload.os === "unix" && (clientOs === "linux" || clientOs === "mac"))
        );
      if (osMismatch) {
        results.push({ clientId, ok: false, reason: "os_mismatch" });
        continue;
      }

      const dir = clientOs === "windows"
        ? `C:\\Windows\\Temp\\Overlord\\${upload.id}`
        : `/tmp/overlord/${upload.id}`;
      const destPath = clientOs === "windows"
        ? `${dir}\\${upload.name}`
        : `${dir}/${upload.name}`;

      target.ws.send(
        encodeMessage({
          type: "command",
          commandType: "file_mkdir",
          id: uuidv4(),
          payload: { path: dir },
        }),
      );

      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
        target.ws.send(
          encodeMessage({
            type: "command",
            commandType: "file_upload",
            id: uuidv4(),
            payload: { path: destPath, data: chunk, offset, total: bytes.length },
          }),
        );
      }

      if (clientOs !== "windows") {
        target.ws.send(
          encodeMessage({
            type: "command",
            commandType: "file_chmod",
            id: uuidv4(),
            payload: { path: destPath, mode: "0755" },
          }),
        );
      }

      target.ws.send(
        encodeMessage({
          type: "command",
          commandType: "agent_update",
          id: uuidv4(),
          payload: { path: destPath },
        }),
      );

      metrics.recordCommand("agent_update");
      logAudit({
        timestamp: Date.now(),
        username: user.username,
        ip: server.requestIP(req)?.address || "unknown",
        action: AuditAction.AGENT_UPDATE,
        targetClientId: clientId,
        success: true,
        details: JSON.stringify({ uploadId, path: destPath }),
      });

      results.push({ clientId, ok: true });
    }

    return Response.json({ ok: true, results });
  }

  return null;
}
