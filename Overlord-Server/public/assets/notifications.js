import {
  startNotificationClient,
  subscribeNotifications,
  subscribeReady,
  subscribeStatus,
  markAllNotificationsRead,
} from "./notify-client.js";

const wsStatus = document.getElementById("ws-status");
const listEl = document.getElementById("notification-list");
const emptyState = document.getElementById("empty-state");
const keywordInput = document.getElementById("keyword-input");
const saveKeywordsBtn = document.getElementById("save-keywords");
const keywordHint = document.getElementById("keyword-hint");
const webhookEnabledInput = document.getElementById("webhook-enabled");
const webhookUrlInput = document.getElementById("webhook-url");
const saveWebhookBtn = document.getElementById("save-webhook");
const telegramEnabledInput = document.getElementById("telegram-enabled");
const telegramBotTokenInput = document.getElementById("telegram-bot-token");
const telegramChatIdInput = document.getElementById("telegram-chat-id");
const saveTelegramBtn = document.getElementById("save-telegram");
const panel = document.getElementById("notification-panel");
const previewModal = document.getElementById("notification-preview-modal");
const previewModalImg = document.getElementById("notification-preview-image");
const previewModalClose = document.getElementById("notification-preview-close");

const MAX_ROWS = 200;

function setStatus(text, tone = "neutral") {
  if (!wsStatus) return;
  const icon = wsStatus.querySelector("i");
  const label = wsStatus.querySelector("span");
  if (label) label.textContent = text;
  if (icon) {
    icon.className = "fa-solid fa-circle-dot";
    icon.classList.remove("text-green-400", "text-red-400", "text-yellow-400", "text-slate-400");
    if (tone === "ok") icon.classList.add("text-green-400");
    else if (tone === "error") icon.classList.add("text-red-400");
    else if (tone === "warn") icon.classList.add("text-yellow-400");
    else icon.classList.add("text-slate-400");
  }
}

function formatTime(ts) {
  if (ts == null) return "-";
  let normalized = ts;
  if (typeof normalized === "bigint") {
    normalized = Number(normalized);
  } else if (typeof normalized === "string") {
    normalized = Number(normalized);
  }
  if (!Number.isFinite(normalized)) return "-";
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text == null ? "" : String(text);
  return div.innerHTML;
}

function renderRow(item, prepend = true) {
  if (!listEl) return;
  const row = document.createElement("tr");
  row.className = "border-t border-slate-800/60";
  row.innerHTML = `
    <td class="py-2 pr-4 whitespace-nowrap text-slate-400">${formatTime(item.ts)}</td>
    <td class="py-2 pr-4 whitespace-nowrap">${escapeHtml(item.clientId || "-")}</td>
    <td class="py-2 pr-4 whitespace-nowrap">${escapeHtml(item.user || "-")}</td>
    <td class="py-2 pr-4 max-w-xl truncate" title="${escapeHtml(item.title || "")}">${escapeHtml(item.title || "-")}</td>
    <td class="py-2 pr-4 whitespace-nowrap">${escapeHtml(item.process || "-")}</td>
    <td class="py-2 pr-4 whitespace-nowrap">${escapeHtml(item.keyword || "-")}</td>
    <td class="py-2 pr-4"><div class="preview-slot"></div></td>
  `;

  const preview = row.querySelector(".preview-slot");
  if (preview) {
    const notificationId = item?.id || "";
    if (!notificationId) {
      preview.textContent = "-";
      preview.className = "text-slate-500";
    } else {
      preview.textContent = "Loading...";
      preview.className = "text-slate-500";
      const img = document.createElement("img");
      img.className = "max-h-32 w-auto rounded border border-slate-800/80 cursor-zoom-in";
      img.loading = "lazy";
      img.alt = "Notification screenshot";

      let attempts = 0;
      const maxAttempts = 5;
      const fetchPreview = async () => {
        attempts += 1;
        try {
          const url = `/api/notifications/${encodeURIComponent(notificationId)}/screenshot?ts=${Date.now()}`;
          const res = await fetch(url, { cache: "no-store" });
          if (!res.ok) {
            if (res.status === 404 && attempts < maxAttempts) {
              setTimeout(fetchPreview, 1000 * attempts);
              return;
            }
            preview.textContent = "-";
            preview.className = "text-slate-500";
            return;
          }
          const blob = await res.blob();
          const objectUrl = URL.createObjectURL(blob);
          img.classList.add("opacity-0");
          preview.innerHTML = "";
          preview.className = "";
          preview.appendChild(img);
          img.addEventListener("load", () => {
            img.classList.remove("opacity-0");
          });
          img.addEventListener("error", () => {
            preview.textContent = "-";
            preview.className = "text-slate-500";
            URL.revokeObjectURL(objectUrl);
          });
          img.src = objectUrl;
          img.dataset.previewUrl = objectUrl;
          if (img.decode) {
            img.decode().catch(() => {});
          }

          img.addEventListener("click", () => {
            if (!previewModal || !previewModalImg) return;
            previewModalImg.src = img.dataset.previewUrl || objectUrl;
            previewModal.classList.remove("hidden");
            previewModal.classList.add("flex");
          });
        } catch (err) {
          if (attempts < maxAttempts) {
            setTimeout(fetchPreview, 1000 * attempts);
            return;
          }
          preview.textContent = "-";
          preview.className = "text-slate-500";
        }
      };
      fetchPreview();
    }
  }

  if (prepend) {
    listEl.prepend(row);
  } else {
    listEl.appendChild(row);
  }

  const rows = listEl.querySelectorAll("tr");
  if (rows.length > MAX_ROWS) {
    rows[rows.length - 1].remove();
  }

  if (emptyState) {
    emptyState.classList.toggle("hidden", listEl.children.length > 0);
  }
}

function handleNotification(item) {
  console.log("[notifications] item", item);
  renderRow(item, true);
}


function parseKeywords(text) {
  return text
    .split(/\r?\n/)
    .map((k) => k.trim())
    .filter(Boolean);
}

function renderKeywordHint(count) {
  if (!keywordHint) return;
  keywordHint.textContent = `${count} keyword${count === 1 ? "" : "s"}`;
}

async function loadKeywords() {
  if (!keywordInput) return;
  try {
    const res = await fetch("/api/notifications/config");
    if (!res.ok) return;
    const data = await res.json();
    const notifications = data?.notifications || {};
    const keywords = notifications.keywords || [];
    keywordInput.value = keywords.join("\n");
    renderKeywordHint(keywords.length);
    if (webhookEnabledInput) {
      webhookEnabledInput.checked = !!notifications.webhookEnabled;
    }
    if (webhookUrlInput) {
      webhookUrlInput.value = notifications.webhookUrl || "";
    }
    if (telegramEnabledInput) {
      telegramEnabledInput.checked = !!notifications.telegramEnabled;
    }
    if (telegramBotTokenInput) {
      telegramBotTokenInput.value = notifications.telegramBotToken || "";
    }
    if (telegramChatIdInput) {
      telegramChatIdInput.value = notifications.telegramChatId || "";
    }
  } catch {}
}

function wireKeywordSave() {
  if (!saveKeywordsBtn || !keywordInput) return;
  saveKeywordsBtn.addEventListener("click", async () => {
    const keywords = parseKeywords(keywordInput.value);
    try {
      const res = await fetch("/api/notifications/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords }),
      });
      if (!res.ok) {
        window.showToast?.("Failed to save keywords", "error", 4000);
        return;
      }
      const data = await res.json();
      const updated = data?.notifications?.keywords || keywords;
      keywordInput.value = updated.join("\n");
      renderKeywordHint(updated.length);
      window.showToast?.("Keywords updated", "success", 3000);
    } catch {
      window.showToast?.("Failed to save keywords", "error", 4000);
    }
  });

  keywordInput.addEventListener("input", () => {
    const keywords = parseKeywords(keywordInput.value);
    renderKeywordHint(keywords.length);
  });
}

function wireWebhookSave() {
  if (!saveWebhookBtn || !webhookUrlInput || !webhookEnabledInput) return;
  saveWebhookBtn.addEventListener("click", async () => {
    const webhookUrl = webhookUrlInput.value.trim();
    const webhookEnabled = !!webhookEnabledInput.checked;
    try {
      const res = await fetch("/api/notifications/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhookUrl, webhookEnabled }),
      });
      if (!res.ok) {
        window.showToast?.("Failed to save webhook", "error", 4000);
        return;
      }
      const data = await res.json();
      const notifications = data?.notifications || {};
      webhookEnabledInput.checked = !!notifications.webhookEnabled;
      webhookUrlInput.value = notifications.webhookUrl || "";
      window.showToast?.("Webhook updated", "success", 3000);
    } catch {
      window.showToast?.("Failed to save webhook", "error", 4000);
    }
  });
}

function wireTelegramSave() {
  if (!saveTelegramBtn || !telegramBotTokenInput || !telegramChatIdInput || !telegramEnabledInput) return;
  saveTelegramBtn.addEventListener("click", async () => {
    const telegramBotToken = telegramBotTokenInput.value.trim();
    const telegramChatId = telegramChatIdInput.value.trim();
    const telegramEnabled = !!telegramEnabledInput.checked;
    try {
      const res = await fetch("/api/notifications/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telegramBotToken, telegramChatId, telegramEnabled }),
      });
      if (!res.ok) {
        window.showToast?.("Failed to save Telegram settings", "error", 4000);
        return;
      }
      const data = await res.json();
      const notifications = data?.notifications || {};
      telegramEnabledInput.checked = !!notifications.telegramEnabled;
      telegramBotTokenInput.value = notifications.telegramBotToken || "";
      telegramChatIdInput.value = notifications.telegramChatId || "";
      window.showToast?.("Telegram settings updated", "success", 3000);
    } catch {
      window.showToast?.("Failed to save Telegram settings", "error", 4000);
    }
  });
}


function connect() {
  startNotificationClient();
  if (panel) {
    markAllNotificationsRead();
  }
  subscribeStatus((status) => {
    if (status === "connected") setStatus("Connected", "ok");
    if (status === "error") setStatus("Error", "error");
    if (status === "disconnected") setStatus("Disconnected", "warn");
  });
  subscribeReady((history) => {
    if (listEl) listEl.innerHTML = "";
    history.reverse().forEach((item) => renderRow(item, false));
    if (emptyState) {
      emptyState.classList.toggle("hidden", history.length > 0);
    }
    markAllNotificationsRead();
  });
  subscribeNotifications(handleNotification);
}

wireKeywordSave();
wireWebhookSave();
wireTelegramSave();
loadKeywords();
connect();

function wireActiveClear() {
  const clearIfActive = () => {
    if (document.visibilityState === "visible") {
      markAllNotificationsRead();
    }
  };
  document.addEventListener("visibilitychange", clearIfActive);
  window.addEventListener("focus", clearIfActive);
  clearIfActive();
}

wireActiveClear();

if (previewModal && previewModalClose && previewModalImg) {
  const closePreview = () => {
    previewModal.classList.add("hidden");
    previewModal.classList.remove("flex");
    previewModalImg.src = "";
  };
  previewModalClose.addEventListener("click", closePreview);
  previewModal.addEventListener("click", (event) => {
    if (event.target === previewModal) closePreview();
  });
}
