import { describe, expect, test } from "bun:test";
import { extractTokenFromCookie, extractTokenFromHeader } from "./auth";

describe("auth token extraction", () => {
  test("extractTokenFromHeader returns bearer token", () => {
    expect(extractTokenFromHeader("Bearer abc123")).toBe("abc123");
    expect(extractTokenFromHeader("Basic abc123")).toBeNull();
  });

  test("extractTokenFromCookie finds overlord_token", () => {
    const cookie = "other=1; overlord_token=token123; theme=dark";
    expect(extractTokenFromCookie(cookie)).toBe("token123");
  });

  test("extractTokenFromCookie returns null when missing", () => {
    expect(extractTokenFromCookie("foo=bar")).toBeNull();
  });
});
