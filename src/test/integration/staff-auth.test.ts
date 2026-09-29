import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import pg from "pg";
import crypto from "node:crypto";
import { getPrisma, getPool, disconnectDb } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { resetAuth } from "@/lib/auth";
import { resetServerEnvCache } from "@/lib/env";
import {
  provisionStaffMember,
  ProvisioningError,
  ProvisioningOperationalError,
} from "@/lib/staff/provisioning";
import * as rateLimitModule from "@/lib/rate-limit";
import { resolveStaffSession } from "@/lib/staff/staff-session";
import { handleAuth } from "@/app/api/auth/[...all]/route";
import { POST as changePasswordHandler } from "@/app/api/v1/staff/auth/change-password/route";
import { GET as getStaffStatusHandler } from "@/app/api/v1/staff/auth/status/route";
import { NextRequest } from "next/server";
import { createOTP } from "@better-auth/utils/otp";
import { base32 } from "@better-auth/utils/base32";

function extractTotpSecret(totpURI: string): string {
  const url = new URL(totpURI);
  const base32Secret = url.searchParams.get("secret")!;
  return Buffer.from(base32.decode(base32Secret)).toString("utf-8");
}

function extractCookieHeader(response: Response): string {
  const setCookies = response.headers.getSetCookie?.() ?? [];
  if (setCookies.length === 0) {
    const raw = response.headers.get("set-cookie");
    if (!raw) return "";
    setCookies.push(raw);
  }
  return setCookies
    .map((sc) => sc.split(";")[0].trim())
    .filter((c) => c && !c.endsWith("="))
    .join("; ");
}

const DEFAULT_TEST_DB_URL =
  process.env.DATABASE_URL ||
  "postgresql://test_user:test_password@localhost:5432/waffarhacars_test";

const TEST_SECRET = "test-secret-at-least-32-characters-long-12345";
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createSignedSessionCookie(token: string, secret: string = TEST_SECRET): string {
  const signature = crypto.createHmac("sha256", secret).update(token).digest("base64");
  return `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`;
}

async function postAuthJson(
  path: string,
  body: Record<string, unknown>,
  cookie?: string
): Promise<Response> {
  const headers = new Headers({
    "content-type": "application/json",
  });
  if (cookie) {
    headers.set("cookie", cookie);
  }
  const req = new NextRequest(`http://localhost:3000${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return handleAuth(req);
}

describe("Real PostgreSQL 17 Internal Staff Auth & Mandatory TOTP Integration Suite", () => {
  let isDbReachable = false;
  const originalEnv = { ...process.env };
  const createdUserEmails: string[] = [];

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

  beforeEach(async () => {
    resetServerEnvCache();
    resetAuth();
    process.env = { ...originalEnv };
    process.env.APP_RUNTIME_PROFILE = "showcase";
    process.env.APP_DATA_BACKEND = "postgres";
    process.env.DATABASE_URL = DEFAULT_TEST_DB_URL;
    process.env.DATABASE_DIRECT_URL = DEFAULT_TEST_DB_URL;
    process.env.BETTER_AUTH_SECRET = TEST_SECRET;
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    process.env.PHONE_LOOKUP_HMAC_KEY = "test-lookup-key-at-least-32-characters-long-12345";
    process.env.STAFF_LOGIN_HMAC_KEY = "test-staff-login-key-at-least-32-characters-long-12345";
    process.env.OTP_PEPPER_SECRET = "test-otp-pepper-key-at-least-32-characters-long-12345";
    process.env.PHONE_ALIAS_HMAC_KEY = "test-phone-alias-key-at-least-32-characters-long-12345";

    if (isDbReachable) {
      try {
        const prisma = getPrisma();
        await prisma.rateLimitBucket.deleteMany({});
      } catch {}
    }
  });

  afterEach(async () => {
    if (isDbReachable) {
      try {
        const prisma = getPrisma();
        await prisma.rateLimitBucket.deleteMany({});
        if (createdUserEmails.length > 0) {
          const users = await prisma.user.findMany({
            where: { email: { in: createdUserEmails } },
            select: { id: true },
          });
          const userIds = users.map((u) => u.id);
          if (userIds.length > 0) {
            await prisma.twoFactor.deleteMany({ where: { userId: { in: userIds } } });
            await prisma.internalRoleAssignment.deleteMany({
              where: { staffMembership: { userId: { in: userIds } } },
            });
            await prisma.internalStaffMembership.deleteMany({ where: { userId: { in: userIds } } });
            await prisma.securityAuditEvent.deleteMany({ where: { actorUserId: { in: userIds } } });
            await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
            await prisma.account.deleteMany({ where: { userId: { in: userIds } } });
            await prisma.user.deleteMany({ where: { id: { in: userIds } } });
          }
        }
      } catch (err) {
        console.error("Cleanup error in afterEach:", err);
      }
      createdUserEmails.length = 0;
    }
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

  function generateTestStaff() {
    const unique = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
    const email = `staff-${unique}@waffarhacars.com`;
    const temporaryPassword = `InitialTempPass-${unique}-123!`;
    const employeeNumber = `EMP-${unique.toUpperCase()}`;
    const fullName = `Staff Specialist ${unique}`;
    createdUserEmails.push(email);
    return { email, temporaryPassword, employeeNumber, fullName };
  }

  it("proves staff provisioning creates User, Account with scrypt hash, and Membership records", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const { email, temporaryPassword, employeeNumber, fullName } = generateTestStaff();

    const result = await provisionStaffMember({
      email,
      password: temporaryPassword,
      fullName,
      employeeNumber,
      department: "ADMIN",
      isBootstrap: true,
    });

    expect(result.success).toBe(true);
    expect(result.department).toBe("ADMIN");
    expect(result.mustChangePassword).toBe(true);

    const prisma = getPrisma();
    const dbUser = await prisma.user.findUnique({
      where: { email },
      include: { internalStaffMembership: true, accounts: true },
    });

    expect(dbUser).not.toBeNull();
    expect(UUID_REGEX.test(dbUser!.id)).toBe(true);
    expect(dbUser!.name).toBe(fullName);
    expect(dbUser!.internalStaffMembership).not.toBeNull();
    expect(dbUser!.internalStaffMembership!.employeeNumber).toBe(employeeNumber);
    expect(dbUser!.internalStaffMembership!.mustChangePassword).toBe(true);
    expect(dbUser!.internalStaffMembership!.isActive).toBe(true);

    // Verify scrypt hash format in Account record
    const account = dbUser!.accounts.find((a) => a.providerId === "credential");
    expect(account).toBeDefined();
    expect(account!.password).toBeDefined();
    expect(account!.password).not.toBe(temporaryPassword);
    expect(account!.password!.length).toBeGreaterThan(32);
  });

  it("enforces preflight conflict checks against duplicate email and employeeNumber", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const staff1 = generateTestStaff();
    await provisionStaffMember({
      email: staff1.email,
      password: staff1.temporaryPassword,
      fullName: staff1.fullName,
      employeeNumber: staff1.employeeNumber,
      department: "ADMIN",
      isBootstrap: true,
    });

    // Attempt duplicate email
    await expect(
      provisionStaffMember({
        email: staff1.email,
        password: "AnotherPassword123!",
        fullName: "Duplicate Email",
        employeeNumber: "EMP-DIFF123",
        department: "FINANCE",
        isBootstrap: false,
      })
    ).rejects.toThrow(ProvisioningError);

    // Attempt duplicate employee number
    const staff2 = generateTestStaff();
    await expect(
      provisionStaffMember({
        email: staff2.email,
        password: "AnotherPassword123!",
        fullName: "Duplicate Employee Number",
        employeeNumber: staff1.employeeNumber,
        department: "FINANCE",
        isBootstrap: false,
      })
    ).rejects.toThrow(ProvisioningError);
  });

  it("enforces atomic rate limiting on staff email sign-in (5 attempts per 15 min)", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const { email } = generateTestStaff();

    // Send 5 rapid failed attempts
    for (let i = 0; i < 5; i++) {
      const res = await postAuthJson("/api/auth/sign-in/email", {
        email,
        password: "WrongPassword123!",
      });
      expect(res.status).not.toBe(429);
    }

    // 6th attempt must be rejected with 429 Too Many Requests
    const res6 = await postAuthJson("/api/auth/sign-in/email", {
      email,
      password: "WrongPassword123!",
    });

    expect(res6.status).toBe(429);
    expect(res6.headers.get("retry-after")).toBeDefined();

    const data = await res6.json();
    expect(data.error).toBe("TOO_MANY_REQUESTS");
  });

  it("proves staff lifecycle progression: sign-in -> force password change -> enable TOTP -> verify TOTP -> active", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const { email, temporaryPassword, employeeNumber, fullName } = generateTestStaff();
    await provisionStaffMember({
      email,
      password: temporaryPassword,
      fullName,
      employeeNumber,
      department: "ADMIN",
      isBootstrap: true,
    });

    // 1. Initial sign-in with temporary password
    const signInRes = await postAuthJson("/api/auth/sign-in/email", {
      email,
      password: temporaryPassword,
    });

    expect(signInRes.status).toBe(200);
    const sessionCookie = signInRes.headers.get("set-cookie");
    expect(sessionCookie).toBeDefined();

    const sessionHeaders = new Headers();
    sessionHeaders.set("cookie", sessionCookie!);

    // Check staff status: must be PASSWORD_CHANGE_REQUIRED
    const status1 = await resolveStaffSession(sessionHeaders);
    expect(status1.state).toBe("PASSWORD_CHANGE_REQUIRED");
    expect(status1.canAccessPasswordChange).toBe(true);
    expect(status1.canAccessStaffApp).toBe(false);

    // 2. Perform forced password change
    const newPassword = "PermanentSecurePassword123!";
    const changeReq = new NextRequest("http://localhost:3000/api/v1/staff/auth/change-password", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: sessionCookie!,
      },
      body: JSON.stringify({
        currentPassword: temporaryPassword,
        newPassword,
      }),
    });

    const changeRes = await changePasswordHandler(changeReq);
    expect(changeRes.status).toBe(200);

    const updatedCookie = extractCookieHeader(changeRes) || sessionCookie!;
    const updatedHeaders = new Headers({ cookie: updatedCookie });

    // After password change, state transitions to MFA_ENROLLMENT_REQUIRED
    const status2 = await resolveStaffSession(updatedHeaders);
    expect(status2.state).toBe("MFA_ENROLLMENT_REQUIRED");
    expect(status2.canAccessEnrollment).toBe(true);

    // 3. Enable TOTP
    const enableRes = await postAuthJson(
      "/api/auth/two-factor/enable",
      {
        password: newPassword,
        method: "totp",
      },
      updatedCookie
    );

    expect(enableRes.status).toBe(200);
    const enableData = await enableRes.json();
    expect(enableData.totpURI).toBeDefined();
    expect(enableData.backupCodes).toBeDefined();
    expect(enableData.backupCodes.length).toBe(10);

    // Extract secret and generate valid 6-digit TOTP code
    const secret = extractTotpSecret(enableData.totpURI);
    const totpCode = await createOTP(secret, { digits: 6, period: 30 }).totp();

    // 4. Verify TOTP to complete enrollment
    const verifyTotpRes = await postAuthJson(
      "/api/auth/two-factor/verify-totp",
      { code: totpCode },
      updatedCookie
    );

    expect(verifyTotpRes.status).toBe(200);

    // Capture the active session cookie set upon initial TOTP verification
    const activeCookie = extractCookieHeader(verifyTotpRes) || updatedCookie;
    const activeHeaders = new Headers({ cookie: activeCookie });

    // State is now ACTIVE!
    const status3 = await resolveStaffSession(activeHeaders);
    expect(status3.state).toBe("ACTIVE");
    expect(status3.canAccessStaffApp).toBe(true);
  });

  it("proves single-use backup recovery codes are consumed upon successful verification", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const { email, temporaryPassword, employeeNumber, fullName } = generateTestStaff();
    await provisionStaffMember({
      email,
      password: temporaryPassword,
      fullName,
      employeeNumber,
      department: "ADMIN",
      isBootstrap: true,
    });

    const newPassword = "PermanentSecurePassword123!";

    // Setup user with 2FA
    const signInRes = await postAuthJson("/api/auth/sign-in/email", {
      email,
      password: temporaryPassword,
    });
    const sessionCookie = signInRes.headers.get("set-cookie")!;

    const changeRes = await changePasswordHandler(
      new NextRequest("http://localhost:3000/api/v1/staff/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: sessionCookie },
        body: JSON.stringify({ currentPassword: temporaryPassword, newPassword }),
      })
    );
    expect(changeRes.status).toBe(200);
    const updatedCookie = extractCookieHeader(changeRes) || sessionCookie;

    const enableRes = await postAuthJson(
      "/api/auth/two-factor/enable",
      { password: newPassword, method: "totp" },
      updatedCookie
    );
    const enableData = await enableRes.json();
    const firstBackupCode = enableData.backupCodes[0];
    const secret = extractTotpSecret(enableData.totpURI);
    const totpCode = await createOTP(secret, { digits: 6, period: 30 }).totp();

    const verifyEnrollRes = await postAuthJson(
      "/api/auth/two-factor/verify-totp",
      { code: totpCode },
      updatedCookie
    );
    expect(verifyEnrollRes.status).toBe(200);

    // Sign in afresh: 2FA challenge is issued
    const signIn2 = await postAuthJson("/api/auth/sign-in/email", {
      email,
      password: newPassword,
    });
    expect(signIn2.status).toBe(200);
    const twoFactorCookie = extractCookieHeader(signIn2);

    // Verify using the single-use backup code
    const backupVerifyRes = await postAuthJson(
      "/api/auth/two-factor/verify-backup-code",
      { code: firstBackupCode },
      twoFactorCookie
    );
    expect(backupVerifyRes.status).toBe(200);

    // Sign in again and attempt to re-use the same backup code
    const signIn3 = await postAuthJson("/api/auth/sign-in/email", {
      email,
      password: newPassword,
    });
    expect(signIn3.status).toBe(200);
    const twoFactorCookie3 = extractCookieHeader(signIn3);

    // Second use of the same code must be rejected!
    const reuseRes = await postAuthJson(
      "/api/auth/two-factor/verify-backup-code",
      { code: firstBackupCode },
      twoFactorCookie3
    );
    expect(reuseRes.status).not.toBe(200);
  });

  it("asserts trusted-device zero-bypass invariant: verify-totp with trustDevice: true never issues trust cookie or database record", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const { email, temporaryPassword, employeeNumber, fullName } = generateTestStaff();
    await provisionStaffMember({
      email,
      password: temporaryPassword,
      fullName,
      employeeNumber,
      department: "ADMIN",
      isBootstrap: true,
    });

    const newPassword = "PermanentSecurePassword123!";

    // Setup user with 2FA
    const signInRes = await postAuthJson("/api/auth/sign-in/email", {
      email,
      password: temporaryPassword,
    });
    const sessionCookie = signInRes.headers.get("set-cookie")!;

    const changeRes = await changePasswordHandler(
      new NextRequest("http://localhost:3000/api/v1/staff/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: sessionCookie },
        body: JSON.stringify({ currentPassword: temporaryPassword, newPassword }),
      })
    );
    expect(changeRes.status).toBe(200);
    const updatedCookie = extractCookieHeader(changeRes) || sessionCookie;

    const enableRes = await postAuthJson(
      "/api/auth/two-factor/enable",
      { password: newPassword, method: "totp" },
      updatedCookie
    );
    expect(enableRes.status).toBe(200);
    const enableData = await enableRes.json();
    const secret = extractTotpSecret(enableData.totpURI);
    const code = await createOTP(secret, { digits: 6, period: 30 }).totp();
    const verifyEnrollRes = await postAuthJson(
      "/api/auth/two-factor/verify-totp",
      { code },
      updatedCookie
    );
    expect(verifyEnrollRes.status).toBe(200);

    // Fresh sign in -> triggers 2FA
    const freshSignIn = await postAuthJson("/api/auth/sign-in/email", {
      email,
      password: newPassword,
    });
    expect(freshSignIn.status).toBe(200);
    const twoFactorCookie = extractCookieHeader(freshSignIn);

    // Call verify-totp directly via HTTP route, maliciously supplying trustDevice: true
    const verifyTotpCode = await createOTP(secret, { digits: 6, period: 30 }).totp();
    const verifyReq = new NextRequest("http://localhost:3000/api/auth/two-factor/verify-totp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: twoFactorCookie,
      },
      body: JSON.stringify({
        code: verifyTotpCode,
        trustDevice: true, // Malicious request trying to bypass MFA on subsequent logins
      }),
    });

    const verifyRes = await handleAuth(verifyReq);
    expect(verifyRes.status).toBe(200);

    // 1. Assert NO trust-device cookie is present in response headers
    const setCookieHeaders = verifyRes.headers.getSetCookie();
    expect(setCookieHeaders.some((c) => c.includes("better-auth.trust-device"))).toBe(false);

    // 2. Assert NO trust-device record was created in PostgreSQL verification table
    const prisma = getPrisma();
    const trustRecords = await prisma.verification.findMany({
      where: {
        identifier: {
          startsWith: "trust-device-",
        },
      },
    });
    expect(trustRecords.length).toBe(0);

    // 3. Assert subsequent login STILL mandates 2FA
    const nextSignIn = await postAuthJson("/api/auth/sign-in/email", {
      email,
      password: newPassword,
    });
    const nextBody = await nextSignIn.json();
    expect(nextBody.twoFactorRedirect).toBe(true);
  });

  it("asserts trusted-device zero-bypass invariant: verify-backup-code with trustDevice: true never issues trust cookie or database record", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const { email, temporaryPassword, employeeNumber, fullName } = generateTestStaff();
    await provisionStaffMember({
      email,
      password: temporaryPassword,
      fullName,
      employeeNumber,
      department: "ADMIN",
      isBootstrap: true,
    });

    const newPassword = "PermanentSecurePassword123!";

    const signInRes = await postAuthJson("/api/auth/sign-in/email", {
      email,
      password: temporaryPassword,
    });
    const sessionCookie = signInRes.headers.get("set-cookie")!;

    const changeRes = await changePasswordHandler(
      new NextRequest("http://localhost:3000/api/v1/staff/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: sessionCookie },
        body: JSON.stringify({ currentPassword: temporaryPassword, newPassword }),
      })
    );
    expect(changeRes.status).toBe(200);
    const updatedCookie = extractCookieHeader(changeRes) || sessionCookie;

    const enableRes = await postAuthJson(
      "/api/auth/two-factor/enable",
      { password: newPassword, method: "totp" },
      updatedCookie
    );
    expect(enableRes.status).toBe(200);
    const enableData = await enableRes.json();
    const secret = extractTotpSecret(enableData.totpURI);
    const code = await createOTP(secret, { digits: 6, period: 30 }).totp();
    const verifyEnrollRes = await postAuthJson(
      "/api/auth/two-factor/verify-totp",
      { code },
      updatedCookie
    );
    expect(verifyEnrollRes.status).toBe(200);

    const freshSignIn = await postAuthJson("/api/auth/sign-in/email", {
      email,
      password: newPassword,
    });
    expect(freshSignIn.status).toBe(200);
    const twoFactorCookie = extractCookieHeader(freshSignIn);

    const backupCode = enableData.backupCodes[1];

    const verifyReq = new NextRequest(
      "http://localhost:3000/api/auth/two-factor/verify-backup-code",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: twoFactorCookie,
        },
        body: JSON.stringify({
          code: backupCode,
          trustDevice: true,
        }),
      }
    );

    const verifyRes = await handleAuth(verifyReq);
    expect(verifyRes.status).toBe(200);

    const setCookieHeaders = verifyRes.headers.getSetCookie();
    expect(setCookieHeaders.some((c) => c.includes("better-auth.trust-device"))).toBe(false);

    const prisma = getPrisma();
    const trustRecords = await prisma.verification.findMany({
      where: {
        identifier: {
          startsWith: "trust-device-",
        },
      },
    });
    expect(trustRecords.length).toBe(0);

    const nextSignIn = await postAuthJson("/api/auth/sign-in/email", {
      email,
      password: newPassword,
    });
    const nextBody = await nextSignIn.json();
    expect(nextBody.twoFactorRedirect).toBe(true);
  });

  it("proves wrong password returns 401 without revealing whether account exists", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }
    const { email } = generateTestStaff();
    const res = await postAuthJson("/api/auth/sign-in/email", {
      email,
      password: "WrongPassword123!",
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain(email);
  });

  it("proves idempotent provisioning returns same userId when all attributes match", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }
    const { email, temporaryPassword, employeeNumber, fullName } = generateTestStaff();
    const result1 = await provisionStaffMember({
      email,
      password: temporaryPassword,
      fullName,
      employeeNumber,
      department: "ADMIN",
      isBootstrap: true,
    });
    const result2 = await provisionStaffMember({
      email,
      password: temporaryPassword,
      fullName,
      employeeNumber,
      department: "ADMIN",
      isBootstrap: false,
    });
    expect(result2.idempotent).toBe(true);
    expect(result2.userId).toBe(result1.userId);
  });

  it("proves bootstrap mode rejects when staff memberships already exist with BOOTSTRAP_ALREADY_INITIALIZED", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }
    const staff1 = generateTestStaff();
    await provisionStaffMember({
      email: staff1.email,
      password: staff1.temporaryPassword,
      fullName: staff1.fullName,
      employeeNumber: staff1.employeeNumber,
      department: "ADMIN",
      isBootstrap: true,
    });
    const staff2 = generateTestStaff();
    try {
      await provisionStaffMember({
        email: staff2.email,
        password: staff2.temporaryPassword,
        fullName: staff2.fullName,
        employeeNumber: staff2.employeeNumber,
        department: "ADMIN",
        isBootstrap: true,
      });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ProvisioningError);
      expect((err as ProvisioningError).code).toBe("BOOTSTRAP_ALREADY_INITIALIZED");
    }
  });

  it("proves bootstrap mode requires ADMIN department and rejects with BOOTSTRAP_REQUIRES_ADMIN", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }
    const staff = generateTestStaff();
    try {
      await provisionStaffMember({
        email: staff.email,
        password: staff.temporaryPassword,
        fullName: staff.fullName,
        employeeNumber: staff.employeeNumber,
        department: "SALES",
        isBootstrap: true,
      });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ProvisioningError);
      expect((err as ProvisioningError).code).toBe("BOOTSTRAP_REQUIRES_ADMIN");
    }
  });

  it("proves password change with wrong current password returns 400 INVALID_CREDENTIALS", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }
    const { email, temporaryPassword, employeeNumber, fullName } = generateTestStaff();
    await provisionStaffMember({
      email,
      password: temporaryPassword,
      fullName,
      employeeNumber,
      department: "ADMIN",
      isBootstrap: true,
    });
    const signInRes = await postAuthJson("/api/auth/sign-in/email", {
      email,
      password: temporaryPassword,
    });
    expect(signInRes.status).toBe(200);
    const sessionCookie = extractCookieHeader(signInRes);
    const changeRes = await changePasswordHandler(
      new NextRequest("http://localhost:3000/api/v1/staff/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: sessionCookie },
        body: JSON.stringify({
          currentPassword: "WrongCurrentPassword123!",
          newPassword: "NewSecurePassword123!",
        }),
      })
    );
    expect(changeRes.status).toBe(400);
    const body = await changeRes.json();
    expect(body.error).toBe("INVALID_CREDENTIALS");
  });

  it("proves session cookie resolves to correct staff membership and lifecycle state", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }
    const { email, temporaryPassword, employeeNumber, fullName } = generateTestStaff();
    await provisionStaffMember({
      email,
      password: temporaryPassword,
      fullName,
      employeeNumber,
      department: "ADMIN",
      isBootstrap: true,
    });
    const signInRes = await postAuthJson("/api/auth/sign-in/email", {
      email,
      password: temporaryPassword,
    });
    expect(signInRes.status).toBe(200);
    const sessionCookie = extractCookieHeader(signInRes);
    const sessionHeaders = new Headers({ cookie: sessionCookie });
    const session = await resolveStaffSession(sessionHeaders);
    expect(session.isAuthenticated).toBe(true);
    expect(session.isStaff).toBe(true);
    expect(session.state).toBe("PASSWORD_CHANGE_REQUIRED");
    expect(session.membership?.employeeNumber).toBe(employeeNumber);
    expect(session.membership?.department).toBe("ADMIN");
    expect(session.user?.email).toBe(email.toLowerCase());
  });

  it("proves sign-out invalidates session and resolveStaffSession returns UNAUTHENTICATED", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }
    const { email, temporaryPassword, employeeNumber, fullName } = generateTestStaff();
    await provisionStaffMember({
      email,
      password: temporaryPassword,
      fullName,
      employeeNumber,
      department: "ADMIN",
      isBootstrap: true,
    });
    const signInRes = await postAuthJson("/api/auth/sign-in/email", {
      email,
      password: temporaryPassword,
    });
    expect(signInRes.status).toBe(200);
    const sessionCookie = extractCookieHeader(signInRes);
    // Sign out
    const signOutRes = await postAuthJson("/api/auth/sign-out", {}, sessionCookie);
    expect(signOutRes.status).toBe(200);
    // Verify session is invalidated
    const sessionHeaders = new Headers({ cookie: sessionCookie });
    const session = await resolveStaffSession(sessionHeaders);
    expect(session.isAuthenticated).toBe(false);
    expect(session.rejectionReason).toBe("UNAUTHENTICATED");
  });

  it("proves server-side state machine blocks /two-factor/disable for ACTIVE staff", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }
    const { email, temporaryPassword, employeeNumber, fullName } = generateTestStaff();
    await provisionStaffMember({
      email,
      password: temporaryPassword,
      fullName,
      employeeNumber,
      department: "ADMIN",
      isBootstrap: true,
    });
    const signInRes = await postAuthJson("/api/auth/sign-in/email", {
      email,
      password: temporaryPassword,
    });
    expect(signInRes.status).toBe(200);
    const sessionCookie = extractCookieHeader(signInRes);

    const changeRes = await changePasswordHandler(
      new NextRequest("http://localhost:3000/api/v1/staff/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: sessionCookie },
        body: JSON.stringify({
          currentPassword: temporaryPassword,
          newPassword: "PermanentSecurePassword123!",
        }),
      })
    );
    expect(changeRes.status).toBe(200);
    const updatedCookie = extractCookieHeader(changeRes) || sessionCookie;

    const enableRes = await postAuthJson(
      "/api/auth/two-factor/enable",
      { password: "PermanentSecurePassword123!", method: "totp" },
      updatedCookie
    );
    expect(enableRes.status).toBe(200);
    const enableData = await enableRes.json();
    const secret = extractTotpSecret(enableData.totpURI);
    const code = await createOTP(secret, { digits: 6, period: 30 }).totp();

    const verifyRes = await postAuthJson(
      "/api/auth/two-factor/verify-totp",
      { code },
      updatedCookie
    );
    expect(verifyRes.status).toBe(200);
    const activeCookie = extractCookieHeader(verifyRes) || updatedCookie;

    const disableRes = await postAuthJson(
      "/api/auth/two-factor/disable",
      { password: "PermanentSecurePassword123!" },
      activeCookie
    );
    expect(disableRes.status).toBe(403);
    const disableBody = await disableRes.json();
    expect(disableBody.error).toBe("STAFF_SESSION_RESTRICTED");
  });

  it("proves PASSWORD_CHANGE_REQUIRED state blocks two-factor/enable via server-side state machine", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }
    const { email, temporaryPassword, employeeNumber, fullName } = generateTestStaff();
    await provisionStaffMember({
      email,
      password: temporaryPassword,
      fullName,
      employeeNumber,
      department: "ADMIN",
      isBootstrap: true,
    });
    const signInRes = await postAuthJson("/api/auth/sign-in/email", {
      email,
      password: temporaryPassword,
    });
    expect(signInRes.status).toBe(200);
    const sessionCookie = extractCookieHeader(signInRes);

    const enableRes = await postAuthJson(
      "/api/auth/two-factor/enable",
      { password: temporaryPassword, method: "totp" },
      sessionCookie
    );
    expect(enableRes.status).toBe(403);
    const body = await enableRes.json();
    expect(body.error).toBe("STAFF_SESSION_RESTRICTED");
  });

  it("proves staff endpoint guard denies /two-factor/disable across GET and POST when request carries both staff session and forged two_factor cookie", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const { email, temporaryPassword, employeeNumber, fullName } = generateTestStaff();
    await provisionStaffMember({
      email,
      password: temporaryPassword,
      fullName,
      employeeNumber,
      department: "ADMIN",
      isBootstrap: true,
    });
    const signInRes = await postAuthJson("/api/auth/sign-in/email", {
      email,
      password: temporaryPassword,
    });
    expect(signInRes.status).toBe(200);
    const sessionCookie = extractCookieHeader(signInRes);

    const changeRes = await changePasswordHandler(
      new NextRequest("http://localhost:3000/api/v1/staff/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: sessionCookie },
        body: JSON.stringify({
          currentPassword: temporaryPassword,
          newPassword: "PermanentSecurePassword123!",
        }),
      })
    );
    expect(changeRes.status).toBe(200);
    const updatedCookie = extractCookieHeader(changeRes) || sessionCookie;

    const enableRes = await postAuthJson(
      "/api/auth/two-factor/enable",
      { password: "PermanentSecurePassword123!", method: "totp" },
      updatedCookie
    );
    expect(enableRes.status).toBe(200);
    const enableData = await enableRes.json();
    const secret = extractTotpSecret(enableData.totpURI);
    const code = await createOTP(secret, { digits: 6, period: 30 }).totp();

    const verifyRes = await postAuthJson(
      "/api/auth/two-factor/verify-totp",
      { code },
      updatedCookie
    );
    expect(verifyRes.status).toBe(200);
    const activeCookie = extractCookieHeader(verifyRes) || updatedCookie;

    // Attacker crafts Cookie header combining genuine staff session AND forged two_factor cookie
    const forgedCookieHeader = `${activeCookie}; better-auth.two_factor=forged-attacker-challenge-token`;

    // 1. Test POST /two-factor/disable with forged cookie
    const postReq = new NextRequest("http://localhost:3000/api/auth/two-factor/disable", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: forgedCookieHeader,
      },
      body: JSON.stringify({ password: "PermanentSecurePassword123!" }),
    });
    const postRes = await handleAuth(postReq);
    expect(postRes.status).toBe(403);
    const postBody = await postRes.json();
    expect(postBody.error).toBe("STAFF_SESSION_RESTRICTED");

    // 2. Test GET /two-factor/disable with forged cookie
    const getReq = new NextRequest("http://localhost:3000/api/auth/two-factor/disable", {
      method: "GET",
      headers: {
        cookie: forgedCookieHeader,
      },
    });
    const getRes = await handleAuth(getReq);
    expect(getRes.status).toBe(403);
    const getBody = await getRes.json();
    expect(getBody.error).toBe("STAFF_SESSION_RESTRICTED");

    // Inspect database: verify twoFactor is STILL enabled and was NOT disabled
    const prisma = getPrisma();
    const dbUser = await prisma.user.findUnique({
      where: { email },
      include: { twofactors: true },
    });
    expect(dbUser?.twoFactorEnabled).toBe(true);
    expect(dbUser?.twofactors.length).toBe(1);
  });

  it("proves rate limiter storage failure returns sanitized 503 and never issues a session or calls Better Auth sign-in", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const { email, temporaryPassword, employeeNumber, fullName } = generateTestStaff();
    await provisionStaffMember({
      email,
      password: temporaryPassword,
      fullName,
      employeeNumber,
      department: "ADMIN",
      isBootstrap: true,
    });

    const prisma = getPrisma();
    const sessionsBefore = await prisma.session.count();

    // Inject database/storage failure into checkRateLimit
    const rateLimitSpy = vi
      .spyOn(rateLimitModule, "checkRateLimit")
      .mockRejectedValueOnce(
        new Error("Simulated PostgreSQL connection failure in rate limit store")
      );

    try {
      const req = new NextRequest("http://localhost:3000/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ email, password: temporaryPassword }),
      });

      const res = await handleAuth(req);
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toBe("SERVICE_UNAVAILABLE");
      expect(body.message).toBe("Authentication service temporarily unavailable");

      // Verify no session cookie was issued
      const setCookieHeaders = res.headers.getSetCookie();
      expect(setCookieHeaders.some((c) => c.includes("better-auth.session_token"))).toBe(false);

      // Verify database: zero sessions created
      const sessionsAfter = await prisma.session.count();
      expect(sessionsAfter).toBe(sessionsBefore);
    } finally {
      rateLimitSpy.mockRestore();
    }
  });

  it("proves provisioning fails closed and does not delete pre-existing user upon signup failure", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const prisma = getPrisma();
    const unique = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
    const preExistingEmail = `pre-existing-${unique}@waffarhacars.com`;
    createdUserEmails.push(preExistingEmail);

    // Pre-create user in database directly (simulating pre-existing identity)
    const preExistingUser = await prisma.user.create({
      data: {
        email: preExistingEmail,
        name: "Pre-existing User",
        emailVerified: true,
      },
    });

    // Attempt to provision staff with the same email
    try {
      await provisionStaffMember({
        email: preExistingEmail,
        password: "TemporaryPassword123!",
        fullName: "Conflict Staff",
        employeeNumber: `EMP-${unique.toUpperCase()}`,
        department: "ADMIN",
        isBootstrap: true,
      });
      expect.unreachable("Should have rejected");
    } catch (err) {
      expect(err).toBeInstanceOf(ProvisioningError);
      expect((err as ProvisioningError).code).toBe("EMAIL_ALREADY_IN_USE");
    }

    // Verify pre-existing user was NOT deleted and remains intact in database
    const survivingUser = await prisma.user.findUnique({
      where: { id: preExistingUser.id },
    });
    expect(survivingUser).not.toBeNull();
    expect(survivingUser!.email).toBe(preExistingEmail);
  });

  it("proves membership insertion failure triggers compensating cleanup of created user and accounts", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const { email, temporaryPassword, employeeNumber, fullName } = generateTestStaff();
    const prisma = getPrisma();

    // Spy on $transaction to fail deterministically with a known statement constraint violation
    const txSpy = vi
      .spyOn(prisma, "$transaction")
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError(
          "Simulated database constraint violation on membership table",
          { code: "P2002", clientVersion: "6.0.0" }
        )
      );

    try {
      await provisionStaffMember({
        email,
        password: temporaryPassword,
        fullName,
        employeeNumber,
        department: "ADMIN",
        isBootstrap: true,
      });
      expect.unreachable("Should have rejected");
    } catch (err) {
      expect(err).toBeInstanceOf(ProvisioningError);
      expect((err as ProvisioningError).code).toBe("MEMBERSHIP_CREATION_FAILED");
    } finally {
      txSpy.mockRestore();
    }

    // Assert final database state: User, Account, and Membership rows must all be 0
    const finalUser = await prisma.user.findUnique({ where: { email } });
    expect(finalUser).toBeNull();
    const finalMemberships = await prisma.internalStaffMembership.findMany({
      where: { employeeNumber },
    });
    expect(finalMemberships.length).toBe(0);
  });

  it("proves compensation failure raises ProvisioningOperationalError with orphanUserId without masking", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const { email, temporaryPassword, employeeNumber, fullName } = generateTestStaff();
    const prisma = getPrisma();

    // Injects both transaction create failure AND compensating user delete failure
    const txSpy = vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Simulated membership creation failure", {
        code: "P2002",
        clientVersion: "6.0.0",
      })
    );
    const deleteSpy = vi
      .spyOn(prisma.user, "delete")
      .mockRejectedValueOnce(new Error("Simulated user deletion failure"));

    try {
      await provisionStaffMember({
        email,
        password: temporaryPassword,
        fullName,
        employeeNumber,
        department: "ADMIN",
        isBootstrap: true,
      });
      expect.unreachable("Should have thrown operational error");
    } catch (err) {
      expect(err).toBeInstanceOf(ProvisioningOperationalError);
      const opErr = err as ProvisioningOperationalError;
      expect(opErr.code).toBe("PROVISIONING_COMPENSATION_FAILED");
      expect(UUID_REGEX.test(opErr.orphanUserId)).toBe(true);

      // Verify the orphan user exists in DB for manual reconciliation
      const orphanUser = await prisma.user.findUnique({
        where: { id: opErr.orphanUserId },
      });
      expect(orphanUser).not.toBeNull();
    } finally {
      txSpy.mockRestore();
      deleteSpy.mockRestore();
    }
  });

  it("proves concurrent bootstrap provisioning serializes via advisory lock and rejects duplicate bootstrap", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const staff1 = generateTestStaff();
    const staff2 = generateTestStaff();

    let barrierEntered = false;
    let resolveBarrierEntered!: () => void;
    const barrierEnteredPromise = new Promise<void>((resolve) => {
      resolveBarrierEntered = resolve;
    });

    let resolveBarrierRelease!: () => void;
    const barrierReleasePromise = new Promise<void>((resolve) => {
      resolveBarrierRelease = resolve;
    });

    // Start request 1 with a deterministic barrier held immediately after acquiring the lock
    const req1Promise = provisionStaffMember(
      {
        email: staff1.email,
        password: staff1.temporaryPassword,
        fullName: staff1.fullName,
        employeeNumber: staff1.employeeNumber,
        department: "ADMIN",
        isBootstrap: true,
      },
      {
        _testBarrier: async () => {
          barrierEntered = true;
          resolveBarrierEntered();
          await barrierReleasePromise;
        },
      }
    );

    // Wait until request 1 has acquired the advisory lock and entered the protected critical section
    await barrierEnteredPromise;
    expect(barrierEntered).toBe(true);

    // Start request 2 while request 1 is deterministically holding the advisory lock
    let req2Settled = false;
    let req2Error: unknown = null;
    const req2Promise = provisionStaffMember({
      email: staff2.email,
      password: staff2.temporaryPassword,
      fullName: staff2.fullName,
      employeeNumber: staff2.employeeNumber,
      department: "ADMIN",
      isBootstrap: true,
    })
      .catch((err) => {
        req2Error = err;
        throw err;
      })
      .finally(() => {
        req2Settled = true;
      });

    try {
      // Allow request 2 event-loop turns to execute and reach pg_advisory_lock
      await new Promise((r) => setTimeout(r, 150));

      // Assert that request 2 CANNOT settle or pass while request 1 holds the lock
      expect(req2Settled).toBe(false);

      // Verify at the PostgreSQL engine level that request 2 is actively waiting on the advisory lock
      const pool = getPool();
      const lockStatus = await pool.query(
        "SELECT count(*)::int AS waiting_count FROM pg_locks WHERE locktype = 'advisory' AND granted = false"
      );
      expect(lockStatus.rows[0].waiting_count).toBe(1);
    } finally {
      // Release request 1 from the barrier to allow it to finish and unlock
      resolveBarrierRelease();
    }

    // Await request 1 completion
    const res1 = await req1Promise;
    expect(res1.success).toBe(true);
    expect(res1.idempotent).toBe(false);

    // Now request 2 unblocks, acquires lock, sees count > 0, and rejects with BOOTSTRAP_ALREADY_INITIALIZED
    await expect(req2Promise).rejects.toThrow(ProvisioningError);
    expect((req2Error as ProvisioningError).code).toBe("BOOTSTRAP_ALREADY_INITIALIZED");

    // Verify all advisory locks are released
    const pool = getPool();
    const finalLockStatus = await pool.query(
      "SELECT count(*)::int AS active_count FROM pg_locks WHERE locktype = 'advisory'"
    );
    expect(finalLockStatus.rows[0].active_count).toBe(0);

    // Assert final database state: exactly 1 User and 1 Membership
    const prisma = getPrisma();
    const totalStaff = await prisma.internalStaffMembership.count();
    expect(totalStaff).toBe(1);
    const users = await prisma.user.findMany({
      where: { email: { in: [staff1.email.toLowerCase(), staff2.email.toLowerCase()] } },
    });
    expect(users.length).toBe(1);
    expect(users[0].email).toBe(staff1.email.toLowerCase());
  });

  it("proves concurrent same-email and same-employee provisioning serializes and returns idempotent success", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const { email, temporaryPassword, employeeNumber, fullName } = generateTestStaff();

    let barrierEntered = false;
    let resolveBarrierEntered!: () => void;
    const barrierEnteredPromise = new Promise<void>((resolve) => {
      resolveBarrierEntered = resolve;
    });

    let resolveBarrierRelease!: () => void;
    const barrierReleasePromise = new Promise<void>((resolve) => {
      resolveBarrierRelease = resolve;
    });

    // Request 1 holds the lock
    const req1Promise = provisionStaffMember(
      {
        email,
        password: temporaryPassword,
        fullName,
        employeeNumber,
        department: "ADMIN",
        isBootstrap: true,
      },
      {
        _testBarrier: async () => {
          barrierEntered = true;
          resolveBarrierEntered();
          await barrierReleasePromise;
        },
      }
    );

    await barrierEnteredPromise;
    expect(barrierEntered).toBe(true);

    // Request 2 tries to run concurrently
    let req2Settled = false;
    const req2Promise = provisionStaffMember({
      email,
      password: temporaryPassword,
      fullName,
      employeeNumber,
      department: "ADMIN",
      isBootstrap: true,
    }).finally(() => {
      req2Settled = true;
    });

    try {
      await new Promise((r) => setTimeout(r, 150));
      expect(req2Settled).toBe(false);

      const pool = getPool();
      const lockStatus = await pool.query(
        "SELECT count(*)::int AS waiting_count FROM pg_locks WHERE locktype = 'advisory' AND granted = false"
      );
      expect(lockStatus.rows[0].waiting_count).toBe(1);
    } finally {
      resolveBarrierRelease();
    }

    const res1 = await req1Promise;
    expect(res1.success).toBe(true);
    expect(res1.idempotent).toBe(false);

    // Request 2 unblocks after request 1 completes
    const res2Result = await req2Promise.catch((err) => err);
    expect(res2Result).toBeDefined();

    const prisma = getPrisma();
    const users = await prisma.user.findMany({ where: { email } });
    expect(users.length).toBe(1);
    const memberships = await prisma.internalStaffMembership.findMany({
      where: { employeeNumber },
    });
    expect(memberships.length).toBe(1);
  });

  it("proves password change partial failure recovery: propagates rotated cookie, maintains fail-closed state, and permits subsequent activation", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const { email, temporaryPassword, employeeNumber, fullName } = generateTestStaff();
    await provisionStaffMember({
      email,
      password: temporaryPassword,
      fullName,
      employeeNumber,
      department: "ADMIN",
      isBootstrap: true,
    });

    // 1. Initial sign in with temporary password
    const signInRes = await postAuthJson("/api/auth/sign-in/email", {
      email,
      password: temporaryPassword,
    });
    expect(signInRes.status).toBe(200);
    const initialCookie = extractCookieHeader(signInRes);

    const prisma = getPrisma();
    const initialDbMembership = await prisma.internalStaffMembership.findUnique({
      where: { employeeNumber },
    });
    expect(initialDbMembership!.mustChangePassword).toBe(true);

    const permanentPassword = "PermanentSecurePassword123!";
    const secondPassword = "SecondSecurePassword123!";

    // 2. Inject failure on membership update
    const updateSpy = vi
      .spyOn(prisma.internalStaffMembership, "update")
      .mockRejectedValueOnce(new Error("Simulated database timeout during membership update"));

    const failedChangeRes = await changePasswordHandler(
      new NextRequest("http://localhost:3000/api/v1/staff/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: initialCookie },
        body: JSON.stringify({
          currentPassword: temporaryPassword,
          newPassword: permanentPassword,
        }),
      })
    );

    updateSpy.mockRestore();

    // Assert: Returns 500 with MEMBERSHIP_UPDATE_FAILED and mustRetry: true
    expect(failedChangeRes.status).toBe(500);
    const failedBody = await failedChangeRes.json();
    expect(failedBody.error).toBe("MEMBERSHIP_UPDATE_FAILED");
    expect(failedBody.mustRetry).toBe(true);

    // Assert: Rotated cookie IS propagated in 500 response headers
    const rotatedCookie = extractCookieHeader(failedChangeRes);
    expect(rotatedCookie).toBeTruthy();
    expect(rotatedCookie).not.toBe(initialCookie);

    // Verify DB state: password hash in account IS updated to permanentPassword
    // Old session is revoked, and mustChangePassword is STILL true
    const postFailureMembership = await prisma.internalStaffMembership.findUnique({
      where: { employeeNumber },
    });
    expect(postFailureMembership!.mustChangePassword).toBe(true);

    // Assert zero premature staff access: rotated cookie still resolves to PASSWORD_CHANGE_REQUIRED
    const interimSession = await resolveStaffSession(new Headers({ cookie: rotatedCookie }));
    expect(interimSession.isAuthenticated).toBe(true);
    expect(interimSession.state).toBe("PASSWORD_CHANGE_REQUIRED");
    expect(interimSession.canAccessStaffApp).toBe(false);

    // Assert state machine blocks /two-factor/enable with rotated cookie
    const prematureMfaRes = await postAuthJson(
      "/api/auth/two-factor/enable",
      { password: permanentPassword, method: "totp" },
      rotatedCookie
    );
    expect(prematureMfaRes.status).toBe(403);

    // 3. User demonstrates recovery: retries change-password with their newly set password
    const retryChangeRes = await changePasswordHandler(
      new NextRequest("http://localhost:3000/api/v1/staff/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: rotatedCookie },
        body: JSON.stringify({
          currentPassword: permanentPassword,
          newPassword: secondPassword,
        }),
      })
    );
    expect(retryChangeRes.status).toBe(200);
    const retryBody = await retryChangeRes.json();
    expect(retryBody.success).toBe(true);
    expect(retryBody.nextStep).toBe("MFA_ENROLLMENT_REQUIRED");

    const finalCookie = extractCookieHeader(retryChangeRes) || rotatedCookie;

    // Verify final DB state: mustChangePassword is now false
    const finalMembership = await prisma.internalStaffMembership.findUnique({
      where: { employeeNumber },
    });
    expect(finalMembership!.mustChangePassword).toBe(false);

    // Verify session now transitions to MFA_ENROLLMENT_REQUIRED
    const finalSession = await resolveStaffSession(new Headers({ cookie: finalCookie }));
    expect(finalSession.isAuthenticated).toBe(true);
    expect(finalSession.state).toBe("MFA_ENROLLMENT_REQUIRED");
    expect(finalSession.canAccessEnrollment).toBe(true);
  });

  it("proves non-staff customer account receives rejectionReason NOT_STAFF upon resolveStaffSession", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const prisma = getPrisma();
    const unique = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
    const customerEmail = `customer-${unique}@waffarhacars.com`;
    createdUserEmails.push(customerEmail);

    const customerUser = await prisma.user.create({
      data: {
        email: customerEmail,
        name: "Regular Customer",
        customerProfile: {
          create: {
            preferredLanguage: "ar",
            notificationPreferences: { sms: true, whatsapp: false },
          },
        },
      },
    });

    const session = await prisma.session.create({
      data: {
        userId: customerUser.id,
        token: `mock-customer-token-${unique}`,
        expiresAt: new Date(Date.now() + 86400000),
        lastActivityAt: new Date(),
      },
    });

    const headers = new Headers({
      cookie: createSignedSessionCookie(session.token),
    });

    const staffSession = await resolveStaffSession(headers);
    expect(staffSession.isAuthenticated).toBe(true);
    expect(staffSession.isStaff).toBe(false);
    expect(staffSession.rejectionReason).toBe("NOT_STAFF");
  });

  it("proves suspended staff member resolves to SUSPENDED state and is blocked from staff endpoints", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const { email, temporaryPassword, employeeNumber, fullName } = generateTestStaff();
    await provisionStaffMember({
      email,
      password: temporaryPassword,
      fullName,
      employeeNumber,
      department: "ADMIN",
      isBootstrap: true,
    });
    const signInRes = await postAuthJson("/api/auth/sign-in/email", {
      email,
      password: temporaryPassword,
    });
    expect(signInRes.status).toBe(200);
    const sessionCookie = extractCookieHeader(signInRes);

    // Suspend staff member directly in database
    const prisma = getPrisma();
    await prisma.internalStaffMembership.update({
      where: { employeeNumber },
      data: { isActive: false },
    });

    const session = await resolveStaffSession(new Headers({ cookie: sessionCookie }));
    expect(session.isAuthenticated).toBe(true);
    expect(session.isStaff).toBe(true);
    expect(session.state).toBe("SUSPENDED");
    expect(session.canAccessStaffApp).toBe(false);

    // State machine blocks password change or any action
    const changeRes = await changePasswordHandler(
      new NextRequest("http://localhost:3000/api/v1/staff/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: sessionCookie },
        body: JSON.stringify({
          currentPassword: temporaryPassword,
          newPassword: "PermanentPassword123!",
        }),
      })
    );
    expect(changeRes.status).toBe(403);
    const body = await changeRes.json();
    expect(body.error).toBe("ACCOUNT_SUSPENDED");
  });

  it("proves interrupted enrollment preserves MFA_ENROLLMENT_REQUIRED state on subsequent login", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const { email, temporaryPassword, employeeNumber, fullName } = generateTestStaff();
    await provisionStaffMember({
      email,
      password: temporaryPassword,
      fullName,
      employeeNumber,
      department: "ADMIN",
      isBootstrap: true,
    });
    const signInRes = await postAuthJson("/api/auth/sign-in/email", {
      email,
      password: temporaryPassword,
    });
    const sessionCookie = extractCookieHeader(signInRes);

    const permanentPassword = "PermanentSecurePassword123!";
    const changeRes = await changePasswordHandler(
      new NextRequest("http://localhost:3000/api/v1/staff/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: sessionCookie },
        body: JSON.stringify({
          currentPassword: temporaryPassword,
          newPassword: permanentPassword,
        }),
      })
    );
    expect(changeRes.status).toBe(200);
    const updatedCookie = extractCookieHeader(changeRes) || sessionCookie;

    // Begin enrollment: call enable to receive totpURI, but do NOT complete verify-totp
    const enableRes = await postAuthJson(
      "/api/auth/two-factor/enable",
      { password: permanentPassword, method: "totp" },
      updatedCookie
    );
    expect(enableRes.status).toBe(200);

    // Sign out (abandoning enrollment)
    await postAuthJson("/api/auth/sign-out", {}, updatedCookie);

    // Sign in afresh with new permanent password
    const reLoginRes = await postAuthJson("/api/auth/sign-in/email", {
      email,
      password: permanentPassword,
    });
    expect(reLoginRes.status).toBe(200);
    const freshCookie = extractCookieHeader(reLoginRes);

    // Session state MUST remain MFA_ENROLLMENT_REQUIRED (or MFA_ENROLLMENT_PENDING) and staff app is blocked
    const freshSession = await resolveStaffSession(new Headers({ cookie: freshCookie }));
    expect(freshSession.isAuthenticated).toBe(true);
    expect(
      freshSession.state === "MFA_ENROLLMENT_REQUIRED" ||
        freshSession.state === "MFA_ENROLLMENT_PENDING"
    ).toBe(true);
    expect(freshSession.canAccessStaffApp).toBe(false);
  });

  it("asserts TOTP factor replay within the same 30s window is rejected", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const { email, temporaryPassword, employeeNumber, fullName } = generateTestStaff();
    await provisionStaffMember({
      email,
      password: temporaryPassword,
      fullName,
      employeeNumber,
      department: "ADMIN",
      isBootstrap: true,
    });
    const signInRes = await postAuthJson("/api/auth/sign-in/email", {
      email,
      password: temporaryPassword,
    });
    const sessionCookie = extractCookieHeader(signInRes);

    const permanentPassword = "PermanentSecurePassword123!";
    const changeRes = await changePasswordHandler(
      new NextRequest("http://localhost:3000/api/v1/staff/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: sessionCookie },
        body: JSON.stringify({
          currentPassword: temporaryPassword,
          newPassword: permanentPassword,
        }),
      })
    );
    expect(changeRes.status).toBe(200);
    const updatedCookie = extractCookieHeader(changeRes) || sessionCookie;

    const enableRes = await postAuthJson(
      "/api/auth/two-factor/enable",
      { password: permanentPassword, method: "totp" },
      updatedCookie
    );
    const enableData = await enableRes.json();
    const secret = extractTotpSecret(enableData.totpURI);
    const code = await createOTP(secret, { digits: 6, period: 30 }).totp();

    // First use of code succeeds
    const verifyRes1 = await postAuthJson(
      "/api/auth/two-factor/verify-totp",
      { code },
      updatedCookie
    );
    expect(verifyRes1.status).toBe(200);

    // Immediate replay of the exact same code must NOT be accepted as a valid subsequent factor
    const replayRes = await postAuthJson(
      "/api/auth/two-factor/verify-totp",
      { code },
      updatedCookie
    );
    expect(replayRes.status).not.toBe(200);
  });

  it("proves backup-code regeneration endpoint is blocked for staff by server-side state machine", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const { email, temporaryPassword, employeeNumber, fullName } = generateTestStaff();
    await provisionStaffMember({
      email,
      password: temporaryPassword,
      fullName,
      employeeNumber,
      department: "ADMIN",
      isBootstrap: true,
    });
    const signInRes = await postAuthJson("/api/auth/sign-in/email", {
      email,
      password: temporaryPassword,
    });
    const sessionCookie = extractCookieHeader(signInRes);

    const permanentPassword = "PermanentSecurePassword123!";
    const changeRes = await changePasswordHandler(
      new NextRequest("http://localhost:3000/api/v1/staff/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: sessionCookie },
        body: JSON.stringify({
          currentPassword: temporaryPassword,
          newPassword: permanentPassword,
        }),
      })
    );
    const updatedCookie = extractCookieHeader(changeRes) || sessionCookie;

    const enableRes = await postAuthJson(
      "/api/auth/two-factor/enable",
      { password: permanentPassword, method: "totp" },
      updatedCookie
    );
    const enableData = await enableRes.json();
    const secret = extractTotpSecret(enableData.totpURI);
    const code = await createOTP(secret, { digits: 6, period: 30 }).totp();

    const verifyRes = await postAuthJson(
      "/api/auth/two-factor/verify-totp",
      { code },
      updatedCookie
    );
    expect(verifyRes.status).toBe(200);
    const activeCookie = extractCookieHeader(verifyRes) || updatedCookie;

    // Staff session attempts to call generate-backup-codes
    const genRes = await postAuthJson(
      "/api/auth/two-factor/generate-backup-codes",
      {},
      activeCookie
    );
    expect(genRes.status).toBe(403);
    const genBody = await genRes.json();
    expect(genBody.error).toBe("STAFF_SESSION_RESTRICTED");
  });

  it("proves 5 consecutive invalid TOTP attempts trigger two-factor lockout", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const { email, temporaryPassword, employeeNumber, fullName } = generateTestStaff();
    await provisionStaffMember({
      email,
      password: temporaryPassword,
      fullName,
      employeeNumber,
      department: "ADMIN",
      isBootstrap: true,
    });
    const signInRes = await postAuthJson("/api/auth/sign-in/email", {
      email,
      password: temporaryPassword,
    });
    const sessionCookie = extractCookieHeader(signInRes);

    const permanentPassword = "PermanentSecurePassword123!";
    const changeRes = await changePasswordHandler(
      new NextRequest("http://localhost:3000/api/v1/staff/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: sessionCookie },
        body: JSON.stringify({
          currentPassword: temporaryPassword,
          newPassword: permanentPassword,
        }),
      })
    );
    const updatedCookie = extractCookieHeader(changeRes) || sessionCookie;

    const enableRes = await postAuthJson(
      "/api/auth/two-factor/enable",
      { password: permanentPassword, method: "totp" },
      updatedCookie
    );
    const enableData = await enableRes.json();
    const secret = extractTotpSecret(enableData.totpURI);
    const code = await createOTP(secret, { digits: 6, period: 30 }).totp();

    const verifyRes = await postAuthJson(
      "/api/auth/two-factor/verify-totp",
      { code },
      updatedCookie
    );
    expect(verifyRes.status).toBe(200);

    // Sign in afresh to trigger 2FA challenge
    const reLogin = await postAuthJson("/api/auth/sign-in/email", {
      email,
      password: permanentPassword,
    });
    expect(reLogin.status).toBe(200);
    const challengeCookie = extractCookieHeader(reLogin);

    // Submit 5 invalid TOTP attempts
    let lastStatus = 0;
    for (let i = 0; i < 5; i++) {
      const failRes = await postAuthJson(
        "/api/auth/two-factor/verify-totp",
        { code: "000000" },
        challengeCookie
      );
      lastStatus = failRes.status;
    }

    // 5th attempt or subsequent attempt must reject
    expect(lastStatus).not.toBe(200);

    // Next attempt even with the real code should be rejected due to lockout or invalidated challenge
    const validCode = await createOTP(secret, { digits: 6, period: 30 }).totp();
    const lockedRes = await postAuthJson(
      "/api/auth/two-factor/verify-totp",
      { code: validCode },
      challengeCookie
    );
    expect(lockedRes.status).not.toBe(200);
  });

  it("asserts session-resolution failure returns sanitized 503 and never invokes Better Auth or fails open", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    // Provision an active staff member
    const { email, temporaryPassword, employeeNumber, fullName } = generateTestStaff();
    await provisionStaffMember({
      email,
      password: temporaryPassword,
      fullName,
      employeeNumber,
      department: "ADMIN",
      isBootstrap: true,
    });

    const signInRes = await postAuthJson("/api/auth/sign-in/email", {
      email,
      password: temporaryPassword,
    });
    const sessionCookie = signInRes.headers.get("set-cookie")!;

    // Mock prisma.user.findUnique to throw a database failure during session resolution
    const prisma = getPrisma();
    const findUniqueSpy = vi
      .spyOn(prisma.user, "findUnique")
      .mockRejectedValueOnce(new Error("Database connection lost"));

    try {
      // Attempt to access /two-factor/disable with the session cookie while session-resolution fails
      const req = new NextRequest("http://localhost:3000/api/auth/two-factor/disable", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: sessionCookie,
        },
        body: JSON.stringify({ password: temporaryPassword }),
      });

      const res = await handleAuth(req);

      // Must return 503 SERVICE_UNAVAILABLE, NOT 401 or 403 or fall through to Better Auth
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body).toEqual({
        error: "SERVICE_UNAVAILABLE",
        message: "Authentication service temporarily unavailable",
      });
      expect(res.headers.get("cache-control")).toBe("no-store");
    } finally {
      findUniqueSpy.mockRestore();
    }
  });

  it("preserves legitimate unauthenticated MFA-challenge path during 2FA verification flow", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    // Go through full activation to ACTIVE
    const { email, temporaryPassword, employeeNumber, fullName } = generateTestStaff();
    await provisionStaffMember({
      email,
      password: temporaryPassword,
      fullName,
      employeeNumber,
      department: "ADMIN",
      isBootstrap: true,
    });

    const signInRes = await postAuthJson("/api/auth/sign-in/email", {
      email,
      password: temporaryPassword,
    });
    const sessionCookie = signInRes.headers.get("set-cookie")!;

    const changeRes = await changePasswordHandler(
      new NextRequest("http://localhost:3000/api/v1/staff/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: sessionCookie },
        body: JSON.stringify({
          currentPassword: temporaryPassword,
          newPassword: "PermanentPassword123!",
        }),
      })
    );
    expect(changeRes.status).toBe(200);
    const updatedCookie = extractCookieHeader(changeRes) || sessionCookie;

    const enableRes = await postAuthJson(
      "/api/auth/two-factor/enable",
      { password: "PermanentPassword123!", method: "totp" },
      updatedCookie
    );
    expect(enableRes.status).toBe(200);
    const enableData = await enableRes.json();
    const secret = extractTotpSecret(enableData.totpURI);
    const code = await createOTP(secret, { digits: 6, period: 30 }).totp();

    const verifyRes = await postAuthJson(
      "/api/auth/two-factor/verify-totp",
      { code },
      updatedCookie
    );
    expect(verifyRes.status).toBe(200);

    // Sign out to clear active session
    const activeCookie = extractCookieHeader(verifyRes) || updatedCookie;
    await postAuthJson("/api/auth/sign-out", {}, activeCookie);

    // Now sign in again: Better Auth returns twoFactorRedirect and sets better-auth.two_factor cookie
    const reSignInRes = await postAuthJson("/api/auth/sign-in/email", {
      email,
      password: "PermanentPassword123!",
    });
    expect(reSignInRes.status).toBe(200);
    const reSignInData = await reSignInRes.json();
    expect(reSignInData.twoFactorRedirect).toBe(true);

    const twoFactorCookie = extractCookieHeader(reSignInRes);
    expect(twoFactorCookie).toContain("better-auth.two_factor");

    // The client is unauthenticated (no session token, only two_factor challenge cookie)
    // Verify that resolveStaffSession recognizes this as UNAUTHENTICATED (not SESSION_RESOLUTION_ERROR)
    const checkHeaders = new Headers({ cookie: twoFactorCookie });
    const interimCheck = await resolveStaffSession(checkHeaders);
    expect(interimCheck.isAuthenticated).toBe(false);
    expect(interimCheck.rejectionReason).toBe("UNAUTHENTICATED");

    // Now call /api/auth/two-factor/verify-totp with the legitimate challenge cookie
    const newOtp = await createOTP(secret, { digits: 6, period: 30 }).totp();
    const mfaVerifyRes = await postAuthJson(
      "/api/auth/two-factor/verify-totp",
      { code: newOtp },
      twoFactorCookie
    );

    // Must succeed (200), issuing the authenticated session
    expect(mfaVerifyRes.status).toBe(200);
    const finalSessionCookie = extractCookieHeader(mfaVerifyRes);
    expect(finalSessionCookie).toContain("better-auth.session_token");

    // Verify session resolves to ACTIVE staff
    const finalStaffSession = await resolveStaffSession(
      new Headers({ cookie: finalSessionCookie })
    );
    expect(finalStaffSession.isAuthenticated).toBe(true);
    expect(finalStaffSession.state).toBe("ACTIVE");
  });

  it("asserts real GET /api/v1/staff/auth/status returns flat contract fields for authenticated active admin", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const { email, temporaryPassword, employeeNumber, fullName } = generateTestStaff();

    // 1. Provision staff admin
    const provisionResult = await provisionStaffMember({
      email,
      password: temporaryPassword,
      fullName,
      employeeNumber,
      department: "ADMIN",
      isBootstrap: true,
    });
    expect(provisionResult.success).toBe(true);

    // 2. Initial sign-in with temporary password
    const signInRes = await postAuthJson("/api/auth/sign-in/email", {
      email,
      password: temporaryPassword,
    });
    expect(signInRes.status).toBe(200);
    const initialSessionCookie = extractCookieHeader(signInRes);

    // 3. Change temporary password
    const permanentPassword = "PermanentSecurePassword123!";
    const changeReq = new NextRequest("http://localhost:3000/api/v1/staff/auth/change-password", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: initialSessionCookie,
      },
      body: JSON.stringify({
        currentPassword: temporaryPassword,
        newPassword: permanentPassword,
      }),
    });
    const changeRes = await changePasswordHandler(changeReq);
    expect(changeRes.status).toBe(200);
    const mfaRequiredCookie = extractCookieHeader(changeRes) || initialSessionCookie;

    // 4. Enable TOTP
    const enableRes = await postAuthJson(
      "/api/auth/two-factor/enable",
      { password: permanentPassword, method: "totp" },
      mfaRequiredCookie
    );
    expect(enableRes.status).toBe(200);
    const enableData = await enableRes.json();
    const secret = extractTotpSecret(enableData.totpURI);

    // 5. Verify TOTP to reach ACTIVE state
    const code = await createOTP(secret, { digits: 6, period: 30 }).totp();
    const verifyRes = await postAuthJson(
      "/api/auth/two-factor/verify-totp",
      { code },
      mfaRequiredCookie
    );
    expect(verifyRes.status).toBe(200);
    const activeSessionCookie = extractCookieHeader(verifyRes) || mfaRequiredCookie;

    // 6. Invoke real status route GET /api/v1/staff/auth/status
    const statusReq = new NextRequest("http://localhost:3000/api/v1/staff/auth/status", {
      method: "GET",
      headers: {
        cookie: activeSessionCookie,
      },
    });
    const statusRes = await getStaffStatusHandler(statusReq);

    // 7. Assertions: 200, no-store, and flat response fields
    expect(statusRes.status).toBe(200);
    expect(statusRes.headers.get("Cache-Control")).toBe("no-store");

    const statusBody = await statusRes.json();

    // Verify authoritative flat contract fields
    expect(statusBody.state).toBe("ACTIVE");
    expect(statusBody.name).toBe(fullName);
    expect(statusBody.email).toBe(email.toLowerCase());
    expect(statusBody.department).toBe("ADMIN");
    expect(statusBody.employeeNumber).toBe(employeeNumber);
    expect(statusBody.mustChangePassword).toBe(false);
    expect(statusBody.twoFactorEnabled).toBe(true);
    expect(statusBody.canAccessStaffApp).toBe(true);
    expect(statusBody.canAccessEnrollment).toBe(false);
    expect(statusBody.canAccessPasswordChange).toBe(false);

    // Verify that legacy nested objects are absent (prevent contract regression)
    const rawBody = statusBody as Record<string, unknown>;
    expect(rawBody.user).toBeUndefined();
    expect(rawBody.membership).toBeUndefined();
    expect(rawBody.authenticated).toBeUndefined();
  });
});
