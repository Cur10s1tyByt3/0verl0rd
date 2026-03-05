import path from "path";
import fs from "fs";

export function resolveRuntimeRoot(cwd: string = process.cwd()): string {
  const explicitRoot = process.env.OVERLORD_ROOT?.trim();
  if (explicitRoot) {
    return path.resolve(explicitRoot);
  }

  if (fs.existsSync(path.join(cwd, "Overlord-Client"))) {
    return cwd;
  }

  return path.resolve(cwd, "..");
}
