import { Hono, type Handler } from "hono";
import { requestId } from "hono/request-id";
import type { RouteHandler } from "./http-dispatch";

type RouterEnv = {
  Bindings: {
    server: unknown;
  };
};

const FALLTHROUGH_HEADER = "X-Overlord-Route-Fallthrough";

export type HonoRouteGroup = {
  basePath: `/${string}`;
  handler: RouteHandler;
};

function ownsPath(basePath: string, pathname: string): boolean {
  return pathname === basePath || pathname.startsWith(`${basePath}/`);
}

export function createHonoRouteHandler(groups: readonly HonoRouteGroup[]): RouteHandler {
  const app = new Hono<RouterEnv>();
  app.use("*", requestId());
  app.use("*", async (context, next) => {
    await next();
    context.res.headers.set("X-Request-Id", context.get("requestId"));
  });

  for (const group of groups) {
    const run: Handler<RouterEnv> = async (context) => {
      const req = context.req.raw;
      const response = await group.handler(
        req,
        new URL(req.url),
        context.env.server,
      );
      return response ?? new Response(null, {
        status: 404,
        headers: { [FALLTHROUGH_HEADER]: "1" },
      });
    };
    app.all(group.basePath, run);
    app.all(`${group.basePath}/*`, run);
  }

  return async (req, url, server) => {
    if (!groups.some((group) => ownsPath(group.basePath, url.pathname))) {
      return null;
    }
    const response = await app.fetch(req, { server });
    if (response.headers.get(FALLTHROUGH_HEADER) === "1") {
      return null;
    }
    return response;
  };
}
