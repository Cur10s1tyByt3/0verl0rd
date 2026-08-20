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
  if (explicit) return path.resolve(explicit);
  return path.join(ensureDataDir(), "dist-clients", BACKSTAGE_DLL_NAME);
}

function builtinDllCandidates(): string[] {
  const runtimeRoot = resolveRuntimeRoot();
  return [
    path.resolve(runtimeRoot, "dist-clients", BACKSTAGE_DLL_NAME),
    path.resolve(process.cwd(), "dist-clients", BACKSTAGE_DLL_NAME),
    path.resolve(import.meta.dir, "../../dist-clients/BackstageInjection.x64.dll"),
  ];
}

export function injectionDllCandidates(): string[] {
  // Fresh builds land in the data dir first; image-baked dist-clients copies
  // are the offline fallback.
  return [backstageDllOutputPath(), ...builtinDllCandidates()];
}

let _cachedInjectionDll: Uint8Array | null = null;
let _dllCachePath: string | null = null;
let _dllCacheMtimeMs: number = 0;

export function invalidateBackstageDll(): void {
  _cachedInjectionDll = null;
  _dllCachePath = null;
  _dllCacheMtimeMs = 0;
}

export function getInjectionDllBytes(): Uint8Array | null {
  const candidates = injectionDllCandidates();

  if (_dllCachePath) {
    // If a freshly rebuilt DLL exists in the data dir but the cache points at
    // an older path, rescan instead of serving stale bytes.
    const freshOutput = backstageDllOutputPath();
    if (path.resolve(_dllCachePath) === path.resolve(freshOutput) || !existsSync(freshOutput)) {
      try {
        const st = statSync(_dllCachePath);
        if (st.mtimeMs === _dllCacheMtimeMs && _cachedInjectionDll) {
          return _cachedInjectionDll;
        }
        _cachedInjectionDll = new Uint8Array(readFileSync(_dllCachePath));
        _dllCacheMtimeMs = st.mtimeMs;
        logger.info(`[backstage] reloaded injection DLL from ${_dllCachePath} (${_cachedInjectionDll.length} bytes)`);
        return _cachedInjectionDll;
      } catch {
        _dllCachePath = null;
        _cachedInjectionDll = null;
      }
    } else {
      _dllCachePath = null;
      _cachedInjectionDll = null;
    }
  }

  for (const dllPath of candidates) {
    if (!existsSync(dllPath)) continue;
    try {
      const st = statSync(dllPath);
      _cachedInjectionDll = new Uint8Array(readFileSync(dllPath));
      _dllCachePath = dllPath;
      _dllCacheMtimeMs = st.mtimeMs;
      logger.info(`[backstage] loaded injection DLL from ${dllPath} (${_cachedInjectionDll.length} bytes)`);
      return _cachedInjectionDll;
    } catch {
      continue;
    }
  }

  logger.warn(`[backstage] injection DLL not found. Checked: ${candidates.join(", ")}`);
  return null;
}