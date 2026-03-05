const clientList = document.getElementById("client-list");
const clientSearch = document.getElementById("client-search");
const osFilter = document.getElementById("os-filter");
const selectAllBtn = document.getElementById("select-all-btn");
const clearSelectionBtn = document.getElementById("clear-selection-btn");
const selectedCountSpan = document.getElementById("selected-count");
const scriptEditor = document.getElementById("script-editor");
const scriptType = document.getElementById("script-type");
const executeBtn = document.getElementById("execute-btn");
const outputContainer = document.getElementById("output-container");
const clearOutputBtn = document.getElementById("clear-output-btn");
const scriptSaveName = document.getElementById("script-save-name");
const saveScriptBtn = document.getElementById("save-script-btn");
const savedScriptsList = document.getElementById("saved-scripts-list");
const autoTaskName = document.getElementById("auto-task-name");
const autoTaskTrigger = document.getElementById("auto-task-trigger");
const autoTaskSaveBtn = document.getElementById("auto-task-save-btn");
const autoTaskCancelBtn = document.getElementById("auto-task-cancel-btn");
const autoTaskList = document.getElementById("auto-task-list");

let allClients = [];
let filteredClients = [];
const selectedClients = new Set();
const SAVED_SCRIPTS_KEY = "overlord_saved_scripts";
let autoTasks = [];
let autoTaskEditingId = null;
let editorInstance = null;

const EDITOR_MODES = {
  powershell: "powershell",
  bash: "shell",
  cmd: "shell",
  python: "python",
  sh: "shell",
};

function getEditorValue() {
  if (editorInstance) return editorInstance.getValue();
  return scriptEditor?.value || "";
}

function setEditorValue(value) {
  if (editorInstance) {
    editorInstance.setValue(value);
    return;
  }
  if (scriptEditor) scriptEditor.value = value;
}

function setEditorMode(type) {
  if (!editorInstance) return;
  const mode = EDITOR_MODES[type] || "powershell";
  editorInstance.setOption("mode", mode);
}

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

    if (data.role === "admin") {
      document.getElementById("metrics-link")?.classList.remove("hidden");
      document.getElementById("scripts-link")?.classList.remove("hidden");
      document.getElementById("build-link")?.classList.remove("hidden");
      document.getElementById("deploy-link")?.classList.remove("hidden");
      document.getElementById("users-link")?.classList.remove("hidden");
      document.getElementById("plugins-link")?.classList.remove("hidden");
    } else if (data.role === "operator") {
      document.getElementById("metrics-link")?.classList.remove("hidden");
      document.getElementById("scripts-link")?.classList.remove("hidden");
      document.getElementById("build-link")?.classList.remove("hidden");
    }

    if (data.role === "viewer") {
      alert("Access denied. Operator or Admin role required.");
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
      clientList.innerHTML = '<div class="p-4 text-center text-slate-500">No online clients available</div>';
      return;
    }

    // Populate OS filter
    const osList = new Set(allClients.map(c => c.os || "unknown"));
    osFilter.innerHTML = '<option value="all">All OS (' + allClients.length + ')</option>' +
      Array.from(osList).sort().map(os => {
        const count = allClients.filter(c => (c.os || "unknown") === os).length;
        return `<option value="${escapeHtml(os)}">${escapeHtml(os)} (${count})</option>`;
      }).join("");

    filterAndRenderClients();
  } catch (error) {
    console.error("Failed to load clients:", error);
    clientList.innerHTML = '<div class="p-4 text-center text-red-400">Error loading clients</div>';
  }
}

function filterAndRenderClients() {
  const searchTerm = clientSearch.value.toLowerCase();
  const osValue = osFilter.value;

  filteredClients = allClients.filter(c => {
    const matchesSearch = !searchTerm || 
      (c.host && c.host.toLowerCase().includes(searchTerm)) ||
      c.id.toLowerCase().includes(searchTerm) ||
      (c.os && c.os.toLowerCase().includes(searchTerm)) ||
      (c.user && c.user.toLowerCase().includes(searchTerm));
    
    const matchesOs = osValue === "all" || (c.os || "unknown") === osValue;
    
    return matchesSearch && matchesOs;
  });

  renderClients();
}

function renderClients() {
  if (filteredClients.length === 0) {
    clientList.innerHTML = '<div class="p-4 text-center text-slate-500">No clients match your filters</div>';
    return;
  }

  clientList.innerHTML = filteredClients.map(c => {
    const name = c.host || c.id.substring(0, 8);
    const os = c.os || "unknown";
    const isSelected = selectedClients.has(c.id);
    
    return `
      <label class="flex items-center gap-3 px-4 py-3 hover:bg-slate-800/50 cursor-pointer border-b border-slate-800 last:border-b-0" data-client-id="${escapeHtml(c.id)}">
        <input type="checkbox" class="client-checkbox w-4 h-4 rounded border-slate-600 bg-slate-700 checked:bg-emerald-600" data-id="${escapeHtml(c.id)}" ${isSelected ? 'checked' : ''}>
        <div class="flex-1 min-w-0">
          <div class="font-semibold text-slate-100 truncate">${escapeHtml(name)}</div>
          <div class="text-sm text-slate-400 flex items-center gap-2">
            <span>${escapeHtml(os)}</span>
            ${c.user ? `<span class="text-slate-500">• ${escapeHtml(c.user)}</span>` : ''}
            <span class="text-slate-600">• ${c.id.substring(0, 8)}</span>
          </div>
        </div>
        <div class="text-emerald-400 text-sm">
          <i class="fa-solid fa-circle text-xs"></i> Online
        </div>
      </label>
    `;
  }).join("");

  clientList.querySelectorAll('.client-checkbox').forEach(cb => {
    cb.addEventListener('change', handleClientToggle);
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
  executeBtn.disabled = selectedClients.size === 0;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function getSavedScripts() {
  try {
    const items = JSON.parse(localStorage.getItem(SAVED_SCRIPTS_KEY) || "[]");
    return Array.isArray(items) ? items : [];
  } catch (err) {
    console.error("Failed to load saved scripts:", err);
    return [];
  }
}

function setSavedScripts(scripts) {
  try {
    const trimmed = scripts.slice(0, 50);
    localStorage.setItem(SAVED_SCRIPTS_KEY, JSON.stringify(trimmed));
  } catch (err) {
    console.error("Failed to save scripts:", err);
  }
}

function renderSavedScripts() {
  const scripts = getSavedScripts().sort((a, b) => b.updatedAt - a.updatedAt);

  if (scripts.length === 0) {
    savedScriptsList.innerHTML = '<div class="text-slate-500 text-sm">No saved scripts yet.</div>';
    return;
  }

  savedScriptsList.innerHTML = scripts.map((s) => {
    return `
      <div class="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-slate-700 bg-slate-800/50">
        <div class="min-w-0">
          <div class="font-semibold text-slate-100 truncate">${escapeHtml(s.name)}</div>
          <div class="text-xs text-slate-400">${escapeHtml(s.type)} • ${new Date(s.updatedAt).toLocaleString()}</div>
        </div>
        <div class="flex items-center gap-2">
          <button class="load-saved-script px-2 py-1 text-xs rounded bg-emerald-600 hover:bg-emerald-700 text-white" data-id="${escapeHtml(s.id)}">
            Load
          </button>
          <button class="delete-saved-script px-2 py-1 text-xs rounded bg-slate-700 hover:bg-slate-600 text-white" data-id="${escapeHtml(s.id)}">
            Delete
          </button>
        </div>
      </div>
    `;
  }).join("");

  savedScriptsList.querySelectorAll(".load-saved-script").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const scripts = getSavedScripts();
      const script = scripts.find((s) => s.id === id);
      if (!script) return;
      setEditorValue(script.content);
      scriptType.value = script.type;
      scriptSaveName.value = script.name;
      setEditorMode(script.type);
      showToast("Script loaded", "success", 3000);
    });
  });

  savedScriptsList.querySelectorAll(".delete-saved-script").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const scripts = getSavedScripts().filter((s) => s.id !== id);
      setSavedScripts(scripts);
      renderSavedScripts();
      showToast("Saved script deleted", "info", 3000);
    });
  });
}

function saveCurrentScript() {
  const name = scriptSaveName.value.trim();
  const content = getEditorValue().trim();
  const type = scriptType.value;

  if (!name) {
    showToast("Please provide a name for the script", "warning", 3000);
    return;
  }

  if (!content) {
    showToast("Script is empty", "warning", 3000);
    return;
  }

  const scripts = getSavedScripts();
  const existing = scripts.find((s) => s.name.toLowerCase() === name.toLowerCase());

  if (existing) {
    const ok = confirm("A script with this name already exists. Overwrite it?");
    if (!ok) return;
    existing.content = content;
    existing.type = type;
    existing.updatedAt = Date.now();
  } else {
    scripts.push({
      id: `script-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      content,
      type,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  setSavedScripts(scripts);
  renderSavedScripts();
  showToast("Script saved", "success", 3000);
}

function triggerLabel(trigger) {
  if (trigger === "on_first_connect") return "On first connect";
  if (trigger === "on_connect_once") return "On connect (once)";
  return "On connect";
}

function resetAutoTaskForm() {
  autoTaskEditingId = null;
  autoTaskName.value = "";
  autoTaskTrigger.value = "on_connect";
  autoTaskCancelBtn.classList.add("hidden");
  autoTaskSaveBtn.innerHTML = '<i class="fa-solid fa-bolt"></i> Save Auto Task';
}

function setAutoTaskForm(task) {
  autoTaskEditingId = task.id;
  autoTaskName.value = task.name || "";
  autoTaskTrigger.value = task.trigger || "on_connect";
  scriptType.value = task.scriptType || "powershell";
  setEditorMode(scriptType.value);
  setEditorValue(task.script || "");
  autoTaskCancelBtn.classList.remove("hidden");
  autoTaskSaveBtn.innerHTML = '<i class="fa-solid fa-pen"></i> Update Auto Task';
}

async function loadAutoTasks() {
  if (!autoTaskList) return;
  try {
    const res = await fetch("/api/auto-scripts");
    if (!res.ok) throw new Error("Failed to load auto tasks");
    const data = await res.json();
    autoTasks = Array.isArray(data.items) ? data.items : [];
    renderAutoTasks();
  } catch (err) {
    console.error("Failed to load auto tasks:", err);
    autoTaskList.innerHTML = '<div class="text-red-400 text-sm">Error loading auto tasks</div>';
  }
}

function renderAutoTasks() {
  if (!autoTaskList) return;
  if (autoTasks.length === 0) {
    autoTaskList.innerHTML = '<div class="text-slate-500 text-sm">No auto tasks yet.</div>';
    return;
  }

  autoTaskList.innerHTML = autoTasks
    .map((task) => {
      return `
        <div class="flex items-start justify-between gap-2 px-3 py-2 rounded-lg border border-slate-700 bg-slate-800/50">
          <div class="min-w-0">
            <div class="font-semibold text-slate-100 truncate">${escapeHtml(task.name)}</div>
            <div class="text-xs text-slate-400">${escapeHtml(triggerLabel(task.trigger))} • ${escapeHtml(task.scriptType)}</div>
          </div>
          <div class="flex items-center gap-2">
            <label class="flex items-center gap-1 text-xs text-slate-400">
              <input type="checkbox" class="auto-task-toggle w-4 h-4" data-id="${escapeHtml(task.id)}" ${task.enabled ? "checked" : ""}>
              Enabled
            </label>
            <button class="auto-task-edit px-2 py-1 text-xs rounded bg-emerald-600 hover:bg-emerald-700 text-white" data-id="${escapeHtml(task.id)}">
              Edit
            </button>
            <button class="auto-task-delete px-2 py-1 text-xs rounded bg-slate-700 hover:bg-slate-600 text-white" data-id="${escapeHtml(task.id)}">
              Delete
            </button>
          </div>
        </div>
      `;
    })
    .join("");

  autoTaskList.querySelectorAll(".auto-task-toggle").forEach((toggle) => {
    toggle.addEventListener("change", async () => {
      const id = toggle.dataset.id;
      const enabled = toggle.checked;
      try {
        const res = await fetch(`/api/auto-scripts/${id}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled }),
          });
        if (!res.ok) throw new Error("Update failed");
        showToast(`Auto task ${enabled ? "enabled" : "disabled"}`, "success", 2500);
        loadAutoTasks();
      } catch (err) {
        console.error("Failed to update auto task:", err);
        showToast("Failed to update auto task", "error", 3000);
        toggle.checked = !enabled;
      }
    });
  });

  autoTaskList.querySelectorAll(".auto-task-edit").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const task = autoTasks.find((t) => t.id === id);
      if (!task) return;
      setAutoTaskForm(task);
    });
  });

  autoTaskList.querySelectorAll(".auto-task-delete").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const task = autoTasks.find((t) => t.id === id);
      const ok = confirm(`Delete auto task "${task?.name || ""}"?`);
      if (!ok) return;
      try {
        const res = await fetch(`/api/auto-scripts/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error("Delete failed");
        showToast("Auto task deleted", "info", 2500);
        if (autoTaskEditingId === id) resetAutoTaskForm();
        loadAutoTasks();
      } catch (err) {
        console.error("Failed to delete auto task:", err);
        showToast("Failed to delete auto task", "error", 3000);
      }
    });
  });
}

async function saveAutoTask() {
  if (!autoTaskName || !autoTaskTrigger || !scriptType) return;
  const name = autoTaskName.value.trim();
  const trigger = autoTaskTrigger.value;
  const scriptTypeValue = scriptType.value;
  const script = getEditorValue();

  if (!name) {
    showToast("Please provide a task name", "warning", 3000);
    return;
  }
  if (!script.trim()) {
    showToast("Script is empty", "warning", 3000);
    return;
  }

  autoTaskSaveBtn.disabled = true;
  try {
    const payload = { name, trigger, script, scriptType: scriptTypeValue };
    const res = await fetch(autoTaskEditingId ? `/api/auto-scripts/${autoTaskEditingId}` : "/api/auto-scripts", {
      method: autoTaskEditingId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("Save failed");
    showToast(autoTaskEditingId ? "Auto task updated" : "Auto task created", "success", 2500);
    resetAutoTaskForm();
    loadAutoTasks();
  } catch (err) {
    console.error("Failed to save auto task:", err);
    showToast("Failed to save auto task", "error", 3000);
  } finally {
    autoTaskSaveBtn.disabled = false;
  }
}

clientSearch.addEventListener("input", filterAndRenderClients);
osFilter.addEventListener("change", filterAndRenderClients);

selectAllBtn.addEventListener("click", () => {
  filteredClients.forEach(c => selectedClients.add(c.id));
  renderClients();
});

clearSelectionBtn.addEventListener("click", () => {
  selectedClients.clear();
  renderClients();
});

document.querySelectorAll(".template-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const script = btn.dataset.script;
    const type = btn.dataset.type;
    setEditorValue(script);
    scriptType.value = type;
    setEditorMode(type);
  });
});

executeBtn.addEventListener("click", async () => {
  if (selectedClients.size === 0) {
    alert("Please select at least one client");
    return;
  }

  const script = getEditorValue().trim();
  if (!script) {
    alert("Please enter a script to execute");
    return;
  }

  executeBtn.disabled = true;
  const clientIds = Array.from(selectedClients);
  outputContainer.innerHTML = `<div class="text-blue-400">Executing script on ${clientIds.length} client(s)...</div>`;

  const results = [];
  
  for (const clientId of clientIds) {
    const client = allClients.find(c => c.id === clientId);
    const clientName = client ? (client.host || clientId.substring(0, 8)) : clientId.substring(0, 8);
    
    try {
      const res = await fetch(`/api/clients/${clientId}/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "script_exec",
          script: script,
          scriptType: scriptType.value,
        }),
      });

      if (!res.ok) {
        results.push({ clientName, clientId, error: `HTTP error! status: ${res.status}` });
        continue;
      }

      const data = await res.json();
      if (!data.ok) {
        results.push({ clientName, clientId, error: data.error || "Unknown error" });
        continue;
      }
      
      results.push({ clientName, clientId, output: data.result || "(no output)" });
    } catch (error) {
      results.push({ clientName, clientId, error: error.message });
    }
  }
  
  outputContainer.innerHTML = results.map(r => {
    if (r.error) {
      return `<div class="mb-4 pb-4 border-b border-slate-800 last:border-b-0">
        <div class="text-emerald-400 font-semibold mb-2">━━━ ${escapeHtml(r.clientName)} (${escapeHtml(r.clientId.substring(0, 8))}) ━━━</div>
        <div class="text-red-400">Error: ${escapeHtml(r.error)}</div>
      </div>`;
    }
    return `<div class="mb-4 pb-4 border-b border-slate-800 last:border-b-0">
      <div class="text-emerald-400 font-semibold mb-2">━━━ ${escapeHtml(r.clientName)} (${escapeHtml(r.clientId.substring(0, 8))}) ━━━</div>
      <div class="text-slate-100">${escapeHtml(r.output)}</div>
    </div>`;
  }).join("");
  
  executeBtn.disabled = false;
});

clearOutputBtn.addEventListener("click", () => {
  outputContainer.innerHTML =
    '<div class="text-slate-500">No output yet. Execute a script to see results.</div>';
});

saveScriptBtn?.addEventListener("click", saveCurrentScript);
scriptSaveName?.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    saveCurrentScript();
  }
});

autoTaskSaveBtn?.addEventListener("click", saveAutoTask);
autoTaskCancelBtn?.addEventListener("click", resetAutoTaskForm);

scriptType?.addEventListener("change", () => {
  setEditorMode(scriptType.value);
});

checkAuth();
loadClients();
renderSavedScripts();
loadAutoTasks();

if (window.CodeMirror && scriptEditor) {
  editorInstance = window.CodeMirror.fromTextArea(scriptEditor, {
    lineNumbers: true,
    mode: EDITOR_MODES[scriptType?.value || "powershell"] || "powershell",
    theme: "material-darker",
    indentUnit: 2,
    tabSize: 2,
    lineWrapping: true,
  });
  editorInstance.setSize(null, "100%");
}
