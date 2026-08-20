import { existsSync, readFileSync, statSync } from "fs";
import path from "path";
import { ensureDataDir } from "../paths";
import { logger } from "../logger";
import { resolveRuntimeRoot } from "./runtime-paths";

export const BACKSTAGE_DLL_NAME = "BackstageInjection.x64.dll";
export const BACKSTAGE_LEGACY_DLL_NAME = "BackstageInjection.legacy.x64.dll";

// Where a freshly rebuilt BackstageInjection DLL is placed. The data dir is
// used so a re-randomized (rebuild) copy survives container restarts and is
// preferred over the image-baked dist-clients copy. Overrideable for unusual
// deployments.
export function backstageDllOutputPath(commandVersion = 2): string {
  const explicit = process.env.OVERLORD_BACKSTAGE_DLL_PATH?.trim();
  if (explicit) {
    const resolved = path.resolve(explicit);
    return commandVersion === 1
      ? path.join(path.dirname(resolved), BACKSTAGE_LEGACY_DLL_NAME)
      : resolved;
  }
  const name = commandVersion === 1 ? BACKSTAGE_LEGACY_DLL_NAME : BACKSTAGE_DLL_NAME;
  return path.join(ensureDataDir(), "dist-clients", name);
}

function builtinDllCandidates(commandVersion: number): string[] {
  const runtimeRoot = resolveRuntimeRoot();
  const name = commandVersion === 1 ? BACKSTAGE_LEGACY_DLL_NAME : BACKSTAGE_DLL_NAME;
  return [
    path.resolve(runtimeRoot, "dist-clients", name),
    path.resolve(process.cwd(), "dist-clients", name),
    path.resolve(import.meta.dir, "../../dist-clients", name),
  ];
}

export function injectionDllCandidates(commandVersion = 2): string[] {
  // Fresh builds land in the data dir first; image-baked dist-clients copies
  // are the offline fallback.
  return [backstageDllOutputPath(commandVersion), ...builtinDllCandidates(commandVersion)];
}

type DllCacheEntry = { bytes: Uint8Array; path: string; mtimeMs: number };
const dllCache = new Map<number, DllCacheEntry>();

export function invalidateBackstageDll(): void {
  dllCache.clear();
}

export function getInjectionDllBytes(commandVersion = 2): Uint8Array | null {
  const artifactVersion = commandVersion === 1 ? 1 : 2;
  const candidates = injectionDllCandidates(artifactVersion);
  const cached = dllCache.get(artifactVersion);

  if (cached) {
    // If a freshly rebuilt DLL exists in the data dir but the cache points at
    // an older path, rescan instead of serving stale bytes.
    const freshOutput = backstageDllOutputPath(artifactVersion);
    if (path.resolve(cached.path) === path.resolve(freshOutput) || !existsSync(freshOutput)) {
      try {
        const st = statSync(cached.path);
        if (st.mtimeMs === cached.mtimeMs) {
          return cached.bytes;
        }
        const bytes = new Uint8Array(readFileSync(cached.path));
        dllCache.set(artifactVersion, { bytes, path: cached.path, mtimeMs: st.mtimeMs });
        logger.info(`[backstage] reloaded v${artifactVersion} injection DLL from ${cached.path} (${bytes.length} bytes)`);
        return bytes;
      } catch {
        dllCache.delete(artifactVersion);
      }
    } else {
      dllCache.delete(artifactVersion);
    }
  }

  for (const dllPath of candidates) {
    if (!existsSync(dllPath)) continue;
    try {
      const st = statSync(dllPath);
      const bytes = new Uint8Array(readFileSync(dllPath));
      dllCache.set(artifactVersion, { bytes, path: dllPath, mtimeMs: st.mtimeMs });
      logger.info(`[backstage] loaded v${artifactVersion} injection DLL from ${dllPath} (${bytes.length} bytes)`);
      return bytes;
    } catch {
      continue;
    }
  }

  logger.warn(`[backstage] v${artifactVersion} injection DLL not found. Checked: ${candidates.join(", ")}`);
  return null;
}
