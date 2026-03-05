const logsContainer = document.getElementById("logs-container");
const logsEmpty = document.getElementById("logs-empty");
const lastUpdate = document.getElementById("last-update");
const clientFilter = document.getElementById("client-filter");
const startDateInput = document.getElementById("start-date");
const endDateInput = document.getElementById("end-date");
const refreshBtn = document.getElementById("refresh-btn");
const prevPageBtn = document.getElementById("prev-page");
const nextPageBtn = document.getElementById("next-page");
const pageInfo = document.getElementById("page-info");

const actionLabels = {
  client_first_connect: {
    label: "First Connect",
    className: "bg-emerald-900/40 text-emerald-200 border border-emerald-800",
    icon: "fa-plug-circle-bolt",
  },
  client_reconnect: {
    label: "Reconnect",
    className: "bg-blue-900/40 text-blue-200 border border-blue-800",
    icon: "fa-rotate",
  },
  client_disconnect: {
    label: "Disconnect",
    className: "bg-orange-900/40 text-orange-200 border border-orange-800",
    icon: "fa-plug-circle-xmark",
  },
  uninstall: {
    label: "Uninstall",
    className: "bg-rose-900/40 text-rose-200 border border-rose-800",
    icon: "fa-trash",
  },
};

let page = 1;
const pageSize = 50;
let total = 0;

function formatTimestamp(ts) {
  if (!ts) return "-";
  const date = new Date(ts);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}

function parseDetails(details) {
  if (!details) return "";
  try {
    const parsed = JSON.parse(details);
    return escapeHtml(JSON.stringify(parsed));
  } catch {
    return escapeHtml(details);
  }
}

function getSelectedActions() {
  return Array.from(document.querySelectorAll(".action-checkbox"))
    .filter((el) => el.checked)
    .map((el) => el.value);
}

function buildQuery() {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));

  const actions = getSelectedActions();
  if (actions.length > 0) {
    params.set("actions", actions.join(","));
  }

  const clientId = clientFilter?.value?.trim();
  if (clientId) {
    params.set("clientId", clientId);
  }

  if (startDateInput?.value) {
    const ts = new Date(startDateInput.value).getTime();
    if (!Number.isNaN(ts)) params.set("startDate", String(ts));
  }

  if (endDateInput?.value) {
    const ts = new Date(endDateInput.value).getTime();
    if (!Number.isNaN(ts)) params.set("endDate", String(ts));
  }

  return params;
}

function renderLogs(logs) {
  if (!logsContainer || !logsEmpty) return;

  logsContainer.innerHTML = "";
  if (!logs || logs.length === 0) {
    logsEmpty.classList.remove("hidden");
    return;
  }
  logsEmpty.classList.add("hidden");

  logsContainer.innerHTML = logs
    .map((log) => {
      const meta = actionLabels[log.action] || {
        label: log.action,
        className: "bg-slate-800/60 text-slate-200 border border-slate-700",
        icon: "fa-circle-info",
      };
      const clientId = log.targetClientId || "-";
      const shortId = clientId.length > 8 ? `${clientId.slice(0, 8)}...` : clientId;
      const detailText = parseDetails(log.details);

      return `
        <div class="bg-slate-950/60 border border-slate-800 rounded-lg p-4 flex flex-col gap-2">
          <div class="flex items-center justify-between gap-3 flex-wrap">
            <div class="flex items-center gap-3">
              <span class="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs ${meta.className}">
                <i class="fa-solid ${meta.icon}"></i>
                ${meta.label}
              </span>
              <span class="text-sm text-slate-300" title="${escapeHtml(clientId)}">
                Client: <span class="font-mono">${escapeHtml(shortId)}</span>
              </span>
            </div>
            <div class="text-xs text-slate-400">${formatTimestamp(log.timestamp)}</div>
          </div>
          <div class="text-xs text-slate-500 flex flex-wrap gap-3">
            <span>IP: ${escapeHtml(log.ip || "-")}</span>
            <span>User: ${escapeHtml(log.username || "-")}</span>
          </div>
          ${detailText ? `<div class="text-xs text-slate-400">Details: ${detailText}</div>` : ""}
        </div>
      `;
    })
    .join("");
}

async function loadLogs() {
  try {
    const params = buildQuery();
    const res = await fetch(`/api/audit-logs?${params.toString()}`);
    if (!res.ok) {
      throw new Error("Failed to load logs");
    }
    const data = await res.json();
    total = data.total || 0;
    renderLogs(data.logs || []);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (pageInfo) pageInfo.textContent = `Page ${page} of ${totalPages}`;

    if (prevPageBtn) prevPageBtn.disabled = page <= 1;
    if (nextPageBtn) nextPageBtn.disabled = page >= totalPages;

    if (lastUpdate) lastUpdate.textContent = new Date().toLocaleTimeString();
  } catch (err) {
    console.error("Failed to load logs", err);
    if (logsContainer) {
      logsContainer.innerHTML = `
        <div class="text-rose-300 text-sm">Failed to load logs. Please try again.</div>
      `;
    }
  }
}

function resetAndLoad() {
  page = 1;
  loadLogs();
}

let debounceTimer = null;
function debounceLoad() {
  if (debounceTimer) window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => resetAndLoad(), 300);
}

clientFilter?.addEventListener("input", debounceLoad);
startDateInput?.addEventListener("change", resetAndLoad);
endDateInput?.addEventListener("change", resetAndLoad);
refreshBtn?.addEventListener("click", resetAndLoad);

Array.from(document.querySelectorAll(".action-checkbox")).forEach((cb) => {
  cb.addEventListener("change", resetAndLoad);
});

prevPageBtn?.addEventListener("click", () => {
  if (page > 1) {
    page -= 1;
    loadLogs();
  }
});

nextPageBtn?.addEventListener("click", () => {
  page += 1;
  loadLogs();
});

loadLogs();
