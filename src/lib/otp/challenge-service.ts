import crypto from "node:crypto";
import { getPrisma } from "../db";
import { getServerEnv } from "../env";
import { getSmsAdapter } from "../sms/factory";
import { OtpPurpose, type OtpChallenge } from "@/generated/prisma/client";

export const OTP_VALIDITY_SECONDS = 180;
export const OTP_COOLDOWN_SECONDS = 60;
export const OTP_MAX_ATTEMPTS = 3;
export const OTP_MAX_SENDS = 5;

export type RequestOtpResult =
  | { success: true; cooldownSeconds: number }
  | { success: false; error: "COOLDOWN_ACTIVE"; retryAfterSeconds: number }
  | { success: false; error: "SEND_LIMIT_EXCEEDED" | "MALFORMED_PHONE" };

export type VerifyOtpResult =
  | { success: true }
  | {
      success: false;
      error: "NO_ACTIVE_CHALLENGE" | "CHALLENGE_EXPIRED" | "ATTEMPTS_EXHAUSTED" | "INVALID_CODE";
      remainingAttempts?: number;
    };

/**
 * Computes HMAC-SHA-256 digest of an OTP code using dedicated OTP pepper secret.
 */
export function computeCodeHash(code: string, secret?: string): string {
  const pepper =
    secret || getServerEnv().OTP_PEPPER_SECRET || "default_pepper_fallback_min_32_chars_12345";
  return crypto.createHmac("sha256", pepper).update(`otp-code:v1\0${code}`).digest("hex");
}

/**
 * Computes non-reversible HMAC-SHA-256 digest of canonical E.164 phone for indexed lookup.
 */
export function computePhoneLookupHash(canonicalE164: string, secret?: string): string {
  const key =
    secret || getServerEnv().PHONE_LOOKUP_HMAC_KEY || "default_lookup_fallback_min_32_chars_12345";
  return crypto.createHmac("sha256", key).update(`phone-lookup:v1\0${canonicalE164}`).digest("hex");
}

/**
 * Generates deterministic placeholder email address with reserved .invalid domain (RFC 2606).
 */
export function generatePlaceholderEmail(canonicalE164: string, secret?: string): string {
  const key =
    secret || getServerEnv().PHONE_ALIAS_HMAC_KEY || "default_alias_fallback_min_32_chars_12345";
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
 * Requests an OTP challenge for an Egyptian canonical phone number.
 *
 * Requirements:
 * - If an unconsumed challenge exists:
 *   - Check cooldown: if cooldownUntil > now, reject with 429 Retry-After.
 *   - Check max sends limit.
 *   - Atomically overwrite codeHash, refresh expiresAt and cooldownUntil.
 *   - Preserves failedAttemptCount (failure budget is NOT reset).
 * - If no unconsumed challenge exists:
 *   - Creates new OtpChallenge record with expiresAt = +180s, cooldownUntil = +60s.
 * - Dispatches SMS via configured SmsAdapter.
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

  const result = await prisma.$transaction(async (tx) => {
    // 1. Query existing unconsumed challenge with row lock for update
    const activeChallenges = await tx.$queryRaw<OtpChallenge[]>`
      SELECT * FROM "otp_challenge"
      WHERE "phoneLookupHash" = ${phoneLookupHash}
        AND "purpose" = ${purpose}::"OtpPurpose"
        AND "consumedAt" IS NULL
      ORDER BY "createdAt" DESC
      LIMIT 1
      FOR UPDATE
    `;

    const active = activeChallenges[0];

    if (active) {
      // Check cooldown
      if (active.cooldownUntil > now) {
        const remainingMs = active.cooldownUntil.getTime() - now.getTime();
        const retryAfterSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
        return {
          success: false as const,
          error: "COOLDOWN_ACTIVE" as const,
          retryAfterSeconds,
        };
      }

      // Check max sends cap per challenge
      if (active.sendCount >= OTP_MAX_SENDS) {
        return {
          success: false as const,
          error: "SEND_LIMIT_EXCEEDED" as const,
        };
      }

      // Atomic resend: invalidate previous code by replacing codeHash, reset cooldown & expiry
      // CRITICAL: failedAttemptCount is NOT reset
      await tx.otpChallenge.update({
        where: { id: active.id },
        data: {
          codeHash,
          expiresAt: new Date(now.getTime() + OTP_VALIDITY_SECONDS * 1000),
          cooldownUntil: new Date(now.getTime() + OTP_COOLDOWN_SECONDS * 1000),
          sendCount: { increment: 1 },
          updatedAt: now,
        },
      });

      return {
        success: true as const,
        cooldownSeconds: OTP_COOLDOWN_SECONDS,
      };
    }

    // No active unconsumed challenge exists: create new challenge record
    await tx.otpChallenge.create({
      data: {
        phone: canonicalE164,
        phoneLookupHash,
        purpose,
        codeHash,
        expiresAt: new Date(now.getTime() + OTP_VALIDITY_SECONDS * 1000),
        cooldownUntil: new Date(now.getTime() + OTP_COOLDOWN_SECONDS * 1000),
        failedAttemptCount: 0,
        sendCount: 1,
      },
    });

    return {
      success: true as const,
      cooldownSeconds: OTP_COOLDOWN_SECONDS,
    };
  });

  if (result.success) {
    // Dispatch SMS asynchronously through pluggable adapter
    const adapter = getSmsAdapter();
    const message = `رمز التحقق الخاص بك في وفّرها كارز هو: ${code}. صالح لمدة 3 دقائق. لا تشاركه مع أحد.`;
    const idempotencyKey = crypto.randomUUID();

    // Fire and forget or background dispatch
    adapter
      .send({
        toCanonicalE164: canonicalE164,
        message,
        idempotencyKey,
      })
      .catch((err) => {
        // Diagnostic logging strictly excludes OTP and phone numbers
        console.error(
          "[OTP Dispatch Error] Failed to send SMS via adapter:",
          err?.message || "Unknown error"
        );
      });
  }

  return result;
}

/**
 * Atomically verifies and consumes an OTP challenge.
 *
 * Requirements:
 * - Executes in a transaction with row-level locking (SELECT ... FOR UPDATE).
 * - Enforces single-use consumption: first concurrent request consumes; second fails.
 * - Enforces max attempts: increment failedAttemptCount on wrong code; exhaust at 3.
 * - Compares code using timingSafeEqual to avoid timing side-channels.
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

  return await prisma.$transaction(async (tx) => {
    // 1. Acquire exclusive lock on the active challenge
    const activeChallenges = await tx.$queryRaw<OtpChallenge[]>`
      SELECT * FROM "otp_challenge"
      WHERE "phoneLookupHash" = ${phoneLookupHash}
        AND "purpose" = ${purpose}::"OtpPurpose"
        AND "consumedAt" IS NULL
      ORDER BY "createdAt" DESC
      LIMIT 1
      FOR UPDATE
    `;

    const challenge = activeChallenges[0];

    // Challenge does not exist or has already been consumed
    if (!challenge) {
      return {
        success: false,
        error: "NO_ACTIVE_CHALLENGE",
      };
    }

    // Challenge has expired
    if (challenge.expiresAt <= now) {
      return {
        success: false,
        error: "CHALLENGE_EXPIRED",
      };
    }

    // Failure budget exhausted
    if (challenge.failedAttemptCount >= OTP_MAX_ATTEMPTS) {
      return {
        success: false,
        error: "ATTEMPTS_EXHAUSTED",
      };
    }

    const storedHashBuf = Buffer.from(challenge.codeHash, "hex");

    // Timing-safe comparison of code hashes
    const isMatch =
      storedHashBuf.length === candidateHashBuf.length &&
      crypto.timingSafeEqual(storedHashBuf, candidateHashBuf);

    if (!isMatch) {
      const newAttempts = challenge.failedAttemptCount + 1;
      await tx.otpChallenge.update({
        where: { id: challenge.id },
        data: {
          failedAttemptCount: newAttempts,
          updatedAt: now,
        },
      });

      if (newAttempts >= OTP_MAX_ATTEMPTS) {
        return {
          success: false,
          error: "ATTEMPTS_EXHAUSTED",
          remainingAttempts: 0,
        };
      }

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
        consumedAt: now,
        updatedAt: now,
      },
    });

    return { success: true };
  });
}
