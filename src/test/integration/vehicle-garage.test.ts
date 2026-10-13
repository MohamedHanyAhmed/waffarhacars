import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import pg from "pg";
import { NextRequest } from "next/server";
import { getPrisma, disconnectDb } from "@/lib/db";
import { resetAuth } from "@/lib/auth";
import { resetServerEnvCache } from "@/lib/env";
import { POST as createGarage, GET as listGarage } from "@/app/api/v1/garage/route";
import {
  GET as readGarage,
  PATCH as editGarage,
  DELETE as archiveGarage,
} from "@/app/api/v1/garage/[id]/route";
import { GET as commandGarage } from "@/app/api/v1/garage/commands/[commandId]/route";
import { GET as publicCatalog } from "@/app/api/v1/vehicles/catalog/route";
import { POST as createMakeRoute } from "@/app/api/v1/staff/ops/vehicle-catalog/makes/route";
import { POST as createModelRoute } from "@/app/api/v1/staff/ops/vehicle-catalog/models/route";
import { PATCH as updateMakeRoute } from "@/app/api/v1/staff/ops/vehicle-catalog/makes/[id]/route";
import { GET as catalogCommandRoute } from "@/app/api/v1/staff/ops/vehicle-catalog/commands/[commandId]/route";

const url =
  process.env.DATABASE_URL ||
  "postgresql://test_user:test_password@localhost:5432/waffarhacars_test";
const secret = "vehicle-test-secret-at-least-32-characters-long";
const originalEnv = { ...process.env };
const users: string[] = [];
const makes: string[] = [];
let primary: { id: string; cookie: string };
let other: { id: string; cookie: string };
let ops: { id: string; cookie: string };
let sales: { id: string; cookie: string };
let makeId: string;
let modelId: string;

function signedCookie(token: string) {
  const signature = crypto.createHmac("sha256", secret).update(token).digest("base64");
  return `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`;
}
function req(
  path: string,
  method = "GET",
  cookie?: string,
  payload?: unknown,
  origin = "http://localhost:3000"
) {
  const headers = new Headers({ "content-type": "application/json" });
  if (cookie) headers.set("cookie", cookie);
  if (method !== "GET") headers.set("origin", origin);
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers,
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
}
async function customer(phone: string, withProfile = true) {
  const db = getPrisma();
  const email = `vehicle-${crypto.randomUUID()}@test.eg`;
  const user = await db.user.create({
    data: { name: "Synthetic vehicle test", email, phoneNumber: phone, phoneNumberVerified: true },
  });
  users.push(user.id);
  if (withProfile) await db.customerProfile.create({ data: { userId: user.id } });
  const token = `vehicle-${crypto.randomUUID()}`;
  await db.session.create({
    data: {
      userId: user.id,
      token,
      expiresAt: new Date(Date.now() + 86400000),
      lastActivityAt: new Date(),
    },
  });
  return { id: user.id, cookie: signedCookie(token) };
}
async function staff(role: "OPS_SUPERVISOR" | "SALES_AGENT") {
  const db = getPrisma();
  const user = await db.user.create({
    data: {
      name: `Synthetic ${role}`,
      email: `vehicle-${role}-${crypto.randomUUID()}@test.eg`,
      twoFactorEnabled: true,
    },
  });
  users.push(user.id);
  const membership = await db.internalStaffMembership.create({
    data: {
      userId: user.id,
      employeeNumber: `V${crypto.randomUUID().slice(0, 12)}`,
      department: role === "OPS_SUPERVISOR" ? "OPERATIONS" : "SALES",
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
  const token = `vehicle-${crypto.randomUUID()}`;
  await db.session.create({
    data: {
      userId: user.id,
      token,
      expiresAt: new Date(Date.now() + 86400000),
      lastActivityAt: new Date(),
    },
  });
  return { id: user.id, cookie: signedCookie(token) };
}
async function postGarage(
  cookie: string,
  commandId = crypto.randomUUID(),
  override: Record<string, unknown> = {}
) {
  return createGarage(
    req("/api/v1/garage", "POST", cookie, {
      commandId,
      makeId,
      modelId,
      modelYear: 2022,
      ...override,
    })
  );
}
async function receipt(response: Response) {
  return (await response.json()) as {
    receipt: { resourceId: string; resultVersion: number; commandId: string };
    replayed: boolean;
    error?: string;
  };
}

describe("Vehicle garage through real Better Auth session and PostgreSQL route boundaries", () => {
  beforeAll(async () => {
    const probe = new pg.Client({ connectionString: url, connectionTimeoutMillis: 3000 });
    try {
      await probe.connect();
    } catch {
      throw new Error("PostgreSQL required for vehicle garage integration tests");
    } finally {
      await probe.end().catch(() => {});
    }
    process.env.APP_RUNTIME_PROFILE = "showcase";
    process.env.APP_DATA_BACKEND = "postgres";
    process.env.DATABASE_URL = url;
    process.env.DATABASE_DIRECT_URL = url;
    process.env.BETTER_AUTH_SECRET = secret;
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    resetServerEnvCache();
    resetAuth();
    primary = await customer("+201012345678");
    other = await customer("+201112345678");
    ops = await staff("OPS_SUPERVISOR");
    sales = await staff("SALES_AGENT");
    const db = getPrisma();
    const code = crypto.randomUUID().slice(0, 8).toUpperCase();
    const make = await db.vehicleMake.create({
      data: {
        code: `T${code}`,
        nameEn: "Synthetic make",
        nameAr: "شركة اختبار",
        evidenceRef: "CI:VEHICLE:MAKE",
      },
    });
    makes.push(make.id);
    makeId = make.id;
    const model = await db.vehicleModel.create({
      data: {
        makeId,
        code: "TEST_MODEL",
        nameEn: "Synthetic model",
        nameAr: "طراز اختباري",
        evidenceRef: "CI:VEHICLE:MODEL",
      },
    });
    modelId = model.id;
  });
  afterAll(async () => {
    if (!primary) return;
    const db = getPrisma();
    await db.vehicleCommand.deleteMany({ where: { actorUserId: { in: users } } });
    await db.customerVehicle.deleteMany({ where: { ownerUserId: { in: users } } });
    await db.vehicleCatalogEntry.deleteMany({ where: { actorUserId: { in: users } } });
    await db.vehicleModel.deleteMany({ where: { makeId: { in: makes } } });
    await db.vehicleMake.deleteMany({ where: { id: { in: makes } } });
    await db.securityAuditEvent.deleteMany({ where: { actorUserId: { in: users } } });
    await db.session.deleteMany({ where: { userId: { in: users } } });
    const memberships = await db.internalStaffMembership.findMany({
      where: { userId: { in: users } },
      select: { id: true },
    });
    await db.internalRoleAssignment.deleteMany({
      where: { staffMembershipId: { in: memberships.map((row) => row.id) } },
    });
    await db.internalStaffMembership.deleteMany({ where: { userId: { in: users } } });
    await db.twoFactor.deleteMany({ where: { userId: { in: users } } });
    await db.customerProfile.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await disconnectDb();
    process.env = originalEnv;
    resetServerEnvCache();
    resetAuth();
  });

  it("authenticates a genuine database-backed cookie and never accepts a client owner override", async () => {
    const noCookie = await postGarage("");
    expect(noCookie.status).toBe(401);
    expect((await postGarage(ops.cookie)).status).toBe(403);
    const commandId = crypto.randomUUID();
    const invalidOwner = await postGarage(primary.cookie, commandId, { ownerUserId: other.id });
    expect(invalidOwner.status).toBe(400);
    const created = await postGarage(primary.cookie, commandId);
    expect(created.status).toBe(201);
    const result = await receipt(created);
    expect(
      (
        await readGarage(
          req(`/api/v1/garage/${result.receipt.resourceId}`, "GET", primary.cookie),
          { params: Promise.resolve({ id: result.receipt.resourceId }) }
        )
      ).status
    ).toBe(200);
    expect(
      (
        await readGarage(req(`/api/v1/garage/${result.receipt.resourceId}`, "GET", other.cookie), {
          params: Promise.resolve({ id: result.receipt.resourceId }),
        })
      ).status
    ).toBe(404);
    expect(
      (
        await commandGarage(req(`/api/v1/garage/commands/${commandId}`, "GET", other.cookie), {
          params: Promise.resolve({ commandId }),
        })
      ).status
    ).toBe(404);
  });

  it("restricts catalog mutation to Ops, stores actor-bound receipts, and exposes no provenance publicly", async () => {
    const commandId = crypto.randomUUID();
    const makePayload = {
      commandId,
      code: `OPS${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      nameEn: "Synthetic ops make",
      nameAr: "ماركة اختبار",
      evidenceRef: "CI:OPS:MAKE",
    };
    const denied = await createMakeRoute(
      req("/api/v1/staff/ops/vehicle-catalog/makes", "POST", sales.cookie, makePayload)
    );
    expect(denied.status).toBe(403);
    const createdResponse = await createMakeRoute(
      req("/api/v1/staff/ops/vehicle-catalog/makes", "POST", ops.cookie, makePayload)
    );
    expect(createdResponse.status).toBe(201);
    const created = await receipt(createdResponse);
    makes.push(created.receipt.resourceId);
    const repeat = await receipt(
      await createMakeRoute(
        req("/api/v1/staff/ops/vehicle-catalog/makes", "POST", ops.cookie, makePayload)
      )
    );
    expect(repeat.replayed).toBe(true);
    expect(
      (
        await catalogCommandRoute(
          req(`/api/v1/staff/ops/vehicle-catalog/commands/${commandId}`, "GET", sales.cookie),
          { params: Promise.resolve({ commandId }) }
        )
      ).status
    ).toBe(403);
    expect(
      (
        await commandGarage(req(`/api/v1/garage/commands/${commandId}`, "GET", primary.cookie), {
          params: Promise.resolve({ commandId }),
        })
      ).status
    ).toBe(404);
    const modelCreated = await createModelRoute(
      req("/api/v1/staff/ops/vehicle-catalog/models", "POST", ops.cookie, {
        commandId: crypto.randomUUID(),
        makeId: created.receipt.resourceId,
        code: "OPS_MODEL",
        nameEn: "Synthetic ops model",
        nameAr: "طراز اختباري",
        evidenceRef: "CI:OPS:MODEL",
      })
    );
    expect(modelCreated.status).toBe(201);
    const publicResult = await publicCatalog(req("/api/v1/vehicles/catalog"));
    const publicBody = await publicResult.json();
    expect(JSON.stringify(publicBody)).not.toContain("CI:OPS:MAKE");
    const updated = await updateMakeRoute(
      req(
        `/api/v1/staff/ops/vehicle-catalog/makes/${created.receipt.resourceId}`,
        "PATCH",
        ops.cookie,
        {
          commandId: crypto.randomUUID(),
          expectedVersion: 1,
          nameEn: "Corrected synthetic make",
          nameAr: "ماركة اختبار",
          evidenceRef: "CI:OPS:MAKE2",
          isActive: false,
        }
      ),
      { params: Promise.resolve({ id: created.receipt.resourceId }) }
    );
    expect(updated.status).toBe(200);
    const row = await getPrisma().vehicleMake.findUniqueOrThrow({
      where: { id: created.receipt.resourceId },
    });
    expect(row.version).toBe(2);
    expect(row.isActive).toBe(false);
    expect(
      await getPrisma().securityAuditEvent.count({
        where: {
          actorUserId: ops.id,
          eventType: "VEHICLE_MAKE_CREATED",
          targetEntity: `vehicle_make:${created.receipt.resourceId}`,
        },
      })
    ).toBe(1);
  });

  it("replays an exact historical create once and rejects changed payload even after archive", async () => {
    const commandId = crypto.randomUUID();
    const created = await receipt(await postGarage(primary.cookie, commandId));
    const vehicleId = created.receipt.resourceId;
    const archived = await archiveGarage(
      req(`/api/v1/garage/${vehicleId}`, "DELETE", primary.cookie, {
        commandId: crypto.randomUUID(),
        expectedVersion: 1,
      }),
      { params: Promise.resolve({ id: vehicleId }) }
    );
    expect(archived.status).toBe(200);
    const replayed = await receipt(await postGarage(primary.cookie, commandId));
    expect(replayed.replayed).toBe(true);
    expect(replayed.receipt.resourceId).toBe(vehicleId);
    expect((await postGarage(primary.cookie, commandId, { modelYear: 2023 })).status).toBe(409);
    const stored = await getPrisma().customerVehicle.findUniqueOrThrow({
      where: { id: vehicleId },
    });
    expect(stored.archivedAt).not.toBeNull();
    expect(stored.version).toBe(2);
    expect(await getPrisma().vehicleCommand.count({ where: { commandId } })).toBe(1);
  });

  it("enforces a customer profile and live unsuspended session before receipt access", async () => {
    const staffOnly = await customer("+201212345678", false);
    expect((await postGarage(staffOnly.cookie)).status).toBe(403);
    const commandId = crypto.randomUUID();
    expect((await postGarage(other.cookie, commandId)).status).toBe(201);
    await getPrisma().user.update({ where: { id: other.id }, data: { isSuspended: true } });
    expect(
      (
        await commandGarage(req(`/api/v1/garage/commands/${commandId}`, "GET", other.cookie), {
          params: Promise.resolve({ commandId }),
        })
      ).status
    ).toBe(403);
    await getPrisma().user.update({ where: { id: other.id }, data: { isSuspended: false } });
    const expiring = await customer("+201512345678");
    const expiringCommandId = crypto.randomUUID();
    expect((await postGarage(expiring.cookie, expiringCommandId)).status).toBe(201);
    const session = await getPrisma().session.findFirstOrThrow({ where: { userId: expiring.id } });
    await getPrisma().session.update({
      where: { id: session.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(
      (
        await commandGarage(
          req(`/api/v1/garage/commands/${expiringCommandId}`, "GET", expiring.cookie),
          {
            params: Promise.resolve({ commandId: expiringCommandId }),
          }
        )
      ).status
    ).toBe(401);
  });

  it("allows exactly one competing edit/archive at one expected version and never revives archive", async () => {
    const vehicleId = (await receipt(await postGarage(other.cookie))).receipt.resourceId;
    const editId = crypto.randomUUID();
    const archiveId = crypto.randomUUID();
    const [edit, archive] = await Promise.all([
      editGarage(
        req(`/api/v1/garage/${vehicleId}`, "PATCH", other.cookie, {
          commandId: editId,
          expectedVersion: 1,
          makeId,
          modelId,
          modelYear: 2023,
        }),
        { params: Promise.resolve({ id: vehicleId }) }
      ),
      archiveGarage(
        req(`/api/v1/garage/${vehicleId}`, "DELETE", other.cookie, {
          commandId: archiveId,
          expectedVersion: 1,
        }),
        { params: Promise.resolve({ id: vehicleId }) }
      ),
    ]);
    expect([edit.status, archive.status].sort()).toEqual([200, 409]);
    const stored = await getPrisma().customerVehicle.findUniqueOrThrow({
      where: { id: vehicleId },
    });
    expect(stored.version).toBe(2);
    expect(
      await getPrisma().vehicleCommand.count({ where: { commandId: { in: [editId, archiveId] } } })
    ).toBe(1);
    const mutationAudit = await getPrisma().securityAuditEvent.findMany({
      where: {
        actorUserId: other.id,
        eventType: { in: ["CUSTOMER_VEHICLE_UPDATED", "CUSTOMER_VEHICLE_ARCHIVED"] },
        targetEntity: `customer_vehicle:${vehicleId}`,
      },
      select: { metadata: true },
    });
    expect(
      mutationAudit.filter((row) =>
        new Set<string>([editId, archiveId]).has(
          (row.metadata as { commandId?: string }).commandId || ""
        )
      )
    ).toHaveLength(1);
    if (archive.status === 200) {
      expect(stored.archivedAt).not.toBeNull();
      expect(
        (
          await editGarage(
            req(`/api/v1/garage/${vehicleId}`, "PATCH", other.cookie, {
              commandId: crypto.randomUUID(),
              expectedVersion: 2,
              makeId,
              modelId,
              modelYear: 2024,
            }),
            { params: Promise.resolve({ id: vehicleId }) }
          )
        ).status
      ).toBe(409);
      expect(
        (
          await receipt(
            await archiveGarage(
              req(`/api/v1/garage/${vehicleId}`, "DELETE", other.cookie, {
                commandId: archiveId,
                expectedVersion: 1,
              }),
              { params: Promise.resolve({ id: vehicleId }) }
            )
          )
        ).replayed
      ).toBe(true);
    } else {
      expect(stored.modelYear).toBe(2023);
      expect(
        (
          await receipt(
            await editGarage(
              req(`/api/v1/garage/${vehicleId}`, "PATCH", other.cookie, {
                commandId: editId,
                expectedVersion: 1,
                makeId,
                modelId,
                modelYear: 2023,
              }),
              { params: Promise.resolve({ id: vehicleId }) }
            )
          )
        ).replayed
      ).toBe(true);
    }
  });

  it("enforces immutable codes, model parent and selected make/model FK in PostgreSQL", async () => {
    const db = getPrisma();
    const alternate = await db.vehicleMake.create({
      data: {
        code: `ALT${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        nameEn: "Synthetic alternate",
        nameAr: "بديل اختباري",
        evidenceRef: "CI:VEHICLE:ALT",
      },
    });
    makes.push(alternate.id);
    await expect(
      db.vehicleMake.update({ where: { id: makeId }, data: { code: "CHANGED" } })
    ).rejects.toThrow();
    await expect(
      db.vehicleModel.update({ where: { id: modelId }, data: { makeId: alternate.id } })
    ).rejects.toThrow();
    const profile = await db.customerProfile.findUniqueOrThrow({ where: { userId: other.id } });
    await expect(
      db.customerVehicle.create({
        data: {
          ownerUserId: other.id,
          customerProfileId: profile.id,
          makeId: alternate.id,
          modelId,
          modelYear: 2022,
        },
      })
    ).rejects.toThrow();
    expect(await db.customerVehicle.count({ where: { makeId: alternate.id } })).toBe(0);
  });

  it("rejects untrusted origins and invalid Cairo model years without receipt or audit", async () => {
    const commandId = crypto.randomUUID();
    const forbidden = await createGarage(
      req(
        "/api/v1/garage",
        "POST",
        primary.cookie,
        { commandId, makeId, modelId, modelYear: 2022 },
        "https://attacker.example"
      )
    );
    expect(forbidden.status).toBe(403);
    const invalid = await postGarage(primary.cookie, commandId, { modelYear: 1899 });
    expect(invalid.status).toBe(400);
    expect(await getPrisma().vehicleCommand.count({ where: { commandId } })).toBe(0);
    const audit = await getPrisma().securityAuditEvent.findMany({
      where: { actorUserId: primary.id, eventType: "CUSTOMER_VEHICLE_CREATED" },
      select: { metadata: true },
    });
    expect(
      audit.some((row) => (row.metadata as { commandId?: string }).commandId === commandId)
    ).toBe(false);
  });

  it("rolls back vehicle and command on real audit insertion failure, then retries the same key", async () => {
    if (new URL(url).pathname !== "/waffarhacars_test")
      throw new Error("Audit fault injection requires ephemeral test database");
    const commandId = crypto.randomUUID();
    const before = await getPrisma().customerVehicle.count({ where: { ownerUserId: other.id } });
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      await client.query(
        `CREATE FUNCTION vehicle_audit_failure_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."actorUserId" = '${other.id}'::uuid AND NEW."eventType" = 'CUSTOMER_VEHICLE_CREATED' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END; $$`
      );
      await client.query(
        "CREATE TRIGGER vehicle_audit_failure_test BEFORE INSERT ON security_audit_events FOR EACH ROW EXECUTE FUNCTION vehicle_audit_failure_test()"
      );
      const failed = await postGarage(other.cookie, commandId);
      expect(failed.status).toBe(503);
      expect(await getPrisma().vehicleCommand.count({ where: { commandId } })).toBe(0);
      expect(await getPrisma().customerVehicle.count({ where: { ownerUserId: other.id } })).toBe(
        before
      );
    } finally {
      await client.query(
        "DROP TRIGGER IF EXISTS vehicle_audit_failure_test ON security_audit_events"
      );
      await client.query("DROP FUNCTION IF EXISTS vehicle_audit_failure_test()");
      await client.end();
    }
    const retried = await postGarage(other.cookie, commandId);
    expect(retried.status).toBe(201);
    expect(await getPrisma().vehicleCommand.count({ where: { commandId } })).toBe(1);
    expect(await getPrisma().customerVehicle.count({ where: { ownerUserId: other.id } })).toBe(
      before + 1
    );
  });

  it("serializes two distinct creates at nine active cars to exactly ten, with one refusal", async () => {
    const db = getPrisma();
    await db.customerVehicle.updateMany({
      where: { ownerUserId: primary.id, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    const profile = await db.customerProfile.findUniqueOrThrow({ where: { userId: primary.id } });
    for (let i = 0; i < 9; i++)
      await db.customerVehicle.create({
        data: {
          ownerUserId: primary.id,
          customerProfileId: profile.id,
          makeId,
          modelId,
          modelYear: 2020 + (i % 3),
        },
      });
    const firstId = crypto.randomUUID();
    const secondId = crypto.randomUUID();
    const blocker = new pg.Client({ connectionString: url });
    await blocker.connect();
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM customer_profile WHERE id = $1 FOR UPDATE", [profile.id]);
    const firstPromise = postGarage(primary.cookie, firstId);
    const secondPromise = postGarage(primary.cookie, secondId);
    let blocked = 0;
    try {
      const deadline = Date.now() + 2400;
      while (Date.now() < deadline) {
        const waiting = await blocker.query(
          "SELECT count(*)::int AS count FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND datname = current_database() AND wait_event_type = 'Lock'"
        );
        blocked = Number(waiting.rows[0].count);
        if (blocked >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    } finally {
      await blocker.query("COMMIT");
      await blocker.end();
    }
    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    expect(blocked).toBeGreaterThanOrEqual(2);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    expect(
      await db.customerVehicle.count({ where: { ownerUserId: primary.id, archivedAt: null } })
    ).toBe(10);
    expect(
      await db.vehicleCommand.count({ where: { commandId: { in: [firstId, secondId] } } })
    ).toBe(1);
    const audit = await db.securityAuditEvent.findMany({
      where: { actorUserId: primary.id, eventType: "CUSTOMER_VEHICLE_CREATED" },
      select: { metadata: true },
    });
    const auditIds = audit
      .map((row) => (row.metadata as { commandId?: string }).commandId)
      .filter((id) => id === firstId || id === secondId);
    expect(auditIds).toEqual([first.status === 201 ? firstId : secondId]);
  });

  it("keeps archived selections visible while inactive catalog blocks a new selection", async () => {
    const db = getPrisma();
    await db.vehicleModel.update({
      where: { id: modelId },
      data: { isActive: false, version: { increment: 1 } },
    });
    const listed = await listGarage(req("/api/v1/garage?limit=20", "GET", primary.cookie));
    expect(listed.status).toBe(200);
    expect(
      (await listed.json()).items.some(
        (item: { catalogAvailable: boolean }) => item.catalogAvailable === false
      )
    ).toBe(true);
    expect((await postGarage(other.cookie)).status).toBe(409);
    const publicModels = await publicCatalog(req(`/api/v1/vehicles/catalog?makeId=${makeId}`));
    expect((await publicModels.json()).items).toEqual([]);
  });
});
