import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { generateToken } from "../../auth";
import { createUser, deleteUser, getUserById } from "../../users";
import { handleMiscRoutes } from "./misc-routes";

const password = "Aa1!CertificateDownload_2026";
const tempRoot = mkdtempSync(path.join(tmpdir(), "overlord-cert-download-"));
const certPath = path.join(tempRoot, "server.crt");
const certBody = "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----\n";
let userId = 0;
let token = "";

const deps = {
  CORS_HEADERS: {},
  SERVER_VERSION: "test",
  PUBLIC_ROOT: ".",
  requestIP: () => ({ address: "127.0.0.1" }),
  getConsoleSessionCount: () => 0,
  getRdSessionCount: () => 0,
  getFileBrowserSessionCount: () => 0,
  getProcessSessionCount: () => 0,
  tlsCertPath: certPath,
  tlsSource: "self-signed" as const,
};

beforeAll(async () => {
  writeFileSync(certPath, certBody);
  const created = await createUser(
    `cert_download_${Date.now().toString(36)}`,
    password,
    "admin",
    "test",
  );
  if (!created.success || !created.userId) throw new Error("failed to create certificate test user");
  userId = created.userId;
  token = await generateToken(getUserById(userId)!);
});

afterAll(() => {
  if (userId) deleteUser(userId);
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("active TLS certificate download", () => {
  test("requires authentication", async () => {
    const url = new URL("https://localhost/api/cert/download");
    const response = await handleMiscRoutes(new Request(url), url, deps);
    expect(response?.status).toBe(401);
  });

  test("downloads the active certificate with safe headers", async () => {
    const url = new URL("https://localhost/api/cert/download");
    const response = await handleMiscRoutes(
      new Request(url, { headers: { Cookie: `overlord_token=${token}` } }),
      url,
      deps,
    );

    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-disposition")).toBe(
      'attachment; filename="overlord-server.crt"',
    );
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(response?.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response?.text()).toBe(certBody);
  });
});
