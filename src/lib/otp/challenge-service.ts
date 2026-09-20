import crypto from "node:crypto";
import { getPrisma } from "../db";
import { getServerEnv } from "../env";
import { getSmsAdapter } from "../sms/factory";
import { OtpPurpose, OtpChallengeStatus, type OtpChallenge } from "@/generated/prisma/client";

export const OTP_VALIDITY_SECONDS = 180;
export const OTP_COOLDOWN_SECONDS = 60;
export const OTP_MAX_ATTEMPTS = 3;
export const OTP_MAX_SENDS = 5;
export const OTP_LOCKOUT_SECONDS = 900; // 15 minutes bounded lockout
export const OTP_DISPATCH_TIMEOUT_MS =
  typeof process !== "undefined" && process.env.OTP_DISPATCH_TIMEOUT_MS
    ? Number(process.env.OTP_DISPATCH_TIMEOUT_MS)
    : 8000; // 8 seconds default dispatch timeout

export type RequestOtpResult =
  | { success: true; cooldownSeconds: number }
  | { success: false; error: "COOLDOWN_ACTIVE"; retryAfterSeconds: number }
  | { success: false; error: "PHONE_LOCKED"; retryAfterSeconds: number }
  | { success: false; error: "SEND_LIMIT_EXCEEDED" }
  | { success: false; error: "SMS_DELIVERY_FAILED"; errorCategory?: string };

export type VerifyOtpResult =
  | { success: true }
  | {
      success: false;
      error: "NO_ACTIVE_CHALLENGE" | "CHALLENGE_EXPIRED" | "ATTEMPTS_EXHAUSTED" | "INVALID_CODE";
      remainingAttempts?: number;
      lockoutSeconds?: number;
    };

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
 * 1. Acquires a PostgreSQL transaction-scoped advisory lock on hashtext('waffarhacars_otp:' || phoneLookupHash).
 * 2. Checks for locked challenges (bounded 15m lockout) and active cooldown.
 * 3. Enforces single active challenge per phone and purpose.
 * 4. Preserves failedAttemptCount from previous challenge on resend (NIST compliance).
 * 5. Creates challenge in PENDING state with stable dispatchId.
 * 6. Dispatches SMS synchronously with 8s timeout.
 * 7. If SMS succeeds -> marks challenge ACTIVE. If resend, supersedes previous active challenge.
 * 8. If SMS fails -> marks new challenge DELIVERY_FAILED and preserves previous ACTIVE challenge untouched.
 */
export async function requestOtpChallenge(
  canonicalE164: string,
  purpose: OtpPurpose = OtpPurpose.CUSTOMER_AUTH
): Promise<RequestOtpResult> {
  const prisma = getPrisma();
  const phoneLookupHash = computePhoneLookupHash(canonicalE164);
  const now = new Date();

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
    // 1. Transaction-scoped advisory lock on phone hash
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`waffarhacars_otp:${phoneLookupHash}`}));`;

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

    // 3. Check for existing active/pending challenge
    const activeRecords = await tx.$queryRaw<OtpChallenge[]>`
      SELECT * FROM "otp_challenge"
      WHERE "phoneLookupHash" = ${phoneLookupHash}
        AND "purpose" = ${purpose}::"OtpPurpose"
        AND "status" IN (${OtpChallengeStatus.PENDING}::"OtpChallengeStatus", ${OtpChallengeStatus.ACTIVE}::"OtpChallengeStatus")
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

      // Check send limit
      if (existingActive.sendCount >= OTP_MAX_SENDS) {
        return {
          action: "REJECT",
          result: {
            success: false,
            error: "SEND_LIMIT_EXCEEDED",
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

    // Create PENDING challenge record
    // If there was an existing active challenge, temporarily set it to SUPERSEDED or keep it active until dispatch succeeds?
    // Because partial unique index is on ('PENDING', 'ACTIVE'), we cannot have two rows in ('PENDING', 'ACTIVE') simultaneously!
    // Therefore, if existingActive exists, we set existingActive to 'SUPERSEDED' provisionally.
    // If dispatch fails, we restore existingActive back to 'ACTIVE'!
    if (existingActive) {
      await tx.otpChallenge.update({
        where: { id: existingActive.id },
        data: {
          status: OtpChallengeStatus.SUPERSEDED,
          updatedAt: now,
        },
      });
    }

    const created = await tx.otpChallenge.create({
      data: {
        phoneLookupHash,
        purpose,
        status: OtpChallengeStatus.PENDING,
        codeHash,
        dispatchId,
        expiresAt: new Date(now.getTime() + OTP_VALIDITY_SECONDS * 1000),
        cooldownUntil: new Date(now.getTime() + OTP_COOLDOWN_SECONDS * 1000),
        failedAttemptCount: previousAttemptCount, // Preserve failure budget across resends!
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

  // Phase 2: Synchronous SMS Delivery with Timeout
  const adapter = getSmsAdapter();
  let dispatchSuccess = false;
  let errorCategory: string | undefined;

  try {
    const sendResult = await Promise.race([
      adapter.send({
        toCanonicalE164: canonicalE164,
        message: prep.message,
        idempotencyKey: prep.dispatchId,
        timeoutMs: OTP_DISPATCH_TIMEOUT_MS,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("SMS Gateway timeout after 8000ms")),
          OTP_DISPATCH_TIMEOUT_MS
        )
      ),
    ]);

    dispatchSuccess = Boolean(sendResult && sendResult.success);
    if (!dispatchSuccess) {
      errorCategory = sendResult?.errorCategory || "PROVIDER_UNAVAILABLE";
    }
  } catch (err: unknown) {
    dispatchSuccess = false;
    errorCategory = (err as Error)?.message?.includes("timeout")
      ? "GATEWAY_TIMEOUT"
      : "NETWORK_ERROR";
  }

  // Phase 3: Transition state based on synchronous delivery result under advisory lock
  return await prisma.$transaction(async (tx): Promise<RequestOtpResult> => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`waffarhacars_otp:${phoneLookupHash}`}));`;

    if (dispatchSuccess) {
      // Transition PENDING -> ACTIVE
      await tx.otpChallenge.update({
        where: { id: prep.pendingId },
        data: {
          status: OtpChallengeStatus.ACTIVE,
          updatedAt: new Date(),
        },
      });

      return {
        success: true,
        cooldownSeconds: OTP_COOLDOWN_SECONDS,
      };
    } else {
      // Transition PENDING -> DELIVERY_FAILED
      await tx.otpChallenge.update({
        where: { id: prep.pendingId },
        data: {
          status: OtpChallengeStatus.DELIVERY_FAILED,
          updatedAt: new Date(),
        },
      });

      // If resend failed, restore the previous challenge back to ACTIVE so the user is not stranded!
      if (prep.previousActiveId) {
        await tx.otpChallenge.update({
          where: { id: prep.previousActiveId },
          data: {
            status: OtpChallengeStatus.ACTIVE,
            updatedAt: new Date(),
          },
        });
      }

      return {
        success: false,
        error: "SMS_DELIVERY_FAILED",
        errorCategory,
      };
    }
  });
}

/**
 * Atomically verifies and consumes an OTP challenge.
 *
 * Concurrency & Safety Guarantees:
 * 1. Transaction-scoped advisory lock prevents races against simultaneous requests or resends.
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
    // 1. Transaction-scoped advisory lock
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`waffarhacars_otp:${phoneLookupHash}`}));`;

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
