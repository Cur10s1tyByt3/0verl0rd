(function () {
  const start = Date.now();
  const minVisibleMs = 900;
  const state = { progress: 0, done: false, raf: 0 };

  function updateProgress(target) {
    state.progress += (target - state.progress) * 0.08;
    if (state.progress > 99.4 && !state.done) {
      state.progress = 99.4;
    }
    const value = Math.max(0, Math.min(100, Math.floor(state.progress)));
    const pctEl = document.getElementById("app-loader-pct");
    const barEl = document.getElementById("app-loader-bar");
    if (pctEl) pctEl.textContent = `${value}%`;
    if (barEl) barEl.style.width = `${value}%`;
  }

  function loop() {
    const target = state.done ? 100 : 92;
    updateProgress(target);

    if (state.done && state.progress >= 99.7) {
      const root = document.documentElement;
      root.classList.add("app-ready");
      window.setTimeout(() => {
        const overlay = document.getElementById("app-loader");
        overlay?.remove();
      }, 520);
      return;
    }
    state.raf = window.requestAnimationFrame(loop);
  }

  function finish() {
    state.done = true;
    const elapsed = Date.now() - start;
    const wait = Math.max(0, minVisibleMs - elapsed);
    window.setTimeout(() => {
      if (!state.raf) {
        state.raf = window.requestAnimationFrame(loop);
      }
    }, wait);
  }

  document.addEventListener("DOMContentLoaded", () => {
    state.raf = window.requestAnimationFrame(loop);
  });

  window.addEventListener("load", finish, { once: true });
})();
