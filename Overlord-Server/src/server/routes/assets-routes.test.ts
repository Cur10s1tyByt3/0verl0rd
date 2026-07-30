import { describe, expect, test } from "bun:test";
import { assetCacheControl } from "./assets-routes";

describe("asset cache policy", () => {
  test("revalidates stable JavaScript and stylesheet filenames after a deployment", () => {
    expect(assetCacheControl("remotedesktop.js")).toBe("no-cache");
    expect(assetCacheControl("main.min.js")).toBe("no-cache");
    expect(assetCacheControl("tailwind.css")).toBe("no-cache");
  });

  test("keeps binary and font assets immutable", () => {
    expect(assetCacheControl("logo.png")).toContain("immutable");
    expect(assetCacheControl("inter.woff2")).toContain("immutable");
  });
});
