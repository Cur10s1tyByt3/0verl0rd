import { logger } from "./logger";
import { getConfig } from "./config";

interface RateLimitEntry {
  attempts: number;
  firstAttempt: number;
  lockedUntil?: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

const CLEANUP_INTERVAL = 60 * 1000;

function getRateLimitPolicy() {
  const security = getConfig().security;
  const maxAttempts = Math.min(50, Math.max(1, Number(security.loginMaxAttempts) || 5));
  const windowMs = Math.min(24 * 60 * 60 * 1000, Math.max(60 * 1000, (Number(security.loginWindowMinutes) || 15) * 60 * 1000));
  const lockoutMs = Math.min(24 * 60 * 60 * 1000, Math.max(60 * 1000, (Number(security.loginLockoutMinutes) || 30) * 60 * 1000));
  return { maxAttempts, windowMs, lockoutMs };
}

export function isRateLimited(ip: string): {
  limited: boolean;
  retryAfter?: number;
} {
  const policy = getRateLimitPolicy();
  const entry = rateLimitStore.get(ip);

  if (!entry) {
    return { limited: false };
  }

  const now = Date.now();

  if (entry.lockedUntil && entry.lockedUntil > now) {
    const retryAfter = Math.ceil((entry.lockedUntil - now) / 1000);
    return { limited: true, retryAfter };
  }

  if (now - entry.firstAttempt > policy.windowMs) {
    rateLimitStore.delete(ip);
    return { limited: false };
  }

  if (entry.attempts >= policy.maxAttempts) {
    entry.lockedUntil = now + policy.lockoutMs;
    const retryAfter = Math.ceil(policy.lockoutMs / 1000);
    logger.warn(
      `[rate-limit] IP ${ip} locked out for ${retryAfter}s after ${entry.attempts} failed attempts`,
    );
    return { limited: true, retryAfter };
  }

  return { limited: false };
}

export function recordFailedAttempt(ip: string): void {
  const policy = getRateLimitPolicy();
  const now = Date.now();
  const entry = rateLimitStore.get(ip);

  if (!entry) {
    rateLimitStore.set(ip, {
      attempts: 1,
      firstAttempt: now,
    });
    return;
  }

  if (now - entry.firstAttempt > policy.windowMs) {
    rateLimitStore.set(ip, {
      attempts: 1,
      firstAttempt: now,
    });
    return;
  }

  entry.attempts++;
  logger.debug(
    `[rate-limit] IP ${ip} failed attempt ${entry.attempts}/${policy.maxAttempts}`,
  );
}

export function recordSuccessfulAttempt(ip: string): void {
  rateLimitStore.delete(ip);
}

function cleanupExpired(): void {
  const policy = getRateLimitPolicy();
  const now = Date.now();
  let cleaned = 0;

  for (const [ip, entry] of rateLimitStore.entries()) {
    const windowExpired = now - entry.firstAttempt > policy.windowMs;
    const lockoutExpired = entry.lockedUntil && entry.lockedUntil < now;

    if ((windowExpired && !entry.lockedUntil) || lockoutExpired) {
      rateLimitStore.delete(ip);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logger.debug(`[rate-limit] Cleaned up ${cleaned} expired entries`);
  }
}

export function getRateLimitStats(): { total: number; locked: number } {
  const now = Date.now();
  let locked = 0;

  for (const entry of rateLimitStore.values()) {
    if (entry.lockedUntil && entry.lockedUntil > now) {
      locked++;
    }
  }

  return {
    total: rateLimitStore.size,
    locked,
  };
}

setInterval(cleanupExpired, CLEANUP_INTERVAL);

const initialPolicy = getRateLimitPolicy();
logger.info(
  `[rate-limit] Initialized: ${initialPolicy.maxAttempts} attempts per ${Math.round(initialPolicy.windowMs / 60000)} minutes, ${Math.round(initialPolicy.lockoutMs / 60000)} minute lockout`,
);
