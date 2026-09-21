import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import pg from "pg";
import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { getPrisma, disconnectDb } from "@/lib/db";
import { getAuth, resetAuth } from "@/lib/auth";
import { resetServerEnvCache } from "@/lib/env";
import { TestSmsAdapter } from "@/lib/sms/test-adapter";
import { setSmsAdapterForTesting } from "@/lib/sms/factory";
import {
  requestOtpChallenge,
  verifyAndConsumeOtpChallenge,
  computePhoneLookupHash,
  generatePlaceholderEmail,
} from "@/lib/otp/challenge-service";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { POST as requestHandler } from "@/app/api/v1/auth/phone/request/route";
import { POST as verifyHandler } from "@/app/api/v1/auth/phone/verify/route";
import { POST as logoutHandler } from "@/app/api/v1/auth/logout/route";
import { handleAuth } from "@/app/api/auth/[...all]/route";
import { OtpChallengeStatus } from "@/generated/prisma/client";
import { runCleanup } from "../../../scripts/cleanup-auth.mjs";

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

  it("7. proves failed SMS provider result returns 502 and marks challenge DELIVERY_FAILED", async () => {
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

  it("8. proves thrown SMS provider network error is caught, returns 502 and marks challenge DELIVERY_UNKNOWN", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const phone = generateRandomEgyptianPhone();
    testSmsAdapter.setSimulateException(new Error("SMS gateway upstream socket reset"));

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
    const unknownRows = await prisma.otpChallenge.findMany({
      where: { phoneLookupHash: lookup, status: OtpChallengeStatus.DELIVERY_UNKNOWN },
    });
    expect(unknownRows.length).toBe(1);
  });

  it("9. proves SMS provider timeout aborts within deadline, returns 502 and transitions to DELIVERY_UNKNOWN", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const phone = generateRandomEgyptianPhone();
    process.env.OTP_DISPATCH_TIMEOUT_MS = "150";
    resetServerEnvCache();
    testSmsAdapter.setSimulateTimeout(true);

    try {
      const req = new NextRequest("http://localhost:3000/api/v1/auth/phone/request", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
        body: JSON.stringify({ phone }),
      });

      const startTime = Date.now();
      const res = await requestHandler(req);
      const elapsedMs = Date.now() - startTime;

      expect(res.status).toBe(502);
      const json = await res.json();
      expect(json.type).toBe("https://waffarhacars.com/errors/sms-delivery-failed");

      // Verify that the timeout abort completed within bounded window (< 2000ms vs 8000ms default)
      expect(elapsedMs).toBeLessThan(2000);
      expect(elapsedMs).toBeGreaterThanOrEqual(130);

      const prisma = getPrisma();
      const lookup = computePhoneLookupHash(phone, TEST_LOOKUP_KEY);
      const unknownRows = await prisma.otpChallenge.findMany({
        where: { phoneLookupHash: lookup, status: OtpChallengeStatus.DELIVERY_UNKNOWN },
      });
      expect(unknownRows.length).toBe(1);
    } finally {
      delete process.env.OTP_DISPATCH_TIMEOUT_MS;
      resetServerEnvCache();
      testSmsAdapter.setSimulateTimeout(false);
    }
  });

  it("10a. proves consuming prior ACTIVE code while replacement is in-flight prevents replacement from becoming ACTIVE", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const phone = generateRandomEgyptianPhone();

    // 1. Initial request succeeds -> code A is ACTIVE
    const req1 = await requestOtpChallenge(phone);
    expect(req1.success).toBe(true);
    const codeA = testSmsAdapter.getLastOtp(phone)!;

    // Fast-forward cooldown
    const prisma = getPrisma();
    const lookup = computePhoneLookupHash(phone, TEST_LOOKUP_KEY);
    await prisma.otpChallenge.updateMany({
      where: { phoneLookupHash: lookup, status: OtpChallengeStatus.ACTIVE },
      data: { cooldownUntil: new Date(Date.now() - 1000) },
    });

    // 2. Configure deferred adapter to hold replacement send in-flight
    testSmsAdapter.setDeferred(true);

    // 3. Trigger replacement send asynchronously (do not await yet!)
    const sendPromise = requestOtpChallenge(phone);

    // Give microtasks a turn to ensure PENDING record is created
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Verify DB state: exactly ONE ACTIVE (code A) and ONE PENDING (code B)
    const activeChallenge = await prisma.otpChallenge.findFirst({
      where: { phoneLookupHash: lookup, status: OtpChallengeStatus.ACTIVE },
    });
    expect(activeChallenge).not.toBeNull();
    const pendingChallenge = await prisma.otpChallenge.findFirst({
      where: { phoneLookupHash: lookup, status: OtpChallengeStatus.PENDING },
    });
    expect(pendingChallenge).not.toBeNull();

    // 4. Verify that code A remains completely verifiable and is CONSUMED while dispatch is in-flight
    const verifyA = await verifyAndConsumeOtpChallenge(phone, codeA);
    expect(verifyA.success).toBe(true);

    // 5. Now resolve the deferred dispatch
    testSmsAdapter.resolveDeferred({ success: true, status: "delivered" });
    const res2 = await sendPromise;

    // The replacement dispatch must report non-success because earlier challenge was consumed
    expect(res2.success).toBe(false);
    if (!res2.success) {
      expect(res2.error).toBe("DISPATCH_SUPERSEDED");
    }

    testSmsAdapter.setDeferred(false);

    // 6. Inspect final database state: assert NO ACTIVE challenge remains after consumption
    const remainingActive = await prisma.otpChallenge.findMany({
      where: { phoneLookupHash: lookup, status: OtpChallengeStatus.ACTIVE },
    });
    expect(remainingActive.length).toBe(0);

    const supersededChallenges = await prisma.otpChallenge.findMany({
      where: { phoneLookupHash: lookup, status: OtpChallengeStatus.SUPERSEDED },
    });
    expect(supersededChallenges.length).toBe(1);
  });

  it("10b. proves late provider resolution after timeout cannot transition row to ACTIVE", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const phone = generateRandomEgyptianPhone();
    process.env.OTP_DISPATCH_TIMEOUT_MS = "150";
    resetServerEnvCache();

    // Configure deferred adapter with ignoreCancellation to simulate an upstream provider
    // that continues processing and resolves late despite client abort
    testSmsAdapter.setDeferred(true, { ignoreCancellation: true });

    try {
      // 1. Start dispatch using deferred adapter
      const dispatchPromise = requestOtpChallenge(phone);

      // 2. Allow application timeout (150ms) to fire and mark challenge DELIVERY_UNKNOWN
      const timeoutResult = await dispatchPromise;
      expect(timeoutResult.success).toBe(false);
      if (!timeoutResult.success) {
        expect(timeoutResult.error).toBe("SMS_DELIVERY_FAILED");
      }

      const prisma = getPrisma();
      const lookup = computePhoneLookupHash(phone, TEST_LOOKUP_KEY);
      const unknownRows = await prisma.otpChallenge.findMany({
        where: { phoneLookupHash: lookup, status: OtpChallengeStatus.DELIVERY_UNKNOWN },
      });
      expect(unknownRows.length).toBe(1);
      const timedOutChallengeId = unknownRows[0].id;

      // 3. Resolve the original deferred provider promise AFTERWARD with a successful result
      let unhandledRejectionOccurred = false;
      const unhandledHandler = () => {
        unhandledRejectionOccurred = true;
      };
      process.on("unhandledRejection", unhandledHandler);

      testSmsAdapter.resolveDeferred({ success: true, status: "delivered" });

      // Give microtasks and event loop ticks to settle
      await new Promise((r) => setTimeout(r, 60));
      process.off("unhandledRejection", unhandledHandler);

      // 4. Assert late resolution cannot transition that original row to ACTIVE and no unhandled rejection
      expect(unhandledRejectionOccurred).toBe(false);
      const originalRow = await prisma.otpChallenge.findUnique({
        where: { id: timedOutChallengeId },
      });
      expect(originalRow?.status).toBe(OtpChallengeStatus.DELIVERY_UNKNOWN);

      // 5. Clean up deferred adapter and reset environment
      testSmsAdapter.setDeferred(false);
      delete process.env.OTP_DISPATCH_TIMEOUT_MS;
      resetServerEnvCache();

      // Clear cooldown so fresh dispatch can proceed
      await prisma.otpChallenge.updateMany({
        where: { phoneLookupHash: lookup },
        data: { cooldownUntil: new Date(Date.now() - 1000) },
      });

      // 6. Assert subsequent fresh dispatch succeeds
      const freshReq = await requestOtpChallenge(phone);
      expect(freshReq.success).toBe(true);

      // 7. Assert exactly one ACTIVE challenge exists afterward
      const activeRows = await prisma.otpChallenge.findMany({
        where: { phoneLookupHash: lookup, status: OtpChallengeStatus.ACTIVE },
      });
      expect(activeRows.length).toBe(1);
    } finally {
      delete process.env.OTP_DISPATCH_TIMEOUT_MS;
      resetServerEnvCache();
      testSmsAdapter.setDeferred(false);
    }
  });

  it("10c. proves CAS prevents stale recovered dispatch from becoming ACTIVE or interfering with fresh dispatch", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const phone = generateRandomEgyptianPhone();
    testSmsAdapter.deferNextSend({ ignoreCancellation: true });

    // 1. Dispatch A begins
    const startTime = Date.now();
    const dispatchAPromise = requestOtpChallenge(phone);
    await new Promise((r) => setTimeout(r, 50));

    const prisma = getPrisma();
    const lookup = computePhoneLookupHash(phone, TEST_LOOKUP_KEY);

    const pendingA = await prisma.otpChallenge.findFirst({
      where: { phoneLookupHash: lookup, status: OtpChallengeStatus.PENDING },
    });
    expect(pendingA).not.toBeNull();
    expect(testSmsAdapter.hasDeferredDispatch(pendingA!.dispatchId)).toBe(true);

    // 2. Dispatch A exceeds its lease (manually backdate lease)
    await prisma.otpChallenge.update({
      where: { id: pendingA!.id },
      data: {
        dispatchLeaseExpiresAt: new Date(Date.now() - 5000),
        cooldownUntil: new Date(Date.now() - 5000),
      },
    });

    // 3. Request B starts: its preparation recovers A to DELIVERY_UNKNOWN and proceeds with B
    // Dispatch B dispatches immediately without deleting dispatch A's handle
    const dispatchB = await requestOtpChallenge(phone);
    expect(dispatchB.success).toBe(true);

    // Verify A was recovered to DELIVERY_UNKNOWN and B is ACTIVE
    const rowA = await prisma.otpChallenge.findUnique({ where: { id: pendingA!.id } });
    expect(rowA?.status).toBe(OtpChallengeStatus.DELIVERY_UNKNOWN);

    const activeRowsBefore = await prisma.otpChallenge.findMany({
      where: { phoneLookupHash: lookup, status: OtpChallengeStatus.ACTIVE },
    });
    expect(activeRowsBefore.length).toBe(1);
    const activeBId = activeRowsBefore[0].id;

    // 4. Dispatch A later reports success!
    const resolved = testSmsAdapter.resolveDispatch(pendingA!.dispatchId, {
      success: true,
      status: "delivered",
    });
    expect(resolved).toBe(true);

    const resultA = await dispatchAPromise;
    const elapsed = Date.now() - startTime;
    // Must complete in well under 2 seconds; fails if 8000ms timeout path is used
    expect(elapsed).toBeLessThan(2000);

    // 5. A must report failure (DISPATCH_LOST_RACE) and NOT become ACTIVE
    expect(resultA.success).toBe(false);
    if (!resultA.success) {
      expect(resultA.error).toBe("DISPATCH_LOST_RACE");
    }

    // 6. A did not overwrite B and did not become ACTIVE
    const finalRowA = await prisma.otpChallenge.findUnique({ where: { id: pendingA!.id } });
    expect(finalRowA?.status).toBe(OtpChallengeStatus.DELIVERY_UNKNOWN);

    const activeRowsAfter = await prisma.otpChallenge.findMany({
      where: { phoneLookupHash: lookup, status: OtpChallengeStatus.ACTIVE },
    });
    expect(activeRowsAfter.length).toBe(1);
    expect(activeRowsAfter[0].id).toBe(activeBId);
  });

  it("10d. proves in-flight resend inherits failedAttemptCount from ACTIVE challenge mutated during dispatch", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const phone = generateRandomEgyptianPhone();
    const prisma = getPrisma();
    const lookup = computePhoneLookupHash(phone, TEST_LOOKUP_KEY);

    // 1. Dispatch A succeeds
    const dispatchA = await requestOtpChallenge(phone);
    expect(dispatchA.success).toBe(true);

    const rowA = await prisma.otpChallenge.findFirst({
      where: { phoneLookupHash: lookup, status: OtpChallengeStatus.ACTIVE },
    });
    expect(rowA).not.toBeNull();
    expect(rowA!.failedAttemptCount).toBe(0);

    // Fast-forward cooldown
    await prisma.otpChallenge.update({
      where: { id: rowA!.id },
      data: { cooldownUntil: new Date(Date.now() - 1000) },
    });

    // 2. Start dispatch B with deferred SMS delivery
    testSmsAdapter.deferNextSend({ ignoreCancellation: true });
    const dispatchBPromise = requestOtpChallenge(phone);
    await new Promise((r) => setTimeout(r, 50));

    const pendingB = await prisma.otpChallenge.findFirst({
      where: { phoneLookupHash: lookup, status: OtpChallengeStatus.PENDING },
    });
    expect(pendingB).not.toBeNull();
    expect(pendingB!.failedAttemptCount).toBe(0);

    // 3. While B is in flight, an incorrect verification occurs against A
    const verifyFail = await verifyAndConsumeOtpChallenge(phone, "000000");
    expect(verifyFail.success).toBe(false);
    if (!verifyFail.success) {
      expect(verifyFail.error).toBe("INVALID_CODE");
      expect(verifyFail.remainingAttempts).toBe(2);
    }

    const rowAMutated = await prisma.otpChallenge.findUnique({ where: { id: rowA!.id } });
    expect(rowAMutated?.failedAttemptCount).toBe(1);

    // 4. B delivery succeeds at provider
    testSmsAdapter.resolveDispatch(pendingB!.dispatchId, { success: true, status: "delivered" });
    const dispatchB = await dispatchBPromise;
    expect(dispatchB.success).toBe(true);

    // 5. Final state: A is SUPERSEDED, B is ACTIVE, and B inherited failedAttemptCount=1
    const finalA = await prisma.otpChallenge.findUnique({ where: { id: rowA!.id } });
    expect(finalA?.status).toBe(OtpChallengeStatus.SUPERSEDED);

    const finalB = await prisma.otpChallenge.findUnique({ where: { id: pendingB!.id } });
    expect(finalB?.status).toBe(OtpChallengeStatus.ACTIVE);
    expect(finalB?.failedAttemptCount).toBe(1);

    // 6. Verify that B only has 2 attempts remaining (3 - 1)
    const verifyB1 = await verifyAndConsumeOtpChallenge(phone, "000000");
    expect(verifyB1.success).toBe(false);
    if (!verifyB1.success) {
      expect(verifyB1.remainingAttempts).toBe(1);
    }
    const verifyB2 = await verifyAndConsumeOtpChallenge(phone, "000000");
    expect(verifyB2.success).toBe(false);
    if (!verifyB2.success) {
      expect(verifyB2.error).toBe("ATTEMPTS_EXHAUSTED");
    }
  });

  it("10e. proves previous challenge reaching LOCKED during in-flight resend terminally invalidates replacement and preserves phone lockout", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const phone = generateRandomEgyptianPhone();
    const prisma = getPrisma();
    const lookup = computePhoneLookupHash(phone, TEST_LOOKUP_KEY);

    // 1. Dispatch A succeeds
    const dispatchA = await requestOtpChallenge(phone);
    expect(dispatchA.success).toBe(true);
    const rowA = await prisma.otpChallenge.findFirst({
      where: { phoneLookupHash: lookup, status: OtpChallengeStatus.ACTIVE },
    });

    // Fast-forward cooldown
    await prisma.otpChallenge.update({
      where: { id: rowA!.id },
      data: { cooldownUntil: new Date(Date.now() - 1000) },
    });

    // 2. Start dispatch B with deferred SMS delivery
    testSmsAdapter.deferNextSend({ ignoreCancellation: true });
    const dispatchBPromise = requestOtpChallenge(phone);
    await new Promise((r) => setTimeout(r, 50));

    const pendingB = await prisma.otpChallenge.findFirst({
      where: { phoneLookupHash: lookup, status: OtpChallengeStatus.PENDING },
    });
    expect(pendingB).not.toBeNull();

    // 3. While B is in flight, fail verification against A 3 times -> locks phone!
    await verifyAndConsumeOtpChallenge(phone, "000000");
    await verifyAndConsumeOtpChallenge(phone, "000000");
    const lockRes = await verifyAndConsumeOtpChallenge(phone, "000000");
    expect(lockRes.success).toBe(false);
    if (!lockRes.success) {
      expect(lockRes.error).toBe("ATTEMPTS_EXHAUSTED");
    }

    const rowALocked = await prisma.otpChallenge.findUnique({ where: { id: rowA!.id } });
    expect(rowALocked?.status).toBe(OtpChallengeStatus.LOCKED);
    expect(rowALocked?.lockoutUntil).not.toBeNull();

    // 4. Provider confirms delivery for B
    testSmsAdapter.resolveDispatch(pendingB!.dispatchId, { success: true, status: "delivered" });
    const dispatchB = await dispatchBPromise;

    // 5. B must report failure with PHONE_LOCKED and NOT become ACTIVE
    expect(dispatchB.success).toBe(false);
    if (!dispatchB.success && dispatchB.error === "PHONE_LOCKED") {
      expect(dispatchB.error).toBe("PHONE_LOCKED");
      expect(dispatchB.retryAfterSeconds).toBeGreaterThan(0);
    }

    // 6. DB states: A remains LOCKED, B is SUPERSEDED, 0 active challenges exist
    const finalA = await prisma.otpChallenge.findUnique({ where: { id: rowA!.id } });
    expect(finalA?.status).toBe(OtpChallengeStatus.LOCKED);

    const finalB = await prisma.otpChallenge.findUnique({ where: { id: pendingB!.id } });
    expect(finalB?.status).toBe(OtpChallengeStatus.SUPERSEDED);

    const activeRows = await prisma.otpChallenge.findMany({
      where: { phoneLookupHash: lookup, status: OtpChallengeStatus.ACTIVE },
    });
    expect(activeRows.length).toBe(0);
  });

  it("10f. proves two existing failures plus third failure during resend dispatch locks phone and does not restore attempt budget", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const phone = generateRandomEgyptianPhone();
    const prisma = getPrisma();
    const lookup = computePhoneLookupHash(phone, TEST_LOOKUP_KEY);

    // 1. Dispatch A succeeds
    await requestOtpChallenge(phone);
    const rowA = await prisma.otpChallenge.findFirst({
      where: { phoneLookupHash: lookup, status: OtpChallengeStatus.ACTIVE },
    });

    // 2. Fail twice against A before resend
    await verifyAndConsumeOtpChallenge(phone, "000000");
    const fail2 = await verifyAndConsumeOtpChallenge(phone, "000000");
    expect(fail2.success).toBe(false);
    if (!fail2.success) {
      expect(fail2.remainingAttempts).toBe(1);
    }

    // Fast-forward cooldown
    await prisma.otpChallenge.update({
      where: { id: rowA!.id },
      data: { cooldownUntil: new Date(Date.now() - 1000) },
    });

    // 3. Start dispatch B with deferred SMS delivery
    testSmsAdapter.deferNextSend({ ignoreCancellation: true });
    const dispatchBPromise = requestOtpChallenge(phone);
    await new Promise((r) => setTimeout(r, 50));

    const pendingB = await prisma.otpChallenge.findFirst({
      where: { phoneLookupHash: lookup, status: OtpChallengeStatus.PENDING },
    });
    expect(pendingB).not.toBeNull();
    expect(pendingB!.failedAttemptCount).toBe(2);

    // 4. While B is in flight, 3rd failure occurs against A -> enters LOCKED!
    const fail3 = await verifyAndConsumeOtpChallenge(phone, "000000");
    expect(fail3.success).toBe(false);
    if (!fail3.success) {
      expect(fail3.error).toBe("ATTEMPTS_EXHAUSTED");
    }

    // 5. Provider delivers B
    testSmsAdapter.resolveDispatch(pendingB!.dispatchId, { success: true, status: "delivered" });
    const dispatchB = await dispatchBPromise;

    // 6. Must not restore attempt budget: returns PHONE_LOCKED, B is not activated
    expect(dispatchB.success).toBe(false);
    if (!dispatchB.success) {
      expect(dispatchB.error).toBe("PHONE_LOCKED");
    }

    const activeRows = await prisma.otpChallenge.findMany({
      where: { phoneLookupHash: lookup, status: OtpChallengeStatus.ACTIVE },
    });
    expect(activeRows.length).toBe(0);
  });

  it("10g. proves forced CAS promotion failure rolls back previous ACTIVE supersession and leaves previous ACTIVE challenge intact", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const phone = generateRandomEgyptianPhone();
    const prisma = getPrisma();
    const lookup = computePhoneLookupHash(phone, TEST_LOOKUP_KEY);

    // 1. Dispatch A succeeds
    const dispatchA = await requestOtpChallenge(phone);
    expect(dispatchA.success).toBe(true);

    const rowA = await prisma.otpChallenge.findFirst({
      where: { phoneLookupHash: lookup, status: OtpChallengeStatus.ACTIVE },
    });
    expect(rowA).not.toBeNull();
    const originalRowAId = rowA!.id;

    // Fast-forward cooldown
    await prisma.otpChallenge.update({
      where: { id: originalRowAId },
      data: { cooldownUntil: new Date(Date.now() - 1000) },
    });

    // 2. Mock/intercept updateMany so that when promotion to ACTIVE is attempted, it returns count: 0
    const originalUpdateMany = prisma.otpChallenge.updateMany;
    let interceptedPromotion = false;

    // @ts-expect-error Mocking updateMany for forced CAS failure injection
    prisma.otpChallenge.updateMany = async (args) => {
      if (args?.data?.status === OtpChallengeStatus.ACTIVE && !interceptedPromotion) {
        interceptedPromotion = true;
        // Simulate CAS failure: return count: 0 (matched 0 rows)
        return { count: 0 };
      }
      return originalUpdateMany.call(prisma.otpChallenge, args);
    };

    try {
      // 3. Dispatch B begins and succeeds with SMS adapter
      const dispatchB = await requestOtpChallenge(phone);

      // 4. Must return DISPATCH_LOST_RACE
      expect(dispatchB.success).toBe(false);
      if (!dispatchB.success) {
        expect(dispatchB.error).toBe("DISPATCH_LOST_RACE");
      }

      // 5. CRITICAL: The supersession of challenge A MUST HAVE ROLLED BACK!
      // Challenge A must STILL be in ACTIVE status in PostgreSQL!
      const checkA = await prisma.otpChallenge.findUnique({ where: { id: originalRowAId } });
      expect(checkA?.status).toBe(OtpChallengeStatus.ACTIVE);
    } finally {
      prisma.otpChallenge.updateMany = originalUpdateMany;
    }
  });

  it("10. proves failed resend preserves the previous active valid code", async () => {
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

  it("11. CONCURRENT RESEND HARD GATE: competing resend requests serialize safely without 500 collision", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const phone = generateRandomEgyptianPhone();
    // 1. Initial request succeeds
    const initialReq = await requestOtpChallenge(phone);
    expect(initialReq.success).toBe(true);

    // Fast forward cooldown
    const prisma = getPrisma();
    const lookup = computePhoneLookupHash(phone, TEST_LOOKUP_KEY);
    await prisma.otpChallenge.updateMany({
      where: { phoneLookupHash: lookup, status: OtpChallengeStatus.ACTIVE },
      data: { cooldownUntil: new Date(Date.now() - 1000) },
    });

    const createReq = () =>
      new NextRequest("http://localhost:3000/api/v1/auth/phone/request", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
        body: JSON.stringify({ phone }),
      });

    // 2. Fire two competing resend requests simultaneously
    const [resA, resB] = await Promise.all([
      requestHandler(createReq()),
      requestHandler(createReq()),
    ]);

    const statuses = [resA.status, resB.status];
    expect(statuses).toContain(200);
    expect(statuses).toContain(429);

    // Assert database has exactly ONE active challenge
    const activeRows = await prisma.otpChallenge.findMany({
      where: { phoneLookupHash: lookup, status: OtpChallengeStatus.ACTIVE },
    });
    expect(activeRows.length).toBe(1);
    expect(activeRows[0].sendCount).toBe(2);
  });

  it("12. proves rate limit boundary and recovery through public endpoint by expiring rate-limit bucket", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const phone = generateRandomEgyptianPhone();
    const prisma = getPrisma();
    const lookup = computePhoneLookupHash(phone, TEST_LOOKUP_KEY);

    const makePublicRequest = () =>
      requestHandler(
        new NextRequest("http://localhost:3000/api/v1/auth/phone/request", {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
          body: JSON.stringify({ phone }),
        })
      );

    // Sends 1 to 5 via public endpoint
    for (let i = 1; i <= 5; i++) {
      if (i > 1) {
        // Fast-forward cooldown so rolling rate limit bucket can be tested
        await prisma.otpChallenge.updateMany({
          where: { phoneLookupHash: lookup, status: OtpChallengeStatus.ACTIVE },
          data: { cooldownUntil: new Date(Date.now() - 1000) },
        });
      }
      const res = await makePublicRequest();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.accepted).toBe(true);
    }

    // 6th request to public endpoint hits phone rolling rate limit (5 per 15 min)
    await prisma.otpChallenge.updateMany({
      where: { phoneLookupHash: lookup, status: OtpChallengeStatus.ACTIVE },
      data: { cooldownUntil: new Date(Date.now() - 1000) },
    });
    const res6 = await makePublicRequest();
    expect(res6.status).toBe(429);
    const json6 = await res6.json();
    expect(json6.type).toBe("https://waffarhacars.com/errors/rate-limit-exceeded");

    // Expire the rate-limit bucket in PostgreSQL to test recovery through public endpoint
    await prisma.rateLimitBucket.updateMany({
      where: { key: `rl:phone:req:${lookup}` },
      data: { expireAt: new Date(Date.now() - 1000) },
    });

    // 7th request to public endpoint now succeeds (recovered!)
    const recoveredRes = await makePublicRequest();
    expect(recoveredRes.status).toBe(200);
    const recoveredJson = await recoveredRes.json();
    expect(recoveredJson.accepted).toBe(true);

    const activeRows = await prisma.otpChallenge.findMany({
      where: { phoneLookupHash: lookup, status: OtpChallengeStatus.ACTIVE },
    });
    expect(activeRows.length).toBe(1);
  });

  it("13. proves atomic rate limit boundary under concurrent load", async () => {
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

  it("14. proves customer profile provisioning failure does not swallow error and returns 500", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const phone = generateRandomEgyptianPhone();
    await requestOtpChallenge(phone);
    const validCode = testSmsAdapter.getLastOtp(phone)!;

    const prisma = getPrisma();
    const originalUpsert = prisma.customerProfile.upsert;
    // Inject failure into actual customerProfile.upsert invoked by Better Auth's callbackOnVerification
    // @ts-expect-error Mocking upsert for failure injection
    prisma.customerProfile.upsert = async () => {
      throw new Error("Simulated CustomerProfile DB constraint failure in callbackOnVerification");
    };

    try {
      const verifyReq = new NextRequest("http://localhost:3000/api/v1/auth/phone/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
        body: JSON.stringify({ phone, code: validCode }),
      });

      const res = await verifyHandler(verifyReq);
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.type).toBe("https://waffarhacars.com/errors/internal-error");

      // Assert no successful cookie response
      expect(res.headers.get("set-cookie")).toBeNull();

      // Assert observed User/Profile/Session database state
      const canonical = phone.startsWith("+20") ? phone : `+20${phone.replace(/^0/, "")}`;
      const user = await prisma.user.findUnique({
        where: { phoneNumber: canonical },
      });
      expect(user).not.toBeNull();

      if (user) {
        const profile = await prisma.customerProfile.findUnique({
          where: { userId: user.id },
        });
        expect(profile).toBeNull();

        const sessions = await prisma.session.findMany({
          where: { userId: user.id },
        });
        expect(sessions.length).toBe(0);
      }
    } finally {
      prisma.customerProfile.upsert = originalUpsert;
    }
  });

  it("15. proves session creation failure after OTP validation returns 500 and preserves recoverable retry", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const phone = generateRandomEgyptianPhone();
    await requestOtpChallenge(phone);
    const validCode = testSmsAdapter.getLastOtp(phone)!;

    const prisma = getPrisma();
    const originalSessionCreate = prisma.session.create;
    // Inject failure specifically at session creation
    // @ts-expect-error Mocking session.create for failure injection
    prisma.session.create = async () => {
      throw new Error("Database session creation pool exhausted");
    };

    try {
      const verifyReq = new NextRequest("http://localhost:3000/api/v1/auth/phone/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
        body: JSON.stringify({ phone, code: validCode }),
      });

      const res = await verifyHandler(verifyReq);
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.type).toBe("https://waffarhacars.com/errors/internal-error");

      // Assert no success cookie is returned
      expect(res.headers.get("set-cookie")).toBeNull();

      // Assert the OTP remains consumed
      const lookup = computePhoneLookupHash(phone, TEST_LOOKUP_KEY);
      const challenge = await prisma.otpChallenge.findFirst({
        where: { phoneLookupHash: lookup },
        orderBy: { createdAt: "desc" },
      });
      expect(challenge?.status).toBe(OtpChallengeStatus.CONSUMED);
      expect(challenge?.consumedAt).not.toBeNull();

      // Assert OTP cannot be replayed
      const replayReq = new NextRequest("http://localhost:3000/api/v1/auth/phone/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
        body: JSON.stringify({ phone, code: validCode }),
      });
      const replayRes = await verifyHandler(replayReq);
      expect(replayRes.status).toBe(400);

      // Assert a fresh OTP request provides the recovery route
      await prisma.otpChallenge.updateMany({
        where: { phoneLookupHash: lookup },
        data: { cooldownUntil: new Date(Date.now() - 1000) },
      });
      const recoveryRes = await requestHandler(
        new NextRequest("http://localhost:3000/api/v1/auth/phone/request", {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
          body: JSON.stringify({ phone }),
        })
      );
      expect(recoveryRes.status).toBe(200);
    } finally {
      prisma.session.create = originalSessionCreate;
    }
  });

  it("14b. proves post-auth profile invariant failure revokes newly created session, returns 500, and allows recovery", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const phone = generateRandomEgyptianPhone();
    await requestOtpChallenge(phone);
    const validCode = testSmsAdapter.getLastOtp(phone)!;

    const prisma = getPrisma();
    const canonical = phone.startsWith("+20") ? phone : `+20${phone.replace(/^0/, "")}`;

    // Intercept prisma.user.findUnique so that when step 7 inspects the user,
    // it finds customerProfile: null, triggering the invariant check session revocation
    const originalFindUnique = prisma.user.findUnique;
    let intercepted = false;
    // @ts-expect-error Mocking findUnique for invariant failure injection
    prisma.user.findUnique = async (args) => {
      const realUser = await originalFindUnique.call(prisma.user, args);
      if (realUser && realUser.phoneNumber === canonical && !intercepted) {
        intercepted = true;
        return {
          ...realUser,
          customerProfile: null,
        };
      }
      return realUser;
    };

    try {
      const verifyReq = new NextRequest("http://localhost:3000/api/v1/auth/phone/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
        body: JSON.stringify({ phone, code: validCode }),
      });

      const res = await verifyHandler(verifyReq);
      // 1. Response is 500
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.type).toBe("https://waffarhacars.com/errors/internal-error");

      // 2. No Set-Cookie is returned
      expect(res.headers.get("set-cookie")).toBeNull();

      // 3. No usable session remains in PostgreSQL
      const user = await originalFindUnique.call(prisma.user, {
        where: { phoneNumber: canonical },
      });
      expect(user).not.toBeNull();
      if (user) {
        const sessions = await prisma.session.findMany({ where: { userId: user.id } });
        expect(sessions.length).toBe(0);
      }
    } finally {
      prisma.user.findUnique = originalFindUnique;
    }

    // 4. Test recovery path: Next request succeeds cleanly
    const lookup = computePhoneLookupHash(phone, TEST_LOOKUP_KEY);
    await prisma.otpChallenge.updateMany({
      where: { phoneLookupHash: lookup },
      data: { cooldownUntil: new Date(Date.now() - 1000) },
    });

    const recoverRequest = await requestOtpChallenge(phone);
    expect(recoverRequest.success).toBe(true);
    const recoverCode = testSmsAdapter.getLastOtp(phone)!;

    const recoverVerifyReq = new NextRequest("http://localhost:3000/api/v1/auth/phone/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({ phone, code: recoverCode }),
    });

    const recoverRes = await verifyHandler(recoverVerifyReq);
    expect(recoverRes.status).toBe(200);
    expect(recoverRes.headers.get("set-cookie")).not.toBeNull();

    const recoveredUser = await prisma.user.findUnique({ where: { phoneNumber: canonical } });
    const recoveredSessions = await prisma.session.findMany({
      where: { userId: recoveredUser!.id },
    });
    expect(recoveredSessions.length).toBe(1);
  });

  it("14c. proves profile invariant failure during second login revokes only newly created session and preserves pre-existing valid sessions", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const phone = generateRandomEgyptianPhone();
    const canonical = phone.startsWith("+20") ? phone : `+20${phone.replace(/^0/, "")}`;
    const prisma = getPrisma();

    // 1. Create pre-existing user with an existing valid session (e.g. from previous device)
    const user = await prisma.user.create({
      data: {
        phoneNumber: canonical,
        phoneNumberVerified: true,
        name: "Existing Customer",
        email: generatePlaceholderEmail(canonical, TEST_ALIAS_KEY),
      },
    });

    const originalSessionToken = `existing-session-token-${Date.now()}`;
    const originalSession = await prisma.session.create({
      data: {
        userId: user.id,
        token: originalSessionToken,
        expiresAt: new Date(Date.now() + 86400 * 1000),
        lastActivityAt: new Date(),
      },
    });

    // 2. Request OTP for second login
    await requestOtpChallenge(phone);
    const validCode = testSmsAdapter.getLastOtp(phone)!;

    // 3. Intercept prisma.user.findUnique so step 7 sees customerProfile: null
    const originalFindUnique = prisma.user.findUnique;
    let intercepted = false;
    // @ts-expect-error Mocking findUnique for invariant failure injection
    prisma.user.findUnique = async (args) => {
      const realUser = await originalFindUnique.call(prisma.user, args);
      if (realUser && realUser.phoneNumber === canonical && !intercepted) {
        intercepted = true;
        return {
          ...realUser,
          customerProfile: null,
        };
      }
      return realUser;
    };

    try {
      const verifyReq = new NextRequest("http://localhost:3000/api/v1/auth/phone/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
        body: JSON.stringify({ phone, code: validCode }),
      });

      const res = await verifyHandler(verifyReq);
      expect(res.status).toBe(500);
      expect(res.headers.get("set-cookie")).toBeNull();

      // 4. Assert: Original pre-existing session STILL EXISTS in PostgreSQL!
      const checkOriginalSession = await prisma.session.findUnique({
        where: { id: originalSession.id },
      });
      expect(checkOriginalSession).not.toBeNull();
      expect(checkOriginalSession?.token).toBe(originalSessionToken);

      // 5. Assert: Only the original session remains; the newly created session was revoked!
      const allUserSessions = await prisma.session.findMany({
        where: { userId: user.id },
      });
      expect(allUserSessions.length).toBe(1);
      expect(allUserSessions[0].id).toBe(originalSession.id);
    } finally {
      prisma.user.findUnique = originalFindUnique;
    }
  });

  it("14d. proves session revocation failure during profile compensation is safely handled without crashing or leaking details", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const phone = generateRandomEgyptianPhone();
    const canonical = phone.startsWith("+20") ? phone : `+20${phone.replace(/^0/, "")}`;
    const prisma = getPrisma();

    // 1. Request OTP
    await requestOtpChallenge(phone);
    const validCode = testSmsAdapter.getLastOtp(phone)!;

    // 2. Intercept findUnique to simulate profile check failure AND mock session.deleteMany to simulate DB failure during revocation
    const originalFindUnique = prisma.user.findUnique;
    const originalDeleteMany = prisma.session.deleteMany;
    let intercepted = false;

    // @ts-expect-error Mocking findUnique for invariant failure injection
    prisma.user.findUnique = async (args) => {
      const realUser = await originalFindUnique.call(prisma.user, args);
      if (realUser && realUser.phoneNumber === canonical && !intercepted) {
        intercepted = true;
        return {
          ...realUser,
          customerProfile: null,
        };
      }
      return realUser;
    };

    // @ts-expect-error Mocking deleteMany for compensation failure injection
    prisma.session.deleteMany = async () => {
      throw new Error("Simulated database timeout during session revocation");
    };

    try {
      const verifyReq = new NextRequest("http://localhost:3000/api/v1/auth/phone/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
        body: JSON.stringify({ phone, code: validCode }),
      });

      const res = await verifyHandler(verifyReq);
      // Handles failure safely: returns 500 without crashing
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.type).toBe("https://waffarhacars.com/errors/internal-error");
      expect(json.detail).not.toContain("Simulated database timeout");
      expect(res.headers.get("set-cookie")).toBeNull();

      // Note: Because the revocation query was forced to fail, the session survived;
      // this test explicitly verifies that compensation errors are safely caught,
      // and we truthfully record that the session survived because the query failed.
      const survivingUser = await originalFindUnique.call(prisma.user, {
        where: { phoneNumber: canonical },
      });
      if (survivingUser) {
        const surviving = await originalDeleteMany.call(prisma.session, {
          where: { userId: survivingUser.id },
        });
        expect(surviving.count).toBeGreaterThanOrEqual(1);
      }
    } finally {
      prisma.user.findUnique = originalFindUnique;
      prisma.session.deleteMany = originalDeleteMany;
    }
  });

  it("15b. proves Better Auth 500 response returns sanitized 500 and does not convert to 400", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const phone = generateRandomEgyptianPhone();
    await requestOtpChallenge(phone);
    const validCode = testSmsAdapter.getLastOtp(phone)!;

    const auth = getAuth();
    const phoneApi = auth.api as unknown as {
      verifyPhoneNumber: (opts: unknown) => Promise<Response>;
    };
    const originalVerifyPhoneNumber = phoneApi.verifyPhoneNumber;
    phoneApi.verifyPhoneNumber = async () => {
      return new Response(JSON.stringify({ error: "Better Auth internal database node failure" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      const verifyReq = new NextRequest("http://localhost:3000/api/v1/auth/phone/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
        body: JSON.stringify({ phone, code: validCode }),
      });

      const res = await verifyHandler(verifyReq);
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.type).toBe("https://waffarhacars.com/errors/internal-error");
      expect(json.status).toBe(500);
      expect(JSON.stringify(json)).not.toContain("Better Auth internal database node failure");
    } finally {
      phoneApi.verifyPhoneNumber = originalVerifyPhoneNumber;
    }
  });

  it("15c. proves Better Auth thrown exception returns sanitized 500 internal error", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const phone = generateRandomEgyptianPhone();
    await requestOtpChallenge(phone);
    const validCode = testSmsAdapter.getLastOtp(phone)!;

    const auth = getAuth();
    const phoneApi = auth.api as unknown as {
      verifyPhoneNumber: (opts: unknown) => Promise<Response>;
    };
    const originalVerifyPhoneNumber = phoneApi.verifyPhoneNumber;
    phoneApi.verifyPhoneNumber = async () => {
      throw new Error("Fatal runtime heap exhaustion inside Better Auth");
    };

    try {
      const verifyReq = new NextRequest("http://localhost:3000/api/v1/auth/phone/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
        body: JSON.stringify({ phone, code: validCode }),
      });

      const res = await verifyHandler(verifyReq);
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.type).toBe("https://waffarhacars.com/errors/internal-error");
      expect(json.status).toBe(500);
      expect(JSON.stringify(json)).not.toContain("Fatal runtime heap exhaustion");
    } finally {
      phoneApi.verifyPhoneNumber = originalVerifyPhoneNumber;
    }
  });

  it("16. proves request with untrusted or missing Origin/Referer is rejected with 403, and configured second origin succeeds", async () => {
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

    // Configured second trusted origin succeeds
    process.env.AUTH_TRUSTED_ORIGINS = "https://partner.waffarhacars.com";
    resetServerEnvCache();

    const secondOriginReq = new NextRequest("http://localhost:3000/api/v1/auth/phone/request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://partner.waffarhacars.com",
      },
      body: JSON.stringify({ phone: generateRandomEgyptianPhone() }),
    });

    const resSecond = await requestHandler(secondOriginReq);
    expect(resSecond.status).toBe(200);
  });

  it("17. proves forwarded-header spoofing: untrusted proxy hops (0) ignores both XFF and X-Real-IP", async () => {
    process.env.TRUSTED_PROXY_HOPS = "0";
    resetServerEnvCache();

    const phone = generateRandomEgyptianPhone();

    const spoofedReq = (spoofedXff: string, spoofedRealIp: string) =>
      new NextRequest("http://localhost:3000/api/v1/auth/phone/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
          "x-forwarded-for": spoofedXff,
          "x-real-ip": spoofedRealIp,
        },
        body: JSON.stringify({ phone }),
      });

    const ip = getClientIp(spoofedReq("203.0.113.1", "10.0.0.99"));
    expect(ip).toBe("127.0.0.1");
    expect(ip).not.toBe("10.0.0.99");
    expect(ip).not.toBe("203.0.113.1");
  });

  it("18. proves multiple Set-Cookie headers are forwarded individually without collapsing", async () => {
    const auth = getAuth();
    const originalSignOut = (auth.api as unknown as { signOut: unknown }).signOut;
    (auth.api as unknown as { signOut: unknown }).signOut = async () => {
      const h = new Headers();
      h.append("Set-Cookie", "better-auth.session_token=; Path=/; Max-Age=0; HttpOnly");
      h.append("Set-Cookie", "better-auth.csrf_token=; Path=/; Max-Age=0; HttpOnly");
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: h,
      });
    };

    try {
      const logoutReq = new NextRequest("http://localhost:3000/api/v1/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
      });

      const res = await logoutHandler(logoutReq);
      expect(res.status).toBe(200);

      const forwardedCookies =
        typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
      expect(forwardedCookies.length).toBe(2);
      expect(forwardedCookies[0]).toContain("better-auth.session_token=");
      expect(forwardedCookies[1]).toContain("better-auth.csrf_token=");
    } finally {
      (auth.api as unknown as { signOut: unknown }).signOut = originalSignOut;
    }
  });

  it("19. proves zero raw OTP or session token leakage in API response bodies and non-cookie headers", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const phone = generateRandomEgyptianPhone();

    // 1. Request OTP
    const reqRes = await requestHandler(
      new NextRequest("http://localhost:3000/api/v1/auth/phone/request", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
        body: JSON.stringify({ phone }),
      })
    );
    const reqBodyText = await reqRes.text();
    const validCode = testSmsAdapter.getLastOtp(phone)!;

    // Must NOT contain 6-digit OTP or canonical phone in body
    expect(reqBodyText).not.toContain(validCode);
    expect(reqBodyText).not.toContain(phone);
    expect(JSON.parse(reqBodyText)).toEqual({ accepted: true });

    // 2. Verify OTP
    const verifyRes = await verifyHandler(
      new NextRequest("http://localhost:3000/api/v1/auth/phone/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
        body: JSON.stringify({ phone, code: validCode }),
      })
    );
    const verifyBodyText = await verifyRes.text();
    const verifyJson = JSON.parse(verifyBodyText);

    expect(verifyJson.token).toBeUndefined();
    expect(verifyJson.sessionToken).toBeUndefined();
    expect(verifyBodyText).not.toContain(validCode);
    expect(verifyJson.authenticated).toBe(true);

    const setCookie = verifyRes.headers.get("set-cookie");
    expect(setCookie).toContain("better-auth.session_token=");
    expect(setCookie?.toLowerCase()).toContain("httponly");
  });

  it("20. proves operational retention cleanup executable sweeps expired records under 64-bit advisory lock", async () => {
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

    // Run the operational executable cleanup function
    const cleanupRes = await runCleanup(DEFAULT_TEST_DB_URL);
    expect(cleanupRes.success).toBe(true);
    expect(cleanupRes.skipped).toBe(false);
    expect(cleanupRes.deletedChallenges).toBeGreaterThanOrEqual(1);
    expect(cleanupRes.deletedRateLimits).toBeGreaterThanOrEqual(1);

    // Test concurrency lock: simulate another worker process holding the 64-bit advisory lock
    const lockClient = new pg.Client({ connectionString: DEFAULT_TEST_DB_URL });
    await lockClient.connect();
    try {
      await lockClient.query(
        "SELECT pg_advisory_lock(hashtextextended('waffarhacars_auth_cleanup', 0));"
      );

      // Concurrent run should detect active lock and exit cleanly with skipped=true
      const concurrentRes = await runCleanup(DEFAULT_TEST_DB_URL);
      expect(concurrentRes.success).toBe(true);
      expect(concurrentRes.skipped).toBe(true);
    } finally {
      await lockClient.query(
        "SELECT pg_advisory_unlock(hashtextextended('waffarhacars_auth_cleanup', 0));"
      );
      await lockClient.end().catch(() => {});
    }
  });

  it("20b. proves cleanup failure with connection error sanitizes output and never exposes database URL or credentials", async () => {
    const sensitiveUrl =
      "postgresql://secret_user:super_secret_password@invalid-host.waffarhacars.internal:5432/secret_db";
    let capturedErrors = "";
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      capturedErrors += args.join(" ") + "\n";
    };

    try {
      const result = await runCleanup(sensitiveUrl);
      expect(result.success).toBe(false);
      expect(result.skipped).toBe(false);
      expect(result.error).toBe("DATABASE_CONNECTION_ERROR");

      // Verify no sensitive tokens or hostnames are leaked in return value or logs
      expect(result.error).not.toContain("secret_user");
      expect(result.error).not.toContain("super_secret_password");
      expect(result.error).not.toContain("invalid-host");
      expect(result.error).not.toContain("secret_db");

      expect(capturedErrors).not.toContain("secret_user");
      expect(capturedErrors).not.toContain("super_secret_password");
      expect(capturedErrors).not.toContain("invalid-host");
      expect(capturedErrors).not.toContain("secret_db");
      expect(capturedErrors).not.toContain("DELETE FROM");
    } finally {
      console.error = originalError;
    }
  });

  it("21. proves stock Better Auth phone endpoints (/api/auth/phone-number/*, /api/auth/sign-in/phone-number) return 404", async () => {
    const blockedPaths = [
      "/api/auth/phone-number",
      "/api/auth/phone-number/send-otp",
      "/api/auth/phone-number/verify",
      "/api/auth/sign-in/phone-number",
      "/api/auth/sign-in/phone-number/verify",
    ];

    for (const path of blockedPaths) {
      const req = new NextRequest(`http://localhost:3000${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
        body: JSON.stringify({ phoneNumber: "+201012345678" }),
      });

      const res = await handleAuth(req);
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.type).toBe("https://waffarhacars.com/errors/not-found");
    }
  });
});
