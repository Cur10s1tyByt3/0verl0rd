import path from "path";

export function sanitizePluginId(name: string): string {
  const cleaned = path.basename(name).replace(/[^A-Za-z0-9._-]/g, "");
  if (!cleaned) {
    throw new Error("Invalid plugin id");
  }
  return cleaned;
}
