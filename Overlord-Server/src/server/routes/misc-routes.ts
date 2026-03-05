import { authenticateRequest } from "../../auth";
import * as clientManager from "../../clientManager";
import { getAuditLogs } from "../../auditLog";
import { listClients } from "../../db";
import { logger } from "../../logger";
import { metrics } from "../../metrics";
import { requirePermission } from "../../rbac";

type MiscRouteDeps = {
  CORS_HEADERS: Record<string, string>;
  SERVER_VERSION: string;
  getConsoleSessionCount: () => number;
  getRdSessionCount: () => number;
  getFileBrowserSessionCount: () => number;
  getProcessSessionCount: () => number;
};

export async function handleMiscRoutes(
  req: Request,
  url: URL,
  deps: MiscRouteDeps,
): Promise<Response | null> {
  if (req.method === "GET" && url.pathname === "/api/metrics") {
    const user = await authenticateRequest(req);
    if (!user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const snapshot = metrics.getSnapshot();

    const clientList = listClients({ page: 1, pageSize: 10000, search: "", sort: "last_seen_desc" });
    logger.debug(
      `[metrics] Database reports: total=${clientList.total}, online=${clientList.online}, items=${clientList.items.length}`,
    );
    logger.debug(`[metrics] In-memory clients map size: ${clientManager.getClientCount()}`);

    snapshot.clients.total = clientList.total;
    snapshot.clients.online = clientList.online;
    snapshot.clients.offline = clientList.total - clientList.online;

    const byOS: Record<string, number> = {};
    const byCountry: Record<string, number> = {};
    const byOSOnline: Record<string, number> = {};
    const byCountryOnline: Record<string, number> = {};
    let onlineCounted = 0;
    const totalItems = clientList.items.length;
    for (const item of clientList.items) {
      if (item.os) {
        byOS[item.os] = (byOS[item.os] || 0) + 1;
      }
      if (item.country) {
        byCountry[item.country] = (byCountry[item.country] || 0) + 1;
      }
      if (!item.online) continue;
      onlineCounted++;
      if (item.os) {
        byOSOnline[item.os] = (byOSOnline[item.os] || 0) + 1;
      }
      if (item.country) {
        byCountryOnline[item.country] = (byCountryOnline[item.country] || 0) + 1;
      }
    }
    snapshot.clients.byOS = byOS;
    snapshot.clients.byCountry = byCountry;

    snapshot.sessions.console = deps.getConsoleSessionCount();
    snapshot.sessions.remoteDesktop = deps.getRdSessionCount();
    snapshot.sessions.fileBrowser = deps.getFileBrowserSessionCount();
    snapshot.sessions.process = deps.getProcessSessionCount();

    metrics.recordHistoryEntry(snapshot);

    const history = metrics.getHistory();

    return new Response(JSON.stringify({ snapshot, history }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (url.pathname === "/health") {
    return new Response("ok", { headers: deps.CORS_HEADERS });
  }

  if (req.method === "GET" && url.pathname === "/api/version") {
    return new Response(JSON.stringify({ version: deps.SERVER_VERSION }), {
      headers: {
        ...deps.CORS_HEADERS,
        "Content-Type": "application/json",
      },
    });
  }

  if (req.method === "GET" && url.pathname === "/api/audit-logs") {
    const user = await authenticateRequest(req);
    if (!user) {
      return new Response("Unauthorized", { status: 401 });
    }
    try {
      requirePermission(user, "audit:view");
    } catch (error) {
      if (error instanceof Response) return error;
      return new Response("Forbidden", { status: 403 });
    }

    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const pageSize = Math.max(1, Math.min(100, Number(url.searchParams.get("pageSize") || 50)));
    const targetClientId = (url.searchParams.get("clientId") || "").trim();
    const action = (url.searchParams.get("action") || "").trim();
    const actionsRaw = (url.searchParams.get("actions") || "").trim();
    const actions = actionsRaw
      ? actionsRaw
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean)
      : undefined;
    const startDate = Number(url.searchParams.get("startDate") || 0) || undefined;
    const endDate = Number(url.searchParams.get("endDate") || 0) || undefined;
    const successOnly = url.searchParams.get("successOnly") === "true";

    const result = getAuditLogs({
      page,
      pageSize,
      targetClientId: targetClientId || undefined,
      action: action || undefined,
      actions,
      startDate,
      endDate,
      successOnly,
    });

    return Response.json(result, { headers: deps.CORS_HEADERS });
  }

  return null;
}
