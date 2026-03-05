import { describe, expect, test } from "bun:test";
import { isRateLimited, recordFailedAttempt, recordSuccessfulAttempt } from "./rateLimit";

describe("rateLimit", () => {
  test("locks out after repeated failures", () => {
    const ip = `10.0.0.${Date.now()}`;
    for (let i = 0; i < 5; i += 1) {
      recordFailedAttempt(ip);
    }

    const result = isRateLimited(ip);
    expect(result.limited).toBe(true);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  test("successful attempt clears lock state", () => {
    const ip = `10.0.1.${Date.now()}`;
    for (let i = 0; i < 5; i += 1) {
      recordFailedAttempt(ip);
    }
    expect(isRateLimited(ip).limited).toBe(true);

    recordSuccessfulAttempt(ip);
    expect(isRateLimited(ip).limited).toBe(false);
  });
});
