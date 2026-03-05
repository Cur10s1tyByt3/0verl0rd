import path from "path";
import { existsSync, mkdirSync } from "fs";

export function resolveDataDir(): string {
  const envDir = process.env.DATA_DIR;
  if (envDir && envDir.trim()) {
    return envDir;
  }

  if (process.platform === "win32" && process.env.APPDATA) {
    return path.join(process.env.APPDATA, "Overlord");
  }

  return "./data";
}

export function ensureDataDir(): string {
  const dir = resolveDataDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}