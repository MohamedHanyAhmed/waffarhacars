import "server-only";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/db";
import type { AuthorizedStaffContext } from "@/lib/dal";
import { logAuditEvent } from "@/lib/dal/audit";
import {
  CoverageListSchema,
  FitmentError,
  fingerprint,
  opaqueRefSchema,
  uuid,
  validateCoverage,
} from "./shared";

export const OfferFitmentSchema = z
  .object({
    commandId: uuid,
    expectedVersion: z.number().int().positive(),
    mode: z.enum([
      "BASE_VEHICLE_ALL_VARIANTS_VERIFIED",
      "SERVICE_VEHICLE_INDEPENDENT_WITHIN_LISTED_COVERAGE",
    ]),
    evidenceRef: opaqueRefSchema,
    coverage: CoverageListSchema,
  })
  .strict();
export type OfferFitmentInput = z.infer<typeof OfferFitmentSchema>;

type VehicleLabel = { id: string; nameEn: string; nameAr: string; isActive: boolean };

function publicResult(revision: {
  id: string;
  offerId: string;
  version: number;
  fitmentMode: string | null;
  fitmentEvidenceRef: string | null;
  offer: {
    providerOrganization: { status: string };
    branch: { status: string };
  };
  serviceDefinition: { isActive: boolean; category: { isActive: boolean } };
  fitmentCoverage: Array<{
    makeId: string;
    modelId: string;
    yearFrom: number;
    yearTo: number;
    make: VehicleLabel;
    model: VehicleLabel;
  }>;
}) {
  return {
    revisionId: revision.id,
    offerId: revision.offerId,
    version: revision.version,
    mode: revision.fitmentMode,
    evidenceRef: revision.fitmentEvidenceRef,
    context: {
      providerStatus: revision.offer.providerOrganization.status,
      branchStatus: revision.offer.branch.status,
      serviceIsActive: revision.serviceDefinition.isActive,
      categoryIsActive: revision.serviceDefinition.category.isActive,
    },
    coverage:
      revision.fitmentCoverage?.map((row) => ({
        makeId: row.makeId,
        modelId: row.modelId,
        yearFrom: row.yearFrom,
        yearTo: row.yearTo,
        make: row.make,
        model: row.model,
      })) ?? [],
  };
}

export async function readOfferFitment(
  actor: AuthorizedStaffContext,
  offerId: string,
  revisionId: string
) {
  // Prisma may resolve included relations in separate queries. Keep revision CAS,
  // coverage and canonical labels in the same MVCC snapshot, including inactive
  // historical choices that are deliberately absent from the active catalogue.
  return getPrisma().$transaction(
    async (tx) => {
      // Bound actual PostgreSQL waits as well as Prisma's interactive lifetime;
      // adapter cancellation alone is not a database lock-wait deadline.
      await tx.$queryRaw`SELECT set_config('lock_timeout', '3000ms', true)`;
      await tx.$queryRaw`SELECT set_config('statement_timeout', '7000ms', true)`;
      const labels = { id: true, nameEn: true, nameAr: true, isActive: true } as const;
      const row = await tx.offerRevision.findFirst({
        where: {
          id: revisionId,
          offerId,
          ...(actor.roleAssignment.role === "SALES_AGENT" ? { createdByUserId: actor.userId } : {}),
        },
        include: {
          offer: {
            select: {
              providerOrganization: { select: { status: true } },
              branch: { select: { status: true } },
            },
          },
          serviceDefinition: {
            select: { isActive: true, category: { select: { isActive: true } } },
          },
          fitmentCoverage: {
            orderBy: [{ makeId: "asc" }, { modelId: "asc" }, { yearFrom: "asc" }],
            include: { make: { select: labels }, model: { select: labels } },
          },
        },
      });
      if (!row) throw new FitmentError(404, "NOT_FOUND");
      return publicResult(row);
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      maxWait: 4000,
      timeout: 8000,
    }
  );
}

export async function offerFitmentReceipt(
  actor: AuthorizedStaffContext,
  offerId: string,
  revisionId: string,
  commandId: string
) {
  const row = await getPrisma().fitmentCommand.findUnique({ where: { commandId } });
  if (
    !row ||
    row.actorUserId !== actor.userId ||
    row.domain !== "FITMENT" ||
    row.resourceId !== revisionId
  )
    throw new FitmentError(404, "NOT_FOUND");
  const revision = await getPrisma().offerRevision.findFirst({
    where: { id: revisionId, offerId },
    select: { id: true, createdByUserId: true },
  });
  if (!revision) throw new FitmentError(404, "NOT_FOUND");
  if (actor.roleAssignment.role === "SALES_AGENT" && revision.createdByUserId !== actor.userId)
    throw new FitmentError(404, "NOT_FOUND");
  return {
    commandId: row.commandId,
    outcome: row.outcome,
    httpStatus: row.httpStatus,
    errorCode: row.errorCode,
    resultVersion: row.resultVersion,
  };
}

export async function updateOfferFitment(
  actor: AuthorizedStaffContext,
  offerId: string,
  revisionId: string,
  input: OfferFitmentInput
) {
  const prisma = getPrisma();
  const intent = fingerprint("UPDATE_OFFER_FITMENT", actor.userId, revisionId, input);
  try {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT set_config('lock_timeout', '3000ms', true)`;
        await tx.$queryRaw`SELECT set_config('statement_timeout', '7000ms', true)`;
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('FITMENT'), hashtext(${input.commandId})) IS NULL AS locked`;
        const offer = await tx.offer.findUnique({
          where: { id: offerId },
          select: { id: true, providerOrganizationId: true, branchId: true },
        });
        if (!offer) throw new FitmentError(404, "NOT_FOUND");
        await tx.$queryRaw`SELECT id FROM provider_organizations WHERE id = ${offer.providerOrganizationId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM provider_branches WHERE id = ${offer.branchId}::uuid AND "providerOrganizationId" = ${offer.providerOrganizationId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM offers WHERE id = ${offerId}::uuid FOR UPDATE`;
        const [revision] = await tx.$queryRaw<
          Array<{
            id: string;
            offerId: string;
            status: string;
            version: number;
            createdByUserId: string;
          }>
        >`
        SELECT id,"offerId",status,version,"createdByUserId" FROM offer_revisions WHERE id = ${revisionId}::uuid AND "offerId" = ${offerId}::uuid FOR UPDATE`;
        if (!revision) throw new FitmentError(404, "NOT_FOUND");
        const prior = await tx.fitmentCommand.findUnique({ where: { commandId: input.commandId } });
        if (prior) {
          if (prior.actorUserId !== actor.userId) throw new FitmentError(404, "NOT_FOUND");
          if (
            prior.domain !== "FITMENT" ||
            prior.resourceId !== revisionId ||
            prior.fingerprint !== intent
          )
            throw new FitmentError(409, "IDEMPOTENCY_KEY_REUSED");
          return {
            commandId: prior.commandId,
            outcome: prior.outcome,
            resultVersion: prior.resultVersion,
          };
        }
        if (revision.createdByUserId !== actor.userId)
          throw new FitmentError(403, "NOT_DRAFT_OWNER");
        if (revision.status !== "DRAFT") throw new FitmentError(422, "INVALID_STATE_TRANSITION");
        if (revision.version !== input.expectedVersion)
          throw new FitmentError(409, "CONCURRENT_MODIFICATION");
        const coverage = await validateCoverage(tx, input.coverage);
        await tx.offerFitmentCoverage.deleteMany({ where: { revisionId } });
        await tx.offerFitmentCoverage.createMany({
          data: coverage.map((row) => ({ ...row, revisionId })),
        });
        const updated = await tx.offerRevision.updateMany({
          where: { id: revisionId, offerId, status: "DRAFT", version: input.expectedVersion },
          data: {
            fitmentMode: input.mode,
            fitmentEvidenceRef: input.evidenceRef,
            fitmentAllVariantsAttested: false,
            fitmentScopePriceAttested: false,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) throw new FitmentError(409, "CONCURRENT_MODIFICATION");
        const resultVersion = input.expectedVersion + 1;
        await tx.fitmentCommand.create({
          data: {
            commandId: input.commandId,
            actorUserId: actor.userId,
            domain: "FITMENT",
            action: "UPDATE",
            resourceId: revisionId,
            fingerprint: intent,
            outcome: "APPLIED",
            httpStatus: 200,
            resultVersion,
          },
        });
        await logAuditEvent(
          {
            actorUserId: actor.userId,
            eventType: "OFFER_FITMENT_UPDATED",
            targetEntity: `offer_revision:${revisionId}`,
            metadata: {
              action: "UPDATE_OFFER_FITMENT",
              commandId: input.commandId,
              offerId,
              revisionId,
              version: resultVersion,
            },
          },
          tx
        );
        return { commandId: input.commandId, outcome: "APPLIED", resultVersion };
      },
      { maxWait: 4000, timeout: 8000 }
    );
  } catch (error) {
    if (error instanceof FitmentError) throw error;
    throw new FitmentError(503, "SERVICE_UNAVAILABLE");
  }
}
