import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import pg from "pg";
import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { getPrisma, disconnectDb } from "@/lib/db";
import { resetAuth } from "@/lib/auth";
import { resetServerEnvCache } from "@/lib/env";
import { TestSmsAdapter } from "@/lib/sms/test-adapter";
import { setSmsAdapterForTesting } from "@/lib/sms/factory";
import {
  requestOtpChallenge,
  verifyAndConsumeOtpChallenge,
  computePhoneLookupHash,
  purgeExpiredAuthRecords,
} from "@/lib/otp/challenge-service";
import { checkRateLimit } from "@/lib/rate-limit";
import { POST as requestHandler } from "@/app/api/v1/auth/phone/request/route";
import { POST as verifyHandler } from "@/app/api/v1/auth/phone/verify/route";
import { OtpChallengeStatus } from "@/generated/prisma/client";

const DEFAULT_TEST_DB_URL =
  process.env.DATABASE_URL ||
  "postgresql://test_user:test_password@localhost:5432/waffarhacars_test";

const TEST_SECRET = "test-secret-at-least-32-characters-long-12345";
const TEST_PEPPER = "test-pepper-secret-at-least-32-characters-long-12345";
const TEST_ALIAS_KEY = "test-alias-key-at-least-32-characters-long-12345";
const TEST_LOOKUP_KEY = "test-lookup-key-at-least-32-characters-long-12345";

describe("Real PostgreSQL 17 Egyptian Customer Mobile OTP & Concurrency Integration Suite", () => {
  let isDbReachable = false;
  const originalEnv = { ...process.env };
  const createdUserPhones: string[] = [];
  let testSmsAdapter: TestSmsAdapter;

  beforeAll(async () => {
    const probe = new pg.Client({
      connectionString: DEFAULT_TEST_DB_URL,
      connectionTimeoutMillis: 3000,
    });
    try {
      await probe.connect();
      const res = await probe.query("SELECT 1 AS probe");
      if (res.rows[0]?.probe === 1) {
        isDbReachable = true;
      }
    } catch {
      isDbReachable = false;
    } finally {
      await probe.end().catch(() => {});
    }
  });

  beforeEach(() => {
    resetServerEnvCache();
    resetAuth();
    process.env = { ...originalEnv };
    process.env.APP_RUNTIME_PROFILE = "showcase";
    process.env.APP_DATA_BACKEND = "postgres";
    process.env.DATABASE_URL = DEFAULT_TEST_DB_URL;
    process.env.DATABASE_DIRECT_URL = DEFAULT_TEST_DB_URL;
    process.env.BETTER_AUTH_SECRET = TEST_SECRET;
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    process.env.AUTH_TRUSTED_ORIGINS = "http://localhost:3000";
    process.env.OTP_PEPPER_SECRET = TEST_PEPPER;
    process.env.PHONE_ALIAS_HMAC_KEY = TEST_ALIAS_KEY;
    process.env.PHONE_LOOKUP_HMAC_KEY = TEST_LOOKUP_KEY;
    process.env.OTP_SMS_PROVIDER = "test";

    testSmsAdapter = new TestSmsAdapter();
    setSmsAdapterForTesting(testSmsAdapter);
  });

  afterEach(async () => {
    if (isDbReachable && createdUserPhones.length > 0) {
      try {
        const prisma = getPrisma();
        const users = await prisma.user.findMany({
          where: { phoneNumber: { in: createdUserPhones } },
          select: { id: true },
        });
        const userIds = users.map((u) => u.id);
        if (userIds.length > 0) {
          await prisma.customerProfile.deleteMany({ where: { userId: { in: userIds } } });
          await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
          await prisma.account.deleteMany({ where: { userId: { in: userIds } } });
          await prisma.user.deleteMany({ where: { id: { in: userIds } } });
        }

        for (const phone of createdUserPhones) {
          const lookup = computePhoneLookupHash(phone, TEST_LOOKUP_KEY);
          await prisma.otpChallenge.deleteMany({ where: { phoneLookupHash: lookup } });
          await prisma.rateLimitBucket.deleteMany({ where: { key: { contains: lookup } } });
        }
      } catch (err) {
        console.error("Cleanup error in afterEach:", err);
      }
      createdUserPhones.length = 0;
    }
    setSmsAdapterForTesting(null);
    await disconnectDb();
    resetAuth();
    resetServerEnvCache();
    process.env = { ...originalEnv };
  });

  afterAll(async () => {
    await disconnectDb();
    resetAuth();
    resetServerEnvCache();
    process.env = originalEnv;
  });

  function generateRandomEgyptianPhone(): string {
    const suffix = crypto.randomInt(10000000, 99999999).toString();
    const phone = `+2010${suffix}`;
    createdUserPhones.push(phone);
    return phone;
  }

  it("1. proves only one active challenge exists and resend supersedes previous code while preserving failed attempts", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const phone = generateRandomEgyptianPhone();
    const lookup = computePhoneLookupHash(phone, TEST_LOOKUP_KEY);

    const req1 = await requestOtpChallenge(phone);
    expect(req1.success).toBe(true);

    const prisma = getPrisma();
    const active1 = await prisma.otpChallenge.findMany({
      where: { phoneLookupHash: lookup, status: OtpChallengeStatus.ACTIVE },
    });
    expect(active1.length).toBe(1);
    expect(active1[0].sendCount).toBe(1);
    expect(active1[0].failedAttemptCount).toBe(0);

    const initialCode = testSmsAdapter.getLastOtp(phone);
    expect(initialCode).toBeDefined();

    // Simulate elapsed 60s cooldown and 1 failed verification attempt
    await prisma.otpChallenge.update({
      where: { id: active1[0].id },
      data: {
        cooldownUntil: new Date(Date.now() - 1000),
        failedAttemptCount: 1,
      },
    });

    // Request second code (Resend)
    const req2 = await requestOtpChallenge(phone);
    expect(req2.success).toBe(true);

    const active2 = await prisma.otpChallenge.findMany({
      where: { phoneLookupHash: lookup, status: OtpChallengeStatus.ACTIVE },
    });
    // Exactly ONE row in ACTIVE status
    expect(active2.length).toBe(1);
    expect(active2[0].sendCount).toBe(2);
    // Failure budget MUST be preserved (NIST compliance)
    expect(active2[0].failedAttemptCount).toBe(1);

    const resendCode = testSmsAdapter.getLastOtp(phone);
    expect(resendCode).toBeDefined();
    expect(resendCode).not.toBe(initialCode);

    // Verify initial superseded code FAILS
    const verifyInitial = await verifyAndConsumeOtpChallenge(phone, initialCode!);
    expect(verifyInitial.success).toBe(false);

    // Verify resend code SUCCEEDS
    const verifyResend = await verifyAndConsumeOtpChallenge(phone, resendCode!);
    expect(verifyResend.success).toBe(true);
  });

  it("2. proves 3 failed verification attempts exhausts the challenge into LOCKED state with bounded lockout", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const phone = generateRandomEgyptianPhone();
    await requestOtpChallenge(phone);
    const validCode = testSmsAdapter.getLastOtp(phone)!;

    // Attempts 1 & 2
    await verifyAndConsumeOtpChallenge(phone, "000000");
    await verifyAndConsumeOtpChallenge(phone, "111111");

    // Attempt 3: exhausts budget -> LOCKED
    const res3 = await verifyAndConsumeOtpChallenge(phone, "222222");
    expect(res3.success).toBe(false);
    if (!res3.success) {
      expect(res3.error).toBe("ATTEMPTS_EXHAUSTED");
      expect(res3.lockoutSeconds).toBe(900);
    }

    // Subsequent verify is rejected
    const res4 = await verifyAndConsumeOtpChallenge(phone, validCode);
    expect(res4.success).toBe(false);

    // Subsequent request is rejected while locked
    const reqWhileLocked = await requestOtpChallenge(phone);
    expect(reqWhileLocked.success).toBe(false);
    if (!reqWhileLocked.success) {
      expect(reqWhileLocked.error).toBe("PHONE_LOCKED");
    }

    // Fast-forward lockout in database -> recovery allowed
    const prisma = getPrisma();
    const lookup = computePhoneLookupHash(phone, TEST_LOOKUP_KEY);
    await prisma.otpChallenge.updateMany({
      where: { phoneLookupHash: lookup, status: OtpChallengeStatus.LOCKED },
      data: { lockoutUntil: new Date(Date.now() - 1000) },
    });

    const recoveredReq = await requestOtpChallenge(phone);
    expect(recoveredReq.success).toBe(true);
  });

  it("3. proves expired challenge rejects verification", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const phone = generateRandomEgyptianPhone();
    await requestOtpChallenge(phone);
    const code = testSmsAdapter.getLastOtp(phone)!;

    // Mutate expiresAt in PostgreSQL to the past
    const prisma = getPrisma();
    const lookup = computePhoneLookupHash(phone, TEST_LOOKUP_KEY);
    await prisma.otpChallenge.updateMany({
      where: { phoneLookupHash: lookup },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await verifyAndConsumeOtpChallenge(phone, code);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error).toBe("CHALLENGE_EXPIRED");
    }
  });

  it("4. proves single-use consumption: challenge cannot be used a second time", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const phone = generateRandomEgyptianPhone();
    await requestOtpChallenge(phone);
    const code = testSmsAdapter.getLastOtp(phone)!;

    // First consumption succeeds
    const res1 = await verifyAndConsumeOtpChallenge(phone, code);
    expect(res1.success).toBe(true);

    // Second consumption fails closed
    const res2 = await verifyAndConsumeOtpChallenge(phone, code);
    expect(res2.success).toBe(false);
    if (!res2.success) {
      expect(res2.error).toBe("NO_ACTIVE_CHALLENGE");
    }
  });

  it("5. CONCURRENCY HARD GATE: two competing verification requests yield exactly ONE success", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const phone = generateRandomEgyptianPhone();

    // Step 1: Request OTP
    const requestReq = new NextRequest("http://localhost:3000/api/v1/auth/phone/request", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({ phone }),
    });

    const requestRes = await requestHandler(requestReq);
    expect(requestRes.status).toBe(200);

    const validCode = testSmsAdapter.getLastOtp(phone);
    expect(validCode).toBeDefined();

    // Step 2: Concurrently fire two identical verification requests
    const createVerifyReq = () =>
      new NextRequest("http://localhost:3000/api/v1/auth/phone/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
        body: JSON.stringify({ phone, code: validCode }),
      });

    const [resA, resB] = await Promise.all([
      verifyHandler(createVerifyReq()),
      verifyHandler(createVerifyReq()),
    ]);

    const statuses = [resA.status, resB.status];
    expect(statuses).toContain(200);
    expect(statuses).toContain(400);

    const successRes = resA.status === 200 ? resA : resB;
    const successJson = await successRes.json();
    expect(successJson.authenticated).toBe(true);
    expect(successJson.token).toBeUndefined();

    // Set-Cookie contains Better Auth session token
    const setCookie = successRes.headers.get("set-cookie");
    expect(setCookie).toContain("better-auth.session_token=");
    expect(setCookie?.toLowerCase()).toContain("httponly");

    // Assert database consistency
    const prisma = getPrisma();
    const userCount = await prisma.user.count({ where: { phoneNumber: phone } });
    expect(userCount).toBe(1);

    const user = await prisma.user.findUnique({ where: { phoneNumber: phone } });
    expect(user?.phoneNumberVerified).toBe(true);

    const profileCount = await prisma.customerProfile.count({ where: { userId: user!.id } });
    expect(profileCount).toBe(1);
  });

  it("6. CONCURRENT INITIAL REQUEST HARD GATE: competing first requests serialize safely without 500 collision", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const phone = generateRandomEgyptianPhone();

    const createReq = () =>
      new NextRequest("http://localhost:3000/api/v1/auth/phone/request", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
        body: JSON.stringify({ phone }),
      });

    // Concurrently fire two requests for a brand new phone number
    const [resA, resB] = await Promise.all([
      requestHandler(createReq()),
      requestHandler(createReq()),
    ]);

    const statuses = [resA.status, resB.status];
    // Exactly one succeeds with 200; the competing request encounters 429 COOLDOWN_ACTIVE. Neither throws 500!
    expect(statuses).toContain(200);
    expect(statuses).toContain(429);

    const prisma = getPrisma();
    const lookup = computePhoneLookupHash(phone, TEST_LOOKUP_KEY);
    const activeRows = await prisma.otpChallenge.count({
      where: { phoneLookupHash: lookup, status: OtpChallengeStatus.ACTIVE },
    });
    expect(activeRows).toBe(1);
  });

  it("7. proves failed SMS provider returns 502 and marks challenge DELIVERY_FAILED", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const phone = generateRandomEgyptianPhone();
    testSmsAdapter.simulateFailure("PROVIDER_UNAVAILABLE");

    const req = new NextRequest("http://localhost:3000/api/v1/auth/phone/request", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({ phone }),
    });

    const res = await requestHandler(req);
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.type).toBe("https://waffarhacars.com/errors/sms-delivery-failed");

    const prisma = getPrisma();
    const lookup = computePhoneLookupHash(phone, TEST_LOOKUP_KEY);
    const failedRows = await prisma.otpChallenge.findMany({
      where: { phoneLookupHash: lookup, status: OtpChallengeStatus.DELIVERY_FAILED },
    });
    expect(failedRows.length).toBe(1);
  });

  it("8. proves failed resend preserves the previous active valid code", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const phone = generateRandomEgyptianPhone();

    // 1. Initial request succeeds
    const req1 = await requestOtpChallenge(phone);
    expect(req1.success).toBe(true);
    const initialCode = testSmsAdapter.getLastOtp(phone)!;

    // Fast-forward cooldown
    const prisma = getPrisma();
    const lookup = computePhoneLookupHash(phone, TEST_LOOKUP_KEY);
    await prisma.otpChallenge.updateMany({
      where: { phoneLookupHash: lookup, status: OtpChallengeStatus.ACTIVE },
      data: { cooldownUntil: new Date(Date.now() - 1000) },
    });

    // 2. Set provider failure for resend
    testSmsAdapter.simulateFailure("NETWORK_ERROR");
    const req2 = await requestOtpChallenge(phone);
    expect(req2.success).toBe(false);

    // 3. Initial code MUST still be ACTIVE and valid!
    const verifyInitial = await verifyAndConsumeOtpChallenge(phone, initialCode);
    expect(verifyInitial.success).toBe(true);
  });

  it("9. proves atomic rate limit boundary under concurrent load", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const testKey = `test_boundary_${crypto.randomUUID()}`;
    const limit = 5;
    const windowSeconds = 60;

    // Fire 10 concurrent requests at boundary limit of 5
    const results = await Promise.all(
      Array.from({ length: 10 }, () => checkRateLimit(testKey, limit, windowSeconds))
    );

    const allowedCount = results.filter((r) => r.allowed).length;
    const blockedCount = results.filter((r) => !r.allowed).length;

    expect(allowedCount).toBe(5);
    expect(blockedCount).toBe(5);
  });

  it("10. proves request with untrusted or missing Origin/Referer is rejected with 403", async () => {
    const phone = generateRandomEgyptianPhone();

    // Untrusted Origin
    const untrustedReq = new NextRequest("http://localhost:3000/api/v1/auth/phone/request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil.example.com",
      },
      body: JSON.stringify({ phone }),
    });

    const resUntrusted = await requestHandler(untrustedReq);
    expect(resUntrusted.status).toBe(403);

    // Missing Origin & Referer
    const missingReq = new NextRequest("http://localhost:3000/api/v1/auth/phone/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone }),
    });

    const resMissing = await requestHandler(missingReq);
    expect(resMissing.status).toBe(403);
  });

  it("11. proves retention cleanup removes expired challenges and rate limit buckets", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const prisma = getPrisma();
    const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000); // 48 hours ago
    const phone = generateRandomEgyptianPhone();
    const lookup = computePhoneLookupHash(phone, TEST_LOOKUP_KEY);

    // Insert an old expired challenge
    await prisma.otpChallenge.create({
      data: {
        phoneLookupHash: lookup,
        status: OtpChallengeStatus.CONSUMED,
        codeHash: "0000000000000000000000000000000000000000000000000000000000000000",
        dispatchId: "old-dispatch",
        expiresAt: oldDate,
        cooldownUntil: oldDate,
        consumedAt: oldDate,
        createdAt: oldDate,
      },
    });

    // Insert an old rate limit bucket
    await prisma.rateLimitBucket.create({
      data: {
        key: `old_bucket_${crypto.randomUUID()}`,
        points: 5,
        expireAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
        createdAt: oldDate,
      },
    });

    const purgeRes = await purgeExpiredAuthRecords(prisma);
    expect(purgeRes.deletedChallenges).toBeGreaterThanOrEqual(1);
    expect(purgeRes.deletedRateLimits).toBeGreaterThanOrEqual(1);
  });
});
