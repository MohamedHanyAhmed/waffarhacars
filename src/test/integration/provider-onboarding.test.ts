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
import { PATCH as updateBranchHandler } from "@/app/api/v1/staff/providers/[id]/branches/[branchId]/route";
import { GET as listPendingOpsHandler } from "@/app/api/v1/staff/ops/providers/pending/route";
import { POST as activateProviderHandler } from "@/app/api/v1/staff/ops/providers/[id]/activate/route";
import { POST as rejectProviderHandler } from "@/app/api/v1/staff/ops/providers/[id]/reject/route";
import { POST as pauseProviderHandler } from "@/app/api/v1/staff/ops/providers/[id]/pause/route";
import { POST as resumeProviderHandler } from "@/app/api/v1/staff/ops/providers/[id]/resume/route";
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
      } catch {}
      createdProviderIds.length = 0;
      createdUserEmails.length = 0;
    }
  });

  afterAll(async () => {
    await disconnectDb();
  });

  async function createAuthenticatedStaffUser(
    role: "SALES_AGENT" | "OPS_SUPERVISOR" | "PLATFORM_ADMIN",
    department: "SALES" | "OPERATIONS" | "ADMIN"
  ) {
    const id = crypto.randomUUID().slice(0, 8);
    const email = `staff_${role.toLowerCase()}_${id}@waffarhacars.com`.toLowerCase();
    createdUserEmails.push(email);

    // Bootstrap first admin if DB has 0 staff
    const prisma = getPrisma();
    const count = await prisma.internalStaffMembership.count();
    const isBootstrap = count === 0;

    await provisionStaffMember({
      email,
      fullName: `Staff ${role} ${id}`,
      employeeNumber: `EMP-${id.toUpperCase()}`,
      department,
      role: isBootstrap ? "PLATFORM_ADMIN" : role,
      password: "TestPassword123!456",
      isBootstrap,
    });

    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      include: { internalStaffMembership: true },
    });

    // If bootstrap created PLATFORM_ADMIN but we wanted another role, update it directly for test setup
    if (isBootstrap && role !== "PLATFORM_ADMIN") {
      await prisma.internalStaffMembership.update({
        where: { id: user.internalStaffMembership!.id },
        data: { department },
      });
      await prisma.internalRoleAssignment.updateMany({
        where: { staffMembershipId: user.internalStaffMembership!.id },
        data: { role },
      });
    }

    // Set mustChangePassword = false and create TwoFactor row so user is fully active
    await prisma.internalStaffMembership.update({
      where: { id: user.internalStaffMembership!.id },
      data: { mustChangePassword: false },
    });

    await prisma.twoFactor.create({
      data: {
        userId: user.id,
        secret: "test_secret_32_chars_long_12345",
        backupCodes: "code1,code2",
        verified: true,
      },
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorEnabled: true },
    });

    // Create active session
    const sessionToken = crypto.randomUUID();
    await prisma.session.create({
      data: {
        userId: user.id,
        token: sessionToken,
        expiresAt: new Date(Date.now() + 86400000),
        lastActivityAt: new Date(),
      },
    });

    const cookie = createSignedSessionCookie(sessionToken);
    return { user, cookie };
  }

  it("executes complete sales onboarding to operations activation lifecycle in Cairo pilot cluster", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const sales = await createAuthenticatedStaffUser("SALES_AGENT", "SALES");
    const ops = await createAuthenticatedStaffUser("OPS_SUPERVISOR", "OPERATIONS");

    const uid = crypto.randomUUID().slice(0, 6);
    const taxId = `${Math.floor(100000000 + Math.random() * 900000000)}`;
    const crNumber = `CR-${uid.toUpperCase()}`;

    // 1. Sales creates Provider Draft
    const createProviderReq = new NextRequest("http://localhost:3000/api/v1/staff/providers", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: sales.cookie,
        "x-forwarded-for": "198.51.100.1",
      },
      body: JSON.stringify({
        nameEn: "Cairo Elite Auto Care",
        nameAr: "مركز كايرو إيليت للسيارات",
        legalName: "Cairo Elite Auto Services SAE",
        taxRegistrationNumber: taxId,
        commercialRegistrationNumber: crNumber,
        primaryCluster: "NASR_CITY_HELIOPOLIS",
        contactPersonName: "Mahmoud Soliman",
        contactEmail: "mahmoud@cairoelite.eg",
        contactPhone: "01012345678",
      }),
    });

    const createProviderRes = await createProviderHandler(createProviderReq);
    expect(createProviderRes.status).toBe(201);
    const providerData = await createProviderRes.json();
    expect(providerData.id).toBeDefined();
    expect(providerData.status).toBe("DRAFT");
    expect(providerData.version).toBe(1);
    expect(providerData.contactPhone).toBe("+201012345678");
    createdProviderIds.push(providerData.id);

    // 2. Sales creates Branch Draft in Cairo Pilot Cluster (Nasr City)
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

    // 5. Operations activates provider
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

    // 6. Verify final database state: both Provider and Branch are ACTIVE in PostgreSQL
    const prisma = getPrisma();
    const finalProvider = await prisma.providerOrganization.findUnique({
      where: { id: providerData.id },
      include: { branches: true },
    });
    expect(finalProvider?.status).toBe("ACTIVE");
    expect(finalProvider?.branches[0].status).toBe("ACTIVE");

    // 7. Verify audit events recorded in PostgreSQL with zero PII
    const auditEvents = await prisma.securityAuditEvent.findMany({
      where: { targetEntity: `provider:${providerData.id}` },
      orderBy: { timestamp: "asc" },
    });
    expect(auditEvents.length).toBeGreaterThanOrEqual(3);

    const eventTypes = auditEvents.map((a) => a.eventType);
    expect(eventTypes).toContain("PROVIDER_DRAFT_CREATED");
    expect(eventTypes).toContain("PROVIDER_SUBMITTED_FOR_REVIEW");
    expect(eventTypes).toContain("PROVIDER_ACTIVATED");

    // Assert zero contact phone, email, or credentials in audit metadata
    for (const event of auditEvents) {
      const metaStr = JSON.stringify(event.metadata);
      expect(metaStr).not.toContain("01012345678");
      expect(metaStr).not.toContain("mahmoud@cairoelite.eg");
    }
  });

  it("enforces maker-checker segregation: sales cannot activate, and ops cannot activate a provider they submitted", async () => {
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
    });
    createdProviderIds.push(provider.id);

    // Case 1: Sales Agent attempts to call activate -> 403 FORBIDDEN
    const salesActivateReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/ops/providers/${provider.id}/activate`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: sales.cookie,
        },
        body: JSON.stringify({ expectedVersion: 2 }),
      }
    );
    const salesActivateRes = await activateProviderHandler(salesActivateReq, {
      params: Promise.resolve({ id: provider.id }),
    });
    expect(salesActivateRes.status).toBe(403);
    const salesBody = await salesActivateRes.json();
    expect(salesBody.error).toBe("FORBIDDEN");

    // Case 2: If submittedBy was the Ops supervisor, Ops supervisor cannot self-activate -> 403 MAKER_CHECKER_VIOLATION
    await prisma.providerOrganization.update({
      where: { id: provider.id },
      data: { submittedByUserId: ops.user.id },
    });

    const opsSelfActivateReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/ops/providers/${provider.id}/activate`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: ops.cookie,
        },
        body: JSON.stringify({ expectedVersion: 2 }),
      }
    );
    const opsSelfActivateRes = await activateProviderHandler(opsSelfActivateReq, {
      params: Promise.resolve({ id: provider.id }),
    });
    expect(opsSelfActivateRes.status).toBe(403);
    const opsBody = await opsSelfActivateRes.json();
    expect(opsBody.error).toBe("MAKER_CHECKER_VIOLATION");
  });

  it("enforces uniqueness invariants on Egyptian Tax ID, CR Number, and Branch Code", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const sales = await createAuthenticatedStaffUser("SALES_AGENT", "SALES");
    const uid = crypto.randomUUID().slice(0, 6);
    const taxId = `${Math.floor(100000000 + Math.random() * 900000000)}`;
    const crNumber = `CR-${uid}`;

    // Create first provider
    const req1 = new NextRequest("http://localhost:3000/api/v1/staff/providers", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: sales.cookie },
      body: JSON.stringify({
        nameEn: "Provider One",
        nameAr: "مزود أول",
        legalName: "Provider One SAE",
        taxRegistrationNumber: taxId,
        commercialRegistrationNumber: crNumber,
        primaryCluster: "NASR_CITY_HELIOPOLIS",
        contactPersonName: "Omar Hany",
        contactEmail: "omar@one.eg",
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

  it("enforces optimistic concurrency control (OCC) and rejects stale version edits", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const sales = await createAuthenticatedStaffUser("SALES_AGENT", "SALES");
    const uid = crypto.randomUUID().slice(0, 6);
    const taxId = `${Math.floor(100000000 + Math.random() * 900000000)}`;

    const prisma = getPrisma();
    const provider = await prisma.providerOrganization.create({
      data: {
        nameEn: "OCC Test Provider",
        nameAr: "اختبار التزامن",
        legalName: "OCC Test SAE",
        taxRegistrationNumber: taxId,
        commercialRegistrationNumber: `CR-${uid}`,
        primaryCluster: "NASR_CITY_HELIOPOLIS",
        contactPersonName: "Sameh Zaki",
        contactEmail: "sameh@occ.eg",
        contactPhone: "+201012345678",
        createdByUserId: sales.user.id,
        status: "DRAFT",
        version: 1,
      },
    });
    createdProviderIds.push(provider.id);

    // Call update with wrong expectedVersion (e.g. 5 instead of 1)
    const staleReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/providers/${provider.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: sales.cookie },
        body: JSON.stringify({
          expectedVersion: 5,
          nameEn: "Stale Name Update",
        }),
      }
    );

    const staleRes = await updateProviderHandler(staleReq, {
      params: Promise.resolve({ id: provider.id }),
    });
    expect(staleRes.status).toBe(409);
    const staleBody = await staleRes.json();
    expect(staleBody.error).toBe("CONCURRENT_MODIFICATION");
  });

  it("supports Operations pause and resume on both provider and branch levels", async () => {
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

    // 1. Pause Provider
    const pauseReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/ops/providers/${provider.id}/pause`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ops.cookie },
        body: JSON.stringify({
          expectedVersion: 3,
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

    // 3. Pause Branch
    const pauseBranchReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/ops/branches/${branch.id}/pause`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ops.cookie },
        body: JSON.stringify({
          expectedVersion: 2,
          pauseReason: "Facility renovation",
        }),
      }
    );
    const pauseBranchRes = await pauseBranchHandler(pauseBranchReq, {
      params: Promise.resolve({ branchId: branch.id }),
    });
    expect(pauseBranchRes.status).toBe(200);
    const pausedBranch = await pauseBranchRes.json();
    expect(pausedBranch.status).toBe("PAUSED");
    expect(pausedBranch.version).toBe(3);

    // 4. Resume Branch
    const resumeBranchReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/ops/branches/${branch.id}/resume`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ops.cookie },
        body: JSON.stringify({ expectedVersion: 3 }),
      }
    );
    const resumeBranchRes = await resumeBranchHandler(resumeBranchReq, {
      params: Promise.resolve({ branchId: branch.id }),
    });
    expect(resumeBranchRes.status).toBe(200);
    const resumedBranch = await resumeBranchRes.json();
    expect(resumedBranch.status).toBe("ACTIVE");
    expect(resumedBranch.version).toBe(4);
  });

  it("supports provider rejection by Operations and returns to DRAFT with reason", async () => {
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

    // Operations rejects provider and returns to DRAFT
    const rejectReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/ops/providers/${provider.id}/reject`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ops.cookie },
        body: JSON.stringify({
          expectedVersion: 2,
          returnToDraft: true,
          rejectionReason: "Commercial registration copy is blurry. Please re-upload.",
        }),
      }
    );
    const rejectRes = await rejectProviderHandler(rejectReq, {
      params: Promise.resolve({ id: provider.id }),
    });
    expect(rejectRes.status).toBe(200);
    const rejectedProvider = await rejectRes.json();
    expect(rejectedProvider.status).toBe("DRAFT");
    expect(rejectedProvider.rejectionReason).toBe(
      "Commercial registration copy is blurry. Please re-upload."
    );
    expect(rejectedProvider.version).toBe(3);
  });

  it("supports listing and querying providers and branches via staff read endpoints", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const sales = await createAuthenticatedStaffUser("SALES_AGENT", "SALES");
    const uid = crypto.randomUUID().slice(0, 6);
    const taxId = `${Math.floor(100000000 + Math.random() * 900000000)}`;

    const prisma = getPrisma();
    const provider = await prisma.providerOrganization.create({
      data: {
        nameEn: "Query Test Auto",
        nameAr: "اختبار الاستعلام",
        legalName: "Query Test SAE",
        taxRegistrationNumber: taxId,
        commercialRegistrationNumber: `CR-${uid}`,
        primaryCluster: "NASR_CITY_HELIOPOLIS",
        contactPersonName: "Kareem Adel",
        contactEmail: "kareem@query.eg",
        contactPhone: "+201012345678",
        createdByUserId: sales.user.id,
        status: "DRAFT",
        version: 1,
        branches: {
          create: {
            branchCode: `BR-${uid}`,
            nameEn: "Branch Query",
            nameAr: "فرع الاستعلام",
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

    // List providers
    const listReq = new NextRequest(
      "http://localhost:3000/api/v1/staff/providers?cluster=NASR_CITY_HELIOPOLIS",
      {
        method: "GET",
        headers: { cookie: sales.cookie },
      }
    );
    const listRes = await listProvidersHandler(listReq);
    expect(listRes.status).toBe(200);
    const providersList = await listRes.json();
    expect(providersList.some((p: { id: string }) => p.id === provider.id)).toBe(true);

    // Get single provider
    const getReq = new NextRequest(`http://localhost:3000/api/v1/staff/providers/${provider.id}`, {
      method: "GET",
      headers: { cookie: sales.cookie },
    });
    const getRes = await getProviderHandler(getReq, {
      params: Promise.resolve({ id: provider.id }),
    });
    expect(getRes.status).toBe(200);
    const fetched = await getRes.json();
    expect(fetched.id).toBe(provider.id);
    expect(fetched.branches).toHaveLength(1);

    // List branches for provider
    const listBranchesReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/providers/${provider.id}/branches`,
      {
        method: "GET",
        headers: { cookie: sales.cookie },
      }
    );
    const listBranchesRes = await listBranchesHandler(listBranchesReq, {
      params: Promise.resolve({ id: provider.id }),
    });
    expect(listBranchesRes.status).toBe(200);
    const branches = await listBranchesRes.json();
    expect(branches).toHaveLength(1);
    expect(branches[0].id).toBe(branch.id);

    // Update branch
    const updateBranchReq = new NextRequest(
      `http://localhost:3000/api/v1/staff/providers/${provider.id}/branches/${branch.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: sales.cookie },
        body: JSON.stringify({
          expectedVersion: 1,
          nameEn: "Updated Branch Name",
        }),
      }
    );
    const updateBranchRes = await updateBranchHandler(updateBranchReq, {
      params: Promise.resolve({ id: provider.id, branchId: branch.id }),
    });
    expect(updateBranchRes.status).toBe(200);
    const updatedBranch = await updateBranchRes.json();
    expect(updatedBranch.nameEn).toBe("Updated Branch Name");
    expect(updatedBranch.version).toBe(2);
  });
});
