import { describe, expect, test } from "bun:test";
import { getConfig } from "./config";
import { isRateLimited, recordFailedAttempt, recordSuccessfulAttempt } from "./rateLimit";

describe("rateLimit", () => {
  test("locks out after repeated failures", () => {
    const maxAttempts = Math.max(1, Number(getConfig().security.loginMaxAttempts) || 5);
    const ip = `10.0.0.${Date.now()}`;
    for (let i = 0; i < maxAttempts; i += 1) {
      recordFailedAttempt(ip);
    }

    const result = isRateLimited(ip);
    expect(result.limited).toBe(true);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  test("successful attempt clears lock state", () => {
    const maxAttempts = Math.max(1, Number(getConfig().security.loginMaxAttempts) || 5);
    const ip = `10.0.1.${Date.now()}`;
    for (let i = 0; i < maxAttempts; i += 1) {
      recordFailedAttempt(ip);
    }
    expect(isRateLimited(ip).limited).toBe(true);

    recordSuccessfulAttempt(ip);
    expect(isRateLimited(ip).limited).toBe(false);
  });
});
