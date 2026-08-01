import { afterEach, describe, expect, test } from "bun:test";
import { generateToken } from "../../auth";
import { AuditAction, flushAuditLogsSync, getAuditLogs } from "../../auditLog";
import {
  createUser,
  deleteUser,
  deletePermissionGroup,
  getUserById,
  setUserGroups,
} from "../../users";
import { createHttpFetchHandler } from "../http-dispatch";
import { createHonoRouteHandler } from "../hono-router";
import { handlePermissionGroupsRoutes } from "./permission-groups-routes";
import { handleUsersRoutes } from "./users-routes";

const PASSWORD = "Aa1!PgRoutesTestPassword";

const mockServer = {
  requestIP: () => ({ address: "127.0.0.1" }),
};

const createdUserIds: number[] = [];
const createdGroupIds: number[] = [];

async function tempUser(role: "admin" | "operator" | "viewer") {
  const username = `pgr_${role.slice(0, 3)}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const result = await createUser(username, PASSWORD, role, "test");
  expect(result.success).toBe(true);
  const user = getUserById(result.userId!);
  expect(user).not.toBeNull();
  createdUserIds.push(user!.id);
  const token = await generateToken(user!);
  return { user: user!, token };
}

function call(method: string, path: string, token: string | null, body?: unknown) {
  const url = new URL(`https://localhost${path}`);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return handlePermissionGroupsRoutes(
    new Request(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    url,
    mockServer,
  );
}

function callThroughServerRoutes(method: string, path: string, token: string | null, body?: unknown) {
  const url = new URL(`https://localhost${path}`);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const handler = createHttpFetchHandler({
    metrics: { withHttpMetrics: (fn) => fn() },
    CORS_HEADERS: {},
    routes: [
      createHonoRouteHandler([{
        basePath: "/api/users",
        handler: (req, routeUrl, server) => handleUsersRoutes(req, routeUrl, server as typeof mockServer),
      }]),
      (req, routeUrl, server) => handlePermissionGroupsRoutes(req, routeUrl, server as typeof mockServer),
    ],
  });
  return handler(
    new Request(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    mockServer,
  );
}

afterEach(() => {
  while (createdGroupIds.length > 0) {
    const id = createdGroupIds.pop();
    if (typeof id === "number") deletePermissionGroup(id);
  }
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop();
    if (typeof id === "number") deleteUser(id);
  }
});

describe("permission-groups routes — auth gate", () => {
  test("operator gets 403 from GET /api/permissions", async () => {
    const op = await tempUser("operator");
    const res = await call("GET", "/api/permissions", op.token);
    expect(res!.status).toBe(403);
  });

  test("operator gets 403 from GET /api/permission-groups", async () => {
    const op = await tempUser("operator");
    const res = await call("GET", "/api/permission-groups", op.token);
    expect(res!.status).toBe(403);
  });

  test("operator gets 403 from POST /api/permission-groups", async () => {
    const op = await tempUser("operator");
    const res = await call("POST", "/api/permission-groups", op.token, {
      name: "shouldnt-work",
      permissions: ["clients:metadata"],
    });
    expect(res!.status).toBe(403);
  });

  test("unauthenticated request returns 401", async () => {
    const res = await call("GET", "/api/permission-groups", null);
    expect(res!.status).toBe(401);
  });
});

describe("permission-groups routes — list permissions catalog", () => {
  test("admin can list known permissions with descriptions", async () => {
    const admin = await tempUser("admin");
    const res = await call("GET", "/api/permissions", admin.token);
    expect(res!.status).toBe(200);
    const body = await res!.json();
    expect(Array.isArray(body.permissions)).toBe(true);
    const ids = new Set(body.permissions.map((p: any) => p.id));
    // Spot-check a few permissions we know exist.
    expect(ids.has("clients:disconnect")).toBe(true);
    expect(ids.has("clients:metadata")).toBe(true);
    expect(ids.has("system:configure")).toBe(true);
    // Each entry must have a non-empty description.
    for (const p of body.permissions) {
      expect(typeof p.description).toBe("string");
      expect(p.description.length).toBeGreaterThan(0);
    }
  });
});

describe("permission-groups routes — group CRUD", () => {
  test("create → list → fetch by id round trip", async () => {
    const admin = await tempUser("admin");

    const createRes = await call("POST", "/api/permission-groups", admin.token, {
      name: `crud_${Date.now().toString(36)}`,
      description: "test group",
      permissions: ["clients:metadata", "clients:disconnect"],
    });
    expect(createRes!.status).toBe(200);
    const created = await createRes!.json();
    expect(created.group.id).toBeGreaterThan(0);
    createdGroupIds.push(created.group.id);
    expect(created.group.permissions.sort()).toEqual(["clients:disconnect", "clients:metadata"]);

    const listRes = await call("GET", "/api/permission-groups", admin.token);
    const list = await listRes!.json();
    expect(list.groups.some((g: any) => g.id === created.group.id)).toBe(true);

    const getRes = await call("GET", `/api/permission-groups/${created.group.id}`, admin.token);
    expect(getRes!.status).toBe(200);
    const fetched = await getRes!.json();
    expect(fetched.group.permissions.sort()).toEqual(["clients:disconnect", "clients:metadata"]);
  });

  test("PATCH replaces permissions", async () => {
    const admin = await tempUser("admin");
    const createRes = await call("POST", "/api/permission-groups", admin.token, {
      name: `patch_${Date.now().toString(36)}`,
      permissions: ["clients:metadata"],
    });
    const created = await createRes!.json();
    createdGroupIds.push(created.group.id);

    const patchRes = await call("PATCH", `/api/permission-groups/${created.group.id}`, admin.token, {
      permissions: ["clients:uninstall"],
    });
    expect(patchRes!.status).toBe(200);
    const patched = await patchRes!.json();
    expect(patched.group.permissions).toEqual(["clients:uninstall"]);
  });

  test("DELETE removes the group", async () => {
    const admin = await tempUser("admin");
    const createRes = await call("POST", "/api/permission-groups", admin.token, {
      name: `del_${Date.now().toString(36)}`,
      permissions: [],
    });
    const created = await createRes!.json();

    const delRes = await call("DELETE", `/api/permission-groups/${created.group.id}`, admin.token);
    expect(delRes!.status).toBe(200);

    const getRes = await call("GET", `/api/permission-groups/${created.group.id}`, admin.token);
    expect(getRes!.status).toBe(404);
  });

  test("rejects unknown permissions during creation (silent strip)", async () => {
    const admin = await tempUser("admin");
    const res = await call("POST", "/api/permission-groups", admin.token, {
      name: `sanitize_${Date.now().toString(36)}`,
      permissions: ["clients:metadata", "obviously:not:real", ""],
    });
    expect(res!.status).toBe(200);
    const data = await res!.json();
    createdGroupIds.push(data.group.id);
    expect(data.group.permissions).toEqual(["clients:metadata"]);
  });

  test("duplicate group name returns 400", async () => {
    const admin = await tempUser("admin");
    const name = `dup_${Date.now().toString(36)}`;
    const first = await call("POST", "/api/permission-groups", admin.token, { name, permissions: [] });
    const firstData = await first!.json();
    createdGroupIds.push(firstData.group.id);
    const second = await call("POST", "/api/permission-groups", admin.token, { name, permissions: [] });
    expect(second!.status).toBe(400);
  });
});

describe("permission-groups routes — user assignments", () => {
  test("PUT /api/users/:id/permission-groups assigns + GET returns the same set", async () => {
    const admin = await tempUser("admin");
    const target = await tempUser("viewer");

    const createRes = await call("POST", "/api/permission-groups", admin.token, {
      name: `assign_${Date.now().toString(36)}`,
      permissions: ["clients:metadata"],
    });
    const group = (await createRes!.json()).group;
    createdGroupIds.push(group.id);

    const putRes = await call("PUT", `/api/users/${target.user.id}/permission-groups`, admin.token, {
      groupIds: [group.id],
    });
    expect(putRes!.status).toBe(200);

    const getRes = await call("GET", `/api/users/${target.user.id}/permission-groups`, admin.token);
    const body = await getRes!.json();
    expect(body.groupIds).toEqual([group.id]);
  });

  test("server route order lets empty user group assignment reach permission-groups handler", async () => {
    const admin = await tempUser("admin");
    const target = await tempUser("viewer");

    const putRes = await callThroughServerRoutes(
      "PUT",
      `/api/users/${target.user.id}/permission-groups`,
      admin.token,
      { groupIds: [] },
    );
    expect(putRes.status).toBe(200);

    const getRes = await callThroughServerRoutes(
      "GET",
      `/api/users/${target.user.id}/permission-groups`,
      admin.token,
    );
    expect(getRes.status).toBe(200);
    await expect(getRes.json()).resolves.toEqual({ groupIds: [] });
  });

  test("PUT /api/users/:id/extra-permissions sanitizes unknown perms", async () => {
    const admin = await tempUser("admin");
    const target = await tempUser("viewer");

    const putRes = await call("PUT", `/api/users/${target.user.id}/extra-permissions`, admin.token, {
      permissions: ["clients:metadata", "not:a:permission", 42],
    });
    expect(putRes!.status).toBe(200);
    const body = await putRes!.json();
    expect(body.permissions).toEqual(["clients:metadata"]);
  });

  test("returns 404 for unknown user", async () => {
    const admin = await tempUser("admin");
    const res = await call("PUT", `/api/users/9999999/permission-groups`, admin.token, { groupIds: [] });
    expect(res!.status).toBe(404);
  });
});

describe("permission-groups routes — audit log shape", () => {
  test("group create logs PERMISSION_GROUP_CREATE with structured details", async () => {
    const admin = await tempUser("admin");
    const name = `audit_create_${Date.now().toString(36)}`;
    const createRes = await call("POST", "/api/permission-groups", admin.token, {
      name,
      description: "describes the group",
      permissions: ["clients:metadata"],
    });
    const created = (await createRes!.json()).group;
    createdGroupIds.push(created.id);

    flushAuditLogsSync();
    const { logs } = getAuditLogs({
      action: AuditAction.PERMISSION_GROUP_CREATE,
      username: admin.user.username,
      pageSize: 5,
    });
    const entry = logs.find((l) => l.details && l.details.includes(`"groupId":${created.id}`));
    expect(entry).toBeDefined();
    const parsed = JSON.parse(entry!.details!);
    expect(parsed.groupId).toBe(created.id);
    expect(parsed.name).toBe(name);
    expect(parsed.description).toBe("describes the group");
    expect(parsed.permissions).toEqual(["clients:metadata"]);
  });

  test("user-groups change logs added/removed deltas, not just the count", async () => {
    const admin = await tempUser("admin");
    const target = await tempUser("viewer");

    const ga = (await (await call("POST", "/api/permission-groups", admin.token, {
      name: `delta_a_${Date.now().toString(36)}`,
      permissions: [],
    }))!.json()).group;
    createdGroupIds.push(ga.id);
    const gb = (await (await call("POST", "/api/permission-groups", admin.token, {
      name: `delta_b_${Date.now().toString(36)}`,
      permissions: [],
    }))!.json()).group;
    createdGroupIds.push(gb.id);

    // Seed: user has only group A
    setUserGroups(target.user.id, [ga.id]);

    // Change: replace with group B
    await call("PUT", `/api/users/${target.user.id}/permission-groups`, admin.token, {
      groupIds: [gb.id],
    });

    flushAuditLogsSync();
    const { logs } = getAuditLogs({
      action: AuditAction.USER_GROUPS_CHANGE,
      username: admin.user.username,
      pageSize: 5,
    });
    const entry = logs.find((l) => l.details && l.details.includes(`"targetUserId":${target.user.id}`));
    expect(entry).toBeDefined();
    const parsed = JSON.parse(entry!.details!);
    expect(parsed.groupsAdded).toEqual([gb.id]);
    expect(parsed.groupsRemoved).toEqual([ga.id]);
    expect(parsed.targetUsername).toBe(target.user.username);
  });

  test("user-extras change logs added/removed deltas", async () => {
    const admin = await tempUser("admin");
    const target = await tempUser("viewer");

    // First set: ["clients:metadata"]
    await call("PUT", `/api/users/${target.user.id}/extra-permissions`, admin.token, {
      permissions: ["clients:metadata"],
    });
    // Then replace with ["clients:disconnect"]
    await call("PUT", `/api/users/${target.user.id}/extra-permissions`, admin.token, {
      permissions: ["clients:disconnect"],
    });

    flushAuditLogsSync();
    const { logs } = getAuditLogs({
      action: AuditAction.USER_EXTRA_PERMISSIONS_CHANGE,
      username: admin.user.username,
      pageSize: 10,
    });
    const entry = logs
      .filter((l) => l.details && l.details.includes(`"targetUserId":${target.user.id}`))
      .sort((a, b) => b.timestamp - a.timestamp || (b.id ?? 0) - (a.id ?? 0))[0];
    expect(entry).toBeDefined();
    const parsed = JSON.parse(entry!.details!);
    expect(parsed.permissionsAdded).toEqual(["clients:disconnect"]);
    expect(parsed.permissionsRemoved).toEqual(["clients:metadata"]);
  });
});
