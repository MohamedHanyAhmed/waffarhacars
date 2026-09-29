import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import pg from "pg";
import crypto from "node:crypto";
import { getPrisma, disconnectDb } from "@/lib/db";
import { resetAuth } from "@/lib/auth";
import { resetServerEnvCache } from "@/lib/env";
import { provisionStaffMember } from "@/lib/staff/provisioning";
import { NextRequest } from "next/server";
import {
  POST as createProviderHandler,
  GET as listProvidersHandler,
} from "@/app/api/v1/staff/providers/route";
import {
  GET as getProviderHandler,
  PATCH as updateProviderHandler,
} from "@/app/api/v1/staff/providers/[id]/route";
import { POST as submitProviderHandler } from "@/app/api/v1/staff/providers/[id]/submit/route";
import {
  POST as createBranchHandler,
  GET as listBranchesHandler,
} from "@/app/api/v1/staff/providers/[id]/branches/route";
import {
  GET as getBranchHandler,
  PATCH as updateBranchHandler,
} from "@/app/api/v1/staff/providers/[id]/branches/[branchId]/route";
import { GET as listPendingOpsHandler } from "@/app/api/v1/staff/ops/providers/pending/route";
import { POST as activateProviderHandler } from "@/app/api/v1/staff/ops/providers/[id]/activate/route";
import { POST as rejectProviderHandler } from "@/app/api/v1/staff/ops/providers/[id]/reject/route";
import { POST as pauseProviderHandler } from "@/app/api/v1/staff/ops/providers/[id]/pause/route";
import { POST as resumeProviderHandler } from "@/app/api/v1/staff/ops/providers/[id]/resume/route";
import { POST as activateBranchHandler } from "@/app/api/v1/staff/ops/providers/[id]/branches/[branchId]/activate/route";
import { POST as rejectBranchHandler } from "@/app/api/v1/staff/ops/providers/[id]/branches/[branchId]/reject/route";
import { POST as pauseProviderBranchHandler } from "@/app/api/v1/staff/ops/providers/[id]/branches/[branchId]/pause/route";
import { POST as resumeProviderBranchHandler } from "@/app/api/v1/staff/ops/providers/[id]/branches/[branchId]/resume/route";
import { POST as pauseBranchHandler } from "@/app/api/v1/staff/ops/branches/[branchId]/pause/route";
import { POST as resumeBranchHandler } from "@/app/api/v1/staff/ops/branches/[branchId]/resume/route";
import { isBranchOperationallyAvailable } from "@/lib/provider/service";

const DEFAULT_TEST_DB_URL =
  process.env.DATABASE_URL ||
  "postgresql://test_user:test_password@localhost:5432/waffarhacars_test";

const TEST_SECRET = "test-secret-at-least-32-characters-long-12345";

function createSignedSessionCookie(token: string, secret: string = TEST_SECRET): string {
  const signature = crypto.createHmac("sha256", secret).update(token).digest("base64");
  return `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`;
}

describe("Sales-Managed Provider & Branch Onboarding with Operations Activation Integration Suite", () => {
  let isDbReachable = false;
  const originalEnv = { ...process.env };
  const createdUserEmails: string[] = [];
  const createdProviderIds: string[] = [];

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
    process.env.STAFF_LOGIN_HMAC_KEY = "test-staff-login-key-at-least-32-characters-long-12345";
    process.env.OTP_PEPPER_SECRET = "test-otp-pepper-key-at-least-32-characters-long-12345";
    process.env.PHONE_ALIAS_HMAC_KEY = "test-phone-alias-key-at-least-32-characters-long-12345";
  });

  afterEach(async () => {
    if (isDbReachable) {
      const prisma = getPrisma();
      try {
        if (createdProviderIds.length > 0) {
          await prisma.providerBranch.deleteMany({
            where: { providerOrganizationId: { in: createdProviderIds } },
          });
          await prisma.providerOrganization.deleteMany({
            where: { id: { in: createdProviderIds } },
          });
        }
        if (createdUserEmails.length > 0) {
          const users = await prisma.user.findMany({
            where: { email: { in: createdUserEmails } },
            select: { id: true },
          });
          const userIds = users.map((u) => u.id);
          if (userIds.length > 0) {
            await prisma.securityAuditEvent.deleteMany({
              where: { actorUserId: { in: userIds } },
            });
            await prisma.internalRoleAssignment.deleteMany({
              where: { staffMembership: { userId: { in: userIds } } },
            });
            await prisma.internalStaffMembership.deleteMany({
              where: { userId: { in: userIds } },
            });
            await prisma.twoFactor.deleteMany({
              where: { userId: { in: userIds } },
            });
            await prisma.session.deleteMany({
              where: { userId: { in: userIds } },
            });
            await prisma.account.deleteMany({
              where: { userId: { in: userIds } },
            });
            await prisma.user.deleteMany({
              where: { id: { in: userIds } },
            });
          }
        }
      } catch (err) {
        console.error("Cleanup error in afterEach:", err);
      }
    }
    createdUserEmails.length = 0;
    createdProviderIds.length = 0;
  });

  afterAll(async () => {
    process.env = originalEnv;
    await disconnectDb();
  });

  async function createAuthenticatedStaffUser(
    role: "SALES_AGENT" | "OPS_SUPERVISOR",
    dept: "SALES" | "OPERATIONS"
  ) {
    const prisma = getPrisma();
    const uid = crypto.randomUUID().slice(0, 8);
    const email = `staff-${role.toLowerCase()}-${uid}@test.eg`;
    createdUserEmails.push(email);

    // Bootstrap first admin if zero staff exist to ensure provisioning succeeds
    const staffCount = await prisma.internalStaffMembership.count();
    if (staffCount === 0) {
      const adminEmail = `admin-bootstrap-${uid}@test.eg`;
      createdUserEmails.push(adminEmail);
      await provisionStaffMember({
        email: adminEmail,
        password: "ValidStaffPassword123!",
        fullName: "System Admin Bootstrap",
        employeeNumber: `BOOT-${uid}`,
        department: "ADMIN",
        isBootstrap: true,
      });
    }

    const provisionResult = await provisionStaffMember({
      email,
      password: "ValidStaffPassword123!",
      fullName: `Test Staff ${role}`,
      employeeNumber: `EMP-${uid}`,
      department: dept,
      role,
      isBootstrap: false,
    });

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: provisionResult.userId },
      include: { internalStaffMembership: true },
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorEnabled: true },
    });

    await prisma.twoFactor.create({
      data: {
        userId: user.id,
        secret: "JBSWY3DPEHPK3PXP",
        backupCodes: "[]",
        verified: true,
      },
    });

    await prisma.internalStaffMembership.update({
      where: { userId: user.id },
      data: { mustChangePassword: false, isActive: true },
    });

    const sessionToken = `test-session-${crypto.randomUUID()}`;
    await prisma.session.create({
      data: {
        userId: user.id,
        token: sessionToken,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        lastActivityAt: new Date(),
      },
    });

    const cookie = createSignedSessionCookie(sessionToken);
    return { user, cookie };
  }

  it("executes end-to-end sales provider/branch onboarding, individual branch vetting, and operations activation", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const sales = await createAuthenticatedStaffUser("SALES_AGENT", "SALES");
    const ops = await createAuthenticatedStaffUser("OPS_SUPERVISOR", "OPERATIONS");

    const uid = crypto.randomUUID().slice(0, 6);
    const taxId = `${Math.floor(100000000 + Math.random() * 900000000)}`;

    // 1. Sales creates draft provider organization
    const createProviderReq = new NextRequest("http://localhost:3000/api/v1/staff/providers", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: sales.cookie,
        "x-forwarded-for": "198.51.100.1",
      },
      body: JSON.stringify({
        nameEn: "Cairo Elite Auto Care",
        nameAr: "كايرو إيليت لخدمات السيارات",
        legalName: "Cairo Elite Automotive SAE",
        taxRegistrationNumber: taxId,
        commercialRegistrationNumber: `CR-${uid}`,
        primaryCluster: "NASR_CITY_HELIOPOLIS",
        contactPersonName: "Mahmoud Soliman",
        contactEmail: "mahmoud@cairoelite.eg",
        contactPhone: "01012345678",
      }),
    });

    const createProviderRes = await createProviderHandler(createProviderReq);
    expect(createProviderRes.status).toBe(201);
    const providerData = await createProviderRes.json();
    createdProviderIds.push(providerData.id);

    expect(providerData.status).toBe("DRAFT");
    expect(providerData.version).toBe(1);
    expect(providerData.contactPhone).toBe("+201012345678");

    // 2. Sales creates draft branch
    const createBranchReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/providers/${providerData.id}/branches`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: sales.cookie,
          "x-forwarded-for": "198.51.100.1",
        },
        body: JSON.stringify({
          branchCode: `NC-01-${uid}`,
          nameEn: "Nasr City Main Center",
          nameAr: "فرع مدينة نصر الرئيسي",
          cluster: "NASR_CITY_HELIOPOLIS",
          streetAddressEn: "24 Makram Ebeid St",
          streetAddressAr: "٢٤ شارع مكرم عبيد",
          landmarkEn: "Opposite City Stars",
          latitude: 30.0612,
          longitude: 31.3411,
          contactPhone: "01198765432",
          operatingHours: [
            { dayOfWeek: 0, openTime: "09:00", closeTime: "21:00", isClosed: false },
            { dayOfWeek: 1, openTime: "09:00", closeTime: "21:00", isClosed: false },
          ],
        }),
      }
    );

    const createBranchRes = await createBranchHandler(createBranchReq, {
      params: Promise.resolve({ id: providerData.id }),
    });
    expect(createBranchRes.status).toBe(201);
    const branchData = await createBranchRes.json();
    expect(branchData.status).toBe("DRAFT");
    expect(branchData.cluster).toBe("NASR_CITY_HELIOPOLIS");

    // 3. Sales submits provider for review
    const submitReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/providers/${providerData.id}/submit`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: sales.cookie,
          "x-forwarded-for": "198.51.100.1",
        },
        body: JSON.stringify({
          expectedVersion: 1,
        }),
      }
    );

    const submitRes = await submitProviderHandler(submitReq, {
      params: Promise.resolve({ id: providerData.id }),
    });
    expect(submitRes.status).toBe(200);
    const submittedData = await submitRes.json();
    expect(submittedData.status).toBe("PENDING_REVIEW");
    expect(submittedData.version).toBe(2);

    // 4. Operations checks pending queue
    const pendingReq = new NextRequest("http://localhost:3000/api/v1/staff/ops/providers/pending", {
      method: "GET",
      headers: { cookie: ops.cookie },
    });
    const pendingRes = await listPendingOpsHandler(pendingReq);
    expect(pendingRes.status).toBe(200);
    const pendingList = await pendingRes.json();
    const foundPending = pendingList.find((p: { id: string }) => p.id === providerData.id);
    expect(foundPending).toBeDefined();

    // 5. Operations attempts provider activation before branch is vetted -> 422 ACTIVE_BRANCH_REQUIRED
    const prematureActivateReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/ops/providers/${providerData.id}/activate`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ops.cookie },
        body: JSON.stringify({ expectedVersion: 2 }),
      }
    );
    const prematureRes = await activateProviderHandler(prematureActivateReq, {
      params: Promise.resolve({ id: providerData.id }),
    });
    expect(prematureRes.status).toBe(422);
    const prematureBody = await prematureRes.json();
    expect(prematureBody.error).toBe("ACTIVE_BRANCH_REQUIRED");

    // 6. Operations vets and activates the branch individually
    const activateBranchReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/ops/providers/${providerData.id}/branches/${branchData.id}/activate`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: ops.cookie,
          "x-forwarded-for": "198.51.100.2",
        },
        body: JSON.stringify({
          expectedVersion: 1,
          legalIdentityChecked: true,
          physicalLocationChecked: true,
          contactAndHoursChecked: true,
          evidenceDocumentRef: "DOC-EGY-2026-NC01",
        }),
      }
    );
    const activateBranchRes = await activateBranchHandler(activateBranchReq, {
      params: Promise.resolve({ id: providerData.id, branchId: branchData.id }),
    });
    expect(activateBranchRes.status).toBe(200);
    const activatedBranch = await activateBranchRes.json();
    expect(activatedBranch.status).toBe("ACTIVE");
    expect(activatedBranch.legalIdentityChecked).toBe(true);
    expect(activatedBranch.vettedByUserId).toBe(ops.user.id);
    expect(activatedBranch.evidenceDocumentRef).toBe("DOC-EGY-2026-NC01");

    // 7. Operations activates the provider organization now that at least 1 branch is ACTIVE
    const activateReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/ops/providers/${providerData.id}/activate`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: ops.cookie,
          "x-forwarded-for": "198.51.100.2",
        },
        body: JSON.stringify({
          expectedVersion: 2,
        }),
      }
    );

    const activateRes = await activateProviderHandler(activateReq, {
      params: Promise.resolve({ id: providerData.id }),
    });
    expect(activateRes.status).toBe(200);
    const activatedData = await activateRes.json();
    expect(activatedData.status).toBe("ACTIVE");
    expect(activatedData.version).toBe(3);

    // 8. Verify operational availability via branch GET endpoint: both are ACTIVE
    const getBranchReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/providers/${providerData.id}/branches/${branchData.id}`,
      {
        method: "GET",
        headers: { cookie: sales.cookie },
      }
    );
    const getBranchRes = await getBranchHandler(getBranchReq, {
      params: Promise.resolve({ id: providerData.id, branchId: branchData.id }),
    });
    expect(getBranchRes.status).toBe(200);
    const fetchedBranch = await getBranchRes.json();
    expect(fetchedBranch.isOperationallyAvailable).toBe(true);

    // 9. Verify audit events recorded in PostgreSQL with zero PII
    const prisma = getPrisma();
    const auditEvents = await prisma.securityAuditEvent.findMany({
      where: {
        OR: [
          { targetEntity: `provider:${providerData.id}` },
          { targetEntity: `provider_branch:${branchData.id}` },
        ],
      },
      orderBy: { timestamp: "asc" },
    });
    expect(auditEvents.length).toBeGreaterThanOrEqual(4);

    const eventTypes = auditEvents.map((a) => a.eventType);
    expect(eventTypes).toContain("PROVIDER_DRAFT_CREATED");
    expect(eventTypes).toContain("BRANCH_DRAFT_CREATED");
    expect(eventTypes).toContain("PROVIDER_SUBMITTED_FOR_REVIEW");
    expect(eventTypes).toContain("BRANCH_ACTIVATED");
    expect(eventTypes).toContain("PROVIDER_ACTIVATED");

    // Assert zero contact phone, email, or credentials in audit metadata
    for (const event of auditEvents) {
      const metaStr = JSON.stringify(event.metadata);
      expect(metaStr).not.toContain("01012345678");
      expect(metaStr).not.toContain("mahmoud@cairoelite.eg");
    }
  });

  it("enforces maker-checker segregation: sales cannot activate, and ops cannot activate a provider or branch they submitted", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const sales = await createAuthenticatedStaffUser("SALES_AGENT", "SALES");
    const ops = await createAuthenticatedStaffUser("OPS_SUPERVISOR", "OPERATIONS");

    const uid = crypto.randomUUID().slice(0, 6);
    const taxId = `${Math.floor(100000000 + Math.random() * 900000000)}`;

    const prisma = getPrisma();
    const provider = await prisma.providerOrganization.create({
      data: {
        nameEn: "Maker Checker Test Auto",
        nameAr: "اختبار ميكر تشيكر",
        legalName: "Maker Checker Auto SAE",
        taxRegistrationNumber: taxId,
        commercialRegistrationNumber: `CR-${uid}`,
        primaryCluster: "NASR_CITY_HELIOPOLIS",
        contactPersonName: "Tarek Nour",
        contactEmail: "tarek@makerchecker.eg",
        contactPhone: "+201012345678",
        createdByUserId: sales.user.id,
        submittedByUserId: sales.user.id,
        status: "PENDING_REVIEW",
        version: 2,
        branches: {
          create: {
            branchCode: `BR-${uid}`,
            nameEn: "Branch 1",
            nameAr: "فرع 1",
            cluster: "NASR_CITY_HELIOPOLIS",
            streetAddressEn: "Test Address",
            streetAddressAr: "عنوان تجريبي",
            latitude: 30.05,
            longitude: 31.33,
            contactPhone: "+201123456789",
            operatingHours: [
              { dayOfWeek: 0, openTime: "09:00", closeTime: "18:00", isClosed: false },
            ],
            status: "DRAFT",
          },
        },
      },
      include: { branches: true },
    });
    createdProviderIds.push(provider.id);
    const branch = provider.branches[0];

    // Case 1: Sales Agent attempts to call activate branch -> 403 FORBIDDEN
    const salesActivateBranchReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/ops/providers/${provider.id}/branches/${branch.id}/activate`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: sales.cookie },
        body: JSON.stringify({
          expectedVersion: 1,
          legalIdentityChecked: true,
          physicalLocationChecked: true,
          contactAndHoursChecked: true,
          evidenceDocumentRef: "EVID-001",
        }),
      }
    );
    const salesActivateBranchRes = await activateBranchHandler(salesActivateBranchReq, {
      params: Promise.resolve({ id: provider.id, branchId: branch.id }),
    });
    expect(salesActivateBranchRes.status).toBe(403);

    // Case 2: If submittedBy was the Ops supervisor, Ops supervisor cannot self-activate branch -> 403 MAKER_CHECKER_VIOLATION
    await prisma.providerOrganization.update({
      where: { id: provider.id },
      data: { submittedByUserId: ops.user.id },
    });

    const opsSelfActivateBranchReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/ops/providers/${provider.id}/branches/${branch.id}/activate`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ops.cookie },
        body: JSON.stringify({
          expectedVersion: 1,
          legalIdentityChecked: true,
          physicalLocationChecked: true,
          contactAndHoursChecked: true,
          evidenceDocumentRef: "EVID-001",
        }),
      }
    );
    const opsSelfActivateBranchRes = await activateBranchHandler(opsSelfActivateBranchReq, {
      params: Promise.resolve({ id: provider.id, branchId: branch.id }),
    });
    expect(opsSelfActivateBranchRes.status).toBe(403);
    const opsBody = await opsSelfActivateBranchRes.json();
    expect(opsBody.error).toBe("MAKER_CHECKER_VIOLATION");
  });

  it("enforces parent-branch ownership checks and returns 404 for mismatched parent IDs", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const sales = await createAuthenticatedStaffUser("SALES_AGENT", "SALES");
    const ops = await createAuthenticatedStaffUser("OPS_SUPERVISOR", "OPERATIONS");
    const uid1 = crypto.randomUUID().slice(0, 6);
    const uid2 = crypto.randomUUID().slice(0, 6);

    const prisma = getPrisma();
    // Provider 1
    const p1 = await prisma.providerOrganization.create({
      data: {
        nameEn: "Provider One",
        nameAr: "المزود الأول",
        legalName: "Provider One SAE",
        taxRegistrationNumber: `${Math.floor(100000000 + Math.random() * 900000000)}`,
        commercialRegistrationNumber: `CR-${uid1}`,
        primaryCluster: "NASR_CITY_HELIOPOLIS",
        contactPersonName: "Person One",
        contactEmail: "one@test.eg",
        contactPhone: "+201012345678",
        createdByUserId: sales.user.id,
        status: "DRAFT",
        branches: {
          create: {
            branchCode: `BR-${uid1}`,
            nameEn: "Branch One",
            nameAr: "فرع 1",
            cluster: "NASR_CITY_HELIOPOLIS",
            streetAddressEn: "Address 1",
            streetAddressAr: "عنوان 1",
            latitude: 30.05,
            longitude: 31.33,
            contactPhone: "+201123456789",
            operatingHours: [
              { dayOfWeek: 0, openTime: "09:00", closeTime: "18:00", isClosed: false },
            ],
            status: "DRAFT",
          },
        },
      },
      include: { branches: true },
    });
    createdProviderIds.push(p1.id);

    // Provider 2
    const p2 = await prisma.providerOrganization.create({
      data: {
        nameEn: "Provider Two",
        nameAr: "المزود الثاني",
        legalName: "Provider Two SAE",
        taxRegistrationNumber: `${Math.floor(100000000 + Math.random() * 900000000)}`,
        commercialRegistrationNumber: `CR-${uid2}`,
        primaryCluster: "NASR_CITY_HELIOPOLIS",
        contactPersonName: "Person Two",
        contactEmail: "two@test.eg",
        contactPhone: "+201012345679",
        createdByUserId: sales.user.id,
        status: "DRAFT",
        branches: {
          create: {
            branchCode: `BR-${uid2}`,
            nameEn: "Branch Two",
            nameAr: "فرع 2",
            cluster: "NASR_CITY_HELIOPOLIS",
            streetAddressEn: "Address 2",
            streetAddressAr: "عنوان 2",
            latitude: 30.06,
            longitude: 31.34,
            contactPhone: "+201123456788",
            operatingHours: [
              { dayOfWeek: 0, openTime: "09:00", closeTime: "18:00", isClosed: false },
            ],
            status: "DRAFT",
          },
        },
      },
      include: { branches: true },
    });
    createdProviderIds.push(p2.id);

    const b2 = p2.branches[0];

    // Attempt to update Branch 2 using Provider 1 ID -> 404 BRANCH_NOT_FOUND
    const mismatchedUpdateReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/providers/${p1.id}/branches/${b2.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: sales.cookie },
        body: JSON.stringify({ expectedVersion: 1, nameEn: "Hijacked Branch Name" }),
      }
    );
    const mismatchedUpdateRes = await updateBranchHandler(mismatchedUpdateReq, {
      params: Promise.resolve({ id: p1.id, branchId: b2.id }),
    });
    expect(mismatchedUpdateRes.status).toBe(404);
    const mismatchedBody = await mismatchedUpdateRes.json();
    expect(mismatchedBody.error).toBe("BRANCH_NOT_FOUND");

    // Attempt to activate Branch 2 using Provider 1 ID -> 404 BRANCH_NOT_FOUND
    const mismatchedActivateReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/ops/providers/${p1.id}/branches/${b2.id}/activate`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ops.cookie },
        body: JSON.stringify({
          expectedVersion: 1,
          legalIdentityChecked: true,
          physicalLocationChecked: true,
          contactAndHoursChecked: true,
          evidenceDocumentRef: "DOC-NC-001",
        }),
      }
    );
    const mismatchedActivateRes = await activateBranchHandler(mismatchedActivateReq, {
      params: Promise.resolve({ id: p1.id, branchId: b2.id }),
    });
    expect(mismatchedActivateRes.status).toBe(404);
  });

  it("enforces strict draft-only editing and rejects modifications to ACTIVE records with HTTP 422", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const sales = await createAuthenticatedStaffUser("SALES_AGENT", "SALES");
    const uid = crypto.randomUUID().slice(0, 6);

    const prisma = getPrisma();
    const activeProvider = await prisma.providerOrganization.create({
      data: {
        nameEn: "Active Edit Test",
        nameAr: "اختبار تعديل النشط",
        legalName: "Active Edit SAE",
        taxRegistrationNumber: `${Math.floor(100000000 + Math.random() * 900000000)}`,
        commercialRegistrationNumber: `CR-${uid}`,
        primaryCluster: "NASR_CITY_HELIOPOLIS",
        contactPersonName: "Yasser Lotfy",
        contactEmail: "yasser@active.eg",
        contactPhone: "+201012345678",
        createdByUserId: sales.user.id,
        status: "ACTIVE", // Already ACTIVE
        version: 3,
        branches: {
          create: {
            branchCode: `BR-${uid}`,
            nameEn: "Active Branch",
            nameAr: "فرع نشط",
            cluster: "NASR_CITY_HELIOPOLIS",
            streetAddressEn: "Address",
            streetAddressAr: "عنوان",
            latitude: 30.05,
            longitude: 31.33,
            contactPhone: "+201123456789",
            operatingHours: [
              { dayOfWeek: 0, openTime: "09:00", closeTime: "18:00", isClosed: false },
            ],
            status: "ACTIVE",
            version: 2,
          },
        },
      },
      include: { branches: true },
    });
    createdProviderIds.push(activeProvider.id);
    const branch = activeProvider.branches[0];

    // Sales attempts to edit active provider draft -> 422 INVALID_STATE_TRANSITION
    const editProviderReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/providers/${activeProvider.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: sales.cookie },
        body: JSON.stringify({ expectedVersion: 3, nameEn: "Illegal Edit" }),
      }
    );
    const editProviderRes = await updateProviderHandler(editProviderReq, {
      params: Promise.resolve({ id: activeProvider.id }),
    });
    expect(editProviderRes.status).toBe(422);
    const editProviderBody = await editProviderRes.json();
    expect(editProviderBody.error).toBe("INVALID_STATE_TRANSITION");

    // Sales attempts to edit active branch -> 422 INVALID_STATE_TRANSITION
    const editBranchReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/providers/${activeProvider.id}/branches/${branch.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: sales.cookie },
        body: JSON.stringify({ expectedVersion: 2, nameEn: "Illegal Branch Edit" }),
      }
    );
    const editBranchRes = await updateBranchHandler(editBranchReq, {
      params: Promise.resolve({ id: activeProvider.id, branchId: branch.id }),
    });
    expect(editBranchRes.status).toBe(422);
  });

  it("handles duplicate Tax ID and Commercial Registration uniqueness collisions with HTTP 409", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const sales = await createAuthenticatedStaffUser("SALES_AGENT", "SALES");
    const uid = crypto.randomUUID().slice(0, 6);
    const taxId = `${Math.floor(100000000 + Math.random() * 900000000)}`;

    const req1 = new NextRequest("http://localhost:3000/api/v1/staff/providers", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: sales.cookie },
      body: JSON.stringify({
        nameEn: "Provider One",
        nameAr: "مزود أول",
        legalName: "Provider One SAE",
        taxRegistrationNumber: taxId,
        commercialRegistrationNumber: `CR-${uid}-1`,
        primaryCluster: "NASR_CITY_HELIOPOLIS",
        contactPersonName: "Kareem Taha",
        contactEmail: "kareem@one.eg",
        contactPhone: "01012345678",
      }),
    });
    const res1 = await createProviderHandler(req1);
    expect(res1.status).toBe(201);
    const p1 = await res1.json();
    createdProviderIds.push(p1.id);

    // Attempt second provider with duplicate Tax ID -> 409 TAX_ID_ALREADY_EXISTS
    const reqDuplicateTax = new NextRequest("http://localhost:3000/api/v1/staff/providers", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: sales.cookie },
      body: JSON.stringify({
        nameEn: "Provider Two",
        nameAr: "مزود ثان",
        legalName: "Provider Two SAE",
        taxRegistrationNumber: taxId, // duplicate
        commercialRegistrationNumber: `CR-${uid}-2`,
        primaryCluster: "NASR_CITY_HELIOPOLIS",
        contactPersonName: "Kareem Taha",
        contactEmail: "kareem@two.eg",
        contactPhone: "01012345679",
      }),
    });
    const resDuplicateTax = await createProviderHandler(reqDuplicateTax);
    expect(resDuplicateTax.status).toBe(409);
    const bodyTax = await resDuplicateTax.json();
    expect(bodyTax.error).toBe("TAX_ID_ALREADY_EXISTS");

    // Attempt branch code duplicate under same provider
    const branchReq1 = new NextRequest(
      `http://localhost:3000/api/v1/staff/providers/${p1.id}/branches`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: sales.cookie },
        body: JSON.stringify({
          branchCode: "CODE-A",
          nameEn: "Branch A",
          nameAr: "فرع أ",
          cluster: "NASR_CITY_HELIOPOLIS",
          streetAddressEn: "Address A",
          streetAddressAr: "عنوان أ",
          latitude: 30.05,
          longitude: 31.33,
          contactPhone: "01123456789",
          operatingHours: [
            { dayOfWeek: 0, openTime: "09:00", closeTime: "18:00", isClosed: false },
          ],
        }),
      }
    );
    const branchRes1 = await createBranchHandler(branchReq1, {
      params: Promise.resolve({ id: p1.id }),
    });
    expect(branchRes1.status).toBe(201);

    const branchReqDuplicate = new NextRequest(
      `http://localhost:3000/api/v1/staff/providers/${p1.id}/branches`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: sales.cookie },
        body: JSON.stringify({
          branchCode: "CODE-A", // duplicate for p1
          nameEn: "Branch B",
          nameAr: "فرع ب",
          cluster: "NASR_CITY_HELIOPOLIS",
          streetAddressEn: "Address B",
          streetAddressAr: "عنوان ب",
          latitude: 30.06,
          longitude: 31.34,
          contactPhone: "01123456788",
          operatingHours: [
            { dayOfWeek: 0, openTime: "09:00", closeTime: "18:00", isClosed: false },
          ],
        }),
      }
    );
    const branchResDuplicate = await createBranchHandler(branchReqDuplicate, {
      params: Promise.resolve({ id: p1.id }),
    });
    expect(branchResDuplicate.status).toBe(409);
    const bodyBranch = await branchResDuplicate.json();
    expect(bodyBranch.error).toBe("BRANCH_CODE_ALREADY_EXISTS");
  });

  it("proves atomic CAS row-level serialization on overlapping concurrent competing requests", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const sales = await createAuthenticatedStaffUser("SALES_AGENT", "SALES");
    const uid = crypto.randomUUID().slice(0, 6);
    const taxId = `${Math.floor(100000000 + Math.random() * 900000000)}`;

    const prisma = getPrisma();
    const provider = await prisma.providerOrganization.create({
      data: {
        nameEn: "CAS Race Test",
        nameAr: "اختبار سباق التزامن",
        legalName: "CAS Race SAE",
        taxRegistrationNumber: taxId,
        commercialRegistrationNumber: `CR-${uid}`,
        primaryCluster: "NASR_CITY_HELIOPOLIS",
        contactPersonName: "Omar Kamal",
        contactEmail: "omar@cas.eg",
        contactPhone: "+201012345678",
        createdByUserId: sales.user.id,
        status: "DRAFT",
        version: 1,
      },
    });
    createdProviderIds.push(provider.id);

    // Prepare two competing requests both expecting version 1
    const reqA = new NextRequest(`http://localhost:3000/api/v1/staff/providers/${provider.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: sales.cookie },
      body: JSON.stringify({ expectedVersion: 1, nameEn: "Winner Update A" }),
    });

    const reqB = new NextRequest(`http://localhost:3000/api/v1/staff/providers/${provider.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: sales.cookie },
      body: JSON.stringify({ expectedVersion: 1, nameEn: "Competing Update B" }),
    });

    // Launch competing requests concurrently to force PostgreSQL row-lock contention
    const [resA, resB] = await Promise.all([
      updateProviderHandler(reqA, { params: Promise.resolve({ id: provider.id }) }),
      updateProviderHandler(reqB, { params: Promise.resolve({ id: provider.id }) }),
    ]);

    const statuses = [resA.status, resB.status];
    expect(statuses).toContain(200);
    expect(statuses).toContain(409);

    // Final PostgreSQL database state assertion: version MUST be exactly 2 (not 3)
    const finalProvider = await prisma.providerOrganization.findUniqueOrThrow({
      where: { id: provider.id },
    });
    expect(finalProvider.version).toBe(2);

    // Exactly one update audit event recorded
    const auditCount = await prisma.securityAuditEvent.count({
      where: {
        targetEntity: `provider:${provider.id}`,
        eventType: "PROVIDER_DRAFT_UPDATED",
      },
    });
    expect(auditCount).toBe(1);
  });

  it("supports Operations pause and resume on both provider and branch levels with allowlisted reason codes", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const ops = await createAuthenticatedStaffUser("OPS_SUPERVISOR", "OPERATIONS");
    const uid = crypto.randomUUID().slice(0, 6);
    const taxId = `${Math.floor(100000000 + Math.random() * 900000000)}`;

    const prisma = getPrisma();
    const provider = await prisma.providerOrganization.create({
      data: {
        nameEn: "Pause Resume Test Auto",
        nameAr: "اختبار الإيقاف والاستئناف",
        legalName: "Pause Resume SAE",
        taxRegistrationNumber: taxId,
        commercialRegistrationNumber: `CR-${uid}`,
        primaryCluster: "NASR_CITY_HELIOPOLIS",
        contactPersonName: "Mona Adel",
        contactEmail: "mona@pause.eg",
        contactPhone: "+201012345678",
        createdByUserId: ops.user.id,
        status: "ACTIVE",
        version: 3,
        branches: {
          create: {
            branchCode: `BR-${uid}`,
            nameEn: "Active Branch",
            nameAr: "فرع نشط",
            cluster: "NASR_CITY_HELIOPOLIS",
            streetAddressEn: "Address",
            streetAddressAr: "عنوان",
            latitude: 30.05,
            longitude: 31.33,
            contactPhone: "+201123456789",
            operatingHours: [
              { dayOfWeek: 0, openTime: "09:00", closeTime: "18:00", isClosed: false },
            ],
            status: "ACTIVE",
            version: 2,
          },
        },
      },
      include: { branches: true },
    });
    createdProviderIds.push(provider.id);
    const branch = provider.branches[0];

    // 1. Pause Provider with allowlisted reason code
    const pauseReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/ops/providers/${provider.id}/pause`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ops.cookie },
        body: JSON.stringify({
          expectedVersion: 3,
          reasonCode: "OPERATIONAL_HOLD",
          pauseReason: "Temporary operational review during equipment upgrade.",
        }),
      }
    );
    const pauseRes = await pauseProviderHandler(pauseReq, {
      params: Promise.resolve({ id: provider.id }),
    });
    expect(pauseRes.status).toBe(200);
    const pausedProvider = await pauseRes.json();
    expect(pausedProvider.status).toBe("PAUSED");
    expect(pausedProvider.version).toBe(4);

    // 2. Resume Provider
    const resumeReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/ops/providers/${provider.id}/resume`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ops.cookie },
        body: JSON.stringify({ expectedVersion: 4 }),
      }
    );
    const resumeRes = await resumeProviderHandler(resumeReq, {
      params: Promise.resolve({ id: provider.id }),
    });
    expect(resumeRes.status).toBe(200);
    const resumedProvider = await resumeRes.json();
    expect(resumedProvider.status).toBe("ACTIVE");
    expect(resumedProvider.version).toBe(5);

    // 3. Pause Branch via parent-scoped route
    const pauseBranchReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/ops/providers/${provider.id}/branches/${branch.id}/pause`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ops.cookie },
        body: JSON.stringify({
          expectedVersion: 2,
          reasonCode: "MAINTENANCE_OR_RENOVATION",
          pauseReason: "Facility renovation",
        }),
      }
    );
    const pauseBranchRes = await pauseProviderBranchHandler(pauseBranchReq, {
      params: Promise.resolve({ id: provider.id, branchId: branch.id }),
    });
    expect(pauseBranchRes.status).toBe(200);
    const pausedBranch = await pauseBranchRes.json();
    expect(pausedBranch.status).toBe("PAUSED");
    expect(pausedBranch.version).toBe(3);

    // 4. Resume Branch via parent-scoped route
    const resumeBranchReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/ops/providers/${provider.id}/branches/${branch.id}/resume`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ops.cookie },
        body: JSON.stringify({ expectedVersion: 3 }),
      }
    );
    const resumeBranchRes = await resumeProviderBranchHandler(resumeBranchReq, {
      params: Promise.resolve({ id: provider.id, branchId: branch.id }),
    });
    expect(resumeBranchRes.status).toBe(200);
    const resumedBranch = await resumeBranchRes.json();
    expect(resumedBranch.status).toBe("ACTIVE");
    expect(resumedBranch.version).toBe(4);
  });

  it("supports remediable rejection returning to DRAFT and permanent rejection as terminal", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const sales = await createAuthenticatedStaffUser("SALES_AGENT", "SALES");
    const ops = await createAuthenticatedStaffUser("OPS_SUPERVISOR", "OPERATIONS");
    const uid = crypto.randomUUID().slice(0, 6);
    const taxId = `${Math.floor(100000000 + Math.random() * 900000000)}`;

    const prisma = getPrisma();
    const provider = await prisma.providerOrganization.create({
      data: {
        nameEn: "Rejection Test Auto",
        nameAr: "اختبار الرفض",
        legalName: "Rejection Test SAE",
        taxRegistrationNumber: taxId,
        commercialRegistrationNumber: `CR-${uid}`,
        primaryCluster: "NASR_CITY_HELIOPOLIS",
        contactPersonName: "Nader Sami",
        contactEmail: "nader@reject.eg",
        contactPhone: "+201012345678",
        createdByUserId: sales.user.id,
        submittedByUserId: sales.user.id,
        status: "PENDING_REVIEW",
        version: 2,
      },
    });
    createdProviderIds.push(provider.id);

    // 1. Operations performs remediable rejection -> returns to DRAFT
    const remediableRejectReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/ops/providers/${provider.id}/reject`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ops.cookie },
        body: JSON.stringify({
          expectedVersion: 2,
          remediable: true,
          reasonCode: "INCOMPLETE_DOCUMENTATION",
          rejectionReason: "Commercial registration copy is blurry. Please re-upload.",
        }),
      }
    );
    const remediableRes = await rejectProviderHandler(remediableRejectReq, {
      params: Promise.resolve({ id: provider.id }),
    });
    expect(remediableRes.status).toBe(200);
    const remediatedProvider = await remediableRes.json();
    expect(remediatedProvider.status).toBe("DRAFT");
    expect(remediatedProvider.version).toBe(3);

    // 2. Sales can edit the draft again because it returned to DRAFT
    const salesEditReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/providers/${provider.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: sales.cookie },
        body: JSON.stringify({ expectedVersion: 3, nameEn: "Corrected Rejection Test Auto" }),
      }
    );
    const salesEditRes = await updateProviderHandler(salesEditReq, {
      params: Promise.resolve({ id: provider.id }),
    });
    expect(salesEditRes.status).toBe(200);

    // 3. Move back to PENDING_REVIEW for permanent rejection test
    await prisma.providerOrganization.update({
      where: { id: provider.id },
      data: { status: "PENDING_REVIEW", version: 5 },
    });

    // 4. Operations performs terminal permanent rejection -> status becomes REJECTED
    const permanentRejectReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/ops/providers/${provider.id}/reject`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ops.cookie },
        body: JSON.stringify({
          expectedVersion: 5,
          remediable: false,
          reasonCode: "DUPLICATE_ENTITY",
          rejectionReason: "Duplicate fraudulent entity.",
        }),
      }
    );
    const permanentRes = await rejectProviderHandler(permanentRejectReq, {
      params: Promise.resolve({ id: provider.id }),
    });
    expect(permanentRes.status).toBe(200);
    const terminalProvider = await permanentRes.json();
    expect(terminalProvider.status).toBe("REJECTED");

    // 5. Subsequent edit attempts on REJECTED terminal record must fail with 422
    const blockedEditReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/providers/${provider.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: sales.cookie },
        body: JSON.stringify({ expectedVersion: 6, nameEn: "Blocked Edit" }),
      }
    );
    const blockedEditRes = await updateProviderHandler(blockedEditReq, {
      params: Promise.resolve({ id: provider.id }),
    });
    expect(blockedEditRes.status).toBe(422);
  });

  it("supports remediable and terminal rejection on individual branches", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const sales = await createAuthenticatedStaffUser("SALES_AGENT", "SALES");
    const ops = await createAuthenticatedStaffUser("OPS_SUPERVISOR", "OPERATIONS");
    const uid = crypto.randomUUID().slice(0, 6);

    const prisma = getPrisma();
    const provider = await prisma.providerOrganization.create({
      data: {
        nameEn: "Branch Rejection Test",
        nameAr: "اختبار رفض الفرع",
        legalName: "Branch Rejection SAE",
        taxRegistrationNumber: `${Math.floor(100000000 + Math.random() * 900000000)}`,
        commercialRegistrationNumber: `CR-${uid}`,
        primaryCluster: "NASR_CITY_HELIOPOLIS",
        contactPersonName: "Branch Tester",
        contactEmail: "branch@test.eg",
        contactPhone: "+201012345678",
        createdByUserId: sales.user.id,
        submittedByUserId: sales.user.id,
        status: "PENDING_REVIEW",
        version: 2,
        branches: {
          create: {
            branchCode: `BR-${uid}`,
            nameEn: "Draft Branch",
            nameAr: "فرع مسودة",
            cluster: "NASR_CITY_HELIOPOLIS",
            streetAddressEn: "Test Address",
            streetAddressAr: "عنوان تجريبي",
            latitude: 30.05,
            longitude: 31.33,
            contactPhone: "+201123456789",
            operatingHours: [
              { dayOfWeek: 0, openTime: "09:00", closeTime: "18:00", isClosed: false },
            ],
            status: "DRAFT",
            version: 1,
          },
        },
      },
      include: { branches: true },
    });
    createdProviderIds.push(provider.id);
    const branch = provider.branches[0];

    // Remediable branch rejection -> status remains/returns to DRAFT
    const remediableReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/ops/providers/${provider.id}/branches/${branch.id}/reject`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ops.cookie },
        body: JSON.stringify({
          expectedVersion: 1,
          remediable: true,
          reasonCode: "UNVERIFIED_LOCATION",
          rejectionReason: "Address coordinates do not match street address.",
        }),
      }
    );
    const remediableRes = await rejectBranchHandler(remediableReq, {
      params: Promise.resolve({ id: provider.id, branchId: branch.id }),
    });
    expect(remediableRes.status).toBe(200);
    const remediatedBranch = await remediableRes.json();
    expect(remediatedBranch.status).toBe("DRAFT");
    expect(remediatedBranch.version).toBe(2);

    // Verify parent was returned to DRAFT (version 3)
    const providerAfterRemediable = await prisma.providerOrganization.findUniqueOrThrow({
      where: { id: provider.id },
    });
    expect(providerAfterRemediable.status).toBe("DRAFT");
    expect(providerAfterRemediable.version).toBe(3);

    // Rejecting branch while parent is in DRAFT must return 422 with zero changes
    const rejectedDraftParentReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/ops/providers/${provider.id}/branches/${branch.id}/reject`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ops.cookie },
        body: JSON.stringify({
          expectedVersion: 2,
          remediable: false,
          reasonCode: "COMPLIANCE_HOLD",
          rejectionReason: "Attempted rejection while provider in DRAFT",
        }),
      }
    );
    const rejectedDraftParentRes = await rejectBranchHandler(rejectedDraftParentReq, {
      params: Promise.resolve({ id: provider.id, branchId: branch.id }),
    });
    expect(rejectedDraftParentRes.status).toBe(422);
    const errorBody = await rejectedDraftParentRes.json();
    expect(errorBody.error).toBe("INVALID_STATE_TRANSITION");

    // Resubmit provider by Sales so parent returns to PENDING_REVIEW
    const resubmitReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/providers/${provider.id}/submit`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: sales.cookie },
        body: JSON.stringify({ expectedVersion: 3 }),
      }
    );
    const resubmitRes = await submitProviderHandler(resubmitReq, {
      params: Promise.resolve({ id: provider.id }),
    });
    expect(resubmitRes.status).toBe(200);

    // Terminal branch rejection now succeeds -> status becomes DECOMMISSIONED
    const terminalReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/ops/providers/${provider.id}/branches/${branch.id}/reject`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ops.cookie },
        body: JSON.stringify({
          expectedVersion: 2,
          remediable: false,
          reasonCode: "COMPLIANCE_HOLD",
          rejectionReason: "Failed safety inspection permanently.",
        }),
      }
    );
    const terminalRes = await rejectBranchHandler(terminalReq, {
      params: Promise.resolve({ id: provider.id, branchId: branch.id }),
    });
    expect(terminalRes.status).toBe(200);
    const decommissionedBranch = await terminalRes.json();
    expect(decommissionedBranch.status).toBe("DECOMMISSIONED");
  });

  it("proves remediable rejection of a branch under an ACTIVE multi-branch provider is rejected with 422 leaving provider, branches, versions, and audit count unchanged", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const sales = await createAuthenticatedStaffUser("SALES_AGENT", "SALES");
    const ops = await createAuthenticatedStaffUser("OPS_SUPERVISOR", "OPERATIONS");
    const uid = crypto.randomUUID().slice(0, 6);

    const prisma = getPrisma();
    const provider = await prisma.providerOrganization.create({
      data: {
        nameEn: "Active Multi-Branch Provider",
        nameAr: "مزود نشط متعدد الفروع",
        legalName: "Active Multi-Branch SAE",
        taxRegistrationNumber: `${Math.floor(100000000 + Math.random() * 900000000)}`,
        commercialRegistrationNumber: `CR-${uid}`,
        primaryCluster: "NASR_CITY_HELIOPOLIS",
        contactPersonName: "Ops Manager",
        contactEmail: "ops-manager@test.eg",
        contactPhone: "+201012345678",
        createdByUserId: sales.user.id,
        submittedByUserId: sales.user.id,
        activatedByUserId: ops.user.id,
        activatedAt: new Date(),
        status: "ACTIVE",
        version: 5,
        branches: {
          create: [
            {
              branchCode: `BR-A-${uid}`,
              nameEn: "Active Branch A",
              nameAr: "فرع نشط أ",
              cluster: "NASR_CITY_HELIOPOLIS",
              streetAddressEn: "10 Road 9, Maadi",
              streetAddressAr: "١٠ شارع ٩، المعادي",
              latitude: 29.96,
              longitude: 31.26,
              contactPhone: "+201111111111",
              operatingHours: [
                { dayOfWeek: 0, openTime: "09:00", closeTime: "18:00", isClosed: false },
              ],
              status: "ACTIVE",
              version: 2,
              legalIdentityChecked: true,
              physicalLocationChecked: true,
              contactAndHoursChecked: true,
              evidenceDocumentRef: "DOC-ACTIVE-01",
              vettedByUserId: ops.user.id,
              vettedAt: new Date(),
            },
            {
              branchCode: `BR-B-${uid}`,
              nameEn: "Active Branch B",
              nameAr: "فرع نشط ب",
              cluster: "NASR_CITY_HELIOPOLIS",
              streetAddressEn: "20 Road 9, Maadi",
              streetAddressAr: "٢٠ شارع ٩، المعادي",
              latitude: 29.97,
              longitude: 31.27,
              contactPhone: "+201222222222",
              operatingHours: [
                { dayOfWeek: 0, openTime: "09:00", closeTime: "18:00", isClosed: false },
              ],
              status: "ACTIVE",
              version: 2,
              legalIdentityChecked: true,
              physicalLocationChecked: true,
              contactAndHoursChecked: true,
              evidenceDocumentRef: "DOC-ACTIVE-02",
              vettedByUserId: ops.user.id,
              vettedAt: new Date(),
            },
          ],
        },
      },
      include: { branches: true },
    });
    createdProviderIds.push(provider.id);

    const branchA = provider.branches[0];
    const branchB = provider.branches[1];

    // Count initial audit events before attempt
    const initialAuditCount = await prisma.securityAuditEvent.count();

    // Operations attempts to reject branch A under the ACTIVE provider
    const rejectReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/ops/providers/${provider.id}/branches/${branchA.id}/reject`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ops.cookie },
        body: JSON.stringify({
          expectedVersion: branchA.version,
          remediable: true,
          reasonCode: "UNVERIFIED_LOCATION",
          rejectionReason: "Attempted rejection on an already active multi-branch organization.",
        }),
      }
    );
    const rejectRes = await rejectBranchHandler(rejectReq, {
      params: Promise.resolve({ id: provider.id, branchId: branchA.id }),
    });

    // Must return 422 INVALID_STATE_TRANSITION
    expect(rejectRes.status).toBe(422);
    const errBody = await rejectRes.json();
    expect(errBody.error).toBe("INVALID_STATE_TRANSITION");
    expect(errBody.message).toContain("PENDING_REVIEW");

    // Verify direct PostgreSQL state: provider is unchanged
    const dbProvider = await prisma.providerOrganization.findUniqueOrThrow({
      where: { id: provider.id },
    });
    expect(dbProvider.status).toBe("ACTIVE");
    expect(dbProvider.version).toBe(5);

    // Verify direct PostgreSQL state: both branches are unchanged
    const dbBranchA = await prisma.providerBranch.findUniqueOrThrow({
      where: { id: branchA.id },
    });
    expect(dbBranchA.status).toBe("ACTIVE");
    expect(dbBranchA.version).toBe(2);
    expect(dbBranchA.evidenceDocumentRef).toBe("DOC-ACTIVE-01");

    const dbBranchB = await prisma.providerBranch.findUniqueOrThrow({
      where: { id: branchB.id },
    });
    expect(dbBranchB.status).toBe("ACTIVE");
    expect(dbBranchB.version).toBe(2);
    expect(dbBranchB.evidenceDocumentRef).toBe("DOC-ACTIVE-02");

    // Verify audit count is completely unchanged (0 new rows)
    const finalAuditCount = await prisma.securityAuditEvent.count();
    expect(finalAuditCount).toBe(initialAuditCount);
  });

  it("supports listing and querying providers and branches via staff read endpoints and legacy pause/resume", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const sales = await createAuthenticatedStaffUser("SALES_AGENT", "SALES");
    const ops = await createAuthenticatedStaffUser("OPS_SUPERVISOR", "OPERATIONS");
    const uid = crypto.randomUUID().slice(0, 6);

    const prisma = getPrisma();
    const provider = await prisma.providerOrganization.create({
      data: {
        nameEn: "Query Provider",
        nameAr: "مزود الاستعلام",
        legalName: "Query SAE",
        taxRegistrationNumber: `${Math.floor(100000000 + Math.random() * 900000000)}`,
        commercialRegistrationNumber: `CR-${uid}`,
        primaryCluster: "NASR_CITY_HELIOPOLIS",
        contactPersonName: "Query Contact",
        contactEmail: "query@test.eg",
        contactPhone: "+201012345678",
        createdByUserId: sales.user.id,
        status: "ACTIVE",
        version: 1,
        branches: {
          create: {
            branchCode: `BR-${uid}`,
            nameEn: "Query Branch",
            nameAr: "فرع الاستعلام",
            cluster: "NASR_CITY_HELIOPOLIS",
            streetAddressEn: "Address",
            streetAddressAr: "عنوان",
            latitude: 30.05,
            longitude: 31.33,
            contactPhone: "+201123456789",
            operatingHours: [
              { dayOfWeek: 0, openTime: "09:00", closeTime: "18:00", isClosed: false },
            ],
            status: "ACTIVE",
            version: 1,
          },
        },
      },
      include: { branches: true },
    });
    createdProviderIds.push(provider.id);
    const branch = provider.branches[0];

    // List providers
    const listReq = new NextRequest("http://localhost:3000/api/v1/staff/providers", {
      method: "GET",
      headers: { cookie: sales.cookie },
    });
    const listRes = await listProvidersHandler(listReq);
    expect(listRes.status).toBe(200);

    // Get single provider
    const getReq = new NextRequest(`http://localhost:3000/api/v1/staff/providers/${provider.id}`, {
      method: "GET",
      headers: { cookie: sales.cookie },
    });
    const getRes = await getProviderHandler(getReq, {
      params: Promise.resolve({ id: provider.id }),
    });
    expect(getRes.status).toBe(200);

    // List branches
    const listBrReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/providers/${provider.id}/branches`,
      {
        method: "GET",
        headers: { cookie: sales.cookie },
      }
    );
    const listBrRes = await listBranchesHandler(listBrReq, {
      params: Promise.resolve({ id: provider.id }),
    });
    expect(listBrRes.status).toBe(200);

    // Legacy pause branch handler
    const legacyPauseReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/ops/branches/${branch.id}/pause`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ops.cookie },
        body: JSON.stringify({
          expectedVersion: 1,
          reasonCode: "OPERATIONAL_HOLD",
          pauseReason: "Legacy pause test",
        }),
      }
    );
    const legacyPauseRes = await pauseBranchHandler(legacyPauseReq, {
      params: Promise.resolve({ branchId: branch.id }),
    });
    expect(legacyPauseRes.status).toBe(200);

    // Legacy resume branch handler
    const legacyResumeReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/ops/branches/${branch.id}/resume`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ops.cookie },
        body: JSON.stringify({ expectedVersion: 2 }),
      }
    );
    const legacyResumeRes = await resumeBranchHandler(legacyResumeReq, {
      params: Promise.resolve({ branchId: branch.id }),
    });
    expect(legacyResumeRes.status).toBe(200);
  });

  it("proves stale branch approvals are invalidated when provider returns to DRAFT and cannot be reused for activation until re-vetted", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const sales = await createAuthenticatedStaffUser("SALES_AGENT", "SALES");
    const ops = await createAuthenticatedStaffUser("OPS_SUPERVISOR", "OPERATIONS");
    const uid = crypto.randomUUID().slice(0, 6);
    const taxId = `${Math.floor(100000000 + Math.random() * 900000000)}`;

    const prisma = getPrisma();
    const provider = await prisma.providerOrganization.create({
      data: {
        nameEn: "Stale Invalidation Test",
        nameAr: "اختبار إبطال الموافقة القديمة",
        legalName: "Stale Invalidation SAE",
        taxRegistrationNumber: taxId,
        commercialRegistrationNumber: `CR-${uid}`,
        primaryCluster: "NASR_CITY_HELIOPOLIS",
        contactPersonName: "Hany Nabil",
        contactEmail: "hany@stale.eg",
        contactPhone: "+201012345678",
        createdByUserId: sales.user.id,
        submittedByUserId: sales.user.id,
        status: "PENDING_REVIEW",
        version: 2,
        branches: {
          create: [
            {
              branchCode: `BR-A-${uid}`,
              nameEn: "Branch Alpha",
              nameAr: "فرع ألفا",
              cluster: "NASR_CITY_HELIOPOLIS",
              streetAddressEn: "Address Alpha",
              streetAddressAr: "عنوان ألفا",
              latitude: 30.05,
              longitude: 31.33,
              contactPhone: "+201123456781",
              operatingHours: [
                { dayOfWeek: 0, openTime: "09:00", closeTime: "18:00", isClosed: false },
              ],
              status: "DRAFT",
              version: 1,
            },
            {
              branchCode: `BR-B-${uid}`,
              nameEn: "Branch Beta",
              nameAr: "فرع بيتا",
              cluster: "NASR_CITY_HELIOPOLIS",
              streetAddressEn: "Address Beta",
              streetAddressAr: "عنوان بيتا",
              latitude: 30.06,
              longitude: 31.34,
              contactPhone: "+201123456782",
              operatingHours: [
                { dayOfWeek: 0, openTime: "09:00", closeTime: "18:00", isClosed: false },
              ],
              status: "DRAFT",
              version: 1,
            },
          ],
        },
      },
      include: { branches: true },
    });
    createdProviderIds.push(provider.id);

    const [branchA, branchB] = provider.branches;

    // 1. Operations approves Branch A
    const activateBranchAReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/ops/providers/${provider.id}/branches/${branchA.id}/activate`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ops.cookie },
        body: JSON.stringify({
          expectedVersion: 1,
          legalIdentityChecked: true,
          physicalLocationChecked: true,
          contactAndHoursChecked: true,
          evidenceDocumentRef: "DOC-ALPHA-01",
        }),
      }
    );
    const activateBranchARes = await activateBranchHandler(activateBranchAReq, {
      params: Promise.resolve({ id: provider.id, branchId: branchA.id }),
    });
    expect(activateBranchARes.status).toBe(200);

    const dbBranchAActive = await prisma.providerBranch.findUniqueOrThrow({
      where: { id: branchA.id },
    });
    expect(dbBranchAActive.status).toBe("ACTIVE");
    expect(dbBranchAActive.legalIdentityChecked).toBe(true);
    expect(dbBranchAActive.evidenceDocumentRef).toBe("DOC-ALPHA-01");
    expect(dbBranchAActive.vettedByUserId).toBe(ops.user.id);

    // 2. Operations rejects Branch B with remediable: true
    const rejectBranchBReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/ops/providers/${provider.id}/branches/${branchB.id}/reject`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ops.cookie },
        body: JSON.stringify({
          expectedVersion: 1,
          remediable: true,
          reasonCode: "UNVERIFIED_LOCATION",
          rejectionReason: "Beta branch coordinates do not match street address.",
        }),
      }
    );
    const rejectBranchBRes = await rejectBranchHandler(rejectBranchBReq, {
      params: Promise.resolve({ id: provider.id, branchId: branchB.id }),
    });
    expect(rejectBranchBRes.status).toBe(200);

    // 3. Assert immediate database state: provider returns to DRAFT, Branch A approval is invalidated and vetting cleared
    const dbProviderAfterReject = await prisma.providerOrganization.findUniqueOrThrow({
      where: { id: provider.id },
    });
    expect(dbProviderAfterReject.status).toBe("DRAFT");
    expect(dbProviderAfterReject.version).toBe(3);

    const dbBranchAAfterReject = await prisma.providerBranch.findUniqueOrThrow({
      where: { id: branchA.id },
    });
    expect(dbBranchAAfterReject.status).toBe("DRAFT");
    expect(dbBranchAAfterReject.legalIdentityChecked).toBe(false);
    expect(dbBranchAAfterReject.physicalLocationChecked).toBe(false);
    expect(dbBranchAAfterReject.contactAndHoursChecked).toBe(false);
    expect(dbBranchAAfterReject.evidenceDocumentRef).toBeNull();
    expect(dbBranchAAfterReject.vettedByUserId).toBeNull();
    expect(dbBranchAAfterReject.vettedAt).toBeNull();

    const dbBranchBAfterReject = await prisma.providerBranch.findUniqueOrThrow({
      where: { id: branchB.id },
    });
    expect(dbBranchBAfterReject.status).toBe("DRAFT");
    expect(dbBranchBAfterReject.rejectionReason).toBe(
      "Beta branch coordinates do not match street address."
    );

    // 4. Sales updates Branch B with corrected data
    const updateBranchBReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/providers/${provider.id}/branches/${branchB.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: sales.cookie },
        body: JSON.stringify({
          expectedVersion: dbBranchBAfterReject.version,
          streetAddressEn: "Corrected Address Beta 456",
        }),
      }
    );
    const updateBranchBRes = await updateBranchHandler(updateBranchBReq, {
      params: Promise.resolve({ id: provider.id, branchId: branchB.id }),
    });
    expect(updateBranchBRes.status).toBe(200);

    // 5. Sales resubmits provider for review
    const resubmitReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/providers/${provider.id}/submit`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: sales.cookie },
        body: JSON.stringify({ expectedVersion: dbProviderAfterReject.version }),
      }
    );
    const resubmitRes = await submitProviderHandler(resubmitReq, {
      params: Promise.resolve({ id: provider.id }),
    });
    expect(resubmitRes.status).toBe(200);

    // 6. Operations attempts to activate provider directly without re-vetting Branch A
    // Must fail with HTTP 422 ACTIVE_BRANCH_REQUIRED because prior approval was invalidated
    const staleActivateProviderReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/ops/providers/${provider.id}/activate`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ops.cookie },
        body: JSON.stringify({ expectedVersion: 4 }),
      }
    );
    const staleActivateProviderRes = await activateProviderHandler(staleActivateProviderReq, {
      params: Promise.resolve({ id: provider.id }),
    });
    expect(staleActivateProviderRes.status).toBe(422);
    const staleBody = await staleActivateProviderRes.json();
    expect(staleBody.error).toBe("ACTIVE_BRANCH_REQUIRED");

    // 7. Operations re-vets Branch A afresh
    const revetBranchAReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/ops/providers/${provider.id}/branches/${branchA.id}/activate`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ops.cookie },
        body: JSON.stringify({
          expectedVersion: dbBranchAAfterReject.version,
          legalIdentityChecked: true,
          physicalLocationChecked: true,
          contactAndHoursChecked: true,
          evidenceDocumentRef: "DOC-ALPHA-02",
        }),
      }
    );
    const revetBranchARes = await activateBranchHandler(revetBranchAReq, {
      params: Promise.resolve({ id: provider.id, branchId: branchA.id }),
    });
    expect(revetBranchARes.status).toBe(200);

    // 8. Now Operations activates the provider successfully
    const finalActivateProviderReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/ops/providers/${provider.id}/activate`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ops.cookie },
        body: JSON.stringify({ expectedVersion: 4 }),
      }
    );
    const finalActivateProviderRes = await activateProviderHandler(finalActivateProviderReq, {
      params: Promise.resolve({ id: provider.id }),
    });
    expect(finalActivateProviderRes.status).toBe(200);

    // 9. Final persistent database assertions
    const finalProvider = await prisma.providerOrganization.findUniqueOrThrow({
      where: { id: provider.id },
    });
    expect(finalProvider.status).toBe("ACTIVE");

    const finalBranchA = await prisma.providerBranch.findUniqueOrThrow({
      where: { id: branchA.id },
    });
    expect(finalBranchA.status).toBe("ACTIVE");
    expect(finalBranchA.evidenceDocumentRef).toBe("DOC-ALPHA-02");
    expect(isBranchOperationallyAvailable(finalBranchA.status, finalProvider.status)).toBe(true);

    const finalBranchB = await prisma.providerBranch.findUniqueOrThrow({
      where: { id: branchB.id },
    });
    expect(finalBranchB.status).toBe("DRAFT");
    expect(isBranchOperationallyAvailable(finalBranchB.status, finalProvider.status)).toBe(false);
  });

  it("proves remediable branch rejection returns provider to DRAFT and enables successful Sales correction and resubmission", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const sales = await createAuthenticatedStaffUser("SALES_AGENT", "SALES");
    const ops = await createAuthenticatedStaffUser("OPS_SUPERVISOR", "OPERATIONS");
    const uid = crypto.randomUUID().slice(0, 6);
    const taxId = `${Math.floor(100000000 + Math.random() * 900000000)}`;

    const prisma = getPrisma();
    const provider = await prisma.providerOrganization.create({
      data: {
        nameEn: "Remediable Correction Test",
        nameAr: "اختبار تصحيح الفرع المرفوض",
        legalName: "Remediable Correction SAE",
        taxRegistrationNumber: taxId,
        commercialRegistrationNumber: `CR-${uid}`,
        primaryCluster: "NASR_CITY_HELIOPOLIS",
        contactPersonName: "Kareem Tarek",
        contactEmail: "kareem@correct.eg",
        contactPhone: "+201012345678",
        createdByUserId: sales.user.id,
        submittedByUserId: sales.user.id,
        status: "PENDING_REVIEW",
        version: 2,
        branches: {
          create: {
            branchCode: `BR-${uid}`,
            nameEn: "Correction Branch",
            nameAr: "فرع التصحيح",
            cluster: "NASR_CITY_HELIOPOLIS",
            streetAddressEn: "Unclear Street Address",
            streetAddressAr: "عنوان غير واضح",
            latitude: 30.05,
            longitude: 31.33,
            contactPhone: "+201123456789",
            operatingHours: [
              { dayOfWeek: 0, openTime: "09:00", closeTime: "18:00", isClosed: false },
            ],
            status: "DRAFT",
            version: 1,
          },
        },
      },
      include: { branches: true },
    });
    createdProviderIds.push(provider.id);
    const branch = provider.branches[0];

    // 1. Operations rejects branch remediably
    const rejectReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/ops/providers/${provider.id}/branches/${branch.id}/reject`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ops.cookie },
        body: JSON.stringify({
          expectedVersion: 1,
          remediable: true,
          reasonCode: "UNVERIFIED_LOCATION",
          rejectionReason: "Street address is missing building number and landmark.",
        }),
      }
    );
    const rejectRes = await rejectBranchHandler(rejectReq, {
      params: Promise.resolve({ id: provider.id, branchId: branch.id }),
    });
    expect(rejectRes.status).toBe(200);

    // Assert both provider and branch are in DRAFT
    const dbProviderDraft = await prisma.providerOrganization.findUniqueOrThrow({
      where: { id: provider.id },
    });
    expect(dbProviderDraft.status).toBe("DRAFT");
    expect(dbProviderDraft.version).toBe(3);

    const dbBranchDraft = await prisma.providerBranch.findUniqueOrThrow({
      where: { id: branch.id },
    });
    expect(dbBranchDraft.status).toBe("DRAFT");
    expect(dbBranchDraft.version).toBe(2);
    expect(dbBranchDraft.rejectionReason).toBe(
      "Street address is missing building number and landmark."
    );

    // 2. Sales corrects the branch address
    const salesEditReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/providers/${provider.id}/branches/${branch.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: sales.cookie },
        body: JSON.stringify({
          expectedVersion: 2,
          streetAddressEn: "25 Abbas El Akkad St, Building 4",
          landmarkEn: "Opposite Gas Station",
        }),
      }
    );
    const salesEditRes = await updateBranchHandler(salesEditReq, {
      params: Promise.resolve({ id: provider.id, branchId: branch.id }),
    });
    expect(salesEditRes.status).toBe(200);

    // 3. Sales resubmits provider
    const resubmitReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/providers/${provider.id}/submit`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: sales.cookie },
        body: JSON.stringify({ expectedVersion: 3 }),
      }
    );
    const resubmitRes = await submitProviderHandler(resubmitReq, {
      params: Promise.resolve({ id: provider.id }),
    });
    expect(resubmitRes.status).toBe(200);

    // 4. Operations approves branch with opaque evidence doc ref
    const activateBranchReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/ops/providers/${provider.id}/branches/${branch.id}/activate`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ops.cookie },
        body: JSON.stringify({
          expectedVersion: 3,
          legalIdentityChecked: true,
          physicalLocationChecked: true,
          contactAndHoursChecked: true,
          evidenceDocumentRef: "DOC-CORRECTED-99",
        }),
      }
    );
    const activateBranchRes = await activateBranchHandler(activateBranchReq, {
      params: Promise.resolve({ id: provider.id, branchId: branch.id }),
    });
    expect(activateBranchRes.status).toBe(200);

    // 5. Operations activates provider
    const activateProviderReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/ops/providers/${provider.id}/activate`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ops.cookie },
        body: JSON.stringify({ expectedVersion: 4 }),
      }
    );
    const activateProviderRes = await activateProviderHandler(activateProviderReq, {
      params: Promise.resolve({ id: provider.id }),
    });
    expect(activateProviderRes.status).toBe(200);

    // 6. Direct database state assertions
    const finalProvider = await prisma.providerOrganization.findUniqueOrThrow({
      where: { id: provider.id },
    });
    expect(finalProvider.status).toBe("ACTIVE");

    const finalBranch = await prisma.providerBranch.findUniqueOrThrow({
      where: { id: branch.id },
    });
    expect(finalBranch.status).toBe("ACTIVE");
    expect(finalBranch.streetAddressEn).toBe("25 Abbas El Akkad St, Building 4");
    expect(finalBranch.evidenceDocumentRef).toBe("DOC-CORRECTED-99");
    expect(isBranchOperationallyAvailable(finalBranch.status, finalProvider.status)).toBe(true);
  });

  it("proves competing state changes serialize safely on parent row lock using deterministic database barrier", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const sales = await createAuthenticatedStaffUser("SALES_AGENT", "SALES");
    const uid = crypto.randomUUID().slice(0, 6);
    const taxId = `${Math.floor(100000000 + Math.random() * 900000000)}`;

    const prisma = getPrisma();
    const provider = await prisma.providerOrganization.create({
      data: {
        nameEn: "Barrier Test Provider",
        nameAr: "مزود حاجز التزامن",
        legalName: "Barrier Test SAE",
        taxRegistrationNumber: taxId,
        commercialRegistrationNumber: `CR-${uid}`,
        primaryCluster: "NASR_CITY_HELIOPOLIS",
        contactPersonName: "Barrier Contact",
        contactEmail: "barrier@test.eg",
        contactPhone: "+201012345678",
        createdByUserId: sales.user.id,
        status: "DRAFT",
        version: 1,
      },
    });
    createdProviderIds.push(provider.id);

    // Dedicated database client to hold an exclusive row lock as a deterministic barrier
    const barrierClient = new pg.Client({ connectionString: DEFAULT_TEST_DB_URL });
    await barrierClient.connect();
    await barrierClient.query("BEGIN");
    await barrierClient.query("SELECT id FROM provider_organizations WHERE id = $1 FOR UPDATE", [
      provider.id,
    ]);

    // Dispatch competing request expecting version 1
    // The route handler enters Prisma interactive transaction and attempts to acquire SELECT ... FOR UPDATE
    // PostgreSQL blocks the route handler's transaction until barrierClient commits
    const competingReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/providers/${provider.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: sales.cookie },
        body: JSON.stringify({ expectedVersion: 1, nameEn: "Blocked Competing Name" }),
      }
    );
    const competingPromise = updateProviderHandler(competingReq, {
      params: Promise.resolve({ id: provider.id }),
    });

    // Deterministic waiting signal: monitor pg_stat_activity to confirm competing request
    // is actively blocked waiting for row lock before releasing barrierClient
    const monitorClient = new pg.Client({ connectionString: DEFAULT_TEST_DB_URL });
    await monitorClient.connect();
    let lockWaitDetected = false;
    for (let i = 0; i < 50; i++) {
      const statRes = await monitorClient.query(
        `SELECT COUNT(*)::int AS count 
         FROM pg_stat_activity 
         WHERE pid <> pg_backend_pid() 
           AND wait_event_type = 'Lock' 
           AND query LIKE '%provider_organizations%'`
      );
      if (statRes.rows[0].count > 0) {
        lockWaitDetected = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await monitorClient.end();
    expect(lockWaitDetected).toBe(true);

    // Now advance version to 2 on the barrier connection and commit, releasing the lock to the waiting request
    await barrierClient.query("UPDATE provider_organizations SET version = 2 WHERE id = $1", [
      provider.id,
    ]);
    await barrierClient.query("COMMIT");
    await barrierClient.end();

    // The route handler unblocks, reads the newly committed version 2, detects CAS conflict (1 !== 2)
    const competingRes = await competingPromise;
    expect(competingRes.status).toBe(409);
    const competingBody = await competingRes.json();
    expect(competingBody.error).toBe("CONCURRENT_MODIFICATION");

    // Final database assertion: version is 2, name was not overwritten
    const finalProvider = await prisma.providerOrganization.findUniqueOrThrow({
      where: { id: provider.id },
    });
    expect(finalProvider.version).toBe(2);
    expect(finalProvider.nameEn).toBe("Barrier Test Provider");
  });

  it("proves duplicate or stale requests with outdated expectedVersion are rejected with HTTP 409", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const sales = await createAuthenticatedStaffUser("SALES_AGENT", "SALES");
    const uid = crypto.randomUUID().slice(0, 6);
    const taxId = `${Math.floor(100000000 + Math.random() * 900000000)}`;

    const prisma = getPrisma();
    const provider = await prisma.providerOrganization.create({
      data: {
        nameEn: "Original Stale Test Name",
        nameAr: "الاسم الأصلي",
        legalName: "Stale Test SAE",
        taxRegistrationNumber: taxId,
        commercialRegistrationNumber: `CR-${uid}`,
        primaryCluster: "NASR_CITY_HELIOPOLIS",
        contactPersonName: "Stale Contact",
        contactEmail: "stale@test.eg",
        contactPhone: "+201012345678",
        createdByUserId: sales.user.id,
        status: "DRAFT",
        version: 1,
      },
    });
    createdProviderIds.push(provider.id);

    // 1. Initial valid update with expectedVersion: 1 -> succeeds, version becomes 2
    const firstReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/providers/${provider.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: sales.cookie },
        body: JSON.stringify({ expectedVersion: 1, nameEn: "First Legitimate Update" }),
      }
    );
    const firstRes = await updateProviderHandler(firstReq, {
      params: Promise.resolve({ id: provider.id }),
    });
    expect(firstRes.status).toBe(200);

    const dbAfterFirst = await prisma.providerOrganization.findUniqueOrThrow({
      where: { id: provider.id },
    });
    expect(dbAfterFirst.version).toBe(2);
    expect(dbAfterFirst.nameEn).toBe("First Legitimate Update");

    // 2. Duplicate / replayed request with outdated expectedVersion: 1 -> rejected with HTTP 409
    const duplicateReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/providers/${provider.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: sales.cookie },
        body: JSON.stringify({ expectedVersion: 1, nameEn: "Replayed Stale Update" }),
      }
    );
    const duplicateRes = await updateProviderHandler(duplicateReq, {
      params: Promise.resolve({ id: provider.id }),
    });
    expect(duplicateRes.status).toBe(409);
    const duplicateBody = await duplicateRes.json();
    expect(duplicateBody.error).toBe("CONCURRENT_MODIFICATION");

    // Final database assertion: version remains 2, name is unchanged from first update
    const finalProvider = await prisma.providerOrganization.findUniqueOrThrow({
      where: { id: provider.id },
    });
    expect(finalProvider.version).toBe(2);
    expect(finalProvider.nameEn).toBe("First Legitimate Update");
  });

  it("proves audit write failure rolls back entire interactive transaction leaving zero partial mutation in database", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const sales = await createAuthenticatedStaffUser("SALES_AGENT", "SALES");
    const ops = await createAuthenticatedStaffUser("OPS_SUPERVISOR", "OPERATIONS");
    const uid = crypto.randomUUID().slice(0, 6);
    const taxId = `${Math.floor(100000000 + Math.random() * 900000000)}`;

    const prisma = getPrisma();
    const provider = await prisma.providerOrganization.create({
      data: {
        nameEn: "Audit Failure Rollback Provider",
        nameAr: "مزود فشل التدقيق",
        legalName: "Audit Failure SAE",
        taxRegistrationNumber: taxId,
        commercialRegistrationNumber: `CR-${uid}`,
        primaryCluster: "NASR_CITY_HELIOPOLIS",
        contactPersonName: "Audit Tester",
        contactEmail: "audit@test.eg",
        contactPhone: "+201012345678",
        createdByUserId: sales.user.id,
        submittedByUserId: sales.user.id,
        status: "PENDING_REVIEW",
        version: 2,
        branches: {
          create: {
            branchCode: `BR-${uid}`,
            nameEn: "Audit Branch",
            nameAr: "فرع التدقيق",
            cluster: "NASR_CITY_HELIOPOLIS",
            streetAddressEn: "Audit Address 123",
            streetAddressAr: "عنوان التدقيق",
            latitude: 30.05,
            longitude: 31.33,
            contactPhone: "+201123456789",
            operatingHours: [
              { dayOfWeek: 0, openTime: "09:00", closeTime: "18:00", isClosed: false },
            ],
            status: "DRAFT",
            version: 1,
          },
        },
      },
      include: { branches: true },
    });
    createdProviderIds.push(provider.id);
    const branch = provider.branches[0];

    // Install real PostgreSQL database engine trigger to force write failure on security_audit_events
    const ddlClient = new pg.Client({ connectionString: DEFAULT_TEST_DB_URL });
    await ddlClient.connect();
    await ddlClient.query(`
      CREATE OR REPLACE FUNCTION fail_audit_insert() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'Simulated database engine audit storage write failure';
      END;
      $$ LANGUAGE plpgsql;
    `);
    await ddlClient.query(`
      CREATE TRIGGER test_audit_failure_trigger
      BEFORE INSERT ON security_audit_events
      FOR EACH ROW EXECUTE FUNCTION fail_audit_insert();
    `);

    try {
      const activateReq = new NextRequest(
        `http://localhost:3000/api/v1/staff/ops/providers/${provider.id}/branches/${branch.id}/activate`,
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie: ops.cookie },
          body: JSON.stringify({
            expectedVersion: 1,
            legalIdentityChecked: true,
            physicalLocationChecked: true,
            contactAndHoursChecked: true,
            evidenceDocumentRef: "DOC-ROLLBACK-01",
          }),
        }
      );
      const activateRes = await activateBranchHandler(activateReq, {
        params: Promise.resolve({ id: provider.id, branchId: branch.id }),
      });

      // Route handler catches error and returns HTTP 500 INTERNAL_ERROR
      expect(activateRes.status).toBe(500);
      const resBody = await activateRes.json();
      expect(resBody.error).toBe("INTERNAL_ERROR");
    } finally {
      await ddlClient.query(
        "DROP TRIGGER IF EXISTS test_audit_failure_trigger ON security_audit_events;"
      );
      await ddlClient.query("DROP FUNCTION IF EXISTS fail_audit_insert();");
      await ddlClient.end().catch(() => {});
    }

    // Inspect database directly: assert zero partial mutations were persisted
    const dbBranch = await prisma.providerBranch.findUniqueOrThrow({
      where: { id: branch.id },
    });
    expect(dbBranch.status).toBe("DRAFT");
    expect(dbBranch.version).toBe(1);
    expect(dbBranch.legalIdentityChecked).toBe(false);
    expect(dbBranch.physicalLocationChecked).toBe(false);
    expect(dbBranch.contactAndHoursChecked).toBe(false);
    expect(dbBranch.evidenceDocumentRef).toBeNull();
    expect(dbBranch.vettedByUserId).toBeNull();
    expect(dbBranch.vettedAt).toBeNull();

    const dbProvider = await prisma.providerOrganization.findUniqueOrThrow({
      where: { id: provider.id },
    });
    expect(dbProvider.status).toBe("PENDING_REVIEW");
    expect(dbProvider.version).toBe(2);

    const auditCount = await prisma.securityAuditEvent.count({
      where: { targetEntity: `provider_branch:${branch.id}` },
    });
    expect(auditCount).toBe(0);
  });
});
