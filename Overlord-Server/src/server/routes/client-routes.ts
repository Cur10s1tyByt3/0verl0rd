import { v4 as uuidv4 } from "uuid";
import { authenticateRequest } from "../../auth";
import { AuditAction, logAudit } from "../../auditLog";
import * as clientManager from "../../clientManager";
import {
  banIp,
  clientExists,
  deleteClientRow,
  getClientIp,
  isIpBanned,
  listBannedIps,
  listClients,
  setOnlineState,
  unbanIp,
} from "../../db";
import { metrics } from "../../metrics";
import { encodeMessage } from "../../protocol";
import { requirePermission } from "../../rbac";
import {
  canUserAccessClient,
  getUserClientAccessScope,
  listUserClientRuleIdsByAccess,
} from "../../users";

type RequestIpProvider = {
  requestIP: (req: Request) => { address?: string } | null | undefined;
};

type PendingScript = {
  resolve: (result: any) => void;
  reject: (error: any) => void;
  timeout: NodeJS.Timeout;
};

type ClientRouteDeps = {
  CORS_HEADERS: Record<string, string>;
  pendingScripts: Map<string, PendingScript>;
};

export async function handleClientRoutes(
  req: Request,
  url: URL,
  server: RequestIpProvider,
  deps: ClientRouteDeps,
): Promise<Response | null> {
  if (
    !url.pathname.startsWith("/api/clients") &&
    !url.pathname.match(/^\/api\/clients\/.+\/command$/)
  ) {
    return null;
  }

  if (url.pathname === "/api/clients") {
    const user = await authenticateRequest(req);
    if (!user) {
      return new Response("Unauthorized", { status: 401 });
    }
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const pageSize = Math.max(1, Number(url.searchParams.get("pageSize") || 12));
    const search = (url.searchParams.get("q") || "").toLowerCase().trim();
    const sort = url.searchParams.get("sort") || "last_seen_desc";
    const statusFilter = url.searchParams.get("status") || "all";
    const osFilter = url.searchParams.get("os") || "all";
    if (user.role === "admin") {
      const result = listClients({ page, pageSize, search, sort, statusFilter, osFilter });
      return Response.json(result, { headers: deps.CORS_HEADERS });
    }

    const scope = getUserClientAccessScope(user.userId);
    if (scope === "none") {
      return Response.json(
        { page, pageSize, total: 0, online: 0, items: [] },
        { headers: deps.CORS_HEADERS },
      );
    }

    const allowedClientIds =
      scope === "allowlist"
        ? listUserClientRuleIdsByAccess(user.userId, "allow")
        : undefined;
    const deniedClientIds =
      scope === "denylist"
        ? listUserClientRuleIdsByAccess(user.userId, "deny")
        : undefined;

    const result = listClients({
      page,
      pageSize,
      search,
      sort,
      statusFilter,
      osFilter,
      allowedClientIds,
      deniedClientIds,
    });
    return Response.json(result, { headers: deps.CORS_HEADERS });
  }

  if (url.pathname === "/api/clients/banned-ips") {
    const user = await authenticateRequest(req);
    if (!user) return new Response("Unauthorized", { status: 401 });

    try {
      requirePermission(user, "clients:control");
    } catch (error) {
      if (error instanceof Response) return error;
      return new Response("Forbidden", { status: 403 });
    }

    if (req.method === "GET") {
      return Response.json({ items: listBannedIps() }, { headers: deps.CORS_HEADERS });
    }

    if (req.method === "DELETE") {
      const ipToUnban = (url.searchParams.get("ip") || "").trim();
      if (!ipToUnban) {
        return Response.json({ error: "Missing ip query parameter" }, { status: 400 });
      }

      if (!/^[0-9a-fA-F:.]{3,64}$/.test(ipToUnban)) {
        return Response.json({ error: "Invalid IP format" }, { status: 400 });
      }

      if (!isIpBanned(ipToUnban)) {
        return Response.json({ error: "IP is not banned" }, { status: 404 });
      }

      unbanIp(ipToUnban);

      const ip = server.requestIP(req)?.address || "unknown";
      logAudit({
        timestamp: Date.now(),
        username: user.username,
        ip,
        action: AuditAction.COMMAND,
        details: `Unbanned IP ${ipToUnban}`,
        success: true,
      });

      return Response.json({ ok: true }, { headers: deps.CORS_HEADERS });
    }
  }

  const banMatch = url.pathname.match(/^\/api\/clients\/(.+)\/ban$/);
  if (req.method === "POST" && banMatch) {
    const user = await authenticateRequest(req);
    if (!user) return new Response("Unauthorized", { status: 401 });
    try {
      requirePermission(user, "clients:control");
    } catch (error) {
      if (error instanceof Response) return error;
      return new Response("Forbidden", { status: 403 });
    }

    const targetId = banMatch[1];
    if (!canUserAccessClient(user.userId, user.role, targetId)) {
      return new Response("Forbidden: Client access denied", { status: 403 });
    }
    const target = clientManager.getClient(targetId);
    const targetIp = target?.ip || getClientIp(targetId);
    if (!targetIp) {
      return Response.json({ error: "Client IP not found" }, { status: 404 });
    }

    banIp(targetIp, `Banned by ${user.username} for client ${targetId}`);

    if (target) {
      try {
        target.ws.close(4003, "banned");
      } catch {}
      setOnlineState(targetId, false);
    }

    const ip = server.requestIP(req)?.address || "unknown";
    logAudit({
      timestamp: Date.now(),
      username: user.username,
      ip,
      action: AuditAction.COMMAND,
      targetClientId: targetId,
      details: `Banned IP ${targetIp}`,
      success: true,
    });

    return Response.json({ ok: true, ip: targetIp });
  }

  const thumbnailMatch = url.pathname.match(/^\/api\/clients\/(.+)\/thumbnail$/);
  if (req.method === "POST" && thumbnailMatch) {
    const user = await authenticateRequest(req);
    if (!user) {
      return new Response("Unauthorized", { status: 401 });
    }
    const clientId = thumbnailMatch[1];
    if (!canUserAccessClient(user.userId, user.role, clientId)) {
      return new Response("Forbidden: Client access denied", { status: 403 });
    }
    const { generateThumbnail, markThumbnailRequested } = await import("../../thumbnails");
    markThumbnailRequested(clientId);
    const target = clientManager.getClient(clientId);
    if (target?.online) {
      const commandId = uuidv4();
      target.ws.send(
        encodeMessage({
          type: "command",
          commandType: "screenshot",
          id: commandId,
          payload: { mode: "notification", allDisplays: true },
        }),
      );
      metrics.recordCommand("screenshot");
    }
    const success = generateThumbnail(clientId);
    return Response.json({ ok: true, updated: success }, { headers: deps.CORS_HEADERS });
  }

  const clientDeleteMatch = url.pathname.match(/^\/api\/clients\/([^/]+)$/);
  if (req.method === "DELETE" && clientDeleteMatch) {
    const user = await authenticateRequest(req);
    if (!user) return new Response("Unauthorized", { status: 401 });

    try {
      requirePermission(user, "clients:control");
    } catch (error) {
      if (error instanceof Response) return error;
      return new Response("Forbidden", { status: 403 });
    }

    const targetId = clientDeleteMatch[1];
    if (!canUserAccessClient(user.userId, user.role, targetId)) {
      return new Response("Forbidden: Client access denied", { status: 403 });
    }
    const target = clientManager.getClient(targetId);
    const existsInDb = clientExists(targetId);
    if (!target && !existsInDb) {
      return Response.json({ error: "Client not found" }, { status: 404 });
    }

    if (target) {
      try {
        target.ws.close(4000, "removed");
      } catch {
        // Connection may already be closed.
      }
      clientManager.deleteClient(targetId);
      setOnlineState(targetId, false);
    }

    deleteClientRow(targetId);

    const ip = server.requestIP(req)?.address || "unknown";
    logAudit({
      timestamp: Date.now(),
      username: user.username,
      ip,
      action: AuditAction.COMMAND,
      targetClientId: targetId,
      details: "remove_dashboard",
      success: true,
    });

    return Response.json({ ok: true }, { headers: deps.CORS_HEADERS });
  }

  if (req.method === "POST") {
    const cmdMatch = url.pathname.match(/^\/api\/clients\/(.+)\/command$/);
    if (cmdMatch) {
      const user = await authenticateRequest(req);
      if (!user) return new Response("Unauthorized", { status: 401 });

      try {
        requirePermission(user, "clients:control");
      } catch (error) {
        if (error instanceof Response) return error;
        return new Response("Forbidden", { status: 403 });
      }

      const targetId = cmdMatch[1];
      if (!canUserAccessClient(user.userId, user.role, targetId)) {
        return new Response("Forbidden: Client access denied", { status: 403 });
      }
      const target = clientManager.getClient(targetId);
      const ip = server.requestIP(req)?.address || "unknown";

      if (!target) return new Response("Not found", { status: 404 });
      try {
        const body = await req.json();
        const action = body?.action;

        let success = true;
        if (action === "ping") {
          const nonce = Date.now() + Math.floor(Math.random() * 1000);
          target.lastPingSent = Date.now();
          target.lastPingNonce = nonce;
          target.ws.send(encodeMessage({ type: "ping", ts: nonce }));
        } else if (action === "ping_bulk") {
          const count = Math.max(1, Math.min(1000, Number(body?.count || 1)));
          for (let i = 0; i < count; i++) {
          }
        } else if (action === "disconnect") {
          target.ws.send(encodeMessage({ type: "command", commandType: "disconnect", id: uuidv4() }));
          metrics.recordCommand("disconnect");
          logAudit({
            timestamp: Date.now(),
            username: user.username,
            ip,
            action: AuditAction.DISCONNECT,
            targetClientId: targetId,
            success: true,
          });
        } else if (action === "reconnect") {
          target.ws.send(encodeMessage({ type: "command", commandType: "reconnect", id: uuidv4() }));
          metrics.recordCommand("reconnect");
          logAudit({
            timestamp: Date.now(),
            username: user.username,
            ip,
            action: AuditAction.RECONNECT,
            targetClientId: targetId,
            success: true,
          });
        } else if (action === "screenshot") {
          target.ws.send(
            encodeMessage({
              type: "command",
              commandType: "screenshot",
              id: uuidv4(),
              payload: { mode: "notification", allDisplays: true },
            }),
          );
          metrics.recordCommand("screenshot");
          logAudit({
            timestamp: Date.now(),
            username: user.username,
            ip,
            action: AuditAction.SCREENSHOT,
            targetClientId: targetId,
            success: true,
          });
        } else if (action === "desktop_start") {
          target.ws.send(encodeMessage({ type: "command", commandType: "desktop_start", id: uuidv4() }));
          metrics.recordCommand("desktop_start");
        } else if (action === "script_exec") {
          const scriptContent = body?.script || "";
          const scriptType = body?.scriptType || "powershell";
          const cmdId = uuidv4();

          const resultPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              deps.pendingScripts.delete(cmdId);
              reject(new Error("Script execution timed out after 5 minutes"));
            }, 5 * 60 * 1000);

            deps.pendingScripts.set(cmdId, { resolve, reject, timeout });
          });

          target.ws.send(encodeMessage({
            type: "command",
            commandType: "script_exec",
            id: cmdId,
            payload: { script: scriptContent, type: scriptType },
          }));

          metrics.recordCommand("script_exec");
          logAudit({
            timestamp: Date.now(),
            username: user.username,
            ip,
            action: AuditAction.SCRIPT_EXECUTE,
            targetClientId: targetId,
            success: true,
            details: `script_exec (${scriptType})`,
          });

          try {
            const result = await resultPromise;
            return Response.json(result);
          } catch (error: any) {
            return Response.json({ ok: false, error: error.message }, { status: 500 });
          }
        } else if (action === "silent_exec") {
          if (user.role !== "admin") {
            return new Response("Forbidden: Admin access required", { status: 403 });
          }

          const command = typeof body?.command === "string" ? body.command.trim() : "";
          const args = typeof body?.args === "string" ? body.args : "";
          const cwd = typeof body?.cwd === "string" ? body.cwd : "";

          if (!command) {
            return new Response("Bad request", { status: 400 });
          }

          const cmdId = uuidv4();
          target.ws.send(
            encodeMessage({
              type: "command",
              commandType: "silent_exec",
              id: cmdId,
              payload: { command, args, cwd },
            }),
          );
          metrics.recordCommand("silent_exec");
          logAudit({
            timestamp: Date.now(),
            username: user.username,
            ip,
            action: AuditAction.SILENT_EXECUTE,
            targetClientId: targetId,
            success: true,
            details: JSON.stringify({ command, args, cwd }),
          });
        } else if (action === "uninstall") {
          target.ws.send(encodeMessage({ type: "command", commandType: "uninstall", id: uuidv4() }));
          metrics.recordCommand("uninstall");
          deleteClientRow(targetId);
          logAudit({
            timestamp: Date.now(),
            username: user.username,
            ip,
            action: AuditAction.UNINSTALL,
            targetClientId: targetId,
            details: "Agent uninstall requested - persistence will be removed",
            success: true,
          });
        } else {
          success = false;
          return new Response("Bad request", { status: 400 });
        }

        logAudit({
          timestamp: Date.now(),
          username: user.username,
          ip,
          action: AuditAction.COMMAND,
          targetClientId: targetId,
          details: action,
          success,
        });

        return Response.json({ ok: true });
      } catch (error) {
        logAudit({
          timestamp: Date.now(),
          username: user.username,
          ip,
          action: AuditAction.COMMAND,
          targetClientId: targetId,
          success: false,
          errorMessage: String(error),
        });
        return new Response("Bad request", { status: 400 });
      }
    }
  }

  return null;
}
