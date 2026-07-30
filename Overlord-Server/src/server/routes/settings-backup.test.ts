import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import AdmZip from "adm-zip";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { generateToken } from "../../auth";
import { generateSelfSignedCert } from "../../certGenerator";
import { createUser, deleteUser, getUserById } from "../../users";
import { handleMiscRoutes } from "./misc-routes";

const root = mkdtempSync(path.join(tmpdir(), "overlord-settings-backup-route-"));
const dataDir = path.join(root, "data");
const pluginRoot = path.join(root, "plugins");
const certPath = path.join(root, "certs", "server.crt");
const keyPath = path.join(root, "certs", "server.key");
let userId = 0;
let token = "";

const deps = {
  CORS_HEADERS: {},
  SERVER_VERSION: "3.0.0",
  PUBLIC_ROOT: ".",
  DATA_DIR: dataDir,
  PLUGIN_ROOT: pluginRoot,
  tlsCertPath: certPath,
  tlsKeyPath: keyPath,
  tlsSource: "self-signed" as const,
  requestIP: () => ({ address: "127.0.0.1" }),
  getConsoleSessionCount: () => 0,
  getRdSessionCount: () => 0,
  getFileBrowserSessionCount: () => 0,
  getProcessSessionCount: () => 0,
};

beforeAll(async () => {
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(pluginRoot, { recursive: true });
  writeFileSync(path.join(dataDir, "save.json"), JSON.stringify({
    auth: { jwtSecret: "route-jwt", agentToken: "route-agent" },
  }));
  await generateSelfSignedCert({ certPath, keyPath, commonName: "localhost" });
  const created = await createUser(
    `backup_route_${Date.now().toString(36)}`,
    "Aa1!PortableBackupRoute_2026",
    "admin",
    "test",
  );
  if (!created.success || !created.userId) throw new Error("failed to create backup route test user");
  userId = created.userId;
  token = await generateToken(getUserById(userId)!);
});

afterAll(() => {
  if (userId) deleteUser(userId);
  rmSync(root, { recursive: true, force: true });
});

describe("portable settings backup routes", () => {
  test("exports a ZIP and accepts it as a staged restore", async () => {
    const exportUrl = new URL("https://localhost/api/settings/export");
    const exportResponse = await handleMiscRoutes(
      new Request(exportUrl, { headers: { Cookie: `overlord_token=${token}` } }),
      exportUrl,
      deps,
    );
    expect(exportResponse?.status).toBe(200);
    expect(exportResponse?.headers.get("content-type")).toBe("application/zip");
    expect(exportResponse?.headers.get("content-disposition")).toContain("overlord-server-backup-");
    expect(exportResponse?.headers.get("cache-control")).toBe("no-store");

    const archive = Buffer.from(await exportResponse!.arrayBuffer());
    const zip = new AdmZip(archive);
    const names = new Set(zip.getEntries().map((entry) => entry.entryName));
    expect(names.has("manifest.json")).toBe(true);
    expect(names.has("data/overlord.db")).toBe(true);
    expect(names.has("data/save.json")).toBe(true);
    expect(names.has("tls/server.crt")).toBe(true);
    expect(names.has("tls/server.key")).toBe(true);

    const importUrl = new URL("https://localhost/api/settings/import");
    const importResponse = await handleMiscRoutes(
      new Request(importUrl, {
        method: "POST",
        headers: {
          Cookie: `overlord_token=${token}`,
          "Content-Type": "application/zip",
        },
        body: Uint8Array.from(archive),
      }),
      importUrl,
      deps,
    );
    expect(importResponse?.status).toBe(200);
    const result = await importResponse!.json() as any;
    expect(result.restartRequired).toBe(true);
    expect(result.applied).toContain("portable server restore staged");
    expect(existsSync(path.join(dataDir, ".pending-server-restore.json"))).toBe(true);
  });
});
