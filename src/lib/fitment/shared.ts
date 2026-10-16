import "server-only";
import crypto from "node:crypto";
import { z } from "zod";
import type { NextRequest } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { assertStaffPermission, AuthorizationError } from "@/lib/dal";
import { getServerEnv } from "@/lib/env";
import { validateRequestOrigin } from "@/lib/security/origin";

export const uuid = z.string().uuid();
export const opaqueRefSchema = z
  .string()
  .trim()
  .min(3)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
const currentCairoYear = () =>
  Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", year: "numeric" }).format(
      new Date()
    )
  );
const coveredYear = z
  .number()
  .int()
  .min(1900)
  .refine((value) => value <= currentCairoYear() + 1);
export const CoverageSchema = z
  .object({
    makeId: uuid,
    modelId: uuid,
    yearFrom: coveredYear,
    yearTo: coveredYear,
  })
  .strict()
  .refine((row) => row.yearTo >= row.yearFrom);
export const CoverageListSchema = z.array(CoverageSchema).min(1).max(50);
export type Coverage = z.infer<typeof CoverageSchema>;

export class FitmentError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 422 | 503,
    readonly code: string
  ) {
    super(code);
    this.name = "FitmentError";
  }
  toResponse() {
    return Response.json(
      { error: this.code },
      { status: this.status, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export function fingerprint(action: string, actorId: string, resourceId: string, payload: unknown) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(["fitment-command-v1", action, actorId, resourceId, payload]))
    .digest("hex");
}

export async function validateCoverage(tx: Prisma.TransactionClient, coverage: Coverage[]) {
  if (!CoverageListSchema.safeParse(coverage).success)
    throw new FitmentError(400, "INVALID_COVERAGE");
  const sorted = [...coverage].sort(
    (a, b) =>
      a.makeId.localeCompare(b.makeId) ||
      a.modelId.localeCompare(b.modelId) ||
      a.yearFrom - b.yearFrom
  );
  for (let index = 0; index < sorted.length; index++) {
    const row = sorted[index];
    if (row.yearFrom > row.yearTo) throw new FitmentError(400, "INVALID_COVERAGE");
    const previous = sorted[index - 1];
    if (previous?.modelId === row.modelId && previous.yearTo >= row.yearFrom)
      throw new FitmentError(422, "OVERLAPPING_COVERAGE");
  }
  const makeIds = [...new Set(sorted.map((row) => row.makeId))].sort();
  const modelIds = [...new Set(sorted.map((row) => row.modelId))].sort();
  for (const makeId of makeIds) {
    const [make] = await tx.$queryRaw<
      Array<{ id: string; isActive: boolean }>
    >`SELECT id, "isActive" FROM vehicle_makes WHERE id = ${makeId}::uuid FOR UPDATE`;
    if (!make?.isActive) throw new FitmentError(422, "INVALID_VEHICLE_CATALOG");
  }
  for (const modelId of modelIds) {
    const [model] = await tx.$queryRaw<
      Array<{ id: string; makeId: string; isActive: boolean }>
    >`SELECT id, "makeId", "isActive" FROM vehicle_models WHERE id = ${modelId}::uuid FOR UPDATE`;
    if (
      !model?.isActive ||
      !sorted.filter((row) => row.modelId === modelId).every((row) => row.makeId === model.makeId)
    )
      throw new FitmentError(422, "INVALID_VEHICLE_CATALOG");
  }
  return sorted;
}

export async function fitmentApi(
  req: NextRequest,
  permission: Parameters<typeof assertStaffPermission>[1],
  handler: (actor: Awaited<ReturnType<typeof assertStaffPermission>>) => Promise<Response>
) {
  try {
    if (getServerEnv().APP_DATA_BACKEND !== "postgres")
      throw new FitmentError(503, "SERVICE_UNAVAILABLE");
    const actor = await assertStaffPermission(req.headers, permission);
    if (req.method !== "GET" && !validateRequestOrigin(req).valid)
      throw new FitmentError(403, "ORIGIN_DENIED");
    return await handler(actor);
  } catch (error) {
    if (error instanceof AuthorizationError || error instanceof FitmentError)
      return error.toResponse();
    return new FitmentError(503, "SERVICE_UNAVAILABLE").toResponse();
  }
}

export async function parseFitmentBody<T>(req: NextRequest, schema: z.ZodType<T>): Promise<T> {
  if (!req.body) throw new FitmentError(400, "INVALID_PAYLOAD");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 16384) {
        await reader.cancel().catch(() => {});
        throw new FitmentError(400, "INVALID_PAYLOAD");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof FitmentError) throw error;
    throw new FitmentError(400, "INVALID_PAYLOAD");
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const parsed = schema.safeParse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
    );
    if (parsed.success) return parsed.data;
  } catch {
    /* intentionally sanitized */
  }
  throw new FitmentError(400, "INVALID_PAYLOAD");
}
