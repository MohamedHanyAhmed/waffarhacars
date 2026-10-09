import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import pg from "pg";
import { NextRequest } from "next/server";
import { getPrisma, disconnectDb } from "@/lib/db";
import { resetAuth } from "@/lib/auth";
import { resetServerEnvCache } from "@/lib/env";
import { provisionStaffMember } from "@/lib/staff/provisioning";
import { POST as createServiceHandler } from "@/app/api/v1/staff/ops/catalog/services/route";
import { POST as createOfferHandler } from "@/app/api/v1/staff/offers/route";
import { GET as getOfferHandler } from "@/app/api/v1/staff/offers/[offerId]/route";
import { POST as submitOfferHandler } from "@/app/api/v1/staff/offers/[offerId]/revisions/[revisionId]/submit/route";
import { POST as approveOfferHandler } from "@/app/api/v1/staff/ops/offers/[offerId]/revisions/[revisionId]/approve/route";
import { POST as rejectOfferHandler } from "@/app/api/v1/staff/ops/offers/[offerId]/revisions/[revisionId]/reject/route";
import { POST as newRevisionHandler } from "@/app/api/v1/staff/offers/[offerId]/revisions/route";
import { PATCH as updateDraftHandler } from "@/app/api/v1/staff/offers/[offerId]/revisions/[revisionId]/route";
import { GET as getCatalogHandler } from "@/app/api/v1/staff/catalog/services/route";

const TEST_DB_URL =
  process.env.DATABASE_URL ||
  "postgresql://test_user:test_password@localhost:5432/waffarhacars_test";
const TEST_SECRET = "test-secret-at-least-32-characters-long-12345";
const originalEnv = { ...process.env };
let databaseAvailable = false;
const createdEmails: string[] = [];
const createdProviderIds: string[] = [];
const createdServiceDefinitionIds: string[] = [];
const createdOfferIds: string[] = [];

function signedCookie(token: string) {
  const signature = crypto.createHmac("sha256", TEST_SECRET).update(token).digest("base64");
  return `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`;
}

function makeRequest(path: string, method: string, cookie?: string, body?: unknown) {
  const headers = new Headers({
    "content-type": "application/json",
    "x-forwarded-for": "198.51.100.10",
  });
  if (cookie) headers.set("cookie", cookie);
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function createStaff(role: "SALES_AGENT" | "OPS_SUPERVISOR" | "FINANCE_OFFICER") {
  const prisma = getPrisma();
  const uid = crypto.randomUUID().slice(0, 10);
  if ((await prisma.internalStaffMembership.count()) === 0) {
    const email = `offer-bootstrap-${uid}@test.eg`;
    createdEmails.push(email);
    await provisionStaffMember({
      email,
      password: "ValidStaffPassword123!",
      fullName: "Offer Test Bootstrap Admin",
      employeeNumber: `BOOT-${uid}`,
      department: "ADMIN",
      isBootstrap: true,
    });
  }
  const department =
    role === "SALES_AGENT" ? "SALES" : role === "OPS_SUPERVISOR" ? "OPERATIONS" : "FINANCE";
  const email = `offer-${role.toLowerCase()}-${uid}@test.eg`;
  createdEmails.push(email);
  const provisioned = await provisionStaffMember({
    email,
    password: "ValidStaffPassword123!",
    fullName: `Offer Test ${role}`,
    employeeNumber: `EMP-${uid}`,
    department,
    role,
  });
  await prisma.user.update({ where: { id: provisioned.userId }, data: { twoFactorEnabled: true } });
  await prisma.twoFactor.create({
    data: {
      userId: provisioned.userId,
      secret: "JBSWY3DPEHPK3PXP",
      backupCodes: "[]",
      verified: true,
    },
  });
  await prisma.internalStaffMembership.update({
    where: { userId: provisioned.userId },
    data: { mustChangePassword: false, isActive: true },
  });
  const token = `offer-session-${crypto.randomUUID()}`;
  await prisma.session.create({
    data: {
      userId: provisioned.userId,
      token,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      lastActivityAt: new Date(),
    },
  });
  return { userId: provisioned.userId, cookie: signedCookie(token) };
}

async function createProviderAndBranch(salesUserId: string, opsUserId: string) {
  const prisma = getPrisma();
  const uid = crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  const provider = await prisma.providerOrganization.create({
    data: {
      nameEn: "Offer Test Provider",
      nameAr: "مركز اختبار العروض",
      legalName: "Offer Test Company",
      taxRegistrationNumber: `${Math.floor(100000000 + Math.random() * 900000000)}`,
      commercialRegistrationNumber: `CR-${uid}`,
      primaryCluster: "NASR_CITY_HELIOPOLIS",
      status: "ACTIVE",
      version: 1,
      contactPersonName: "Test Person",
      contactEmail: `provider-${uid}@test.eg`,
      contactPhone: "+201011112222",
      createdByUserId: salesUserId,
      activatedByUserId: opsUserId,
      activatedAt: new Date(),
    },
  });
  createdProviderIds.push(provider.id);
  const branch = await prisma.providerBranch.create({
    data: {
      providerOrganizationId: provider.id,
      branchCode: `OT-${uid}`,
      nameEn: "Offer Test Branch",
      nameAr: "فرع اختبار العروض",
      cluster: "NASR_CITY_HELIOPOLIS",
      streetAddressEn: "Test Street",
      streetAddressAr: "شارع اختبار",
      latitude: "30.061200",
      longitude: "31.341100",
      contactPhone: "+201011112222",
      operatingHours: [],
      status: "ACTIVE",
      version: 2,
      legalIdentityChecked: true,
      physicalLocationChecked: true,
      contactAndHoursChecked: true,
      evidenceDocumentRef: `BR-${uid}`,
      vettedByUserId: opsUserId,
      vettedAt: new Date(),
    },
  });
  return { provider, branch };
}

async function createServiceDefinition(
  opsCookie: string,
  categoryCode = "EXPRESS_MAINTENANCE",
  pricingMode = "FIXED_SCOPE",
  itemSku?: string
) {
  const prisma = getPrisma();
  const category = await prisma.serviceCategory.findUniqueOrThrow({
    where: { code: categoryCode },
  });
  const uid = crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
  const response = await createServiceHandler(
    makeRequest("/api/v1/staff/ops/catalog/services", "POST", opsCookie, {
      code: `TEST_SERVICE_${uid}`,
      categoryId: category.id,
      nameEn: `Test service ${uid}`,
      nameAr: `خدمة اختبار ${uid}`,
      scopeEn: "A narrowly defined fixed-scope service",
      scopeAr: "خدمة محددة بنطاق ثابت",
      pricingMode,
      itemSku,
    })
  );
  const data = await response.json();
  if (response.status === 201) createdServiceDefinitionIds.push(data.id);
  return { response, data };
}

function validOffer(providerOrganizationId: string, branchId: string, serviceDefinitionId: string) {
  return {
    creationRequestId: crypto.randomUUID(),
    revisionRequestId: crypto.randomUUID(),
    providerOrganizationId,
    branchId,
    serviceDefinitionId,
    fields: {
      titleEn: "Express oil service",
      titleAr: "خدمة تغيير زيت سريعة",
      includedLaborEn: "Drain old engine oil and refill to manufacturer specification",
      includedLaborAr: "تفريغ زيت المحرك القديم وإعادة التعبئة وفق مواصفات الشركة",
      includedPartsEn: "One agreed oil filter and engine oil",
      includedPartsAr: "فلتر زيت واحد وزيت محرك متفق عليه",
      excludedLaborEn: "Engine diagnostics and unrelated repairs",
      excludedLaborAr: "فحص المحرك والإصلاحات غير المرتبطة",
      excludedPartsEn: "Additional oil or premium parts",
      excludedPartsAr: "زيت إضافي أو قطع غيار مميزة",
      bookingRule: "APPOINTMENT_REQUIRED",
      durationMinutes: 45,
      validFrom: new Date(Date.now() - 60_000).toISOString(),
      validUntil: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
      normalPriceMinor: "100000",
      customerPriceMinor: "80000",
      evidencePacketId: "PRICE-PACKET-001",
      evidenceType: "PROVIDER_PRICE_LIST",
      evidenceDate: new Date(Date.now() - 24 * 60 * 60_000).toISOString(),
      priceBasisNotes: "Printed service-center price list observed by Sales",
      commercialTermsPacketId: "TERMS-PACKET-001",
      commercialTermsAgreedAt: new Date(Date.now() - 24 * 60 * 60_000).toISOString(),
      commissionBasis: "DISCOUNTED_CUSTOMER_PRICE",
      commissionRateBps: 0,
    },
  };
}

async function createPendingOffer(
  salesCookie: string,
  opsCookie: string,
  salesUserId: string,
  opsUserId: string
) {
  const { provider, branch } = await createProviderAndBranch(salesUserId, opsUserId);
  const service = await createServiceDefinition(opsCookie);
  expect(service.response.status).toBe(201);
  const payload = validOffer(provider.id, branch.id, service.data.id);
  const createResponse = await createOfferHandler(
    makeRequest("/api/v1/staff/offers", "POST", salesCookie, payload)
  );
  expect(createResponse.status).toBe(201);
  const created = await createResponse.json();
  createdOfferIds.push(created.offer.id);
  const submitResponse = await submitOfferHandler(
    makeRequest(
      `/api/v1/staff/offers/${created.offer.id}/revisions/${created.revision.id}/submit`,
      "POST",
      salesCookie,
      { expectedVersion: 1 }
    ),
    { params: Promise.resolve({ offerId: created.offer.id, revisionId: created.revision.id }) }
  );
  expect(submitResponse.status).toBe(200);
  return {
    provider,
    branch,
    offer: created.offer,
    revision: created.revision,
    serviceId: service.data.id,
    payload,
  };
}

const trueAttestation = {
  expectedVersion: 2,
  evidenceInspected: true,
  priceVerified: true,
  scopeVerified: true,
  providerConsentVerified: true,
};

async function waitForBlockedRequests(blocker: pg.Client, expected: number): Promise<number> {
  const blockerPid = (await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid"))
    .rows[0].pid;
  const deadline = Date.now() + 7000;
  let waiting = 0;
  while (Date.now() < deadline && waiting < expected) {
    const result = await blocker.query<{ count: number }>(
      `WITH RECURSIVE blocked(pid) AS (
         SELECT pid FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))
         UNION
         SELECT activity.pid FROM pg_stat_activity activity
         JOIN blocked ON blocked.pid = ANY(pg_blocking_pids(activity.pid))
       )
       SELECT count(*)::int AS count FROM blocked`,
      [blockerPid]
    );
    waiting = result.rows[0]?.count ?? 0;
    if (waiting < expected) await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return waiting;
}

describe("Production service catalog and offer approval PostgreSQL integration", () => {
  beforeAll(async () => {
    const client = new pg.Client({ connectionString: TEST_DB_URL, connectionTimeoutMillis: 3000 });
    try {
      await client.connect();
      databaseAvailable = (await client.query("SELECT 1 AS probe")).rows[0]?.probe === 1;
    } catch {
      databaseAvailable = false;
    } finally {
      await client.end().catch(() => {});
    }
  });

  beforeEach(() => {
    resetServerEnvCache();
    resetAuth();
    process.env = { ...originalEnv };
    process.env.APP_RUNTIME_PROFILE = "showcase";
    process.env.APP_DATA_BACKEND = "postgres";
    process.env.DATABASE_URL = TEST_DB_URL;
    process.env.DATABASE_DIRECT_URL = TEST_DB_URL;
    process.env.BETTER_AUTH_SECRET = TEST_SECRET;
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    process.env.PHONE_LOOKUP_HMAC_KEY = "test-lookup-key-at-least-32-characters-long-12345";
    process.env.STAFF_LOGIN_HMAC_KEY = "test-staff-login-key-at-least-32-characters-long-12345";
    process.env.OTP_PEPPER_SECRET = "test-otp-pepper-key-at-least-32-characters-long-12345";
    process.env.PHONE_ALIAS_HMAC_KEY = "test-phone-alias-key-at-least-32-characters-long-12345";
    process.env.OFFER_EVIDENCE_PACKET_REPOSITORY_READY = "true";
  });

  afterEach(async () => {
    try {
      if (!databaseAvailable) return;
      const prisma = getPrisma();
      const offers = await prisma.offer.findMany({
        where: {
          OR: [
            { id: { in: createdOfferIds } },
            { providerOrganizationId: { in: createdProviderIds } },
          ],
        },
        select: { id: true },
      });
      const offerIds = offers.map((offer) => offer.id);
      if (offers.length) {
        await prisma.offer.updateMany({
          where: { id: { in: offerIds } },
          data: { currentApprovedRevisionId: null },
        });
        await prisma.offerRevision.deleteMany({ where: { offerId: { in: offerIds } } });
        await prisma.offer.deleteMany({ where: { id: { in: offerIds } } });
      }
      if (createdServiceDefinitionIds.length) {
        await prisma.serviceDefinition.deleteMany({
          where: { id: { in: createdServiceDefinitionIds } },
        });
      }
      if (createdProviderIds.length) {
        await prisma.providerBranch.deleteMany({
          where: { providerOrganizationId: { in: createdProviderIds } },
        });
        await prisma.providerOrganization.deleteMany({ where: { id: { in: createdProviderIds } } });
      }
      if (createdEmails.length) {
        const users = await prisma.user.findMany({
          where: { email: { in: createdEmails } },
          select: { id: true },
        });
        const ids = users.map((user) => user.id);
        if (ids.length) {
          await prisma.securityAuditEvent.deleteMany({ where: { actorUserId: { in: ids } } });
          await prisma.internalRoleAssignment.deleteMany({
            where: { staffMembership: { userId: { in: ids } } },
          });
          await prisma.internalStaffMembership.deleteMany({ where: { userId: { in: ids } } });
          await prisma.twoFactor.deleteMany({ where: { userId: { in: ids } } });
          await prisma.session.deleteMany({ where: { userId: { in: ids } } });
          await prisma.account.deleteMany({ where: { userId: { in: ids } } });
          await prisma.user.deleteMany({ where: { id: { in: ids } } });
        }
      }
    } finally {
      createdEmails.length = 0;
      createdProviderIds.length = 0;
      createdServiceDefinitionIds.length = 0;
      createdOfferIds.length = 0;
    }
  });

  afterAll(async () => {
    process.env = originalEnv;
    await disconnectDb().catch(() => {});
  });

  it("creates, submits, approves, and retries an offer with one immutable current approval and one audit per transition", async () => {
    if (!databaseAvailable)
      throw new Error("PostgreSQL integration service unavailable; start npm run db:test:up.");
    const sales = await createStaff("SALES_AGENT");
    const ops = await createStaff("OPS_SUPERVISOR");
    const draft = await createPendingOffer(sales.cookie, ops.cookie, sales.userId, ops.userId);
    expect(draft.revision.status).toBe("DRAFT");
    expect(draft.revision.savingsMinor).toBe("20000");

    const duplicateCreate = await createOfferHandler(
      makeRequest("/api/v1/staff/offers", "POST", sales.cookie, draft.payload)
    );
    expect(duplicateCreate.status).toBe(201);
    expect((await duplicateCreate.json()).offer.id).toBe(draft.offer.id);
    const duplicateSubmit = await submitOfferHandler(
      makeRequest("/api/v1/staff/offers/submit", "POST", sales.cookie, { expectedVersion: 1 }),
      { params: Promise.resolve({ offerId: draft.offer.id, revisionId: draft.revision.id }) }
    );
    expect(duplicateSubmit.status).toBe(200);

    const prisma = getPrisma();
    const submitted = await prisma.offerRevision.findUniqueOrThrow({
      where: { id: draft.revision.id },
    });
    const approvalResponse = await approveOfferHandler(
      makeRequest("/api/v1/staff/ops/offers/approve", "POST", ops.cookie, trueAttestation),
      { params: Promise.resolve({ offerId: draft.offer.id, revisionId: draft.revision.id }) }
    );
    expect(approvalResponse.status).toBe(200);
    const approved = await approvalResponse.json();
    expect(approved.status).toBe("APPROVED");
    expect(approved.decidedByUserId).toBe(ops.userId);
    expect(
      approved.evidenceInspected &&
        approved.priceVerified &&
        approved.scopeVerified &&
        approved.providerConsentVerified
    ).toBe(true);

    const retryResponse = await approveOfferHandler(
      makeRequest("/api/v1/staff/ops/offers/approve", "POST", ops.cookie, trueAttestation),
      { params: Promise.resolve({ offerId: draft.offer.id, revisionId: draft.revision.id }) }
    );
    expect(retryResponse.status).toBe(200);
    expect((await retryResponse.json()).id).toBe(approved.id);
    const storedOffer = await prisma.offer.findUniqueOrThrow({ where: { id: draft.offer.id } });
    const approvalAuditCount = await prisma.securityAuditEvent.count({
      where: {
        actorUserId: ops.userId,
        eventType: "OFFER_APPROVED",
        targetEntity: `offer_revision:${draft.revision.id}`,
      },
    });
    const transitionAuditCount = await prisma.securityAuditEvent.count({
      where: {
        targetEntity: `offer_revision:${draft.revision.id}`,
        eventType: { in: ["OFFER_DRAFT_CREATED", "OFFER_SUBMITTED_FOR_REVIEW", "OFFER_APPROVED"] },
      },
    });
    expect(storedOffer.currentApprovedRevisionId).toBe(draft.revision.id);
    expect(approvalAuditCount).toBe(1);
    expect(transitionAuditCount).toBe(3);
    expect(submitted.status).toBe("PENDING_REVIEW");
    expect(submitted.submittedByUserId).toBe(sales.userId);
    expect(submitted.submittedAt).not.toBeNull();
    expect(approved.submittedByUserId).toBe(sales.userId);
    expect(new Date(approved.submittedAt).getTime()).toBe(submitted.submittedAt?.getTime());
  });

  it("accepts an identical creation retry after draft edits but rejects the same key with changed commercial terms", async () => {
    if (!databaseAvailable)
      throw new Error("PostgreSQL integration service unavailable; start npm run db:test:up.");
    const sales = await createStaff("SALES_AGENT");
    const ops = await createStaff("OPS_SUPERVISOR");
    const { provider, branch } = await createProviderAndBranch(sales.userId, ops.userId);
    const service = await createServiceDefinition(ops.cookie);
    expect(service.response.status).toBe(201);
    const payload = validOffer(provider.id, branch.id, service.data.id);
    const first = await createOfferHandler(
      makeRequest("/api/v1/staff/offers", "POST", sales.cookie, payload)
    );
    expect(first.status).toBe(201);
    const original = await first.json();
    createdOfferIds.push(original.offer.id);
    expect(original.offer.creationRequestFingerprint).toBeUndefined();

    const changedFields = { ...payload.fields, customerPriceMinor: "75000" };
    const edit = await updateDraftHandler(
      makeRequest("/api/v1/staff/offers/edit", "PATCH", sales.cookie, {
        expectedVersion: 1,
        fields: changedFields,
      }),
      { params: Promise.resolve({ offerId: original.offer.id, revisionId: original.revision.id }) }
    );
    expect(edit.status).toBe(200);
    const identicalRetry = await createOfferHandler(
      makeRequest("/api/v1/staff/offers", "POST", sales.cookie, payload)
    );
    expect(identicalRetry.status).toBe(201);
    expect((await identicalRetry.json()).offer.id).toBe(original.offer.id);

    const changedRetry = await createOfferHandler(
      makeRequest("/api/v1/staff/offers", "POST", sales.cookie, {
        ...payload,
        fields: changedFields,
      })
    );
    expect(changedRetry.status).toBe(409);
    expect((await changedRetry.json()).error).toBe("DUPLICATE_REQUEST");
    const changedServiceRetry = await createOfferHandler(
      makeRequest("/api/v1/staff/offers", "POST", sales.cookie, {
        ...payload,
        serviceDefinitionId: crypto.randomUUID(),
      })
    );
    expect(changedServiceRetry.status).toBe(409);
    expect((await changedServiceRetry.json()).error).toBe("DUPLICATE_REQUEST");
    const changedCommissionRetry = await createOfferHandler(
      makeRequest("/api/v1/staff/offers", "POST", sales.cookie, {
        ...payload,
        fields: { ...payload.fields, commissionRateBps: 1000 },
      })
    );
    expect(changedCommissionRetry.status).toBe(409);
    expect((await changedCommissionRetry.json()).error).toBe("DUPLICATE_REQUEST");

    const prisma = getPrisma();
    await expect(
      prisma.offer.update({
        where: { id: original.offer.id },
        data: { creationRequestFingerprint: "a".repeat(64) },
      })
    ).rejects.toThrow();
    expect(
      await prisma.offer.count({ where: { creationRequestId: payload.creationRequestId } })
    ).toBe(1);
    expect(await prisma.offerRevision.count({ where: { offerId: original.offer.id } })).toBe(1);
    expect(
      await prisma.securityAuditEvent.count({
        where: {
          eventType: "OFFER_DRAFT_CREATED",
          targetEntity: `offer_revision:${original.revision.id}`,
        },
      })
    ).toBe(1);
    expect(
      (await prisma.offerRevision.findUniqueOrThrow({ where: { id: original.revision.id } }))
        .customerPriceMinor
    ).toBe(75000n);
  });

  it("serializes simultaneous identical creation requests into one offer, one revision, and one creation audit", async () => {
    if (!databaseAvailable)
      throw new Error("PostgreSQL integration service unavailable; start npm run db:test:up.");
    const sales = await createStaff("SALES_AGENT");
    const ops = await createStaff("OPS_SUPERVISOR");
    const { provider, branch } = await createProviderAndBranch(sales.userId, ops.userId);
    const service = await createServiceDefinition(ops.cookie);
    expect(service.response.status).toBe(201);
    const payload = validOffer(provider.id, branch.id, service.data.id);
    const blocker = new pg.Client({ connectionString: TEST_DB_URL });
    await blocker.connect();
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM provider_organizations WHERE id = $1 FOR UPDATE", [
      provider.id,
    ]);
    const requestA = createOfferHandler(
      makeRequest("/api/v1/staff/offers", "POST", sales.cookie, payload)
    );
    const requestB = createOfferHandler(
      makeRequest("/api/v1/staff/offers", "POST", sales.cookie, payload)
    );
    let waiting = 0;
    let settled: PromiseSettledResult<Response>[] = [];
    try {
      waiting = await waitForBlockedRequests(blocker, 2);
    } finally {
      await blocker.query("COMMIT").finally(() => blocker.end());
      settled = await Promise.allSettled([requestA, requestB]);
    }
    expect(waiting).toBe(2);
    const responses = settled.map((result) => {
      if (result.status === "rejected") throw result.reason;
      return result.value;
    });
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    const resultA = await responses[0].json();
    const resultB = await responses[1].json();
    expect(resultA.offer.id).toBe(resultB.offer.id);
    createdOfferIds.push(resultA.offer.id);
    const prisma = getPrisma();
    expect(
      await prisma.offer.count({ where: { creationRequestId: payload.creationRequestId } })
    ).toBe(1);
    expect(await prisma.offerRevision.count({ where: { offerId: resultA.offer.id } })).toBe(1);
    expect(
      await prisma.securityAuditEvent.count({
        where: {
          eventType: "OFFER_DRAFT_CREATED",
          targetEntity: `offer_revision:${resultA.revision.id}`,
        },
      })
    ).toBe(1);
  });

  it("returns stable validation errors for malformed offer and revision route IDs without writes", async () => {
    if (!databaseAvailable)
      throw new Error("PostgreSQL integration service unavailable; start npm run db:test:up.");
    const sales = await createStaff("SALES_AGENT");
    const beforeOffers = await getPrisma().offer.count();
    const read = await getOfferHandler(
      makeRequest("/api/v1/staff/offers/not-a-uuid", "GET", sales.cookie),
      { params: Promise.resolve({ offerId: "not-a-uuid" }) }
    );
    const submit = await submitOfferHandler(
      makeRequest(
        "/api/v1/staff/offers/not-a-uuid/revisions/not-a-uuid/submit",
        "POST",
        sales.cookie,
        { expectedVersion: 1 }
      ),
      { params: Promise.resolve({ offerId: "not-a-uuid", revisionId: "not-a-uuid" }) }
    );
    expect(read.status).toBe(400);
    expect(submit.status).toBe(400);
    expect((await read.json()).error).toBe("VALIDATION_ERROR");
    expect((await submit.json()).error).toBe("VALIDATION_ERROR");
    expect(await getPrisma().offer.count()).toBe(beforeOffers);
  });

  it("returns a stable conflict for a duplicate Ops service code and writes one definition and audit", async () => {
    if (!databaseAvailable)
      throw new Error("PostgreSQL integration service unavailable; start npm run db:test:up.");
    const ops = await createStaff("OPS_SUPERVISOR");
    const first = await createServiceDefinition(ops.cookie);
    expect(first.response.status).toBe(201);
    const duplicate = await createServiceHandler(
      makeRequest("/api/v1/staff/ops/catalog/services", "POST", ops.cookie, {
        code: first.data.code,
        categoryId: first.data.categoryId,
        nameEn: "Different service",
        nameAr: "خدمة مختلفة",
        scopeEn: "Different fixed scope",
        scopeAr: "نطاق مختلف",
        pricingMode: "FIXED_SCOPE",
      })
    );
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).error).toBe("SERVICE_CODE_ALREADY_EXISTS");
    expect(await getPrisma().serviceDefinition.count({ where: { code: first.data.code } })).toBe(1);
    expect(
      await getPrisma().securityAuditEvent.count({
        where: {
          eventType: "SERVICE_DEFINITION_CREATED",
          targetEntity: `service_definition:${first.data.id}`,
        },
      })
    ).toBe(1);
  });

  it.each(["evidenceDate", "commercialTermsAgreedAt"] as const)(
    "blocks approval when %s is future-dated and preserves pending state and audit cardinality",
    async (dateField) => {
      if (!databaseAvailable)
        throw new Error("PostgreSQL integration service unavailable; start npm run db:test:up.");
      const sales = await createStaff("SALES_AGENT");
      const ops = await createStaff("OPS_SUPERVISOR");
      const { provider, branch } = await createProviderAndBranch(sales.userId, ops.userId);
      const service = await createServiceDefinition(ops.cookie);
      expect(service.response.status).toBe(201);
      const payload = validOffer(provider.id, branch.id, service.data.id);
      payload.fields[dateField] = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
      const create = await createOfferHandler(
        makeRequest("/api/v1/staff/offers", "POST", sales.cookie, payload)
      );
      expect(create.status).toBe(201);
      const draft = await create.json();
      createdOfferIds.push(draft.offer.id);
      const submit = await submitOfferHandler(
        makeRequest("/api/v1/staff/offers/submit", "POST", sales.cookie, { expectedVersion: 1 }),
        { params: Promise.resolve({ offerId: draft.offer.id, revisionId: draft.revision.id }) }
      );
      expect(submit.status).toBe(200);
      const approve = await approveOfferHandler(
        makeRequest("/api/v1/staff/ops/offers/approve", "POST", ops.cookie, trueAttestation),
        { params: Promise.resolve({ offerId: draft.offer.id, revisionId: draft.revision.id }) }
      );
      expect(approve.status).toBe(422);
      expect((await approve.json()).error).toBe("FUTURE_DATED_EVIDENCE");
      const prisma = getPrisma();
      expect(
        (await prisma.offerRevision.findUniqueOrThrow({ where: { id: draft.revision.id } })).status
      ).toBe("PENDING_REVIEW");
      expect(
        (await prisma.offer.findUniqueOrThrow({ where: { id: draft.offer.id } }))
          .currentApprovedRevisionId
      ).toBeNull();
      expect(
        await prisma.securityAuditEvent.count({
          where: {
            eventType: "OFFER_APPROVED",
            targetEntity: `offer_revision:${draft.revision.id}`,
          },
        })
      ).toBe(0);
    }
  );

  it("blocks approval while the controlled evidence repository launch gate is false without persistent writes", async () => {
    if (!databaseAvailable)
      throw new Error("PostgreSQL integration service unavailable; start npm run db:test:up.");
    const sales = await createStaff("SALES_AGENT");
    const ops = await createStaff("OPS_SUPERVISOR");
    const draft = await createPendingOffer(sales.cookie, ops.cookie, sales.userId, ops.userId);
    const prisma = getPrisma();
    process.env.OFFER_EVIDENCE_PACKET_REPOSITORY_READY = "false";
    resetServerEnvCache();
    const blocked = await approveOfferHandler(
      makeRequest("/api/v1/staff/ops/offers/approve", "POST", ops.cookie, trueAttestation),
      { params: Promise.resolve({ offerId: draft.offer.id, revisionId: draft.revision.id }) }
    );
    expect(blocked.status).toBe(503);
    expect((await blocked.json()).error).toBe("OFFER_APPROVAL_BLOCKED");
    const persistedRevision = await prisma.offerRevision.findUniqueOrThrow({
      where: { id: draft.revision.id },
    });
    const persistedOffer = await prisma.offer.findUniqueOrThrow({ where: { id: draft.offer.id } });
    expect(persistedRevision.status).toBe("PENDING_REVIEW");
    expect(persistedRevision.decidedAt).toBeNull();
    expect(persistedOffer.currentApprovedRevisionId).toBeNull();
    expect(
      await prisma.securityAuditEvent.count({
        where: { eventType: "OFFER_APPROVED", targetEntity: `offer_revision:${draft.revision.id}` },
      })
    ).toBe(0);
  });

  it("denies finance reads and sales catalog mutations and rejects cross-provider branch selection without writes", async () => {
    if (!databaseAvailable)
      throw new Error("PostgreSQL integration service unavailable; start npm run db:test:up.");
    const sales = await createStaff("SALES_AGENT");
    const ops = await createStaff("OPS_SUPERVISOR");
    const finance = await createStaff("FINANCE_OFFICER");
    const first = await createProviderAndBranch(sales.userId, ops.userId);
    const second = await createProviderAndBranch(sales.userId, ops.userId);
    const service = await createServiceDefinition(ops.cookie);
    expect(service.response.status).toBe(201);

    const deniedCatalog = await createServiceHandler(
      makeRequest("/api/v1/staff/ops/catalog/services", "POST", sales.cookie, {})
    );
    expect(deniedCatalog.status).toBe(403);
    const deniedFinance = await getCatalogHandler(
      makeRequest("/api/v1/staff/catalog/services", "GET", finance.cookie)
    );
    expect(deniedFinance.status).toBe(403);
    const mismatch = validOffer(first.provider.id, second.branch.id, service.data.id);
    const response = await createOfferHandler(
      makeRequest("/api/v1/staff/offers", "POST", sales.cookie, mismatch)
    );
    expect(response.status).toBe(404);
    expect(
      await getPrisma().offer.count({ where: { providerOrganizationId: first.provider.id } })
    ).toBe(0);
  });

  it("keeps general repairs quote-only and requires identifiable SKUs for accessory definitions", async () => {
    if (!databaseAvailable)
      throw new Error("PostgreSQL integration service unavailable; start npm run db:test:up.");
    const ops = await createStaff("OPS_SUPERVISOR");
    const repair = await createServiceDefinition(ops.cookie, "GENERAL_REPAIRS", "FIXED_SCOPE");
    expect(repair.response.status).toBe(422);
    const accessory = await createServiceDefinition(ops.cookie, "ACCESSORIES", "FIXED_SCOPE");
    expect(accessory.response.status).toBe(422);
    const quoteOnly = await createServiceDefinition(
      ops.cookie,
      "GENERAL_REPAIRS",
      "QUOTE_REQUIRED"
    );
    expect(quoteOnly.response.status).toBe(201);
    const sales = await createStaff("SALES_AGENT");
    const { provider, branch } = await createProviderAndBranch(sales.userId, ops.userId);
    const payload = validOffer(provider.id, branch.id, quoteOnly.data.id);
    const response = await createOfferHandler(
      makeRequest("/api/v1/staff/offers", "POST", sales.cookie, payload)
    );
    expect(response.status).toBe(422);
    expect(await getPrisma().offer.count({ where: { providerOrganizationId: provider.id } })).toBe(
      0
    );
  });

  it("rejects the creator after role reassignment and preserves rejected revision while opening a new draft", async () => {
    if (!databaseAvailable)
      throw new Error("PostgreSQL integration service unavailable; start npm run db:test:up.");
    const sales = await createStaff("SALES_AGENT");
    const ops = await createStaff("OPS_SUPERVISOR");
    const draft = await createPendingOffer(sales.cookie, ops.cookie, sales.userId, ops.userId);
    const prisma = getPrisma();
    const reassigned = await createPendingOffer(sales.cookie, ops.cookie, sales.userId, ops.userId);

    const creatorMembership = await prisma.internalStaffMembership.findUniqueOrThrow({
      where: { userId: sales.userId },
      include: { roleAssignments: true },
    });
    await prisma.internalRoleAssignment.updateMany({
      where: { staffMembershipId: creatorMembership.id },
      data: { isActive: false },
    });
    await prisma.internalRoleAssignment.create({
      data: { staffMembershipId: creatorMembership.id, role: "OPS_SUPERVISOR", isActive: true },
    });
    const selfApprove = await approveOfferHandler(
      makeRequest("/api/v1/staff/ops/offers/approve", "POST", sales.cookie, trueAttestation),
      {
        params: Promise.resolve({
          offerId: reassigned.offer.id,
          revisionId: reassigned.revision.id,
        }),
      }
    );
    expect(selfApprove.status).toBe(403);

    await prisma.internalRoleAssignment.deleteMany({
      where: { staffMembershipId: creatorMembership.id },
    });
    await prisma.internalRoleAssignment.create({
      data: { staffMembershipId: creatorMembership.id, role: "SALES_AGENT", isActive: true },
    });
    const rejection = await rejectOfferHandler(
      makeRequest("/api/v1/staff/ops/offers/reject", "POST", ops.cookie, {
        expectedVersion: 2,
        reasonCode: "SCOPE_INCOMPLETE",
      }),
      { params: Promise.resolve({ offerId: draft.offer.id, revisionId: draft.revision.id }) }
    );
    expect(rejection.status).toBe(200);
    const rejected = await rejection.json();
    const next = await newRevisionHandler(
      makeRequest("/api/v1/staff/offers/revisions", "POST", sales.cookie, {
        requestId: crypto.randomUUID(),
      }),
      { params: Promise.resolve({ offerId: draft.offer.id }) }
    );
    expect(next.status).toBe(201);
    const newDraft = await next.json();
    expect(newDraft.revisionNumber).toBe(2);
    expect(newDraft.status).toBe("DRAFT");
    const update = await updateDraftHandler(
      makeRequest("/api/v1/staff/offers/draft", "PATCH", sales.cookie, {
        expectedVersion: 1,
        fields: draft.payload.fields,
      }),
      { params: Promise.resolve({ offerId: draft.offer.id, revisionId: newDraft.id }) }
    );
    expect(update.status).toBe(200);
    const staleUpdate = await updateDraftHandler(
      makeRequest("/api/v1/staff/offers/draft", "PATCH", sales.cookie, {
        expectedVersion: 1,
        fields: draft.payload.fields,
      }),
      { params: Promise.resolve({ offerId: draft.offer.id, revisionId: newDraft.id }) }
    );
    expect(staleUpdate.status).toBe(409);
    const oldAfter = await prisma.offerRevision.findUniqueOrThrow({
      where: { id: draft.revision.id },
    });
    expect(oldAfter.status).toBe(rejected.status);
    expect(oldAfter.rejectionReason).toBe("SCOPE_INCOMPLETE");
  });

  it("database trigger rejects direct content edits to a pending revision and preserves its persisted values", async () => {
    if (!databaseAvailable)
      throw new Error("PostgreSQL integration service unavailable; start npm run db:test:up.");
    const sales = await createStaff("SALES_AGENT");
    const ops = await createStaff("OPS_SUPERVISOR");
    const draft = await createPendingOffer(sales.cookie, ops.cookie, sales.userId, ops.userId);
    const prisma = getPrisma();
    const before = await prisma.offerRevision.findUniqueOrThrow({
      where: { id: draft.revision.id },
    });
    await expect(
      prisma.offerRevision.update({
        where: { id: draft.revision.id },
        data: { titleEn: "Unauthorized post-submission edit", version: { increment: 1 } },
      })
    ).rejects.toThrow();
    const after = await prisma.offerRevision.findUniqueOrThrow({
      where: { id: draft.revision.id },
    });
    expect(after.status).toBe("PENDING_REVIEW");
    expect(after.titleEn).toBe(before.titleEn);
    expect(after.version).toBe(before.version);
    const client = new pg.Client({ connectionString: TEST_DB_URL });
    await client.connect();
    try {
      await expect(
        client.query(
          `UPDATE offer_revisions
           SET "submittedAt" = "submittedAt" + INTERVAL '1 second',
               "version" = "version" + 1
           WHERE id = $1`,
          [draft.revision.id]
        )
      ).rejects.toMatchObject({
        code: "23514",
        message: "pending offer revision submission metadata is immutable",
      });
    } finally {
      await client.end();
    }
    const afterMetadataAttempt = await prisma.offerRevision.findUniqueOrThrow({
      where: { id: draft.revision.id },
    });
    expect(afterMetadataAttempt.submittedAt?.getTime()).toBe(before.submittedAt?.getTime());
    expect(afterMetadataAttempt.version).toBe(before.version);
  });

  it("database trigger rejects a direct draft submission that also changes commercial content", async () => {
    if (!databaseAvailable)
      throw new Error("PostgreSQL integration service unavailable; start npm run db:test:up.");
    const sales = await createStaff("SALES_AGENT");
    const ops = await createStaff("OPS_SUPERVISOR");
    const { provider, branch } = await createProviderAndBranch(sales.userId, ops.userId);
    const service = await createServiceDefinition(ops.cookie);
    expect(service.response.status).toBe(201);
    const create = await createOfferHandler(
      makeRequest(
        "/api/v1/staff/offers",
        "POST",
        sales.cookie,
        validOffer(provider.id, branch.id, service.data.id)
      )
    );
    expect(create.status).toBe(201);
    const draft = await create.json();
    createdOfferIds.push(draft.offer.id);
    const prisma = getPrisma();
    const client = new pg.Client({ connectionString: TEST_DB_URL });
    await client.connect();
    try {
      await expect(
        client.query(
          `
        UPDATE offer_revisions
        SET "status" = 'PENDING_REVIEW',
            "submittedByUserId" = $1::uuid,
            "submittedAt" = CURRENT_TIMESTAMP,
            "titleEn" = 'Unauthorized changed scope',
            "version" = "version" + 1
        WHERE id = $2::uuid
      `,
          [sales.userId, draft.revision.id]
        )
      ).rejects.toMatchObject({
        code: "23514",
        message: "pending offer revision content is immutable",
      });
    } finally {
      await client.end();
    }
    const persisted = await prisma.offerRevision.findUniqueOrThrow({
      where: { id: draft.revision.id },
    });
    expect(persisted.status).toBe("DRAFT");
    expect(persisted.titleEn).toBe(draft.revision.titleEn);
    expect(persisted.version).toBe(1);
    expect(persisted.submittedByUserId).toBeNull();
    expect(persisted.submittedAt).toBeNull();
    expect(
      await prisma.securityAuditEvent.count({
        where: {
          eventType: "OFFER_SUBMITTED_FOR_REVIEW",
          targetEntity: `offer_revision:${draft.revision.id}`,
        },
      })
    ).toBe(0);
  });

  it("serializes two genuinely competing approvers to one approval and one audit event", async () => {
    if (!databaseAvailable)
      throw new Error("PostgreSQL integration service unavailable; start npm run db:test:up.");
    const sales = await createStaff("SALES_AGENT");
    const opsA = await createStaff("OPS_SUPERVISOR");
    const opsB = await createStaff("OPS_SUPERVISOR");
    const draft = await createPendingOffer(sales.cookie, opsA.cookie, sales.userId, opsA.userId);
    const blocker = new pg.Client({ connectionString: TEST_DB_URL });
    await blocker.connect();
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM provider_organizations WHERE id = $1 FOR UPDATE", [
      draft.provider.id,
    ]);
    const attemptA = approveOfferHandler(
      makeRequest("/api/v1/staff/ops/offers/approve", "POST", opsA.cookie, trueAttestation),
      { params: Promise.resolve({ offerId: draft.offer.id, revisionId: draft.revision.id }) }
    );
    const attemptB = approveOfferHandler(
      makeRequest("/api/v1/staff/ops/offers/approve", "POST", opsB.cookie, trueAttestation),
      { params: Promise.resolve({ offerId: draft.offer.id, revisionId: draft.revision.id }) }
    );
    let waiting = 0;
    let settled: PromiseSettledResult<Response>[] = [];
    try {
      waiting = await waitForBlockedRequests(blocker, 2);
    } finally {
      await blocker.query("COMMIT").finally(() => blocker.end());
      settled = await Promise.allSettled([attemptA, attemptB]);
    }
    expect(waiting).toBe(2);
    const [responseA, responseB] = settled.map((result) => {
      if (result.status === "rejected") throw result.reason;
      return result.value;
    });
    expect([responseA.status, responseB.status].sort()).toEqual([200, 409]);
    const prisma = getPrisma();
    const persisted = await prisma.offerRevision.findUniqueOrThrow({
      where: { id: draft.revision.id },
    });
    const auditCount = await prisma.securityAuditEvent.count({
      where: { eventType: "OFFER_APPROVED", targetEntity: `offer_revision:${draft.revision.id}` },
    });
    expect(persisted.status).toBe("APPROVED");
    expect(auditCount).toBe(1);
  });

  it("does not approve after provider deactivation wins the database lock race", async () => {
    if (!databaseAvailable)
      throw new Error("PostgreSQL integration service unavailable; start npm run db:test:up.");
    const sales = await createStaff("SALES_AGENT");
    const ops = await createStaff("OPS_SUPERVISOR");
    const draft = await createPendingOffer(sales.cookie, ops.cookie, sales.userId, ops.userId);
    const blocker = new pg.Client({ connectionString: TEST_DB_URL });
    await blocker.connect();
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM provider_organizations WHERE id = $1 FOR UPDATE", [
      draft.provider.id,
    ]);
    const approval = approveOfferHandler(
      makeRequest("/api/v1/staff/ops/offers/approve", "POST", ops.cookie, trueAttestation),
      { params: Promise.resolve({ offerId: draft.offer.id, revisionId: draft.revision.id }) }
    );
    let waiting = 0;
    let settled: PromiseSettledResult<Response>[] = [];
    try {
      waiting = await waitForBlockedRequests(blocker, 1);
      if (waiting === 1) {
        await blocker.query(
          "UPDATE provider_organizations SET status = 'PAUSED', version = version + 1 WHERE id = $1",
          [draft.provider.id]
        );
      }
    } finally {
      await blocker.query("COMMIT").finally(() => blocker.end());
      settled = await Promise.allSettled([approval]);
    }
    expect(waiting).toBe(1);
    const outcome = settled[0];
    if (outcome.status === "rejected") throw outcome.reason;
    const response = outcome.value;
    expect(response.status).toBe(409);
    expect(
      (await getPrisma().offerRevision.findUniqueOrThrow({ where: { id: draft.revision.id } }))
        .status
    ).toBe("PENDING_REVIEW");
  });

  it("rolls back approval and its pointer when the real audit insert fails", async () => {
    if (!databaseAvailable)
      throw new Error("PostgreSQL integration service unavailable; start npm run db:test:up.");
    const sales = await createStaff("SALES_AGENT");
    const ops = await createStaff("OPS_SUPERVISOR");
    const draft = await createPendingOffer(sales.cookie, ops.cookie, sales.userId, ops.userId);
    const client = new pg.Client({ connectionString: TEST_DB_URL });
    const functionName = `fail_offer_audit_${crypto.randomUUID().replaceAll("-", "")}`;
    const triggerName = `fail_offer_audit_trigger_${crypto.randomUUID().replaceAll("-", "")}`;
    await client.connect();
    try {
      await client.query(
        `CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."eventType" = 'OFFER_APPROVED' THEN RAISE EXCEPTION 'test audit failure' USING ERRCODE = 'P0001'; END IF; RETURN NEW; END; $$`
      );
      await client.query(
        `CREATE TRIGGER ${triggerName} BEFORE INSERT ON security_audit_events FOR EACH ROW EXECUTE FUNCTION ${functionName}()`
      );
      const response = await approveOfferHandler(
        makeRequest("/api/v1/staff/ops/offers/approve", "POST", ops.cookie, trueAttestation),
        { params: Promise.resolve({ offerId: draft.offer.id, revisionId: draft.revision.id }) }
      );
      expect(response.status).toBe(500);
      const prisma = getPrisma();
      const revision = await prisma.offerRevision.findUniqueOrThrow({
        where: { id: draft.revision.id },
      });
      const offer = await prisma.offer.findUniqueOrThrow({ where: { id: draft.offer.id } });
      const auditCount = await prisma.securityAuditEvent.count({
        where: { eventType: "OFFER_APPROVED", targetEntity: `offer_revision:${draft.revision.id}` },
      });
      expect(revision.status).toBe("PENDING_REVIEW");
      expect(offer.currentApprovedRevisionId).toBeNull();
      expect(auditCount).toBe(0);
    } finally {
      await client
        .query(`DROP TRIGGER IF EXISTS ${triggerName} ON security_audit_events`)
        .catch(() => {});
      await client.query(`DROP FUNCTION IF EXISTS ${functionName}()`).catch(() => {});
      await client.end();
    }
  });
});
