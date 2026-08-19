const CONCISE_PAGE_PATHS = new Set([
  "/build",
  "/deploy",
  "/file-share",
  "/filebrowser",
  "/logs",
  "/metrics",
  "/plugins",
  "/purgatory",
  "/screenshots",
  "/scripts",
  "/settings",
  "/socks5-manager",
  "/sol-publish",
  "/user-client-access",
  "/users",
  "/voice",
  "/winre",
]);

function ensureUiStyles() {
  if (document.querySelector('link[href="/assets/ui.css"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/assets/ui.css";
  const customStyles = document.querySelector('link[href="/assets/custom.css"]');
  if (customStyles) customStyles.before(link);
  else document.head.appendChild(link);
}

function helpIcon(text, subject) {
  const help = document.createElement("span");
  help.className = "ui-help";
  help.tabIndex = 0;
  help.setAttribute("role", "img");
  help.setAttribute("aria-label", `About ${subject}`);
  help.title = text;
  help.innerHTML = '<i class="fa-solid fa-circle-info" aria-hidden="true"></i>';
  return help;
}

function removeRedundantPageIntro(root) {
  if (!CONCISE_PAGE_PATHS.has(window.location.pathname)) return;
  for (const heading of root.querySelectorAll("main h1")) {
    const description = heading.nextElementSibling;
    if (!(description instanceof HTMLParagraphElement)) continue;
    if (description.id || description.closest("[role='alert'], dialog, [role='dialog']")) continue;
    description.remove();
  }
}

function convertSectionDescriptions(root) {
  const descriptions = root.querySelectorAll(
    "main h2 + p.text-slate-400, main h2 + p.text-slate-500",
  );

  for (const description of descriptions) {
    if (!(description instanceof HTMLParagraphElement) || description.dataset.conciseUi === "done") continue;
    if (description.id || description.closest("[role='alert'], dialog, [role='dialog']")) continue;
    if (description.classList.contains("text-amber-400") || description.classList.contains("text-red-400")) continue;

    const heading = description.previousElementSibling;
    if (!(heading instanceof HTMLHeadingElement)) continue;
    const text = description.textContent?.replace(/\s+/g, " ").trim();
    if (!text) continue;

    heading.classList.add("ui-heading-help");
    heading.appendChild(helpIcon(text, heading.textContent?.trim() || "this section"));
    description.dataset.conciseUi = "done";
    description.className = "sr-only";
  }
}

function convertFieldHints(root) {
  if (!new Set(["/build", "/settings"]).has(window.location.pathname)) return;
  const hints = root.querySelectorAll("main p.text-xs.text-slate-500:not([id])");

  for (const hint of hints) {
    if (!(hint instanceof HTMLParagraphElement) || hint.dataset.conciseUi === "done") continue;
    if (hint.classList.contains("uppercase") || hint.closest("[role='alert'], dialog, [role='dialog']")) continue;
    const container = hint.parentElement;
    const control = container?.querySelector("input, select, textarea");
    const text = hint.textContent?.replace(/\s+/g, " ").trim();
    if (!(control instanceof HTMLElement) || !text) continue;

    if (!control.title) control.title = text;
    hint.dataset.conciseUi = "done";
    hint.className = "sr-only";
  }
}

function convertBuildOptionHints(root) {
  if (window.location.pathname !== "/build") return;
  const hints = root.querySelectorAll("main label span.text-xs.text-slate-500");

  for (const hint of hints) {
    if (!(hint instanceof HTMLSpanElement) || hint.dataset.conciseUi === "done") continue;
    const label = hint.closest("label");
    const text = hint.textContent?.replace(/\s+/g, " ").trim();
    if (!label || !text) continue;

    if (!label.title) label.title = text;
    hint.dataset.conciseUi = "done";
    hint.className = "sr-only";
  }
}

export function applyConciseUi(root = document) {
  ensureUiStyles();
  removeRedundantPageIntro(root);
  convertSectionDescriptions(root);
  convertFieldHints(root);
  convertBuildOptionHints(root);
}
