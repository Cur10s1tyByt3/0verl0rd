import { generateToken, authenticateRequest } from "../../auth";
import { AuditAction, logAudit } from "../../auditLog";
import { logger } from "../../logger";
import { requirePermission } from "../../rbac";
import {
  createUser,
  deleteUser,
  getUserById,
  listUsers,
  updateUserPassword,
  updateUserRole,
} from "../../users";

type RequestIpProvider = {
  requestIP: (req: Request) => { address?: string } | null | undefined;
};

export async function handleUsersRoutes(
  req: Request,
  url: URL,
  server: RequestIpProvider,
): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/users")) {
    return null;
  }

  try {
    const user = await authenticateRequest(req);

    if (req.method === "GET" && url.pathname === "/api/users") {
      requirePermission(user, "users:manage");
      const users = listUsers();
      return Response.json({ users });
    }

    if (req.method === "POST" && url.pathname === "/api/users") {
      const authedUser = requirePermission(user, "users:manage");
      const body = await req.json();
      const { username, password, role } = body;

      if (!username || !password || !role) {
        return Response.json({ error: "Missing required fields" }, { status: 400 });
      }

      if (!["admin", "operator", "viewer"].includes(role)) {
        return Response.json({ error: "Invalid role" }, { status: 400 });
      }

      const result = await createUser(username, password, role, authedUser.username);

      if (result.success) {
        const ip = server.requestIP(req)?.address || "unknown";
        logAudit({
          timestamp: Date.now(),
          username: authedUser.username,
          ip,
          action: AuditAction.COMMAND,
          details: `Created user: ${username} (${role})`,
          success: true,
        });

        return Response.json({ success: true, userId: result.userId });
      }
      return Response.json({ error: result.error }, { status: 400 });
    }

    if (req.method === "PUT" && url.pathname.match(/^\/api\/users\/\d+\/password$/)) {
      const userId = parseInt(url.pathname.split("/")[3]);
      const body = await req.json();
      const { password, newPassword, currentPassword } = body;

      const canChange = user.userId === userId || user.role === "admin";

      if (!canChange) {
        return Response.json({ error: "Permission denied" }, { status: 403 });
      }

      if (user.userId === userId && currentPassword) {
        const targetUser = getUserById(userId);
        if (!targetUser) {
          return Response.json({ error: "User not found" }, { status: 404 });
        }

        const isValid = await Bun.password.verify(
          currentPassword,
          targetUser.password_hash,
        );
        if (!isValid) {
          return Response.json(
            { error: "Current password is incorrect" },
            { status: 400 },
          );
        }
      }

      const finalPassword = newPassword || password;
      if (!finalPassword) {
        return Response.json({ error: "Password required" }, { status: 400 });
      }

      const result = await updateUserPassword(userId, finalPassword);

      if (result.success) {
        const targetUser = getUserById(userId);
        const ip = server.requestIP(req)?.address || "unknown";
        logAudit({
          timestamp: Date.now(),
          username: user.username,
          ip,
          action: AuditAction.COMMAND,
          details: `Updated password for user: ${targetUser?.username}`,
          success: true,
        });

        if (user.userId === userId && targetUser) {
          const newToken = await generateToken(targetUser);
          return new Response(
            JSON.stringify({
              success: true,
              token: newToken,
            }),
            {
              headers: {
                "Content-Type": "application/json",
                "Set-Cookie": `overlord_token=${newToken}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800`,
              },
            },
          );
        }

        return Response.json({ success: true });
      }
      return Response.json({ error: result.error }, { status: 400 });
    }

    if (req.method === "PUT" && url.pathname.match(/^\/api\/users\/\d+\/role$/)) {
      const authedUser = requirePermission(user, "users:manage");
      const userId = parseInt(url.pathname.split("/")[3]);
      const body = await req.json();
      const { role } = body;

      if (!role || !["admin", "operator", "viewer"].includes(role)) {
        return Response.json({ error: "Invalid role" }, { status: 400 });
      }

      if (userId === authedUser.userId) {
        return Response.json({ error: "Cannot change your own role" }, { status: 400 });
      }

      const result = updateUserRole(userId, role);

      if (result.success) {
        const targetUser = getUserById(userId);
        const ip = server.requestIP(req)?.address || "unknown";
        logAudit({
          timestamp: Date.now(),
          username: authedUser.username,
          ip,
          action: AuditAction.COMMAND,
          details: `Updated role for user: ${targetUser?.username} to ${role}`,
          success: true,
        });

        return Response.json({ success: true });
      }
      return Response.json({ error: result.error }, { status: 400 });
    }

    if (req.method === "DELETE" && url.pathname.match(/^\/api\/users\/\d+$/)) {
      const authedUser = requirePermission(user, "users:manage");
      const userId = parseInt(url.pathname.split("/")[3]);

      if (userId === authedUser.userId) {
        return Response.json(
          { error: "Cannot delete your own account" },
          { status: 400 },
        );
      }

      const targetUser = getUserById(userId);
      const result = deleteUser(userId);

      if (result.success) {
        const ip = server.requestIP(req)?.address || "unknown";
        logAudit({
          timestamp: Date.now(),
          username: authedUser.username,
          ip,
          action: AuditAction.COMMAND,
          details: `Deleted user: ${targetUser?.username}`,
          success: true,
        });

        return Response.json({ success: true });
      }
      return Response.json({ error: result.error }, { status: 400 });
    }

    return new Response("Not found", { status: 404 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    logger.error("[users] API error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
