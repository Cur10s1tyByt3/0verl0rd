import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { getSessionTtlHours, getSessionTtlSeconds } from "./auth";
import { getConfig, updateSecurityConfig, type Config } from "./config";
import { isRateLimited, recordFailedAttempt, recordSuccessfulAttempt } from "./rateLimit";

let originalSecurity: Config["security"];

beforeAll(() => {
  originalSecurity = { ...getConfig().security };
});

afterAll(async () => {
  await updateSecurityConfig({ ...originalSecurity });
});

describe("security settings", () => {
  test("session TTL helpers reflect configured policy", async () => {
    await updateSecurityConfig({ sessionTtlHours: 3 });

    expect(getSessionTtlHours()).toBe(3);
    expect(getSessionTtlSeconds()).toBe(3 * 60 * 60);
  });

  test("rate limiting honors configured max attempts", async () => {
    await updateSecurityConfig({
      loginMaxAttempts: 2,
      loginWindowMinutes: 5,
      loginLockoutMinutes: 5,
    });

    const ip = `10.9.0.${Date.now()}`;

    recordFailedAttempt(ip);
    expect(isRateLimited(ip).limited).toBe(false);

    recordFailedAttempt(ip);
    const limited = isRateLimited(ip);
    expect(limited.limited).toBe(true);
    expect(limited.retryAfter).toBeGreaterThan(0);

    recordSuccessfulAttempt(ip);
    expect(isRateLimited(ip).limited).toBe(false);
  });

  test("security bounds are clamped", async () => {
    const updated = await updateSecurityConfig({
      sessionTtlHours: 100000,
      loginMaxAttempts: 0,
      loginWindowMinutes: 0,
      loginLockoutMinutes: 0,
      passwordMinLength: 2,
    });

    expect(updated.sessionTtlHours).toBe(24 * 30);
    expect(updated.loginMaxAttempts).toBe(1);
    expect(updated.loginWindowMinutes).toBe(1);
    expect(updated.loginLockoutMinutes).toBe(1);
    expect(updated.passwordMinLength).toBe(6);
  });
});