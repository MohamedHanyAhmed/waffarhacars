import { isIP } from "node:net";
import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { getPrisma } from "./db";
import { getServerEnv } from "./env";

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

const MAX_FORWARDED_HEADER_LENGTH = 512;
const MAX_FORWARDED_ENTRIES = 20;

/**
 * Resolves the client IP address safely according to TRUSTED_PROXY_HOPS.
 *
 * Security Invariants:
 * - When TRUSTED_PROXY_HOPS === 0 (direct/untrusted ingress):
 *   Both X-Forwarded-For and X-Real-IP are strictly IGNORED and NEVER returned.
 *   Returns safe fallback "127.0.0.1".
 * - When TRUSTED_PROXY_HOPS > 0:
 *   Bounds header length (<= 512) and entry count (<= 20).
 *   Picks the IP at `entries.length - trustedHops` from the right boundary.
 *   Validates address strictly with node:net `isIP`.
 *   Falls back to "127.0.0.1" if unparseable or invalid.
 */
export function getClientIp(req: NextRequest): string {
  const env = getServerEnv();
  const trustedHops = env.TRUSTED_PROXY_HOPS;

  // In untrusted/direct mode, strictly ignore both X-Forwarded-For and X-Real-IP
  if (trustedHops <= 0) {
    return "127.0.0.1";
  }

  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    if (forwarded.length > MAX_FORWARDED_HEADER_LENGTH) {
      return "127.0.0.1";
    }

    const parts = forwarded
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (parts.length > MAX_FORWARDED_ENTRIES || parts.length === 0) {
      return "127.0.0.1";
    }

    const candidate = parts.length >= trustedHops ? parts[parts.length - trustedHops] : parts[0];

    if (candidate && isIP(candidate) !== 0) {
      return candidate;
    }
    return "127.0.0.1";
  }

  const realIp = req.headers.get("x-real-ip");
  if (realIp) {
    const trimmed = realIp.trim();
    if (trimmed.length <= 45 && isIP(trimmed) !== 0) {
      return trimmed;
    }
  }

  return "127.0.0.1";
}

/**
 * Hashes a normalized IP address to produce a safe, fixed-length rate-limit key token.
 */
export function hashIpAddress(ip: string): string {
  return crypto
    .createHash("sha256")
    .update(`ip:v1:${ip.trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * Hashes a normalized email address using HMAC-SHA256 to produce a non-reversible,
 * domain-separated lookup token for account-level rate limiting without logging or
 * persisting plaintext email addresses.
 */
export function hashEmailIdentifier(email: string, secretKey: string): string {
  const normalized = email.trim().toLowerCase();
  return crypto
    .createHmac("sha256", secretKey)
    .update(`staff-email-rate-limit:v1\0${normalized}`)
    .digest("hex")
    .slice(0, 32);
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
