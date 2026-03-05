import fs from "fs/promises";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { authenticateRequest } from "../../auth";
import { requirePermission } from "../../rbac";
import * as clientManager from "../../clientManager";
import { metrics } from "../../metrics";
import { encodeMessage } from "../../protocol";

type PluginManifest = {
  id: string;
  name: string;
};

type PluginBundle = {
  manifest: PluginManifest;
  wasm: Uint8Array;
};

type PluginState = {
  enabled: Record<string, boolean>;
  lastError: Record<string, string>;
};

type PluginRouteDeps = {
  PLUGIN_ROOT: string;
  pluginState: PluginState;
  pluginLoadedByClient: Map<string, Set<string>>;
  pluginLoadingByClient: Map<string, Set<string>>;
  pendingPluginEvents: Map<string, Array<{ event: string; payload: any }>>;
  sanitizePluginId: (name: string) => string;
  ensurePluginExtracted: (pluginId: string) => Promise<void>;
  savePluginState: () => Promise<void>;
  listPluginManifests: () => Promise<PluginManifest[]>;
  loadPluginBundle: (pluginId: string) => Promise<PluginBundle>;
  sendPluginBundle: (target: any, bundle: PluginBundle) => void;
  markPluginLoading: (clientId: string, pluginId: string) => void;
  isPluginLoaded: (clientId: string, pluginId: string) => boolean;
  isPluginLoading: (clientId: string, pluginId: string) => boolean;
  enqueuePluginEvent: (clientId: string, pluginId: string, event: string, payload: any) => void;
  secureHeaders: (contentType?: string) => Record<string, string>;
  securePluginHeaders: () => Record<string, string>;
  mimeType: (path: string) => string;
};

export async function handlePluginRoutes(
  req: Request,
  url: URL,
  deps: PluginRouteDeps,
): Promise<Response | null> {
  if (
    !url.pathname.startsWith("/api/plugins") &&
    !url.pathname.startsWith("/plugins/") &&
    !url.pathname.match(/^\/api\/clients\/.+\/plugins/)
  ) {
    return null;
  }

  if (req.method === "GET" && url.pathname === "/api/plugins") {
    if (!(await authenticateRequest(req))) {
      return new Response("Unauthorized", { status: 401 });
    }
    const plugins = await deps.listPluginManifests();
    const enriched = plugins.map((p) => ({
      ...p,
      enabled: deps.pluginState.enabled[p.id] !== false,
      lastError: deps.pluginState.lastError[p.id] || "",
    }));
    return Response.json({ plugins: enriched });
  }

  const clientPluginsMatch = url.pathname.match(/^\/api\/clients\/(.+)\/plugins$/);
  if (req.method === "GET" && clientPluginsMatch) {
    const user = await authenticateRequest(req);
    if (!user) {
      return new Response("Unauthorized", { status: 401 });
    }
    try {
      requirePermission(user, "clients:control");
    } catch (error) {
      if (error instanceof Response) return error;
      return new Response("Forbidden", { status: 403 });
    }

    const clientId = clientPluginsMatch[1];
    const loaded = deps.pluginLoadedByClient.get(clientId) || new Set<string>();
    const manifests = await deps.listPluginManifests();
    const plugins = manifests.map((manifest) => ({
      id: manifest.id,
      name: manifest.name || manifest.id,
      loaded: loaded.has(manifest.id),
      enabled: deps.pluginState.enabled[manifest.id] !== false,
      lastError: deps.pluginState.lastError[manifest.id] || "",
    }));
    return Response.json({ plugins });
  }

  if (req.method === "POST" && url.pathname === "/api/plugins/upload") {
    const user = await authenticateRequest(req);
    if (!user) {
      return new Response("Unauthorized", { status: 401 });
    }
    if (user.role !== "admin" && user.role !== "operator") {
      return new Response("Forbidden: Admin or operator access required", { status: 403 });
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return new Response("Bad request", { status: 400 });
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      return new Response("Missing file", { status: 400 });
    }

    const filename = file.name || "plugin.zip";
    if (!filename.toLowerCase().endsWith(".zip")) {
      return new Response("Only .zip files are supported", { status: 400 });
    }

    const base = path.basename(filename, path.extname(filename));
    let pluginId = "";
    try {
      pluginId = deps.sanitizePluginId(base);
    } catch {
      return new Response("Invalid plugin name", { status: 400 });
    }

    await fs.mkdir(deps.PLUGIN_ROOT, { recursive: true });
    const zipPath = path.join(deps.PLUGIN_ROOT, `${pluginId}.zip`);
    const data = new Uint8Array(await file.arrayBuffer());
    await fs.writeFile(zipPath, data);

    try {
      await deps.ensurePluginExtracted(pluginId);
    } catch (err) {
      return Response.json({ ok: false, error: (err as Error).message }, { status: 400 });
    }

    if (deps.pluginState.enabled[pluginId] === undefined) {
      deps.pluginState.enabled[pluginId] = true;
      await deps.savePluginState();
    }

    return Response.json({ ok: true, id: pluginId });
  }

  const pluginEnableMatch = url.pathname.match(/^\/api\/plugins\/(.+)\/enable$/);
  if (req.method === "POST" && pluginEnableMatch) {
    const user = await authenticateRequest(req);
    if (!user) {
      return new Response("Unauthorized", { status: 401 });
    }
    if (user.role !== "admin" && user.role !== "operator") {
      return new Response("Forbidden: Admin or operator access required", { status: 403 });
    }
    let pluginId = "";
    try {
      pluginId = deps.sanitizePluginId(pluginEnableMatch[1]);
    } catch {
      return new Response("Invalid plugin id", { status: 400 });
    }
    let body: any = {};
    try {
      body = await req.json();
    } catch {}
    const enabled = !!body.enabled;
    deps.pluginState.enabled[pluginId] = enabled;
    await deps.savePluginState();
    return Response.json({ ok: true, id: pluginId, enabled });
  }

  const pluginDeleteMatch = url.pathname.match(/^\/api\/plugins\/(.+)$/);
  if (req.method === "DELETE" && pluginDeleteMatch) {
    const user = await authenticateRequest(req);
    if (!user) {
      return new Response("Unauthorized", { status: 401 });
    }
    if (user.role !== "admin" && user.role !== "operator") {
      return new Response("Forbidden: Admin or operator access required", { status: 403 });
    }

    let pluginId = "";
    try {
      pluginId = deps.sanitizePluginId(pluginDeleteMatch[1]);
    } catch {
      return new Response("Invalid plugin id", { status: 400 });
    }

    const zipPath = path.join(deps.PLUGIN_ROOT, `${pluginId}.zip`);
    const pluginDir = path.join(deps.PLUGIN_ROOT, pluginId);

    try {
      await fs.rm(zipPath, { force: true });
    } catch {}

    try {
      await fs.rm(pluginDir, { recursive: true, force: true });
    } catch {}

    deps.pluginLoadedByClient.forEach((set) => set.delete(pluginId));
    deps.pluginLoadingByClient.forEach((set) => set.delete(pluginId));
    delete deps.pluginState.enabled[pluginId];
    delete deps.pluginState.lastError[pluginId];
    await deps.savePluginState();

    return Response.json({ ok: true, id: pluginId });
  }

  const pluginLoadMatch = url.pathname.match(/^\/api\/clients\/(.+)\/plugins\/(.+)\/load$/);
  if (req.method === "POST" && pluginLoadMatch) {
    const user = await authenticateRequest(req);
    if (!user) return new Response("Unauthorized", { status: 401 });
    try {
      requirePermission(user, "clients:control");
    } catch (error) {
      if (error instanceof Response) return error;
      return new Response("Forbidden", { status: 403 });
    }
    const targetId = pluginLoadMatch[1];
    const pluginId = pluginLoadMatch[2];
    const target = clientManager.getClient(targetId);
    if (!target) return new Response("Not found", { status: 404 });
    if (deps.isPluginLoaded(targetId, pluginId)) {
      return Response.json({ ok: true, alreadyLoaded: true });
    }
    if (deps.isPluginLoading(targetId, pluginId)) {
      return Response.json({ ok: true, loading: true });
    }
    try {
      const bundle = await deps.loadPluginBundle(pluginId);
      deps.markPluginLoading(targetId, pluginId);
      deps.sendPluginBundle(target, bundle);
      metrics.recordCommand("plugin_load");
      return Response.json({ ok: true });
    } catch (err) {
      return Response.json({ ok: false, error: (err as Error).message }, { status: 400 });
    }
  }

  const pluginEventMatch = url.pathname.match(/^\/api\/clients\/(.+)\/plugins\/(.+)\/event$/);
  if (req.method === "POST" && pluginEventMatch) {
    const user = await authenticateRequest(req);
    if (!user) return new Response("Unauthorized", { status: 401 });
    try {
      requirePermission(user, "clients:control");
    } catch (error) {
      if (error instanceof Response) return error;
      return new Response("Forbidden", { status: 403 });
    }

    const targetId = pluginEventMatch[1];
    const pluginId = pluginEventMatch[2];
    const target = clientManager.getClient(targetId);
    if (!target) return new Response("Not found", { status: 404 });
    if (deps.pluginState.enabled[pluginId] === false) {
      return Response.json({ ok: false, error: "Plugin disabled" }, { status: 400 });
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    const event = typeof body.event === "string" ? body.event : "";
    const payload = body.payload;
    if (!event) {
      return new Response("Bad request", { status: 400 });
    }

    if (!deps.isPluginLoaded(targetId, pluginId)) {
      deps.enqueuePluginEvent(targetId, pluginId, event, payload);
      if (!deps.isPluginLoading(targetId, pluginId)) {
        try {
          const bundle = await deps.loadPluginBundle(pluginId);
          deps.markPluginLoading(targetId, pluginId);
          deps.sendPluginBundle(target, bundle);
          metrics.recordCommand("plugin_load");
        } catch (err) {
          return Response.json({ ok: false, error: (err as Error).message }, { status: 400 });
        }
      }
      metrics.recordCommand("plugin_event");
      return Response.json({ ok: true, queued: true });
    }

    target.ws.send(
      encodeMessage({
        type: "plugin_event",
        pluginId,
        event,
        payload,
      }),
    );
    metrics.recordCommand("plugin_event");
    return Response.json({ ok: true });
  }

  const pluginUnloadMatch = url.pathname.match(/^\/api\/clients\/(.+)\/plugins\/(.+)\/unload$/);
  if (req.method === "POST" && pluginUnloadMatch) {
    const user = await authenticateRequest(req);
    if (!user) return new Response("Unauthorized", { status: 401 });
    try {
      requirePermission(user, "clients:control");
    } catch (error) {
      if (error instanceof Response) return error;
      return new Response("Forbidden", { status: 403 });
    }

    const targetId = pluginUnloadMatch[1];
    const pluginId = pluginUnloadMatch[2];
    const target = clientManager.getClient(targetId);
    if (!target) return new Response("Not found", { status: 404 });

    target.ws.send(
      encodeMessage({
        type: "command",
        commandType: "plugin_unload",
        id: uuidv4(),
        payload: { pluginId },
      }),
    );

    deps.pluginLoadedByClient.get(targetId)?.delete(pluginId);
    deps.pluginLoadingByClient.get(targetId)?.delete(pluginId);
    deps.pendingPluginEvents.delete(`${targetId}:${pluginId}`);

    return Response.json({ ok: true, id: pluginId });
  }

  const pluginFrameMatch = url.pathname.match(/^\/plugins\/([^/]+)\/frame$/);
  if (req.method === "GET" && pluginFrameMatch) {
    let pluginId = "";
    try {
      pluginId = deps.sanitizePluginId(pluginFrameMatch[1]);
    } catch {
      return new Response("Invalid plugin id", { status: 400 });
    }

    const htmlFile = path.join(deps.PLUGIN_ROOT, pluginId, "assets", `${pluginId}.html`);
    const file = Bun.file(htmlFile);
    if (!(await file.exists())) {
      return new Response("Not found", { status: 404 });
    }

    const raw = await file.text();
    const baseTag = `<base href="/plugins/${pluginId}/assets/" />`;
    const bridgeTag = `<script src="/assets/plugin-bridge.js"></script>`;
    let injected = raw;

    const headMatch = raw.match(/<head[^>]*>/i);
    if (headMatch) {
      injected = raw.replace(headMatch[0], `${headMatch[0]}\n    ${baseTag}`);
    }

    if (injected.includes("</head>")) {
      injected = injected.replace("</head>", `    ${bridgeTag}\n  </head>`);
    } else if (injected.includes("</body>")) {
      injected = injected.replace("</body>", `  ${bridgeTag}\n</body>`);
    } else {
      injected = `${bridgeTag}\n${injected}`;
    }

    return new Response(injected, {
      headers: { ...deps.securePluginHeaders(), "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const pluginPageMatch = url.pathname.match(/^\/plugins\/([^/]+)$/);
  if (req.method === "GET" && pluginPageMatch) {
    let pluginId = "";
    try {
      pluginId = deps.sanitizePluginId(pluginPageMatch[1]);
    } catch {
      return new Response("Invalid plugin id", { status: 400 });
    }

    const clientId = url.searchParams.get("clientId") || "";
    const bridgeToken = uuidv4();
    const origin = url.origin;
    const iframeSrc = `/plugins/${pluginId}/frame?clientId=${encodeURIComponent(clientId)}&token=${encodeURIComponent(bridgeToken)}&origin=${encodeURIComponent(origin)}`;

    const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${pluginId} - Overlord Plugin</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap"
      rel="stylesheet"
    />
    <link rel="stylesheet" href="/assets/tailwind.css" />
    <link
      rel="stylesheet"
      href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css"
      crossorigin="anonymous"
      referrerpolicy="no-referrer"
    />
    <link rel="stylesheet" href="/assets/main.css" />
  </head>
  <body class="min-h-screen bg-slate-950 text-slate-100">
    <header id="top-nav"></header>
    <main class="px-5 py-6">
      <div class="max-w-6xl mx-auto">
        <div class="rounded-2xl border border-slate-800 bg-slate-900/50 overflow-hidden">
          <iframe
            id="plugin-frame"
            src="${iframeSrc}"
            sandbox="allow-scripts"
            class="w-full h-[calc(100vh-220px)] bg-slate-950"
          ></iframe>
        </div>
      </div>
    </main>
    <div
      id="plugin-host"
      data-bridge-token="${bridgeToken}"
    ></div>
    <script type="module" src="/assets/nav.js"></script>
    <script src="/assets/plugin-host.js"></script>
  </body>
</html>`;

    return new Response(html, { headers: deps.secureHeaders("text/html; charset=utf-8") });
  }

  const pluginAssetMatch = url.pathname.match(/^\/plugins\/([^/]+)\/assets\/(.+)$/);
  if (req.method === "GET" && pluginAssetMatch) {
    const [, pluginId, assetPath] = pluginAssetMatch;
    let decodedPath = assetPath;
    try {
      decodedPath = decodeURIComponent(assetPath);
    } catch {
      return new Response("Bad request", { status: 400 });
    }

    if (decodedPath.includes("\u0000") || path.isAbsolute(decodedPath)) {
      return new Response("Not found", { status: 404 });
    }

    const assetsRoot = path.join(deps.PLUGIN_ROOT, pluginId, "assets");
    const normalized = decodedPath.replace(/\\/g, "/");
    const resolvedPath = path.resolve(assetsRoot, normalized);
    const rootWithSep = assetsRoot.endsWith(path.sep) ? assetsRoot : `${assetsRoot}${path.sep}`;

    if (!resolvedPath.startsWith(rootWithSep)) {
      return new Response("Not found", { status: 404 });
    }

    const file = Bun.file(resolvedPath);
    if (await file.exists()) {
      return new Response(file, { headers: deps.secureHeaders(deps.mimeType(assetPath)) });
    }
    return new Response("Not found", { status: 404 });
  }

  return null;
}
