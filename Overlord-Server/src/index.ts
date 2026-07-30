import { applyPendingServerRestore } from "./server/server-backup";

if (applyPendingServerRestore()) {
  console.log("[restore] Portable server backup applied successfully");
}

await import("./main-server");
