import { describe, expect, test } from "bun:test";
import { createHonoRouteHandler } from "./hono-router";

describe("createHonoRouteHandler", () => {
  const routed = createHonoRouteHandler([
    {
      basePath: "/api/users",
      handler: async (_req, url, server) => Response.json({
        path: url.pathname,
        server,
      }),
    },
  ]);

  test("routes exact and nested group paths", async () => {
    const server = { name: "test-server" };
    const exactUrl = new URL("https://localhost/api/users");
    const exact = await routed(new Request(exactUrl), exactUrl, server);
    expect(exact?.status).toBe(200);
    expect(await exact?.json()).toEqual({ path: "/api/users", server });
    expect(exact?.headers.get("x-request-id")).toBeTruthy();

    const nestedUrl = new URL("https://localhost/api/users/42/role");
    const nested = await routed(new Request(nestedUrl), nestedUrl, server);
    expect(nested?.status).toBe(200);
    expect((await nested?.json()).path).toBe("/api/users/42/role");
  });

  test("does not claim similar or unrelated paths", async () => {
    for (const path of ["/api/users-other", "/api/clients"]) {
      const url = new URL(`https://localhost${path}`);
      expect(await routed(new Request(url), url, {})).toBeNull();
    }
  });

  test("falls through when a migrated handler does not own a nested route", async () => {
    const fallthrough = createHonoRouteHandler([
      {
        basePath: "/api/users",
        handler: async () => null,
      },
    ]);
    const url = new URL("https://localhost/api/users/42/permission-groups");
    expect(await fallthrough(new Request(url), url, {})).toBeNull();
  });
});
