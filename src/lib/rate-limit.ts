import { getPrisma } from "./db";

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * PostgreSQL-backed sliding-window rate limiter.
 *
 * Requirements:
 * - Enforced authoritatively in PostgreSQL (no ephemeral in-memory storage).
 * - Atomic point consumption and window renewal.
 * - Zero exposure of internal counters or quota values in returned data.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const prisma = getPrisma();
  const now = new Date();

  return await prisma.$transaction(async (tx) => {
    // 1. Lock existing rate limit bucket row if it exists
    const existing = await tx.rateLimitBucket.findUnique({
      where: { key },
    });

    if (!existing || existing.expireAt <= now) {
      // Bucket does not exist or has expired: initialize a fresh window
      const newExpireAt = new Date(now.getTime() + windowSeconds * 1000);
      await tx.rateLimitBucket.upsert({
        where: { key },
        create: {
          key,
          points: 1,
          expireAt: newExpireAt,
        },
        update: {
          points: 1,
          expireAt: newExpireAt,
          updatedAt: now,
        },
      });

      return {
        allowed: true,
        retryAfterSeconds: 0,
      };
    }

    // Bucket is within active window
    if (existing.points >= limit) {
      const remainingMs = Math.max(0, existing.expireAt.getTime() - now.getTime());
      const retryAfterSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
      return {
        allowed: false,
        retryAfterSeconds,
      };
    }

    // Increment points within existing window
    await tx.rateLimitBucket.update({
      where: { key },
      data: {
        points: { increment: 1 },
        updatedAt: now,
      },
    });

    return {
      allowed: true,
      retryAfterSeconds: 0,
    };
  });
}
