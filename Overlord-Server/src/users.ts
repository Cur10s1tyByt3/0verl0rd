import { Database } from "bun:sqlite";
import { resolve } from "path";
import { logger } from "./logger";
import { ensureDataDir } from "./paths";
import { getConfig } from "./config";

const dataDir = ensureDataDir();
const dbPath = resolve(dataDir, "overlord.db");
const db = new Database(dbPath);

export type UserRole = "admin" | "operator" | "viewer";
export type ClientAccessScope = "none" | "allowlist" | "denylist" | "all";
export type ClientAccessRuleKind = "allow" | "deny";

export interface User {
  id: number;
  username: string;
  password_hash: string;
  role: UserRole;
  created_at: number;
  last_login: number | null;
  created_by: string | null;
  must_change_password: number;
  client_scope: ClientAccessScope;
}

export interface UserInfo {
  id: number;
  username: string;
  role: UserRole;
  created_at: number;
  last_login: number | null;
  created_by: string | null;
  client_scope: ClientAccessScope;
}

export interface UserClientAccessRule {
  userId: number;
  clientId: string;
  access: ClientAccessRuleKind;
}

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'operator', 'viewer')),
    created_at INTEGER NOT NULL,
    last_login INTEGER,
    created_by TEXT,
    must_change_password INTEGER DEFAULT 0,
    client_scope TEXT NOT NULL DEFAULT 'none' CHECK(client_scope IN ('none', 'allowlist', 'denylist', 'all'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS user_client_access_rules (
    user_id INTEGER NOT NULL,
    client_id TEXT NOT NULL,
    access TEXT NOT NULL CHECK(access IN ('allow', 'deny')),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, client_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`);

db.exec(
  `CREATE INDEX IF NOT EXISTS idx_user_client_access_rules_user ON user_client_access_rules(user_id)`,
);

try {
  db.exec(
    `ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0`,
  );
  logger.info("[users] Added must_change_password column to existing database");
} catch (err: any) {
  if (!err.message?.includes("duplicate column name")) {
    logger.error("[users] Migration error:", err);
  }
}

try {
  db.exec(
    `ALTER TABLE users ADD COLUMN client_scope TEXT NOT NULL DEFAULT 'none' CHECK(client_scope IN ('none', 'allowlist', 'denylist', 'all'))`,
  );
  logger.info("[users] Added client_scope column to existing database");
} catch (err: any) {
  if (!err.message?.includes("duplicate column name")) {
    logger.error("[users] Migration error:", err);
  }
}

try {
  db.exec(`UPDATE users SET client_scope='all' WHERE role='admin'`);
} catch (err: any) {
  logger.error("[users] Failed to normalize admin client_scope:", err);
}

const userCount = db.prepare("SELECT COUNT(*) as count FROM users").get() as {
  count: number;
};
if (userCount.count === 0) {
  const config = getConfig();
  const initialUsername = (config.auth.username || "admin").trim() || "admin";
  const initialPassword = config.auth.password;

  logger.info("[users] No users found, creating default admin account");
  const defaultPassword = await Bun.password.hash(initialPassword, {
    algorithm: "bcrypt",
    cost: 10,
  });

  db.prepare(
    "INSERT INTO users (username, password_hash, role, created_at, created_by, must_change_password, client_scope) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(initialUsername, defaultPassword, "admin", Date.now(), "system", 1, "all");

  const createdUser = db
    .prepare("SELECT * FROM users WHERE username = ?")
    .get(initialUsername) as User | undefined;
  logger.info(
    "[users] Default admin created with must_change_password =",
    createdUser?.must_change_password,
  );

  logger.info(`[users] Initial admin account created (username: ${initialUsername})`);
  logger.warn(
    `[users] Bootstrap login credentials -> username: ${initialUsername} | password: ${initialPassword}`,
  );
  logger.warn(
    "[users] SECURITY WARNING: Rotate the bootstrap password after first login. Default bootstrap credentials are admin/admin unless overridden by configuration.",
  );
}

export function getUserById(id: number): User | null {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as
    | User
    | undefined;
  return user || null;
}

export function getUserByUsername(username: string): User | null {
  const user = db
    .prepare("SELECT * FROM users WHERE username = ?")
    .get(username) as User | undefined;
  return user || null;
}

export function listUsers(): UserInfo[] {
  const users = db
    .prepare(
      "SELECT id, username, role, created_at, last_login, created_by, client_scope FROM users ORDER BY created_at DESC",
    )
    .all() as UserInfo[];
  return users;
}

export function getUserClientAccessScope(userId: number): ClientAccessScope {
  const row = db
    .prepare("SELECT client_scope FROM users WHERE id = ?")
    .get(userId) as { client_scope?: ClientAccessScope } | undefined;
  return row?.client_scope || "none";
}

export function listUserClientAccessRules(userId: number): UserClientAccessRule[] {
  return db
    .prepare(
      "SELECT user_id as userId, client_id as clientId, access FROM user_client_access_rules WHERE user_id = ? ORDER BY client_id ASC",
    )
    .all(userId) as UserClientAccessRule[];
}

export function listUserClientRuleIdsByAccess(
  userId: number,
  access: ClientAccessRuleKind,
): string[] {
  return db
    .prepare(
      "SELECT client_id as clientId FROM user_client_access_rules WHERE user_id = ? AND access = ? ORDER BY client_id ASC",
    )
    .all(userId, access)
    .map((row: { clientId: string }) => row.clientId);
}

export function setUserClientAccessScope(
  userId: number,
  scope: ClientAccessScope,
): { success: boolean; error?: string } {
  if (!["none", "allowlist", "denylist", "all"].includes(scope)) {
    return { success: false, error: "Invalid client access scope" };
  }

  try {
    db.prepare("UPDATE users SET client_scope = ? WHERE id = ?").run(scope, userId);
    return { success: true };
  } catch (err: any) {
    logger.error("[users] setUserClientAccessScope error:", err);
    return { success: false, error: err.message || "Failed to update client access scope" };
  }
}

export function setUserClientAccessRule(
  userId: number,
  clientId: string,
  access: ClientAccessRuleKind,
): { success: boolean; error?: string } {
  const normalizedClientId = (clientId || "").trim();
  if (!normalizedClientId) {
    return { success: false, error: "clientId is required" };
  }
  if (!["allow", "deny"].includes(access)) {
    return { success: false, error: "Invalid client access rule" };
  }

  try {
    db.prepare(
      "INSERT OR REPLACE INTO user_client_access_rules (user_id, client_id, access, created_at) VALUES (?, ?, ?, ?)",
    ).run(userId, normalizedClientId, access, Date.now());
    return { success: true };
  } catch (err: any) {
    logger.error("[users] setUserClientAccessRule error:", err);
    return { success: false, error: err.message || "Failed to update client access rule" };
  }
}

export function removeUserClientAccessRule(
  userId: number,
  clientId: string,
): { success: boolean; error?: string } {
  try {
    db.prepare("DELETE FROM user_client_access_rules WHERE user_id = ? AND client_id = ?").run(
      userId,
      clientId,
    );
    return { success: true };
  } catch (err: any) {
    logger.error("[users] removeUserClientAccessRule error:", err);
    return { success: false, error: err.message || "Failed to remove client access rule" };
  }
}

export function canUserAccessClient(
  userId: number,
  role: UserRole,
  clientId: string,
): boolean {
  if (role === "admin") return true;

  const scope = getUserClientAccessScope(userId);
  if (scope === "none") return false;
  if (scope === "all") return true;

  const row = db
    .prepare(
      "SELECT access FROM user_client_access_rules WHERE user_id = ? AND client_id = ?",
    )
    .get(userId, clientId) as { access?: ClientAccessRuleKind } | undefined;

  if (scope === "allowlist") {
    return row?.access === "allow";
  }
  if (scope === "denylist") {
    return row?.access !== "deny";
  }
  return false;
}

function validatePasswordPolicy(password: string): string | null {
  const security = getConfig().security;
  const minLength = Math.min(128, Math.max(6, Number(security.passwordMinLength) || 6));

  if (!password || password.length < minLength) {
    return `Password must be at least ${minLength} characters`;
  }

  if (security.passwordRequireUppercase && !/[A-Z]/.test(password)) {
    return "Password must include at least one uppercase letter";
  }
  if (security.passwordRequireLowercase && !/[a-z]/.test(password)) {
    return "Password must include at least one lowercase letter";
  }
  if (security.passwordRequireNumber && !/[0-9]/.test(password)) {
    return "Password must include at least one number";
  }
  if (security.passwordRequireSymbol && !/[^A-Za-z0-9]/.test(password)) {
    return "Password must include at least one symbol";
  }

  return null;
}

export async function createUser(
  username: string,
  password: string,
  role: UserRole,
  createdBy: string,
): Promise<{ success: boolean; error?: string; userId?: number }> {
  if (!username || username.length < 3 || username.length > 32) {
    return {
      success: false,
      error: "Username must be between 3 and 32 characters",
    };
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    return {
      success: false,
      error:
        "Username can only contain letters, numbers, hyphens, and underscores",
    };
  }

  const policyError = validatePasswordPolicy(password);
  if (policyError) {
    return { success: false, error: policyError };
  }

  const existing = getUserByUsername(username);
  if (existing) {
    return { success: false, error: "Username already exists" };
  }

  try {
    const passwordHash = await Bun.password.hash(password, {
      algorithm: "bcrypt",
      cost: 10,
    });

    const result = db
      .prepare(
        "INSERT INTO users (username, password_hash, role, created_at, created_by, client_scope) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(username, passwordHash, role, Date.now(), createdBy, role === "admin" ? "all" : "none");

    return { success: true, userId: result.lastInsertRowid as number };
  } catch (err: any) {
    logger.error("[users] Create user error:", err);
    return { success: false, error: err.message || "Failed to create user" };
  }
}

export async function updateUserPassword(
  userId: number,
  newPassword: string,
): Promise<{ success: boolean; error?: string }> {
  const policyError = validatePasswordPolicy(newPassword);
  if (policyError) {
    return { success: false, error: policyError };
  }

  try {
    const passwordHash = await Bun.password.hash(newPassword, {
      algorithm: "bcrypt",
      cost: 10,
    });

    db.prepare(
      "UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?",
    ).run(passwordHash, userId);
    return { success: true };
  } catch (err: any) {
    console.error("[users] Update password error:", err);
    return {
      success: false,
      error: err.message || "Failed to update password",
    };
  }
}

export function updateUserRole(
  userId: number,
  newRole: UserRole,
): { success: boolean; error?: string } {
  try {
    const nextScope: ClientAccessScope = newRole === "admin" ? "all" : "none";
    db.prepare("UPDATE users SET role = ?, client_scope = ? WHERE id = ?").run(
      newRole,
      nextScope,
      userId,
    );
    return { success: true };
  } catch (err: any) {
    console.error("[users] Update role error:", err);
    return { success: false, error: err.message || "Failed to update role" };
  }
}

export function deleteUser(userId: number): {
  success: boolean;
  error?: string;
} {
  const admins = db
    .prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'")
    .get() as { count: number };
  const user = getUserById(userId);

  if (user?.role === "admin" && admins.count <= 1) {
    return { success: false, error: "Cannot delete the last admin user" };
  }

  try {
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
    return { success: true };
  } catch (err: any) {
    console.error("[users] Delete user error:", err);
    return { success: false, error: err.message || "Failed to delete user" };
  }
}

export function updateLastLogin(userId: number): void {
  db.prepare("UPDATE users SET last_login = ? WHERE id = ?").run(
    Date.now(),
    userId,
  );
}

export async function verifyPassword(
  username: string,
  password: string,
): Promise<User | null> {
  const user = getUserByUsername(username);
  if (!user) return null;

  const isValid = await Bun.password.verify(password, user.password_hash);
  if (!isValid) return null;

  updateLastLogin(user.id);
  return user;
}

export function canManageUsers(role: UserRole): boolean {
  return role === "admin";
}

export function canControlClients(role: UserRole): boolean {
  return role === "admin" || role === "operator";
}

export function canViewClients(role: UserRole): boolean {
  return role === "admin";
}

export function canViewAuditLogs(role: UserRole): boolean {
  return role === "admin";
}

export function hasPermission(role: UserRole, permission: string): boolean {
  switch (permission) {
    case "users:manage":
      return canManageUsers(role);
    case "clients:control":
      return canControlClients(role);
    case "clients:view":
      return canViewClients(role);
    case "audit:view":
      return canViewAuditLogs(role);
    default:
      return false;
  }
}
