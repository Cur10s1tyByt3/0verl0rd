import { object, record, safeParse, string, unknown } from "valibot";

export type SharedUiSettings = Record<string, unknown>;

const sharedUiSettingsResponseSchema = object({
  settings: record(string(), unknown()),
});

export async function loadSharedUiSettings(scope: string): Promise<SharedUiSettings> {
  try {
    const res = await fetch(`/api/ui-settings/${encodeURIComponent(scope)}`, {
      credentials: "include",
    });
    if (!res.ok) return {};

    const input: unknown = await res.json().catch(() => null);
    const result = safeParse(sharedUiSettingsResponseSchema, input);
    return result.success ? result.output.settings : {};
  } catch (err) {
    console.warn(`ui-settings: failed to load ${scope}`, err);
    return {};
  }
}

export function createSharedUiSettingsSaver(
  scope: string,
  readSettings: () => SharedUiSettings | null | undefined,
  delayMs = 350,
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastPayload = "";

  async function saveNow(): Promise<void> {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }

    let settings: SharedUiSettings;
    try {
      settings = readSettings() ?? {};
    } catch (err) {
      console.warn(`ui-settings: failed to read ${scope}`, err);
      return;
    }

    const payload = JSON.stringify(settings);
    if (payload === lastPayload) return;
    lastPayload = payload;

    try {
      const res = await fetch(`/api/ui-settings/${encodeURIComponent(scope)}`, {
        method: "PUT",
        credentials: "include",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      });
      if (!res.ok) lastPayload = "";
    } catch (err) {
      lastPayload = "";
      console.warn(`ui-settings: failed to save ${scope}`, err);
    }
  }

  function scheduleSave(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(saveNow, delayMs);
  }

  return { scheduleSave, saveNow };
}
