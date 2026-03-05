import fs from "fs/promises";
import path from "path";
import AdmZip from "adm-zip";
import { v4 as uuidv4 } from "uuid";
import type { ClientInfo } from "../types";
import { logger } from "../logger";
import { encodeMessage, type PluginManifest } from "../protocol";

export type PluginState = {
  enabled: Record<string, boolean>;
  lastError: Record<string, string>;
};

export async function loadPluginStateFromDisk(pluginStatePath: string): Promise<PluginState> {
  try {
    const raw = await fs.readFile(pluginStatePath, "utf-8");
    const parsed = JSON.parse(raw) as { enabled?: Record<string, boolean>; lastError?: Record<string, string> };
    return {
      enabled: parsed.enabled || {},
      lastError: parsed.lastError || {},
    };
  } catch {
    return { enabled: {}, lastError: {} };
  }
}

export async function savePluginStateToDisk(
  pluginRoot: string,
  pluginStatePath: string,
  pluginState: PluginState,
): Promise<void> {
  await fs.mkdir(pluginRoot, { recursive: true });
  await fs.writeFile(pluginStatePath, JSON.stringify(pluginState, null, 2));
}

export async function ensurePluginExtracted(
  pluginRoot: string,
  pluginId: string,
  sanitizePluginId: (name: string) => string,
): Promise<void> {
  const safeId = sanitizePluginId(pluginId);
  const zipPath = path.join(pluginRoot, `${safeId}.zip`);
  const pluginDir = path.join(pluginRoot, safeId);
  const manifestPath = path.join(pluginDir, "manifest.json");

  let zipStat: any = null;
  try {
    zipStat = await fs.stat(zipPath);
  } catch {
    zipStat = null;
  }

  let manifestStat: any = null;
  try {
    manifestStat = await fs.stat(manifestPath);
  } catch {
    manifestStat = null;
  }

  if (!zipStat) {
    if (manifestStat) return;
    throw new Error(`Plugin bundle not found: ${safeId}`);
  }

  if (manifestStat && manifestStat.mtimeMs >= zipStat.mtimeMs) {
    return;
  }

  await fs.mkdir(pluginDir, { recursive: true });
  const assetsDir = path.join(pluginDir, "assets");
  await fs.mkdir(assetsDir, { recursive: true });

  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  let wasmEntry: Buffer | null = null;
  let htmlEntry: Buffer | null = null;
  let cssEntry: Buffer | null = null;
  let jsEntry: Buffer | null = null;

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const base = path.basename(entry.entryName);
    if (base.toLowerCase().endsWith(".wasm")) {
      wasmEntry = entry.getData();
    } else if (base.toLowerCase().endsWith(".html")) {
      htmlEntry = entry.getData();
    } else if (base.toLowerCase().endsWith(".css")) {
      cssEntry = entry.getData();
    } else if (base.toLowerCase().endsWith(".js")) {
      jsEntry = entry.getData();
    }
  }

  if (!wasmEntry || !htmlEntry || !cssEntry || !jsEntry) {
    throw new Error(`Invalid plugin bundle: ${safeId} (missing required files)`);
  }

  await fs.writeFile(path.join(pluginDir, `${safeId}.wasm`), wasmEntry);
  await fs.writeFile(path.join(assetsDir, `${safeId}.html`), htmlEntry);
  await fs.writeFile(path.join(assetsDir, `${safeId}.css`), cssEntry);
  await fs.writeFile(path.join(assetsDir, `${safeId}.js`), jsEntry);

  const manifest: PluginManifest = {
    id: safeId,
    name: safeId,
    version: "1.0.0",
    binary: `${safeId}.wasm`,
    entry: `${safeId}.html`,
    assets: {
      html: `${safeId}.html`,
      css: `${safeId}.css`,
      js: `${safeId}.js`,
    },
  };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
}

export async function syncPluginBundles(
  pluginRoot: string,
  ensureExtracted: (pluginId: string) => Promise<void>,
): Promise<void> {
  await fs.mkdir(pluginRoot, { recursive: true });
  const entries = await fs.readdir(pluginRoot, { withFileTypes: true });
  for (const ent of entries) {
    if (ent.isFile() && ent.name.toLowerCase().endsWith(".zip")) {
      const pluginId = ent.name.slice(0, -4);
      try {
        await ensureExtracted(pluginId);
      } catch (err) {
        logger.warn(`[plugin] failed to extract ${pluginId}: ${(err as Error).message}`);
      }
    }
  }
}

export async function listPluginManifests(
  pluginRoot: string,
  pluginState: PluginState,
  saveState: () => Promise<void>,
  ensureExtracted: (pluginId: string) => Promise<void>,
): Promise<PluginManifest[]> {
  try {
    await syncPluginBundles(pluginRoot, ensureExtracted);
    const entries = await fs.readdir(pluginRoot, { withFileTypes: true });
    const manifests: PluginManifest[] = [];
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const manifestPath = path.join(pluginRoot, ent.name, "manifest.json");
      try {
        const raw = await fs.readFile(manifestPath, "utf-8");
        const manifest = JSON.parse(raw) as PluginManifest;
        const id = manifest.id || ent.name;
        const name = manifest.name || ent.name;
        if (pluginState.enabled[id] === undefined) {
          pluginState.enabled[id] = true;
        }
        manifests.push({ ...manifest, id, name });
      } catch {}
    }
    await saveState();
    return manifests;
  } catch {
    return [];
  }
}

export async function loadPluginBundle(
  pluginRoot: string,
  pluginId: string,
  ensureExtracted: (pluginId: string) => Promise<void>,
): Promise<{ manifest: PluginManifest; wasm: Uint8Array }> {
  await ensureExtracted(pluginId);
  const dir = path.join(pluginRoot, pluginId);
  const manifestPath = path.join(dir, "manifest.json");
  const rawManifest = await fs.readFile(manifestPath, "utf-8");
  const manifest = JSON.parse(rawManifest) as PluginManifest;
  manifest.id = manifest.id || pluginId;
  manifest.name = manifest.name || pluginId;

  const binaryName = manifest.binary || manifest.entry || `${pluginId}.wasm`;
  let wasmPath = path.join(dir, binaryName);
  try {
    await fs.access(wasmPath);
  } catch {
    const files = await fs.readdir(dir);
    const firstWasm = files.find((f) => f.toLowerCase().endsWith(".wasm"));
    if (!firstWasm) throw new Error("No .wasm found for plugin " + pluginId);
    wasmPath = path.join(dir, firstWasm);
  }
  const wasm = new Uint8Array(await fs.readFile(wasmPath));
  return { manifest, wasm };
}

export function sendPluginBundle(
  target: ClientInfo,
  bundle: { manifest: PluginManifest; wasm: Uint8Array },
): void {
  const chunkSize = 16 * 1024;
  const wasm = bundle.wasm;
  const totalChunks = Math.ceil(wasm.length / chunkSize);
  const initPayload = {
    manifest: bundle.manifest,
    size: wasm.length,
    chunks: totalChunks,
  };
  target.ws.send(
    encodeMessage({
      type: "command",
      commandType: "plugin_load_init",
      id: uuidv4(),
      payload: initPayload,
    }),
  );

  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, wasm.length);
    const chunk = wasm.slice(start, end);
    target.ws.send(
      encodeMessage({
        type: "command",
        commandType: "plugin_load_chunk",
        id: uuidv4(),
        payload: { pluginId: bundle.manifest.id, index: i, data: chunk },
      }),
    );
  }

  target.ws.send(
    encodeMessage({
      type: "command",
      commandType: "plugin_load_finish",
      id: uuidv4(),
      payload: { pluginId: bundle.manifest.id },
    }),
  );
}
