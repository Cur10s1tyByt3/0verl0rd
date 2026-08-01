const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const activeAnimations = new WeakMap();
const visibilityIntent = new WeakMap();
let panelSwapSequence = 0;

export function prefersReducedMotion() {
  return reducedMotionQuery.matches;
}

export function animateElement(element, keyframes, options = {}) {
  if (!element || prefersReducedMotion() || typeof element.animate !== "function") {
    return null;
  }

  activeAnimations.get(element)?.cancel();
  const animation = element.animate(keyframes, {
    duration: 220,
    easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
    fill: "none",
    ...options,
  });
  activeAnimations.set(element, animation);
  animation.addEventListener("finish", () => {
    if (activeAnimations.get(element) === animation) activeAnimations.delete(element);
  }, { once: true });
  animation.addEventListener("cancel", () => {
    if (activeAnimations.get(element) === animation) activeAnimations.delete(element);
  }, { once: true });
  return animation;
}

export function revealElement(element, options = {}) {
  if (!element) return null;
  visibilityIntent.set(element, true);
  element.classList.remove("hidden");
  element.removeAttribute("hidden");
  return animateElement(element, [
    { opacity: 0, transform: `translateY(${options.offset ?? 8}px) scale(${options.scale ?? 0.99})` },
    { opacity: 1, transform: "translateY(0) scale(1)" },
  ], { duration: options.duration ?? 220 });
}

export async function concealElement(element, options = {}) {
  if (!element || element.classList.contains("hidden") || element.hasAttribute("hidden")) return false;
  visibilityIntent.set(element, false);
  const animation = animateElement(element, [
    { opacity: 1, transform: "translateY(0) scale(1)" },
    { opacity: 0, transform: `translateY(${options.offset ?? -4}px) scale(${options.scale ?? 0.995})` },
  ], { duration: options.duration ?? 110, easing: "ease-in" });
  if (animation) {
    try { await animation.finished; } catch {}
  }
  if (visibilityIntent.get(element) === false) {
    element.classList.add("hidden");
    return true;
  }
  return false;
}

export async function swapPanels(outgoing, incoming) {
  if (!incoming || outgoing === incoming) return;
  const sequence = ++panelSwapSequence;
  if (outgoing) await concealElement(outgoing, { duration: 90, offset: -3 });
  if (sequence !== panelSwapSequence) return;
  revealElement(incoming, { duration: 190, offset: 6 });
}

export function staggerChildren(container, options = {}) {
  if (!container || prefersReducedMotion()) return;
  const children = Array.from(container.children).slice(0, options.limit ?? 12);
  children.forEach((child, index) => {
    animateElement(child, [
      { opacity: 0, transform: `translateY(${options.offset ?? 7}px)` },
      { opacity: 1, transform: "translateY(0)" },
    ], {
      duration: options.duration ?? 200,
      delay: index * (options.interval ?? 24),
    });
  });
}

export function emphasizeElement(element, tone = "rgba(56, 189, 248, 0.28)") {
  return animateElement(element, [
    { transform: "scale(1)", boxShadow: "0 0 0 0 transparent" },
    { transform: "scale(1.012)", boxShadow: `0 0 0 3px ${tone}` },
    { transform: "scale(1)", boxShadow: "0 0 0 0 transparent" },
  ], { duration: 420, easing: "ease-out" });
}

export function animateTextChange(element) {
  return animateElement(element, [
    { opacity: 0.45, transform: "translateY(3px)" },
    { opacity: 1, transform: "translateY(0)" },
  ], { duration: 160 });
}
