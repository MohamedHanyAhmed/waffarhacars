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
import {
  POST as createMakeRoute,
  GET as listMakeRoute,
} from "@/app/api/v1/staff/ops/vehicle-catalog/makes/route";
import {
  POST as createModelRoute,
  GET as listModelRoute,
} from "@/app/api/v1/staff/ops/vehicle-catalog/models/route";
import { PATCH as updateMakeRoute } from "@/app/api/v1/staff/ops/vehicle-catalog/makes/[id]/route";
import { PATCH as updateModelRoute } from "@/app/api/v1/staff/ops/vehicle-catalog/models/[id]/route";
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

// This observes a real PostgreSQL blocking chain rooted in the exact row-locking
// transaction created by the test. It never counts unrelated database waiters.
async function waitForBlockedCommands(client: pg.Client, blockerPid: number, expected: number) {
  const deadline = Date.now() + 2500;
  let observed = 0;
  while (Date.now() < deadline) {
    const result = await client.query(
      `WITH RECURSIVE chain(pid) AS (
         SELECT pid FROM pg_stat_activity WHERE $1::integer = ANY(pg_blocking_pids(pid))
         UNION
         SELECT a.pid FROM pg_stat_activity a JOIN chain c ON c.pid = ANY(pg_blocking_pids(a.pid))
       ) SELECT count(*)::int AS count FROM chain`,
      [blockerPid]
    );
    observed = Number(result.rows[0].count);
    if (observed >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    `Expected ${expected} command transactions blocked by the test row lock; observed ${observed}`
  );
}

async function orderedRace(
  lockSql: string,
  lockArgs: string[],
  first: () => Promise<Response>,
  second: () => Promise<Response>
): Promise<[Response, Response]> {
  const blocker = new pg.Client({ connectionString: url });
  await blocker.connect();
  let firstPromise: Promise<Response> | undefined;
  let secondPromise: Promise<Response> | undefined;
  try {
    await blocker.query("BEGIN");
    const pid = Number((await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
    const locked = await blocker.query(lockSql, lockArgs);
    expect(locked.rowCount).toBe(1);
    firstPromise = first();
    await waitForBlockedCommands(blocker, pid, 1);
    secondPromise = second();
    await waitForBlockedCommands(blocker, pid, 2);
    await blocker.query("COMMIT");
    return await Promise.all([firstPromise, secondPromise]);
  } finally {
    await blocker.query("ROLLBACK").catch(() => {});
    await blocker.end();
    await Promise.allSettled([firstPromise, secondPromise].filter(Boolean) as Promise<Response>[]);
  }
}

async function seedActiveCars(owner: { id: string }, count: number) {
  const db = getPrisma();
  const profile = await db.customerProfile.findUniqueOrThrow({ where: { userId: owner.id } });
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const row = await db.customerVehicle.create({
      data: {
        ownerUserId: owner.id,
        customerProfileId: profile.id,
        makeId,
        modelId,
        modelYear: 2020 + (i % 3),
      },
    });
    ids.push(row.id);
  }
  return { profileId: profile.id, ids };
}

async function createCatalogPair(suffix: string) {
  const makeCommandId = crypto.randomUUID();
  const makeResult = await createMakeRoute(
    req("/api/v1/staff/ops/vehicle-catalog/makes", "POST", ops.cookie, {
      commandId: makeCommandId,
      code: `RACE_${suffix}`,
      nameEn: "Synthetic race make",
      nameAr: "ماركة سباق اختبارية",
      evidenceRef: "CI:RACE:MAKE",
    })
  );
  expect(makeResult.status).toBe(201);
  const make = (await receipt(makeResult)).receipt.resourceId;
  makes.push(make);
  const modelResult = await createModelRoute(
    req("/api/v1/staff/ops/vehicle-catalog/models", "POST", ops.cookie, {
      commandId: crypto.randomUUID(),
      makeId: make,
      code: "MODEL",
      nameEn: "Synthetic race model",
      nameAr: "طراز سباق اختباري",
      evidenceRef: "CI:RACE:MODEL",
    })
  );
  expect(modelResult.status).toBe(201);
  return { makeId: make, modelId: (await receipt(modelResult)).receipt.resourceId };
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

  it("returns indistinguishable 404 for foreign PATCH, DELETE and receipt replay without mutation", async () => {
    const owner = await customer("+201012345685");
    const foreign = await customer("+201012345686");
    const createId = crypto.randomUUID();
    const created = await postGarage(owner.cookie, createId);
    expect(created.status).toBe(201);
    const vehicleId = (await receipt(created)).receipt.resourceId;
    const foreignEditId = crypto.randomUUID();
    const foreignArchiveId = crypto.randomUUID();
    const edit = await editGarage(
      req(`/api/v1/garage/${vehicleId}`, "PATCH", foreign.cookie, {
        commandId: foreignEditId,
        expectedVersion: 1,
        makeId,
        modelId,
        modelYear: 2023,
      }),
      { params: Promise.resolve({ id: vehicleId }) }
    );
    const archive = await archiveGarage(
      req(`/api/v1/garage/${vehicleId}`, "DELETE", foreign.cookie, {
        commandId: foreignArchiveId,
        expectedVersion: 1,
      }),
      { params: Promise.resolve({ id: vehicleId }) }
    );
    const replay = await postGarage(foreign.cookie, createId);
    const foreignLookup = await commandGarage(
      req(`/api/v1/garage/commands/${createId}`, "GET", foreign.cookie),
      { params: Promise.resolve({ commandId: createId }) }
    );
    const missingId = crypto.randomUUID();
    const missing = await readGarage(req(`/api/v1/garage/${missingId}`, "GET", foreign.cookie), {
      params: Promise.resolve({ id: missingId }),
    });
    expect([
      edit.status,
      archive.status,
      replay.status,
      foreignLookup.status,
      missing.status,
    ]).toEqual([404, 404, 404, 404, 404]);
    const current = await getPrisma().customerVehicle.findUniqueOrThrow({
      where: { id: vehicleId },
    });
    expect({
      owner: current.ownerUserId,
      version: current.version,
      year: current.modelYear,
      archive: current.archivedAt,
    }).toEqual({ owner: owner.id, version: 1, year: 2022, archive: null });
    expect(
      await getPrisma().vehicleCommand.count({
        where: { commandId: { in: [createId, foreignEditId, foreignArchiveId] } },
      })
    ).toBe(1);
    expect(
      await getPrisma().securityAuditEvent.count({
        where: {
          actorUserId: foreign.id,
          eventType: {
            in: [
              "CUSTOMER_VEHICLE_CREATED",
              "CUSTOMER_VEHICLE_UPDATED",
              "CUSTOMER_VEHICLE_ARCHIVED",
            ],
          },
        },
      })
    ).toBe(0);
  });

  it("requires verified canonical Egyptian mobile identity and permits a real dual-profile owner only", async () => {
    const actor = await customer("+201012345687");
    await getPrisma().user.update({
      where: { id: actor.id },
      data: { phoneNumberVerified: false },
    });
    expect((await postGarage(actor.cookie)).status).toBe(403);
    await getPrisma().user.update({
      where: { id: actor.id },
      data: { phoneNumber: "01012345687", phoneNumberVerified: true },
    });
    expect((await postGarage(actor.cookie)).status).toBe(403);
    await getPrisma().user.update({
      where: { id: actor.id },
      data: { phoneNumber: "invalid", phoneNumberVerified: true },
    });
    expect((await postGarage(actor.cookie)).status).toBe(403);
    expect(await getPrisma().customerVehicle.count({ where: { ownerUserId: actor.id } })).toBe(0);
    await getPrisma().user.update({
      where: { id: ops.id },
      data: { phoneNumber: "+201012345688", phoneNumberVerified: true },
    });
    await getPrisma().customerProfile.create({ data: { userId: ops.id } });
    const dualCreate = await postGarage(ops.cookie);
    expect(dualCreate.status).toBe(201);
    const ownId = (await receipt(dualCreate)).receipt.resourceId;
    expect(
      (
        await readGarage(req(`/api/v1/garage/${ownId}`, "GET", ops.cookie), {
          params: Promise.resolve({ id: ownId }),
        })
      ).status
    ).toBe(200);
    const foreign = await getPrisma().customerVehicle.findFirstOrThrow({
      where: { ownerUserId: primary.id },
    });
    expect(
      (
        await readGarage(req(`/api/v1/garage/${foreign.id}`, "GET", ops.cookie), {
          params: Promise.resolve({ id: foreign.id }),
        })
      ).status
    ).toBe(404);
    expect(
      (await getPrisma().customerVehicle.findUniqueOrThrow({ where: { id: ownId } })).ownerUserId
    ).toBe(ops.id);
  });

  it("independently rejects idle and absolute expiry and never revives a revoked session", async () => {
    const idle = await customer("+201012345689");
    const absolute = await customer("+201012345690");
    const touch = await customer("+201012345691");
    const db = getPrisma();
    const idleSession = await db.session.findFirstOrThrow({ where: { userId: idle.id } });
    const absoluteSession = await db.session.findFirstOrThrow({ where: { userId: absolute.id } });
    const touchSession = await db.session.findFirstOrThrow({ where: { userId: touch.id } });
    await db.session.update({
      where: { id: idleSession.id },
      data: { lastActivityAt: new Date(Date.now() - 8 * 86400000) },
    });
    await db.session.update({
      where: { id: absoluteSession.id },
      data: { createdAt: new Date(Date.now() - 31 * 86400000) },
    });
    expect((await listGarage(req("/api/v1/garage", "GET", idle.cookie))).status).toBe(401);
    expect((await listGarage(req("/api/v1/garage", "GET", absolute.cookie))).status).toBe(401);
    const oldActivity = new Date(Date.now() - 6 * 60000);
    await db.session.update({
      where: { id: touchSession.id },
      data: { lastActivityAt: oldActivity },
    });
    const createId = crypto.randomUUID();
    expect((await postGarage(touch.cookie, createId)).status).toBe(201);
    const advanced = await db.session.findUniqueOrThrow({ where: { id: touchSession.id } });
    expect(advanced.lastActivityAt.getTime()).toBeGreaterThan(oldActivity.getTime());
    expect((await listGarage(req("/api/v1/garage", "GET", touch.cookie))).status).toBe(200);
    const throttled = await db.session.findUniqueOrThrow({ where: { id: touchSession.id } });
    expect(throttled.lastActivityAt.getTime()).toBe(advanced.lastActivityAt.getTime());
    await db.session.delete({ where: { id: touchSession.id } });
    expect((await listGarage(req("/api/v1/garage", "GET", touch.cookie))).status).toBe(401);
    expect(
      (
        await commandGarage(req(`/api/v1/garage/commands/${createId}`, "GET", touch.cookie), {
          params: Promise.resolve({ commandId: createId }),
        })
      ).status
    ).toBe(401);
    expect(await db.vehicleCommand.count({ where: { commandId: createId } })).toBe(1);
  });

  it("reconciles lost HTTP response through owner receipt and replay without confusing historical and current state", async () => {
    const owner = await customer("+201012345692");
    const foreign = await customer("+201012345693");
    const commandId = crypto.randomUUID();
    const unobserved = await postGarage(owner.cookie, commandId);
    expect(unobserved.status).toBe(201); // Deliberately do not inspect its body.
    const lookup = await commandGarage(
      req(`/api/v1/garage/commands/${commandId}`, "GET", owner.cookie),
      { params: Promise.resolve({ commandId }) }
    );
    expect(lookup.status).toBe(200);
    const historical = await receipt(lookup);
    const replayed = await receipt(await postGarage(owner.cookie, commandId));
    expect(replayed.replayed).toBe(true);
    expect(replayed.receipt.resourceId).toBe(historical.receipt.resourceId);
    expect(
      await getPrisma().customerVehicle.count({
        where: { id: historical.receipt.resourceId, ownerUserId: owner.id },
      })
    ).toBe(1);
    expect(
      await getPrisma().vehicleCommand.count({
        where: { commandId, actorUserId: owner.id, domain: "GARAGE", action: "CREATE" },
      })
    ).toBe(1);
    expect(
      await getPrisma().securityAuditEvent.count({
        where: {
          actorUserId: owner.id,
          eventType: "CUSTOMER_VEHICLE_CREATED",
          targetEntity: `customer_vehicle:${historical.receipt.resourceId}`,
        },
      })
    ).toBe(1);
    expect((await postGarage(owner.cookie, commandId, { modelYear: 2023 })).status).toBe(409);
    expect((await postGarage(foreign.cookie, commandId)).status).toBe(404);
    const anotherVehicleId = (await receipt(await postGarage(owner.cookie))).receipt.resourceId;
    expect(
      (
        await editGarage(
          req(`/api/v1/garage/${historical.receipt.resourceId}`, "PATCH", owner.cookie, {
            commandId,
            expectedVersion: 1,
            makeId,
            modelId,
            modelYear: 2023,
          }),
          { params: Promise.resolve({ id: historical.receipt.resourceId }) }
        )
      ).status
    ).toBe(409);
    expect(
      (
        await archiveGarage(
          req(`/api/v1/garage/${anotherVehicleId}`, "DELETE", owner.cookie, {
            commandId,
            expectedVersion: 1,
          }),
          { params: Promise.resolve({ id: anotherVehicleId }) }
        )
      ).status
    ).toBe(409);
    expect(
      (await getPrisma().customerVehicle.findUniqueOrThrow({ where: { id: anotherVehicleId } }))
        .archivedAt
    ).toBeNull();
    expect(
      (
        await catalogCommandRoute(
          req(`/api/v1/staff/ops/vehicle-catalog/commands/${commandId}`, "GET", ops.cookie),
          { params: Promise.resolve({ commandId }) }
        )
      ).status
    ).toBe(404);
    const archiveId = crypto.randomUUID();
    expect(
      (
        await archiveGarage(
          req(`/api/v1/garage/${historical.receipt.resourceId}`, "DELETE", owner.cookie, {
            commandId: archiveId,
            expectedVersion: 1,
          }),
          { params: Promise.resolve({ id: historical.receipt.resourceId }) }
        )
      ).status
    ).toBe(200);
    const after = await readGarage(
      req(`/api/v1/garage/${historical.receipt.resourceId}`, "GET", owner.cookie),
      { params: Promise.resolve({ id: historical.receipt.resourceId }) }
    );
    expect((await after.json()).version).toBe(2);
    expect(
      (
        await receipt(
          await commandGarage(req(`/api/v1/garage/commands/${commandId}`, "GET", owner.cookie), {
            params: Promise.resolve({ commandId }),
          })
        )
      ).receipt.resultVersion
    ).toBe(1);
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

  it("orders edit then archive at one version, rejects stale archive, and later archives terminally", async () => {
    const vehicleId = (await receipt(await postGarage(other.cookie))).receipt.resourceId;
    const editId = crypto.randomUUID();
    const staleArchiveId = crypto.randomUUID();
    const edit = () =>
      editGarage(
        req(`/api/v1/garage/${vehicleId}`, "PATCH", other.cookie, {
          commandId: editId,
          expectedVersion: 1,
          makeId,
          modelId,
          modelYear: 2023,
        }),
        { params: Promise.resolve({ id: vehicleId }) }
      );
    const staleArchive = () =>
      archiveGarage(
        req(`/api/v1/garage/${vehicleId}`, "DELETE", other.cookie, {
          commandId: staleArchiveId,
          expectedVersion: 1,
        }),
        { params: Promise.resolve({ id: vehicleId }) }
      );
    const [winner, loser] = await orderedRace(
      "SELECT id FROM customer_vehicles WHERE id = $1 FOR UPDATE",
      [vehicleId],
      edit,
      staleArchive
    );
    expect([winner.status, loser.status]).toEqual([200, 409]);
    const afterRace = await getPrisma().customerVehicle.findUniqueOrThrow({
      where: { id: vehicleId },
    });
    expect({
      version: afterRace.version,
      year: afterRace.modelYear,
      archived: afterRace.archivedAt,
    }).toMatchObject({ version: 2, year: 2023, archived: null });
    expect(
      await getPrisma().vehicleCommand.count({
        where: { commandId: { in: [editId, staleArchiveId] } },
      })
    ).toBe(1);
    const finalArchiveId = crypto.randomUUID();
    const finalArchive = await archiveGarage(
      req(`/api/v1/garage/${vehicleId}`, "DELETE", other.cookie, {
        commandId: finalArchiveId,
        expectedVersion: 2,
      }),
      { params: Promise.resolve({ id: vehicleId }) }
    );
    expect(finalArchive.status).toBe(200);
    const current = await getPrisma().customerVehicle.findUniqueOrThrow({
      where: { id: vehicleId },
    });
    expect(current.version).toBe(3);
    expect(current.archivedAt).not.toBeNull();
    expect((await receipt(await edit())).replayed).toBe(true);
    expect(
      (await getPrisma().customerVehicle.findUniqueOrThrow({ where: { id: vehicleId } })).version
    ).toBe(3);
    const audits = await getPrisma().securityAuditEvent.findMany({
      where: {
        actorUserId: other.id,
        targetEntity: `customer_vehicle:${vehicleId}`,
        eventType: { in: ["CUSTOMER_VEHICLE_UPDATED", "CUSTOMER_VEHICLE_ARCHIVED"] },
      },
      select: { metadata: true },
    });
    expect(audits.map((row) => (row.metadata as { commandId?: string }).commandId).sort()).toEqual(
      [editId, finalArchiveId].sort()
    );
  });

  it("orders archive then edit at one version, rejects stale edit and terminal revival", async () => {
    const vehicleId = (await receipt(await postGarage(other.cookie))).receipt.resourceId;
    const archiveId = crypto.randomUUID();
    const editId = crypto.randomUUID();
    const archive = () =>
      archiveGarage(
        req(`/api/v1/garage/${vehicleId}`, "DELETE", other.cookie, {
          commandId: archiveId,
          expectedVersion: 1,
        }),
        { params: Promise.resolve({ id: vehicleId }) }
      );
    const edit = () =>
      editGarage(
        req(`/api/v1/garage/${vehicleId}`, "PATCH", other.cookie, {
          commandId: editId,
          expectedVersion: 1,
          makeId,
          modelId,
          modelYear: 2023,
        }),
        { params: Promise.resolve({ id: vehicleId }) }
      );
    const [winner, loser] = await orderedRace(
      "SELECT id FROM customer_vehicles WHERE id = $1 FOR UPDATE",
      [vehicleId],
      archive,
      edit
    );
    expect([winner.status, loser.status]).toEqual([200, 409]);
    const current = await getPrisma().customerVehicle.findUniqueOrThrow({
      where: { id: vehicleId },
    });
    expect(current.version).toBe(2);
    expect(current.archivedAt).not.toBeNull();
    expect(current.modelYear).toBe(2022);
    expect(
      await getPrisma().vehicleCommand.count({ where: { commandId: { in: [archiveId, editId] } } })
    ).toBe(1);
    expect((await receipt(await archive())).replayed).toBe(true);
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
    const audits = await getPrisma().securityAuditEvent.findMany({
      where: {
        actorUserId: other.id,
        targetEntity: `customer_vehicle:${vehicleId}`,
        eventType: { in: ["CUSTOMER_VEHICLE_UPDATED", "CUSTOMER_VEHICLE_ARCHIVED"] },
      },
      select: { metadata: true },
    });
    expect(audits.map((row) => (row.metadata as { commandId?: string }).commandId)).toEqual([
      archiveId,
    ]);
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

  it("rejects untrusted origins, invalid years and oversized payloads without receipt or audit", async () => {
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
    const oversized = await postGarage(primary.cookie, commandId, { surplus: "x".repeat(5000) });
    expect(oversized.status).toBe(400);
    expect(await getPrisma().vehicleCommand.count({ where: { commandId } })).toBe(0);
    const audit = await getPrisma().securityAuditEvent.findMany({
      where: { actorUserId: primary.id, eventType: "CUSTOMER_VEHICLE_CREATED" },
      select: { metadata: true },
    });
    expect(
      audit.some((row) => (row.metadata as { commandId?: string }).commandId === commandId)
    ).toBe(false);
  });

  it("enforces the Cairo-year upper bound, strict nested payloads, list limits and owner cursors without writes", async () => {
    const db = getPrisma();
    const commandId = crypto.randomUUID();
    const cairoYear = Number(
      new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", year: "numeric" }).format(
        new Date()
      )
    );
    const invalidYear = await postGarage(primary.cookie, commandId, { modelYear: cairoYear + 2 });
    const nested = await postGarage(primary.cookie, commandId, {
      make: { id: makeId },
      ownerUserId: primary.id,
    });
    expect([invalidYear.status, nested.status]).toEqual([400, 400]);
    const badLists = ["?limit=51", "?limit=-1", "?limit=1.5", "?cursor=not-a-uuid"];
    for (const suffix of badLists)
      expect((await listGarage(req(`/api/v1/garage${suffix}`, "GET", primary.cookie))).status).toBe(
        400
      );
    const otherVehicle = (await receipt(await postGarage(other.cookie))).receipt.resourceId;
    expect(
      (await listGarage(req(`/api/v1/garage?cursor=${otherVehicle}`, "GET", primary.cookie))).status
    ).toBe(404);
    expect((await publicCatalog(req("/api/v1/vehicles/catalog?limit=51"))).status).toBe(400);
    expect(
      (
        await listMakeRoute(
          req("/api/v1/staff/ops/vehicle-catalog/makes?limit=0", "GET", ops.cookie)
        )
      ).status
    ).toBe(400);
    expect(
      (
        await listModelRoute(
          req("/api/v1/staff/ops/vehicle-catalog/models?makeId=invalid", "GET", ops.cookie)
        )
      ).status
    ).toBe(400);
    expect(await db.vehicleCommand.count({ where: { commandId } })).toBe(0);
    expect(
      await db.customerVehicle.count({
        where: { ownerUserId: primary.id, modelYear: cairoYear + 2 },
      })
    ).toBe(0);
    expect(
      await db.securityAuditEvent.count({
        where: {
          actorUserId: primary.id,
          eventType: "CUSTOMER_VEHICLE_CREATED",
          metadata: { path: ["commandId"], equals: commandId },
        },
      })
    ).toBe(0);
  });

  it("returns exact public, customer and Ops nested DTO allowlists with no-store headers", async () => {
    const carId = (await receipt(await postGarage(other.cookie))).receipt.resourceId;
    const car = await readGarage(req(`/api/v1/garage/${carId}`, "GET", other.cookie), {
      params: Promise.resolve({ id: carId }),
    });
    expect(car.headers.get("cache-control")).toBe("no-store");
    const carDto = await car.json();
    expect(Object.keys(carDto).sort()).toEqual(
      [
        "id",
        "makeId",
        "modelId",
        "modelYear",
        "version",
        "archivedAt",
        "createdAt",
        "updatedAt",
        "make",
        "model",
        "catalogAvailable",
        "fitmentStatus",
      ].sort()
    );
    for (const nested of [carDto.make, carDto.model])
      expect(Object.keys(nested).sort()).toEqual(["code", "nameEn", "nameAr", "isActive"].sort());
    const list = await listGarage(req("/api/v1/garage?limit=1", "GET", other.cookie));
    expect(list.headers.get("cache-control")).toBe("no-store");
    expect(Object.keys(await list.json()).sort()).toEqual(["items", "nextCursor"]);
    const publicMakes = await publicCatalog(req("/api/v1/vehicles/catalog"));
    expect(publicMakes.headers.get("cache-control")).toBe("no-store");
    const publicMakeDto = (await publicMakes.json()).items.find(
      (row: { id: string }) => row.id === makeId
    );
    expect(Object.keys(publicMakeDto).sort()).toEqual(["id", "code", "nameEn", "nameAr"].sort());
    const publicModels = await publicCatalog(req(`/api/v1/vehicles/catalog?makeId=${makeId}`));
    expect(publicModels.headers.get("cache-control")).toBe("no-store");
    const publicModelDto = (await publicModels.json()).items.find(
      (row: { id: string }) => row.id === modelId
    );
    expect(Object.keys(publicModelDto).sort()).toEqual(
      ["id", "makeId", "code", "nameEn", "nameAr"].sort()
    );
    const privateMakes = await listMakeRoute(
      req("/api/v1/staff/ops/vehicle-catalog/makes", "GET", ops.cookie)
    );
    expect(privateMakes.headers.get("cache-control")).toBe("no-store");
    const privateMakeDto = (await privateMakes.json()).items.find(
      (row: { id: string }) => row.id === makeId
    );
    expect(Object.keys(privateMakeDto).sort()).toEqual(
      ["id", "code", "nameEn", "nameAr", "evidenceRef", "isActive", "version"].sort()
    );
    const privateModels = await listModelRoute(
      req(`/api/v1/staff/ops/vehicle-catalog/models?makeId=${makeId}`, "GET", ops.cookie)
    );
    expect(privateModels.headers.get("cache-control")).toBe("no-store");
    const privateModelDto = (await privateModels.json()).items.find(
      (row: { id: string }) => row.id === modelId
    );
    expect(Object.keys(privateModelDto).sort()).toEqual(
      ["id", "makeId", "code", "nameEn", "nameAr", "evidenceRef", "isActive", "version"].sort()
    );
    const commandId = crypto.randomUUID();
    const response = await postGarage(other.cookie, commandId);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const payload = await response.json();
    expect(Object.keys(payload).sort()).toEqual(["receipt", "replayed"].sort());
    expect(Object.keys(payload.receipt).sort()).toEqual(
      ["commandId", "action", "resourceId", "outcome", "resultVersion", "recordedAt"].sort()
    );
    expect(JSON.stringify({ carDto, publicMakeDto, publicModelDto, payload })).not.toMatch(
      /evidenceRef|phoneNumber|ownerUserId|customerProfileId|fingerprint|token|secret/i
    );
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

  it("scopes duplicate model codes per make and rejects duplicate make codes without partial receipts", async () => {
    const first = await createCatalogPair(crypto.randomUUID().slice(0, 8).toUpperCase());
    const second = await createCatalogPair(crypto.randomUUID().slice(0, 8).toUpperCase());
    const makeCode = (
      await getPrisma().vehicleMake.findUniqueOrThrow({ where: { id: first.makeId } })
    ).code;
    const makeKey = crypto.randomUUID();
    const duplicateMake = await createMakeRoute(
      req("/api/v1/staff/ops/vehicle-catalog/makes", "POST", ops.cookie, {
        commandId: makeKey,
        code: makeCode,
        nameEn: "Duplicate",
        nameAr: "مكرر",
        evidenceRef: "CI:DUP:MAKE",
      })
    );
    expect(duplicateMake.status).toBe(409);
    const modelKey = crypto.randomUUID();
    const duplicateModel = await createModelRoute(
      req("/api/v1/staff/ops/vehicle-catalog/models", "POST", ops.cookie, {
        commandId: modelKey,
        makeId: first.makeId,
        code: "MODEL",
        nameEn: "Duplicate",
        nameAr: "مكرر",
        evidenceRef: "CI:DUP:MODEL",
      })
    );
    expect(duplicateModel.status).toBe(409);
    expect(
      (await getPrisma().vehicleModel.findUniqueOrThrow({ where: { id: second.modelId } })).code
    ).toBe("MODEL");
    expect(
      await getPrisma().vehicleModel.count({
        where: { code: "MODEL", makeId: { in: [first.makeId, second.makeId] } },
      })
    ).toBe(2);
    expect(
      await getPrisma().vehicleCatalogEntry.count({
        where: { commandId: { in: [makeKey, modelKey] } },
      })
    ).toBe(0);
    expect(
      await getPrisma().securityAuditEvent.count({
        where: { actorUserId: ops.id, metadata: { path: ["commandId"], string_contains: makeKey } },
      })
    ).toBe(0);
    expect(
      await getPrisma().securityAuditEvent.count({
        where: {
          actorUserId: ops.id,
          metadata: { path: ["commandId"], string_contains: modelKey },
        },
      })
    ).toBe(0);
  });

  it("rejects create and edit selecting an inactive make without altering an existing vehicle", async () => {
    const inactive = await createCatalogPair(crypto.randomUUID().slice(0, 8).toUpperCase());
    const owner = await customer("+201012345694");
    const existingId = (await receipt(await postGarage(owner.cookie))).receipt.resourceId;
    const deactivation = await updateMakeRoute(
      req(`/api/v1/staff/ops/vehicle-catalog/makes/${inactive.makeId}`, "PATCH", ops.cookie, {
        commandId: crypto.randomUUID(),
        expectedVersion: 1,
        nameEn: "Synthetic race make",
        nameAr: "ماركة سباق اختبارية",
        evidenceRef: "CI:RACE:MAKE",
        isActive: false,
      }),
      { params: Promise.resolve({ id: inactive.makeId }) }
    );
    expect(deactivation.status).toBe(200);
    const createId = crypto.randomUUID();
    const editId = crypto.randomUUID();
    const create = await postGarage(owner.cookie, createId, inactive);
    const edit = await editGarage(
      req(`/api/v1/garage/${existingId}`, "PATCH", owner.cookie, {
        commandId: editId,
        expectedVersion: 1,
        ...inactive,
        modelYear: 2023,
      }),
      { params: Promise.resolve({ id: existingId }) }
    );
    expect([create.status, edit.status]).toEqual([409, 409]);
    const current = await getPrisma().customerVehicle.findUniqueOrThrow({
      where: { id: existingId },
    });
    expect({
      makeId: current.makeId,
      modelId: current.modelId,
      modelYear: current.modelYear,
      version: current.version,
    }).toEqual({ makeId, modelId, modelYear: 2022, version: 1 });
    expect(
      await getPrisma().vehicleCommand.count({ where: { commandId: { in: [createId, editId] } } })
    ).toBe(0);
    const publicModels = await publicCatalog(
      req(`/api/v1/vehicles/catalog?makeId=${inactive.makeId}`)
    );
    expect(publicModels.status).toBe(404);
  });

  it("times out on an actual PostgreSQL profile lock, rolls back, and retries the same key safely", async () => {
    const owner = await customer("+201012345695");
    const profile = await getPrisma().customerProfile.findUniqueOrThrow({
      where: { userId: owner.id },
    });
    const commandId = crypto.randomUUID();
    const blocker = new pg.Client({ connectionString: url });
    await blocker.connect();
    try {
      await blocker.query("BEGIN");
      const pid = Number((await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
      await blocker.query("SELECT id FROM customer_profile WHERE id = $1 FOR UPDATE", [profile.id]);
      const pending = postGarage(owner.cookie, commandId);
      await waitForBlockedCommands(blocker, pid, 1);
      const timedOut = await pending;
      expect(timedOut.status).toBe(503);
      expect(await timedOut.json()).toEqual({ error: "SERVICE_UNAVAILABLE" });
      expect(await getPrisma().vehicleCommand.count({ where: { commandId } })).toBe(0);
      expect(await getPrisma().customerVehicle.count({ where: { ownerUserId: owner.id } })).toBe(0);
      await blocker.query("COMMIT");
    } finally {
      await blocker.query("ROLLBACK").catch(() => {});
      await blocker.end();
    }
    expect((await postGarage(owner.cookie, commandId)).status).toBe(201);
    expect(await getPrisma().vehicleCommand.count({ where: { commandId } })).toBe(1);
    expect(await getPrisma().customerVehicle.count({ where: { ownerUserId: owner.id } })).toBe(1);
  });

  it("sanitizes an actual database exception and never falls through to demo data", async () => {
    if (new URL(url).pathname !== "/waffarhacars_test")
      throw new Error("Fault injection requires ephemeral test database");
    const owner = await customer("+201012345696");
    const commandId = crypto.randomUUID();
    const marker = "SYNTHETIC_SQL_HOST_PII_TOKEN_MUST_NOT_LEAK";
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      await client.query(
        `CREATE FUNCTION vehicle_storage_failure_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."ownerUserId" = '${owner.id}'::uuid THEN RAISE EXCEPTION '${marker}'; END IF; RETURN NEW; END; $$`
      );
      await client.query(
        "CREATE TRIGGER vehicle_storage_failure_test BEFORE INSERT ON customer_vehicles FOR EACH ROW EXECUTE FUNCTION vehicle_storage_failure_test()"
      );
      const failed = await postGarage(owner.cookie, commandId);
      expect(failed.status).toBe(503);
      expect(failed.headers.get("cache-control")).toBe("no-store");
      expect(await failed.json()).toEqual({ error: "SERVICE_UNAVAILABLE" });
      expect(await getPrisma().vehicleCommand.count({ where: { commandId } })).toBe(0);
      expect(await getPrisma().customerVehicle.count({ where: { ownerUserId: owner.id } })).toBe(0);
    } finally {
      await client.query(
        "DROP TRIGGER IF EXISTS vehicle_storage_failure_test ON customer_vehicles"
      );
      await client.query("DROP FUNCTION IF EXISTS vehicle_storage_failure_test()");
      await client.end();
    }
    process.env.APP_DATA_BACKEND = "demo";
    resetServerEnvCache();
    try {
      const fallback = await postGarage(owner.cookie, commandId);
      expect(fallback.status).toBe(503);
      expect(await fallback.json()).toEqual({ error: "SERVICE_UNAVAILABLE" });
    } finally {
      process.env.APP_DATA_BACKEND = "postgres";
      resetServerEnvCache();
    }
    expect(await getPrisma().vehicleCommand.count({ where: { commandId } })).toBe(0);
    expect((await postGarage(owner.cookie, commandId)).status).toBe(201);
  });

  it("blocks both create commands behind one owned profile row and caps nine active cars at ten", async () => {
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
    const [first, second] = await orderedRace(
      "SELECT id FROM customer_profile WHERE id = $1 FOR UPDATE",
      [profile.id],
      () => postGarage(primary.cookie, firstId),
      () => postGarage(primary.cookie, secondId)
    );
    expect([first.status, second.status]).toEqual([201, 409]);
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
    expect(auditIds).toEqual([firstId]);
  });

  it("orders archive before create at the active limit and commits both count-changing commands", async () => {
    const owner = await customer("+201012345680");
    const seeded = await seedActiveCars(owner, 10);
    const archiveId = crypto.randomUUID();
    const createId = crypto.randomUUID();
    const archive = () =>
      archiveGarage(
        req(`/api/v1/garage/${seeded.ids[0]}`, "DELETE", owner.cookie, {
          commandId: archiveId,
          expectedVersion: 1,
        }),
        { params: Promise.resolve({ id: seeded.ids[0] }) }
      );
    const [first, second] = await orderedRace(
      "SELECT id FROM customer_profile WHERE id = $1 FOR UPDATE",
      [seeded.profileId],
      archive,
      () => postGarage(owner.cookie, createId)
    );
    expect([first.status, second.status]).toEqual([200, 201]);
    expect(
      await getPrisma().customerVehicle.count({
        where: { ownerUserId: owner.id, archivedAt: null },
      })
    ).toBe(10);
    expect(
      (await getPrisma().customerVehicle.findUniqueOrThrow({ where: { id: seeded.ids[0] } }))
        .archivedAt
    ).not.toBeNull();
    expect(
      await getPrisma().vehicleCommand.count({
        where: { commandId: { in: [archiveId, createId] } },
      })
    ).toBe(2);
    const audit = await getPrisma().securityAuditEvent.findMany({
      where: {
        actorUserId: owner.id,
        eventType: { in: ["CUSTOMER_VEHICLE_CREATED", "CUSTOMER_VEHICLE_ARCHIVED"] },
      },
      select: { metadata: true },
    });
    expect(audit.map((row) => (row.metadata as { commandId?: string }).commandId).sort()).toEqual(
      [archiveId, createId].sort()
    );
  });

  it("orders create before archive at the active limit, rejects create and frees one slot", async () => {
    const owner = await customer("+201012345681");
    const seeded = await seedActiveCars(owner, 10);
    const createId = crypto.randomUUID();
    const archiveId = crypto.randomUUID();
    const [first, second] = await orderedRace(
      "SELECT id FROM customer_profile WHERE id = $1 FOR UPDATE",
      [seeded.profileId],
      () => postGarage(owner.cookie, createId),
      () =>
        archiveGarage(
          req(`/api/v1/garage/${seeded.ids[0]}`, "DELETE", owner.cookie, {
            commandId: archiveId,
            expectedVersion: 1,
          }),
          { params: Promise.resolve({ id: seeded.ids[0] }) }
        )
    );
    expect([first.status, second.status]).toEqual([409, 200]);
    expect(
      await getPrisma().customerVehicle.count({
        where: { ownerUserId: owner.id, archivedAt: null },
      })
    ).toBe(9);
    expect(
      await getPrisma().vehicleCommand.count({
        where: { commandId: { in: [createId, archiveId] } },
      })
    ).toBe(1);
    const audit = await getPrisma().securityAuditEvent.findMany({
      where: {
        actorUserId: owner.id,
        eventType: { in: ["CUSTOMER_VEHICLE_CREATED", "CUSTOMER_VEHICLE_ARCHIVED"] },
      },
      select: { metadata: true },
    });
    expect(audit.map((row) => (row.metadata as { commandId?: string }).commandId)).toEqual([
      archiveId,
    ]);
  });

  it("orders make deactivation before create so the new selection is refused with no receipt", async () => {
    const catalog = await createCatalogPair(crypto.randomUUID().slice(0, 8).toUpperCase());
    const owner = await customer("+201012345682");
    const deactivateId = crypto.randomUUID();
    const createId = crypto.randomUUID();
    const deactivate = () =>
      updateMakeRoute(
        req(`/api/v1/staff/ops/vehicle-catalog/makes/${catalog.makeId}`, "PATCH", ops.cookie, {
          commandId: deactivateId,
          expectedVersion: 1,
          nameEn: "Synthetic race make",
          nameAr: "ماركة سباق اختبارية",
          evidenceRef: "CI:RACE:MAKE",
          isActive: false,
        }),
        { params: Promise.resolve({ id: catalog.makeId }) }
      );
    const [first, second] = await orderedRace(
      "SELECT id FROM vehicle_makes WHERE id = $1 FOR UPDATE",
      [catalog.makeId],
      deactivate,
      () => postGarage(owner.cookie, createId, catalog)
    );
    expect([first.status, second.status]).toEqual([200, 409]);
    expect(await getPrisma().customerVehicle.count({ where: { ownerUserId: owner.id } })).toBe(0);
    expect(await getPrisma().vehicleCommand.count({ where: { commandId: createId } })).toBe(0);
    expect(
      await getPrisma().vehicleCatalogEntry.count({ where: { commandId: deactivateId } })
    ).toBe(1);
    expect(
      await getPrisma().securityAuditEvent.count({
        where: {
          actorUserId: ops.id,
          eventType: "VEHICLE_MAKE_UPDATED",
          targetEntity: `vehicle_make:${catalog.makeId}`,
        },
      })
    ).toBe(1);
  });

  it("orders create before make deactivation and retains the accepted vehicle as unavailable", async () => {
    const catalog = await createCatalogPair(crypto.randomUUID().slice(0, 8).toUpperCase());
    const owner = await customer("+201012345683");
    const createId = crypto.randomUUID();
    const deactivateId = crypto.randomUUID();
    const deactivate = () =>
      updateMakeRoute(
        req(`/api/v1/staff/ops/vehicle-catalog/makes/${catalog.makeId}`, "PATCH", ops.cookie, {
          commandId: deactivateId,
          expectedVersion: 1,
          nameEn: "Synthetic race make",
          nameAr: "ماركة سباق اختبارية",
          evidenceRef: "CI:RACE:MAKE",
          isActive: false,
        }),
        { params: Promise.resolve({ id: catalog.makeId }) }
      );
    const [first, second] = await orderedRace(
      // The create acquires make before it waits on model. The deactivation
      // then waits on the create-held make, forming an observable blocker chain.
      "SELECT id FROM vehicle_models WHERE id = $1 FOR UPDATE",
      [catalog.modelId],
      () => postGarage(owner.cookie, createId, catalog),
      deactivate
    );
    expect([first.status, second.status]).toEqual([201, 200]);
    const id = (await receipt(first)).receipt.resourceId;
    const current = await readGarage(req(`/api/v1/garage/${id}`, "GET", owner.cookie), {
      params: Promise.resolve({ id }),
    });
    expect(current.status).toBe(200);
    expect((await current.json()).catalogAvailable).toBe(false);
    expect(await getPrisma().vehicleCommand.count({ where: { commandId: createId } })).toBe(1);
    expect(await getPrisma().customerVehicle.count({ where: { id, archivedAt: null } })).toBe(1);
  });

  it("orders model deactivation before an edit selecting it and preserves the original car", async () => {
    const catalog = await createCatalogPair(crypto.randomUUID().slice(0, 8).toUpperCase());
    const owner = await customer("+201012345684");
    const vehicleId = (await receipt(await postGarage(owner.cookie))).receipt.resourceId;
    const deactivateId = crypto.randomUUID();
    const editId = crypto.randomUUID();
    const deactivate = () =>
      updateModelRoute(
        req(`/api/v1/staff/ops/vehicle-catalog/models/${catalog.modelId}`, "PATCH", ops.cookie, {
          commandId: deactivateId,
          expectedVersion: 1,
          nameEn: "Synthetic race model",
          nameAr: "طراز سباق اختباري",
          evidenceRef: "CI:RACE:MODEL",
          isActive: false,
        }),
        { params: Promise.resolve({ id: catalog.modelId }) }
      );
    const edit = () =>
      editGarage(
        req(`/api/v1/garage/${vehicleId}`, "PATCH", owner.cookie, {
          commandId: editId,
          expectedVersion: 1,
          makeId: catalog.makeId,
          modelId: catalog.modelId,
          modelYear: 2023,
        }),
        { params: Promise.resolve({ id: vehicleId }) }
      );
    const [first, second] = await orderedRace(
      "SELECT id FROM vehicle_models WHERE id = $1 FOR UPDATE",
      [catalog.modelId],
      deactivate,
      edit
    );
    expect([first.status, second.status]).toEqual([200, 409]);
    const current = await getPrisma().customerVehicle.findUniqueOrThrow({
      where: { id: vehicleId },
    });
    expect({
      makeId: current.makeId,
      modelId: current.modelId,
      modelYear: current.modelYear,
      version: current.version,
    }).toEqual({ makeId, modelId, modelYear: 2022, version: 1 });
    expect(await getPrisma().vehicleCommand.count({ where: { commandId: editId } })).toBe(0);
    expect(
      await getPrisma().vehicleCatalogEntry.count({ where: { commandId: deactivateId } })
    ).toBe(1);
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
