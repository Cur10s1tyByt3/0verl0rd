import { describe, expect, test } from "bun:test";
import {
  canUserAccessClient,
  canViewClients,
  createUser,
  deleteUser,
  getUserByUsername,
  getUserClientAccessScope,
  listUserClientAccessRules,
  setUserClientAccessRule,
  setUserClientAccessScope,
  updateUserRole,
} from "./users";

const createdUserIds: number[] = [];

async function createTempUser(role: "viewer" | "operator" | "admin") {
  const username = `r_${role.slice(0, 3)}_${Date.now().toString(36)}${Math.floor(Math.random() * 1000).toString(36)}`;
  const result = await createUser(username, "Aa1!VeryLongTestPassword_2026", role, "test");
  expect(result.success).toBe(true);
  const user = getUserByUsername(username);
  expect(user).not.toBeNull();
  createdUserIds.push(user!.id);
  return user!;
}

function cleanupCreatedUsers() {
  while (createdUserIds.length > 0) {
    const id = createdUserIds.pop();
    if (typeof id === "number") {
      deleteUser(id);
    }
  }
}

describe("users client access RBAC", () => {
  test("clients:view permission is admin-only by default", () => {
    expect(canViewClients("admin")).toBe(true);
    expect(canViewClients("operator")).toBe(false);
    expect(canViewClients("viewer")).toBe(false);
  });

  test("new non-admin users default to no client visibility", async () => {
    try {
      const viewer = await createTempUser("viewer");
      expect(getUserClientAccessScope(viewer.id)).toBe("none");
      expect(canUserAccessClient(viewer.id, viewer.role, "client-a")).toBe(false);
    } finally {
      cleanupCreatedUsers();
    }
  });

  test("allowlist scope only allows explicitly approved clients", async () => {
    try {
      const operator = await createTempUser("operator");

      const scopeResult = setUserClientAccessScope(operator.id, "allowlist");
      expect(scopeResult.success).toBe(true);

      const ruleResult = setUserClientAccessRule(operator.id, "client-allowed", "allow");
      expect(ruleResult.success).toBe(true);

      const rules = listUserClientAccessRules(operator.id);
      expect(rules.some((rule) => rule.clientId === "client-allowed" && rule.access === "allow")).toBe(true);

      expect(canUserAccessClient(operator.id, operator.role, "client-allowed")).toBe(true);
      expect(canUserAccessClient(operator.id, operator.role, "client-other")).toBe(false);
    } finally {
      cleanupCreatedUsers();
    }
  });

  test("denylist scope blocks denied clients and allows others", async () => {
    try {
      const operator = await createTempUser("operator");

      const scopeResult = setUserClientAccessScope(operator.id, "denylist");
      expect(scopeResult.success).toBe(true);

      const ruleResult = setUserClientAccessRule(operator.id, "client-denied", "deny");
      expect(ruleResult.success).toBe(true);

      expect(canUserAccessClient(operator.id, operator.role, "client-denied")).toBe(false);
      expect(canUserAccessClient(operator.id, operator.role, "client-safe")).toBe(true);
    } finally {
      cleanupCreatedUsers();
    }
  });

  test("role changes reset scope between admin and non-admin", async () => {
    try {
      const operator = await createTempUser("operator");

      expect(getUserClientAccessScope(operator.id)).toBe("none");

      const toAdmin = updateUserRole(operator.id, "admin");
      expect(toAdmin.success).toBe(true);
      expect(getUserClientAccessScope(operator.id)).toBe("all");

      const backToOperator = updateUserRole(operator.id, "operator");
      expect(backToOperator.success).toBe(true);
      expect(getUserClientAccessScope(operator.id)).toBe("none");
    } finally {
      cleanupCreatedUsers();
    }
  });
});