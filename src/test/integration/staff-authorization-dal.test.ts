import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import pg from "pg";
import crypto from "node:crypto";
import { getPrisma, disconnectDb } from "@/lib/db";
import { resetAuth } from "@/lib/auth";
import { resetServerEnvCache } from "@/lib/env";
import { provisionStaffMember, ProvisioningError } from "@/lib/staff/provisioning";
import { assertStaffPermission, assertAuthenticated, AuthorizationError } from "@/lib/dal";
import { handleAuth } from "@/app/api/auth/[...all]/route";
import { POST as changePasswordHandler } from "@/app/api/v1/staff/auth/change-password/route";
import { NextRequest } from "next/server";
import { createOTP } from "@better-auth/utils/otp";
import { base32 } from "@better-auth/utils/base32";
import type { StaffDepartment, StaffRole } from "@/generated/prisma/client";

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

describe("Central Authorization DAL & Security Audit PostgreSQL Integration Suite", () => {
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
          await prisma.internalRoleAssignment.deleteMany({
            where: { staffMembership: { userId: { in: userIds } } },
          });
          await prisma.internalStaffMembership.deleteMany({ where: { userId: { in: userIds } } });
          await prisma.securityAuditEvent.deleteMany({ where: { actorUserId: { in: userIds } } });
          await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
          await prisma.account.deleteMany({ where: { userId: { in: userIds } } });
          await prisma.user.deleteMany({ where: { id: { in: userIds } } });
        }
      } catch {}
      createdUserEmails.length = 0;
    }
  });

  afterAll(async () => {
    await disconnectDb().catch(() => {});
  });

  function generateStaffData(prefix = "staff") {
    const id = crypto.randomUUID().slice(0, 8);
    const email = `${prefix}_${id}@waffarhacars.com`.toLowerCase();
    createdUserEmails.push(email);
    return {
      email,
      fullName: `Test Staff ${id}`,
      employeeNumber: `EMP-${id.toUpperCase()}`,
      temporaryPassword: "TemporaryPassword123!",
      permanentPassword: "PermanentSecurePassword123!",
    };
  }

  async function ensureBootstrapped() {
    const prisma = getPrisma();
    const count = await prisma.internalStaffMembership.count();
    if (count === 0) {
      const admin = generateStaffData("bootstrap_admin");
      await provisionStaffMember({
        email: admin.email,
        fullName: admin.fullName,
        employeeNumber: admin.employeeNumber,
        department: "ADMIN",
        role: "PLATFORM_ADMIN",
        password: admin.temporaryPassword,
        isBootstrap: true,
      });
    }
  }

  async function provisionAndActivateStaff(params: {
    department: StaffDepartment;
    role?: StaffRole;
    isBootstrap?: boolean;
  }) {
    if (!params.isBootstrap) {
      await ensureBootstrapped();
    }
    const staff = generateStaffData(params.department.toLowerCase());

    // 1. Provision staff member (transactional User + Membership + RoleAssignment + AuditEvent)
    const provisionResult = await provisionStaffMember({
      email: staff.email,
      fullName: staff.fullName,
      employeeNumber: staff.employeeNumber,
      department: params.department,
      role: params.role,
      password: staff.temporaryPassword,
      isBootstrap: params.isBootstrap,
    });

    // 2. Sign in with temporary password
    const signInRes = await postAuthJson("/api/auth/sign-in/email", {
      email: staff.email,
      password: staff.temporaryPassword,
    });
    expect(signInRes.status).toBe(200);
    const initialCookie = extractCookieHeader(signInRes);

    // 3. Change password to permanent
    const changeReq = new NextRequest("http://localhost:3000/api/v1/staff/auth/change-password", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: initialCookie,
      },
      body: JSON.stringify({
        currentPassword: staff.temporaryPassword,
        newPassword: staff.permanentPassword,
      }),
    });
    const changeRes = await changePasswordHandler(changeReq);
    expect(changeRes.status).toBe(200);
    const pwdCookie = extractCookieHeader(changeRes) || initialCookie;

    // 4. Enable TOTP
    const enableRes = await postAuthJson(
      "/api/auth/two-factor/enable",
      { password: staff.permanentPassword, method: "totp" },
      pwdCookie
    );
    expect(enableRes.status).toBe(200);
    const enableData = await enableRes.json();
    const secret = extractTotpSecret(enableData.totpURI);

    // 5. Verify TOTP to reach ACTIVE state
    const code = await createOTP(secret, { digits: 6, period: 30 }).totp();
    const verifyRes = await postAuthJson("/api/auth/two-factor/verify-totp", { code }, pwdCookie);
    expect(verifyRes.status).toBe(200);
    const activeCookie = extractCookieHeader(verifyRes) || pwdCookie;

    return {
      staff,
      provisionResult,
      activeCookie,
      headers: new Headers({ cookie: activeCookie }),
    };
  }

  it("proves SALES_AGENT role grants maker capabilities and denies checker and admin capabilities", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const { headers, provisionResult } = await provisionAndActivateStaff({
      department: "SALES",
      role: "SALES_AGENT",
    });

    expect(provisionResult.role).toBe("SALES_AGENT");

    // Allowed maker capabilities
    const draftCtx = await assertStaffPermission(headers, "offer_draft:create");
    expect(draftCtx.roleAssignment.role).toBe("SALES_AGENT");
    expect(draftCtx.grantedPermission).toBe("offer_draft:create");

    const submitCtx = await assertStaffPermission(headers, "offer_draft:submit");
    expect(submitCtx.grantedPermission).toBe("offer_draft:submit");

    const readCtx = await assertStaffPermission(headers, "staff:read");
    expect(readCtx.grantedPermission).toBe("staff:read");

    // Denied checker capabilities (403 Forbidden)
    await expect(assertStaffPermission(headers, "offer_draft:approve")).rejects.toThrow(
      AuthorizationError
    );
    try {
      await assertStaffPermission(headers, "offer_draft:approve");
    } catch (err) {
      const authErr = err as AuthorizationError;
      expect(authErr.status).toBe(403);
      expect(authErr.code).toBe("FORBIDDEN");
    }

    // Denied admin and settlement capabilities
    await expect(assertStaffPermission(headers, "payout:export")).rejects.toThrow(
      AuthorizationError
    );
    await expect(assertStaffPermission(headers, "staff:manage_roles")).rejects.toThrow(
      AuthorizationError
    );
  });

  it("proves OPS_SUPERVISOR role grants checker capabilities and denies maker draft creation", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const { headers, provisionResult } = await provisionAndActivateStaff({
      department: "OPERATIONS",
      role: "OPS_SUPERVISOR",
    });

    expect(provisionResult.role).toBe("OPS_SUPERVISOR");

    // Allowed checker capabilities
    const reviewCtx = await assertStaffPermission(headers, "offer_draft:review");
    expect(reviewCtx.roleAssignment.role).toBe("OPS_SUPERVISOR");

    const approveCtx = await assertStaffPermission(headers, "offer_draft:approve");
    expect(approveCtx.grantedPermission).toBe("offer_draft:approve");

    // Denied maker creation (Separation of Duties)
    await expect(assertStaffPermission(headers, "offer_draft:create")).rejects.toThrow(
      AuthorizationError
    );
    await expect(assertStaffPermission(headers, "payout:export")).rejects.toThrow(
      AuthorizationError
    );
  });

  it("proves FINANCE_OFFICER role grants settlement capabilities and denies offer approval", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const { headers, provisionResult } = await provisionAndActivateStaff({
      department: "FINANCE",
      role: "FINANCE_OFFICER",
    });

    expect(provisionResult.role).toBe("FINANCE_OFFICER");

    // Allowed settlement capabilities
    const payoutCtx = await assertStaffPermission(headers, "payout:view");
    expect(payoutCtx.grantedPermission).toBe("payout:view");

    const exportCtx = await assertStaffPermission(headers, "payout:export");
    expect(exportCtx.grantedPermission).toBe("payout:export");

    // Denied offer checker capabilities
    await expect(assertStaffPermission(headers, "offer_draft:approve")).rejects.toThrow(
      AuthorizationError
    );
  });

  it("proves PLATFORM_ADMIN grants administrative governance and strictly denies offer approval and payouts", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const prisma = getPrisma();
    const count = await prisma.internalStaffMembership.count();
    if (count > 0) {
      const existingStaff = await prisma.internalStaffMembership.findMany({
        select: { userId: true },
      });
      const userIds = existingStaff.map((s) => s.userId);
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

    const { headers, provisionResult } = await provisionAndActivateStaff({
      department: "ADMIN",
      role: "PLATFORM_ADMIN",
      isBootstrap: true,
    });

    expect(provisionResult.role).toBe("PLATFORM_ADMIN");

    // Allowed administrative capabilities
    const manageCtx = await assertStaffPermission(headers, "staff:manage_roles");
    expect(manageCtx.roleAssignment.role).toBe("PLATFORM_ADMIN");

    const auditCtx = await assertStaffPermission(headers, "audit:read");
    expect(auditCtx.grantedPermission).toBe("audit:read");

    // Strictly denied maker-checker offer actions and payouts (Separation of Duties)
    await expect(assertStaffPermission(headers, "offer_draft:approve")).rejects.toThrow(
      AuthorizationError
    );
    await expect(assertStaffPermission(headers, "payout:export")).rejects.toThrow(
      AuthorizationError
    );
  });

  it("proves roleless staff members have NO permissions and receive 403 NO_ACTIVE_ROLE", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const { headers, provisionResult } = await provisionAndActivateStaff({
      department: "SALES",
      role: "SALES_AGENT",
    });

    // Deactivate role assignment in database
    const prisma = getPrisma();
    await prisma.internalRoleAssignment.updateMany({
      where: { staffMembership: { userId: provisionResult.userId } },
      data: { isActive: false },
    });

    try {
      await assertStaffPermission(headers, "staff:read");
      expect.unreachable("Should have thrown 403");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthorizationError);
      const authErr = err as AuthorizationError;
      expect(authErr.status).toBe(403);
      expect(authErr.message).toBe("No active staff role assigned");
    }
  });

  it("proves inconsistent role assignments (> 1 active roles) fails closed with 403 INCONSISTENT_ROLES", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const { headers, provisionResult } = await provisionAndActivateStaff({
      department: "SALES",
      role: "SALES_AGENT",
    });

    // Add a conflicting active role assignment
    const prisma = getPrisma();
    const membership = await prisma.internalStaffMembership.findUnique({
      where: { userId: provisionResult.userId },
    });
    await prisma.internalRoleAssignment.create({
      data: {
        staffMembershipId: membership!.id,
        role: "OPS_SUPERVISOR",
        isActive: true,
      },
    });

    try {
      await assertStaffPermission(headers, "staff:read");
      expect.unreachable("Should have thrown 403");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthorizationError);
      const authErr = err as AuthorizationError;
      expect(authErr.status).toBe(403);
      expect(authErr.message).toBe("Inconsistent role assignment state");
    }
  });

  it("proves suspended staff member is denied immediately with 403 FORBIDDEN", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const { headers, provisionResult } = await provisionAndActivateStaff({
      department: "SALES",
      role: "SALES_AGENT",
    });

    // Suspend user in database
    const prisma = getPrisma();
    await prisma.user.update({
      where: { id: provisionResult.userId },
      data: { isSuspended: true },
    });

    try {
      await assertStaffPermission(headers, "staff:read");
      expect.unreachable("Should have thrown 403");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthorizationError);
      const authErr = err as AuthorizationError;
      expect(authErr.status).toBe(403);
      expect(authErr.message).toBe("Staff account is suspended or inactive");
    }
  });

  it("proves unknown permissions fail closed with 403 FORBIDDEN", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const { headers } = await provisionAndActivateStaff({
      department: "SALES",
      role: "SALES_AGENT",
    });

    try {
      await assertStaffPermission(headers, "arbitrary:malicious_action");
      expect.unreachable("Should have thrown 403");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthorizationError);
      const authErr = err as AuthorizationError;
      expect(authErr.status).toBe(403);
      expect(authErr.message).toBe("Permission denied");
    }
  });

  it("proves assertAuthenticated returns user and session context for active staff", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const { headers, staff } = await provisionAndActivateStaff({
      department: "SALES",
      role: "SALES_AGENT",
    });

    const authCtx = await assertAuthenticated(headers);
    expect(authCtx.user.email).toBe(staff.email.toLowerCase());
    expect(authCtx.user.isSuspended).toBe(false);
    expect(authCtx.session.id).toBeDefined();
  });

  it("proves absent session returns 401 UNAUTHENTICATED", async () => {
    try {
      await assertStaffPermission(new Headers(), "staff:read");
      expect.unreachable("Should have thrown 401");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthorizationError);
      const authErr = err as AuthorizationError;
      expect(authErr.status).toBe(401);
      expect(authErr.code).toBe("UNAUTHENTICATED");
    }
  });

  it("proves audit records are written on provisioning and permission denials with domain fingerprint", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const prisma = getPrisma();
    const { headers, provisionResult } = await provisionAndActivateStaff({
      department: "SALES",
      role: "SALES_AGENT",
    });

    // 1. Verify STAFF_PROVISIONED audit record
    const provisionAudit = await prisma.securityAuditEvent.findFirst({
      where: {
        actorUserId: provisionResult.userId,
        eventType: "STAFF_PROVISIONED",
      },
    });
    expect(provisionAudit).toBeDefined();
    expect(provisionAudit?.eventType).toBe("STAFF_PROVISIONED");
    expect((provisionAudit?.metadata as Record<string, unknown>).role).toBe("SALES_AGENT");

    // 2. Trigger permission denial
    try {
      await assertStaffPermission(headers, "payout:export");
    } catch {}

    // 3. Verify STAFF_ACCESS_DENIED audit record
    const denialAudit = await prisma.securityAuditEvent.findFirst({
      where: {
        actorUserId: provisionResult.userId,
        eventType: "STAFF_ACCESS_DENIED",
      },
      orderBy: { timestamp: "desc" },
    });
    expect(denialAudit).toBeDefined();
    expect(denialAudit?.eventType).toBe("STAFF_ACCESS_DENIED");
    expect(denialAudit?.ipFingerprint).toHaveLength(64);
    // Assert zero PII/secrets in metadata
    const metaStr = JSON.stringify(denialAudit?.metadata);
    expect(metaStr).not.toContain("password");
    expect(metaStr).not.toContain("secret");
    expect(metaStr).not.toContain("token");
    expect(metaStr).not.toContain("@");
  });

  it("proves ordinary provisioning attempting PLATFORM_ADMIN rejects with PLATFORM_ADMIN_BOOTSTRAP_ONLY", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    await ensureBootstrapped();
    const staff = generateStaffData("hacker");

    try {
      await provisionStaffMember({
        email: staff.email,
        fullName: staff.fullName,
        employeeNumber: staff.employeeNumber,
        department: "SALES",
        role: "PLATFORM_ADMIN",
        password: staff.temporaryPassword,
        isBootstrap: false,
      });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ProvisioningError);
      expect((err as ProvisioningError).code).toBe("PLATFORM_ADMIN_BOOTSTRAP_ONLY");
    }
  });

  it("proves incompatible role-department pairing rejects with INCOMPATIBLE_ROLE_DEPARTMENT", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    await ensureBootstrapped();
    const staff = generateStaffData("mismatch");

    try {
      await provisionStaffMember({
        email: staff.email,
        fullName: staff.fullName,
        employeeNumber: staff.employeeNumber,
        department: "SALES",
        role: "OPS_SUPERVISOR",
        password: staff.temporaryPassword,
        isBootstrap: false,
      });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ProvisioningError);
      expect((err as ProvisioningError).code).toBe("INCOMPATIBLE_ROLE_DEPARTMENT");
    }
  });
});
