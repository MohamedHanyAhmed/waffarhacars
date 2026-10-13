import "server-only";
import crypto from "node:crypto";
import { z } from "zod";
import type { NextRequest } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/db";
import { assertAuthenticated, assertStaffPermission, AuthorizationError } from "@/lib/dal";
import { logAuditEvent } from "@/lib/dal/audit";
import { normalizeEgyptianPhone } from "@/lib/phone";
import { validateRequestOrigin } from "@/lib/security/origin";

export const uuid = z.string().uuid();
const code = z.string().regex(/^[A-Z0-9][A-Z0-9_-]{1,47}$/);
const label = z.string().trim().min(1).max(120);
const evidenceRef = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/);
const cairoYear = () =>
  Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", year: "numeric" }).format(
      new Date()
    )
  );
const year = z
  .number()
  .int()
  .min(1900)
  .refine((value) => value <= cairoYear() + 1);
export const createMakeSchema = z
  .object({ commandId: uuid, code, nameEn: label, nameAr: label, evidenceRef })
  .strict();
export const createModelSchema = createMakeSchema.extend({ makeId: uuid });
export const updateCatalogSchema = z
  .object({
    commandId: uuid,
    expectedVersion: z.number().int().positive(),
    nameEn: label,
    nameAr: label,
    evidenceRef,
    isActive: z.boolean(),
  })
  .strict();
export const createVehicleSchema = z
  .object({ commandId: uuid, makeId: uuid, modelId: uuid, modelYear: year })
  .strict();
export const editVehicleSchema = z
  .object({
    commandId: uuid,
    expectedVersion: z.number().int().positive(),
    makeId: uuid,
    modelId: uuid,
    modelYear: year,
  })
  .strict();
export const archiveVehicleSchema = z
  .object({ commandId: uuid, expectedVersion: z.number().int().positive() })
  .strict();

export class VehicleError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 422 | 503,
    readonly code: string
  ) {
    super(code);
  }
  toResponse(): Response {
    return Response.json(
      { error: this.code },
      { status: this.status, headers: { "Cache-Control": "no-store" } }
    );
  }
}

const unavailable = () => new VehicleError(503, "SERVICE_UNAVAILABLE");
const conflict = (code: string) => new VehicleError(409, code);
const notFound = () => new VehicleError(404, "NOT_FOUND");
const fingerprint = (domain: string, action: string, resource: string, input: unknown) =>
  crypto
    .createHash("sha256")
    .update(JSON.stringify(["vehicle-command-v1", domain, action, resource, input]))
    .digest("hex");

export async function customerActor(req: NextRequest) {
  const session = await assertAuthenticated(req.headers);
  try {
    const prisma = getPrisma();
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        phoneNumber: true,
        phoneNumberVerified: true,
        customerProfile: { select: { id: true } },
      },
    });
    if (!user?.customerProfile || user.phoneNumberVerified !== true || !user.phoneNumber)
      throw new VehicleError(403, "CUSTOMER_REQUIRED");
    const normalized = normalizeEgyptianPhone(user.phoneNumber);
    if (!normalized.success || normalized.canonicalE164 !== user.phoneNumber)
      throw new VehicleError(403, "CUSTOMER_REQUIRED");
    if (new Date(session.session.expiresAt) <= new Date())
      throw new AuthorizationError(401, "UNAUTHENTICATED", "Authentication required");
    const persisted = await prisma.session.findFirst({
      where: { id: session.session.id, userId: session.user.id },
      select: { createdAt: true, lastActivityAt: true, expiresAt: true },
    });
    const now = Date.now();
    if (
      !persisted ||
      persisted.expiresAt.getTime() <= now ||
      persisted.createdAt.getTime() + 30 * 86400000 <= now ||
      persisted.lastActivityAt.getTime() + 7 * 86400000 <= now
    )
      throw new AuthorizationError(401, "UNAUTHENTICATED", "Authentication required");
    if (persisted.lastActivityAt.getTime() + 5 * 60000 <= now) {
      await prisma.session.updateMany({
        where: {
          id: session.session.id,
          userId: session.user.id,
          lastActivityAt: persisted.lastActivityAt,
        },
        data: { lastActivityAt: new Date(now) },
      });
    }
    return { userId: session.user.id, profileId: user.customerProfile.id };
  } catch (error) {
    if (error instanceof VehicleError || error instanceof AuthorizationError) throw error;
    throw unavailable();
  }
}

export async function withVehicleApi(
  req: NextRequest,
  kind: "customer" | "ops" | "public",
  handler: (actor: { userId: string; profileId?: string } | null) => Promise<Response>
): Promise<Response> {
  try {
    if (req.method !== "GET" && !validateRequestOrigin(req).valid)
      throw new VehicleError(403, "ORIGIN_DENIED");
    const actor =
      kind === "customer"
        ? await customerActor(req)
        : kind === "ops"
          ? { userId: (await assertStaffPermission(req.headers, "vehicle_catalog:manage")).userId }
          : null;
    return await handler(actor);
  } catch (error) {
    if (error instanceof VehicleError || error instanceof AuthorizationError)
      return error.toResponse();
    return unavailable().toResponse();
  }
}

export async function body<T>(req: NextRequest, schema: z.ZodType<T>): Promise<T> {
  if (!req.body) throw new VehicleError(400, "INVALID_PAYLOAD");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 4096) {
        await reader.cancel().catch(() => {});
        throw new VehicleError(400, "INVALID_PAYLOAD");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof VehicleError) throw error;
    throw new VehicleError(400, "INVALID_PAYLOAD");
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new VehicleError(400, "INVALID_PAYLOAD");
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new VehicleError(400, "INVALID_PAYLOAD");
  return parsed.data;
}

async function transaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  try {
    return await getPrisma().$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT set_config('lock_timeout', '3000ms', true)`;
        return operation(tx);
      },
      { maxWait: 4000, timeout: 8000 }
    );
  } catch (error) {
    if (error instanceof VehicleError) throw error;
    if ((error as { code?: string })?.code === "P2002") throw conflict("DUPLICATE_CODE");
    throw unavailable();
  }
}

async function commandLock(tx: Prisma.TransactionClient, domain: string, commandId: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${domain}), hashtext(${commandId})) IS NULL AS locked`;
}
async function profileLock(
  tx: Prisma.TransactionClient,
  actor: { userId: string; profileId?: string }
) {
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM customer_profile WHERE id = ${actor.profileId}::uuid AND "userId" = ${actor.userId}::uuid FOR UPDATE`;
  if (rows.length !== 1) throw new VehicleError(403, "CUSTOMER_REQUIRED");
}
async function activeCatalog(tx: Prisma.TransactionClient, makeId: string, modelId: string) {
  const makes = await tx.$queryRaw<
    { id: string; isActive: boolean }[]
  >`SELECT id, "isActive" FROM vehicle_makes WHERE id = ${makeId}::uuid FOR UPDATE`;
  if (makes.length !== 1 || !makes[0].isActive) throw conflict("CATALOG_INACTIVE");
  const models = await tx.$queryRaw<
    { id: string; isActive: boolean }[]
  >`SELECT id, "isActive" FROM vehicle_models WHERE id = ${modelId}::uuid AND "makeId" = ${makeId}::uuid FOR UPDATE`;
  if (models.length !== 1 || !models[0].isActive) throw conflict("CATALOG_INACTIVE");
}
type Receipt = {
  commandId: string;
  actorUserId: string;
  domain: string;
  action: string;
  resourceId: string;
  fingerprint: string;
  outcome: string;
  resultVersion: number | null;
  httpStatus: number;
  createdAt: Date;
};
function replay(
  existing: Receipt,
  actorId: string,
  domain: string,
  action: string,
  resourceId: string | null,
  hash: string
) {
  if (existing.actorUserId !== actorId || existing.domain !== domain) throw notFound();
  if (
    existing.action !== action ||
    (resourceId && existing.resourceId !== resourceId) ||
    existing.fingerprint !== hash
  )
    throw conflict("COMMAND_REUSE_CONFLICT");
  return { receipt: receiptDto(existing), replayed: true };
}
function receiptDto(value: Receipt) {
  return {
    commandId: value.commandId,
    action: value.action,
    resourceId: value.resourceId,
    outcome: value.outcome,
    resultVersion: value.resultVersion,
    recordedAt: value.createdAt,
  };
}
const jsonReceipt = (
  value: { receipt: ReturnType<typeof receiptDto>; replayed: boolean },
  status = 200
) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

export async function garageCommand(
  actor: { userId: string; profileId?: string },
  action: "CREATE" | "EDIT" | "ARCHIVE",
  resourceId: string | null,
  input:
    | z.infer<typeof createVehicleSchema>
    | z.infer<typeof editVehicleSchema>
    | z.infer<typeof archiveVehicleSchema>
) {
  const hash = fingerprint("GARAGE", action, resourceId || "", input);
  return transaction(async (tx) => {
    await commandLock(tx, "GARAGE", input.commandId);
    await profileLock(tx, actor);
    const existing = await tx.vehicleCommand.findUnique({ where: { commandId: input.commandId } });
    if (existing) return replay(existing, actor.userId, "GARAGE", action, resourceId, hash);
    const id = resourceId || crypto.randomUUID();
    let version = 1;
    if (action === "CREATE") {
      const fields = input as z.infer<typeof createVehicleSchema>;
      await activeCatalog(tx, fields.makeId, fields.modelId);
      const active = await tx.customerVehicle.count({
        where: { ownerUserId: actor.userId, archivedAt: null },
      });
      if (active >= 10) throw conflict("GARAGE_LIMIT_REACHED");
      await tx.customerVehicle.create({
        data: {
          id,
          ownerUserId: actor.userId,
          customerProfileId: actor.profileId!,
          makeId: fields.makeId,
          modelId: fields.modelId,
          modelYear: fields.modelYear,
        },
      });
    } else {
      const fields = input as z.infer<typeof editVehicleSchema>;
      const visible = await tx.customerVehicle.findFirst({
        where: { id, ownerUserId: actor.userId },
        select: { id: true },
      });
      if (!visible) throw notFound();
      if (action === "EDIT") await activeCatalog(tx, fields.makeId, fields.modelId);
      const owned = await tx.$queryRaw<
        { id: string; version: number; archivedAt: Date | null }[]
      >`SELECT id, version, "archivedAt" FROM customer_vehicles WHERE id = ${id}::uuid AND "ownerUserId" = ${actor.userId}::uuid FOR UPDATE`;
      if (owned.length !== 1) throw notFound();
      if (owned[0].archivedAt) throw conflict("VEHICLE_ARCHIVED");
      if (owned[0].version !== fields.expectedVersion) throw conflict("STALE_VERSION");
      const updated = await tx.customerVehicle.updateMany({
        where: { id, ownerUserId: actor.userId, archivedAt: null, version: fields.expectedVersion },
        data:
          action === "EDIT"
            ? {
                makeId: fields.makeId,
                modelId: fields.modelId,
                modelYear: fields.modelYear,
                version: { increment: 1 },
              }
            : { archivedAt: new Date(), version: { increment: 1 } },
      });
      if (updated.count !== 1) throw conflict("STALE_VERSION");
      version = fields.expectedVersion + 1;
    }
    const created = await tx.vehicleCommand.create({
      data: {
        commandId: input.commandId,
        actorUserId: actor.userId,
        domain: "GARAGE",
        action,
        resourceId: id,
        fingerprint: hash,
        outcome: "APPLIED",
        httpStatus: action === "CREATE" ? 201 : 200,
        resultVersion: version,
      },
    });
    await logAuditEvent(
      {
        actorUserId: actor.userId,
        eventType:
          action === "CREATE"
            ? "CUSTOMER_VEHICLE_CREATED"
            : action === "EDIT"
              ? "CUSTOMER_VEHICLE_UPDATED"
              : "CUSTOMER_VEHICLE_ARCHIVED",
        targetEntity: `customer_vehicle:${id}`,
        metadata: { action, commandId: input.commandId, version },
      },
      tx
    );
    return { receipt: receiptDto(created), replayed: false };
  });
}

export async function catalogCommand(
  actor: { userId: string },
  kind: "MAKE" | "MODEL",
  action: "CREATE" | "UPDATE",
  resourceId: string | null,
  input:
    | z.infer<typeof createMakeSchema>
    | z.infer<typeof createModelSchema>
    | z.infer<typeof updateCatalogSchema>
) {
  const commandAction = `${action}_${kind}`;
  const hash = fingerprint("CATALOG", commandAction, resourceId || "", input);
  return transaction(async (tx) => {
    await commandLock(tx, "CATALOG", input.commandId);
    const existing = await tx.vehicleCatalogEntry.findUnique({
      where: { commandId: input.commandId },
    });
    if (existing) return replay(existing, actor.userId, "CATALOG", commandAction, resourceId, hash);
    const id = resourceId || crypto.randomUUID();
    let version = 1;
    if (kind === "MAKE") {
      if (action === "CREATE") {
        const fields = input as z.infer<typeof createMakeSchema>;
        await tx.vehicleMake.create({
          data: {
            id,
            code: fields.code,
            nameEn: fields.nameEn,
            nameAr: fields.nameAr,
            evidenceRef: fields.evidenceRef,
          },
        });
      } else {
        const fields = input as z.infer<typeof updateCatalogSchema>;
        const makes = await tx.$queryRaw<
          { id: string; version: number }[]
        >`SELECT id, version FROM vehicle_makes WHERE id = ${id}::uuid FOR UPDATE`;
        if (makes.length !== 1) throw notFound();
        if (makes[0].version !== fields.expectedVersion) throw conflict("STALE_VERSION");
        await tx.vehicleMake.update({
          where: { id },
          data: {
            nameEn: fields.nameEn,
            nameAr: fields.nameAr,
            evidenceRef: fields.evidenceRef,
            isActive: fields.isActive,
            version: { increment: 1 },
          },
        });
        version = fields.expectedVersion + 1;
      }
    } else {
      if (action === "CREATE") {
        const fields = input as z.infer<typeof createModelSchema>;
        const makes = await tx.$queryRaw<
          { id: string; isActive: boolean }[]
        >`SELECT id, "isActive" FROM vehicle_makes WHERE id = ${fields.makeId}::uuid FOR UPDATE`;
        if (makes.length !== 1 || !makes[0].isActive) throw conflict("CATALOG_INACTIVE");
        await tx.vehicleModel.create({
          data: {
            id,
            makeId: fields.makeId,
            code: fields.code,
            nameEn: fields.nameEn,
            nameAr: fields.nameAr,
            evidenceRef: fields.evidenceRef,
          },
        });
      } else {
        const fields = input as z.infer<typeof updateCatalogSchema>;
        const model = await tx.vehicleModel.findUnique({ where: { id }, select: { makeId: true } });
        if (!model) throw notFound();
        await tx.$queryRaw`SELECT id FROM vehicle_makes WHERE id = ${model.makeId}::uuid FOR UPDATE`;
        const models = await tx.$queryRaw<
          { id: string; version: number }[]
        >`SELECT id, version FROM vehicle_models WHERE id = ${id}::uuid FOR UPDATE`;
        if (models.length !== 1) throw notFound();
        if (models[0].version !== fields.expectedVersion) throw conflict("STALE_VERSION");
        await tx.vehicleModel.update({
          where: { id },
          data: {
            nameEn: fields.nameEn,
            nameAr: fields.nameAr,
            evidenceRef: fields.evidenceRef,
            isActive: fields.isActive,
            version: { increment: 1 },
          },
        });
        version = fields.expectedVersion + 1;
      }
    }
    const created = await tx.vehicleCatalogEntry.create({
      data: {
        commandId: input.commandId,
        actorUserId: actor.userId,
        domain: "CATALOG",
        action: commandAction,
        resourceId: id,
        fingerprint: hash,
        outcome: "APPLIED",
        httpStatus: action === "CREATE" ? 201 : 200,
        resultVersion: version,
      },
    });
    await logAuditEvent(
      {
        actorUserId: actor.userId,
        eventType: `VEHICLE_${kind}_${action === "CREATE" ? "CREATED" : "UPDATED"}` as
          | "VEHICLE_MAKE_CREATED"
          | "VEHICLE_MAKE_UPDATED"
          | "VEHICLE_MODEL_CREATED"
          | "VEHICLE_MODEL_UPDATED",
        targetEntity: `vehicle_${kind.toLowerCase()}:${id}`,
        metadata: { action: commandAction, commandId: input.commandId, version },
      },
      tx
    );
    return { receipt: receiptDto(created), replayed: false };
  });
}

export async function garageList(actor: { userId: string }, limit: number, cursor?: string) {
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 50 ||
    (cursor && !uuid.safeParse(cursor).success)
  )
    throw new VehicleError(400, "INVALID_QUERY");
  if (
    cursor &&
    !(await getPrisma().customerVehicle.findFirst({
      where: { id: cursor, ownerUserId: actor.userId },
      select: { id: true },
    }))
  )
    throw notFound();
  const rows = await getPrisma().customerVehicle.findMany({
    where: { ownerUserId: actor.userId },
    select: vehicleSelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });
  return {
    items: rows.slice(0, limit).map(vehicleDto),
    nextCursor: rows.length > limit ? rows[limit - 1].id : null,
  };
}

export const vehicleSelect = {
  id: true,
  makeId: true,
  modelId: true,
  modelYear: true,
  version: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  make: { select: { code: true, nameEn: true, nameAr: true, isActive: true } },
  model: { select: { code: true, nameEn: true, nameAr: true, isActive: true } },
} as const;
function vehicleDto(row: {
  id: string;
  makeId: string;
  modelId: string;
  modelYear: number;
  version: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  make: { code: string; nameEn: string; nameAr: string; isActive: boolean };
  model: { code: string; nameEn: string; nameAr: string; isActive: boolean };
}) {
  return {
    id: row.id,
    makeId: row.makeId,
    modelId: row.modelId,
    modelYear: row.modelYear,
    version: row.version,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    make: row.make,
    model: row.model,
    catalogAvailable: row.make.isActive && row.model.isActive,
    fitmentStatus: "UNKNOWN" as const,
  };
}
export async function garageRead(actor: { userId: string }, id: string) {
  if (!uuid.safeParse(id).success) throw new VehicleError(400, "INVALID_IDENTIFIER");
  const row = await getPrisma().customerVehicle.findFirst({
    where: { id, ownerUserId: actor.userId },
    select: vehicleSelect,
  });
  if (!row) throw notFound();
  return vehicleDto(row);
}
export async function garageReceipt(actor: { userId: string }, commandId: string) {
  if (!uuid.safeParse(commandId).success) throw new VehicleError(400, "INVALID_IDENTIFIER");
  const row = await getPrisma().vehicleCommand.findFirst({
    where: { commandId, actorUserId: actor.userId, domain: "GARAGE" },
  });
  if (!row) throw notFound();
  return { receipt: receiptDto(row), replayed: true };
}
export async function catalogReceipt(actor: { userId: string }, commandId: string) {
  if (!uuid.safeParse(commandId).success) throw new VehicleError(400, "INVALID_IDENTIFIER");
  const row = await getPrisma().vehicleCatalogEntry.findFirst({
    where: { commandId, actorUserId: actor.userId, domain: "CATALOG" },
  });
  if (!row) throw notFound();
  return { receipt: receiptDto(row), replayed: true };
}
export function receiptResponse(value: {
  receipt: ReturnType<typeof receiptDto>;
  replayed: boolean;
}) {
  return jsonReceipt(
    value,
    value.replayed ? 200 : value.receipt.action.startsWith("CREATE") ? 201 : 200
  );
}
