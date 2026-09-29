import "server-only";
import { getPrisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import type { AuthorizedStaffContext } from "@/lib/dal";
import { logAuditEvent, createAuditFingerprint } from "@/lib/dal/audit";
import {
  ACTIVE_PILOT_CLUSTER,
  type CreateProviderDraftInput,
  type UpdateProviderDraftInput,
  type CreateBranchDraftInput,
  type UpdateBranchDraftInput,
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

function handlePrismaUniqueConstraint(err: unknown, _entity: "provider" | "branch"): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    const target = Array.isArray(err.meta?.target) ? err.meta.target.join(",") : "";
    if (target.includes("taxRegistrationNumber")) {
      throw new ProviderError(
        409,
        "TAX_ID_ALREADY_EXISTS",
        "A provider organization with this Tax Registration Number already exists."
      );
    }
    if (target.includes("commercialRegistrationNumber")) {
      throw new ProviderError(
        409,
        "CR_NUMBER_ALREADY_EXISTS",
        "A provider organization with this Commercial Registration Number already exists."
      );
    }
    if (target.includes("branchCode")) {
      throw new ProviderError(
        409,
        "BRANCH_CODE_ALREADY_EXISTS",
        "A branch with this code already exists for this provider organization."
      );
    }
  }
  throw err;
}

export async function createProviderDraft(
  actor: AuthorizedStaffContext,
  input: CreateProviderDraftInput,
  clientIp?: string
) {
  const prisma = getPrisma();

  try {
    const provider = await prisma.providerOrganization.create({
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
    });

    const ipFingerprint = clientIp ? createAuditFingerprint(clientIp) : null;
    await logAuditEvent({
      actorUserId: actor.userId,
      eventType: "PROVIDER_DRAFT_CREATED",
      targetEntity: `provider:${provider.id}`,
      ipFingerprint,
      metadata: {
        action: "CREATE_PROVIDER_DRAFT",
        providerId: provider.id,
        cluster: provider.primaryCluster,
      },
    });

    return provider;
  } catch (err) {
    handlePrismaUniqueConstraint(err, "provider");
  }
}

export async function updateProviderDraft(
  actor: AuthorizedStaffContext,
  providerId: string,
  input: UpdateProviderDraftInput,
  clientIp?: string
) {
  const prisma = getPrisma();

  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.providerOrganization.findUnique({
        where: { id: providerId },
      });

      if (!existing) {
        throw new ProviderError(404, "PROVIDER_NOT_FOUND", "Provider organization not found.");
      }

      if (existing.status !== "DRAFT") {
        throw new ProviderError(
          422,
          "INVALID_STATE_TRANSITION",
          `Only draft providers can be edited. Current status: ${existing.status}.`
        );
      }

      if (existing.version !== input.expectedVersion) {
        throw new ProviderError(
          409,
          "CONCURRENT_MODIFICATION",
          "Provider was modified by another user. Please refresh and retry."
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
      });

      const ipFingerprint = clientIp ? createAuditFingerprint(clientIp) : null;
      await tx.securityAuditEvent.create({
        data: {
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
      });

      return updated;
    });
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    handlePrismaUniqueConstraint(err, "provider");
  }
}

export async function createBranchDraft(
  actor: AuthorizedStaffContext,
  providerId: string,
  input: CreateBranchDraftInput,
  clientIp?: string
) {
  const prisma = getPrisma();

  try {
    return await prisma.$transaction(async (tx) => {
      const provider = await tx.providerOrganization.findUnique({
        where: { id: providerId },
      });

      if (!provider) {
        throw new ProviderError(404, "PROVIDER_NOT_FOUND", "Provider organization not found.");
      }

      if (provider.status !== "DRAFT") {
        throw new ProviderError(
          422,
          "INVALID_STATE_TRANSITION",
          "Branches can only be added while provider is in DRAFT status."
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
      await tx.securityAuditEvent.create({
        data: {
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
      });

      return branch;
    });
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    handlePrismaUniqueConstraint(err, "branch");
  }
}

export async function updateBranchDraft(
  actor: AuthorizedStaffContext,
  branchId: string,
  input: UpdateBranchDraftInput,
  clientIp?: string
) {
  const prisma = getPrisma();

  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.providerBranch.findUnique({
        where: { id: branchId },
        include: { providerOrganization: true },
      });

      if (!existing) {
        throw new ProviderError(404, "BRANCH_NOT_FOUND", "Provider branch not found.");
      }

      if (existing.status !== "DRAFT" && existing.status !== "ACTIVE") {
        throw new ProviderError(
          422,
          "INVALID_STATE_TRANSITION",
          `Branch in ${existing.status} status cannot be updated.`
        );
      }

      if (existing.version !== input.expectedVersion) {
        throw new ProviderError(
          409,
          "CONCURRENT_MODIFICATION",
          "Branch was modified by another user. Please refresh and retry."
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
      await tx.securityAuditEvent.create({
        data: {
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
      });

      return updated;
    });
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    handlePrismaUniqueConstraint(err, "branch");
  }
}

export async function submitProviderForReview(
  actor: AuthorizedStaffContext,
  providerId: string,
  input: { expectedVersion: number },
  clientIp?: string
) {
  const prisma = getPrisma();

  return await prisma.$transaction(async (tx) => {
    const existing = await tx.providerOrganization.findUnique({
      where: { id: providerId },
      include: { branches: true },
    });

    if (!existing) {
      throw new ProviderError(404, "PROVIDER_NOT_FOUND", "Provider organization not found.");
    }

    if (existing.status !== "DRAFT") {
      throw new ProviderError(
        422,
        "INVALID_STATE_TRANSITION",
        `Only DRAFT providers can be submitted for review. Current status: ${existing.status}.`
      );
    }

    if (existing.version !== input.expectedVersion) {
      throw new ProviderError(
        409,
        "CONCURRENT_MODIFICATION",
        "Provider was modified by another user. Please refresh and retry."
      );
    }

    // Must have at least one branch in the active Cairo pilot cluster
    const pilotBranches = existing.branches.filter(
      (b) => b.cluster === ACTIVE_PILOT_CLUSTER && b.status === "DRAFT"
    );

    if (pilotBranches.length === 0) {
      throw new ProviderError(
        422,
        "PILOT_CLUSTER_BRANCH_REQUIRED",
        `Provider must have at least one branch located in the active pilot cluster (${ACTIVE_PILOT_CLUSTER}) before submission.`
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
    });

    const ipFingerprint = clientIp ? createAuditFingerprint(clientIp) : null;
    await tx.securityAuditEvent.create({
      data: {
        actorUserId: actor.userId,
        eventType: "PROVIDER_SUBMITTED_FOR_REVIEW",
        targetEntity: `provider:${updated.id}`,
        ipFingerprint,
        metadata: {
          action: "SUBMIT_PROVIDER",
          providerId: updated.id,
          cluster: updated.primaryCluster,
          branchCount: pilotBranches.length,
          version: updated.version,
        },
      },
    });

    return updated;
  });
}

export async function activateProvider(
  actor: AuthorizedStaffContext,
  providerId: string,
  input: { expectedVersion: number },
  clientIp?: string
) {
  const prisma = getPrisma();

  return await prisma.$transaction(async (tx) => {
    const existing = await tx.providerOrganization.findUnique({
      where: { id: providerId },
      include: { branches: true },
    });

    if (!existing) {
      throw new ProviderError(404, "PROVIDER_NOT_FOUND", "Provider organization not found.");
    }

    if (existing.status !== "PENDING_REVIEW") {
      throw new ProviderError(
        422,
        "INVALID_STATE_TRANSITION",
        `Only PENDING_REVIEW providers can be activated. Current status: ${existing.status}.`
      );
    }

    if (existing.version !== input.expectedVersion) {
      throw new ProviderError(
        409,
        "CONCURRENT_MODIFICATION",
        "Provider was modified by another user. Please refresh and retry."
      );
    }

    // Maker-Checker Invariant: Operations actor cannot activate a provider they submitted as sales
    if (existing.submittedByUserId === actor.userId) {
      throw new ProviderError(
        403,
        "MAKER_CHECKER_VIOLATION",
        "Operations staff cannot activate a provider they submitted as a sales agent."
      );
    }

    // Must have at least 1 branch in active pilot cluster
    const pilotBranches = existing.branches.filter((b) => b.cluster === ACTIVE_PILOT_CLUSTER);
    if (pilotBranches.length === 0) {
      throw new ProviderError(
        422,
        "PILOT_CLUSTER_BRANCH_REQUIRED",
        `Provider must have at least one branch in the active pilot cluster (${ACTIVE_PILOT_CLUSTER}).`
      );
    }

    const updated = await tx.providerOrganization.update({
      where: { id: providerId },
      data: {
        status: "ACTIVE",
        activatedByUserId: actor.userId,
        activatedAt: new Date(),
        version: { increment: 1 },
      },
    });

    // Automatically activate pilot-cluster draft branches
    await tx.providerBranch.updateMany({
      where: {
        providerOrganizationId: providerId,
        cluster: ACTIVE_PILOT_CLUSTER,
        status: "DRAFT",
      },
      data: {
        status: "ACTIVE",
        version: { increment: 1 },
      },
    });

    const ipFingerprint = clientIp ? createAuditFingerprint(clientIp) : null;
    await tx.securityAuditEvent.create({
      data: {
        actorUserId: actor.userId,
        eventType: "PROVIDER_ACTIVATED",
        targetEntity: `provider:${updated.id}`,
        ipFingerprint,
        metadata: {
          action: "ACTIVATE_PROVIDER",
          providerId: updated.id,
          cluster: updated.primaryCluster,
          branchCount: pilotBranches.length,
          submittedByUserId: existing.submittedByUserId ?? undefined,
        },
      },
    });

    return updated;
  });
}

export async function rejectProvider(
  actor: AuthorizedStaffContext,
  providerId: string,
  input: { expectedVersion: number; returnToDraft: boolean; rejectionReason: string },
  clientIp?: string
) {
  const prisma = getPrisma();

  return await prisma.$transaction(async (tx) => {
    const existing = await tx.providerOrganization.findUnique({
      where: { id: providerId },
    });

    if (!existing) {
      throw new ProviderError(404, "PROVIDER_NOT_FOUND", "Provider organization not found.");
    }

    if (existing.status !== "PENDING_REVIEW") {
      throw new ProviderError(
        422,
        "INVALID_STATE_TRANSITION",
        `Only PENDING_REVIEW providers can be rejected. Current status: ${existing.status}.`
      );
    }

    if (existing.version !== input.expectedVersion) {
      throw new ProviderError(
        409,
        "CONCURRENT_MODIFICATION",
        "Provider was modified by another user. Please refresh and retry."
      );
    }

    const newStatus = input.returnToDraft ? "DRAFT" : "REJECTED";
    const updated = await tx.providerOrganization.update({
      where: { id: providerId },
      data: {
        status: newStatus,
        rejectionReason: input.rejectionReason,
        version: { increment: 1 },
      },
    });

    const ipFingerprint = clientIp ? createAuditFingerprint(clientIp) : null;
    await tx.securityAuditEvent.create({
      data: {
        actorUserId: actor.userId,
        eventType: "PROVIDER_REJECTED",
        targetEntity: `provider:${updated.id}`,
        ipFingerprint,
        metadata: {
          action: "REJECT_PROVIDER",
          providerId: updated.id,
          returnToDraft: input.returnToDraft,
          rejectionReason: input.rejectionReason.slice(0, 128),
        },
      },
    });

    return updated;
  });
}

export async function pauseProvider(
  actor: AuthorizedStaffContext,
  providerId: string,
  input: { expectedVersion: number; pauseReason: string },
  clientIp?: string
) {
  const prisma = getPrisma();

  return await prisma.$transaction(async (tx) => {
    const existing = await tx.providerOrganization.findUnique({
      where: { id: providerId },
    });

    if (!existing) {
      throw new ProviderError(404, "PROVIDER_NOT_FOUND", "Provider organization not found.");
    }

    if (existing.status !== "ACTIVE") {
      throw new ProviderError(
        422,
        "INVALID_STATE_TRANSITION",
        `Only ACTIVE providers can be paused. Current status: ${existing.status}.`
      );
    }

    if (existing.version !== input.expectedVersion) {
      throw new ProviderError(
        409,
        "CONCURRENT_MODIFICATION",
        "Provider was modified by another user. Please refresh and retry."
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
    });

    const ipFingerprint = clientIp ? createAuditFingerprint(clientIp) : null;
    await tx.securityAuditEvent.create({
      data: {
        actorUserId: actor.userId,
        eventType: "PROVIDER_PAUSED",
        targetEntity: `provider:${updated.id}`,
        ipFingerprint,
        metadata: {
          action: "PAUSE_PROVIDER",
          providerId: updated.id,
          pauseReason: input.pauseReason.slice(0, 128),
        },
      },
    });

    return updated;
  });
}

export async function resumeProvider(
  actor: AuthorizedStaffContext,
  providerId: string,
  input: { expectedVersion: number },
  clientIp?: string
) {
  const prisma = getPrisma();

  return await prisma.$transaction(async (tx) => {
    const existing = await tx.providerOrganization.findUnique({
      where: { id: providerId },
    });

    if (!existing) {
      throw new ProviderError(404, "PROVIDER_NOT_FOUND", "Provider organization not found.");
    }

    if (existing.status !== "PAUSED") {
      throw new ProviderError(
        422,
        "INVALID_STATE_TRANSITION",
        `Only PAUSED providers can be resumed. Current status: ${existing.status}.`
      );
    }

    if (existing.version !== input.expectedVersion) {
      throw new ProviderError(
        409,
        "CONCURRENT_MODIFICATION",
        "Provider was modified by another user. Please refresh and retry."
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
    });

    const ipFingerprint = clientIp ? createAuditFingerprint(clientIp) : null;
    await tx.securityAuditEvent.create({
      data: {
        actorUserId: actor.userId,
        eventType: "PROVIDER_RESUMED",
        targetEntity: `provider:${updated.id}`,
        ipFingerprint,
        metadata: {
          action: "RESUME_PROVIDER",
          providerId: updated.id,
        },
      },
    });

    return updated;
  });
}

export async function pauseBranch(
  actor: AuthorizedStaffContext,
  branchId: string,
  input: { expectedVersion: number; pauseReason: string },
  clientIp?: string
) {
  const prisma = getPrisma();

  return await prisma.$transaction(async (tx) => {
    const existing = await tx.providerBranch.findUnique({
      where: { id: branchId },
    });

    if (!existing) {
      throw new ProviderError(404, "BRANCH_NOT_FOUND", "Provider branch not found.");
    }

    if (existing.status !== "ACTIVE") {
      throw new ProviderError(
        422,
        "INVALID_STATE_TRANSITION",
        `Only ACTIVE branches can be paused. Current status: ${existing.status}.`
      );
    }

    if (existing.version !== input.expectedVersion) {
      throw new ProviderError(
        409,
        "CONCURRENT_MODIFICATION",
        "Branch was modified by another user. Please refresh and retry."
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
    await tx.securityAuditEvent.create({
      data: {
        actorUserId: actor.userId,
        eventType: "BRANCH_PAUSED",
        targetEntity: `provider_branch:${updated.id}`,
        ipFingerprint,
        metadata: {
          action: "PAUSE_BRANCH",
          branchId: updated.id,
          pauseReason: input.pauseReason.slice(0, 128),
        },
      },
    });

    return updated;
  });
}

export async function resumeBranch(
  actor: AuthorizedStaffContext,
  branchId: string,
  input: { expectedVersion: number },
  clientIp?: string
) {
  const prisma = getPrisma();

  return await prisma.$transaction(async (tx) => {
    const existing = await tx.providerBranch.findUnique({
      where: { id: branchId },
    });

    if (!existing) {
      throw new ProviderError(404, "BRANCH_NOT_FOUND", "Provider branch not found.");
    }

    if (existing.status !== "PAUSED") {
      throw new ProviderError(
        422,
        "INVALID_STATE_TRANSITION",
        `Only PAUSED branches can be resumed. Current status: ${existing.status}.`
      );
    }

    if (existing.version !== input.expectedVersion) {
      throw new ProviderError(
        409,
        "CONCURRENT_MODIFICATION",
        "Branch was modified by another user. Please refresh and retry."
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
    await tx.securityAuditEvent.create({
      data: {
        actorUserId: actor.userId,
        eventType: "BRANCH_RESUMED",
        targetEntity: `provider_branch:${updated.id}`,
        ipFingerprint,
        metadata: {
          action: "RESUME_BRANCH",
          branchId: updated.id,
        },
      },
    });

    return updated;
  });
}
