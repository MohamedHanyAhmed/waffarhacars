import { NextRequest } from "next/server";
import { getPrisma } from "./db";
import { getServerEnv } from "./env";

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * Resolves the client IP address safely according to TRUSTED_PROXY_HOPS.
 * Never naively trusts X-Forwarded-For when TRUSTED_PROXY_HOPS is 0 (direct/untrusted).
 */
export function getClientIp(req: NextRequest): string {
  const env = getServerEnv();
  const trustedHops = env.TRUSTED_PROXY_HOPS;

  if (trustedHops > 0) {
    const forwarded = req.headers.get("x-forwarded-for");
    if (forwarded) {
      const parts = forwarded
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (parts.length >= trustedHops) {
        // Pick the IP at the trusted hop boundary from the right
        return parts[parts.length - trustedHops];
      }
      return parts[0] ?? "127.0.0.1";
    }
    const realIp = req.headers.get("x-real-ip");
    if (realIp) return realIp.trim();
  }

  // In direct/untrusted mode, do not trust spoofable X-Forwarded-For header chains.
  // Fall back to x-real-ip if present or safe fallback 127.0.0.1
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  return "127.0.0.1";
}

/**
 * PostgreSQL atomic fixed-window rate limiter.
 *
 * Utilizes atomic INSERT ... ON CONFLICT ("key") DO UPDATE RETURNING points, expireAt.
 * Guaranteed zero read-modify-write race conditions even under extreme concurrency.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const prisma = getPrisma();
  const now = new Date();
  const nextExpireAt = new Date(now.getTime() + windowSeconds * 1000);

  // Atomic PostgreSQL upsert returning exact serialized counter
  const result = await prisma.$queryRaw<Array<{ points: number; expireAt: Date }>>`
    INSERT INTO "rate_limit_bucket" ("key", "points", "expireAt", "createdAt", "updatedAt")
    VALUES (${key}, 1, ${nextExpireAt}, NOW(), NOW())
    ON CONFLICT ("key") DO UPDATE
    SET "points" = CASE
        WHEN "rate_limit_bucket"."expireAt" <= NOW() THEN 1
        ELSE "rate_limit_bucket"."points" + 1
    END,
    "expireAt" = CASE
        WHEN "rate_limit_bucket"."expireAt" <= NOW() THEN ${nextExpireAt}
        ELSE "rate_limit_bucket"."expireAt"
    END,
    "updatedAt" = NOW()
    RETURNING "points", "expireAt";
  `;

  if (!result || result.length === 0) {
    // Failsafe fallback
    return { allowed: false, retryAfterSeconds: windowSeconds };
  }

  const { points, expireAt } = result[0];

  if (points <= limit) {
    return {
      allowed: true,
      retryAfterSeconds: 0,
    };
  }

  const remainingMs = Math.max(0, new Date(expireAt).getTime() - Date.now());
  const retryAfterSeconds = Math.max(1, Math.ceil(remainingMs / 1000));

  return {
    allowed: false,
    retryAfterSeconds,
  };
}
