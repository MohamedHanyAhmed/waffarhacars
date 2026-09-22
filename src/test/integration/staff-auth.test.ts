import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import pg from "pg";
import crypto from "node:crypto";
import { getPrisma, disconnectDb } from "@/lib/db";
import { resetAuth } from "@/lib/auth";
import { resetServerEnvCache } from "@/lib/env";
import { provisionStaffMember, ProvisioningError } from "@/lib/staff/provisioning";
import { resolveStaffSession } from "@/lib/staff/staff-session";
import { handleAuth } from "@/app/api/auth/[...all]/route";
import { POST as changePasswordHandler } from "@/app/api/v1/staff/auth/change-password/route";
import { NextRequest } from "next/server";
import { createOTP } from "@better-auth/utils/otp";

const DEFAULT_TEST_DB_URL =
  process.env.DATABASE_URL ||
  "postgresql://test_user:test_password@localhost:5432/waffarhacars_test";

const TEST_SECRET = "test-secret-at-least-32-characters-long-12345";
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    process.env.PHONE_LOOKUP_HMAC_KEY = "test-lookup-key-at-least-32-characters-long-12345";
  });

  afterEach(async () => {
    if (isDbReachable && createdUserEmails.length > 0) {
      try {
        const prisma = getPrisma();
        const users = await prisma.user.findMany({
          where: { email: { in: createdUserEmails } },
          select: { id: true },
        });
        const userIds = users.map((u) => u.id);
        if (userIds.length > 0) {
          await prisma.twoFactor.deleteMany({ where: { userId: { in: userIds } } });
          await prisma.internalStaffMembership.deleteMany({ where: { userId: { in: userIds } } });
          await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
          await prisma.account.deleteMany({ where: { userId: { in: userIds } } });
          await prisma.user.deleteMany({ where: { id: { in: userIds } } });
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
      department: "OPERATIONS",
      isBootstrap: true,
    });

    expect(result.success).toBe(true);
    expect(result.department).toBe("OPERATIONS");
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
      department: "SALES",
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
      department: "OPERATIONS",
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

    // After password change, state transitions to MFA_ENROLLMENT_REQUIRED
    const status2 = await resolveStaffSession(sessionHeaders);
    expect(status2.state).toBe("MFA_ENROLLMENT_REQUIRED");
    expect(status2.canAccessEnrollment).toBe(true);

    // 3. Enable TOTP
    const enableRes = await postAuthJson(
      "/api/auth/two-factor/enable",
      {
        password: newPassword,
        method: "totp",
      },
      sessionCookie!
    );

    expect(enableRes.status).toBe(200);
    const enableData = await enableRes.json();
    expect(enableData.totpURI).toBeDefined();
    expect(enableData.backupCodes).toBeDefined();
    expect(enableData.backupCodes.length).toBe(10);

    // Extract secret and generate valid 6-digit TOTP code
    const url = new URL(enableData.totpURI);
    const secret = url.searchParams.get("secret")!;
    expect(secret).toBeDefined();

    const totpCode = await createOTP(secret, { digits: 6, period: 30 }).totp();

    // 4. Verify TOTP to complete enrollment
    const verifyTotpRes = await postAuthJson(
      "/api/auth/two-factor/verify-totp",
      { code: totpCode },
      sessionCookie!
    );

    expect(verifyTotpRes.status).toBe(200);

    // State is now ACTIVE!
    const status3 = await resolveStaffSession(sessionHeaders);
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
      department: "SALES",
      isBootstrap: true,
    });

    const newPassword = "PermanentSecurePassword123!";

    // Setup user with 2FA
    const signInRes = await postAuthJson("/api/auth/sign-in/email", {
      email,
      password: temporaryPassword,
    });
    const sessionCookie = signInRes.headers.get("set-cookie")!;

    await changePasswordHandler(
      new NextRequest("http://localhost:3000/api/v1/staff/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: sessionCookie },
        body: JSON.stringify({ currentPassword: temporaryPassword, newPassword }),
      })
    );

    const enableRes = await postAuthJson(
      "/api/auth/two-factor/enable",
      { password: newPassword, method: "totp" },
      sessionCookie
    );
    const enableData = await enableRes.json();
    const firstBackupCode = enableData.backupCodes[0];
    const secret = new URL(enableData.totpURI).searchParams.get("secret")!;
    const totpCode = await createOTP(secret, { digits: 6, period: 30 }).totp();

    await postAuthJson("/api/auth/two-factor/verify-totp", { code: totpCode }, sessionCookie);

    // Sign in afresh: 2FA challenge is issued
    const signIn2 = await postAuthJson("/api/auth/sign-in/email", {
      email,
      password: newPassword,
    });
    const twoFactorCookie = signIn2.headers.get("set-cookie")!;

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
    const twoFactorCookie3 = signIn3.headers.get("set-cookie")!;

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
      department: "FINANCE",
      isBootstrap: true,
    });

    const newPassword = "PermanentSecurePassword123!";

    // Setup user with 2FA
    const signInRes = await postAuthJson("/api/auth/sign-in/email", {
      email,
      password: temporaryPassword,
    });
    const sessionCookie = signInRes.headers.get("set-cookie")!;

    await changePasswordHandler(
      new NextRequest("http://localhost:3000/api/v1/staff/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: sessionCookie },
        body: JSON.stringify({ currentPassword: temporaryPassword, newPassword }),
      })
    );

    const enableRes = await postAuthJson(
      "/api/auth/two-factor/enable",
      { password: newPassword, method: "totp" },
      sessionCookie
    );
    const enableData = await enableRes.json();
    const secret = new URL(enableData.totpURI).searchParams.get("secret")!;
    const code = await createOTP(secret, { digits: 6, period: 30 }).totp();
    await postAuthJson("/api/auth/two-factor/verify-totp", { code }, sessionCookie);

    // Fresh sign in -> triggers 2FA
    const freshSignIn = await postAuthJson("/api/auth/sign-in/email", {
      email,
      password: newPassword,
    });
    const twoFactorCookie = freshSignIn.headers.get("set-cookie")!;

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
});
