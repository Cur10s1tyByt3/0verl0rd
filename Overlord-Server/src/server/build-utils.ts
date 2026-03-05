import path from "path";

const MUTEX_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-";

export function generateBuildMutex(length = 24): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => MUTEX_CHARS[b % MUTEX_CHARS.length])
    .join("");
}

export function sanitizeMutex(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(trimmed)) {
    throw new Error("Mutex must be 1-64 chars using letters, numbers, '.', '_' or '-' only");
  }
  return trimmed;
}

export function sanitizeOutputName(name: string): string {
  const base = path.basename(name);
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "");
  if (!cleaned || cleaned !== base) {
    throw new Error("Invalid output filename");
  }
  return cleaned;
}
