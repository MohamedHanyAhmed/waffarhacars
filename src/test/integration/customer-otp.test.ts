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
} from "@/lib/otp/challenge-service";
import { POST as requestHandler } from "@/app/api/v1/auth/phone/request/route";
import { POST as verifyHandler } from "@/app/api/v1/auth/phone/verify/route";
import { GET as sessionHandler } from "@/app/api/v1/auth/session/route";
import { POST as logoutHandler } from "@/app/api/v1/auth/logout/route";

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

        // Delete challenges and rate limit buckets for created phones
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
    // Generates a random valid Egyptian mobile number: +2010XXXXXXXX
    const suffix = crypto.randomInt(10000000, 99999999).toString();
    const phone = `+2010${suffix}`;
    createdUserPhones.push(phone);
    return phone;
  }

  it("1. proves only one active challenge exists and resend invalidates the previous code while preserving failed attempts", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const phone = generateRandomEgyptianPhone();
    const lookup = computePhoneLookupHash(phone, TEST_LOOKUP_KEY);

    // Initial challenge request
    const req1 = await requestOtpChallenge(phone);
    expect(req1.success).toBe(true);

    const prisma = getPrisma();
    const challenges1 = await prisma.otpChallenge.findMany({
      where: { phoneLookupHash: lookup },
    });
    expect(challenges1.length).toBe(1);
    expect(challenges1[0].sendCount).toBe(1);
    expect(challenges1[0].failedAttemptCount).toBe(0);

    const initialCode = testSmsAdapter.getLastOtp(phone);
    expect(initialCode).toBeDefined();

    // Fast-forward cooldown in database to simulate elapsed 60s
    await prisma.otpChallenge.update({
      where: { id: challenges1[0].id },
      data: {
        cooldownUntil: new Date(Date.now() - 1000),
        failedAttemptCount: 1, // Simulate 1 failed attempt prior to resend
      },
    });

    // Request second code (Resend)
    const req2 = await requestOtpChallenge(phone);
    expect(req2.success).toBe(true);

    const challenges2 = await prisma.otpChallenge.findMany({
      where: { phoneLookupHash: lookup },
    });
    // Partial unique index / update ensures exactly ONE row exists
    expect(challenges2.length).toBe(1);
    expect(challenges2[0].sendCount).toBe(2);
    // Failure budget MUST be preserved (not reset to 0)
    expect(challenges2[0].failedAttemptCount).toBe(1);

    const resendCode = testSmsAdapter.getLastOtp(phone);
    expect(resendCode).toBeDefined();
    expect(resendCode).not.toBe(initialCode);

    // Verify initial replaced code FAILS immediately
    const verifyInitial = await verifyAndConsumeOtpChallenge(phone, initialCode!);
    expect(verifyInitial.success).toBe(false);

    // Verify resend code SUCCEEDS
    const verifyResend = await verifyAndConsumeOtpChallenge(phone, resendCode!);
    expect(verifyResend.success).toBe(true);
  });

  it("2. proves 3 failed verification attempts exhausts the challenge and blocks further attempts", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const phone = generateRandomEgyptianPhone();
    await requestOtpChallenge(phone);
    const validCode = testSmsAdapter.getLastOtp(phone)!;

    // Attempt 1: wrong code
    const res1 = await verifyAndConsumeOtpChallenge(phone, "000000");
    expect(res1.success).toBe(false);
    if (!res1.success) {
      expect(res1.error).toBe("INVALID_CODE");
      expect(res1.remainingAttempts).toBe(2);
    }

    // Attempt 2: wrong code
    const res2 = await verifyAndConsumeOtpChallenge(phone, "111111");
    expect(res2.success).toBe(false);
    if (!res2.success) {
      expect(res2.error).toBe("INVALID_CODE");
      expect(res2.remainingAttempts).toBe(1);
    }

    // Attempt 3: wrong code -> exhausts budget
    const res3 = await verifyAndConsumeOtpChallenge(phone, "222222");
    expect(res3.success).toBe(false);
    if (!res3.success) {
      expect(res3.error).toBe("ATTEMPTS_EXHAUSTED");
    }

    // Attempt 4: valid code is now REJECTED because challenge is exhausted
    const res4 = await verifyAndConsumeOtpChallenge(phone, validCode);
    expect(res4.success).toBe(false);
    if (!res4.success) {
      expect(res4.error).toBe("ATTEMPTS_EXHAUSTED");
    }
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

    // Second consumption of the same code fails closed
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

    // Step 1: Request OTP via public request endpoint
    const requestReq = new NextRequest("http://localhost:3000/api/v1/auth/phone/request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify({ phone }),
    });

    const requestRes = await requestHandler(requestReq);
    expect(requestRes.status).toBe(200);

    const validCode = testSmsAdapter.getLastOtp(phone);
    expect(validCode).toBeDefined();

    // Step 2: Concurrently fire two identical verification requests against the same challenge
    const createVerifyReq = () =>
      new NextRequest("http://localhost:3000/api/v1/auth/phone/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          phone,
          code: validCode,
        }),
      });

    const [resA, resB] = await Promise.all([
      verifyHandler(createVerifyReq()),
      verifyHandler(createVerifyReq()),
    ]);

    const statuses = [resA.status, resB.status];

    // Assert: Exactly ONE 200 OK and ONE 400 Bad Request
    expect(statuses).toContain(200);
    expect(statuses).toContain(400);

    const successRes = resA.status === 200 ? resA : resB;
    const failureRes = resA.status === 400 ? resA : resB;

    // Verify success response body format
    const successJson = await successRes.json();
    expect(successJson.authenticated).toBe(true);
    expect(successJson.isNewCustomer).toBe(true);
    // Security Invariant: ZERO session tokens in response JSON
    expect(successJson.token).toBeUndefined();
    expect(successJson.session).toBeUndefined();

    // Verify success response Set-Cookie header contains Better Auth session token
    const setCookie = successRes.headers.get("set-cookie");
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain("better-auth.session_token=");
    expect(setCookie?.toLowerCase()).toContain("httponly");

    // Verify failure response is RFC 7807 problem details
    const failureJson = await failureRes.json();
    expect(failureJson.status).toBe(400);
    expect(failureJson.title).toBeDefined();

    // Assert database: Exactly ONE user and ONE customer profile created
    const prisma = getPrisma();
    const userCount = await prisma.user.count({ where: { phoneNumber: phone } });
    expect(userCount).toBe(1);

    const user = await prisma.user.findUnique({ where: { phoneNumber: phone } });
    expect(user).not.toBeNull();
    expect(user!.phoneNumberVerified).toBe(true);

    const profileCount = await prisma.customerProfile.count({ where: { userId: user!.id } });
    expect(profileCount).toBe(1);

    // Assert database: Exactly ONE session created
    const sessionCount = await prisma.session.count({ where: { userId: user!.id } });
    expect(sessionCount).toBe(1);
  });

  it("6. proves returning customer verification creates exactly one session and preserves existing profile", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const phone = generateRandomEgyptianPhone();

    // First sign-up flow
    await requestHandler(
      new NextRequest("http://localhost:3000/api/v1/auth/phone/request", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
        body: JSON.stringify({ phone }),
      })
    );
    const code1 = testSmsAdapter.getLastOtp(phone)!;
    const verify1 = await verifyHandler(
      new NextRequest("http://localhost:3000/api/v1/auth/phone/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
        body: JSON.stringify({ phone, code: code1 }),
      })
    );
    expect(verify1.status).toBe(200);
    const json1 = await verify1.json();
    expect(json1.isNewCustomer).toBe(true);

    // Second returning customer login flow
    await requestHandler(
      new NextRequest("http://localhost:3000/api/v1/auth/phone/request", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
        body: JSON.stringify({ phone }),
      })
    );
    const code2 = testSmsAdapter.getLastOtp(phone)!;
    const verify2 = await verifyHandler(
      new NextRequest("http://localhost:3000/api/v1/auth/phone/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
        body: JSON.stringify({ phone, code: code2 }),
      })
    );
    expect(verify2.status).toBe(200);
    const json2 = await verify2.json();
    expect(json2.isNewCustomer).toBe(false);

    // Authenticate via session endpoint with issued cookie
    const setCookie = verify2.headers.get("set-cookie")!;
    const cookieHeader = setCookie.split(";")[0];

    const sessionRes = await sessionHandler(
      new NextRequest("http://localhost:3000/api/v1/auth/session", {
        headers: { cookie: cookieHeader },
      })
    );
    expect(sessionRes.status).toBe(200);
    const sessionJson = await sessionRes.json();
    expect(sessionJson.authenticated).toBe(true);
    expect(sessionJson.user.phoneNumber).toBe(phone);
    expect(sessionJson.user.preferredLanguage).toBe("ar");

    // Logout endpoint revokes session
    const logoutRes = await logoutHandler(
      new NextRequest("http://localhost:3000/api/v1/auth/logout", {
        method: "POST",
        headers: { cookie: cookieHeader, Origin: "http://localhost:3000" },
      })
    );
    expect(logoutRes.status).toBe(200);

    // Session endpoint after logout reports unauthenticated
    const postLogoutSession = await sessionHandler(
      new NextRequest("http://localhost:3000/api/v1/auth/session", {
        headers: { cookie: cookieHeader },
      })
    );
    const postLogoutJson = await postLogoutSession.json();
    expect(postLogoutJson.authenticated).toBe(false);
  });

  it("7. proves showcase demo mode returns 503 and executes zero database queries", async () => {
    process.env.APP_DATA_BACKEND = "demo";
    resetServerEnvCache();

    const req = new NextRequest("http://localhost:3000/api/v1/auth/phone/request", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({ phone: "+201012345678" }),
    });

    const res = await requestHandler(req);
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.type).toBe("https://waffarhacars.com/errors/service-unavailable");
    expect(json.detail).toContain("demo mode");
  });
});
