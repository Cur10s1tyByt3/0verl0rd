import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getConfig, updateBackstageDllConfig } from "../../config";
import { generateToken } from "../../auth";
import { createUser, deleteUser, getUserById } from "../../users";
import { handleMiscRoutes } from "./misc-routes";

const root = `${process.env.TEMP || "."}/overlord-backstage-dll-route-${Date.now().toString(36)}`;
let adminUserId = 0;
let adminToken = "";
let viewerUserId = 0;
let viewerToken = "";

const deps = {
  CORS_HEADERS: {},
  SERVER_VERSION: "3.0.0",
  PUBLIC_ROOT: ".",
  DATA_DIR: root,
  PLUGIN_ROOT: `${root}/plugins`,
  tlsCertPath: `${root}/certs/server.crt`,
  tlsKeyPath: `${root}/certs/server.key`,
  tlsSource: "self-signed" as const,
  requestIP: () => ({ address: "127.0.0.1" }),
  getConsoleSessionCount: () => 0,
  getRdSessionCount: () => 0,
  getFileBrowserSessionCount: () => 0,
  getProcessSessionCount: () => 0,
};

beforeAll(async () => {
  const admin = await createUser(
    `backstage_dll_admin_${Date.now().toString(36)}`,
    "Aa1!BackstageDllAdmin_2026",
    "admin",
    "test",
  );
  if (!admin.success || !admin.userId) throw new Error("failed to create admin test user");
  adminUserId = admin.userId;
  adminToken = await generateToken(getUserById(adminUserId)!);

  const viewer = await createUser(
    `backstage_dll_viewer_${Date.now().toString(36)}`,
    "Aa1!BackstageDllViewer_2026",
    "viewer",
    "test",
  );
  if (!viewer.success || !viewer.userId) throw new Error("failed to create viewer test user");
  viewerUserId = viewer.userId;
  viewerToken = await generateToken(getUserById(viewerUserId)!);

  // Start from a known state so the test is order-independent.
  await updateBackstageDllConfig({ rebuildOnStartup: false });
});

afterAll(async () => {
  await updateBackstageDllConfig({ rebuildOnStartup: false });
  if (adminUserId) deleteUser(adminUserId);
  if (viewerUserId) deleteUser(viewerUserId);
});

describe("backstage DLL settings routes", () => {
  test("GET returns config and current status for any authenticated user", async () => {
    const url = new URL("https://localhost/api/settings/backstage-dll");
    const res = await handleMiscRoutes(
      new Request(url, { headers: { Cookie: `overlord_token=${viewerToken}` } }),
      url,
      deps,
    );
    expect(res?.status).toBe(200);
    const body: any = await res!.json();
    expect(body.backstageDll).toEqual({ rebuildOnStartup: false });
    expect(body.status.outputPath).toBeTruthy();
    expect(typeof body.status.exists).toBe("boolean");
    expect(typeof body.status.building).toBe("boolean");
  });

  test("GET without a session is unauthorized", async () => {
    const url = new URL("https://localhost/api/settings/backstage-dll");
    const res = await handleMiscRoutes(new Request(url), url, deps);
    expect(res?.status).toBe(401);
  });

  test("admin can toggle rebuildOnStartup", async () => {
    const url = new URL("https://localhost/api/settings/backstage-dll");
    const res = await handleMiscRoutes(
      new Request(url, {
        method: "PUT",
        headers: {
          Cookie: `overlord_token=${adminToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ rebuildOnStartup: true }),
      }),
      url,
      deps,
    );
    expect(res?.status).toBe(200);
    const body: any = await res!.json();
    expect(body.backstageDll.rebuildOnStartup).toBe(true);
    expect(getConfig().backstageDll.rebuildOnStartup).toBe(true);
  });

  test("viewer cannot toggle rebuildOnStartup", async () => {
    const url = new URL("https://localhost/api/settings/backstage-dll");
    const res = await handleMiscRoutes(
      new Request(url, {
        method: "PUT",
        headers: {
          Cookie: `overlord_token=${viewerToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ rebuildOnStartup: true }),
      }),
      url,
      deps,
    );
    expect(res?.status).toBe(403);
  });

  test("admin can start a rebuild", async () => {
    const url = new URL("https://localhost/api/settings/backstage-dll/rebuild");
    const res = await handleMiscRoutes(
      new Request(url, {
        method: "POST",
        headers: { Cookie: `overlord_token=${adminToken}` },
      }),
      url,
      deps,
    );
    expect(res?.status).toBe(200);
    const body: any = await res!.json();
    expect(body.ok).toBe(true);
  });

  test("viewer cannot start a rebuild", async () => {
    const url = new URL("https://localhost/api/settings/backstage-dll/rebuild");
    const res = await handleMiscRoutes(
      new Request(url, {
        method: "POST",
        headers: { Cookie: `overlord_token=${viewerToken}` },
      }),
      url,
      deps,
    );
    expect(res?.status).toBe(403);
  });
});