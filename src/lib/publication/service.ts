import "server-only";
import crypto from "node:crypto";
import { z } from "zod";
import {
  type OfferPublicationAction,
  type OfferPublicationCommand,
  type OfferPublicationStatus,
} from "@/generated/prisma/client";
import { getPrisma } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
import type { AuthorizedStaffContext } from "@/lib/dal";
import { createAuditFingerprint, logAuditEvent } from "@/lib/dal/audit";

const uuid = z.string().uuid();
export const PublicationCommandSchema = z
  .object({
    commandId: uuid,
    action: z.enum(["PUBLISH", "REPLACE", "UNPUBLISH"]),
    expectedVersion: z.number().int().min(0),
    revisionId: uuid.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.action === "UNPUBLISH") !== (value.revisionId === undefined)) {
      context.addIssue({
        code: "custom",
        path: ["revisionId"],
        message: "Invalid target revision.",
      });
    }
  });
export type PublicationCommandInput = z.infer<typeof PublicationCommandSchema>;

export class PublicationError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 422 | 503,
    readonly code: string
  ) {
    super(code);
    this.name = "PublicationError";
  }
}

type PublicationState = {
  offerId: string;
  status: OfferPublicationStatus;
  version: number;
  pinnedRevisionId: string | null;
  effectiveVisible: boolean;
  hiddenReasons: string[];
};

type CommandReceipt = {
  commandId: string;
  action: OfferPublicationAction;
  outcome: "APPLIED" | "REJECTED";
  resultVersion: number;
  resultStatus: OfferPublicationStatus;
  pinnedRevisionId: string | null;
  httpStatus: number;
  errorCode: string | null;
};

type AvailabilityRow = {
  offerId: string;
  status: OfferPublicationStatus | null;
  version: number | null;
  pinnedRevisionId: string | null;
  revisionStatus: string | null;
  providerStatus: string;
  branchStatus: string;
  branchCluster: string;
  legalIdentityChecked: boolean;
  physicalLocationChecked: boolean;
  contactAndHoursChecked: boolean;
  evidenceDocumentRef: string | null;
  vettedByUserId: string | null;
  vettedAt: Date | null;
  serviceActive: boolean | null;
  categoryActive: boolean | null;
  pricingMode: string | null;
  offerServiceId: string;
  revisionServiceId: string | null;
  serviceId: string | null;
  serviceCode: string | null;
  revisionServiceCode: string | null;
  categoryCode: string | null;
  revisionCategoryCode: string | null;
  validFrom: Date | null;
  validUntil: Date | null;
  databaseNow: Date;
  evidenceInspected: boolean | null;
  priceVerified: boolean | null;
  scopeVerified: boolean | null;
  providerConsentVerified: boolean | null;
};

function publicationGateReasons(): string[] {
  const env = getServerEnv();
  const reasons: string[] = [];
  if (!env.OFFER_PUBLICATION_ENABLED) reasons.push("GATE_DISABLED");
  if (!env.OFFER_PUBLICATION_PILOT_CLUSTER) reasons.push("PILOT_CLUSTER_UNSET");
  if (!env.OFFER_EVIDENCE_PACKET_REPOSITORY_READY) reasons.push("EVIDENCE_REPOSITORY_UNREADY");
  if (env.APP_DATA_BACKEND !== "postgres") reasons.push("GATE_DISABLED");
  return [...new Set(reasons)];
}

function availabilityReasons(row: AvailabilityRow): string[] {
  const reasons = publicationGateReasons();
  if (row.status !== "PUBLISHED" || !row.pinnedRevisionId) reasons.push("UNPUBLISHED");
  if (row.revisionStatus !== "APPROVED") reasons.push("REVISION_NOT_APPROVED");
  if (row.providerStatus !== "ACTIVE") reasons.push("PROVIDER_INACTIVE");
  if (row.branchStatus !== "ACTIVE") reasons.push("BRANCH_INACTIVE");
  if (
    !row.legalIdentityChecked ||
    !row.physicalLocationChecked ||
    !row.contactAndHoursChecked ||
    !row.evidenceDocumentRef ||
    !row.vettedByUserId ||
    !row.vettedAt
  )
    reasons.push("BRANCH_NOT_VETTED");
  if (row.branchCluster !== getServerEnv().OFFER_PUBLICATION_PILOT_CLUSTER)
    reasons.push("OUTSIDE_PILOT_CLUSTER");
  if (!row.serviceActive) reasons.push("SERVICE_INACTIVE");
  if (!row.categoryActive) reasons.push("CATEGORY_INACTIVE");
  if (
    !row.serviceId ||
    row.offerServiceId !== row.revisionServiceId ||
    row.serviceId !== row.revisionServiceId ||
    row.serviceCode !== row.revisionServiceCode ||
    row.categoryCode !== row.revisionCategoryCode
  )
    reasons.push("SERVICE_IDENTITY_CHANGED");
  if (row.pricingMode !== "FIXED_SCOPE") reasons.push("QUOTE_REQUIRED");
  if (!row.validFrom || row.databaseNow < row.validFrom) reasons.push("NOT_YET_VALID");
  if (!row.validUntil || row.databaseNow >= row.validUntil) reasons.push("EXPIRED");
  if (
    !row.evidenceInspected ||
    !row.priceVerified ||
    !row.scopeVerified ||
    !row.providerConsentVerified
  )
    reasons.push("ATTESTATIONS_INCOMPLETE");
  return reasons;
}

async function readAvailability(offerId: string): Promise<PublicationState> {
  const prisma = getPrisma();
  const rows = await prisma.$queryRaw<AvailabilityRow[]>`
    SELECT o.id AS "offerId", p.status, p.version, p."pinnedRevisionId",
      r.status AS "revisionStatus", po.status AS "providerStatus", b.status AS "branchStatus",
      b.cluster AS "branchCluster", b."legalIdentityChecked", b."physicalLocationChecked",
      b."contactAndHoursChecked", b."evidenceDocumentRef", b."vettedByUserId", b."vettedAt",
      sd."isActive" AS "serviceActive", c."isActive" AS "categoryActive", sd."pricingMode",
      o."serviceDefinitionId" AS "offerServiceId", r."serviceDefinitionId" AS "revisionServiceId",
      sd.id AS "serviceId", sd.code AS "serviceCode", r."serviceCode" AS "revisionServiceCode",
      c.code AS "categoryCode", r."categoryCode" AS "revisionCategoryCode",
      r."validFrom", r."validUntil", (statement_timestamp() AT TIME ZONE 'UTC') AS "databaseNow",
      r."evidenceInspected", r."priceVerified", r."scopeVerified", r."providerConsentVerified"
    FROM offers o
    JOIN provider_organizations po ON po.id = o."providerOrganizationId"
    JOIN provider_branches b ON b.id = o."branchId" AND b."providerOrganizationId" = po.id
    LEFT JOIN offer_publications p ON p."offerId" = o.id
    LEFT JOIN offer_revisions r ON r.id = p."pinnedRevisionId" AND r."offerId" = o.id
    LEFT JOIN service_definitions sd ON sd.id = r."serviceDefinitionId"
    LEFT JOIN service_categories c ON c.id = sd."categoryId"
    WHERE o.id = ${offerId}::uuid
  `;
  const row = rows[0];
  if (!row) throw new PublicationError(404, "OFFER_NOT_FOUND");
  const hiddenReasons = availabilityReasons(row);
  return {
    offerId,
    status: row.status ?? "UNPUBLISHED",
    version: row.version ?? 0,
    pinnedRevisionId: row.pinnedRevisionId,
    effectiveVisible: hiddenReasons.length === 0,
    hiddenReasons,
  };
}

export async function getPublicationState(offerId: string): Promise<PublicationState> {
  return readAvailability(offerId);
}

function receipt(command: OfferPublicationCommand): CommandReceipt {
  return {
    commandId: command.commandId,
    action: command.action,
    outcome: command.outcome,
    resultVersion: command.resultVersion,
    resultStatus: command.resultStatus,
    pinnedRevisionId: command.pinnedRevisionId,
    httpStatus: command.httpStatus,
    errorCode: command.errorCode,
  };
}

function commandFingerprint(actorId: string, offerId: string, input: PublicationCommandInput) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        actorId,
        offerId,
        action: input.action,
        revisionId: input.revisionId ?? null,
        expectedVersion: input.expectedVersion,
      })
    )
    .digest("hex");
}

export async function getPublicationCommandOutcome(
  actor: AuthorizedStaffContext,
  offerId: string,
  commandId: string
) {
  const command = await getPrisma().offerPublicationCommand.findUnique({ where: { commandId } });
  if (!command || command.actorUserId !== actor.userId || command.offerId !== offerId)
    throw new PublicationError(404, "COMMAND_NOT_FOUND");
  return { command: receipt(command), publication: await readAvailability(offerId) };
}

type LockedRevision = {
  id: string;
  offerId: string;
  status: string;
  serviceDefinitionId: string;
  serviceCode: string;
  categoryCode: string;
  validFrom: Date;
  validUntil: Date;
  evidenceInspected: boolean;
  priceVerified: boolean;
  scopeVerified: boolean;
  providerConsentVerified: boolean;
  createdByUserId: string;
  submittedByUserId: string | null;
};

export async function executePublicationCommand(
  actor: AuthorizedStaffContext,
  offerId: string,
  input: PublicationCommandInput,
  clientIp?: string
): Promise<{ command: CommandReceipt; publication: PublicationState }> {
  const prisma = getPrisma();
  const fingerprint = commandFingerprint(actor.userId, offerId, input);
  const result = await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT set_config('lock_timeout', '3000ms', true)`;
      const offer = await tx.offer.findUnique({
        where: { id: offerId },
        select: {
          id: true,
          providerOrganizationId: true,
          branchId: true,
          serviceDefinitionId: true,
        },
      });
      if (!offer) throw new PublicationError(404, "OFFER_NOT_FOUND");
      const [provider] = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id, status FROM provider_organizations WHERE id = ${offer.providerOrganizationId}::uuid FOR UPDATE
      `;
      const [branch] = await tx.$queryRaw<
        Array<{
          id: string;
          status: string;
          cluster: string;
          legalIdentityChecked: boolean;
          physicalLocationChecked: boolean;
          contactAndHoursChecked: boolean;
          evidenceDocumentRef: string | null;
          vettedByUserId: string | null;
          vettedAt: Date | null;
        }>
      >`SELECT id, status, cluster, "legalIdentityChecked", "physicalLocationChecked", "contactAndHoursChecked", "evidenceDocumentRef", "vettedByUserId", "vettedAt" FROM provider_branches WHERE id = ${offer.branchId}::uuid AND "providerOrganizationId" = ${offer.providerOrganizationId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM offers WHERE id = ${offerId}::uuid FOR UPDATE`;
      if (!provider || !branch) throw new PublicationError(409, "DEPENDENCY_MISSING");

      const prior = await tx.offerPublicationCommand.findUnique({
        where: { commandId: input.commandId },
      });
      if (prior) {
        if (prior.actorUserId !== actor.userId)
          throw new PublicationError(404, "COMMAND_NOT_FOUND");
        if (prior.offerId !== offerId) throw new PublicationError(409, "IDEMPOTENCY_KEY_REUSED");
        if (prior.fingerprint !== fingerprint)
          throw new PublicationError(409, "IDEMPOTENCY_KEY_REUSED");
        return receipt(prior);
      }

      const before = await tx.offerPublication.findUnique({ where: { offerId } });
      const revisionId = input.revisionId ?? before?.pinnedRevisionId ?? null;
      const [revision] = revisionId
        ? await tx.$queryRaw<LockedRevision[]>`
            SELECT id, "offerId", status, "serviceDefinitionId", "serviceCode", "categoryCode",
              "validFrom", "validUntil", "evidenceInspected", "priceVerified", "scopeVerified",
              "providerConsentVerified", "createdByUserId", "submittedByUserId"
            FROM offer_revisions WHERE id = ${revisionId}::uuid AND "offerId" = ${offerId}::uuid FOR UPDATE
          `
        : [];
      // The service and category are acquired after revision, as in existing approval.
      const [service] = revision
        ? await tx.$queryRaw<
            Array<{
              id: string;
              code: string;
              categoryId: string;
              isActive: boolean;
              pricingMode: string;
            }>
          >`SELECT id, code, "categoryId", "isActive", "pricingMode" FROM service_definitions WHERE id = ${revision.serviceDefinitionId}::uuid FOR UPDATE`
        : [];
      const [category] = service
        ? await tx.$queryRaw<Array<{ id: string; code: string; isActive: boolean }>>`
            SELECT id, code, "isActive" FROM service_categories WHERE id = ${service.categoryId}::uuid FOR UPDATE
          `
        : [];
      // The offer row serializes even competing first publications (no row exists yet).
      const publication = await tx.offerPublication.findUnique({ where: { offerId } });
      const currentVersion = publication?.version ?? 0;
      const currentStatus = publication?.status ?? "UNPUBLISHED";
      const currentPin = publication?.pinnedRevisionId ?? null;
      let errorCode: string | null = null;
      let httpStatus = 200;
      const reject = (code: string, status: 409 | 422 = 409) => {
        errorCode = code;
        httpStatus = status;
      };

      if (input.expectedVersion !== currentVersion) reject("CONCURRENT_MODIFICATION");
      else if (input.action === "PUBLISH" && currentStatus === "PUBLISHED")
        reject("ALREADY_PUBLISHED");
      else if (input.action === "REPLACE" && currentStatus !== "PUBLISHED") reject("NOT_PUBLISHED");
      else if (input.action === "UNPUBLISH" && currentStatus !== "PUBLISHED")
        reject("NOT_PUBLISHED");
      else if (input.action === "REPLACE" && currentPin === input.revisionId)
        reject("SAME_REVISION");
      else if (input.action !== "UNPUBLISH") {
        const gateReasons = publicationGateReasons();
        if (gateReasons.length > 0) reject(gateReasons[0], 422);
        else if (!revision) reject("REVISION_NOT_FOUND", 422);
        else if (
          revision.createdByUserId === actor.userId ||
          revision.submittedByUserId === actor.userId
        )
          throw new PublicationError(403, "MAKER_CHECKER_VIOLATION");
        else if (revision.status !== "APPROVED") reject("REVISION_NOT_APPROVED", 422);
        else if (provider.status !== "ACTIVE") reject("PROVIDER_INACTIVE", 422);
        else if (branch.status !== "ACTIVE") reject("BRANCH_INACTIVE", 422);
        else if (
          !branch.legalIdentityChecked ||
          !branch.physicalLocationChecked ||
          !branch.contactAndHoursChecked ||
          !branch.evidenceDocumentRef ||
          !branch.vettedByUserId ||
          !branch.vettedAt
        )
          reject("BRANCH_NOT_VETTED", 422);
        else if (branch.cluster !== getServerEnv().OFFER_PUBLICATION_PILOT_CLUSTER)
          reject("OUTSIDE_PILOT_CLUSTER", 422);
        else if (!service || !service.isActive) reject("SERVICE_INACTIVE", 422);
        else if (!category || !category.isActive) reject("CATEGORY_INACTIVE", 422);
        else if (
          offer.serviceDefinitionId !== revision.serviceDefinitionId ||
          service.id !== revision.serviceDefinitionId ||
          service.code !== revision.serviceCode ||
          category.code !== revision.categoryCode
        )
          reject("SERVICE_IDENTITY_CHANGED", 422);
        else if (service.pricingMode !== "FIXED_SCOPE") reject("QUOTE_REQUIRED", 422);
        else if (
          !revision.evidenceInspected ||
          !revision.priceVerified ||
          !revision.scopeVerified ||
          !revision.providerConsentVerified
        )
          reject("ATTESTATIONS_INCOMPLETE", 422);
        else {
          const [clock] = await tx.$queryRaw<Array<{ databaseNow: Date }>>`
            SELECT (statement_timestamp() AT TIME ZONE 'UTC') AS "databaseNow"
          `;
          if (clock.databaseNow < revision.validFrom) reject("NOT_YET_VALID", 422);
          else if (clock.databaseNow >= revision.validUntil) reject("EXPIRED", 422);
        }
      }

      if (errorCode) {
        const rejected = await tx.offerPublicationCommand.create({
          data: {
            commandId: input.commandId,
            offerId,
            actorUserId: actor.userId,
            action: input.action,
            targetRevisionId: input.revisionId ?? null,
            expectedVersion: input.expectedVersion,
            fingerprint,
            outcome: "REJECTED",
            httpStatus,
            errorCode,
            resultVersion: currentVersion,
            resultStatus: currentStatus,
            pinnedRevisionId: currentPin,
          },
        });
        return receipt(rejected);
      }

      const nextStatus: OfferPublicationStatus =
        input.action === "UNPUBLISH" ? "UNPUBLISHED" : "PUBLISHED";
      const nextPin = input.action === "UNPUBLISH" ? currentPin : (input.revisionId ?? null);
      const now = new Date();
      const nextVersion = currentVersion + 1;
      if (publication) {
        const updated = await tx.offerPublication.updateMany({
          where: { offerId, version: currentVersion },
          data: {
            status: nextStatus,
            pinnedRevisionId: nextPin,
            version: { increment: 1 },
            lastActorUserId: actor.userId,
            ...(nextStatus === "PUBLISHED"
              ? { publishedAt: now, unpublishedAt: null }
              : { unpublishedAt: now }),
          },
        });
        if (updated.count !== 1) throw new PublicationError(409, "CONCURRENT_MODIFICATION");
      } else {
        await tx.offerPublication.create({
          data: {
            offerId,
            status: nextStatus,
            pinnedRevisionId: nextPin,
            version: 1,
            lastActorUserId: actor.userId,
            publishedAt: now,
          },
        });
      }
      const applied = await tx.offerPublicationCommand.create({
        data: {
          commandId: input.commandId,
          offerId,
          actorUserId: actor.userId,
          action: input.action,
          targetRevisionId: input.revisionId ?? null,
          expectedVersion: input.expectedVersion,
          fingerprint,
          outcome: "APPLIED",
          httpStatus: 200,
          resultVersion: nextVersion,
          resultStatus: nextStatus,
          pinnedRevisionId: nextPin,
        },
      });
      await logAuditEvent(
        {
          actorUserId: actor.userId,
          eventType:
            input.action === "PUBLISH"
              ? "OFFER_PUBLISHED"
              : input.action === "REPLACE"
                ? "OFFER_PUBLICATION_REPLACED"
                : "OFFER_UNPUBLISHED",
          targetEntity: `offer:${offerId}`,
          ipFingerprint: clientIp ? createAuditFingerprint(clientIp) : null,
          metadata: {
            action: input.action,
            commandId: input.commandId,
            offerId,
            revisionId: nextPin,
            version: nextVersion,
          },
        },
        tx
      );
      return receipt(applied);
    },
    { maxWait: 5000, timeout: 10000 }
  );
  return { command: result, publication: await readAvailability(offerId) };
}
