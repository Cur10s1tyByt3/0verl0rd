const clientList = document.getElementById("client-list");
const clientSearch = document.getElementById("client-search");
const osFilter = document.getElementById("os-filter");
const selectAllBtn = document.getElementById("select-all-btn");
const clearSelectionBtn = document.getElementById("clear-selection-btn");
const selectedCountSpan = document.getElementById("selected-count");
const uploadZone = document.getElementById("upload-zone");
const uploadInput = document.getElementById("upload-input");
const uploadStatus = document.getElementById("upload-status");
const osBadge = document.getElementById("os-badge");
const execArgsInput = document.getElementById("exec-args");
const hideWindowToggle = document.getElementById("hide-window-toggle");
const executeBtn = document.getElementById("execute-btn");
const updateBtn = document.getElementById("update-btn");
const outputContainer = document.getElementById("output-container");
const clearOutputBtn = document.getElementById("clear-output-btn");

let allClients = [];
let filteredClients = [];
const selectedClients = new Set();
let uploaded = null;
let allowedOs = "unknown";

async function checkAuth() {
  try {
    const res = await fetch("/api/auth/me");
    if (!res.ok) {
      window.location.href = "/login.html";
      return;
    }

    const data = await res.json();
    document.getElementById("username-display").textContent = data.username;

    const roleBadge = document.getElementById("role-badge");
    const roleBadges = {
      admin: '<i class="fa-solid fa-crown mr-1"></i>Admin',
      operator: '<i class="fa-solid fa-sliders mr-1"></i>Operator',
      viewer: '<i class="fa-solid fa-eye mr-1"></i>Viewer',
    };
    if (roleBadges[data.role]) {
      roleBadge.innerHTML = roleBadges[data.role];
    } else {
      roleBadge.textContent = data.role || "";
    }

    if (data.role === "admin") {
      roleBadge.classList.add(
        "bg-purple-900/50",
        "text-purple-300",
        "border",
        "border-purple-800",
      );
      document.getElementById("metrics-link")?.classList.remove("hidden");
      document.getElementById("scripts-link")?.classList.remove("hidden");
      document.getElementById("build-link")?.classList.remove("hidden");
      document.getElementById("users-link")?.classList.remove("hidden");
      document.getElementById("plugins-link")?.classList.remove("hidden");
      document.getElementById("deploy-link")?.classList.remove("hidden");
    } else if (data.role === "operator") {
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

    if (data.role !== "admin") {
      alert("Access denied. Admin role required.");
      window.location.href = "/";
    }
  } catch (err) {
    console.error("Auth check failed:", err);
    window.location.href = "/login.html";
  }
}

async function loadClients() {
  try {
    const res = await fetch("/api/clients?pageSize=10000");
    if (!res.ok) throw new Error("Failed to load clients");

    const data = await res.json();
    allClients = data.items.filter((c) => c.online);

    if (allClients.length === 0) {
      clientList.innerHTML =
        '<div class="p-4 text-center text-slate-500">No online clients available</div>';
      return;
    }

    const osList = new Set(allClients.map((c) => c.os || "unknown"));
    osFilter.innerHTML =
      '<option value="all">All OS (' +
      allClients.length +
      ")</option>" +
      Array.from(osList)
        .sort()
        .map((os) => {
          const count = allClients.filter((c) => (c.os || "unknown") === os)
            .length;
          return `<option value="${escapeHtml(os)}">${escapeHtml(os)} (${count})</option>`;
        })
        .join("");

    filterAndRenderClients();
    preselectClientFromQuery();
  } catch (error) {
    console.error("Failed to load clients:", error);
    clientList.innerHTML =
      '<div class="p-4 text-center text-red-400">Error loading clients</div>';
  }
}

function preselectClientFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const targetId = params.get("clientId");
  if (!targetId) return;
  if (allClients.some((c) => c.id === targetId)) {
    selectedClients.add(targetId);
    renderClients();
  }
}

function filterAndRenderClients() {
  const searchTerm = clientSearch.value.toLowerCase();
  const osValue = osFilter.value;

  filteredClients = allClients.filter((c) => {
    const matchesSearch =
      !searchTerm ||
      (c.host && c.host.toLowerCase().includes(searchTerm)) ||
      c.id.toLowerCase().includes(searchTerm) ||
      (c.os && c.os.toLowerCase().includes(searchTerm)) ||
      (c.user && c.user.toLowerCase().includes(searchTerm));

    const matchesOs = osValue === "all" || (c.os || "unknown") === osValue;

    const matchesUploadOs = matchesClientOs(c.os || "", allowedOs);

    return matchesSearch && matchesOs && matchesUploadOs;
  });

  renderClients();
}

function renderClients() {
  if (filteredClients.length === 0) {
    clientList.innerHTML =
      '<div class="p-4 text-center text-slate-500">No clients match your filters</div>';
    return;
  }

  clientList.innerHTML = filteredClients
    .map((c) => {
      const name = c.host || c.id.substring(0, 8);
      const os = c.os || "unknown";
      const isSelected = selectedClients.has(c.id);

      return `
      <label class="flex items-center gap-3 px-4 py-3 hover:bg-slate-800/50 cursor-pointer border-b border-slate-800 last:border-b-0" data-client-id="${escapeHtml(c.id)}">
        <input type="checkbox" class="client-checkbox w-4 h-4 rounded border-slate-600 bg-slate-700 checked:bg-cyan-600" data-id="${escapeHtml(c.id)}" ${
          isSelected ? "checked" : ""
        }>
        <div class="flex-1 min-w-0">
          <div class="font-semibold text-slate-100 truncate">${escapeHtml(
            name,
          )}</div>
          <div class="text-sm text-slate-400 flex items-center gap-2">
            <span>${escapeHtml(os)}</span>
            ${c.user ? `<span class="text-slate-500">• ${escapeHtml(c.user)}</span>` : ""}
            <span class="text-slate-600">• ${c.id.substring(0, 8)}</span>
          </div>
        </div>
        <div class="text-emerald-400 text-sm">
          <i class="fa-solid fa-circle text-xs"></i> Online
        </div>
      </label>
    `;
    })
    .join("");

  clientList.querySelectorAll(".client-checkbox").forEach((cb) => {
    cb.addEventListener("change", handleClientToggle);
  });

  updateSelectedCount();
}

function handleClientToggle(e) {
  const clientId = e.target.dataset.id;
  if (e.target.checked) {
    selectedClients.add(clientId);
  } else {
    selectedClients.delete(clientId);
  }
  updateSelectedCount();
}

function updateSelectedCount() {
  selectedCountSpan.textContent = `${selectedClients.size} selected`;
  executeBtn.disabled = selectedClients.size === 0 || !uploaded;
  if (updateBtn) {
    updateBtn.disabled = selectedClients.size === 0 || !uploaded;
  }
}

function normalizeClientOs(os) {
  const val = String(os || "").toLowerCase();
  if (val.includes("windows")) return "windows";
  if (val.includes("darwin") || val.includes("mac")) return "mac";
  if (val.includes("linux")) return "linux";
  return "unknown";
}

function matchesClientOs(clientOs, targetOs) {
  if (!targetOs || targetOs === "unknown") return true;
  if (targetOs === "unix") {
    const norm = normalizeClientOs(clientOs);
    return norm === "linux" || norm === "mac";
  }
  return normalizeClientOs(clientOs) === targetOs;
}

function setUploadStatus(text, tone = "text-slate-400") {
  uploadStatus.className = `mt-3 text-sm ${tone}`;
  uploadStatus.textContent = text;
}

function setOsBadge(os) {
  const label = os === "unknown" ? "not detected" : os === "unix" ? "mac/linux" : os;
  osBadge.textContent = `OS: ${label}`;
  osBadge.classList.remove("border-emerald-600", "text-emerald-300", "border-amber-600", "text-amber-300");
  if (os === "unknown") return;
  osBadge.classList.add("border-emerald-600", "text-emerald-300");
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

clientSearch.addEventListener("input", filterAndRenderClients);
osFilter.addEventListener("change", filterAndRenderClients);

selectAllBtn.addEventListener("click", () => {
  filteredClients.forEach((c) => selectedClients.add(c.id));
  renderClients();
});

clearSelectionBtn.addEventListener("click", () => {
  selectedClients.clear();
  renderClients();
});

uploadZone.addEventListener("click", () => uploadInput.click());
uploadZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  uploadZone.classList.add("border-cyan-500");
});
uploadZone.addEventListener("dragleave", () => {
  uploadZone.classList.remove("border-cyan-500");
});
uploadZone.addEventListener("drop", async (event) => {
  event.preventDefault();
  uploadZone.classList.remove("border-cyan-500");
  const file = event.dataTransfer?.files?.[0];
  if (file) {
    await uploadFile(file);
  }
});
uploadInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (file) {
    await uploadFile(file);
  }
});

async function uploadFile(file) {
  setUploadStatus(`Uploading ${file.name}...`, "text-blue-400");
  executeBtn.disabled = true;

  try {
    const form = new FormData();
    form.append("file", file, file.name);
    const res = await fetch("/api/deploy/upload", {
      method: "POST",
      body: form,
    });

    if (!res.ok) {
      const text = await res.text();
      setUploadStatus(text || "Upload failed", "text-red-400");
      return;
    }

    const data = await res.json();
    if (!data.ok) {
      setUploadStatus(data.error || "Upload failed", "text-red-400");
      return;
    }

      uploaded = data;
      allowedOs = data.os || "unknown";
      const sizeBytes = Number(data.size ?? file.size ?? 0);
      setUploadStatus(`Uploaded ${data.name} (${formatBytes(sizeBytes)})`, "text-emerald-400");
      setOsBadge(allowedOs);

      filterAndRenderClients();
      Array.from(selectedClients).forEach((clientId) => {
        const client = allClients.find((c) => c.id === clientId);
        if (!client || !matchesClientOs(client.os || "", allowedOs)) {
          selectedClients.delete(clientId);
        }
      });
      renderClients();
      updateSelectedCount();
  } catch (error) {
    console.error("Upload failed:", error);
    setUploadStatus("Upload failed", "text-red-400");
  }
}

executeBtn.addEventListener("click", async () => {
  if (selectedClients.size === 0) {
    alert("Please select at least one client");
    return;
  }

  if (!uploaded?.uploadId) {
    alert("Please upload an installer first");
    return;
  }

  const args = execArgsInput.value.trim();
  const hideWindow = hideWindowToggle?.checked !== false;

  executeBtn.disabled = true;
  const clientIds = Array.from(selectedClients);
  outputContainer.innerHTML = `<div class="text-blue-400">Dispatching to ${clientIds.length} client(s)...</div>`;

  let results = [];
  try {
    const res = await fetch("/api/deploy/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uploadId: uploaded.uploadId,
        clientIds,
        args,
        hideWindow,
      }),
    });

    if (!res.ok) {
      results = clientIds.map((clientId) => ({
        clientId,
        error: `HTTP error! status: ${res.status}`,
      }));
    } else {
      const data = await res.json();
      if (!data.ok) {
        results = clientIds.map((clientId) => ({
          clientId,
          error: data.error || "Unknown error",
        }));
      } else {
        results = (data.results || []).map((result) => ({
          clientId: result.clientId,
          ok: result.ok,
          reason: result.reason,
          command: result.command,
        }));
      }
    }
  } catch (error) {
    results = clientIds.map((clientId) => ({
      clientId,
      error: error.message,
    }));
  }

  const namedResults = results.map((r) => {
    const client = allClients.find((c) => c.id === r.clientId);
    const clientName = client
      ? client.host || r.clientId.substring(0, 8)
      : r.clientId.substring(0, 8);
    if (r.error) {
      return { clientName, clientId: r.clientId, error: r.error };
    }
    if (r.ok === false) {
      return { clientName, clientId: r.clientId, error: r.reason || "Dispatch failed" };
    }
    return { clientName, clientId: r.clientId, output: "Queued", command: r.command };
  });

  outputContainer.innerHTML = namedResults
    .map((r) => {
      if (r.error) {
        return `<div class="mb-4 pb-4 border-b border-slate-800 last:border-b-0">
        <div class="text-cyan-400 font-semibold mb-2">━━━ ${escapeHtml(
          r.clientName,
        )} (${escapeHtml(r.clientId.substring(0, 8))}) ━━━</div>
        <div class="text-red-400">Error: ${escapeHtml(r.error)}</div>
      </div>`;
      }
      const commandLine = r.command
        ? `<div class="text-slate-400 text-sm mb-2">Command: ${escapeHtml(r.command)}</div>`
        : "";
      return `<div class="mb-4 pb-4 border-b border-slate-800 last:border-b-0">
      <div class="text-cyan-400 font-semibold mb-2">━━━ ${escapeHtml(
        r.clientName,
      )} (${escapeHtml(r.clientId.substring(0, 8))}) ━━━</div>
      ${commandLine}
      <div class="text-slate-100">${escapeHtml(r.output)}</div>
    </div>`;
    })
    .join("");

  executeBtn.disabled = false;
});

if (updateBtn) {
  updateBtn.addEventListener("click", async () => {
    if (selectedClients.size === 0) {
      alert("Please select at least one client");
      return;
    }

    if (!uploaded?.uploadId) {
      alert("Please upload an installer first");
      return;
    }

    if (!confirm("Replace the running agent on selected clients?")) {
      return;
    }

    updateBtn.disabled = true;
    const clientIds = Array.from(selectedClients);
    outputContainer.innerHTML = `<div class="text-blue-400">Dispatching update to ${clientIds.length} client(s)...</div>`;

    let results = [];
    try {
      const res = await fetch("/api/deploy/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uploadId: uploaded.uploadId,
          clientIds,
        }),
      });

      if (!res.ok) {
        results = clientIds.map((clientId) => ({
          clientId,
          error: `HTTP error! status: ${res.status}`,
        }));
      } else {
        const data = await res.json();
        if (!data.ok) {
          results = clientIds.map((clientId) => ({
            clientId,
            error: data.error || "Unknown error",
          }));
        } else {
          results = (data.results || []).map((result) => ({
            clientId: result.clientId,
            ok: result.ok,
            reason: result.reason,
          }));
        }
      }
    } catch (error) {
      results = clientIds.map((clientId) => ({
        clientId,
        error: error.message,
      }));
    }

    const namedResults = results.map((r) => {
      const client = allClients.find((c) => c.id === r.clientId);
      const clientName = client
        ? client.host || r.clientId.substring(0, 8)
        : r.clientId.substring(0, 8);
      if (r.error) {
        return { clientName, clientId: r.clientId, error: r.error };
      }
      if (r.ok === false) {
        return { clientName, clientId: r.clientId, error: r.reason || "Update failed" };
      }
      return { clientName, clientId: r.clientId, output: "Update dispatched" };
    });

    outputContainer.innerHTML = namedResults
      .map((r) => {
        if (r.error) {
          return `<div class="mb-4 pb-4 border-b border-slate-800 last:border-b-0">
          <div class="text-cyan-400 font-semibold mb-2">━━━ ${escapeHtml(
            r.clientName,
          )} (${escapeHtml(r.clientId.substring(0, 8))}) ━━━</div>
          <div class="text-red-400">Error: ${escapeHtml(r.error)}</div>
        </div>`;
        }
        return `<div class="mb-4 pb-4 border-b border-slate-800 last:border-b-0">
        <div class="text-cyan-400 font-semibold mb-2">━━━ ${escapeHtml(
          r.clientName,
        )} (${escapeHtml(r.clientId.substring(0, 8))}) ━━━</div>
        <div class="text-slate-100">${escapeHtml(r.output)}</div>
      </div>`;
      })
      .join("");

    updateBtn.disabled = false;
  });
}

clearOutputBtn.addEventListener("click", () => {
  outputContainer.innerHTML =
    '<div class="text-slate-500">No commands dispatched yet.</div>';
});

checkAuth();
loadClients();
