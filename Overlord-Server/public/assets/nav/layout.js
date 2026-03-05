const MOBILE_BREAKPOINT = 768;

export function createAdaptiveNavController(host, refs) {
  const { toggle, panel, navLinks, navUtility } = refs;
  if (!toggle || !panel || !navLinks || !navUtility) {
    return { applyAdaptiveNavLayout: () => {} };
  }

  const navOverflows = () =>
    panel.scrollWidth > panel.clientWidth + 1 || host.scrollWidth > host.clientWidth + 1;

  function resetInlineStyles() {
    panel.style.display = "";
    panel.style.flexDirection = "";
    panel.style.alignItems = "";
    panel.style.gap = "";
    navLinks.style.flexDirection = "";
    navLinks.style.flexWrap = "";
    navLinks.style.alignItems = "";
    navLinks.style.justifyContent = "";
    navUtility.style.display = "";
    navUtility.style.width = "";
    navUtility.style.justifyContent = "";
    navUtility.style.flexWrap = "";
  }

  function applyAdaptiveNavLayout() {
    if (window.innerWidth < MOBILE_BREAKPOINT) {
      host.dataset.navMode = "mobile";
      panel.classList.add("hidden");
      resetInlineStyles();
      panel.dataset.open = "false";
      toggle.style.display = "";
      toggle.setAttribute("aria-expanded", "false");
      return;
    }

    host.dataset.navMode = "desktop";
    panel.classList.remove("hidden");
    panel.style.display = "flex";
    panel.dataset.open = "true";
    navUtility.style.display = "flex";
    toggle.style.display = "none";
    toggle.setAttribute("aria-expanded", "false");

    if (navOverflows()) {
      host.dataset.navMode = "desktop-compact";
      navUtility.style.display = "none";
      if (navOverflows()) {
        host.dataset.navMode = "compact";
        panel.style.display = "none";
        panel.dataset.open = "false";
        toggle.style.display = "inline-flex";
      }
    }
  }

  function openCompactPanel() {
    panel.dataset.open = "true";
    panel.classList.remove("hidden");
    panel.style.display = "flex";
    panel.style.flexDirection = "column";
    panel.style.alignItems = "stretch";
    panel.style.gap = "10px";

    navLinks.style.flexDirection = "row";
    navLinks.style.flexWrap = "wrap";
    navLinks.style.alignItems = "center";
    navLinks.style.justifyContent = "flex-start";

    navUtility.style.display = "flex";
    navUtility.style.width = "100%";
    navUtility.style.justifyContent = "space-between";
    navUtility.style.flexWrap = "wrap";

    toggle.setAttribute("aria-expanded", "true");
  }

  function closeCompactPanel() {
    panel.dataset.open = "false";
    panel.style.display = "none";
    if (host.dataset.navMode === "mobile") {
      panel.classList.add("hidden");
    }
    toggle.setAttribute("aria-expanded", "false");
  }

  toggle.addEventListener("click", () => {
    const compact =
      host.dataset.navMode === "compact" || host.dataset.navMode === "mobile";
    if (!compact) return;

    const isOpen = panel.dataset.open === "true";
    if (isOpen) {
      closeCompactPanel();
      return;
    }
    openCompactPanel();
  });

  let resizeRaf = null;
  window.addEventListener("resize", () => {
    if (resizeRaf) {
      cancelAnimationFrame(resizeRaf);
    }
    resizeRaf = requestAnimationFrame(() => {
      applyAdaptiveNavLayout();
    });
  });

  applyAdaptiveNavLayout();

  return { applyAdaptiveNavLayout };
}
