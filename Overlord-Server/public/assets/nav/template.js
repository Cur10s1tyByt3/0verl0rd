export function mountNav(host) {
  host.className =
    "sticky top-0 z-10 w-full px-5 py-3 bg-slate-950/80 backdrop-blur border-b border-slate-800";

  host.innerHTML = `
    <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3 w-full">
      <div class="flex items-center justify-between gap-3">
        <a href="/" class="flex items-center gap-2 font-semibold tracking-wide">
          <i class="fa-solid fa-crown header-crown"></i> Overlord
        </a>
        <button
          id="nav-toggle"
          class="md:hidden inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800/70 border border-slate-700"
          aria-expanded="false"
          aria-controls="nav-panel"
        >
          <i class="fa-solid fa-bars"></i>
          <span>Menu</span>
        </button>
      </div>
      <div
        id="nav-panel"
        class="hidden md:flex md:flex-1 md:items-center md:justify-between gap-3"
      >
      <nav id="nav-links" class="flex flex-wrap items-center gap-2 md:flex-1 md:justify-center">
        <a
          href="/"
          id="nav-clients"
          class="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900/70 border border-slate-800 hover:bg-slate-800 text-slate-300 transition-colors"
          ><i class="fa-solid fa-display text-sky-400"></i> Clients</a
        >
        <a
          href="/metrics"
          id="metrics-link"
          class="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900/70 border border-slate-800 hover:bg-slate-800 text-slate-300 transition-colors"
          ><i class="fa-solid fa-chart-line text-emerald-400"></i> Metrics</a
        >
        <a
          href="/logs"
          id="logs-link"
          class="hidden inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900/70 border border-slate-800 hover:bg-slate-800 text-slate-300 transition-colors"
          ><i class="fa-solid fa-clipboard-list text-amber-400"></i> Logs</a
        >
        <a
          href="/scripts"
          id="scripts-link"
          class="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900/70 border border-slate-800 hover:bg-slate-800 text-slate-300 transition-colors"
          ><i class="fa-solid fa-code text-cyan-400"></i> Scripts</a
        >
        <a
          href="/plugins"
          id="plugins-link"
          class="hidden inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900/70 border border-slate-800 hover:bg-slate-800 text-slate-300 transition-colors"
          ><i class="fa-solid fa-puzzle-piece text-violet-400"></i> Plugins</a
        >
        <a
          href="/build"
          id="build-link"
          class="hidden inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900/70 border border-slate-800 hover:bg-slate-800 text-slate-300 transition-colors"
          ><i class="fa-solid fa-hammer text-orange-400"></i> Builder</a
        >
        <a
          href="/notifications"
          id="notifications-link"
          class="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900/70 border border-slate-800 hover:bg-slate-800 text-slate-300 transition-colors"
          ><i class="fa-solid fa-bell text-yellow-400"></i> Notifications</a
        >
        <a
          href="/users"
          id="users-link"
          class="hidden inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900/70 border border-slate-800 hover:bg-slate-800 text-slate-300 transition-colors"
          ><i class="fa-solid fa-users text-indigo-400"></i> Users</a
        >
      </nav>
      <div id="nav-utility" class="flex flex-wrap items-center gap-2 md:w-auto md:justify-end md:shrink-0">
        <button
          id="notify-toggle"
          class="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900/70 border border-slate-800 text-slate-300 hover:bg-slate-800"
          title="Toggle notifications"
          aria-label="Toggle notifications"
        >
          <i class="fa-solid fa-bell"></i>
          <span
            id="notify-badge"
            class="hidden min-w-[20px] h-5 px-1 rounded-full bg-rose-500 text-white text-xs flex items-center justify-center"
          ></span>
        </button>
        <div
          class="inline-flex items-center gap-2 px-3 py-2 rounded-full bg-slate-800 text-slate-100 min-w-0 max-w-full md:max-w-none"
        >
          <i class="fa-solid fa-user-shield text-sky-300"></i>
          <span id="username-display" class="truncate max-w-[110px] sm:max-w-[180px] md:max-w-none">Loading...</span>
          <span
            id="role-badge"
            class="text-sm px-2 py-0.5 rounded-full bg-slate-700 shrink-0"
          ></span>
        </div>
        <button
          id="logout-btn"
          class="group inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-red-900/40 hover:bg-red-800/60 text-red-100 border border-red-700/60 transition-colors"
          title="Logout"
          aria-label="Logout"
        >
          <i class="fa-solid fa-right-from-bracket text-rose-300 group-hover:text-rose-200 transition-colors"></i>
        </button>
      </div>
      </div>
    </div>
  `;

  return {
    toggle: document.getElementById("nav-toggle"),
    panel: document.getElementById("nav-panel"),
    navLinks: document.getElementById("nav-links"),
    navUtility: document.getElementById("nav-utility"),
    logoutBtn: document.getElementById("logout-btn"),
    notifyToggle: document.getElementById("notify-toggle"),
    notifyBadge: document.getElementById("notify-badge"),
    usernameDisplay: document.getElementById("username-display"),
    roleBadge: document.getElementById("role-badge"),
    usersLink: document.getElementById("users-link"),
    buildLink: document.getElementById("build-link"),
    pluginsLink: document.getElementById("plugins-link"),
    scriptsLink: document.getElementById("scripts-link"),
    logsLink: document.getElementById("logs-link"),
  };
}
