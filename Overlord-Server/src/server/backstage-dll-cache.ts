import { existsSync, readFileSync, statSync } from "fs";
import path from "path";
import { ensureDataDir } from "../paths";
import { logger } from "../logger";
import { resolveRuntimeRoot } from "./runtime-paths";

export const BACKSTAGE_DLL_NAME = "BackstageInjection.x64.dll";

// Where a freshly rebuilt BackstageInjection DLL is placed. The data dir is
// used so a re-randomized (rebuild) copy survives container restarts and is
// preferred over the image-baked dist-clients copy. Overrideable for unusual
// deployments.
export function backstageDllOutputPath(): string {
  const explicit = process.env.OVERLORD_BACKSTAGE_DLL_PATH?.trim();
  if (explicit) {
    return path.resolve(explicit);
  }
  return path.join(ensureDataDir(), "dist-clients", BACKSTAGE_DLL_NAME);
}

function builtinDllCandidates(): string[] {
  const runtimeRoot = resolveRuntimeRoot();
  return [
    path.resolve(runtimeRoot, "dist-clients", BACKSTAGE_DLL_NAME),
    path.resolve(process.cwd(), "dist-clients", BACKSTAGE_DLL_NAME),
    path.resolve(import.meta.dir, "../../dist-clients", BACKSTAGE_DLL_NAME),
  ];
}

export function injectionDllCandidates(): string[] {
  // Fresh builds land in the data dir first; image-baked dist-clients copies
  // are the offline fallback.
  return [backstageDllOutputPath(), ...builtinDllCandidates()];
}

type DllCacheEntry = { bytes: Uint8Array; path: string; mtimeMs: number };
let dllCache: DllCacheEntry | null = null;

export function invalidateBackstageDll(): void {
  dllCache = null;
}

export function getInjectionDllBytes(): Uint8Array | null {
  const candidates = injectionDllCandidates();

  if (dllCache) {
    // If a freshly rebuilt DLL exists in the data dir but the cache points at
    // an older path, rescan instead of serving stale bytes.
    const freshOutput = backstageDllOutputPath();
    if (path.resolve(dllCache.path) === path.resolve(freshOutput) || !existsSync(freshOutput)) {
      try {
        const st = statSync(dllCache.path);
        if (st.mtimeMs === dllCache.mtimeMs) {
          return dllCache.bytes;
        }
        const bytes = new Uint8Array(readFileSync(dllCache.path));
        dllCache = { bytes, path: dllCache.path, mtimeMs: st.mtimeMs };
        logger.info(`[backstage] reloaded injection DLL from ${dllCache.path} (${bytes.length} bytes)`);
        return bytes;
      } catch {
        dllCache = null;
      }
    } else {
      dllCache = null;
    }
  }

  for (const dllPath of candidates) {
    if (!existsSync(dllPath)) continue;
    try {
      const st = statSync(dllPath);
      const bytes = new Uint8Array(readFileSync(dllPath));
      dllCache = { bytes, path: dllPath, mtimeMs: st.mtimeMs };
      logger.info(`[backstage] loaded injection DLL from ${dllPath} (${bytes.length} bytes)`);
      return bytes;
    } catch {
      continue;
    }
  }

  logger.warn(`[backstage] injection DLL not found. Checked: ${candidates.join(", ")}`);
  return null;
}