import {
  authenticateRequest,
  authenticateUser,
  extractTokenFromRequest,
  generateToken,
  getSessionTtlSeconds,
  getUserFromRequest,
  revokeToken,
} from "../../auth";
import { AuditAction, logAudit } from "../../auditLog";
import { logger } from "../../logger";
import {
  isRateLimited,
  recordFailedAttempt,
  recordSuccessfulAttempt,
} from "../../rateLimit";
import { getUserById } from "../../users";

type RequestIpProvider = {
  requestIP: (req: Request) => { address?: string } | null | undefined;
};

export async function handleAuthRoutes(
  req: Request,
  url: URL,
  server: RequestIpProvider,
): Promise<Response | null> {
  if (req.method === "POST" && url.pathname === "/api/login") {
    const ip = server.requestIP(req)?.address || "unknown";

    const rateLimitCheck = isRateLimited(ip);
    if (rateLimitCheck.limited) {
      logAudit({
        timestamp: Date.now(),
        username: "unknown",
        ip,
        action: AuditAction.LOGIN_FAILED,
        success: false,
        errorMessage: "Rate limited",
      });

      return new Response(
        JSON.stringify({
          ok: false,
          error: `Too many failed attempts. Please try again in ${rateLimitCheck.retryAfter} seconds.`,
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(rateLimitCheck.retryAfter),
          },
        },
      );
    }

    try {
      const body = await req.json();
      const username = body?.user || "";
      const password = body?.pass || "";

      const user = await authenticateUser(username, password);

      if (user) {
        const token = await generateToken(user);
        const sessionTtlSeconds = getSessionTtlSeconds();

        logger.info(
          `[auth] User ${user.username} logged in. must_change_password =`,
          user.must_change_password,
          `(type: ${typeof user.must_change_password})`,
        );

        logAudit({
          timestamp: Date.now(),
          username: user.username,
          ip,
          action: AuditAction.LOGIN,
          success: true,
        });

        recordSuccessfulAttempt(ip);

        return new Response(
          JSON.stringify({
            ok: true,
            token,
            user: {
              username: user.username,
              role: user.role,
              id: user.id,
              mustChangePassword: Boolean(user.must_change_password),
            },
          }),
          {
            headers: {
              "Content-Type": "application/json",
              "Set-Cookie": `overlord_token=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${sessionTtlSeconds}`,
            },
          },
        );
      }

      recordFailedAttempt(ip);
      logAudit({
        timestamp: Date.now(),
        username,
        ip,
        action: AuditAction.LOGIN_FAILED,
        success: false,
        errorMessage: "Invalid credentials",
      });
    } catch (error) {
      logger.error("[auth] Login error:", error);
      logAudit({
        timestamp: Date.now(),
        username: "unknown",
        ip,
        action: AuditAction.LOGIN_FAILED,
        success: false,
        errorMessage: String(error),
      });
    }

    return new Response(JSON.stringify({ ok: false, error: "Invalid credentials" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (req.method === "POST" && url.pathname === "/api/logout") {
    const ip = server.requestIP(req)?.address || "unknown";
    const user = await getUserFromRequest(req);
    const token = extractTokenFromRequest(req);

    if (token) {
      revokeToken(token);
    }

    logAudit({
      timestamp: Date.now(),
      username: user?.username || "unknown",
      ip,
      action: AuditAction.LOGOUT,
      success: true,
    });

    return new Response(JSON.stringify({ ok: true }), {
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": `overlord_token=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`,
      },
    });
  }

  if (req.method === "GET" && url.pathname === "/api/auth/me") {
    const user = await authenticateRequest(req);
    if (!user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const dbUser = getUserById(user.userId);

    return new Response(
      JSON.stringify({
        username: user.username,
        role: user.role,
        userId: user.userId,
        mustChangePassword: dbUser ? Boolean(dbUser.must_change_password) : false,
      }),
      {
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  return null;
}
