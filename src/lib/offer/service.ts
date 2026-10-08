import "server-only";
import crypto from "node:crypto";
import { Prisma, type OfferRevision, type OfferRevisionStatus } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
import type { AuthorizedStaffContext } from "@/lib/dal";
import { createAuditFingerprint, logAuditEvent } from "@/lib/dal/audit";
import type { OfferDraftFields } from "./validation";
import { deriveOfferPricing } from "@/domain/offerPricing";

export class OfferError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 422 | 503,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "OfferError";
  }

  toResponse(): Response {
    return Response.json(
      { error: this.code, message: this.message },
      { status: this.status, headers: { "Cache-Control": "no-store" } }
    );
  }
}

function auditFingerprint(clientIp?: string) {
  return clientIp ? createAuditFingerprint(clientIp) : null;
}

function isUniqueConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function serialize<T>(value: T): T {
  if (typeof value === "bigint") return value.toString() as T;
  if (value instanceof Date) return value.toISOString() as T;
  if (Array.isArray(value)) return value.map(serialize) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "creationRequestFingerprint")
        .map(([key, item]) => [key, serialize(item)])
    ) as T;
  }
  return value;
}

function withDerivedPricing<T extends { normalPriceMinor: bigint; customerPriceMinor: bigint }>(
  value: T
) {
  return serialize({
    ...value,
    ...deriveOfferPricing(value.normalPriceMinor, value.customerPriceMinor),
  });
}

async function lockActiveProviderAndBranch(
  tx: Prisma.TransactionClient,
  providerOrganizationId: string,
  branchId: string
) {
  const [provider] = await tx.$queryRaw<
    Array<{ id: string; status: string; version: number }>
  >`SELECT id, status, version FROM provider_organizations WHERE id = ${providerOrganizationId}::uuid FOR UPDATE`;
  if (!provider) throw new OfferError(404, "PROVIDER_NOT_FOUND", "Provider was not found.");

  const [branch] = await tx.$queryRaw<
    Array<{
      id: string;
      providerOrganizationId: string;
      status: string;
      version: number;
      legalIdentityChecked: boolean;
      physicalLocationChecked: boolean;
      contactAndHoursChecked: boolean;
      evidenceDocumentRef: string | null;
      vettedByUserId: string | null;
      vettedAt: Date | null;
    }>
  >`SELECT id, "providerOrganizationId", status, version, "legalIdentityChecked", "physicalLocationChecked", "contactAndHoursChecked", "evidenceDocumentRef", "vettedByUserId", "vettedAt" FROM provider_branches WHERE id = ${branchId}::uuid AND "providerOrganizationId" = ${providerOrganizationId}::uuid FOR UPDATE`;
  if (!branch)
    throw new OfferError(404, "BRANCH_NOT_FOUND", "Branch was not found for this provider.");

  if (provider.status !== "ACTIVE" || branch.status !== "ACTIVE") {
    throw new OfferError(
      409,
      "PROVIDER_OR_BRANCH_NOT_ACTIVE",
      "Provider and branch must be active."
    );
  }
  if (
    !branch.legalIdentityChecked ||
    !branch.physicalLocationChecked ||
    !branch.contactAndHoursChecked ||
    !branch.evidenceDocumentRef ||
    !branch.vettedByUserId ||
    !branch.vettedAt
  ) {
    throw new OfferError(
      422,
      "BRANCH_NOT_VETTED",
      "Branch vetting must be complete before offer entry."
    );
  }
  return { provider, branch };
}

async function lockProviderAndBranch(
  tx: Prisma.TransactionClient,
  providerOrganizationId: string,
  branchId: string
) {
  const [provider] = await tx.$queryRaw<
    Array<{ id: string; status: string; version: number }>
  >`SELECT id, status, version FROM provider_organizations WHERE id = ${providerOrganizationId}::uuid FOR UPDATE`;
  if (!provider) throw new OfferError(404, "PROVIDER_NOT_FOUND", "Provider was not found.");
  const [branch] = await tx.$queryRaw<
    Array<{
      id: string;
      providerOrganizationId: string;
      status: string;
      version: number;
      legalIdentityChecked: boolean;
      physicalLocationChecked: boolean;
      contactAndHoursChecked: boolean;
      evidenceDocumentRef: string | null;
      vettedByUserId: string | null;
      vettedAt: Date | null;
    }>
  >`SELECT id, "providerOrganizationId", status, version, "legalIdentityChecked", "physicalLocationChecked", "contactAndHoursChecked", "evidenceDocumentRef", "vettedByUserId", "vettedAt" FROM provider_branches WHERE id = ${branchId}::uuid AND "providerOrganizationId" = ${providerOrganizationId}::uuid FOR UPDATE`;
  if (!branch)
    throw new OfferError(404, "BRANCH_NOT_FOUND", "Branch was not found for this provider.");
  return { provider, branch };
}

function assertProviderAndBranchApprovable(
  provider: { status: string },
  branch: {
    status: string;
    legalIdentityChecked: boolean;
    physicalLocationChecked: boolean;
    contactAndHoursChecked: boolean;
    evidenceDocumentRef: string | null;
    vettedByUserId: string | null;
    vettedAt: Date | null;
  }
) {
  if (provider.status !== "ACTIVE" || branch.status !== "ACTIVE") {
    throw new OfferError(
      409,
      "PROVIDER_OR_BRANCH_NOT_ACTIVE",
      "Provider and branch must be active before offer approval."
    );
  }
  if (
    !branch.legalIdentityChecked ||
    !branch.physicalLocationChecked ||
    !branch.contactAndHoursChecked ||
    !branch.evidenceDocumentRef ||
    !branch.vettedByUserId ||
    !branch.vettedAt
  ) {
    throw new OfferError(
      422,
      "BRANCH_NOT_VETTED",
      "Branch vetting must be complete before offer approval."
    );
  }
}

async function getFixedServiceDefinition(
  tx: Prisma.TransactionClient,
  serviceDefinitionId: string,
  lock = false
) {
  if (lock) {
    await tx.$queryRaw`SELECT id FROM service_definitions WHERE id = ${serviceDefinitionId}::uuid FOR UPDATE`;
  }
  const definition = await tx.serviceDefinition.findUnique({
    where: { id: serviceDefinitionId },
    include: { category: true },
  });
  if (!definition || !definition.isActive || !definition.category.isActive) {
    throw new OfferError(404, "SERVICE_NOT_FOUND", "Active service definition was not found.");
  }
  if (definition.pricingMode !== "FIXED_SCOPE") {
    throw new OfferError(
      422,
      "QUOTE_REQUIRED_SERVICE",
      "Quote-only services cannot be submitted as fixed-price offers."
    );
  }
  return definition;
}

function revisionSnapshot(definition: {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  scopeEn: string;
  scopeAr: string;
  category: { code: string; nameEn: string; nameAr: string };
}) {
  return {
    serviceDefinitionId: definition.id,
    categoryCode: definition.category.code,
    categoryNameEn: definition.category.nameEn,
    categoryNameAr: definition.category.nameAr,
    serviceCode: definition.code,
    serviceNameEn: definition.nameEn,
    serviceNameAr: definition.nameAr,
    serviceScopeEn: definition.scopeEn,
    serviceScopeAr: definition.scopeAr,
  };
}

function offerFieldsToData(fields: OfferDraftFields) {
  return {
    ...fields,
    validFrom: fields.validFrom,
    validUntil: fields.validUntil,
    evidenceDate: fields.evidenceDate,
    commercialTermsAgreedAt: fields.commercialTermsAgreedAt,
  };
}

function creationRequestFingerprint(input: {
  providerOrganizationId: string;
  branchId: string;
  serviceDefinitionId: string;
  revisionRequestId: string;
  fields: OfferDraftFields;
}) {
  // Hash the validated, normalized request rather than the editable first revision.
  // Sorted field names make the result independent of JSON property order.
  const canonicalFields = Object.entries(input.fields)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => [
      key,
      value instanceof Date
        ? value.toISOString()
        : typeof value === "bigint"
          ? value.toString()
          : value,
    ]);
  const canonical = JSON.stringify([
    input.providerOrganizationId.toLowerCase(),
    input.branchId.toLowerCase(),
    input.serviceDefinitionId.toLowerCase(),
    input.revisionRequestId.toLowerCase(),
    canonicalFields,
  ]);
  return crypto.createHash("sha256").update("offer-create-v1\0").update(canonical).digest("hex");
}

async function readOffer(offerId: string, revisionId?: string) {
  const prisma = getPrisma();
  return prisma.offer.findUnique({
    where: { id: offerId },
    include: {
      providerOrganization: { select: { id: true, nameEn: true, nameAr: true, status: true } },
      branch: { select: { id: true, branchCode: true, nameEn: true, nameAr: true, status: true } },
      serviceDefinition: { include: { category: true } },
      revisions: {
        where: revisionId ? { id: revisionId } : undefined,
        orderBy: { revisionNumber: "desc" },
      },
      currentApprovedRevision: true,
    },
  });
}

function assertSalesOwnsDraft(actor: AuthorizedStaffContext, revision: OfferRevision) {
  if (actor.roleAssignment.role === "SALES_AGENT" && revision.createdByUserId !== actor.userId) {
    throw new OfferError(404, "OFFER_NOT_FOUND", "Offer was not found.");
  }
}

export async function listServiceCatalog(actor: AuthorizedStaffContext) {
  const prisma = getPrisma();
  const includeInactive = actor.roleAssignment.role === "OPS_SUPERVISOR";
  return prisma.serviceCategory.findMany({
    where: includeInactive ? undefined : { isActive: true },
    include: {
      definitions: {
        where: includeInactive ? undefined : { isActive: true },
        orderBy: { nameEn: "asc" },
      },
    },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
  });
}

export async function createServiceDefinition(
  actor: AuthorizedStaffContext,
  input: {
    code: string;
    categoryId: string;
    nameEn: string;
    nameAr: string;
    scopeEn: string;
    scopeAr: string;
    pricingMode: "FIXED_SCOPE" | "QUOTE_REQUIRED";
    itemSku?: string | null;
  },
  clientIp?: string
) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const category = await tx.serviceCategory.findUnique({ where: { id: input.categoryId } });
    if (!category || !category.isActive) {
      throw new OfferError(404, "CATEGORY_NOT_FOUND", "Active service category was not found.");
    }
    if (category.code === "GENERAL_REPAIRS" && input.pricingMode !== "QUOTE_REQUIRED") {
      throw new OfferError(
        422,
        "REPAIR_REQUIRES_QUOTE",
        "General repair offers must use a quote workflow."
      );
    }
    if (category.code === "ACCESSORIES" && !input.itemSku) {
      throw new OfferError(
        422,
        "ACCESSORY_SKU_REQUIRED",
        "Accessory definitions require an identifiable SKU."
      );
    }
    const definition = await tx.serviceDefinition
      .create({
        data: {
          ...input,
          createdByUserId: actor.userId,
          updatedByUserId: actor.userId,
        },
        include: { category: true },
      })
      .catch((error: unknown) => {
        if (isUniqueConflict(error)) {
          throw new OfferError(
            409,
            "SERVICE_CODE_ALREADY_EXISTS",
            "Service code is already in use."
          );
        }
        throw error;
      });
    await logAuditEvent(
      {
        actorUserId: actor.userId,
        eventType: "SERVICE_DEFINITION_CREATED",
        targetEntity: `service_definition:${definition.id}`,
        ipFingerprint: auditFingerprint(clientIp),
        metadata: {
          action: "CREATE_SERVICE_DEFINITION",
          serviceDefinitionId: definition.id,
          categoryId: definition.categoryId,
          pricingMode: definition.pricingMode,
        },
      },
      tx
    );
    return definition;
  });
}

export async function updateServiceDefinition(
  actor: AuthorizedStaffContext,
  serviceDefinitionId: string,
  input: {
    expectedVersion: number;
    code?: string;
    categoryId?: string;
    nameEn?: string;
    nameAr?: string;
    scopeEn?: string;
    scopeAr?: string;
    pricingMode?: "FIXED_SCOPE" | "QUOTE_REQUIRED";
    itemSku?: string | null;
    isActive?: boolean;
  },
  clientIp?: string
) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<Array<{ id: string; version: number }>>`
      SELECT id, version FROM service_definitions WHERE id = ${serviceDefinitionId}::uuid FOR UPDATE
    `;
    if (!locked)
      throw new OfferError(404, "SERVICE_NOT_FOUND", "Service definition was not found.");
    if (locked.version !== input.expectedVersion) {
      throw new OfferError(
        409,
        "CONCURRENT_MODIFICATION",
        "Service definition changed; refresh and retry."
      );
    }
    const current = await tx.serviceDefinition.findUnique({
      where: { id: serviceDefinitionId },
      include: { category: true },
    });
    if (!current)
      throw new OfferError(404, "SERVICE_NOT_FOUND", "Service definition was not found.");
    const categoryId = input.categoryId ?? current.categoryId;
    const category = await tx.serviceCategory.findUnique({ where: { id: categoryId } });
    if (!category || (!category.isActive && input.isActive !== false)) {
      throw new OfferError(
        422,
        "CATEGORY_INACTIVE",
        "An active category is required for an active service."
      );
    }
    const pricingMode = input.pricingMode ?? current.pricingMode;
    const itemSku = input.itemSku === undefined ? current.itemSku : input.itemSku;
    if (category.code === "GENERAL_REPAIRS" && pricingMode !== "QUOTE_REQUIRED") {
      throw new OfferError(
        422,
        "REPAIR_REQUIRES_QUOTE",
        "General repair offers must use a quote workflow."
      );
    }
    if (category.code === "ACCESSORIES" && !itemSku) {
      throw new OfferError(
        422,
        "ACCESSORY_SKU_REQUIRED",
        "Accessory definitions require an identifiable SKU."
      );
    }
    const { expectedVersion: _expectedVersion, ...changes } = input;
    const updated = await tx.serviceDefinition
      .update({
        where: { id: serviceDefinitionId },
        data: {
          ...changes,
          updatedByUserId: actor.userId,
          version: { increment: 1 },
        },
        include: { category: true },
      })
      .catch((error: unknown) => {
        if (isUniqueConflict(error)) {
          throw new OfferError(
            409,
            "SERVICE_CODE_ALREADY_EXISTS",
            "Service code is already in use."
          );
        }
        throw error;
      });
    await logAuditEvent(
      {
        actorUserId: actor.userId,
        eventType: "SERVICE_DEFINITION_UPDATED",
        targetEntity: `service_definition:${updated.id}`,
        ipFingerprint: auditFingerprint(clientIp),
        metadata: {
          action: "UPDATE_SERVICE_DEFINITION",
          serviceDefinitionId: updated.id,
          version: updated.version,
          isActive: updated.isActive,
        },
      },
      tx
    );
    return updated;
  });
}

export async function createOfferDraft(
  actor: AuthorizedStaffContext,
  input: {
    creationRequestId: string;
    providerOrganizationId: string;
    branchId: string;
    serviceDefinitionId: string;
    revisionRequestId: string;
    fields: OfferDraftFields;
  },
  clientIp?: string
) {
  const prisma = getPrisma();
  const fingerprint = creationRequestFingerprint(input);
  const readRetry = async () => {
    const existing = await prisma.offer.findUnique({
      where: { creationRequestId: input.creationRequestId },
      include: { revisions: { orderBy: { revisionNumber: "asc" }, take: 1 } },
    });
    if (!existing) return null;
    if (
      existing.createdByUserId !== actor.userId ||
      existing.creationRequestFingerprint !== fingerprint ||
      !existing.revisions[0]
    ) {
      throw new OfferError(409, "DUPLICATE_REQUEST", "Request ID has already been used.");
    }
    return serialize({ offer: existing, revision: withDerivedPricing(existing.revisions[0]) });
  };
  const prior = await readRetry();
  if (prior) return prior;
  try {
    return await prisma.$transaction(async (tx) => {
      await lockActiveProviderAndBranch(tx, input.providerOrganizationId, input.branchId);
      const definition = await getFixedServiceDefinition(tx, input.serviceDefinitionId, true);
      const offer = await tx.offer.create({
        data: {
          providerOrganizationId: input.providerOrganizationId,
          branchId: input.branchId,
          serviceDefinitionId: input.serviceDefinitionId,
          createdByUserId: actor.userId,
          creationRequestId: input.creationRequestId,
          creationRequestFingerprint: fingerprint,
          revisions: {
            create: {
              revisionNumber: 1,
              requestId: input.revisionRequestId,
              ...revisionSnapshot(definition),
              ...offerFieldsToData(input.fields),
              createdByUserId: actor.userId,
            },
          },
        },
        include: { revisions: true },
      });
      const revision = offer.revisions[0];
      await logAuditEvent(
        {
          actorUserId: actor.userId,
          eventType: "OFFER_DRAFT_CREATED",
          targetEntity: `offer_revision:${revision.id}`,
          ipFingerprint: auditFingerprint(clientIp),
          metadata: {
            action: "CREATE_OFFER_DRAFT",
            offerId: offer.id,
            revisionId: revision.id,
            revisionNumber: revision.revisionNumber,
            version: revision.version,
          },
        },
        tx
      );
      return serialize({ offer, revision: withDerivedPricing(revision) });
    });
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const existing = await readRetry();
    if (existing) return existing;
    throw new OfferError(409, "DUPLICATE_REQUEST", "Request ID has already been used.");
  }
}

export async function updateOfferDraft(
  actor: AuthorizedStaffContext,
  offerId: string,
  revisionId: string,
  input: { expectedVersion: number; fields: OfferDraftFields },
  clientIp?: string
) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const initial = await tx.offer.findUnique({
      where: { id: offerId },
      select: { providerOrganizationId: true, branchId: true },
    });
    if (!initial) throw new OfferError(404, "OFFER_NOT_FOUND", "Offer was not found.");
    await lockActiveProviderAndBranch(tx, initial.providerOrganizationId, initial.branchId);
    await tx.$queryRaw`SELECT id FROM offers WHERE id = ${offerId}::uuid FOR UPDATE`;
    const [revision] = await tx.$queryRaw<Array<OfferRevision>>`
      SELECT * FROM offer_revisions WHERE id = ${revisionId}::uuid AND "offerId" = ${offerId}::uuid FOR UPDATE
    `;
    if (!revision)
      throw new OfferError(404, "OFFER_REVISION_NOT_FOUND", "Offer revision was not found.");
    assertSalesOwnsDraft(actor, revision);
    if (revision.status !== "DRAFT")
      throw new OfferError(422, "INVALID_STATE_TRANSITION", "Only a draft revision can be edited.");
    if (revision.version !== input.expectedVersion)
      throw new OfferError(
        409,
        "CONCURRENT_MODIFICATION",
        "Offer draft changed; refresh and retry."
      );
    const definition = await getFixedServiceDefinition(tx, revision.serviceDefinitionId, true);
    const updated = await tx.offerRevision.updateMany({
      where: { id: revisionId, offerId, version: input.expectedVersion, status: "DRAFT" },
      data: {
        ...offerFieldsToData(input.fields),
        ...revisionSnapshot(definition),
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1)
      throw new OfferError(
        409,
        "CONCURRENT_MODIFICATION",
        "Offer draft changed; refresh and retry."
      );
    const result = await tx.offerRevision.findUniqueOrThrow({ where: { id: revisionId } });
    await logAuditEvent(
      {
        actorUserId: actor.userId,
        eventType: "OFFER_DRAFT_UPDATED",
        targetEntity: `offer_revision:${revisionId}`,
        ipFingerprint: auditFingerprint(clientIp),
        metadata: {
          action: "UPDATE_OFFER_DRAFT",
          offerId,
          revisionId,
          revisionNumber: result.revisionNumber,
          version: result.version,
        },
      },
      tx
    );
    return withDerivedPricing(result);
  });
}

export async function createOfferRevision(
  actor: AuthorizedStaffContext,
  offerId: string,
  requestId: string,
  clientIp?: string
) {
  const prisma = getPrisma();
  try {
    return await prisma.$transaction(async (tx) => {
      const initial = await tx.offer.findUnique({
        where: { id: offerId },
        select: { providerOrganizationId: true, branchId: true },
      });
      if (!initial) throw new OfferError(404, "OFFER_NOT_FOUND", "Offer was not found.");
      await lockActiveProviderAndBranch(tx, initial.providerOrganizationId, initial.branchId);
      await tx.$queryRaw`SELECT id FROM offers WHERE id = ${offerId}::uuid FOR UPDATE`;
      const offer = await tx.offer.findUniqueOrThrow({
        where: { id: offerId },
        include: { revisions: { orderBy: { revisionNumber: "desc" }, take: 1 } },
      });
      const latest = offer.revisions[0];
      if (!latest)
        throw new OfferError(404, "OFFER_REVISION_NOT_FOUND", "Offer revision was not found.");
      assertSalesOwnsDraft(actor, latest);
      if (latest.status !== "APPROVED" && latest.status !== "REJECTED") {
        throw new OfferError(
          422,
          "REVISION_NOT_DECIDED",
          "A new revision can only be created after the latest revision is approved or rejected."
        );
      }
      const definition = await getFixedServiceDefinition(tx, offer.serviceDefinitionId, true);
      const revision = await tx.offerRevision.create({
        data: {
          offerId,
          revisionNumber: offer.nextRevisionNumber,
          requestId,
          ...revisionSnapshot(definition),
          titleEn: latest.titleEn,
          titleAr: latest.titleAr,
          includedLaborEn: latest.includedLaborEn,
          includedLaborAr: latest.includedLaborAr,
          includedPartsEn: latest.includedPartsEn,
          includedPartsAr: latest.includedPartsAr,
          excludedLaborEn: latest.excludedLaborEn,
          excludedLaborAr: latest.excludedLaborAr,
          excludedPartsEn: latest.excludedPartsEn,
          excludedPartsAr: latest.excludedPartsAr,
          bookingRule: latest.bookingRule,
          durationMinutes: latest.durationMinutes,
          validFrom: latest.validFrom,
          validUntil: latest.validUntil,
          normalPriceMinor: latest.normalPriceMinor,
          customerPriceMinor: latest.customerPriceMinor,
          evidencePacketId: latest.evidencePacketId,
          evidenceType: latest.evidenceType,
          evidenceDate: latest.evidenceDate,
          priceBasisNotes: latest.priceBasisNotes,
          commercialTermsPacketId: latest.commercialTermsPacketId,
          commercialTermsAgreedAt: latest.commercialTermsAgreedAt,
          commissionBasis: latest.commissionBasis,
          commissionRateBps: latest.commissionRateBps,
          createdByUserId: actor.userId,
        },
      });
      await tx.offer.update({
        where: { id: offerId },
        data: { nextRevisionNumber: { increment: 1 } },
      });
      await logAuditEvent(
        {
          actorUserId: actor.userId,
          eventType: "OFFER_REVISION_CREATED",
          targetEntity: `offer_revision:${revision.id}`,
          ipFingerprint: auditFingerprint(clientIp),
          metadata: {
            action: "CREATE_OFFER_REVISION",
            offerId,
            revisionId: revision.id,
            revisionNumber: revision.revisionNumber,
          },
        },
        tx
      );
      return withDerivedPricing(revision);
    });
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const existing = await prisma.offerRevision.findUnique({ where: { requestId } });
    if (existing?.offerId === offerId && existing.createdByUserId === actor.userId)
      return withDerivedPricing(existing);
    throw new OfferError(409, "DUPLICATE_REQUEST", "Request ID has already been used.");
  }
}

export async function submitOfferRevision(
  actor: AuthorizedStaffContext,
  offerId: string,
  revisionId: string,
  expectedVersion: number,
  clientIp?: string
) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const initial = await tx.offer.findUnique({
      where: { id: offerId },
      select: { providerOrganizationId: true, branchId: true },
    });
    if (!initial) throw new OfferError(404, "OFFER_NOT_FOUND", "Offer was not found.");
    await lockActiveProviderAndBranch(tx, initial.providerOrganizationId, initial.branchId);
    await tx.$queryRaw`SELECT id FROM offers WHERE id = ${offerId}::uuid FOR UPDATE`;
    const [revision] = await tx.$queryRaw<Array<OfferRevision>>`
      SELECT * FROM offer_revisions WHERE id = ${revisionId}::uuid AND "offerId" = ${offerId}::uuid FOR UPDATE
    `;
    if (!revision)
      throw new OfferError(404, "OFFER_REVISION_NOT_FOUND", "Offer revision was not found.");
    assertSalesOwnsDraft(actor, revision);
    if (revision.status === "PENDING_REVIEW" && revision.submittedByUserId === actor.userId)
      return withDerivedPricing(revision);
    if (revision.status !== "DRAFT")
      throw new OfferError(
        422,
        "INVALID_STATE_TRANSITION",
        "Only a draft revision can be submitted."
      );
    if (revision.version !== expectedVersion)
      throw new OfferError(
        409,
        "CONCURRENT_MODIFICATION",
        "Offer draft changed; refresh and retry."
      );
    await getFixedServiceDefinition(tx, revision.serviceDefinitionId, true);
    if (revision.validUntil <= new Date())
      throw new OfferError(422, "OFFER_EXPIRED", "Offer validity must extend beyond submission.");
    const updated = await tx.offerRevision.updateMany({
      where: { id: revisionId, offerId, version: expectedVersion, status: "DRAFT" },
      data: {
        status: "PENDING_REVIEW",
        submittedByUserId: actor.userId,
        submittedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1)
      throw new OfferError(
        409,
        "CONCURRENT_MODIFICATION",
        "Offer revision changed; refresh and retry."
      );
    const result = await tx.offerRevision.findUniqueOrThrow({ where: { id: revisionId } });
    await logAuditEvent(
      {
        actorUserId: actor.userId,
        eventType: "OFFER_SUBMITTED_FOR_REVIEW",
        targetEntity: `offer_revision:${revisionId}`,
        ipFingerprint: auditFingerprint(clientIp),
        metadata: {
          action: "SUBMIT_OFFER_FOR_REVIEW",
          offerId,
          revisionId,
          revisionNumber: result.revisionNumber,
          version: result.version,
        },
      },
      tx
    );
    return withDerivedPricing(result);
  });
}

export async function listPendingOfferRevisions() {
  const prisma = getPrisma();
  const revisions = await prisma.offerRevision.findMany({
    where: { status: "PENDING_REVIEW" },
    include: {
      offer: {
        include: {
          providerOrganization: { select: { id: true, nameEn: true, nameAr: true, status: true } },
          branch: {
            select: { id: true, branchCode: true, nameEn: true, nameAr: true, status: true },
          },
          currentApprovedRevision: { select: { id: true } },
        },
      },
      createdByUser: { select: { id: true, name: true } },
      submittedByUser: { select: { id: true, name: true } },
    },
    orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
  });
  return serialize(revisions.map(withDerivedPricing));
}

async function lockOfferRevision(
  tx: Prisma.TransactionClient,
  offerId: string,
  revisionId: string
) {
  const initial = await tx.offer.findUnique({
    where: { id: offerId },
    select: { providerOrganizationId: true, branchId: true },
  });
  if (!initial) throw new OfferError(404, "OFFER_NOT_FOUND", "Offer was not found.");
  const providerAndBranch = await lockProviderAndBranch(
    tx,
    initial.providerOrganizationId,
    initial.branchId
  );
  await tx.$queryRaw`SELECT id FROM offers WHERE id = ${offerId}::uuid FOR UPDATE`;
  const [revision] = await tx.$queryRaw<Array<OfferRevision>>`
    SELECT * FROM offer_revisions WHERE id = ${revisionId}::uuid AND "offerId" = ${offerId}::uuid FOR UPDATE
  `;
  if (!revision)
    throw new OfferError(404, "OFFER_REVISION_NOT_FOUND", "Offer revision was not found.");
  return { initial, revision, ...providerAndBranch };
}

export async function approveOfferRevision(
  actor: AuthorizedStaffContext,
  offerId: string,
  revisionId: string,
  input: {
    expectedVersion: number;
    evidenceInspected: true;
    priceVerified: true;
    scopeVerified: true;
    providerConsentVerified: true;
  },
  clientIp?: string
) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const { revision, provider, branch } = await lockOfferRevision(tx, offerId, revisionId);
    if (revision.status === "APPROVED" && revision.decidedByUserId === actor.userId)
      return withDerivedPricing(revision);
    if (revision.status !== "PENDING_REVIEW") {
      if (revision.status === "APPROVED" || revision.status === "REJECTED") {
        throw new OfferError(409, "ALREADY_DECIDED", "Offer revision has already been decided.");
      }
      throw new OfferError(
        422,
        "INVALID_STATE_TRANSITION",
        "Only pending revisions can be approved."
      );
    }
    if (!getServerEnv().OFFER_EVIDENCE_PACKET_REPOSITORY_READY) {
      throw new OfferError(
        503,
        "OFFER_APPROVAL_BLOCKED",
        "Offer approval is disabled until the company-controlled evidence packet repository and Operations access are ready."
      );
    }
    assertProviderAndBranchApprovable(provider, branch);
    if (revision.version !== input.expectedVersion)
      throw new OfferError(
        409,
        "CONCURRENT_MODIFICATION",
        "Offer revision changed; refresh and retry."
      );
    if (revision.createdByUserId === actor.userId || revision.submittedByUserId === actor.userId) {
      throw new OfferError(
        403,
        "MAKER_CHECKER_VIOLATION",
        "The offer creator or submitter cannot approve it."
      );
    }
    await getFixedServiceDefinition(tx, revision.serviceDefinitionId, true);
    const approvalTime = new Date();
    if (revision.validUntil <= approvalTime)
      throw new OfferError(422, "OFFER_EXPIRED", "Expired offer revisions cannot be approved.");
    if (revision.evidenceDate > approvalTime || revision.commercialTermsAgreedAt > approvalTime) {
      throw new OfferError(
        422,
        "FUTURE_DATED_EVIDENCE",
        "Price evidence and commercial agreement dates cannot be in the future."
      );
    }
    const updated = await tx.offerRevision.updateMany({
      where: { id: revisionId, offerId, version: input.expectedVersion, status: "PENDING_REVIEW" },
      data: {
        status: "APPROVED",
        decidedByUserId: actor.userId,
        decidedAt: approvalTime,
        evidenceInspected: true,
        priceVerified: true,
        scopeVerified: true,
        providerConsentVerified: true,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1)
      throw new OfferError(
        409,
        "CONCURRENT_MODIFICATION",
        "Offer revision changed; refresh and retry."
      );
    await tx.offer.update({
      where: { id: offerId },
      data: { currentApprovedRevisionId: revisionId },
    });
    const result = await tx.offerRevision.findUniqueOrThrow({ where: { id: revisionId } });
    await logAuditEvent(
      {
        actorUserId: actor.userId,
        eventType: "OFFER_APPROVED",
        targetEntity: `offer_revision:${revisionId}`,
        ipFingerprint: auditFingerprint(clientIp),
        metadata: {
          action: "APPROVE_OFFER",
          offerId,
          revisionId,
          revisionNumber: result.revisionNumber,
          evidenceInspected: true,
          priceVerified: true,
          scopeVerified: true,
          providerConsentVerified: true,
        },
      },
      tx
    );
    return withDerivedPricing(result);
  });
}

export async function rejectOfferRevision(
  actor: AuthorizedStaffContext,
  offerId: string,
  revisionId: string,
  input: {
    expectedVersion: number;
    reasonCode:
      | "PRICE_EVIDENCE_UNAVAILABLE"
      | "PRICE_NOT_VERIFIED"
      | "SCOPE_INCOMPLETE"
      | "PROVIDER_CONSENT_UNVERIFIED"
      | "COMMERCIAL_TERMS_INCOMPLETE"
      | "OTHER";
  },
  clientIp?: string
) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const { revision } = await lockOfferRevision(tx, offerId, revisionId);
    if (
      revision.status === "REJECTED" &&
      revision.decidedByUserId === actor.userId &&
      revision.rejectionReason === input.reasonCode
    )
      return withDerivedPricing(revision);
    if (revision.status !== "PENDING_REVIEW") {
      if (revision.status === "APPROVED" || revision.status === "REJECTED") {
        throw new OfferError(409, "ALREADY_DECIDED", "Offer revision has already been decided.");
      }
      throw new OfferError(
        422,
        "INVALID_STATE_TRANSITION",
        "Only pending revisions can be rejected."
      );
    }
    if (revision.version !== input.expectedVersion)
      throw new OfferError(
        409,
        "CONCURRENT_MODIFICATION",
        "Offer revision changed; refresh and retry."
      );
    if (revision.createdByUserId === actor.userId || revision.submittedByUserId === actor.userId) {
      throw new OfferError(
        403,
        "MAKER_CHECKER_VIOLATION",
        "The offer creator or submitter cannot reject it."
      );
    }
    const updated = await tx.offerRevision.updateMany({
      where: { id: revisionId, offerId, version: input.expectedVersion, status: "PENDING_REVIEW" },
      data: {
        status: "REJECTED",
        decidedByUserId: actor.userId,
        decidedAt: new Date(),
        rejectionReason: input.reasonCode,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1)
      throw new OfferError(
        409,
        "CONCURRENT_MODIFICATION",
        "Offer revision changed; refresh and retry."
      );
    const result = await tx.offerRevision.findUniqueOrThrow({ where: { id: revisionId } });
    await logAuditEvent(
      {
        actorUserId: actor.userId,
        eventType: "OFFER_REJECTED",
        targetEntity: `offer_revision:${revisionId}`,
        ipFingerprint: auditFingerprint(clientIp),
        metadata: {
          action: "REJECT_OFFER",
          offerId,
          revisionId,
          revisionNumber: result.revisionNumber,
          reasonCode: input.reasonCode,
        },
      },
      tx
    );
    return withDerivedPricing(result);
  });
}

export async function getOfferForStaff(actor: AuthorizedStaffContext, offerId: string) {
  const offer = await readOffer(offerId);
  if (!offer) throw new OfferError(404, "OFFER_NOT_FOUND", "Offer was not found.");
  if (
    actor.roleAssignment.role === "SALES_AGENT" &&
    !offer.revisions.some((revision) => revision.createdByUserId === actor.userId)
  ) {
    throw new OfferError(404, "OFFER_NOT_FOUND", "Offer was not found.");
  }
  return serialize({ ...offer, revisions: offer.revisions.map(withDerivedPricing) });
}

export async function listOffersForStaff(
  actor: AuthorizedStaffContext,
  status?: OfferRevisionStatus
) {
  const prisma = getPrisma();
  const revisions = await prisma.offerRevision.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(actor.roleAssignment.role === "SALES_AGENT" ? { createdByUserId: actor.userId } : {}),
    },
    include: {
      offer: {
        include: {
          providerOrganization: { select: { id: true, nameEn: true, nameAr: true, status: true } },
          branch: {
            select: { id: true, branchCode: true, nameEn: true, nameAr: true, status: true },
          },
          currentApprovedRevision: { select: { id: true, revisionNumber: true } },
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: 100,
  });
  return serialize(revisions.map(withDerivedPricing));
}

export function newRequestId() {
  return crypto.randomUUID();
}

export function isOfferRevisionStatus(value: string): value is OfferRevisionStatus {
  return ["DRAFT", "PENDING_REVIEW", "APPROVED", "REJECTED"].includes(value);
}
