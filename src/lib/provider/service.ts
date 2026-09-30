import "server-only";
import { getPrisma } from "@/lib/db";
import {
  Prisma,
  type ProviderStatus,
  type BranchStatus,
  type CairoCluster,
} from "@/generated/prisma/client";
import type { AuthorizedStaffContext } from "@/lib/dal";
import { logAuditEvent, createAuditFingerprint } from "@/lib/dal/audit";
import {
  type CreateProviderDraftInput,
  type UpdateProviderDraftInput,
  type CreateBranchDraftInput,
  type UpdateBranchDraftInput,
  type ActivateBranchInput,
  type RejectBranchInput,
  type RejectProviderInput,
  type PauseProviderInput,
  type PauseBranchInput,
} from "./validation";

export class ProviderError extends Error {
  readonly status: 400 | 403 | 404 | 409 | 422 | 500;
  readonly code: string;

  constructor(status: 400 | 403 | 404 | 409 | 422 | 500, code: string, message: string) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
    this.code = code;
  }

  toResponse(): Response {
    return Response.json(
      { error: this.code, message: this.message },
      { status: this.status, headers: { "Cache-Control": "no-store" } }
    );
  }
}

/**
 * Robustly inspects Prisma unique constraint violations (P2002) and maps them
 * to structured HTTP 409 domain errors.
 */
function handlePrismaUniqueConstraint(err: unknown, entity: "provider" | "branch"): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    const rawTarget = err.meta?.target;
    const targetParts: string[] = [];
    if (Array.isArray(rawTarget)) {
      targetParts.push(...rawTarget.map((t) => String(t)));
    } else if (typeof rawTarget === "string") {
      targetParts.push(rawTarget);
    } else if (rawTarget) {
      targetParts.push(JSON.stringify(rawTarget));
    }
    if (err.message) {
      targetParts.push(err.message);
    }
    const combined = targetParts.join(" ").toLowerCase();

    if (
      combined.includes("taxregistrationnumber") ||
      combined.includes("tax_registration_number") ||
      combined.includes("tax")
    ) {
      throw new ProviderError(
        409,
        "TAX_ID_ALREADY_EXISTS",
        "A provider organization with this Tax Registration Number already exists."
      );
    }
    if (
      combined.includes("commercialregistrationnumber") ||
      combined.includes("commercial_registration_number") ||
      combined.includes("commercial")
    ) {
      throw new ProviderError(
        409,
        "CR_NUMBER_ALREADY_EXISTS",
        "A provider organization with this Commercial Registration Number already exists."
      );
    }
    if (combined.includes("branchcode") || combined.includes("branch_code")) {
      throw new ProviderError(
        409,
        "BRANCH_CODE_ALREADY_EXISTS",
        "A branch with this code already exists for this provider organization."
      );
    }

    if (entity === "provider") {
      throw new ProviderError(
        409,
        "PROVIDER_ALREADY_EXISTS",
        "A provider organization with this unique attribute already exists."
      );
    } else {
      throw new ProviderError(
        409,
        "BRANCH_CODE_ALREADY_EXISTS",
        "A branch with this code already exists for this provider organization."
      );
    }
  }
  throw err;
}

/**
 * Determines operational availability: a physical workshop branch is available
 * for customer appointments only when BOTH the individual branch and its parent
 * organization have been vetted and are in ACTIVE status.
 */
export function isBranchOperationallyAvailable(
  branchStatus: BranchStatus,
  parentStatus: ProviderStatus
): boolean {
  return branchStatus === "ACTIVE" && parentStatus === "ACTIVE";
}

/**
 * Creates a new provider organization draft.
 * Atomic: Organization record and sanitized audit log are persisted together in one transaction.
 */
export async function createProviderDraft(
  actor: AuthorizedStaffContext,
  input: CreateProviderDraftInput,
  clientIp?: string
) {
  const prisma = getPrisma();

  try {
    return await prisma.$transaction(async (tx) => {
      const provider = await tx.providerOrganization.create({
        data: {
          nameEn: input.nameEn,
          nameAr: input.nameAr,
          legalName: input.legalName,
          taxRegistrationNumber: input.taxRegistrationNumber,
          commercialRegistrationNumber: input.commercialRegistrationNumber,
          primaryCluster: input.primaryCluster,
          contactPersonName: input.contactPersonName,
          contactEmail: input.contactEmail,
          contactPhone: input.contactPhone,
          createdByUserId: actor.userId,
          status: "DRAFT",
          version: 1,
        },
        include: { branches: true },
      });

      const ipFingerprint = clientIp ? createAuditFingerprint(clientIp) : null;
      await logAuditEvent(
        {
          actorUserId: actor.userId,
          eventType: "PROVIDER_DRAFT_CREATED",
          targetEntity: `provider:${provider.id}`,
          ipFingerprint,
          metadata: {
            action: "CREATE_PROVIDER_DRAFT",
            providerId: provider.id,
            cluster: provider.primaryCluster,
          },
        },
        tx
      );

      return provider;
    });
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    handlePrismaUniqueConstraint(err, "provider");
  }
}

/**
 * Updates a provider organization draft.
 * Concurrency: Locks the parent row FOR UPDATE and verifies version matches expectedVersion.
 * Invariant: Sales may only edit records in DRAFT status.
 */
export async function updateProviderDraft(
  actor: AuthorizedStaffContext,
  providerId: string,
  input: UpdateProviderDraftInput,
  clientIp?: string
) {
  const prisma = getPrisma();

  try {
    return await prisma.$transaction(async (tx) => {
      const [parent] = await tx.$queryRaw<
        Array<{
          id: string;
          status: ProviderStatus;
          version: number;
        }>
      >`
        SELECT id, status, version
        FROM provider_organizations
        WHERE id = ${providerId}::uuid
        FOR UPDATE
      `;

      if (!parent) {
        throw new ProviderError(404, "PROVIDER_NOT_FOUND", "Provider organization not found.");
      }

      if (parent.status !== "DRAFT") {
        throw new ProviderError(
          422,
          "INVALID_STATE_TRANSITION",
          `Provider can only be edited while in DRAFT status. Current status: ${parent.status}. Active or pending providers cannot be edited directly; pause the provider and request an operational amendment.`
        );
      }

      if (parent.version !== input.expectedVersion) {
        throw new ProviderError(
          409,
          "CONCURRENT_MODIFICATION",
          "Provider was modified concurrently by another user. Please refresh and retry."
        );
      }

      const updated = await tx.providerOrganization.update({
        where: { id: providerId },
        data: {
          nameEn: input.nameEn,
          nameAr: input.nameAr,
          legalName: input.legalName,
          taxRegistrationNumber: input.taxRegistrationNumber,
          commercialRegistrationNumber: input.commercialRegistrationNumber,
          primaryCluster: input.primaryCluster,
          contactPersonName: input.contactPersonName,
          contactEmail: input.contactEmail,
          contactPhone: input.contactPhone,
          version: { increment: 1 },
        },
        include: { branches: true },
      });

      const ipFingerprint = clientIp ? createAuditFingerprint(clientIp) : null;
      await logAuditEvent(
        {
          actorUserId: actor.userId,
          eventType: "PROVIDER_DRAFT_UPDATED",
          targetEntity: `provider:${updated.id}`,
          ipFingerprint,
          metadata: {
            action: "UPDATE_PROVIDER_DRAFT",
            providerId: updated.id,
            version: updated.version,
          },
        },
        tx
      );

      return updated;
    });
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    handlePrismaUniqueConstraint(err, "provider");
  }
}

/**
 * Creates a physical workshop branch draft under a provider organization.
 * Concurrency: Locks parent provider organization FOR UPDATE to prevent race conditions
 * with submission or activation.
 */
export async function createBranchDraft(
  actor: AuthorizedStaffContext,
  providerId: string,
  input: CreateBranchDraftInput,
  clientIp?: string
) {
  const prisma = getPrisma();

  try {
    return await prisma.$transaction(async (tx) => {
      const [parent] = await tx.$queryRaw<
        Array<{
          id: string;
          status: ProviderStatus;
          version: number;
        }>
      >`
        SELECT id, status, version
        FROM provider_organizations
        WHERE id = ${providerId}::uuid
        FOR UPDATE
      `;

      if (!parent) {
        throw new ProviderError(404, "PROVIDER_NOT_FOUND", "Provider organization not found.");
      }

      if (parent.status !== "DRAFT") {
        throw new ProviderError(
          422,
          "INVALID_STATE_TRANSITION",
          `Branches can only be added while provider is in DRAFT status. Current provider status: ${parent.status}.`
        );
      }

      const branch = await tx.providerBranch.create({
        data: {
          providerOrganizationId: providerId,
          branchCode: input.branchCode,
          nameEn: input.nameEn,
          nameAr: input.nameAr,
          cluster: input.cluster,
          streetAddressEn: input.streetAddressEn,
          streetAddressAr: input.streetAddressAr,
          landmarkEn: input.landmarkEn,
          landmarkAr: input.landmarkAr,
          latitude: input.latitude,
          longitude: input.longitude,
          contactPhone: input.contactPhone,
          operatingHours: input.operatingHours,
          status: "DRAFT",
          version: 1,
        },
      });

      const ipFingerprint = clientIp ? createAuditFingerprint(clientIp) : null;
      await logAuditEvent(
        {
          actorUserId: actor.userId,
          eventType: "BRANCH_DRAFT_CREATED",
          targetEntity: `provider_branch:${branch.id}`,
          ipFingerprint,
          metadata: {
            action: "CREATE_BRANCH_DRAFT",
            branchId: branch.id,
            providerId,
            branchCode: branch.branchCode,
            cluster: branch.cluster,
          },
        },
        tx
      );

      return branch;
    });
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    handlePrismaUniqueConstraint(err, "branch");
  }
}

/**
 * Updates an individual branch draft.
 * Ownership: Verifies branch.providerOrganizationId === providerId; returns 404 on mismatch.
 * Concurrency: Locks parent then branch FOR UPDATE; verifies expectedVersion matches.
 * Invariant: Can only be edited while both parent and branch are in DRAFT status.
 */
export async function updateBranchDraft(
  actor: AuthorizedStaffContext,
  providerId: string,
  branchId: string,
  input: UpdateBranchDraftInput,
  clientIp?: string
) {
  const prisma = getPrisma();

  try {
    return await prisma.$transaction(async (tx) => {
      // 1. Lock parent first to establish canonical lock hierarchy
      const [parent] = await tx.$queryRaw<
        Array<{
          id: string;
          status: ProviderStatus;
          version: number;
        }>
      >`
        SELECT id, status, version
        FROM provider_organizations
        WHERE id = ${providerId}::uuid
        FOR UPDATE
      `;

      if (!parent) {
        throw new ProviderError(404, "PROVIDER_NOT_FOUND", "Provider organization not found.");
      }

      if (parent.status !== "DRAFT") {
        throw new ProviderError(
          422,
          "INVALID_STATE_TRANSITION",
          `Branches can only be edited while provider organization is in DRAFT status. Current status: ${parent.status}.`
        );
      }

      // 2. Lock branch and verify parent ownership
      const [branch] = await tx.$queryRaw<
        Array<{
          id: string;
          status: BranchStatus;
          version: number;
          providerOrganizationId: string;
        }>
      >`
        SELECT id, status, version, "providerOrganizationId"
        FROM provider_branches
        WHERE id = ${branchId}::uuid AND "providerOrganizationId" = ${providerId}::uuid
        FOR UPDATE
      `;

      if (!branch) {
        throw new ProviderError(
          404,
          "BRANCH_NOT_FOUND",
          "Branch not found for the specified provider organization."
        );
      }

      if (branch.status !== "DRAFT") {
        throw new ProviderError(
          422,
          "INVALID_STATE_TRANSITION",
          `Only draft branches can be edited. Current status: ${branch.status}.`
        );
      }

      if (branch.version !== input.expectedVersion) {
        throw new ProviderError(
          409,
          "CONCURRENT_MODIFICATION",
          "Branch was modified concurrently by another user. Please refresh and retry."
        );
      }

      const updated = await tx.providerBranch.update({
        where: { id: branchId },
        data: {
          nameEn: input.nameEn,
          nameAr: input.nameAr,
          cluster: input.cluster,
          streetAddressEn: input.streetAddressEn,
          streetAddressAr: input.streetAddressAr,
          landmarkEn: input.landmarkEn,
          landmarkAr: input.landmarkAr,
          latitude: input.latitude,
          longitude: input.longitude,
          contactPhone: input.contactPhone,
          operatingHours: input.operatingHours,
          version: { increment: 1 },
        },
      });

      const ipFingerprint = clientIp ? createAuditFingerprint(clientIp) : null;
      await logAuditEvent(
        {
          actorUserId: actor.userId,
          eventType: "BRANCH_DRAFT_UPDATED",
          targetEntity: `provider_branch:${updated.id}`,
          ipFingerprint,
          metadata: {
            action: "UPDATE_BRANCH_DRAFT",
            branchId: updated.id,
            version: updated.version,
          },
        },
        tx
      );

      return updated;
    });
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    handlePrismaUniqueConstraint(err, "branch");
  }
}

/**
 * Submits a provider organization for Operations review.
 * Concurrency: Locks parent row FOR UPDATE and verifies version matches expectedVersion.
 * Invariant: Must have at least one draft branch before submission.
 */
export async function submitProviderForReview(
  actor: AuthorizedStaffContext,
  providerId: string,
  input: { expectedVersion: number },
  clientIp?: string
) {
  const prisma = getPrisma();

  return await prisma.$transaction(async (tx) => {
    const [parent] = await tx.$queryRaw<
      Array<{
        id: string;
        status: ProviderStatus;
        version: number;
        primaryCluster: CairoCluster;
      }>
    >`
      SELECT id, status, version, "primaryCluster"
      FROM provider_organizations
      WHERE id = ${providerId}::uuid
      FOR UPDATE
    `;

    if (!parent) {
      throw new ProviderError(404, "PROVIDER_NOT_FOUND", "Provider organization not found.");
    }

    if (parent.status !== "DRAFT") {
      throw new ProviderError(
        422,
        "INVALID_STATE_TRANSITION",
        `Only DRAFT providers can be submitted for review. Current status: ${parent.status}.`
      );
    }

    if (parent.version !== input.expectedVersion) {
      throw new ProviderError(
        409,
        "CONCURRENT_MODIFICATION",
        "Provider was modified concurrently by another user. Please refresh and retry."
      );
    }

    // Must have at least one draft branch under this provider
    const draftBranches = await tx.providerBranch.findMany({
      where: { providerOrganizationId: providerId, status: "DRAFT" },
      select: { id: true, cluster: true },
    });

    if (draftBranches.length === 0) {
      throw new ProviderError(
        422,
        "BRANCH_REQUIRED",
        "Provider must have at least one branch before submission for review."
      );
    }

    const updated = await tx.providerOrganization.update({
      where: { id: providerId },
      data: {
        status: "PENDING_REVIEW",
        submittedByUserId: actor.userId,
        submittedAt: new Date(),
        rejectionReason: null,
        version: { increment: 1 },
      },
      include: { branches: true },
    });

    const ipFingerprint = clientIp ? createAuditFingerprint(clientIp) : null;
    await logAuditEvent(
      {
        actorUserId: actor.userId,
        eventType: "PROVIDER_SUBMITTED_FOR_REVIEW",
        targetEntity: `provider:${updated.id}`,
        ipFingerprint,
        metadata: {
          action: "SUBMIT_PROVIDER",
          providerId: updated.id,
          cluster: updated.primaryCluster,
          branchCount: draftBranches.length,
          version: updated.version,
        },
      },
      tx
    );

    return updated;
  });
}

/**
 * Operations vets and activates an individual workshop branch.
 * Ownership: Verifies branch.providerOrganizationId === providerId; returns 404 on mismatch.
 * Maker-Checker: Operations staff cannot vet/activate a branch for a provider they submitted as sales.
 * Invariants: Legal identity, physical location, and contact/operating hours checks must all be true.
 * Opaque evidence document reference is recorded.
 */
export async function activateBranch(
  actor: AuthorizedStaffContext,
  providerId: string,
  branchId: string,
  input: ActivateBranchInput,
  clientIp?: string
) {
  const prisma = getPrisma();

  return await prisma.$transaction(async (tx) => {
    // 1. Lock parent provider organization
    const [parent] = await tx.$queryRaw<
      Array<{
        id: string;
        status: ProviderStatus;
        version: number;
        submittedByUserId: string | null;
      }>
    >`
      SELECT id, status, version, "submittedByUserId"
      FROM provider_organizations
      WHERE id = ${providerId}::uuid
      FOR UPDATE
    `;

    if (!parent) {
      throw new ProviderError(404, "PROVIDER_NOT_FOUND", "Provider organization not found.");
    }

    // 2. Lock branch and verify parent ownership
    const [branch] = await tx.$queryRaw<
      Array<{
        id: string;
        status: BranchStatus;
        version: number;
        cluster: CairoCluster;
        providerOrganizationId: string;
      }>
    >`
      SELECT id, status, version, cluster, "providerOrganizationId"
      FROM provider_branches
      WHERE id = ${branchId}::uuid AND "providerOrganizationId" = ${providerId}::uuid
      FOR UPDATE
    `;

    if (!branch) {
      throw new ProviderError(
        404,
        "BRANCH_NOT_FOUND",
        "Branch not found for the specified provider organization."
      );
    }

    // Maker-Checker Invariant
    if (parent.submittedByUserId === actor.userId) {
      throw new ProviderError(
        403,
        "MAKER_CHECKER_VIOLATION",
        "Operations staff cannot vet or activate a branch for a provider they submitted as a sales agent."
      );
    }

    if (parent.status !== "PENDING_REVIEW" && parent.status !== "ACTIVE") {
      throw new ProviderError(
        422,
        "INVALID_STATE_TRANSITION",
        `Branch can only be activated when provider is under review or active. Current provider status: ${parent.status}.`
      );
    }

    if (branch.status !== "DRAFT") {
      throw new ProviderError(
        422,
        "INVALID_STATE_TRANSITION",
        `Only draft branches can be activated. Current branch status: ${branch.status}.`
      );
    }

    if (branch.version !== input.expectedVersion) {
      throw new ProviderError(
        409,
        "CONCURRENT_MODIFICATION",
        "Branch was modified concurrently by another user. Please refresh and retry."
      );
    }

    // Vetting checklist verification
    if (
      !input.legalIdentityChecked ||
      !input.physicalLocationChecked ||
      !input.contactAndHoursChecked
    ) {
      throw new ProviderError(
        400,
        "VETTING_CHECKS_INCOMPLETE",
        "All vetting checklist items (legal identity, physical location, contact and operating hours) must be confirmed."
      );
    }

    const updated = await tx.providerBranch.update({
      where: { id: branchId },
      data: {
        status: "ACTIVE",
        legalIdentityChecked: true,
        physicalLocationChecked: true,
        contactAndHoursChecked: true,
        evidenceDocumentRef: input.evidenceDocumentRef,
        vettedByUserId: actor.userId,
        vettedAt: new Date(),
        rejectionReason: null,
        version: { increment: 1 },
      },
    });

    const ipFingerprint = clientIp ? createAuditFingerprint(clientIp) : null;
    await logAuditEvent(
      {
        actorUserId: actor.userId,
        eventType: "BRANCH_ACTIVATED",
        targetEntity: `provider_branch:${updated.id}`,
        ipFingerprint,
        metadata: {
          action: "ACTIVATE_BRANCH",
          branchId: updated.id,
          providerId,
          cluster: updated.cluster,
        },
      },
      tx
    );

    return updated;
  });
}

/**
 * Operations rejects an individual branch.
 * If remediable: returns branch to DRAFT so Sales can adjust and re-vet.
 * If non-remediable: moves branch to DECOMMISSIONED (terminal).
 */
export async function rejectBranch(
  actor: AuthorizedStaffContext,
  providerId: string,
  branchId: string,
  input: RejectBranchInput,
  clientIp?: string
) {
  const prisma = getPrisma();

  return await prisma.$transaction(async (tx) => {
    // 1. Lock parent
    const [parent] = await tx.$queryRaw<
      Array<{
        id: string;
        status: ProviderStatus;
        version: number;
        submittedByUserId: string | null;
      }>
    >`
      SELECT id, status, version, "submittedByUserId"
      FROM provider_organizations
      WHERE id = ${providerId}::uuid
      FOR UPDATE
    `;

    if (!parent) {
      throw new ProviderError(404, "PROVIDER_NOT_FOUND", "Provider organization not found.");
    }

    // 2. Lock branch and verify parent ownership
    const [branch] = await tx.$queryRaw<
      Array<{
        id: string;
        status: BranchStatus;
        version: number;
      }>
    >`
      SELECT id, status, version
      FROM provider_branches
      WHERE id = ${branchId}::uuid AND "providerOrganizationId" = ${providerId}::uuid
      FOR UPDATE
    `;

    if (!branch) {
      throw new ProviderError(
        404,
        "BRANCH_NOT_FOUND",
        "Branch not found for the specified provider organization."
      );
    }

    // Maker-Checker Invariant
    if (parent.submittedByUserId === actor.userId) {
      throw new ProviderError(
        403,
        "MAKER_CHECKER_VIOLATION",
        "Operations staff cannot reject a branch for a provider they submitted as a sales agent."
      );
    }

    // Branch rejection is an onboarding-review action ONLY: requires parent in PENDING_REVIEW
    if (parent.status !== "PENDING_REVIEW") {
      throw new ProviderError(
        422,
        "INVALID_STATE_TRANSITION",
        `Branch rejection is an onboarding review action only and requires provider organization to be in PENDING_REVIEW status. Current status: ${parent.status}. For live branches, use branch pause.`
      );
    }

    if (branch.status !== "DRAFT" && branch.status !== "ACTIVE") {
      throw new ProviderError(
        422,
        "INVALID_STATE_TRANSITION",
        `Branch cannot be rejected from status: ${branch.status}.`
      );
    }

    if (branch.version !== input.expectedVersion) {
      throw new ProviderError(
        409,
        "CONCURRENT_MODIFICATION",
        "Branch was modified concurrently by another user. Please refresh and retry."
      );
    }

    const nextStatus: BranchStatus = input.remediable ? "DRAFT" : "DECOMMISSIONED";

    const updated = await tx.providerBranch.update({
      where: { id: branchId },
      data: {
        status: nextStatus,
        legalIdentityChecked: false,
        physicalLocationChecked: false,
        contactAndHoursChecked: false,
        evidenceDocumentRef: null,
        vettedByUserId: null,
        vettedAt: null,
        rejectionReason: input.rejectionReason,
        version: { increment: 1 },
      },
    });

    const ipFingerprint = clientIp ? createAuditFingerprint(clientIp) : null;

    if (input.remediable) {
      // Return parent provider to DRAFT so Sales can edit and remediate
      await tx.providerOrganization.update({
        where: { id: providerId },
        data: {
          status: "DRAFT",
          rejectionReason: input.rejectionReason,
          version: { increment: 1 },
        },
      });

      // Invalidate any other active branch approvals and clear vetting fields
      await tx.providerBranch.updateMany({
        where: {
          providerOrganizationId: providerId,
          id: { not: branchId },
          status: { not: "DECOMMISSIONED" },
        },
        data: {
          status: "DRAFT",
          legalIdentityChecked: false,
          physicalLocationChecked: false,
          contactAndHoursChecked: false,
          evidenceDocumentRef: null,
          vettedByUserId: null,
          vettedAt: null,
          version: { increment: 1 },
        },
      });

      // Log both branch and provider rejection events
      await logAuditEvent(
        {
          actorUserId: actor.userId,
          eventType: "BRANCH_REJECTED",
          targetEntity: `provider_branch:${updated.id}`,
          ipFingerprint,
          metadata: {
            action: "REJECT_BRANCH",
            branchId: updated.id,
            providerId,
            returnToDraft: true,
            reasonCode: input.reasonCode,
          },
        },
        tx
      );

      await logAuditEvent(
        {
          actorUserId: actor.userId,
          eventType: "PROVIDER_REJECTED",
          targetEntity: `provider:${providerId}`,
          ipFingerprint,
          metadata: {
            action: "REJECT_PROVIDER",
            providerId,
            returnToDraft: true,
            reasonCode: input.reasonCode,
          },
        },
        tx
      );
    } else {
      // Terminal rejection: branch permanently decommissioned
      await logAuditEvent(
        {
          actorUserId: actor.userId,
          eventType: "BRANCH_REJECTED",
          targetEntity: `provider_branch:${updated.id}`,
          ipFingerprint,
          metadata: {
            action: "REJECT_BRANCH",
            branchId: updated.id,
            providerId,
            returnToDraft: false,
            reasonCode: input.reasonCode,
          },
        },
        tx
      );
    }

    return updated;
  });
}

/**
 * Operations activates a provider organization.
 * Maker-Checker: Submitting sales user cannot activate the provider.
 * Invariant: Provider activation requires at least one individually vetted and ACTIVE branch.
 * Concurrency: Locks parent row FOR UPDATE; verifies expectedVersion matches.
 */
export async function activateProvider(
  actor: AuthorizedStaffContext,
  providerId: string,
  input: { expectedVersion: number },
  clientIp?: string
) {
  const prisma = getPrisma();

  return await prisma.$transaction(async (tx) => {
    const [parent] = await tx.$queryRaw<
      Array<{
        id: string;
        status: ProviderStatus;
        version: number;
        submittedByUserId: string | null;
        primaryCluster: CairoCluster;
      }>
    >`
      SELECT id, status, version, "submittedByUserId", "primaryCluster"
      FROM provider_organizations
      WHERE id = ${providerId}::uuid
      FOR UPDATE
    `;

    if (!parent) {
      throw new ProviderError(404, "PROVIDER_NOT_FOUND", "Provider organization not found.");
    }

    if (parent.status !== "PENDING_REVIEW") {
      throw new ProviderError(
        422,
        "INVALID_STATE_TRANSITION",
        `Only PENDING_REVIEW providers can be activated. Current status: ${parent.status}.`
      );
    }

    if (parent.version !== input.expectedVersion) {
      throw new ProviderError(
        409,
        "CONCURRENT_MODIFICATION",
        "Provider was modified concurrently by another user. Please refresh and retry."
      );
    }

    // Maker-Checker Invariant
    if (parent.submittedByUserId === actor.userId) {
      throw new ProviderError(
        403,
        "MAKER_CHECKER_VIOLATION",
        "Operations staff cannot activate a provider they submitted as a sales agent."
      );
    }

    // Must have at least 1 individually approved and ACTIVE branch
    const activeBranches = await tx.providerBranch.findMany({
      where: { providerOrganizationId: providerId, status: "ACTIVE" },
      select: { id: true, cluster: true },
    });

    if (activeBranches.length === 0) {
      throw new ProviderError(
        422,
        "ACTIVE_BRANCH_REQUIRED",
        "Provider activation requires at least one individually vetted and approved active branch."
      );
    }

    const updated = await tx.providerOrganization.update({
      where: { id: providerId },
      data: {
        status: "ACTIVE",
        activatedByUserId: actor.userId,
        activatedAt: new Date(),
        rejectionReason: null,
        version: { increment: 1 },
      },
      include: { branches: true },
    });

    const ipFingerprint = clientIp ? createAuditFingerprint(clientIp) : null;
    await logAuditEvent(
      {
        actorUserId: actor.userId,
        eventType: "PROVIDER_ACTIVATED",
        targetEntity: `provider:${updated.id}`,
        ipFingerprint,
        metadata: {
          action: "ACTIVATE_PROVIDER",
          providerId: updated.id,
          cluster: updated.primaryCluster,
          branchCount: activeBranches.length,
          submittedByUserId: parent.submittedByUserId ?? undefined,
        },
      },
      tx
    );

    return updated;
  });
}

/**
 * Operations rejects a provider organization.
 * If remediable: status returns to DRAFT, clearing the way for Sales to edit and re-submit.
 * If non-remediable: status becomes REJECTED (terminal).
 */
export async function rejectProvider(
  actor: AuthorizedStaffContext,
  providerId: string,
  input: RejectProviderInput,
  clientIp?: string
) {
  const prisma = getPrisma();

  return await prisma.$transaction(async (tx) => {
    const [parent] = await tx.$queryRaw<
      Array<{
        id: string;
        status: ProviderStatus;
        version: number;
        submittedByUserId: string | null;
      }>
    >`
      SELECT id, status, version, "submittedByUserId"
      FROM provider_organizations
      WHERE id = ${providerId}::uuid
      FOR UPDATE
    `;

    if (!parent) {
      throw new ProviderError(404, "PROVIDER_NOT_FOUND", "Provider organization not found.");
    }

    if (parent.status !== "PENDING_REVIEW") {
      throw new ProviderError(
        422,
        "INVALID_STATE_TRANSITION",
        `Only PENDING_REVIEW providers can be rejected. Current status: ${parent.status}.`
      );
    }

    if (parent.version !== input.expectedVersion) {
      throw new ProviderError(
        409,
        "CONCURRENT_MODIFICATION",
        "Provider was modified concurrently by another user. Please refresh and retry."
      );
    }

    if (parent.submittedByUserId === actor.userId) {
      throw new ProviderError(
        403,
        "MAKER_CHECKER_VIOLATION",
        "Operations staff cannot reject a provider they submitted as a sales agent."
      );
    }

    const nextStatus: ProviderStatus = input.remediable ? "DRAFT" : "REJECTED";

    const updated = await tx.providerOrganization.update({
      where: { id: providerId },
      data: {
        status: nextStatus,
        rejectionReason: input.rejectionReason,
        version: { increment: 1 },
      },
      include: { branches: true },
    });

    if (input.remediable) {
      // Invalidate any prior active branch approvals, clear their vetting fields,
      // and return affected branches to editable DRAFT status
      await tx.providerBranch.updateMany({
        where: {
          providerOrganizationId: providerId,
          status: { not: "DECOMMISSIONED" },
        },
        data: {
          status: "DRAFT",
          legalIdentityChecked: false,
          physicalLocationChecked: false,
          contactAndHoursChecked: false,
          evidenceDocumentRef: null,
          vettedByUserId: null,
          vettedAt: null,
          version: { increment: 1 },
        },
      });
    } else {
      // Terminal provider rejection: permanently decommission all non-decommissioned branches
      await tx.providerBranch.updateMany({
        where: {
          providerOrganizationId: providerId,
          status: { not: "DECOMMISSIONED" },
        },
        data: {
          status: "DECOMMISSIONED",
          version: { increment: 1 },
        },
      });
    }

    const ipFingerprint = clientIp ? createAuditFingerprint(clientIp) : null;
    await logAuditEvent(
      {
        actorUserId: actor.userId,
        eventType: "PROVIDER_REJECTED",
        targetEntity: `provider:${updated.id}`,
        ipFingerprint,
        metadata: {
          action: "REJECT_PROVIDER",
          providerId: updated.id,
          returnToDraft: input.remediable,
          reasonCode: input.reasonCode,
        },
      },
      tx
    );

    return updated;
  });
}

/**
 * Operations pauses an active provider organization.
 */
export async function pauseProvider(
  actor: AuthorizedStaffContext,
  providerId: string,
  input: PauseProviderInput,
  clientIp?: string
) {
  const prisma = getPrisma();

  return await prisma.$transaction(async (tx) => {
    const [parent] = await tx.$queryRaw<
      Array<{
        id: string;
        status: ProviderStatus;
        version: number;
      }>
    >`
      SELECT id, status, version
      FROM provider_organizations
      WHERE id = ${providerId}::uuid
      FOR UPDATE
    `;

    if (!parent) {
      throw new ProviderError(404, "PROVIDER_NOT_FOUND", "Provider organization not found.");
    }

    if (parent.status !== "ACTIVE") {
      throw new ProviderError(
        422,
        "INVALID_STATE_TRANSITION",
        `Only ACTIVE providers can be paused. Current status: ${parent.status}.`
      );
    }

    if (parent.version !== input.expectedVersion) {
      throw new ProviderError(
        409,
        "CONCURRENT_MODIFICATION",
        "Provider was modified concurrently by another user. Please refresh and retry."
      );
    }

    const updated = await tx.providerOrganization.update({
      where: { id: providerId },
      data: {
        status: "PAUSED",
        pauseReason: input.pauseReason,
        pausedAt: new Date(),
        version: { increment: 1 },
      },
      include: { branches: true },
    });

    const ipFingerprint = clientIp ? createAuditFingerprint(clientIp) : null;
    await logAuditEvent(
      {
        actorUserId: actor.userId,
        eventType: "PROVIDER_PAUSED",
        targetEntity: `provider:${updated.id}`,
        ipFingerprint,
        metadata: {
          action: "PAUSE_PROVIDER",
          providerId: updated.id,
          reasonCode: input.reasonCode,
        },
      },
      tx
    );

    return updated;
  });
}

/**
 * Operations resumes a paused provider organization.
 */
export async function resumeProvider(
  actor: AuthorizedStaffContext,
  providerId: string,
  input: { expectedVersion: number },
  clientIp?: string
) {
  const prisma = getPrisma();

  return await prisma.$transaction(async (tx) => {
    const [parent] = await tx.$queryRaw<
      Array<{
        id: string;
        status: ProviderStatus;
        version: number;
      }>
    >`
      SELECT id, status, version
      FROM provider_organizations
      WHERE id = ${providerId}::uuid
      FOR UPDATE
    `;

    if (!parent) {
      throw new ProviderError(404, "PROVIDER_NOT_FOUND", "Provider organization not found.");
    }

    if (parent.status !== "PAUSED") {
      throw new ProviderError(
        422,
        "INVALID_STATE_TRANSITION",
        `Only PAUSED providers can be resumed. Current status: ${parent.status}.`
      );
    }

    if (parent.version !== input.expectedVersion) {
      throw new ProviderError(
        409,
        "CONCURRENT_MODIFICATION",
        "Provider was modified concurrently by another user. Please refresh and retry."
      );
    }

    const updated = await tx.providerOrganization.update({
      where: { id: providerId },
      data: {
        status: "ACTIVE",
        pauseReason: null,
        pausedAt: null,
        version: { increment: 1 },
      },
      include: { branches: true },
    });

    const ipFingerprint = clientIp ? createAuditFingerprint(clientIp) : null;
    await logAuditEvent(
      {
        actorUserId: actor.userId,
        eventType: "PROVIDER_RESUMED",
        targetEntity: `provider:${updated.id}`,
        ipFingerprint,
        metadata: {
          action: "RESUME_PROVIDER",
          providerId: updated.id,
        },
      },
      tx
    );

    return updated;
  });
}

/**
 * Operations pauses an active branch.
 * Ownership: Verifies branch.providerOrganizationId === providerId; returns 404 on mismatch.
 */
export async function pauseBranch(
  actor: AuthorizedStaffContext,
  providerId: string,
  branchId: string,
  input: PauseBranchInput,
  clientIp?: string
) {
  const prisma = getPrisma();

  return await prisma.$transaction(async (tx) => {
    // 1. Lock parent
    const [parent] = await tx.$queryRaw<
      Array<{
        id: string;
        status: ProviderStatus;
        version: number;
      }>
    >`
      SELECT id, status, version
      FROM provider_organizations
      WHERE id = ${providerId}::uuid
      FOR UPDATE
    `;

    if (!parent) {
      throw new ProviderError(404, "PROVIDER_NOT_FOUND", "Provider organization not found.");
    }

    // 2. Lock branch and verify parent ownership
    const [branch] = await tx.$queryRaw<
      Array<{
        id: string;
        status: BranchStatus;
        version: number;
      }>
    >`
      SELECT id, status, version
      FROM provider_branches
      WHERE id = ${branchId}::uuid AND "providerOrganizationId" = ${providerId}::uuid
      FOR UPDATE
    `;

    if (!branch) {
      throw new ProviderError(
        404,
        "BRANCH_NOT_FOUND",
        "Branch not found for the specified provider organization."
      );
    }

    if (branch.status !== "ACTIVE") {
      throw new ProviderError(
        422,
        "INVALID_STATE_TRANSITION",
        `Only ACTIVE branches can be paused. Current status: ${branch.status}.`
      );
    }

    if (branch.version !== input.expectedVersion) {
      throw new ProviderError(
        409,
        "CONCURRENT_MODIFICATION",
        "Branch was modified concurrently by another user. Please refresh and retry."
      );
    }

    const updated = await tx.providerBranch.update({
      where: { id: branchId },
      data: {
        status: "PAUSED",
        pauseReason: input.pauseReason,
        version: { increment: 1 },
      },
    });

    const ipFingerprint = clientIp ? createAuditFingerprint(clientIp) : null;
    await logAuditEvent(
      {
        actorUserId: actor.userId,
        eventType: "BRANCH_PAUSED",
        targetEntity: `provider_branch:${updated.id}`,
        ipFingerprint,
        metadata: {
          action: "PAUSE_BRANCH",
          branchId: updated.id,
          reasonCode: input.reasonCode,
        },
      },
      tx
    );

    return updated;
  });
}

/**
 * Operations resumes a paused branch.
 * Ownership: Verifies branch.providerOrganizationId === providerId; returns 404 on mismatch.
 */
export async function resumeBranch(
  actor: AuthorizedStaffContext,
  providerId: string,
  branchId: string,
  input: { expectedVersion: number },
  clientIp?: string
) {
  const prisma = getPrisma();

  return await prisma.$transaction(async (tx) => {
    // 1. Lock parent
    const [parent] = await tx.$queryRaw<
      Array<{
        id: string;
        status: ProviderStatus;
        version: number;
      }>
    >`
      SELECT id, status, version
      FROM provider_organizations
      WHERE id = ${providerId}::uuid
      FOR UPDATE
    `;

    if (!parent) {
      throw new ProviderError(404, "PROVIDER_NOT_FOUND", "Provider organization not found.");
    }

    // 2. Lock branch and verify parent ownership
    const [branch] = await tx.$queryRaw<
      Array<{
        id: string;
        status: BranchStatus;
        version: number;
      }>
    >`
      SELECT id, status, version
      FROM provider_branches
      WHERE id = ${branchId}::uuid AND "providerOrganizationId" = ${providerId}::uuid
      FOR UPDATE
    `;

    if (!branch) {
      throw new ProviderError(
        404,
        "BRANCH_NOT_FOUND",
        "Branch not found for the specified provider organization."
      );
    }

    if (branch.status !== "PAUSED") {
      throw new ProviderError(
        422,
        "INVALID_STATE_TRANSITION",
        `Only PAUSED branches can be resumed. Current status: ${branch.status}.`
      );
    }

    if (branch.version !== input.expectedVersion) {
      throw new ProviderError(
        409,
        "CONCURRENT_MODIFICATION",
        "Branch was modified concurrently by another user. Please refresh and retry."
      );
    }

    const updated = await tx.providerBranch.update({
      where: { id: branchId },
      data: {
        status: "ACTIVE",
        pauseReason: null,
        version: { increment: 1 },
      },
    });

    const ipFingerprint = clientIp ? createAuditFingerprint(clientIp) : null;
    await logAuditEvent(
      {
        actorUserId: actor.userId,
        eventType: "BRANCH_RESUMED",
        targetEntity: `provider_branch:${updated.id}`,
        ipFingerprint,
        metadata: {
          action: "RESUME_BRANCH",
          branchId: updated.id,
        },
      },
      tx
    );

    return updated;
  });
}
