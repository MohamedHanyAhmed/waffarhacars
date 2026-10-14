import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import pg from "pg";
import { NextRequest } from "next/server";
import { getPrisma, disconnectDb } from "@/lib/db";
import { resetAuth } from "@/lib/auth";
import { resetServerEnvCache } from "@/lib/env";
import { POST as createOfferRoute } from "@/app/api/v1/staff/offers/route";
import { PUT as setFitmentRoute } from "@/app/api/v1/staff/offers/[offerId]/revisions/[revisionId]/fitment/route";
import { GET as offerFitmentReceiptRoute } from "@/app/api/v1/staff/offers/[offerId]/revisions/[revisionId]/fitment/commands/[commandId]/route";
import { POST as submitOfferRoute } from "@/app/api/v1/staff/offers/[offerId]/revisions/[revisionId]/submit/route";
import { POST as approveOfferRoute } from "@/app/api/v1/staff/ops/offers/[offerId]/revisions/[revisionId]/approve/route";
import { POST as createPolicyRoute } from "@/app/api/v1/staff/branches/[branchId]/fitment-policies/route";
import { POST as submitPolicyRoute } from "@/app/api/v1/staff/branches/[branchId]/fitment-policies/[policyId]/submit/route";
import { POST as approvePolicyRoute } from "@/app/api/v1/staff/branches/[branchId]/fitment-policies/[policyId]/approve/route";
import { POST as withdrawPolicyRoute } from "@/app/api/v1/staff/branches/[branchId]/fitment-policies/[policyId]/withdraw/route";
import { GET as matchOfferRoute } from "@/app/api/v1/garage/[vehicleId]/offer-matches/[offerId]/route";
import { GET as publicCoverageRoute } from "@/app/api/v1/offers/[offerId]/fitment/route";
import { GET as publicOfferRoute } from "@/app/api/v1/offers/[offerId]/route";
import { POST as publicationRoute } from "@/app/api/v1/staff/ops/offers/[offerId]/publication/route";
import { PATCH as updateModelRoute } from "@/app/api/v1/staff/ops/vehicle-catalog/models/[id]/route";

const databaseUrl =
  process.env.DATABASE_URL ||
  "postgresql://test_user:test_password@localhost:5432/waffarhacars_test";
const secret = "fitment-test-secret-at-least-32-characters-long";
const originalEnv = { ...process.env };

function cookie(token: string) {
  const signature = crypto.createHmac("sha256", secret).update(token).digest("base64");
  return `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`;
}

function request(
  path: string,
  method: string,
  session?: string,
  payload?: unknown,
  origin?: string
) {
  const headers = new Headers({ "content-type": "application/json" });
  if (session) headers.set("cookie", session);
  if (method !== "GET") headers.set("origin", origin ?? "http://localhost:3000");
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers,
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
}

async function identity(role: "SALES_AGENT" | "OPS_SUPERVISOR" | "CUSTOMER") {
  const db = getPrisma();
  const user = await db.user.create({
    data: {
      name: `Synthetic fitment ${role}`,
      email: `fitment-${crypto.randomUUID()}@test.eg`,
      ...(role === "CUSTOMER"
        ? {
            phoneNumber: `+2010${crypto.randomInt(10_000_000, 100_000_000)}`,
            phoneNumberVerified: true,
          }
        : { twoFactorEnabled: true }),
    },
  });
  if (role === "CUSTOMER") {
    await db.customerProfile.create({ data: { userId: user.id } });
  } else {
    const membership = await db.internalStaffMembership.create({
      data: {
        userId: user.id,
        employeeNumber: `F${crypto.randomUUID().slice(0, 12)}`,
        department: role === "SALES_AGENT" ? "SALES" : "OPERATIONS",
        isActive: true,
        mustChangePassword: false,
      },
    });
    await db.internalRoleAssignment.create({
      data: { staffMembershipId: membership.id, role, isActive: true },
    });
    await db.twoFactor.create({
      data: { userId: user.id, secret: "JBSWY3DPEHPK3PXP", backupCodes: "[]", verified: true },
    });
  }
  const token = `fitment-${crypto.randomUUID()}`;
  await db.session.create({
    data: {
      userId: user.id,
      token,
      expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
      lastActivityAt: new Date(),
    },
  });
  return { id: user.id, session: cookie(token) };
}

type Identity = Awaited<ReturnType<typeof identity>>;
type Coverage = { makeId: string; modelId: string; yearFrom: number; yearTo: number };
type Fixture = {
  sales: Identity;
  ops: Identity;
  customer: Identity;
  foreignCustomer: Identity;
  providerId: string;
  branchId: string;
  categoryId: string;
  serviceId: string;
  offerId: string;
  revisionId: string;
  makeId: string;
  modelId: string;
  otherModelId: string;
  vehicleId: string;
  foreignVehicleId: string;
  coverage: Coverage[];
};

async function fixture(): Promise<Fixture> {
  const db = getPrisma();
  const sales = await identity("SALES_AGENT");
  const ops = await identity("OPS_SUPERVISOR");
  const customer = await identity("CUSTOMER");
  const foreignCustomer = await identity("CUSTOMER");
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  const provider = await db.providerOrganization.create({
    data: {
      nameEn: "Synthetic fitment provider",
      nameAr: "مركز توافق اختباري",
      legalName: "Synthetic fitment legal name",
      taxRegistrationNumber: `${Math.floor(100000000 + Math.random() * 900000000)}`,
      commercialRegistrationNumber: `FIT-${suffix}`,
      primaryCluster: "NASR_CITY_HELIOPOLIS",
      status: "ACTIVE",
      version: 1,
      contactPersonName: "Synthetic Contact",
      contactEmail: `fitment-${suffix}@test.eg`,
      contactPhone: "+201011112222",
      createdByUserId: sales.id,
      activatedByUserId: ops.id,
      activatedAt: new Date(),
    },
  });
  const branch = await db.providerBranch.create({
    data: {
      providerOrganizationId: provider.id,
      branchCode: `FIT-${suffix}`,
      nameEn: "Synthetic fitment branch",
      nameAr: "فرع توافق اختباري",
      cluster: "NASR_CITY_HELIOPOLIS",
      streetAddressEn: "Synthetic test street",
      streetAddressAr: "شارع اختباري",
      latitude: "30.061200",
      longitude: "31.341100",
      contactPhone: "+201011112222",
      operatingHours: [{ day: "monday", open: "09:00", close: "17:00" }],
      status: "ACTIVE",
      version: 2,
      legalIdentityChecked: true,
      physicalLocationChecked: true,
      contactAndHoursChecked: true,
      evidenceDocumentRef: `FIT-BR-${suffix}`,
      vettedByUserId: ops.id,
      vettedAt: new Date(),
    },
  });
  const category = await db.serviceCategory.findUniqueOrThrow({
    where: { code: "EXPRESS_MAINTENANCE" },
  });
  const service = await db.serviceDefinition.create({
    data: {
      code: `FIT_SERVICE_${suffix}`,
      categoryId: category.id,
      nameEn: "Synthetic fixed-scope service",
      nameAr: "خدمة ثابتة اختبارية",
      scopeEn: "Same fixed scope and parts for every tested base-vehicle variant",
      scopeAr: "نفس النطاق والأجزاء لكل الفئات المختبرة",
      pricingMode: "FIXED_SCOPE",
      createdByUserId: ops.id,
      updatedByUserId: ops.id,
    },
  });
  const make = await db.vehicleMake.create({
    data: {
      code: `FIT_${suffix}`,
      nameEn: "Synthetic make",
      nameAr: "ماركة اختبارية",
      evidenceRef: "CI:FITMENT:MAKE",
    },
  });
  const model = await db.vehicleModel.create({
    data: {
      makeId: make.id,
      code: "MODEL_A",
      nameEn: "Synthetic model A",
      nameAr: "طراز أ اختباري",
      evidenceRef: "CI:FITMENT:MODEL_A",
    },
  });
  const otherModel = await db.vehicleModel.create({
    data: {
      makeId: make.id,
      code: "MODEL_B",
      nameEn: "Synthetic model B",
      nameAr: "طراز ب اختباري",
      evidenceRef: "CI:FITMENT:MODEL_B",
    },
  });
  const profile = await db.customerProfile.findUniqueOrThrow({ where: { userId: customer.id } });
  const foreignProfile = await db.customerProfile.findUniqueOrThrow({
    where: { userId: foreignCustomer.id },
  });
  const vehicle = await db.customerVehicle.create({
    data: {
      ownerUserId: customer.id,
      customerProfileId: profile.id,
      makeId: make.id,
      modelId: model.id,
      modelYear: 2022,
    },
  });
  const foreignVehicle = await db.customerVehicle.create({
    data: {
      ownerUserId: foreignCustomer.id,
      customerProfileId: foreignProfile.id,
      makeId: make.id,
      modelId: model.id,
      modelYear: 2022,
    },
  });
  const now = Date.now();
  const create = await createOfferRoute(
    request("/api/v1/staff/offers", "POST", sales.session, {
      creationRequestId: crypto.randomUUID(),
      revisionRequestId: crypto.randomUUID(),
      providerOrganizationId: provider.id,
      branchId: branch.id,
      serviceDefinitionId: service.id,
      fields: {
        titleEn: "Synthetic fixed-scope offer",
        titleAr: "عرض ثابت النطاق اختباري",
        includedLaborEn: "One bounded service",
        includedLaborAr: "خدمة واحدة محددة",
        includedPartsEn: "Same parts for all attested variants",
        includedPartsAr: "نفس الأجزاء لكل الفئات المثبتة",
        excludedLaborEn: "Diagnostics",
        excludedLaborAr: "فحص",
        excludedPartsEn: "Other parts",
        excludedPartsAr: "أجزاء أخرى",
        bookingRule: "APPOINTMENT_REQUIRED",
        durationMinutes: 45,
        validFrom: new Date(now - 60 * 60_000).toISOString(),
        validUntil: new Date(now + 30 * 24 * 60 * 60_000).toISOString(),
        normalPriceMinor: "100000",
        customerPriceMinor: "80000",
        evidencePacketId: "FIT-PRICE-001",
        evidenceType: "PROVIDER_PRICE_LIST",
        evidenceDate: new Date(now - 24 * 60 * 60_000).toISOString(),
        priceBasisNotes: "Synthetic price evidence",
        commercialTermsPacketId: "FIT-TERMS-001",
        commercialTermsAgreedAt: new Date(now - 24 * 60 * 60_000).toISOString(),
        commissionBasis: "DISCOUNTED_CUSTOMER_PRICE",
        commissionRateBps: 0,
      },
    })
  );
  expect(create.status).toBe(201);
  const created = await create.json();
  return {
    sales,
    ops,
    customer,
    foreignCustomer,
    providerId: provider.id,
    branchId: branch.id,
    categoryId: category.id,
    serviceId: service.id,
    offerId: created.offer.id,
    revisionId: created.revision.id,
    makeId: make.id,
    modelId: model.id,
    otherModelId: otherModel.id,
    vehicleId: vehicle.id,
    foreignVehicleId: foreignVehicle.id,
    coverage: [{ makeId: make.id, modelId: model.id, yearFrom: 2020, yearTo: 2024 }],
  };
}

function offerContext(f: Fixture) {
  return { params: Promise.resolve({ offerId: f.offerId, revisionId: f.revisionId }) };
}

function policyContext(f: Fixture, policyId: string) {
  return { params: Promise.resolve({ branchId: f.branchId, policyId }) };
}

async function setFitment(
  f: Fixture,
  overrides: Record<string, unknown> = {},
  commandId = crypto.randomUUID()
) {
  return setFitmentRoute(
    request(
      `/api/v1/staff/offers/${f.offerId}/revisions/${f.revisionId}/fitment`,
      "PUT",
      f.sales.session,
      {
        commandId,
        expectedVersion: 1,
        mode: "BASE_VEHICLE_ALL_VARIANTS_VERIFIED",
        evidenceRef: "CI:PROVIDER:ALL_VARIANTS:001",
        coverage: f.coverage,
        ...overrides,
      }
    ),
    offerContext(f)
  );
}

async function createPolicy(f: Fixture, coverage = f.coverage, commandId = crypto.randomUUID()) {
  const response = await createPolicyRoute(
    request(`/api/v1/staff/branches/${f.branchId}/fitment-policies`, "POST", f.sales.session, {
      commandId,
      categoryId: f.categoryId,
      evidenceRef: "CI:PROVIDER:BRANCH_CAPABILITY:001",
      coverage,
    }),
    { params: Promise.resolve({ branchId: f.branchId }) }
  );
  expect(response.status).toBe(201);
  const data = await response.json();
  const policyId = data.command?.policyId;
  expect(policyId).toEqual(expect.any(String));
  return { policyId: policyId as string, commandId };
}

async function activatePolicy(f: Fixture, policyId: string) {
  const submit = await submitPolicyRoute(
    request(
      `/api/v1/staff/branches/${f.branchId}/fitment-policies/${policyId}/submit`,
      "POST",
      f.sales.session,
      { commandId: crypto.randomUUID(), expectedVersion: 1 }
    ),
    policyContext(f, policyId)
  );
  expect(submit.status).toBe(200);
  const approve = await approvePolicyRoute(
    request(
      `/api/v1/staff/branches/${f.branchId}/fitment-policies/${policyId}/approve`,
      "POST",
      f.ops.session,
      { commandId: crypto.randomUUID(), expectedVersion: 2, attested: true }
    ),
    policyContext(f, policyId)
  );
  expect(approve.status).toBe(200);
}

async function approveOffer(f: Fixture) {
  const fitment = await setFitment(f);
  expect(fitment.status).toBe(200);
  const submit = await submitOfferRoute(
    request(
      `/api/v1/staff/offers/${f.offerId}/revisions/${f.revisionId}/submit`,
      "POST",
      f.sales.session,
      { expectedVersion: 2 }
    ),
    offerContext(f)
  );
  expect(submit.status).toBe(200);
  const approval = await approveOfferRoute(
    request(
      `/api/v1/staff/ops/offers/${f.offerId}/revisions/${f.revisionId}/approve`,
      "POST",
      f.ops.session,
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
    offerContext(f)
  );
  expect(approval.status).toBe(200);
}

async function publish(f: Fixture) {
  const response = await publicationRoute(
    request(`/api/v1/staff/ops/offers/${f.offerId}/publication`, "POST", f.ops.session, {
      commandId: crypto.randomUUID(),
      action: "PUBLISH",
      expectedVersion: 0,
      revisionId: f.revisionId,
    }),
    { params: Promise.resolve({ offerId: f.offerId }) }
  );
  expect(response.status).toBe(200);
}

async function match(f: Fixture, vehicleId = f.vehicleId, session = f.customer.session) {
  const response = await matchOfferRoute(
    request(`/api/v1/garage/${vehicleId}/offer-matches/${f.offerId}`, "GET", session),
    { params: Promise.resolve({ vehicleId, offerId: f.offerId }) }
  );
  return { response, data: await response.json() };
}

async function addVehicle(f: Fixture, modelId: string, modelYear: number) {
  const db = getPrisma();
  const profile = await db.customerProfile.findUniqueOrThrow({ where: { userId: f.customer.id } });
  return db.customerVehicle.create({
    data: {
      ownerUserId: f.customer.id,
      customerProfileId: profile.id,
      makeId: f.makeId,
      modelId,
      modelYear,
    },
  });
}

// The observer runs autocommit queries. A blocker transaction cannot reliably
// observe fresh pg_stat_activity waiters from its own cached statistics snapshot.
async function waitForBlocked(blockerPid: number, expected: number) {
  const observer = new pg.Client({ connectionString: databaseUrl });
  await observer.connect();
  try {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const result = await observer.query<{ count: number }>(
        `WITH RECURSIVE blocked(pid) AS (
           SELECT pid FROM pg_stat_activity WHERE $1::integer = ANY(pg_blocking_pids(pid))
           UNION
           SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid = ANY(pg_blocking_pids(a.pid))
         ) SELECT count(*)::int AS count FROM blocked`,
        [blockerPid]
      );
      if (result.rows[0].count >= expected) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Expected ${expected} relevant blocked transaction(s)`);
  } finally {
    await observer.end();
  }
}

async function orderedProviderRace(
  providerId: string,
  first: () => Promise<Response>,
  second: () => Promise<Response>
) {
  const blocker = new pg.Client({ connectionString: databaseUrl });
  let firstResult: Promise<Response> | undefined;
  let secondResult: Promise<Response> | undefined;
  try {
    await blocker.connect();
    await blocker.query("BEGIN");
    const pid = Number((await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
    const locked = await blocker.query(
      "SELECT id FROM provider_organizations WHERE id = $1::uuid FOR UPDATE",
      [providerId]
    );
    expect(locked.rowCount).toBe(1);
    firstResult = first();
    await waitForBlocked(pid, 1);
    secondResult = second();
    await waitForBlocked(pid, 2);
    await blocker.query("COMMIT");
    return await Promise.all([firstResult, secondResult]);
  } finally {
    await blocker.query("ROLLBACK").catch(() => {});
    await blocker.end().catch(() => {});
    await Promise.allSettled([firstResult, secondResult].filter(Boolean) as Promise<Response>[]);
  }
}

describe("Verified offer fitment through real sessions, routes, and PostgreSQL", () => {
  beforeAll(async () => {
    const probe = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 3000 });
    try {
      await probe.connect();
      await probe.query("SELECT 1");
    } finally {
      await probe.end().catch(() => {});
    }
    process.env.APP_RUNTIME_PROFILE = "showcase";
    process.env.APP_DATA_BACKEND = "postgres";
    process.env.DATABASE_URL = databaseUrl;
    process.env.DATABASE_DIRECT_URL = databaseUrl;
    process.env.BETTER_AUTH_SECRET = secret;
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    process.env.OFFER_PUBLICATION_ENABLED = "true";
    process.env.OFFER_PUBLICATION_PILOT_CLUSTER = "NASR_CITY_HELIOPOLIS";
    process.env.OFFER_EVIDENCE_PACKET_REPOSITORY_READY = "true";
    resetServerEnvCache();
    resetAuth();
  });

  afterAll(async () => {
    // Submitted and approved evidence is deliberately immutable at the DB
    // boundary. This suite runs only against the disposable integration DB;
    // uniquely identified synthetic rows leave with that database.
    await disconnectDb();
    process.env = originalEnv;
    resetServerEnvCache();
    resetAuth();
  });

  it("keeps a newly created unassessed draft hidden without writing a publication", async () => {
    const f = await fixture();
    const db = getPrisma();
    const hidden = await publicOfferRoute(request(`/api/v1/offers/${f.offerId}`, "GET"), {
      params: Promise.resolve({ offerId: f.offerId }),
    });
    expect(hidden.status).toBe(404);
    const revision = await db.offerRevision.findUniqueOrThrow({ where: { id: f.revisionId } });
    expect(revision.fitmentMode).toBeNull();
    expect(await db.offerPublication.count({ where: { offerId: f.offerId } })).toBe(0);
  });

  it("accepts independently evidenced service scope only with explicit enumerated coverage", async () => {
    const f = await fixture();
    const empty = await setFitment(f, {
      mode: "SERVICE_VEHICLE_INDEPENDENT_WITHIN_LISTED_COVERAGE",
      coverage: [],
    });
    expect([400, 422]).toContain(empty.status);
    const accepted = await setFitment(f, {
      mode: "SERVICE_VEHICLE_INDEPENDENT_WITHIN_LISTED_COVERAGE",
    });
    expect(accepted.status).toBe(200);
    const revision = await getPrisma().offerRevision.findUniqueOrThrow({
      where: { id: f.revisionId },
    });
    expect(revision.fitmentMode).toBe("SERVICE_VEHICLE_INDEPENDENT_WITHIN_LISTED_COVERAGE");
    expect(
      await getPrisma().offerFitmentCoverage.count({ where: { revisionId: f.revisionId } })
    ).toBe(1);
  });

  it("replays a committed fitment edit exactly once and binds the receipt to actor, revision, and payload", async () => {
    const f = await fixture();
    const db = getPrisma();
    const commandId = crypto.randomUUID();
    const first = await setFitment(f, {}, commandId);
    expect(first.status).toBe(200);
    const auditCount = await db.securityAuditEvent.count({
      where: { actorUserId: f.sales.id, eventType: "OFFER_FITMENT_UPDATED" },
    });
    const replay = await setFitment(f, {}, commandId);
    expect(replay.status).toBe(200);
    const changed = await setFitment(f, { evidenceRef: "CI:CHANGED" }, commandId);
    expect(changed.status).toBe(409);
    const ownReceipt = await offerFitmentReceiptRoute(
      request(
        `/api/v1/staff/offers/${f.offerId}/revisions/${f.revisionId}/fitment/commands/${commandId}`,
        "GET",
        f.sales.session
      ),
      { params: Promise.resolve({ offerId: f.offerId, revisionId: f.revisionId, commandId }) }
    );
    expect(ownReceipt.status).toBe(200);
    const otherSales = await identity("SALES_AGENT");
    const foreignReceipt = await offerFitmentReceiptRoute(
      request(
        `/api/v1/staff/offers/${f.offerId}/revisions/${f.revisionId}/fitment/commands/${commandId}`,
        "GET",
        otherSales.session
      ),
      { params: Promise.resolve({ offerId: f.offerId, revisionId: f.revisionId, commandId }) }
    );
    expect(foreignReceipt.status).toBe(404);
    expect(await db.fitmentCommand.count({ where: { commandId } })).toBe(1);
    expect(await db.offerFitmentCoverage.count({ where: { revisionId: f.revisionId } })).toBe(1);
    expect(
      (await db.offerRevision.findUniqueOrThrow({ where: { id: f.revisionId } })).version
    ).toBe(2);
    expect(
      await db.securityAuditEvent.count({
        where: { actorUserId: f.sales.id, eventType: "OFFER_FITMENT_UPDATED" },
      })
    ).toBe(auditCount);
  });

  it("rejects cross-origin and oversized fitment commands without content, receipt, or audit writes", async () => {
    const f = await fixture();
    const db = getPrisma();
    const originCommandId = crypto.randomUUID();
    const badOrigin = await setFitmentRoute(
      request(
        `/api/v1/staff/offers/${f.offerId}/revisions/${f.revisionId}/fitment`,
        "PUT",
        f.sales.session,
        {
          commandId: originCommandId,
          expectedVersion: 1,
          mode: "BASE_VEHICLE_ALL_VARIANTS_VERIFIED",
          evidenceRef: "CI:PROVIDER:ALL_VARIANTS:001",
          coverage: f.coverage,
        },
        "https://attacker.example"
      ),
      offerContext(f)
    );
    expect(badOrigin.status).toBe(403);
    const oversizedCommandId = crypto.randomUUID();
    const oversized = await setFitment(f, {
      commandId: oversizedCommandId,
      extra: "x".repeat(20_000),
    });
    expect(oversized.status).toBe(400);
    expect(
      await db.fitmentCommand.count({
        where: { commandId: { in: [originCommandId, oversizedCommandId] } },
      })
    ).toBe(0);
    expect(await db.offerFitmentCoverage.count({ where: { revisionId: f.revisionId } })).toBe(0);
    expect(
      (await db.offerRevision.findUniqueOrThrow({ where: { id: f.revisionId } })).version
    ).toBe(1);
  });

  it("enforces maker-checker against a dual-role Sales creator for both offer and capability approval", async () => {
    const f = await fixture();
    const db = getPrisma();
    const policy = await createPolicy(f);
    const submittedPolicy = await submitPolicyRoute(
      request(
        `/api/v1/staff/branches/${f.branchId}/fitment-policies/${policy.policyId}/submit`,
        "POST",
        f.sales.session,
        { commandId: crypto.randomUUID(), expectedVersion: 1 }
      ),
      policyContext(f, policy.policyId)
    );
    expect(submittedPolicy.status).toBe(200);
    expect((await setFitment(f)).status).toBe(200);
    const submittedOffer = await submitOfferRoute(
      request(
        `/api/v1/staff/offers/${f.offerId}/revisions/${f.revisionId}/submit`,
        "POST",
        f.sales.session,
        { expectedVersion: 2 }
      ),
      offerContext(f)
    );
    expect(submittedOffer.status).toBe(200);
    const membership = await db.internalStaffMembership.findUniqueOrThrow({
      where: { userId: f.sales.id },
    });
    await db.internalRoleAssignment.create({
      data: { staffMembershipId: membership.id, role: "OPS_SUPERVISOR", isActive: true },
    });
    const selfPolicyApproval = await approvePolicyRoute(
      request(
        `/api/v1/staff/branches/${f.branchId}/fitment-policies/${policy.policyId}/approve`,
        "POST",
        f.sales.session,
        { commandId: crypto.randomUUID(), expectedVersion: 2, attested: true }
      ),
      policyContext(f, policy.policyId)
    );
    expect(selfPolicyApproval.status).toBe(403);
    expect((await selfPolicyApproval.json()).error).toBe("MAKER_CHECKER_CONFLICT");
    const selfOfferApproval = await approveOfferRoute(
      request(
        `/api/v1/staff/ops/offers/${f.offerId}/revisions/${f.revisionId}/approve`,
        "POST",
        f.sales.session,
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
      offerContext(f)
    );
    expect(selfOfferApproval.status).toBe(403);
    expect((await selfOfferApproval.json()).error).toBe("MAKER_CHECKER_VIOLATION");
    expect(
      (await db.branchCapabilityVersion.findUniqueOrThrow({ where: { id: policy.policyId } }))
        .status
    ).toBe("PENDING_REVIEW");
    expect((await db.offerRevision.findUniqueOrThrow({ where: { id: f.revisionId } })).status).toBe(
      "PENDING_REVIEW"
    );
    expect(await db.branchCapabilityCurrent.count({ where: { branchId: f.branchId } })).toBe(0);
    expect(
      (await db.offer.findUniqueOrThrow({ where: { id: f.offerId } })).currentApprovedRevisionId
    ).toBeNull();
  });

  it("matches only the approved pinned offer coverage intersected with active reviewed branch capability", async () => {
    const f = await fixture();
    const db = getPrisma();
    const policy = await createPolicy(f);
    await activatePolicy(f, policy.policyId);
    await approveOffer(f);
    await publish(f);
    const own = await match(f);
    expect(own.response.status).toBe(200);
    expect(own.response.headers.get("cache-control")).toContain("no-store");
    expect(own.data.data?.result ?? own.data.result).toBe("MATCH");
    expect(own.data.data?.revisionId ?? own.data.revisionId).toBe(f.revisionId);
    const coverage = await publicCoverageRoute(
      request(`/api/v1/offers/${f.offerId}/fitment`, "GET"),
      { params: Promise.resolve({ offerId: f.offerId }) }
    );
    expect(coverage.status).toBe(200);
    expect(coverage.headers.get("cache-control")).toContain("no-store");
    const publicData = await coverage.json();
    const serialized = JSON.stringify(publicData);
    expect(serialized).toContain(f.modelId);
    expect(serialized).not.toContain("CI:PROVIDER");
    expect(serialized).not.toContain(f.customer.id);
    const row = await db.offerPublication.findUniqueOrThrow({ where: { offerId: f.offerId } });
    expect(row.pinnedRevisionId).toBe(f.revisionId);
    expect(await db.offerFitmentCoverage.count({ where: { revisionId: f.revisionId } })).toBe(1);
  });

  it("returns 404 for another customer's stored vehicle and never exposes private match details", async () => {
    const f = await fixture();
    const foreign = await match(f, f.foreignVehicleId, f.customer.session);
    const missing = await match(f, crypto.randomUUID(), f.customer.session);
    const anonymous = await match(f, f.vehicleId, "");
    const staffOnly = await match(f, f.vehicleId, f.ops.session);
    expect(foreign.response.status).toBe(404);
    expect(missing.response.status).toBe(404);
    expect(anonymous.response.status).toBe(401);
    expect(staffOnly.response.status).toBe(403);
  });

  it("does not publish an approved fitment without a reviewed active branch capability", async () => {
    const f = await fixture();
    const db = getPrisma();
    await approveOffer(f);
    const attempted = await publicationRoute(
      request(`/api/v1/staff/ops/offers/${f.offerId}/publication`, "POST", f.ops.session, {
        commandId: crypto.randomUUID(),
        action: "PUBLISH",
        expectedVersion: 0,
        revisionId: f.revisionId,
      }),
      { params: Promise.resolve({ offerId: f.offerId }) }
    );
    expect([409, 422]).toContain(attempted.status);
    expect(await db.offerPublication.count({ where: { offerId: f.offerId } })).toBe(0);
    const hidden = await match(f);
    expect(hidden.response.status).toBe(404);
  });

  it("matches inclusive year endpoints and reports NO_MATCH outside verified coverage", async () => {
    const f = await fixture();
    const policy = await createPolicy(f);
    await activatePolicy(f, policy.policyId);
    await approveOffer(f);
    await publish(f);
    const low = await addVehicle(f, f.modelId, 2020);
    const high = await addVehicle(f, f.modelId, 2024);
    const outside = await addVehicle(f, f.modelId, 2019);
    const lowResult = await match(f, low.id);
    const highResult = await match(f, high.id);
    expect(lowResult.data.data?.result ?? lowResult.data.result).toBe("MATCH");
    expect(highResult.data.data?.result ?? highResult.data.result).toBe("MATCH");
    const missed = await match(f, outside.id);
    expect(missed.response.status).toBe(200);
    expect(missed.data.data?.result ?? missed.data.result).toBe("NO_MATCH");
  });

  it("returns NO_MATCH when reviewed branch capability excludes a base vehicle included by pinned offer evidence", async () => {
    const f = await fixture();
    const db = getPrisma();
    const policy = await createPolicy(f);
    await activatePolicy(f, policy.policyId);
    const broadFitment = await setFitment(f, {
      coverage: [
        ...f.coverage,
        { makeId: f.makeId, modelId: f.otherModelId, yearFrom: 2020, yearTo: 2024 },
      ],
    });
    expect(broadFitment.status).toBe(200);
    const submit = await submitOfferRoute(
      request(
        `/api/v1/staff/offers/${f.offerId}/revisions/${f.revisionId}/submit`,
        "POST",
        f.sales.session,
        { expectedVersion: 2 }
      ),
      offerContext(f)
    );
    expect(submit.status).toBe(200);
    const approval = await approveOfferRoute(
      request(
        `/api/v1/staff/ops/offers/${f.offerId}/revisions/${f.revisionId}/approve`,
        "POST",
        f.ops.session,
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
      offerContext(f)
    );
    expect(approval.status).toBe(200);
    await publish(f);
    const excludedVehicle = await addVehicle(f, f.otherModelId, 2022);
    const included = await match(f);
    const excluded = await match(f, excludedVehicle.id);
    expect(included.data.data?.result ?? included.data.result).toBe("MATCH");
    expect(excluded.response.status).toBe(200);
    expect(excluded.data.data?.result ?? excluded.data.result).toBe("NO_MATCH");
    expect(await db.offerFitmentCoverage.count({ where: { revisionId: f.revisionId } })).toBe(2);
  });

  it("returns UNKNOWN for an inactive stored model while another active covered model keeps the offer visible", async () => {
    const f = await fixture();
    const both = [
      ...f.coverage,
      { makeId: f.makeId, modelId: f.otherModelId, yearFrom: 2020, yearTo: 2024 },
    ];
    const policy = await createPolicy(f, both);
    await activatePolicy(f, policy.policyId);
    expect((await setFitment(f, { coverage: both })).status).toBe(200);
    expect(
      (
        await submitOfferRoute(
          request(
            `/api/v1/staff/offers/${f.offerId}/revisions/${f.revisionId}/submit`,
            "POST",
            f.sales.session,
            { expectedVersion: 2 }
          ),
          offerContext(f)
        )
      ).status
    ).toBe(200);
    expect(
      (
        await approveOfferRoute(
          request(
            `/api/v1/staff/ops/offers/${f.offerId}/revisions/${f.revisionId}/approve`,
            "POST",
            f.ops.session,
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
          offerContext(f)
        )
      ).status
    ).toBe(200);
    await publish(f);
    const before = await match(f);
    expect(before.data.data?.result ?? before.data.result).toBe("MATCH");
    const model = await getPrisma().vehicleModel.findUniqueOrThrow({ where: { id: f.modelId } });
    const deactivate = await updateModelRoute(
      request(`/api/v1/staff/ops/vehicle-catalog/models/${f.modelId}`, "PATCH", f.ops.session, {
        commandId: crypto.randomUUID(),
        expectedVersion: model.version,
        nameEn: model.nameEn,
        nameAr: model.nameAr,
        evidenceRef: model.evidenceRef,
        isActive: false,
      }),
      { params: Promise.resolve({ id: f.modelId }) }
    );
    expect(deactivate.status).toBe(200);
    const detail = await publicOfferRoute(request(`/api/v1/offers/${f.offerId}`, "GET"), {
      params: Promise.resolve({ offerId: f.offerId }),
    });
    expect(detail.status).toBe(200);
    const after = await match(f);
    expect(after.response.status).toBe(200);
    expect(after.data.data?.result ?? after.data.result).toBe("UNKNOWN");
    expect(
      (await getPrisma().offerPublication.findUniqueOrThrow({ where: { offerId: f.offerId } }))
        .pinnedRevisionId
    ).toBe(f.revisionId);
  });

  it("rejects overlap and invalid model-parent coverage without any fitment content, receipt, or audit", async () => {
    const f = await fixture();
    const db = getPrisma();
    const beforeAudit = await db.securityAuditEvent.count({ where: { actorUserId: f.sales.id } });
    const overlapKey = crypto.randomUUID();
    const overlap = await setFitment(
      f,
      { coverage: [...f.coverage, { ...f.coverage[0], yearFrom: 2024, yearTo: 2026 }] },
      overlapKey
    );
    expect([400, 422]).toContain(overlap.status);
    const foreignMake = await db.vehicleMake.create({
      data: {
        code: `WRONG_${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        nameEn: "Wrong make",
        nameAr: "شركة خاطئة",
        evidenceRef: "CI:WRONG_MAKE",
      },
    });
    const parentKey = crypto.randomUUID();
    const wrongParent = await setFitment(
      f,
      { coverage: [{ ...f.coverage[0], makeId: foreignMake.id }] },
      parentKey
    );
    expect([400, 422]).toContain(wrongParent.status);
    expect(await db.offerFitmentCoverage.count({ where: { revisionId: f.revisionId } })).toBe(0);
    expect(
      await db.fitmentCommand.count({ where: { commandId: { in: [overlapKey, parentKey] } } })
    ).toBe(0);
    expect(await db.securityAuditEvent.count({ where: { actorUserId: f.sales.id } })).toBe(
      beforeAudit
    );
  });

  it("database trigger rejects direct child INSERT, UPDATE, and DELETE after submission", async () => {
    const f = await fixture();
    const db = getPrisma();
    expect((await setFitment(f)).status).toBe(200);
    const submit = await submitOfferRoute(
      request(
        `/api/v1/staff/offers/${f.offerId}/revisions/${f.revisionId}/submit`,
        "POST",
        f.sales.session,
        { expectedVersion: 2 }
      ),
      offerContext(f)
    );
    expect(submit.status).toBe(200);
    const existing = await db.offerFitmentCoverage.findFirstOrThrow({
      where: { revisionId: f.revisionId },
    });
    await expect(
      db.offerFitmentCoverage.update({ where: { id: existing.id }, data: { yearTo: 2025 } })
    ).rejects.toThrow();
    await expect(db.offerFitmentCoverage.delete({ where: { id: existing.id } })).rejects.toThrow();
    await expect(
      db.offerFitmentCoverage.create({
        data: {
          revisionId: f.revisionId,
          makeId: f.makeId,
          modelId: f.otherModelId,
          yearFrom: 2020,
          yearTo: 2024,
        },
      })
    ).rejects.toThrow();
    expect(await db.offerFitmentCoverage.count({ where: { revisionId: f.revisionId } })).toBe(1);
    expect((await db.offerRevision.findUniqueOrThrow({ where: { id: f.revisionId } })).status).toBe(
      "PENDING_REVIEW"
    );
  });

  it("serializes fitment edit before submit at a relevant provider lock without duplicate content or audit", async () => {
    const f = await fixture();
    const db = getPrisma();
    const commandId = crypto.randomUUID();
    const [edit, submit] = await orderedProviderRace(
      f.providerId,
      () => setFitment(f, {}, commandId),
      () =>
        submitOfferRoute(
          request(
            `/api/v1/staff/offers/${f.offerId}/revisions/${f.revisionId}/submit`,
            "POST",
            f.sales.session,
            { expectedVersion: 1 }
          ),
          offerContext(f)
        )
    );
    expect(edit.status).toBe(200);
    expect(submit.status).toBe(409);
    const revision = await db.offerRevision.findUniqueOrThrow({ where: { id: f.revisionId } });
    expect(revision.status).toBe("DRAFT");
    expect(revision.version).toBe(2);
    expect(await db.offerFitmentCoverage.count({ where: { revisionId: f.revisionId } })).toBe(1);
    expect(await db.fitmentCommand.count({ where: { commandId } })).toBe(1);
  });

  it("serializes submit before fitment edit so a missing assessment cannot become pending by late mutation", async () => {
    const f = await fixture();
    const db = getPrisma();
    const commandId = crypto.randomUUID();
    const [submit, edit] = await orderedProviderRace(
      f.providerId,
      () =>
        submitOfferRoute(
          request(
            `/api/v1/staff/offers/${f.offerId}/revisions/${f.revisionId}/submit`,
            "POST",
            f.sales.session,
            { expectedVersion: 1 }
          ),
          offerContext(f)
        ),
      () => setFitment(f, {}, commandId)
    );
    expect(submit.status).toBe(422);
    expect(edit.status).toBe(200);
    const revision = await db.offerRevision.findUniqueOrThrow({ where: { id: f.revisionId } });
    expect(revision.status).toBe("DRAFT");
    expect(revision.version).toBe(2);
    expect(await db.offerFitmentCoverage.count({ where: { revisionId: f.revisionId } })).toBe(1);
    expect(await db.fitmentCommand.count({ where: { commandId } })).toBe(1);
  });

  it("rolls back fitment content and receipt on a real audit insertion failure, then safely retries the same key", async () => {
    const f = await fixture();
    const db = getPrisma();
    const commandId = crypto.randomUUID();
    const client = new pg.Client({ connectionString: databaseUrl });
    const suffix = crypto.randomUUID().replaceAll("-", "");
    const functionName = `fail_fitment_audit_${suffix}`;
    const triggerName = `fail_fitment_audit_trigger_${suffix}`;
    await client.connect();
    try {
      await client.query(
        `CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."eventType" = 'OFFER_FITMENT_UPDATED' AND NEW."actorUserId" = '${f.sales.id}'::uuid THEN RAISE EXCEPTION 'synthetic audit failure' USING ERRCODE = 'P0001'; END IF; RETURN NEW; END; $$`
      );
      await client.query(
        `CREATE TRIGGER ${triggerName} BEFORE INSERT ON security_audit_events FOR EACH ROW EXECUTE FUNCTION ${functionName}()`
      );
      const failed = await setFitment(f, {}, commandId);
      expect(failed.status).toBe(503);
      expect(await db.offerFitmentCoverage.count({ where: { revisionId: f.revisionId } })).toBe(0);
      expect(await db.fitmentCommand.count({ where: { commandId } })).toBe(0);
      expect(
        (await db.offerRevision.findUniqueOrThrow({ where: { id: f.revisionId } })).version
      ).toBe(1);
      expect(
        await db.securityAuditEvent.count({
          where: { actorUserId: f.sales.id, eventType: "OFFER_FITMENT_UPDATED" },
        })
      ).toBe(0);
    } finally {
      await client
        .query(`DROP TRIGGER IF EXISTS ${triggerName} ON security_audit_events`)
        .catch(() => {});
      await client.query(`DROP FUNCTION IF EXISTS ${functionName}()`).catch(() => {});
      await client.end();
    }
    const retry = await setFitment(f, {}, commandId);
    expect(retry.status).toBe(200);
    expect(await db.offerFitmentCoverage.count({ where: { revisionId: f.revisionId } })).toBe(1);
    expect(await db.fitmentCommand.count({ where: { commandId } })).toBe(1);
  });

  it("times out on the provider lock without partial fitment or receipt and accepts same-key retry", async () => {
    const f = await fixture();
    const db = getPrisma();
    const commandId = crypto.randomUUID();
    const blocker = new pg.Client({ connectionString: databaseUrl });
    await blocker.connect();
    try {
      await blocker.query("BEGIN");
      const pid = Number((await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
      const locked = await blocker.query(
        "SELECT id FROM provider_organizations WHERE id = $1::uuid FOR UPDATE",
        [f.providerId]
      );
      expect(locked.rowCount).toBe(1);
      const pending = setFitment(f, {}, commandId);
      await waitForBlocked(pid, 1);
      const timedOut = await pending;
      expect(timedOut.status).toBe(503);
      expect(await db.offerFitmentCoverage.count({ where: { revisionId: f.revisionId } })).toBe(0);
      expect(await db.fitmentCommand.count({ where: { commandId } })).toBe(0);
    } finally {
      await blocker.query("ROLLBACK").catch(() => {});
      await blocker.end();
    }
    const retry = await setFitment(f, {}, commandId);
    expect(retry.status).toBe(200);
    expect(await db.fitmentCommand.count({ where: { commandId } })).toBe(1);
  });

  it("withdrawing the active capability removes effective matching without altering pinned approved evidence", async () => {
    const f = await fixture();
    const db = getPrisma();
    const policy = await createPolicy(f);
    await activatePolicy(f, policy.policyId);
    await approveOffer(f);
    await publish(f);
    const before = await match(f);
    expect(before.data.data?.result ?? before.data.result).toBe("MATCH");
    const withdraw = await withdrawPolicyRoute(
      request(
        `/api/v1/staff/branches/${f.branchId}/fitment-policies/${policy.policyId}/withdraw`,
        "POST",
        f.ops.session,
        { commandId: crypto.randomUUID(), expectedVersion: 3 }
      ),
      policyContext(f, policy.policyId)
    );
    expect(withdraw.status).toBe(200);
    const after = await match(f);
    expect(after.response.status).toBe(404);
    const hidden = await publicOfferRoute(request(`/api/v1/offers/${f.offerId}`, "GET"), {
      params: Promise.resolve({ offerId: f.offerId }),
    });
    expect(hidden.status).toBe(404);
    const pin = await db.offerPublication.findUniqueOrThrow({ where: { offerId: f.offerId } });
    expect(pin.pinnedRevisionId).toBe(f.revisionId);
    expect(await db.offerFitmentCoverage.count({ where: { revisionId: f.revisionId } })).toBe(1);
  });

  it("database trigger prevents approved capability content drift and replacement never falls back to old coverage", async () => {
    const f = await fixture();
    const db = getPrisma();
    const first = await createPolicy(f);
    await activatePolicy(f, first.policyId);
    await approveOffer(f);
    await publish(f);
    const frozen = await db.branchCapabilityCoverage.findFirstOrThrow({
      where: { versionId: first.policyId },
    });
    await expect(
      db.branchCapabilityCoverage.update({
        where: { id: frozen.id },
        data: { yearTo: 2025 },
      })
    ).rejects.toThrow();
    await expect(
      db.branchCapabilityCoverage.delete({ where: { id: frozen.id } })
    ).rejects.toThrow();
    await expect(
      db.branchCapabilityCoverage.create({
        data: {
          versionId: first.policyId,
          makeId: f.makeId,
          modelId: f.otherModelId,
          yearFrom: 2020,
          yearTo: 2024,
        },
      })
    ).rejects.toThrow();
    const replacement = await createPolicy(f, [
      { makeId: f.makeId, modelId: f.otherModelId, yearFrom: 2020, yearTo: 2024 },
    ]);
    await activatePolicy(f, replacement.policyId);
    const pointer = await db.branchCapabilityCurrent.findUniqueOrThrow({
      where: { branchId_categoryId: { branchId: f.branchId, categoryId: f.categoryId } },
    });
    expect(pointer.activeVersionId).toBe(replacement.policyId);
    expect(
      (await db.branchCapabilityVersion.findUniqueOrThrow({ where: { id: first.policyId } })).status
    ).toBe("WITHDRAWN");
    expect(
      (await db.branchCapabilityVersion.findUniqueOrThrow({ where: { id: replacement.policyId } }))
        .status
    ).toBe("ACTIVE");
    expect((await match(f)).response.status).toBe(404);
    expect(await db.offerFitmentCoverage.count({ where: { revisionId: f.revisionId } })).toBe(1);
    expect(
      (await db.offerPublication.findUniqueOrThrow({ where: { offerId: f.offerId } }))
        .pinnedRevisionId
    ).toBe(f.revisionId);
  });
});
