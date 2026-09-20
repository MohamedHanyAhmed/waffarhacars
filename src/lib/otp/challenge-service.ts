import crypto from "node:crypto";
import { getPrisma } from "../db";
import { getServerEnv } from "../env";
import { getSmsAdapter } from "../sms/factory";
import { OtpPurpose, OtpChallengeStatus, type OtpChallenge } from "@/generated/prisma/client";

export const OTP_VALIDITY_SECONDS = 180;
export const OTP_COOLDOWN_SECONDS = 60;
export const OTP_MAX_ATTEMPTS = 3;
export const OTP_LOCKOUT_SECONDS = 900; // 15 minutes bounded lockout

export function getOtpDispatchTimeoutMs(): number {
  try {
    return getServerEnv().OTP_DISPATCH_TIMEOUT_MS;
  } catch {
    return 8000;
  }
}

export type RequestOtpResult =
  | { success: true; cooldownSeconds: number }
  | { success: false; error: "COOLDOWN_ACTIVE"; retryAfterSeconds: number }
  | { success: false; error: "PHONE_LOCKED"; retryAfterSeconds: number }
  | { success: false; error: "SMS_DELIVERY_FAILED"; errorCategory?: string }
  | { success: false; error: "DISPATCH_SUPERSEDED" }
  | { success: false; error: "DISPATCH_LOST_RACE" };

export type VerifyOtpResult =
  | { success: true }
  | {
      success: false;
      error: "NO_ACTIVE_CHALLENGE" | "CHALLENGE_EXPIRED" | "ATTEMPTS_EXHAUSTED" | "INVALID_CODE";
      remainingAttempts?: number;
      lockoutSeconds?: number;
    };

/**
 * Acquires a 64-bit transaction-scoped advisory lock for the given phone lookup hash.
 * Uses hashtextextended(..., 0) to produce a 64-bit bigint, preventing 32-bit hashtext collisions.
 */
export async function acquirePhoneOtpAdvisoryLock(
  tx: { $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown> },
  phoneLookupHash: string
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`waffarhacars_otp:${phoneLookupHash}`}, 0));`;
}

/**
 * Computes HMAC-SHA-256 digest of an OTP code using dedicated OTP pepper secret.
 */
export function computeCodeHash(code: string, secret?: string): string {
  const pepper = secret || getServerEnv().OTP_PEPPER_SECRET;
  if (!pepper) {
    throw new Error("Configuration error: OTP_PEPPER_SECRET is required.");
  }
  return crypto.createHmac("sha256", pepper).update(`otp-code:v1\0${code}`).digest("hex");
}

/**
 * Computes non-reversible HMAC-SHA-256 digest of canonical E.164 phone for indexed lookup.
 */
export function computePhoneLookupHash(canonicalE164: string, secret?: string): string {
  const key = secret || getServerEnv().PHONE_LOOKUP_HMAC_KEY;
  if (!key) {
    throw new Error("Configuration error: PHONE_LOOKUP_HMAC_KEY is required.");
  }
  return crypto.createHmac("sha256", key).update(`phone-lookup:v1\0${canonicalE164}`).digest("hex");
}

/**
 * Generates deterministic placeholder email address with reserved .invalid domain (RFC 2606).
 */
export function generatePlaceholderEmail(canonicalE164: string, secret?: string): string {
  const key = secret || getServerEnv().PHONE_ALIAS_HMAC_KEY;
  if (!key) {
    throw new Error("Configuration error: PHONE_ALIAS_HMAC_KEY is required.");
  }
  const digest = crypto
    .createHmac("sha256", key)
    .update(`phone-alias:v1\0${canonicalE164}`)
    .digest("hex")
    .slice(0, 32);
  return `phone_${digest}@phone.waffarhacars.invalid`;
}

/**
 * Generates a cryptographically secure 6-digit decimal string.
 */
export function generateOtpCode(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

/**
 * Requests and dispatches an OTP challenge synchronously.
 *
 * Concurrency & Safety Guarantees:
 * 1. Acquires a PostgreSQL transaction-scoped 64-bit advisory lock on hashtextextended('waffarhacars_otp:' || phoneLookupHash, 0).
 * 2. Checks for locked challenges (bounded 15m lockout) and active cooldown.
 * 3. Never mutates the existing ACTIVE challenge during preparation or dispatch.
 * 4. Verification of the prior ACTIVE challenge remains fully available while replacement send is in flight.
 * 5. Recovers stale PENDING challenges before creating a new PENDING row.
 * 6. Dispatches SMS synchronously with AbortSignal, AbortController, and timeout cleanup.
 * 7. On confirmed delivery -> atomically supersedes previous ACTIVE and promotes PENDING to ACTIVE.
 * 8. On confirmed failure -> marks PENDING as DELIVERY_FAILED; previous ACTIVE remains untouched.
 * 9. On timeout/unknown -> marks PENDING as DELIVERY_UNKNOWN; previous ACTIVE remains untouched.
 */
export async function requestOtpChallenge(
  canonicalE164: string,
  purpose: OtpPurpose = OtpPurpose.CUSTOMER_AUTH,
  options?: { timeoutMs?: number }
): Promise<RequestOtpResult> {
  const prisma = getPrisma();
  const phoneLookupHash = computePhoneLookupHash(canonicalE164);
  const now = new Date();
  const dispatchTimeoutMs = options?.timeoutMs ?? getOtpDispatchTimeoutMs();

  const code = generateOtpCode();
  const codeHash = computeCodeHash(code);

  // Phase 1: Allocate challenge in PENDING state under transaction advisory lock
  type PreparationResult =
    | { action: "REJECT"; result: RequestOtpResult }
    | {
        action: "PROCEED";
        pendingId: string;
        dispatchId: string;
        previousActiveId: string | null;
        message: string;
      };

  const prep = await prisma.$transaction(async (tx): Promise<PreparationResult> => {
    // 1. Transaction-scoped 64-bit advisory lock on phone hash
    await acquirePhoneOtpAdvisoryLock(tx, phoneLookupHash);

    // 2. Check for active lockout
    const lockedRecords = await tx.$queryRaw<OtpChallenge[]>`
      SELECT * FROM "otp_challenge"
      WHERE "phoneLookupHash" = ${phoneLookupHash}
        AND "purpose" = ${purpose}::"OtpPurpose"
        AND "status" = ${OtpChallengeStatus.LOCKED}::"OtpChallengeStatus"
        AND "lockoutUntil" > ${now}
      ORDER BY "lockoutUntil" DESC
      LIMIT 1
    `;

    if (lockedRecords.length > 0 && lockedRecords[0].lockoutUntil) {
      const remainingMs = lockedRecords[0].lockoutUntil.getTime() - now.getTime();
      return {
        action: "REJECT",
        result: {
          success: false,
          error: "PHONE_LOCKED",
          retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)),
        },
      };
    }

    // 3. Stale-PENDING recovery: Recover any PENDING challenges whose dispatch lease expired
    await tx.otpChallenge.updateMany({
      where: {
        phoneLookupHash,
        purpose,
        status: OtpChallengeStatus.PENDING,
        dispatchLeaseExpiresAt: { lte: now },
      },
      data: {
        status: OtpChallengeStatus.DELIVERY_UNKNOWN,
        dispatchLeaseExpiresAt: null,
        updatedAt: now,
      },
    });

    // 4. Check for active (in-flight) PENDING challenge
    const pendingRecords = await tx.$queryRaw<OtpChallenge[]>`
      SELECT * FROM "otp_challenge"
      WHERE "phoneLookupHash" = ${phoneLookupHash}
        AND "purpose" = ${purpose}::"OtpPurpose"
        AND "status" = ${OtpChallengeStatus.PENDING}::"OtpChallengeStatus"
        AND ("dispatchLeaseExpiresAt" IS NULL OR "dispatchLeaseExpiresAt" > ${now})
      LIMIT 1
      FOR UPDATE
    `;

    if (pendingRecords.length > 0) {
      const remainingMs = Math.max(
        1000,
        (pendingRecords[0].dispatchLeaseExpiresAt?.getTime() ?? now.getTime() + 5000) -
          now.getTime()
      );
      return {
        action: "REJECT",
        result: {
          success: false,
          error: "COOLDOWN_ACTIVE",
          retryAfterSeconds: Math.ceil(remainingMs / 1000),
        },
      };
    }

    // 5. Query existing ACTIVE challenge (separate query from PENDING)
    const activeRecords = await tx.$queryRaw<OtpChallenge[]>`
      SELECT * FROM "otp_challenge"
      WHERE "phoneLookupHash" = ${phoneLookupHash}
        AND "purpose" = ${purpose}::"OtpPurpose"
        AND "status" = ${OtpChallengeStatus.ACTIVE}::"OtpChallengeStatus"
        AND "expiresAt" > ${now}
      ORDER BY "createdAt" DESC
      LIMIT 1
      FOR UPDATE
    `;

    const existingActive = activeRecords[0];

    let previousAttemptCount = 0;
    let sendCount = 1;
    let previousActiveId: string | null = null;

    if (existingActive) {
      // Check cooldown
      if (existingActive.cooldownUntil > now) {
        const remainingMs = existingActive.cooldownUntil.getTime() - now.getTime();
        return {
          action: "REJECT",
          result: {
            success: false,
            error: "COOLDOWN_ACTIVE",
            retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)),
          },
        };
      }

      previousAttemptCount = existingActive.failedAttemptCount;
      sendCount = existingActive.sendCount + 1;
      previousActiveId = existingActive.id;
    }

    // Stable dispatchId derived from lookup hash and sequence
    const dispatchId = crypto
      .createHmac("sha256", phoneLookupHash)
      .update(`dispatch:${now.getTime()}:${sendCount}`)
      .digest("hex")
      .slice(0, 32);

    const message = `رمز التحقق الخاص بك في وفّرها كارز هو: ${code}. صالح لمدة 3 دقائق. لا تشاركه مع أحد.`;
    const dispatchLeaseExpiresAt = new Date(now.getTime() + dispatchTimeoutMs + 2000);

    // Create separate PENDING challenge record.
    // NOTE: The existing ACTIVE challenge is deliberately NOT modified here.
    // Its verification remains active while SMS dispatch is in-flight.
    const created = await tx.otpChallenge.create({
      data: {
        phoneLookupHash,
        purpose,
        status: OtpChallengeStatus.PENDING,
        codeHash,
        dispatchId,
        expiresAt: new Date(now.getTime() + OTP_VALIDITY_SECONDS * 1000),
        cooldownUntil: new Date(now.getTime() + OTP_COOLDOWN_SECONDS * 1000),
        dispatchLeaseExpiresAt,
        failedAttemptCount: previousAttemptCount, // Preserve failure budget across resends
        sendCount,
      },
    });

    return {
      action: "PROCEED",
      pendingId: created.id,
      dispatchId,
      previousActiveId,
      message,
    };
  });

  if (prep.action === "REJECT") {
    return prep.result;
  }

  // Phase 2: Synchronous SMS Delivery with AbortController, timeout, and signal cancellation
  const adapter = getSmsAdapter();
  const abortController = new AbortController();
  let timeoutHandle: NodeJS.Timeout | undefined;
  let outcome:
    | { type: "SUCCESS" }
    | { type: "FAILURE"; errorCategory?: string }
    | { type: "UNKNOWN"; errorCategory: "GATEWAY_TIMEOUT" | "NETWORK_ERROR" };

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        abortController.abort();
        reject(new Error("SMS Gateway timeout"));
      }, dispatchTimeoutMs);
    });

    const sendPromise = adapter.send({
      toCanonicalE164: canonicalE164,
      message: prep.message,
      idempotencyKey: prep.dispatchId,
      timeoutMs: dispatchTimeoutMs,
      signal: abortController.signal,
    });

    const sendResult = await Promise.race([sendPromise, timeoutPromise]);
    if (sendResult && sendResult.success) {
      outcome = { type: "SUCCESS" };
    } else {
      outcome = {
        type: "FAILURE",
        errorCategory: sendResult?.errorCategory || "PROVIDER_UNAVAILABLE",
      };
    }
  } catch (err: unknown) {
    const isTimeout =
      abortController.signal.aborted ||
      ((err as Error)?.message?.toLowerCase().includes("timeout") ?? false);
    if (isTimeout) {
      outcome = { type: "UNKNOWN", errorCategory: "GATEWAY_TIMEOUT" };
    } else {
      outcome = { type: "UNKNOWN", errorCategory: "NETWORK_ERROR" };
    }
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }

  // Phase 3: Transition state based on synchronous delivery result under 64-bit advisory lock
  return await prisma.$transaction(async (tx): Promise<RequestOtpResult> => {
    await acquirePhoneOtpAdvisoryLock(tx, phoneLookupHash);

    if (outcome.type === "SUCCESS") {
      // 1. Check if previous ACTIVE challenge was consumed while replacement was in-flight
      if (prep.previousActiveId) {
        const prev = await tx.otpChallenge.findUnique({
          where: { id: prep.previousActiveId },
          select: { status: true },
        });
        if (prev?.status === OtpChallengeStatus.CONSUMED) {
          // Rule: If previous ACTIVE challenge was consumed while replacement was in-flight,
          // replacement PENDING challenge must NOT be promoted to ACTIVE.
          // Terminally mark it SUPERSEDED via CAS and return safe non-success result.
          await tx.otpChallenge.updateMany({
            where: {
              id: prep.pendingId,
              dispatchId: prep.dispatchId,
              status: OtpChallengeStatus.PENDING,
            },
            data: {
              status: OtpChallengeStatus.SUPERSEDED,
              dispatchLeaseExpiresAt: null,
              updatedAt: new Date(),
            },
          });
          return {
            success: false,
            error: "DISPATCH_SUPERSEDED",
          };
        }
      }

      // 2. Compare-and-set promote PENDING to ACTIVE
      const cas = await tx.otpChallenge.updateMany({
        where: {
          id: prep.pendingId,
          dispatchId: prep.dispatchId,
          status: OtpChallengeStatus.PENDING,
        },
        data: {
          status: OtpChallengeStatus.ACTIVE,
          dispatchLeaseExpiresAt: null,
          updatedAt: new Date(),
        },
      });

      if (cas.count === 0) {
        return {
          success: false,
          error: "DISPATCH_LOST_RACE",
        };
      }

      // 3. Do not supersede existing ACTIVE challenge until ownership of PENDING is confirmed inside the same locked transaction
      if (prep.previousActiveId) {
        await tx.otpChallenge.updateMany({
          where: { id: prep.previousActiveId, status: OtpChallengeStatus.ACTIVE },
          data: {
            status: OtpChallengeStatus.SUPERSEDED,
            updatedAt: new Date(),
          },
        });
      }

      return {
        success: true,
        cooldownSeconds: OTP_COOLDOWN_SECONDS,
      };
    }

    if (outcome.type === "FAILURE") {
      // Confirmed provider rejection: mark only PENDING as DELIVERY_FAILED via CAS
      const cas = await tx.otpChallenge.updateMany({
        where: {
          id: prep.pendingId,
          dispatchId: prep.dispatchId,
          status: OtpChallengeStatus.PENDING,
        },
        data: {
          status: OtpChallengeStatus.DELIVERY_FAILED,
          dispatchLeaseExpiresAt: null,
          updatedAt: new Date(),
        },
      });

      if (cas.count === 0) {
        return {
          success: false,
          error: "DISPATCH_LOST_RACE",
        };
      }

      return {
        success: false,
        error: "SMS_DELIVERY_FAILED",
        errorCategory: outcome.errorCategory,
      };
    }

    // Outcome is UNKNOWN (e.g. timeout or network error where provider state cannot be proven)
    // Mark PENDING as DELIVERY_UNKNOWN via CAS. Previous ACTIVE remains untouched!
    const cas = await tx.otpChallenge.updateMany({
      where: {
        id: prep.pendingId,
        dispatchId: prep.dispatchId,
        status: OtpChallengeStatus.PENDING,
      },
      data: {
        status: OtpChallengeStatus.DELIVERY_UNKNOWN,
        dispatchLeaseExpiresAt: null,
        updatedAt: new Date(),
      },
    });

    if (cas.count === 0) {
      return {
        success: false,
        error: "DISPATCH_LOST_RACE",
      };
    }

    return {
      success: false,
      error: "SMS_DELIVERY_FAILED",
      errorCategory: outcome.errorCategory,
    };
  });
}

/**
 * Atomically verifies and consumes an OTP challenge.
 *
 * Concurrency & Safety Guarantees:
 * 1. 64-bit transaction-scoped advisory lock prevents races against simultaneous requests or resends.
 * 2. SELECT ... FOR UPDATE locks the active challenge row.
 * 3. Timing-safe hash comparison prevents timing side channels.
 * 4. Increments attempt counter on failure; exhausts at 3 attempts and locks for 15 minutes.
 * 5. Consumes challenge atomically on success (status: CONSUMED, consumedAt: now).
 */
export async function verifyAndConsumeOtpChallenge(
  canonicalE164: string,
  candidateCode: string,
  purpose: OtpPurpose = OtpPurpose.CUSTOMER_AUTH
): Promise<VerifyOtpResult> {
  const prisma = getPrisma();
  const phoneLookupHash = computePhoneLookupHash(canonicalE164);
  const candidateHash = computeCodeHash(candidateCode);
  const candidateHashBuf = Buffer.from(candidateHash, "hex");
  const now = new Date();

  return await prisma.$transaction(async (tx): Promise<VerifyOtpResult> => {
    // 1. Transaction-scoped 64-bit advisory lock using shared helper
    await acquirePhoneOtpAdvisoryLock(tx, phoneLookupHash);

    // 2. Lock the active challenge row
    const activeChallenges = await tx.$queryRaw<OtpChallenge[]>`
      SELECT * FROM "otp_challenge"
      WHERE "phoneLookupHash" = ${phoneLookupHash}
        AND "purpose" = ${purpose}::"OtpPurpose"
        AND "status" = ${OtpChallengeStatus.ACTIVE}::"OtpChallengeStatus"
      ORDER BY "createdAt" DESC
      LIMIT 1
      FOR UPDATE
    `;

    const challenge = activeChallenges[0];

    // Challenge does not exist or is not in ACTIVE state
    if (!challenge) {
      return {
        success: false,
        error: "NO_ACTIVE_CHALLENGE",
      };
    }

    // Challenge has expired
    if (challenge.expiresAt <= now) {
      await tx.otpChallenge.update({
        where: { id: challenge.id },
        data: {
          status: OtpChallengeStatus.EXPIRED,
          updatedAt: now,
        },
      });
      return {
        success: false,
        error: "CHALLENGE_EXPIRED",
      };
    }

    // Check if failure budget already exhausted
    if (challenge.failedAttemptCount >= OTP_MAX_ATTEMPTS) {
      await tx.otpChallenge.update({
        where: { id: challenge.id },
        data: {
          status: OtpChallengeStatus.LOCKED,
          lockoutUntil: new Date(now.getTime() + OTP_LOCKOUT_SECONDS * 1000),
          updatedAt: now,
        },
      });
      return {
        success: false,
        error: "ATTEMPTS_EXHAUSTED",
        lockoutSeconds: OTP_LOCKOUT_SECONDS,
      };
    }

    const storedHashBuf = Buffer.from(challenge.codeHash, "hex");

    // Timing-safe comparison of code hashes
    const isMatch =
      storedHashBuf.length === candidateHashBuf.length &&
      crypto.timingSafeEqual(storedHashBuf, candidateHashBuf);

    if (!isMatch) {
      const newAttempts = challenge.failedAttemptCount + 1;

      if (newAttempts >= OTP_MAX_ATTEMPTS) {
        await tx.otpChallenge.update({
          where: { id: challenge.id },
          data: {
            failedAttemptCount: newAttempts,
            status: OtpChallengeStatus.LOCKED,
            lockoutUntil: new Date(now.getTime() + OTP_LOCKOUT_SECONDS * 1000),
            updatedAt: now,
          },
        });
        return {
          success: false,
          error: "ATTEMPTS_EXHAUSTED",
          remainingAttempts: 0,
          lockoutSeconds: OTP_LOCKOUT_SECONDS,
        };
      }

      await tx.otpChallenge.update({
        where: { id: challenge.id },
        data: {
          failedAttemptCount: newAttempts,
          updatedAt: now,
        },
      });

      return {
        success: false,
        error: "INVALID_CODE",
        remainingAttempts: OTP_MAX_ATTEMPTS - newAttempts,
      };
    }

    // Correct code: atomically consume the challenge
    await tx.otpChallenge.update({
      where: { id: challenge.id },
      data: {
        status: OtpChallengeStatus.CONSUMED,
        consumedAt: now,
        updatedAt: now,
      },
    });

    return { success: true };
  });
}

/**
 * Retention cleanup: Purges expired/consumed OTP challenges older than 24h
 * and expired rate-limit buckets older than 1h.
 */
export async function purgeExpiredAuthRecords(prismaInstance = getPrisma()): Promise<{
  deletedChallenges: number;
  deletedRateLimits: number;
}> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rateLimitCutoff = new Date(Date.now() - 60 * 60 * 1000);

  const [chRes, rlRes] = await prismaInstance.$transaction([
    prismaInstance.otpChallenge.deleteMany({
      where: {
        OR: [
          { consumedAt: { lte: cutoff } },
          { expiresAt: { lte: cutoff } },
          {
            status: {
              in: [
                OtpChallengeStatus.CONSUMED,
                OtpChallengeStatus.EXPIRED,
                OtpChallengeStatus.LOCKED,
                OtpChallengeStatus.SUPERSEDED,
                OtpChallengeStatus.DELIVERY_FAILED,
                OtpChallengeStatus.DELIVERY_UNKNOWN,
              ],
            },
            createdAt: { lte: cutoff },
          },
        ],
      },
    }),
    prismaInstance.rateLimitBucket.deleteMany({
      where: {
        expireAt: { lte: rateLimitCutoff },
      },
    }),
  ]);

  return {
    deletedChallenges: chRes.count,
    deletedRateLimits: rlRes.count,
  };
}
