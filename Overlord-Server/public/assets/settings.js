import {
  getNotificationsEnabled,
  setNotificationsEnabled,
} from "./notify-client.js";

const PREF_REFRESH_KEY = "overlord_refresh_interval_seconds";

const usernameEl = document.getElementById("settings-username");
const roleEl = document.getElementById("settings-role");
const messageEl = document.getElementById("settings-message");

const passwordForm = document.getElementById("password-form");
const currentPasswordInput = document.getElementById("current-password");
const newPasswordInput = document.getElementById("new-password");
const confirmPasswordInput = document.getElementById("confirm-password");
const passwordPolicyHint = document.getElementById("password-policy-hint");

const prefsForm = document.getElementById("prefs-form");
const prefNotificationsInput = document.getElementById("pref-notifications");
const prefRefreshSecondsInput = document.getElementById("pref-refresh-seconds");

const bansTableBody = document.getElementById("bans-table-body");
const bansPermissionNote = document.getElementById("bans-permission-note");
const refreshBansBtn = document.getElementById("refresh-bans-btn");

const securityForm = document.getElementById("security-form");
const securityPermissionNote = document.getElementById("security-permission-note");
const securitySaveBtn = document.getElementById("security-save-btn");
const securitySessionTtlInput = document.getElementById("security-session-ttl");
const securityLoginMaxAttemptsInput = document.getElementById("security-login-max-attempts");
const securityLoginWindowInput = document.getElementById("security-login-window");
const securityLockoutInput = document.getElementById("security-lockout");
const securityPasswordMinInput = document.getElementById("security-password-min");
const securityRequireUppercaseInput = document.getElementById("security-require-uppercase");
const securityRequireLowercaseInput = document.getElementById("security-require-lowercase");
const securityRequireNumberInput = document.getElementById("security-require-number");
const securityRequireSymbolInput = document.getElementById("security-require-symbol");

let currentUser = null;
let securityConfig = null;

function showMessage(text, type = "ok") {
  if (!messageEl) return;
  messageEl.textContent = text;
  messageEl.classList.remove(
    "hidden",
    "text-emerald-200",
    "border-emerald-700",
    "bg-emerald-900/30",
    "text-rose-200",
    "border-rose-700",
    "bg-rose-900/30",
  );

  if (type === "error") {
    messageEl.classList.add("text-rose-200", "border-rose-700", "bg-rose-900/30");
  } else {
    messageEl.classList.add("text-emerald-200", "border-emerald-700", "bg-emerald-900/30");
  }
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text == null ? "" : String(text);
  return div.innerHTML;
}

function formatDate(timestamp) {
  const ts = Number(timestamp) || 0;
  if (!ts) return "-";
  return new Date(ts).toLocaleString();
}

function canManageClientBans(role) {
  return role === "admin" || role === "operator";
}

function isAdmin(role) {
  return role === "admin";
}

function getPasswordRequirementsText() {
  const minLength = Number(securityConfig?.passwordMinLength) || 6;
  const requirements = [`min ${minLength} chars`];
  if (securityConfig?.passwordRequireUppercase) requirements.push("uppercase");
  if (securityConfig?.passwordRequireLowercase) requirements.push("lowercase");
  if (securityConfig?.passwordRequireNumber) requirements.push("number");
  if (securityConfig?.passwordRequireSymbol) requirements.push("symbol");
  return requirements.join(", ");
}

function updatePasswordPolicyUi() {
  const minLength = Number(securityConfig?.passwordMinLength) || 6;
  if (newPasswordInput) {
    newPasswordInput.minLength = minLength;
    newPasswordInput.placeholder = `New password (${getPasswordRequirementsText()})`;
  }
  if (confirmPasswordInput) {
    confirmPasswordInput.minLength = minLength;
  }
  if (passwordPolicyHint) {
    passwordPolicyHint.textContent = `Policy: ${getPasswordRequirementsText()}`;
  }
}

function setSecurityFormDisabled(disabled) {
  const controls = [
    securitySessionTtlInput,
    securityLoginMaxAttemptsInput,
    securityLoginWindowInput,
    securityLockoutInput,
    securityPasswordMinInput,
    securityRequireUppercaseInput,
    securityRequireLowercaseInput,
    securityRequireNumberInput,
    securityRequireSymbolInput,
    securitySaveBtn,
  ];

  for (const control of controls) {
    if (!control) continue;
    control.disabled = disabled;
  }
}

function applySecurityForm() {
  if (!securityConfig) return;
  securitySessionTtlInput.value = String(securityConfig.sessionTtlHours || 168);
  securityLoginMaxAttemptsInput.value = String(securityConfig.loginMaxAttempts || 5);
  securityLoginWindowInput.value = String(securityConfig.loginWindowMinutes || 15);
  securityLockoutInput.value = String(securityConfig.loginLockoutMinutes || 30);
  securityPasswordMinInput.value = String(securityConfig.passwordMinLength || 6);
  securityRequireUppercaseInput.checked = Boolean(securityConfig.passwordRequireUppercase);
  securityRequireLowercaseInput.checked = Boolean(securityConfig.passwordRequireLowercase);
  securityRequireNumberInput.checked = Boolean(securityConfig.passwordRequireNumber);
  securityRequireSymbolInput.checked = Boolean(securityConfig.passwordRequireSymbol);
  updatePasswordPolicyUi();
}

async function loadSecurityPolicy() {
  if (!currentUser) return;

  if (!isAdmin(currentUser.role)) {
    securityPermissionNote.classList.remove("hidden");
    setSecurityFormDisabled(true);
    securityConfig = {
      passwordMinLength: 6,
      passwordRequireUppercase: false,
      passwordRequireLowercase: false,
      passwordRequireNumber: false,
      passwordRequireSymbol: false,
    };
    updatePasswordPolicyUi();
    return;
  }

  securityPermissionNote.classList.add("hidden");

  const res = await fetch("/api/settings/security", { credentials: "include" });
  if (!res.ok) {
    showMessage("Failed to load security settings.", "error");
    setSecurityFormDisabled(true);
    return;
  }

  const data = await res.json().catch(() => ({}));
  securityConfig = data.security || null;
  applySecurityForm();
  setSecurityFormDisabled(false);
}

function loadPrefs() {
  prefNotificationsInput.checked = getNotificationsEnabled();
  const refreshSeconds = Number(localStorage.getItem(PREF_REFRESH_KEY) || 8);
  prefRefreshSecondsInput.value = String(Math.min(120, Math.max(3, refreshSeconds)));
}

async function loadCurrentUser() {
  const res = await fetch("/api/auth/me", { credentials: "include" });
  if (!res.ok) {
    window.location.href = "/login.html";
    return;
  }

  currentUser = await res.json();
  usernameEl.textContent = currentUser.username || "unknown";
  roleEl.textContent = currentUser.role || "unknown";
}

async function updatePassword(event) {
  event.preventDefault();
  if (!currentUser?.userId) return;

  const currentPassword = currentPasswordInput.value;
  const newPassword = newPasswordInput.value;
  const confirmPassword = confirmPasswordInput.value;
  const minLength = Number(securityConfig?.passwordMinLength) || 6;

  if (newPassword.length < minLength) {
    showMessage(`New password must be at least ${minLength} characters.`, "error");
    return;
  }

  if (newPassword !== confirmPassword) {
    showMessage("Password confirmation does not match.", "error");
    return;
  }

  const res = await fetch(`/api/users/${currentUser.userId}/password`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      currentPassword,
      newPassword,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    showMessage(data.error || "Failed to update password.", "error");
    return;
  }

  passwordForm.reset();
  showMessage("Password updated successfully.");
}

function savePrefs(event) {
  event.preventDefault();

  const refreshSeconds = Math.min(
    120,
    Math.max(3, Number(prefRefreshSecondsInput.value || 8)),
  );

  setNotificationsEnabled(prefNotificationsInput.checked);
  localStorage.setItem(PREF_REFRESH_KEY, String(refreshSeconds));
  prefRefreshSecondsInput.value = String(refreshSeconds);

  showMessage("Preferences saved.");
}

async function saveSecurityPolicy(event) {
  event.preventDefault();
  if (!isAdmin(currentUser?.role)) {
    showMessage("Admin role required.", "error");
    return;
  }

  const payload = {
    sessionTtlHours: Number(securitySessionTtlInput.value || 168),
    loginMaxAttempts: Number(securityLoginMaxAttemptsInput.value || 5),
    loginWindowMinutes: Number(securityLoginWindowInput.value || 15),
    loginLockoutMinutes: Number(securityLockoutInput.value || 30),
    passwordMinLength: Number(securityPasswordMinInput.value || 6),
    passwordRequireUppercase: securityRequireUppercaseInput.checked,
    passwordRequireLowercase: securityRequireLowercaseInput.checked,
    passwordRequireNumber: securityRequireNumberInput.checked,
    passwordRequireSymbol: securityRequireSymbolInput.checked,
  };

  const res = await fetch("/api/settings/security", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    showMessage(data.error || "Failed to save security policy.", "error");
    return;
  }

  securityConfig = data.security || payload;
  applySecurityForm();
  showMessage("Security policy updated.");
}

async function loadBannedIps() {
  if (!currentUser) return;

  if (!canManageClientBans(currentUser.role)) {
    bansPermissionNote.classList.remove("hidden");
    refreshBansBtn.disabled = true;
    bansTableBody.innerHTML = `
      <tr>
        <td colspan="4" class="px-3 py-6 text-center text-slate-500">No access</td>
      </tr>
    `;
    return;
  }

  bansPermissionNote.classList.add("hidden");

  const res = await fetch("/api/clients/banned-ips", { credentials: "include" });
  if (!res.ok) {
    bansTableBody.innerHTML = `
      <tr>
        <td colspan="4" class="px-3 py-6 text-center text-rose-300">Failed to load banned IPs</td>
      </tr>
    `;
    return;
  }

  const data = await res.json().catch(() => ({ items: [] }));
  const items = Array.isArray(data.items) ? data.items : [];

  if (items.length === 0) {
    bansTableBody.innerHTML = `
      <tr>
        <td colspan="4" class="px-3 py-6 text-center text-slate-400">No banned IPs</td>
      </tr>
    `;
    return;
  }

  bansTableBody.innerHTML = items
    .map(
      (item) => `
      <tr>
        <td class="px-3 py-2 font-mono text-xs sm:text-sm text-slate-100">${escapeHtml(item.ip)}</td>
        <td class="px-3 py-2 text-slate-300">${escapeHtml(item.reason || "Manual ban")}</td>
        <td class="px-3 py-2 text-slate-400">${formatDate(item.createdAt)}</td>
        <td class="px-3 py-2 text-right">
          <button
            type="button"
            class="unban-btn px-2.5 py-1.5 rounded bg-emerald-700/80 hover:bg-emerald-600 text-white text-xs"
            data-ip="${escapeHtml(item.ip)}"
          >
            <i class="fa-solid fa-unlock mr-1"></i>Unban
          </button>
        </td>
      </tr>
    `,
    )
    .join("");
}

async function handleUnbanClick(event) {
  const button = event.target.closest(".unban-btn");
  if (!button) return;

  const ip = button.dataset.ip;
  if (!ip) return;

  if (!confirm(`Unban ${ip}?`)) return;

  button.disabled = true;
  const res = await fetch(`/api/clients/banned-ips?ip=${encodeURIComponent(ip)}`, {
    method: "DELETE",
    credentials: "include",
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    showMessage(data.error || `Failed to unban ${ip}.`, "error");
    button.disabled = false;
    return;
  }

  showMessage(`Unbanned ${ip}.`);
  await loadBannedIps();
}

async function init() {
  try {
    await loadCurrentUser();
    loadPrefs();
    await loadSecurityPolicy();
    await loadBannedIps();

    passwordForm.addEventListener("submit", updatePassword);
    prefsForm.addEventListener("submit", savePrefs);
    securityForm.addEventListener("submit", saveSecurityPolicy);
    refreshBansBtn.addEventListener("click", loadBannedIps);
    bansTableBody.addEventListener("click", handleUnbanClick);
  } catch (error) {
    console.error("settings init failed", error);
    showMessage("Failed to load settings.", "error");
  }
}

init();
