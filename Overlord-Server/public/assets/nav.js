import {
  startNotificationClient,
  setNotificationsEnabled,
  getNotificationsEnabled,
  subscribeStatus,
  subscribeUnread,
} from "./notify-client.js";
import { mountNav } from "./nav/template.js";
import { createAdaptiveNavController } from "./nav/layout.js";
import { applyUserRoleUI } from "./nav/role-ui.js";

const host = document.getElementById("top-nav");
if (host) {
  const refs = mountNav(host);
  const { applyAdaptiveNavLayout } = createAdaptiveNavController(host, refs);

  const path = window.location.pathname;
  const activeMap = {
    "/": "nav-clients",
    "/metrics": "metrics-link",
    "/logs": "logs-link",
    "/scripts": "scripts-link",
    "/plugins": "plugins-link",
    "/build": "build-link",
    "/users": "users-link",
    "/notifications": "notifications-link",
  };
  const activeId = activeMap[path];
  if (activeId) {
    const el = document.getElementById(activeId);
    if (el) {
      el.classList.remove("bg-slate-900/70", "text-slate-300");
      el.classList.add("bg-slate-800", "text-slate-50");
      el.classList.add("nav-active");
    }
  }
  if (refs.logoutBtn && !refs.logoutBtn.dataset.boundLogout) {
    refs.logoutBtn.dataset.boundLogout = "true";
    refs.logoutBtn.addEventListener("click", async () => {
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

  const updateToggle = () => {
    const enabled = getNotificationsEnabled();
    if (refs.notifyToggle) {
      refs.notifyToggle.classList.toggle("text-emerald-200", enabled);
      refs.notifyToggle.classList.toggle("border-emerald-500/40", enabled);
      refs.notifyToggle.classList.toggle("text-slate-300", !enabled);
    }
  };

  refs.notifyToggle?.addEventListener("click", () => {
    const next = !getNotificationsEnabled();
    setNotificationsEnabled(next);
    updateToggle();
  });

  subscribeUnread((count) => {
    if (!refs.notifyBadge) return;
    refs.notifyBadge.textContent = String(count);
    refs.notifyBadge.classList.toggle("hidden", count <= 0);
  });

  updateToggle();
  startNotificationClient();
  subscribeStatus((status) => {
    if (status === "connected") {
      // no-op
    }
  });

  async function loadCurrentUser() {
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (!res.ok) {
        return;
      }
      const user = await res.json();
      applyUserRoleUI(user, refs);

      applyAdaptiveNavLayout();
    } catch (err) {
      console.error("Failed to load user:", err);
    }
  }

  if (refs.usernameDisplay && refs.roleBadge) {
    loadCurrentUser();
  }
}
