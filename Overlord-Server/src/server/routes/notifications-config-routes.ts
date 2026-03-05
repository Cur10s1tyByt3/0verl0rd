import { authenticateRequest } from "../../auth";
import { AuditAction, logAudit } from "../../auditLog";
import * as clientManager from "../../clientManager";
import { getConfig, updateNotificationsConfig } from "../../config";
import { encodeMessage } from "../../protocol";

type RequestIpProvider = {
  requestIP: (req: Request) => { address?: string } | null | undefined;
};

type NotificationsRouteDeps = {
  getNotificationScreenshot: (notificationId: string) => { format?: string; bytes: Uint8Array } | null;
  secureHeaders: (contentType?: string) => HeadersInit;
};

export async function handleNotificationsConfigRoutes(
  req: Request,
  url: URL,
  server: RequestIpProvider,
  deps: NotificationsRouteDeps,
): Promise<Response | null> {
  const screenshotMatch = url.pathname.match(/^\/api\/notifications\/([^/]+)\/screenshot$/);
  if (req.method === "GET" && screenshotMatch) {
    const user = await authenticateRequest(req);
    if (!user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    const notificationId = decodeURIComponent(screenshotMatch[1]);
    const screenshot = deps.getNotificationScreenshot(notificationId);
    if (!screenshot) {
      return new Response("Not found", { status: 404 });
    }

    const format = (screenshot.format || "jpeg").toLowerCase();
    const contentType = format === "jpg" || format === "jpeg"
      ? "image/jpeg"
      : format === "png"
        ? "image/png"
        : format === "webp"
          ? "image/webp"
          : "application/octet-stream";

    return new Response(screenshot.bytes as unknown as BodyInit, {
      headers: deps.secureHeaders(contentType),
    });
  }

  if (req.method === "GET" && url.pathname === "/api/notifications/config") {
    const user = await authenticateRequest(req);
    if (!user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (user.role === "viewer") {
      return new Response("Forbidden: Viewer access denied", { status: 403 });
    }
    return Response.json({ notifications: getConfig().notifications });
  }

  if (req.method === "PUT" && url.pathname === "/api/notifications/config") {
    const user = await authenticateRequest(req);
    if (!user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (user.role !== "admin" && user.role !== "operator") {
      return new Response("Forbidden: Admin or operator access required", {
        status: 403,
      });
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const currentConfig = getConfig().notifications;
    const hasKeywords = Array.isArray(body?.keywords);
    const rawKeywords = hasKeywords ? body.keywords : currentConfig.keywords || [];
    const keywords = rawKeywords
      .map((k: any) => String(k).trim())
      .filter(Boolean)
      .slice(0, 200);

    const webhookEnabled =
      typeof body?.webhookEnabled === "boolean"
        ? body.webhookEnabled
        : currentConfig.webhookEnabled;
    const webhookUrl =
      typeof body?.webhookUrl === "string"
        ? body.webhookUrl.trim()
        : currentConfig.webhookUrl || "";
    const telegramEnabled =
      typeof body?.telegramEnabled === "boolean"
        ? body.telegramEnabled
        : currentConfig.telegramEnabled;
    const telegramBotToken =
      typeof body?.telegramBotToken === "string"
        ? body.telegramBotToken.trim()
        : currentConfig.telegramBotToken || "";
    const telegramChatId =
      typeof body?.telegramChatId === "string"
        ? body.telegramChatId.trim()
        : currentConfig.telegramChatId || "";

    if (webhookUrl) {
      try {
        const parsed = new URL(webhookUrl);
        if (!/^https?:$/.test(parsed.protocol)) {
          return Response.json(
            { error: "Webhook URL must be http(s)" },
            { status: 400 },
          );
        }
      } catch {
        return Response.json({ error: "Invalid webhook URL" }, { status: 400 });
      }
    }

    const updated = await updateNotificationsConfig({
      keywords,
      webhookEnabled,
      webhookUrl,
      telegramEnabled,
      telegramBotToken,
      telegramChatId,
    });

    for (const client of clientManager.getAllClients().values()) {
      if (client.role !== "client") continue;
      try {
        client.ws.send(
          encodeMessage({
            type: "notification_config",
            keywords: updated.keywords || [],
            minIntervalMs: updated.minIntervalMs || 8000,
          }),
        );
      } catch {}
    }

    logAudit({
      timestamp: Date.now(),
      username: user.username,
      ip: server.requestIP(req)?.address || "unknown",
      action: AuditAction.COMMAND,
      details: `Updated notification keywords (${updated.keywords.length})`,
      success: true,
    });

    return Response.json({ ok: true, notifications: updated });
  }

  return null;
}
