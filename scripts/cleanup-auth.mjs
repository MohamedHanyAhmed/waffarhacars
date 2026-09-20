#!/usr/bin/env node
/**
 * Operational Retention Cleanup Script
 *
 * Purpose:
 *   Purges expired and consumed OTP challenges (retention window: 24h)
 *   and expired rate limit buckets (retention window: 1h).
 *
 * Scheduling Recommendations:
 *   - Production Kubernetes: Run as a scheduled CronJob hourly:
 *       schedule: "0 * * * *"
 *       command: ["npm", "run", "auth:cleanup"]
 *   - Bare metal / VM: Schedule via crontab:
 *       0 * * * * cd /path/to/app && npm run auth:cleanup >> /var/log/auth-cleanup.log 2>&1
 *
 * Concurrency Safety:
 *   Protected by a 64-bit PostgreSQL advisory lock:
 *   hashtextextended('waffarhacars_auth_cleanup', 0)
 *   If another cleanup execution is active, concurrent invocations exit immediately
 *   with status 0 (no-op skip) to prevent deadlocks or duplicate sweeps.
 */

import pg from "pg";

export async function runCleanup(connectionStringOverride) {
  const connectionString =
    connectionStringOverride || process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;

  if (!connectionString) {
    console.error(
      "[auth:cleanup] FATAL: Neither DATABASE_DIRECT_URL nor DATABASE_URL is configured."
    );
    return { success: false, skipped: false, error: "MISSING_DATABASE_URL" };
  }

  let clientConnected = false;
  try {
    await client.connect();
    clientConnected = true;

    // 1. Acquire non-blocking 64-bit advisory lock
    const lockRes = await client.query(
      "SELECT pg_try_advisory_lock(hashtextextended('waffarhacars_auth_cleanup', 0)) AS acquired;"
    );
    const lockAcquired = Boolean(lockRes.rows[0]?.acquired);

    if (!lockAcquired) {
      console.log("[auth:cleanup] Concurrent cleanup process active. Skipping execution cleanly.");
      return { success: true, skipped: true };
    }

    try {
      const challengeCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const rateLimitCutoff = new Date(Date.now() - 60 * 60 * 1000);

      // 2. Purge stale challenges
      const challengeRes = await client.query(
        `DELETE FROM "otp_challenge"
         WHERE "consumedAt" <= $1
            OR "expiresAt" <= $1
            OR (
              "status" IN ('CONSUMED', 'EXPIRED', 'LOCKED', 'SUPERSEDED', 'DELIVERY_FAILED', 'DELIVERY_UNKNOWN')
              AND "createdAt" <= $1
            );`,
        [challengeCutoff]
      );

      // 3. Purge expired rate-limit buckets
      const rateLimitRes = await client.query(
        `DELETE FROM "rate_limit_bucket"
         WHERE "expireAt" <= $1;`,
        [rateLimitCutoff]
      );

      const deletedChallenges = challengeRes.rowCount ?? 0;
      const deletedRateLimits = rateLimitRes.rowCount ?? 0;

      console.log(
        `[auth:cleanup] Retention sweep completed: ${deletedChallenges} challenges, ${deletedRateLimits} rate limit buckets purged.`
      );

      return {
        success: true,
        skipped: false,
        deletedChallenges,
        deletedRateLimits,
      };
    } finally {
      await client.query(
        "SELECT pg_advisory_unlock(hashtextextended('waffarhacars_auth_cleanup', 0));"
      );
    }
  } catch (_err) {
    const errorCode = clientConnected ? "CLEANUP_EXECUTION_ERROR" : "DATABASE_CONNECTION_ERROR";
    console.error(`[auth:cleanup] ERROR: Retention cleanup failed: ${errorCode}`);
    return { success: false, skipped: false, error: errorCode };
  } finally {
    if (clientConnected) {
      await client.end().catch(() => {});
    }
  }
}

// Direct CLI invocation check
const isDirectExecution =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("cleanup-auth.mjs") || process.argv[1].includes("cleanup-auth"));

if (isDirectExecution) {
  runCleanup()
    .then((result) => {
      if (!result.success) {
        process.exitCode = 1;
      }
    })
    .catch(() => {
      console.error("[auth:cleanup] Fatal unhandled error during cleanup execution.");
      process.exitCode = 1;
    });
}
