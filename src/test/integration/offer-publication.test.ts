import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import pg from "pg";
import { NextRequest } from "next/server";
import { getPrisma, disconnectDb } from "@/lib/db";
import { resetAuth } from "@/lib/auth";
import { resetServerEnvCache } from "@/lib/env";
import { provisionStaffMember } from "@/lib/staff/provisioning";
import { getPublicOffer } from "@/lib/publication/discovery";
import { POST as createServiceHandler } from "@/app/api/v1/staff/ops/catalog/services/route";
import { POST as createOfferHandler } from "@/app/api/v1/staff/offers/route";
import { POST as submitOfferHandler } from "@/app/api/v1/staff/offers/[offerId]/revisions/[revisionId]/submit/route";
import { POST as approveOfferHandler } from "@/app/api/v1/staff/ops/offers/[offerId]/revisions/[revisionId]/approve/route";
import { POST as newRevisionHandler } from "@/app/api/v1/staff/offers/[offerId]/revisions/route";
import { PATCH as updateDraftHandler } from "@/app/api/v1/staff/offers/[offerId]/revisions/[revisionId]/route";
import {
  GET as getPublicationHandler,
  POST as commandPublicationHandler,
} from "@/app/api/v1/staff/ops/offers/[offerId]/publication/route";
import { GET as getCommandHandler } from "@/app/api/v1/staff/ops/offers/[offerId]/publication/commands/[commandId]/route";
import { GET as listPublicOffersHandler } from "@/app/api/v1/offers/route";
import { GET as getPublicOfferHandler } from "@/app/api/v1/offers/[offerId]/route";
import { PUT as setFitmentHandler } from "@/app/api/v1/staff/offers/[offerId]/revisions/[revisionId]/fitment/route";
import { POST as createPolicyHandler } from "@/app/api/v1/staff/branches/[branchId]/fitment-policies/route";
import { POST as submitPolicyHandler } from "@/app/api/v1/staff/branches/[branchId]/fitment-policies/[policyId]/submit/route";
import { POST as approvePolicyHandler } from "@/app/api/v1/staff/branches/[branchId]/fitment-policies/[policyId]/approve/route";

const TEST_DB_URL =
  process.env.DATABASE_URL ||
  "postgresql://test_user:test_password@localhost:5432/waffarhacars_test";
const TEST_SECRET = "test-secret-at-least-32-characters-long-12345";
const originalEnv = { ...process.env };
const createdEmails: string[] = [];
const createdProviderIds: string[] = [];
const createdServiceDefinitionIds: string[] = [];
const createdOfferIds: string[] = [];
let databaseAvailable = false;

function signedCookie(token: string) {
  const signature = crypto.createHmac("sha256", TEST_SECRET).update(token).digest("base64");
  return `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`;
}

function request(
  path: string,
  method: string,
  cookie?: string,
  body?: unknown,
  origin = "http://localhost:3000"
) {
  const headers = new Headers({
    "content-type": "application/json",
    "x-forwarded-for": "198.51.100.74",
  });
  if (cookie) headers.set("cookie", cookie);
  if (method !== "GET") headers.set("origin", origin);
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function setPublicationConfig(enabled: boolean, cluster?: string, evidenceReady = true) {
  process.env.OFFER_PUBLICATION_ENABLED = String(enabled);
  if (cluster) process.env.OFFER_PUBLICATION_PILOT_CLUSTER = cluster;
  else delete process.env.OFFER_PUBLICATION_PILOT_CLUSTER;
  process.env.OFFER_EVIDENCE_PACKET_REPOSITORY_READY = String(evidenceReady);
  resetServerEnvCache();
}

async function createStaff(role: "SALES_AGENT" | "OPS_SUPERVISOR" | "FINANCE_OFFICER") {
  const prisma = getPrisma();
  const uid = crypto.randomUUID().slice(0, 10);
  if ((await prisma.internalStaffMembership.count()) === 0) {
    const email = `publication-bootstrap-${uid}@test.eg`;
    createdEmails.push(email);
    await provisionStaffMember({
      email,
      password: "ValidStaffPassword123!",
      fullName: "Publication Test Bootstrap Admin",
      employeeNumber: `PBOOT-${uid}`,
      department: "ADMIN",
      isBootstrap: true,
    });
  }
  const department =
    role === "SALES_AGENT" ? "SALES" : role === "OPS_SUPERVISOR" ? "OPERATIONS" : "FINANCE";
  const email = `publication-${role.toLowerCase()}-${uid}@test.eg`;
  createdEmails.push(email);
  const provisioned = await provisionStaffMember({
    email,
    password: "ValidStaffPassword123!",
    fullName: `Publication Test ${role}`,
    employeeNumber: `PUB-${uid}`,
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
  const token = `publication-session-${crypto.randomUUID()}`;
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
      nameEn: "Synthetic publication provider",
      nameAr: "مركز اختبار النشر",
      legalName: "Synthetic publication legal name",
      taxRegistrationNumber: `${Math.floor(100000000 + Math.random() * 900000000)}`,
      commercialRegistrationNumber: `PUB-CR-${uid}`,
      primaryCluster: "NASR_CITY_HELIOPOLIS",
      status: "ACTIVE",
      version: 1,
      contactPersonName: "Synthetic Contact",
      contactEmail: `publication-${uid}@test.eg`,
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
      branchCode: `PUB-${uid}`,
      nameEn: "Synthetic publication branch",
      nameAr: "فرع اختبار النشر",
      cluster: "NASR_CITY_HELIOPOLIS",
      streetAddressEn: "Synthetic test street",
      streetAddressAr: "شارع اختباري",
      latitude: "30.061200",
      longitude: "31.341100",
      contactPhone: "+201011112222",
      operatingHours: [{ dayOfWeek: 1, openTime: "09:00", closeTime: "17:00", isClosed: false }],
      status: "ACTIVE",
      version: 2,
      legalIdentityChecked: true,
      physicalLocationChecked: true,
      contactAndHoursChecked: true,
      evidenceDocumentRef: `PUB-BR-${uid}`,
      vettedByUserId: opsUserId,
      vettedAt: new Date(),
    },
  });
  return { provider, branch };
}

async function createService(opsCookie: string, pricingMode = "FIXED_SCOPE") {
  const prisma = getPrisma();
  const category = await prisma.serviceCategory.findUniqueOrThrow({
    where: { code: "EXPRESS_MAINTENANCE" },
  });
  const uid = crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
  const response = await createServiceHandler(
    request("/api/v1/staff/ops/catalog/services", "POST", opsCookie, {
      code: `PUB_SERVICE_${uid}`,
      categoryId: category.id,
      nameEn: `Synthetic service ${uid}`,
      nameAr: `خدمة اختبار ${uid}`,
      scopeEn: "Defined fixed-scope express maintenance",
      scopeAr: "صيانة سريعة محددة النطاق",
      pricingMode,
    })
  );
  expect(response.status).toBe(201);
  const data = await response.json();
  createdServiceDefinitionIds.push(data.id);
  return { category, service: data };
}

function offerInput(providerOrganizationId: string, branchId: string, serviceDefinitionId: string) {
  return {
    creationRequestId: crypto.randomUUID(),
    revisionRequestId: crypto.randomUUID(),
    providerOrganizationId,
    branchId,
    serviceDefinitionId,
    fields: {
      titleEn: "Synthetic express oil service",
      titleAr: "خدمة زيت سريعة اختبارية",
      includedLaborEn: "Oil drain and refill",
      includedLaborAr: "تصريف الزيت وإعادة التعبئة",
      includedPartsEn: "One oil filter and oil",
      includedPartsAr: "فلتر زيت وزيت",
      excludedLaborEn: "Engine diagnostics",
      excludedLaborAr: "فحص المحرك",
      excludedPartsEn: "Premium parts",
      excludedPartsAr: "قطع مميزة",
      bookingRule: "APPOINTMENT_REQUIRED",
      durationMinutes: 45,
      validFrom: new Date(Date.now() - 60 * 60_000).toISOString(),
      validUntil: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
      normalPriceMinor: "100000",
      customerPriceMinor: "80000",
      evidencePacketId: "PUB-PRICE-001",
      evidenceType: "PROVIDER_PRICE_LIST",
      evidenceDate: new Date(Date.now() - 24 * 60 * 60_000).toISOString(),
      priceBasisNotes: "Synthetic price-list evidence",
      commercialTermsPacketId: "PUB-TERMS-001",
      commercialTermsAgreedAt: new Date(Date.now() - 24 * 60 * 60_000).toISOString(),
      commissionBasis: "DISCOUNTED_CUSTOMER_PRICE",
      commissionRateBps: 0,
    },
  };
}

async function createReviewedSyntheticCoverage(
  branchId: string,
  categoryId: string,
  salesCookie: string,
  opsCookie: string
) {
  const db = getPrisma();
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  const make = await db.vehicleMake.create({
    data: {
      code: `PUB_FIT_${suffix}`,
      nameEn: "Synthetic publication make",
      nameAr: "ماركة نشر اختبارية",
      evidenceRef: "CI:PUBLICATION:MAKE",
    },
  });
  const model = await db.vehicleModel.create({
    data: {
      makeId: make.id,
      code: "ALL_VARIANTS_TEST",
      nameEn: "Synthetic all-variant model",
      nameAr: "طراز نشر اختباري",
      evidenceRef: "CI:PUBLICATION:MODEL",
    },
  });
  const coverage = [{ makeId: make.id, modelId: model.id, yearFrom: 2020, yearTo: 2024 }];
  const base = `/api/v1/staff/branches/${branchId}/fitment-policies`;
  const create = await createPolicyHandler(
    request(base, "POST", salesCookie, {
      commandId: crypto.randomUUID(),
      categoryId,
      evidenceRef: "CI:PUBLICATION:PROVIDER_CAPABILITY",
      coverage,
    }),
    { params: Promise.resolve({ branchId }) }
  );
  expect(create.status).toBe(201);
  const policyId = (await create.json()).command.policyId as string;
  const submit = await submitPolicyHandler(
    request(`${base}/${policyId}/submit`, "POST", salesCookie, {
      commandId: crypto.randomUUID(),
      expectedVersion: 1,
    }),
    { params: Promise.resolve({ branchId, policyId }) }
  );
  expect(submit.status).toBe(200);
  const approve = await approvePolicyHandler(
    request(`${base}/${policyId}/approve`, "POST", opsCookie, {
      commandId: crypto.randomUUID(),
      expectedVersion: 2,
      attested: true,
    }),
    { params: Promise.resolve({ branchId, policyId }) }
  );
  expect(approve.status).toBe(200);
  return coverage;
}

async function createApprovedFixture() {
  const sales = await createStaff("SALES_AGENT");
  const ops = await createStaff("OPS_SUPERVISOR");
  const { provider, branch } = await createProviderAndBranch(sales.userId, ops.userId);
  const { category, service } = await createService(ops.cookie);
  const coverage = await createReviewedSyntheticCoverage(
    branch.id,
    category.id,
    sales.cookie,
    ops.cookie
  );
  const payload = offerInput(provider.id, branch.id, service.id);
  const create = await createOfferHandler(
    request("/api/v1/staff/offers", "POST", sales.cookie, payload)
  );
  expect(create.status).toBe(201);
  const created = await create.json();
  createdOfferIds.push(created.offer.id);
  const offerId = created.offer.id as string;
  const revisionId = created.revision.id as string;
  const fitment = await setFitmentHandler(
    request(
      `/api/v1/staff/offers/${offerId}/revisions/${revisionId}/fitment`,
      "PUT",
      sales.cookie,
      {
        commandId: crypto.randomUUID(),
        expectedVersion: 1,
        mode: "BASE_VEHICLE_ALL_VARIANTS_VERIFIED",
        evidenceRef: "CI:PUBLICATION:ALL_VARIANTS",
        coverage,
      }
    ),
    { params: Promise.resolve({ offerId, revisionId }) }
  );
  expect(fitment.status).toBe(200);
  const submit = await submitOfferHandler(
    request(
      `/api/v1/staff/offers/${offerId}/revisions/${revisionId}/submit`,
      "POST",
      sales.cookie,
      {
        expectedVersion: 2,
      }
    ),
    { params: Promise.resolve({ offerId, revisionId }) }
  );
  expect(submit.status).toBe(200);
  const approve = await approveOfferHandler(
    request(
      `/api/v1/staff/ops/offers/${offerId}/revisions/${revisionId}/approve`,
      "POST",
      ops.cookie,
      {
        expectedVersion: 3,
        evidenceInspected: true,
        priceVerified: true,
        scopeVerified: true,
        providerConsentVerified: true,
        fitmentAllVariantsAttested: true,
        fitmentScopePriceAttested: true,
      }
    ),
    { params: Promise.resolve({ offerId, revisionId }) }
  );
  expect(approve.status).toBe(200);
  return {
    sales,
    ops,
    provider,
    branch,
    category,
    service,
    offerId,
    revisionId,
    payload,
    coverage,
  };
}

async function createPendingSuccessor(
  fixture: Awaited<ReturnType<typeof createApprovedFixture>>,
  customerPriceMinor: string
) {
  const create = await newRevisionHandler(
    request(`/api/v1/staff/offers/${fixture.offerId}/revisions`, "POST", fixture.sales.cookie, {
      requestId: crypto.randomUUID(),
    }),
    { params: Promise.resolve({ offerId: fixture.offerId }) }
  );
  expect(create.status).toBe(201);
  const draft = await create.json();
  const revisionId = draft.id as string;
  const update = await updateDraftHandler(
    request(
      `/api/v1/staff/offers/${fixture.offerId}/revisions/${revisionId}`,
      "PATCH",
      fixture.sales.cookie,
      {
        expectedVersion: 1,
        fields: { ...fixture.payload.fields, customerPriceMinor },
      }
    ),
    { params: Promise.resolve({ offerId: fixture.offerId, revisionId }) }
  );
  expect(update.status).toBe(200);
  const submit = await submitOfferHandler(
    request(
      `/api/v1/staff/offers/${fixture.offerId}/revisions/${revisionId}/submit`,
      "POST",
      fixture.sales.cookie,
      { expectedVersion: 2 }
    ),
    { params: Promise.resolve({ offerId: fixture.offerId, revisionId }) }
  );
  expect(submit.status).toBe(200);
  return revisionId;
}

async function approveSuccessor(
  fixture: Awaited<ReturnType<typeof createApprovedFixture>>,
  customerPriceMinor: string
) {
  const revisionId = await createPendingSuccessor(fixture, customerPriceMinor);
  const approve = await approveOfferHandler(
    request(
      `/api/v1/staff/ops/offers/${fixture.offerId}/revisions/${revisionId}/approve`,
      "POST",
      fixture.ops.cookie,
      {
        expectedVersion: 3,
        evidenceInspected: true,
        priceVerified: true,
        scopeVerified: true,
        providerConsentVerified: true,
        fitmentAllVariantsAttested: true,
        fitmentScopePriceAttested: true,
      }
    ),
    { params: Promise.resolve({ offerId: fixture.offerId, revisionId }) }
  );
  expect(approve.status).toBe(200);
  return revisionId;
}

function publicationPath(offerId: string) {
  return `/api/v1/staff/ops/offers/${offerId}/publication`;
}

async function command(
  offerId: string,
  cookie: string | undefined,
  action: "PUBLISH" | "REPLACE" | "UNPUBLISH",
  expectedVersion: number,
  revisionId?: string,
  commandId = crypto.randomUUID()
) {
  const response = await commandPublicationHandler(
    request(publicationPath(offerId), "POST", cookie, {
      commandId,
      action,
      expectedVersion,
      ...(revisionId ? { revisionId } : {}),
    }),
    { params: Promise.resolve({ offerId }) }
  );
  return { response, data: await response.json(), commandId };
}

async function getPublication(offerId: string, cookie: string) {
  const response = await getPublicationHandler(request(publicationPath(offerId), "GET", cookie), {
    params: Promise.resolve({ offerId }),
  });
  return { response, data: await response.json() };
}

async function publicList(query = "") {
  const response = await listPublicOffersHandler(request(`/api/v1/offers${query}`, "GET"));
  return { response, data: await response.json() };
}

async function publicDetail(offerId: string) {
  const response = await getPublicOfferHandler(request(`/api/v1/offers/${offerId}`, "GET"), {
    params: Promise.resolve({ offerId }),
  });
  return { response, data: await response.json() };
}

async function allVisibleOfferIds() {
  const ids = new Set<string>();
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
    const page = await publicList(
      cursor ? `?limit=20&cursor=${encodeURIComponent(cursor)}` : "?limit=20"
    );
    expect(page.response.status).toBe(200);
    for (const item of page.data.items as Array<{ offerId: string }>) ids.add(item.offerId);
    if (!page.data.nextCursor) return ids;
    cursor = page.data.nextCursor;
  }
  throw new Error("Public discovery cursor traversal exceeded the test safety bound");
}

async function assertHidden(offerId: string) {
  const list = await publicList();
  const detail = await publicDetail(offerId);
  expect(list.response.status).toBe(200);
  expect((await allVisibleOfferIds()).has(offerId)).toBe(false);
  expect(detail.response.status).toBe(404);
  expect(list.response.headers.get("cache-control")).toContain("no-store");
  expect(detail.response.headers.get("cache-control")).toContain("no-store");
}

async function assertVisible(offerId: string) {
  const list = await publicList();
  const detail = await publicDetail(offerId);
  expect(list.response.status).toBe(200);
  expect((await allVisibleOfferIds()).has(offerId)).toBe(true);
  expect(detail.response.status).toBe(200);
}

async function waitForBlockedRequests(blocker: pg.Client, expected: number): Promise<number> {
  const blockerPid = (await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid"))
    .rows[0].pid;
  const observer = new pg.Client({ connectionString: TEST_DB_URL });
  await observer.connect();
  const deadline = Date.now() + 5000;
  let waiting = 0;
  try {
    while (Date.now() < deadline && waiting < expected) {
      const result = await observer.query<{ count: number }>(
        `WITH RECURSIVE blocked(pid) AS (
          SELECT pid FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))
          UNION
          SELECT activity.pid FROM pg_stat_activity activity
          JOIN blocked ON blocked.pid = ANY(pg_blocking_pids(activity.pid))
        ) SELECT count(*)::int AS count FROM blocked`,
        [blockerPid]
      );
      waiting = result.rows[0]?.count ?? 0;
      if (waiting < expected) await new Promise((resolve) => setTimeout(resolve, 20));
    }
  } finally {
    await observer.end();
  }
  return waiting;
}

describe("Published offer routes with real PostgreSQL and resolved staff sessions", () => {
  beforeAll(async () => {
    const probe = new pg.Client({ connectionString: TEST_DB_URL, connectionTimeoutMillis: 3000 });
    try {
      await probe.connect();
      databaseAvailable = (await probe.query("SELECT 1 AS probe")).rows[0]?.probe === 1;
    } catch {
      databaseAvailable = false;
    } finally {
      await probe.end().catch(() => {});
    }
  });

  beforeEach(() => {
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
    setPublicationConfig(true, "NASR_CITY_HELIOPOLIS");
    resetAuth();
  });

  afterEach(async () => {
    // Reviewed fitment and capability rows cannot be deleted without defeating
    // production DB invariants. Fixtures are unique and this suite runs only
    // against a disposable integration DB destroyed after the test job.
    createdEmails.length = 0;
    createdProviderIds.length = 0;
    createdServiceDefinitionIds.length = 0;
    createdOfferIds.length = 0;
  });

  afterAll(async () => {
    process.env = originalEnv;
    await disconnectDb().catch(() => {});
  });

  it("keeps an internally approved offer hidden until explicit publish and returns only public terms", async () => {
    if (!databaseAvailable) throw new Error("PostgreSQL integration service unavailable.");
    const fixture = await createApprovedFixture();
    await assertHidden(fixture.offerId);
    const published = await command(
      fixture.offerId,
      fixture.ops.cookie,
      "PUBLISH",
      0,
      fixture.revisionId
    );
    expect(published.response.status).toBe(200);
    expect(published.data.command.outcome).toBe("APPLIED");
    expect(published.data.publication.status).toBe("PUBLISHED");
    expect(published.data.publication.pinnedRevisionId).toBe(fixture.revisionId);
    const list = await publicList("?category=EXPRESS_MAINTENANCE&cluster=NASR_CITY_HELIOPOLIS");
    const detail = await publicDetail(fixture.offerId);
    expect(list.response.status).toBe(200);
    expect(JSON.stringify(list.data.items)).toContain(fixture.offerId);
    expect(detail.response.status).toBe(200);
    expect(detail.response.headers.get("cache-control")).toContain("no-store");
    expect(Object.keys(detail.data).sort()).toEqual(
      [
        "offerId",
        "revisionId",
        "provider",
        "branch",
        "category",
        "service",
        "titleEn",
        "titleAr",
        "includedLaborEn",
        "includedLaborAr",
        "includedPartsEn",
        "includedPartsAr",
        "excludedLaborEn",
        "excludedLaborAr",
        "excludedPartsEn",
        "excludedPartsAr",
        "bookingRule",
        "durationMinutes",
        "validFrom",
        "validUntil",
        "normalPriceMinor",
        "customerPriceMinor",
        "savingsMinor",
        "discountRateBps",
      ].sort()
    );
    expect(Object.keys(detail.data.provider).sort()).toEqual(["id", "nameEn", "nameAr"].sort());
    expect(Object.keys(detail.data.branch).sort()).toEqual(
      [
        "id",
        "nameEn",
        "nameAr",
        "cluster",
        "streetAddressEn",
        "streetAddressAr",
        "landmarkEn",
        "landmarkAr",
        "latitude",
        "longitude",
        "operatingHours",
      ].sort()
    );
    expect(Object.keys(detail.data.category).sort()).toEqual(["code", "nameEn", "nameAr"].sort());
    expect(Object.keys(detail.data.service).sort()).toEqual(
      ["code", "nameEn", "nameAr", "scopeEn", "scopeAr"].sort()
    );
    expect(detail.data.offerId).toBe(fixture.offerId);
    expect(detail.data.revisionId).toBe(fixture.revisionId);
    expect(detail.data.normalPriceMinor).toBe("100000");
    expect(detail.data.customerPriceMinor).toBe("80000");
    expect(detail.data.savingsMinor).toBe("20000");
    const serialized = JSON.stringify(detail.data);
    expect(serialized).toContain(fixture.revisionId);
    expect(serialized).toContain("80000");
    expect(serialized).toContain("20000");
    for (const privateValue of [
      fixture.payload.fields.evidencePacketId,
      fixture.payload.fields.commercialTermsPacketId,
      fixture.payload.fields.priceBasisNotes,
      fixture.provider.taxRegistrationNumber,
      fixture.provider.commercialRegistrationNumber,
      fixture.sales.userId,
      fixture.ops.userId,
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
    for (const privateKey of [
      "commissionRateBps",
      "commissionBasis",
      "evidenceType",
      "requestId",
      "createdByUserId",
      "submittedByUserId",
      "decidedByUserId",
      "fingerprint",
    ]) {
      expect(serialized).not.toContain(`"${privateKey}"`);
    }
    setPublicationConfig(false);
    await assertHidden(fixture.offerId);
    const withdrawn = await command(fixture.offerId, fixture.ops.cookie, "UNPUBLISH", 1);
    expect(withdrawn.response.status).toBe(200);
    expect(withdrawn.data.publication.status).toBe("UNPUBLISHED");
  });

  it("binds command identity to the exact intent and permits only the original actor to reconcile", async () => {
    if (!databaseAvailable) throw new Error("PostgreSQL integration service unavailable.");
    const fixture = await createApprovedFixture();
    const otherOps = await createStaff("OPS_SUPERVISOR");
    const commandId = crypto.randomUUID();
    const first = await command(
      fixture.offerId,
      fixture.ops.cookie,
      "PUBLISH",
      0,
      fixture.revisionId,
      commandId
    );
    expect(first.response.status).toBe(200);
    const replay = await command(
      fixture.offerId,
      fixture.ops.cookie,
      "PUBLISH",
      0,
      fixture.revisionId,
      commandId
    );
    expect(replay.response.status).toBe(200);
    expect(replay.data.command).toEqual(first.data.command);
    const changedIntent = await command(
      fixture.offerId,
      fixture.ops.cookie,
      "UNPUBLISH",
      1,
      undefined,
      commandId
    );
    expect(changedIntent.response.status).toBe(409);
    const staleVersion = await command(fixture.offerId, fixture.ops.cookie, "UNPUBLISH", 0);
    expect(staleVersion.response.status).toBe(409);
    const noOp = await command(
      fixture.offerId,
      fixture.ops.cookie,
      "PUBLISH",
      1,
      fixture.revisionId
    );
    expect(noOp.response.status).toBe(409);
    const actual = await getPublication(fixture.offerId, fixture.ops.cookie);
    expect(actual.data.version).toBe(1);
    expect(actual.data.pinnedRevisionId).toBe(fixture.revisionId);
    const authorizedRead = await getCommandHandler(
      request(
        `${publicationPath(fixture.offerId)}/commands/${commandId}`,
        "GET",
        fixture.ops.cookie
      ),
      { params: Promise.resolve({ offerId: fixture.offerId, commandId }) }
    );
    expect(authorizedRead.status).toBe(200);
    expect((await authorizedRead.json()).command.outcome).toBe("APPLIED");
    const otherRead = await getCommandHandler(
      request(`${publicationPath(fixture.offerId)}/commands/${commandId}`, "GET", otherOps.cookie),
      { params: Promise.resolve({ offerId: fixture.offerId, commandId }) }
    );
    expect(otherRead.status).toBe(404);
  });

  it("returns the original recorded receipt on late replay without restoring a subsequently withdrawn publication", async () => {
    if (!databaseAvailable) throw new Error("PostgreSQL integration service unavailable.");
    const fixture = await createApprovedFixture();
    const commandId = crypto.randomUUID();
    const original = await command(
      fixture.offerId,
      fixture.ops.cookie,
      "PUBLISH",
      0,
      fixture.revisionId,
      commandId
    );
    expect(original.response.status).toBe(200);
    const withdrawal = await command(fixture.offerId, fixture.ops.cookie, "UNPUBLISH", 1);
    expect(withdrawal.response.status).toBe(200);
    const replay = await command(
      fixture.offerId,
      fixture.ops.cookie,
      "PUBLISH",
      0,
      fixture.revisionId,
      commandId
    );
    expect(replay.response.status).toBe(200);
    expect(replay.data.command).toEqual(original.data.command);
    expect(replay.data.publication.status).toBe("UNPUBLISHED");
    expect(replay.data.publication.version).toBe(2);
    await assertHidden(fixture.offerId);
    const prisma = getPrisma();
    expect(
      await prisma.offerPublicationCommand.count({ where: { offerId: fixture.offerId } })
    ).toBe(2);
    expect(
      await prisma.securityAuditEvent.count({
        where: { targetEntity: `offer:${fixture.offerId}`, eventType: "OFFER_PUBLISHED" },
      })
    ).toBe(1);
  });

  it("keeps pinned public terms unchanged after a later approval until an explicit replacement", async () => {
    if (!databaseAvailable) throw new Error("PostgreSQL integration service unavailable.");
    const fixture = await createApprovedFixture();
    const first = await command(
      fixture.offerId,
      fixture.ops.cookie,
      "PUBLISH",
      0,
      fixture.revisionId
    );
    expect(first.response.status).toBe(200);
    const successorId = await approveSuccessor(fixture, "70000");
    const before = await publicDetail(fixture.offerId);
    expect(before.response.status).toBe(200);
    expect(JSON.stringify(before.data)).toContain(fixture.revisionId);
    expect(JSON.stringify(before.data)).toContain("80000");
    expect(JSON.stringify(before.data)).not.toContain(successorId);
    const replaced = await command(fixture.offerId, fixture.ops.cookie, "REPLACE", 1, successorId);
    expect(replaced.response.status).toBe(200);
    expect(replaced.data.publication.version).toBe(2);
    expect(replaced.data.publication.pinnedRevisionId).toBe(successorId);
    const after = await publicDetail(fixture.offerId);
    expect(after.response.status).toBe(200);
    expect(JSON.stringify(after.data)).toContain(successorId);
    expect(JSON.stringify(after.data)).toContain("70000");
    expect(JSON.stringify(after.data)).not.toContain(fixture.revisionId);
  });

  it("uses the same SQL visibility predicate at exact validity boundaries", async () => {
    if (!databaseAvailable) throw new Error("PostgreSQL integration service unavailable.");
    const fixture = await createApprovedFixture();
    const published = await command(
      fixture.offerId,
      fixture.ops.cookie,
      "PUBLISH",
      0,
      fixture.revisionId
    );
    expect(published.response.status).toBe(200);
    const validFrom = new Date(fixture.payload.fields.validFrom);
    const validUntil = new Date(fixture.payload.fields.validUntil);
    expect(await getPublicOffer(fixture.offerId, new Date(validFrom.getTime() - 1))).toBeNull();
    expect(await getPublicOffer(fixture.offerId, validFrom)).not.toBeNull();
    expect(
      await getPublicOffer(fixture.offerId, new Date(validUntil.getTime() - 1))
    ).not.toBeNull();
    expect(await getPublicOffer(fixture.offerId, validUntil)).toBeNull();
    await assertVisible(fixture.offerId);
  });

  it("bounds anonymous filters and pagination without exposing hidden or duplicate offers", async () => {
    if (!databaseAvailable) throw new Error("PostgreSQL integration service unavailable.");
    const first = await createApprovedFixture();
    const second = await createApprovedFixture();
    expect(
      (await command(first.offerId, first.ops.cookie, "PUBLISH", 0, first.revisionId)).response
        .status
    ).toBe(200);
    expect(
      (await command(second.offerId, second.ops.cookie, "PUBLISH", 0, second.revisionId)).response
        .status
    ).toBe(200);
    // Earlier tests deliberately retain immutable published rows in this disposable DB.
    // Traverse the entire cursor chain instead of assuming these are the only two offers.
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
      const page = await publicList(
        cursor ? `?limit=1&cursor=${encodeURIComponent(cursor)}` : "?limit=1"
      );
      expect(page.response.status).toBe(200);
      expect(page.data.items.length).toBeLessThanOrEqual(1);
      for (const item of page.data.items) {
        expect(seen.has(item.offerId)).toBe(false);
        seen.add(item.offerId);
      }
      cursor = page.data.nextCursor;
      if (!cursor) break;
      expect(pageNumber).toBeLessThan(99);
    }
    expect(seen.has(first.offerId)).toBe(true);
    expect(seen.has(second.offerId)).toBe(true);
    for (const query of [
      "?limit=0",
      "?limit=21",
      "?limit=abc",
      "?category=NOT_A_CATEGORY",
      "?cluster=NOT_A_CAIRO_CLUSTER",
      "?cursor=not-a-real-cursor",
    ]) {
      const invalid = await publicList(query);
      expect(invalid.response.status).toBe(400);
    }
  });

  it("denies anonymous, customer, Sales, Finance, missing-MFA and revoked Operations sessions before publication mutation", async () => {
    if (!databaseAvailable) throw new Error("PostgreSQL integration service unavailable.");
    const fixture = await createApprovedFixture();
    const finance = await createStaff("FINANCE_OFFICER");
    const noMfaOps = await createStaff("OPS_SUPERVISOR");
    const prisma = getPrisma();
    await prisma.user.update({
      where: { id: noMfaOps.userId },
      data: { twoFactorEnabled: false },
    });
    const customerEmail = `publication-customer-${crypto.randomUUID()}@test.eg`;
    createdEmails.push(customerEmail);
    const customer = await prisma.user.create({
      data: { email: customerEmail, name: "Synthetic publication customer", emailVerified: true },
    });
    const customerToken = `publication-customer-${crypto.randomUUID()}`;
    await prisma.session.create({
      data: {
        userId: customer.id,
        token: customerToken,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        lastActivityAt: new Date(),
      },
    });
    const attempted = [
      { cookie: undefined, status: 401 },
      { cookie: fixture.sales.cookie, status: 403 },
      { cookie: finance.cookie, status: 403 },
      { cookie: noMfaOps.cookie, status: 403 },
      { cookie: signedCookie(customerToken), status: 403 },
    ];
    for (const actor of attempted) {
      const response = await command(
        fixture.offerId,
        actor.cookie,
        "PUBLISH",
        0,
        fixture.revisionId
      );
      expect(response.response.status).toBe(actor.status);
    }
    expect(await prisma.offerPublication.count({ where: { offerId: fixture.offerId } })).toBe(0);
    expect(
      await prisma.offerPublicationCommand.count({ where: { offerId: fixture.offerId } })
    ).toBe(0);
    await prisma.internalRoleAssignment.updateMany({
      where: { staffMembership: { userId: fixture.ops.userId } },
      data: { isActive: false },
    });
    const revoked = await command(
      fixture.offerId,
      fixture.ops.cookie,
      "PUBLISH",
      0,
      fixture.revisionId
    );
    expect(revoked.response.status).toBe(403);
    expect(await prisma.offerPublication.count({ where: { offerId: fixture.offerId } })).toBe(0);
  });

  it("rejects a cross-origin publication POST before any command or publication write", async () => {
    if (!databaseAvailable) throw new Error("PostgreSQL integration service unavailable.");
    const fixture = await createApprovedFixture();
    const response = await commandPublicationHandler(
      request(
        publicationPath(fixture.offerId),
        "POST",
        fixture.ops.cookie,
        {
          commandId: crypto.randomUUID(),
          action: "PUBLISH",
          expectedVersion: 0,
          revisionId: fixture.revisionId,
        },
        "https://malicious.example"
      ),
      { params: Promise.resolve({ offerId: fixture.offerId }) }
    );
    expect(response.status).toBe(403);
    expect(await getPrisma().offerPublication.count({ where: { offerId: fixture.offerId } })).toBe(
      0
    );
    expect(
      await getPrisma().offerPublicationCommand.count({ where: { offerId: fixture.offerId } })
    ).toBe(0);
  });

  it("rejects malformed command, identifier and filter input without domain writes", async () => {
    if (!databaseAvailable) throw new Error("PostgreSQL integration service unavailable.");
    const fixture = await createApprovedFixture();
    const malformed = [
      { commandId: crypto.randomUUID(), action: "PUBLISH", expectedVersion: 0 },
      {
        commandId: crypto.randomUUID(),
        action: "UNPUBLISH",
        expectedVersion: -1,
      },
      {
        commandId: crypto.randomUUID(),
        action: "PUBLISH",
        expectedVersion: 0,
        revisionId: fixture.revisionId,
        extra: "not allowed",
      },
    ];
    for (const body of malformed) {
      const response = await commandPublicationHandler(
        request(publicationPath(fixture.offerId), "POST", fixture.ops.cookie, body),
        { params: Promise.resolve({ offerId: fixture.offerId }) }
      );
      expect(response.status).toBe(400);
    }
    const invalidId = await commandPublicationHandler(
      request(publicationPath("not-a-uuid"), "POST", fixture.ops.cookie, {
        commandId: crypto.randomUUID(),
        action: "PUBLISH",
        expectedVersion: 0,
        revisionId: fixture.revisionId,
      }),
      { params: Promise.resolve({ offerId: "not-a-uuid" }) }
    );
    expect(invalidId.status).toBe(400);
    const publicInvalidId = await getPublicOfferHandler(
      request("/api/v1/offers/not-a-uuid", "GET"),
      { params: Promise.resolve({ offerId: "not-a-uuid" }) }
    );
    expect(publicInvalidId.status).toBe(400);
    expect(await getPrisma().offerPublication.count({ where: { offerId: fixture.offerId } })).toBe(
      0
    );
    expect(
      await getPrisma().offerPublicationCommand.count({ where: { offerId: fixture.offerId } })
    ).toBe(0);
  });

  it("database ownership constraint prevents rebinding a publishable offer to another provider's branch", async () => {
    if (!databaseAvailable) throw new Error("PostgreSQL integration service unavailable.");
    const fixture = await createApprovedFixture();
    const unrelated = await createProviderAndBranch(fixture.sales.userId, fixture.ops.userId);
    await expect(
      getPrisma().offer.update({
        where: { id: fixture.offerId },
        data: { branchId: unrelated.branch.id },
      })
    ).rejects.toThrow();
    const persisted = await getPrisma().offer.findUniqueOrThrow({
      where: { id: fixture.offerId },
    });
    expect(persisted.branchId).toBe(fixture.branch.id);
    expect(persisted.providerOrganizationId).toBe(fixture.provider.id);
    const published = await command(
      fixture.offerId,
      fixture.ops.cookie,
      "PUBLISH",
      0,
      fixture.revisionId
    );
    expect(published.response.status).toBe(200);
    const detail = await publicDetail(fixture.offerId);
    expect(detail.response.status).toBe(200);
    expect(detail.data.branch.id).toBe(fixture.branch.id);
  });

  it("hides an existing publication immediately when gate, evidence, provider, branch, service or category becomes ineligible", async () => {
    if (!databaseAvailable) throw new Error("PostgreSQL integration service unavailable.");
    const fixture = await createApprovedFixture();
    const published = await command(
      fixture.offerId,
      fixture.ops.cookie,
      "PUBLISH",
      0,
      fixture.revisionId
    );
    expect(published.response.status).toBe(200);
    await assertVisible(fixture.offerId);
    setPublicationConfig(false, "NASR_CITY_HELIOPOLIS");
    await assertHidden(fixture.offerId);
    setPublicationConfig(true);
    await assertHidden(fixture.offerId);
    setPublicationConfig(true, "NASR_CITY_HELIOPOLIS", false);
    await assertHidden(fixture.offerId);
    setPublicationConfig(true, "NASR_CITY_HELIOPOLIS");
    await assertVisible(fixture.offerId);
    const prisma = getPrisma();
    try {
      await prisma.providerOrganization.update({
        where: { id: fixture.provider.id },
        data: { status: "PAUSED" },
      });
      await assertHidden(fixture.offerId);
      await prisma.providerOrganization.update({
        where: { id: fixture.provider.id },
        data: { status: "ACTIVE" },
      });
      await assertVisible(fixture.offerId);
      await prisma.providerBranch.update({
        where: { id: fixture.branch.id },
        data: { status: "PAUSED" },
      });
      await assertHidden(fixture.offerId);
      await prisma.providerBranch.update({
        where: { id: fixture.branch.id },
        data: { status: "ACTIVE", cluster: "NEW_CAIRO" },
      });
      await assertHidden(fixture.offerId);
      await prisma.providerBranch.update({
        where: { id: fixture.branch.id },
        data: { cluster: "NASR_CITY_HELIOPOLIS" },
      });
      await assertVisible(fixture.offerId);
      await prisma.serviceDefinition.update({
        where: { id: fixture.service.id },
        data: { isActive: false },
      });
      await assertHidden(fixture.offerId);
      await prisma.serviceDefinition.update({
        where: { id: fixture.service.id },
        data: { isActive: true, pricingMode: "QUOTE_REQUIRED" },
      });
      await assertHidden(fixture.offerId);
      await prisma.serviceDefinition.update({
        where: { id: fixture.service.id },
        data: { pricingMode: "FIXED_SCOPE" },
      });
      await assertVisible(fixture.offerId);
      await prisma.serviceCategory.update({
        where: { id: fixture.category.id },
        data: { isActive: false },
      });
      await assertHidden(fixture.offerId);
    } finally {
      await prisma.serviceCategory.update({
        where: { id: fixture.category.id },
        data: { isActive: true },
      });
    }
    await assertVisible(fixture.offerId);
  });

  it("persists each independent gate and dependency refusal without publishing or claiming a transition audit", async () => {
    if (!databaseAvailable) throw new Error("PostgreSQL integration service unavailable.");
    const fixture = await createApprovedFixture();
    const prisma = getPrisma();
    const attempts: Array<{
      expected: string;
      before: () => Promise<void> | void;
      after: () => Promise<void> | void;
    }> = [
      {
        expected: "GATE_DISABLED",
        before: () => setPublicationConfig(false, "NASR_CITY_HELIOPOLIS"),
        after: () => setPublicationConfig(true, "NASR_CITY_HELIOPOLIS"),
      },
      {
        expected: "PILOT_CLUSTER_UNSET",
        before: () => setPublicationConfig(true),
        after: () => setPublicationConfig(true, "NASR_CITY_HELIOPOLIS"),
      },
      {
        expected: "PILOT_CLUSTER_UNSET",
        before: () => setPublicationConfig(true, "NOT_A_CAIRO_CLUSTER"),
        after: () => setPublicationConfig(true, "NASR_CITY_HELIOPOLIS"),
      },
      {
        expected: "EVIDENCE_REPOSITORY_UNREADY",
        before: () => setPublicationConfig(true, "NASR_CITY_HELIOPOLIS", false),
        after: () => setPublicationConfig(true, "NASR_CITY_HELIOPOLIS"),
      },
      {
        expected: "PROVIDER_INACTIVE",
        before: async () => {
          await prisma.providerOrganization.update({
            where: { id: fixture.provider.id },
            data: { status: "PAUSED" },
          });
        },
        after: async () => {
          await prisma.providerOrganization.update({
            where: { id: fixture.provider.id },
            data: { status: "ACTIVE" },
          });
        },
      },
      {
        expected: "BRANCH_INACTIVE",
        before: async () => {
          await prisma.providerBranch.update({
            where: { id: fixture.branch.id },
            data: { status: "PAUSED" },
          });
        },
        after: async () => {
          await prisma.providerBranch.update({
            where: { id: fixture.branch.id },
            data: { status: "ACTIVE" },
          });
        },
      },
      {
        expected: "BRANCH_NOT_VETTED",
        before: async () => {
          await prisma.providerBranch.update({
            where: { id: fixture.branch.id },
            data: { legalIdentityChecked: false },
          });
        },
        after: async () => {
          await prisma.providerBranch.update({
            where: { id: fixture.branch.id },
            data: { legalIdentityChecked: true },
          });
        },
      },
      {
        expected: "OUTSIDE_PILOT_CLUSTER",
        before: async () => {
          await prisma.providerBranch.update({
            where: { id: fixture.branch.id },
            data: { cluster: "NEW_CAIRO" },
          });
        },
        after: async () => {
          await prisma.providerBranch.update({
            where: { id: fixture.branch.id },
            data: { cluster: "NASR_CITY_HELIOPOLIS" },
          });
        },
      },
      {
        expected: "SERVICE_INACTIVE",
        before: async () => {
          await prisma.serviceDefinition.update({
            where: { id: fixture.service.id },
            data: { isActive: false },
          });
        },
        after: async () => {
          await prisma.serviceDefinition.update({
            where: { id: fixture.service.id },
            data: { isActive: true },
          });
        },
      },
      {
        expected: "CATEGORY_INACTIVE",
        before: async () => {
          await prisma.serviceCategory.update({
            where: { id: fixture.category.id },
            data: { isActive: false },
          });
        },
        after: async () => {
          await prisma.serviceCategory.update({
            where: { id: fixture.category.id },
            data: { isActive: true },
          });
        },
      },
      {
        expected: "QUOTE_REQUIRED",
        before: async () => {
          await prisma.serviceDefinition.update({
            where: { id: fixture.service.id },
            data: { pricingMode: "QUOTE_REQUIRED" },
          });
        },
        after: async () => {
          await prisma.serviceDefinition.update({
            where: { id: fixture.service.id },
            data: { pricingMode: "FIXED_SCOPE" },
          });
        },
      },
      {
        expected: "SERVICE_IDENTITY_CHANGED",
        before: async () => {
          await prisma.serviceDefinition.update({
            where: { id: fixture.service.id },
            data: { code: `${fixture.service.code}_CHANGED` },
          });
        },
        after: async () => {
          await prisma.serviceDefinition.update({
            where: { id: fixture.service.id },
            data: { code: fixture.service.code },
          });
        },
      },
    ];
    for (const attempt of attempts) {
      await attempt.before();
      try {
        const refused = await command(
          fixture.offerId,
          fixture.ops.cookie,
          "PUBLISH",
          0,
          fixture.revisionId
        );
        expect(refused.response.status).toBe(422);
        expect(refused.data.command.outcome).toBe("REJECTED");
        expect(refused.data.command.errorCode).toBe(attempt.expected);
        expect(await prisma.offerPublication.count({ where: { offerId: fixture.offerId } })).toBe(
          0
        );
      } finally {
        await attempt.after();
      }
    }
    expect(
      await prisma.offerPublicationCommand.count({
        where: { offerId: fixture.offerId, outcome: "REJECTED" },
      })
    ).toBe(attempts.length);
    expect(
      await prisma.securityAuditEvent.count({
        where: { eventType: "OFFER_PUBLISHED", targetEntity: `offer:${fixture.offerId}` },
      })
    ).toBe(0);
  });

  it("serializes competing initial publishes at the real PostgreSQL provider lock to one version increment", async () => {
    if (!databaseAvailable) throw new Error("PostgreSQL integration service unavailable.");
    const fixture = await createApprovedFixture();
    const secondOps = await createStaff("OPS_SUPERVISOR");
    const blocker = new pg.Client({ connectionString: TEST_DB_URL });
    await blocker.connect();
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM provider_organizations WHERE id = $1 FOR UPDATE", [
      fixture.provider.id,
    ]);
    const first = command(fixture.offerId, fixture.ops.cookie, "PUBLISH", 0, fixture.revisionId);
    const second = command(fixture.offerId, secondOps.cookie, "PUBLISH", 0, fixture.revisionId);
    let waiting = 0;
    let settled: PromiseSettledResult<Awaited<ReturnType<typeof command>>>[] = [];
    try {
      waiting = await waitForBlockedRequests(blocker, 2);
    } finally {
      await blocker.query("COMMIT").finally(() => blocker.end());
      settled = await Promise.allSettled([first, second]);
    }
    expect(waiting).toBe(2);
    const responses = settled.map((result) => {
      if (result.status === "rejected") throw result.reason;
      return result.value;
    });
    expect(responses.map((item) => item.response.status).sort()).toEqual([200, 409]);
    const persisted = await getPrisma().offerPublication.findUniqueOrThrow({
      where: { offerId: fixture.offerId },
    });
    expect(persisted.version).toBe(1);
    expect(persisted.pinnedRevisionId).toBe(fixture.revisionId);
    const commands = await getPrisma().offerPublicationCommand.findMany({
      where: { offerId: fixture.offerId },
      orderBy: { createdAt: "asc" },
    });
    expect(commands).toHaveLength(2);
    expect(commands.map((item) => item.outcome).sort()).toEqual(["APPLIED", "REJECTED"]);
  });

  it("serializes replacement versus withdrawal at one expected version without publishing a stale revision", async () => {
    if (!databaseAvailable) throw new Error("PostgreSQL integration service unavailable.");
    const fixture = await createApprovedFixture();
    expect(
      (await command(fixture.offerId, fixture.ops.cookie, "PUBLISH", 0, fixture.revisionId))
        .response.status
    ).toBe(200);
    const successorId = await approveSuccessor(fixture, "70000");
    const secondOps = await createStaff("OPS_SUPERVISOR");
    const blocker = new pg.Client({ connectionString: TEST_DB_URL });
    await blocker.connect();
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM provider_organizations WHERE id = $1 FOR UPDATE", [
      fixture.provider.id,
    ]);
    const replace = command(fixture.offerId, fixture.ops.cookie, "REPLACE", 1, successorId);
    const withdraw = command(fixture.offerId, secondOps.cookie, "UNPUBLISH", 1);
    let waiting = 0;
    let settled: PromiseSettledResult<Awaited<ReturnType<typeof command>>>[] = [];
    try {
      waiting = await waitForBlockedRequests(blocker, 2);
    } finally {
      await blocker.query("COMMIT").finally(() => blocker.end());
      settled = await Promise.allSettled([replace, withdraw]);
    }
    expect(waiting).toBe(2);
    const outcomes = settled.map((result) => {
      if (result.status === "rejected") throw result.reason;
      return result.value;
    });
    expect(outcomes.map((item) => item.response.status).sort()).toEqual([200, 409]);
    const appliedIndex = outcomes.findIndex((item) => item.response.status === 200);
    const persisted = await getPrisma().offerPublication.findUniqueOrThrow({
      where: { offerId: fixture.offerId },
    });
    expect(persisted.version).toBe(2);
    if (appliedIndex === 0) {
      expect(persisted.status).toBe("PUBLISHED");
      expect(persisted.pinnedRevisionId).toBe(successorId);
      await assertVisible(fixture.offerId);
    } else {
      expect(persisted.status).toBe("UNPUBLISHED");
      await assertHidden(fixture.offerId);
    }
    const commands = await getPrisma().offerPublicationCommand.findMany({
      where: { offerId: fixture.offerId },
    });
    expect(commands).toHaveLength(3);
    expect(commands.filter((item) => item.outcome === "APPLIED")).toHaveLength(2);
    expect(commands.filter((item) => item.outcome === "REJECTED")).toHaveLength(1);
  });

  it("serializes provider pause ahead of publication so an ineligible offer cannot be published", async () => {
    if (!databaseAvailable) throw new Error("PostgreSQL integration service unavailable.");
    const fixture = await createApprovedFixture();
    const blocker = new pg.Client({ connectionString: TEST_DB_URL });
    await blocker.connect();
    await blocker.query("BEGIN");
    await blocker.query("UPDATE provider_organizations SET status = $1 WHERE id = $2", [
      "PAUSED",
      fixture.provider.id,
    ]);
    const publish = command(fixture.offerId, fixture.ops.cookie, "PUBLISH", 0, fixture.revisionId);
    let waiting = 0;
    let settled: PromiseSettledResult<Awaited<ReturnType<typeof command>>>[] = [];
    try {
      waiting = await waitForBlockedRequests(blocker, 1);
    } finally {
      await blocker.query("COMMIT").finally(() => blocker.end());
      settled = await Promise.allSettled([publish]);
    }
    expect(waiting).toBe(1);
    const outcome = settled[0];
    if (outcome.status === "rejected") throw outcome.reason;
    expect(outcome.value.response.status).toBe(422);
    expect(await getPrisma().offerPublication.count({ where: { offerId: fixture.offerId } })).toBe(
      0
    );
    await assertHidden(fixture.offerId);
  });

  it("serializes service deactivation ahead of publication and refuses an inactive definition", async () => {
    if (!databaseAvailable) throw new Error("PostgreSQL integration service unavailable.");
    const fixture = await createApprovedFixture();
    const blocker = new pg.Client({ connectionString: TEST_DB_URL });
    await blocker.connect();
    await blocker.query("BEGIN");
    await blocker.query('UPDATE service_definitions SET "isActive" = false WHERE id = $1', [
      fixture.service.id,
    ]);
    const publish = command(fixture.offerId, fixture.ops.cookie, "PUBLISH", 0, fixture.revisionId);
    let waiting = 0;
    let settled: PromiseSettledResult<Awaited<ReturnType<typeof command>>>[] = [];
    try {
      waiting = await waitForBlockedRequests(blocker, 1);
    } finally {
      await blocker.query("COMMIT").finally(() => blocker.end());
      settled = await Promise.allSettled([publish]);
    }
    expect(waiting).toBe(1);
    const outcome = settled[0];
    if (outcome.status === "rejected") throw outcome.reason;
    expect(outcome.value.response.status).toBe(422);
    expect(outcome.value.data.command.errorCode).toBe("SERVICE_INACTIVE");
    expect(await getPrisma().offerPublication.count({ where: { offerId: fixture.offerId } })).toBe(
      0
    );
  });

  it("serializes successor approval against replacement so only a previously approved revision may become pinned", async () => {
    if (!databaseAvailable) throw new Error("PostgreSQL integration service unavailable.");
    const fixture = await createApprovedFixture();
    expect(
      (await command(fixture.offerId, fixture.ops.cookie, "PUBLISH", 0, fixture.revisionId))
        .response.status
    ).toBe(200);
    const successorId = await createPendingSuccessor(fixture, "70000");
    const blocker = new pg.Client({ connectionString: TEST_DB_URL });
    await blocker.connect();
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM provider_organizations WHERE id = $1 FOR UPDATE", [
      fixture.provider.id,
    ]);
    const approval = approveOfferHandler(
      request(
        `/api/v1/staff/ops/offers/${fixture.offerId}/revisions/${successorId}/approve`,
        "POST",
        fixture.ops.cookie,
        {
          expectedVersion: 3,
          evidenceInspected: true,
          priceVerified: true,
          scopeVerified: true,
          providerConsentVerified: true,
          fitmentAllVariantsAttested: true,
          fitmentScopePriceAttested: true,
        }
      ),
      { params: Promise.resolve({ offerId: fixture.offerId, revisionId: successorId }) }
    );
    const replacement = command(fixture.offerId, fixture.ops.cookie, "REPLACE", 1, successorId);
    let waiting = 0;
    let results:
      | [PromiseSettledResult<Response>, PromiseSettledResult<Awaited<ReturnType<typeof command>>>]
      | null = null;
    try {
      waiting = await waitForBlockedRequests(blocker, 2);
    } finally {
      await blocker.query("COMMIT").finally(() => blocker.end());
      results = await Promise.allSettled([approval, replacement]);
    }
    expect(waiting).toBe(2);
    if (!results || results[0].status === "rejected" || results[1].status === "rejected") {
      throw new Error("Concurrent route promise did not settle successfully.");
    }
    expect(results[0].value.status).toBe(200);
    expect([200, 422]).toContain(results[1].value.response.status);
    const persisted = await getPrisma().offerPublication.findUniqueOrThrow({
      where: { offerId: fixture.offerId },
    });
    if (results[1].value.response.status === 200) {
      expect(persisted.version).toBe(2);
      expect(persisted.pinnedRevisionId).toBe(successorId);
    } else {
      expect(results[1].value.data.command.errorCode).toBe("REVISION_NOT_APPROVED");
      expect(persisted.version).toBe(1);
      expect(persisted.pinnedRevisionId).toBe(fixture.revisionId);
    }
    const approved = await getPrisma().offerRevision.findUniqueOrThrow({
      where: { id: successorId },
    });
    expect(approved.status).toBe("APPROVED");
  });

  it("rolls back publication and command outcome when the real audit insert fails, then safely retries the same identity", async () => {
    if (!databaseAvailable) throw new Error("PostgreSQL integration service unavailable.");
    const fixture = await createApprovedFixture();
    const commandId = crypto.randomUUID();
    const client = new pg.Client({ connectionString: TEST_DB_URL });
    const suffix = crypto.randomUUID().replaceAll("-", "");
    const functionName = `fail_publication_audit_${suffix}`;
    const triggerName = `fail_publication_audit_trigger_${suffix}`;
    await client.connect();
    try {
      await client.query(
        `CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."eventType" = 'OFFER_PUBLISHED' THEN RAISE EXCEPTION 'test audit failure' USING ERRCODE = 'P0001'; END IF; RETURN NEW; END; $$`
      );
      await client.query(
        `CREATE TRIGGER ${triggerName} BEFORE INSERT ON security_audit_events FOR EACH ROW EXECUTE FUNCTION ${functionName}()`
      );
      const failed = await command(
        fixture.offerId,
        fixture.ops.cookie,
        "PUBLISH",
        0,
        fixture.revisionId,
        commandId
      );
      expect(failed.response.status).toBe(503);
      const prisma = getPrisma();
      expect(await prisma.offerPublication.count({ where: { offerId: fixture.offerId } })).toBe(0);
      expect(
        await prisma.offerPublicationCommand.count({ where: { offerId: fixture.offerId } })
      ).toBe(0);
      expect(
        await prisma.securityAuditEvent.count({
          where: { eventType: "OFFER_PUBLISHED", targetEntity: `offer:${fixture.offerId}` },
        })
      ).toBe(0);
      await assertHidden(fixture.offerId);
    } finally {
      await client
        .query(`DROP TRIGGER IF EXISTS ${triggerName} ON security_audit_events`)
        .catch(() => {});
      await client.query(`DROP FUNCTION IF EXISTS ${functionName}()`).catch(() => {});
      await client.end();
    }
    const retry = await command(
      fixture.offerId,
      fixture.ops.cookie,
      "PUBLISH",
      0,
      fixture.revisionId,
      commandId
    );
    expect(retry.response.status).toBe(200);
    const prisma = getPrisma();
    expect(await prisma.offerPublicationCommand.count({ where: { commandId } })).toBe(1);
    expect(
      await prisma.securityAuditEvent.count({
        where: { eventType: "OFFER_PUBLISHED", targetEntity: `offer:${fixture.offerId}` },
      })
    ).toBe(1);
  });
});
