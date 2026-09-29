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

    // Terminal branch rejection -> status becomes DECOMMISSIONED
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
});
