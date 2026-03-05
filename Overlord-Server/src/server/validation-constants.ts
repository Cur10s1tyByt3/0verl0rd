import type { AutoScriptTrigger } from "../db";

export const AUTO_SCRIPT_TRIGGERS = new Set<AutoScriptTrigger>([
  "on_connect",
  "on_first_connect",
  "on_connect_once",
]);

export const ALLOWED_SCRIPT_TYPES = new Set([
  "powershell",
  "bash",
  "cmd",
  "python",
  "sh",
]);

export const ALLOWED_PLATFORMS = new Set([
  "windows-amd64",
  "windows-386",
  "windows-arm64",
  "linux-amd64",
  "linux-arm64",
  "linux-armv7",
  "darwin-amd64",
  "darwin-arm64",
]);
