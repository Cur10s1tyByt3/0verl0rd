const EASTER_EGG_ENABLED_KEY = "overlord_easter_egg_enabled";
const EASTER_EGG_SHOWN_KEY = "overlord_easter_egg_shown";
const EASTER_EGG_URL = "/assets/console.gif";

let activeRender = null;

export function isEasterEggEnabled() {
  try {
    return localStorage.getItem(EASTER_EGG_ENABLED_KEY) === "true";
  } catch {
    return false;
  }
}

export function setEasterEggEnabled(enabled) {
  try {
    localStorage.setItem(EASTER_EGG_ENABLED_KEY, String(Boolean(enabled)));
  } catch {}

  if (!enabled) {
    try {
      sessionStorage.removeItem(EASTER_EGG_SHOWN_KEY);
    } catch {}
  }
}

function wasShownThisSession() {
  try {
    return sessionStorage.getItem(EASTER_EGG_SHOWN_KEY) === "true";
  } catch {
    return false;
  }
}

function markShownThisSession() {
  try {
    sessionStorage.setItem(EASTER_EGG_SHOWN_KEY, "true");
  } catch {}
}

export async function showEnabledEasterEgg({ force = false } = {}) {
  if (!isEasterEggEnabled() || (!force && wasShownThisSession())) return false;
  if (activeRender) return activeRender;

  activeRender = (async () => {
    const response = await fetch(EASTER_EGG_URL);
    if (!response.ok) throw new Error(`Easter egg failed to load (${response.status})`);

    const blob = await response.blob();
    if (!blob.type.startsWith("image/")) throw new Error("Easter egg response was not an image");

    const objectUrl = URL.createObjectURL(blob);
    console.log(
      "%c     ",
      `background:url("${objectUrl}") left top/contain no-repeat;font-size:320px;background-color:transparent`,
    );
    markShownThisSession();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
    return true;
  })().finally(() => {
    activeRender = null;
  });

  return activeRender;
}
