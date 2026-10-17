import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import pg from "pg";
import { NextRequest } from "next/server";
import { getPrisma, disconnectDb } from "@/lib/db";
import { resetAuth } from "@/lib/auth";
import { resetServerEnvCache } from "@/lib/env";
import { GET, POST } from "@/app/api/v1/staff/branches/[branchId]/fitment-policies/route";
import { POST as submit } from "@/app/api/v1/staff/branches/[branchId]/fitment-policies/[policyId]/submit/route";
import { POST as approve } from "@/app/api/v1/staff/branches/[branchId]/fitment-policies/[policyId]/approve/route";
import { POST as reject } from "@/app/api/v1/staff/branches/[branchId]/fitment-policies/[policyId]/reject/route";

const originalEnv = { ...process.env };
const databaseUrl =
  process.env.DATABASE_URL ||
  "postgresql://test_user:test_password@localhost:5432/waffarhacars_test";
const secret = "capability-read-integration-secret-at-least-32";

async function identity(role: "SALES_AGENT" | "OPS_SUPERVISOR" | "FINANCE_OFFICER") {
  const db = getPrisma();
  const user = await db.user.create({
    data: {
      name: "Synthetic private staff",
      email: `cap-read-${crypto.randomUUID()}@test.eg`,
      twoFactorEnabled: true,
    },
  });
  const membership = await db.internalStaffMembership.create({
    data: {
      userId: user.id,
      employeeNumber: `CR${crypto.randomUUID().slice(0, 12)}`,
      department:
        role === "SALES_AGENT" ? "SALES" : role === "OPS_SUPERVISOR" ? "OPERATIONS" : "FINANCE",
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
  const token = crypto.randomUUID();
  await db.session.create({
    data: {
      userId: user.id,
      token,
      expiresAt: new Date(Date.now() + 86400000),
      lastActivityAt: new Date(),
    },
  });
  const signature = crypto.createHmac("sha256", secret).update(token).digest("base64");
  return {
    id: user.id,
    cookie: `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`,
  };
}
type Identity = Awaited<ReturnType<typeof identity>>;
function req(branchId: string, actor?: Identity, body?: unknown) {
  return new NextRequest(
    `http://localhost:3000/api/v1/staff/branches/${branchId}/fitment-policies`,
    {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        ...(actor ? { cookie: actor.cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }
  );
}
function context(branchId: string) {
  return { params: Promise.resolve({ branchId }) };
}
async function fixture() {
  const db = getPrisma();
  const sales = await identity("SALES_AGENT");
  const foreign = await identity("SALES_AGENT");
  const ops = await identity("OPS_SUPERVISOR");
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  const provider = await db.providerOrganization.create({
    data: {
      nameEn: "Synthetic provider",
      nameAr: "مركز اختباري",
      legalName: "Synthetic legal",
      taxRegistrationNumber: String(crypto.randomInt(100000000, 999999999)),
      commercialRegistrationNumber: `CR-${suffix}`,
      primaryCluster: "NASR_CITY_HELIOPOLIS",
      status: "ACTIVE",
      contactPersonName: "Private contact",
      contactEmail: "private@test.eg",
      contactPhone: "+201011112222",
      createdByUserId: sales.id,
    },
  });
  const branch = await db.providerBranch.create({
    data: {
      providerOrganizationId: provider.id,
      branchCode: `CR-${suffix}`,
      nameEn: "Synthetic branch",
      nameAr: "فرع اختباري",
      cluster: "NASR_CITY_HELIOPOLIS",
      streetAddressEn: "Private street",
      streetAddressAr: "شارع خاص",
      latitude: "30.061200",
      longitude: "31.341100",
      contactPhone: "+201011112222",
      operatingHours: [{ dayOfWeek: 1, openTime: "09:00", closeTime: "17:00", isClosed: false }],
      status: "ACTIVE",
    },
  });
  const category = await db.serviceCategory.create({
    data: {
      code: `CR_${suffix}`,
      nameEn: "Synthetic category",
      nameAr: "فئة اختبارية",
      sortOrder: 999,
    },
  });
  const make = await db.vehicleMake.create({
    data: {
      code: `CR_${suffix}`,
      nameEn: "Synthetic make",
      nameAr: "ماركة اختبارية",
      evidenceRef: "CI:PRIVATE:MAKE",
    },
  });
  const model = await db.vehicleModel.create({
    data: {
      makeId: make.id,
      code: "MODEL",
      nameEn: "Synthetic model",
      nameAr: "طراز اختباري",
      evidenceRef: "CI:PRIVATE:MODEL",
    },
  });
  const coverage = [{ makeId: make.id, modelId: model.id, yearFrom: 2020, yearTo: 2024 }];
  const created = await POST(
    req(branch.id, sales, {
      commandId: crypto.randomUUID(),
      categoryId: category.id,
      evidenceRef: "CI:PRIVATE:POLICY",
      coverage,
    }),
    context(branch.id)
  );
  expect(created.status).toBe(201);
  const policyId = (await created.json()).command.policyId as string;
  return { sales, foreign, ops, provider, branch, category, make, model, coverage, policyId };
}
async function read(branchId: string, actor: Identity) {
  const response = await GET(req(branchId, actor), context(branchId));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  return response.json();
}
async function submitAndApprove(f: Awaited<ReturnType<typeof fixture>>) {
  const params = { params: Promise.resolve({ branchId: f.branch.id, policyId: f.policyId }) };
  expect(
    (
      await submit(
        req(f.branch.id, f.sales, { commandId: crypto.randomUUID(), expectedVersion: 1 }),
        params
      )
    ).status
  ).toBe(200);
  expect(
    (
      await approve(
        req(f.branch.id, f.ops, {
          commandId: crypto.randomUUID(),
          expectedVersion: 2,
          attested: true,
        }),
        params
      )
    ).status
  ).toBe(200);
}

describe("Capability read projection through real sessions and PostgreSQL", () => {
  beforeAll(() => {
    process.env.APP_RUNTIME_PROFILE = "showcase";
    process.env.APP_DATA_BACKEND = "postgres";
    process.env.DATABASE_URL = databaseUrl;
    process.env.DATABASE_DIRECT_URL = databaseUrl;
    process.env.BETTER_AUTH_SECRET = secret;
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    process.env.OFFER_EVIDENCE_PACKET_REPOSITORY_READY = "true";
    resetServerEnvCache();
    resetAuth();
  });
  afterAll(async () => {
    await disconnectDb();
    process.env = originalEnv;
    resetServerEnvCache();
    resetAuth();
  });

  it("returns allowlisted historical labels, owner actions and minimal cross-maker current summary without contact or evidence leakage", async () => {
    const f = await fixture();
    await submitAndApprove(f);
    await getPrisma().vehicleMake.update({ where: { id: f.make.id }, data: { isActive: false } });
    await getPrisma().vehicleModel.update({ where: { id: f.model.id }, data: { isActive: false } });
    await getPrisma().serviceCategory.update({
      where: { id: f.category.id },
      data: { isActive: false },
    });
    await getPrisma().providerBranch.update({
      where: { id: f.branch.id },
      data: { status: "PAUSED" },
    });
    const owner = await read(f.branch.id, f.sales);
    expect(Object.keys(owner).sort()).toEqual(["context", "currentByCategory", "policies"]);
    expect(Object.keys(owner.context).sort()).toEqual([
      "branchId",
      "branchStatus",
      "canCreate",
      "providerOrganizationId",
      "providerStatus",
    ]);
    expect(owner.context).toMatchObject({
      branchId: f.branch.id,
      providerOrganizationId: f.provider.id,
      branchStatus: "PAUSED",
      providerStatus: "ACTIVE",
      canCreate: false,
    });
    const policy = owner.policies[0];
    expect(Object.keys(policy).sort()).toEqual(
      [
        "attested",
        "category",
        "categoryId",
        "coverage",
        "createdAt",
        "decidedAt",
        "eligibility",
        "evidenceRef",
        "id",
        "isCurrent",
        "rejectionReason",
        "sequenceNumber",
        "status",
        "submittedAt",
        "updatedAt",
        "version",
        "withdrawnAt",
      ].sort()
    );
    expect(policy).toMatchObject({
      id: f.policyId,
      status: "ACTIVE",
      version: 3,
      isCurrent: true,
      category: { nameEn: "Synthetic category", nameAr: "فئة اختبارية", isActive: false },
      coverage: [
        {
          make: { nameEn: "Synthetic make", nameAr: "ماركة اختبارية", isActive: false },
          model: { nameEn: "Synthetic model", nameAr: "طراز اختباري", isActive: false },
        },
      ],
      eligibility: { edit: false, submit: false, approve: false, reject: false, withdraw: false },
    });
    expect(policy.submittedAt).toBeTruthy();
    expect(policy.decidedAt).toBeTruthy();
    const foreign = await read(f.branch.id, f.foreign);
    expect(foreign.policies).toEqual([]);
    const pointer = foreign.currentByCategory[0];
    expect(Object.keys(pointer).sort()).toEqual(
      [
        "activePolicySequenceNumber",
        "activePolicyStatus",
        "activePolicyVersion",
        "activeVersionId",
        "category",
        "categoryId",
        "version",
      ].sort()
    );
    expect(pointer).toMatchObject({
      activeVersionId: f.policyId,
      activePolicyVersion: 3,
      activePolicyStatus: "ACTIVE",
      categoryId: f.category.id,
    });
    const body = JSON.stringify(foreign);
    expect(body).not.toContain("CI:PRIVATE");
    expect(body).not.toContain("coverage");
    expect(body).not.toContain("Private contact");
    expect(body).not.toContain("private@test.eg");
    expect(body).not.toContain(f.sales.id);
    const ops = await read(f.branch.id, f.ops);
    expect(ops.policies[0].eligibility.withdraw).toBe(true);
    expect(ops.policies[0].evidenceRef).toBe("CI:PRIVATE:POLICY");
  });

  it("derives creator-only draft actions and distinct Ops rejection eligibility, preserving rejection context", async () => {
    const f = await fixture();
    const draft = await read(f.branch.id, f.sales);
    expect(draft.context.canCreate).toBe(true);
    expect(draft.policies[0].eligibility).toEqual({
      edit: true,
      submit: true,
      approve: false,
      reject: false,
      withdraw: false,
    });
    expect((await read(f.branch.id, f.ops)).policies[0].eligibility).toEqual({
      edit: false,
      submit: false,
      approve: false,
      reject: false,
      withdraw: false,
    });
    const params = { params: Promise.resolve({ branchId: f.branch.id, policyId: f.policyId }) };
    expect(
      (
        await submit(
          req(f.branch.id, f.sales, { commandId: crypto.randomUUID(), expectedVersion: 1 }),
          params
        )
      ).status
    ).toBe(200);
    const pending = await read(f.branch.id, f.ops);
    expect(pending.policies[0].eligibility.approve).toBe(true);
    expect(pending.policies[0].eligibility.reject).toBe(true);
    await getPrisma().providerOrganization.update({
      where: { id: f.provider.id },
      data: { status: "PAUSED" },
    });
    const paused = await read(f.branch.id, f.ops);
    expect(paused.policies[0].eligibility.approve).toBe(false);
    expect(paused.policies[0].eligibility.reject).toBe(true);
    expect(
      (
        await reject(
          req(f.branch.id, f.ops, {
            commandId: crypto.randomUUID(),
            expectedVersion: 2,
            reason: "Evidence needs correction",
          }),
          params
        )
      ).status
    ).toBe(200);
    const rejected = await read(f.branch.id, f.sales);
    expect(rejected.policies[0]).toMatchObject({
      status: "REJECTED",
      rejectionReason: "Evidence needs correction",
      eligibility: { edit: false, submit: false, approve: false, reject: false, withdraw: false },
    });
    expect(rejected.policies[0].decidedAt).toBeTruthy();
  });

  it("enforces real session, role, MFA and branch existence boundaries with no-store denials", async () => {
    const f = await fixture();
    const finance = await identity("FINANCE_OFFICER");
    const missing = await GET(req(f.branch.id), context(f.branch.id));
    expect(missing.status).toBe(401);
    expect(missing.headers.get("cache-control")).toBe("no-store");
    const denied = await GET(req(f.branch.id, finance), context(f.branch.id));
    expect(denied.status).toBe(403);
    expect(denied.headers.get("cache-control")).toBe("no-store");
    await getPrisma().twoFactor.updateMany({
      where: { userId: f.sales.id },
      data: { verified: false },
    });
    const mfa = await GET(req(f.branch.id, f.sales), context(f.branch.id));
    expect(mfa.status).toBe(403);
    expect(mfa.headers.get("cache-control")).toBe("no-store");
    const unknown = crypto.randomUUID();
    const absent = await GET(req(unknown, f.ops), context(unknown));
    expect(absent.status).toBe(404);
    expect(absent.headers.get("cache-control")).toBe("no-store");
  });

  it("keeps context and canonical labels on the same snapshot when dependencies change after the first read", async () => {
    const f = await fixture();
    const blocker = new pg.Client({ connectionString: databaseUrl });
    const observer = new pg.Client({ connectionString: databaseUrl });
    let pending: Promise<Response> | undefined;
    await blocker.connect();
    await observer.connect();
    try {
      await blocker.query("BEGIN");
      const pid = (await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]
        .pid;
      // The route first reads branch context. Stop its next table read after
      // that snapshot exists; do not replace session resolution or the DTO.
      await blocker.query("LOCK TABLE branch_capability_versions IN ACCESS EXCLUSIVE MODE");
      pending = GET(req(f.branch.id, f.sales), context(f.branch.id));
      const deadline = Date.now() + 5000;
      let waiting = false;
      while (Date.now() < deadline) {
        const result = await observer.query<{ waiting: boolean }>(
          "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1::integer = ANY(pg_blocking_pids(pid))) AS waiting",
          [pid]
        );
        if (result.rows[0].waiting) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      await getPrisma().$transaction(async (tx) => {
        await tx.providerOrganization.update({
          where: { id: f.provider.id },
          data: { status: "PAUSED" },
        });
        await tx.vehicleMake.update({ where: { id: f.make.id }, data: { isActive: false } });
        await tx.vehicleModel.update({ where: { id: f.model.id }, data: { isActive: false } });
      });
      await blocker.query("COMMIT");
      const response = await pending;
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.context.providerStatus).toBe("ACTIVE");
      expect(body.policies[0].coverage[0].make.isActive).toBe(true);
      expect(body.policies[0].coverage[0].model.isActive).toBe(true);
      const fresh = await read(f.branch.id, f.sales);
      expect(fresh.context.providerStatus).toBe("PAUSED");
      expect(fresh.policies[0].coverage[0].make.isActive).toBe(false);
      expect(fresh.policies[0].coverage[0].model.isActive).toBe(false);
      expect(fresh.context.canCreate).toBe(false);
    } finally {
      await blocker.query("ROLLBACK").catch(() => {});
      await pending?.catch(() => {});
      await blocker.end();
      await observer.end();
    }
  });
});
