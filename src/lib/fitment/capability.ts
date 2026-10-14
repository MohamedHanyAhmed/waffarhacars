import "server-only";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
import type { AuthorizedStaffContext } from "@/lib/dal";
import { createAuditFingerprint, logAuditEvent } from "@/lib/dal/audit";
import {
  CoverageListSchema,
  FitmentError,
  fingerprint,
  opaqueRefSchema,
  uuid,
  validateCoverage,
} from "./shared";

const commandId = uuid;
const expectedVersion = z.number().int().positive();
export const CreateCapabilitySchema = z
  .object({
    commandId,
    categoryId: uuid,
    evidenceRef: opaqueRefSchema,
    coverage: CoverageListSchema,
  })
  .strict();
export const CapabilityCommandSchema = z.object({ commandId, expectedVersion }).strict();
export const EditCapabilitySchema = CapabilityCommandSchema.extend({
  evidenceRef: opaqueRefSchema,
  coverage: CoverageListSchema,
});
export const ApproveCapabilitySchema = CapabilityCommandSchema.extend({
  attested: z.literal(true),
});
export const RejectCapabilitySchema = CapabilityCommandSchema.extend({
  reason: z
    .string()
    .trim()
    .min(3)
    .max(1000)
    .refine(
      (value) =>
        !/(?:https?:\/\/|www\.)|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\+?\d[\d\s().-]{8,}\d/i.test(value),
      "Reason must not include a URL, email address, or phone number."
    ),
});

type Action = "CREATE" | "EDIT" | "SUBMIT" | "APPROVE" | "REJECT" | "WITHDRAW";
type CommandInput = z.infer<typeof CapabilityCommandSchema>;
type Receipt = {
  commandId: string;
  actorUserId: string;
  domain: string;
  action: string;
  resourceId: string;
  fingerprint: string;
  outcome: string;
  httpStatus: number;
  errorCode: string | null;
  resultVersion: number | null;
  createdAt: Date;
};

function receiptDto(row: Receipt) {
  return {
    commandId: row.commandId,
    action: row.action,
    policyId: row.resourceId,
    outcome: row.outcome,
    resultVersion: row.resultVersion,
    recordedAt: row.createdAt,
  };
}

async function transaction<T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  try {
    return await getPrisma().$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT set_config('lock_timeout', '3000ms', true)`;
        await tx.$queryRaw`SELECT set_config('statement_timeout', '7000ms', true)`;
        return run(tx);
      },
      { maxWait: 4000, timeout: 8000 }
    );
  } catch (error) {
    if (error instanceof FitmentError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      throw new FitmentError(409, "CONCURRENT_MODIFICATION");
    throw new FitmentError(503, "SERVICE_UNAVAILABLE");
  }
}

async function lockCommand(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('BRANCH_CAPABILITY'), hashtext(${id}))`;
}

async function lockBranch(tx: Prisma.TransactionClient, branchId: string) {
  // Resolve the parent without exposing its identity; then take locks in the
  // provider -> branch order shared with offer/publication mutations.
  const known = await tx.providerBranch.findUnique({
    where: { id: branchId },
    select: { providerOrganizationId: true },
  });
  if (!known) throw new FitmentError(404, "BRANCH_NOT_FOUND");
  const [provider] = await tx.$queryRaw<Array<{ id: string; status: string }>>`
    SELECT id, status FROM provider_organizations
    WHERE id = ${known.providerOrganizationId}::uuid FOR UPDATE`;
  const [branch] = await tx.$queryRaw<
    Array<{ id: string; status: string; providerOrganizationId: string }>
  >`
    SELECT id, status, "providerOrganizationId" FROM provider_branches
    WHERE id = ${branchId}::uuid AND "providerOrganizationId" = ${known.providerOrganizationId}::uuid FOR UPDATE`;
  if (!provider || !branch) throw new FitmentError(404, "BRANCH_NOT_FOUND");
  return { provider, branch };
}

async function lockCategory(tx: Prisma.TransactionClient, categoryId: string) {
  const [category] = await tx.$queryRaw<Array<{ id: string; isActive: boolean }>>`
    SELECT id, "isActive" FROM service_categories WHERE id = ${categoryId}::uuid FOR UPDATE`;
  if (!category) throw new FitmentError(404, "CATEGORY_NOT_FOUND");
  return category;
}

async function lockPolicy(tx: Prisma.TransactionClient, branchId: string, policyId: string) {
  const known = await tx.branchCapabilityVersion.findFirst({
    where: { id: policyId, branchId },
    select: { categoryId: true },
  });
  if (!known) throw new FitmentError(404, "POLICY_NOT_FOUND");
  const category = await lockCategory(tx, known.categoryId);
  const [policy] = await tx.$queryRaw<
    Array<{
      id: string;
      branchId: string;
      categoryId: string;
      status: string;
      version: number;
      createdByUserId: string;
      submittedByUserId: string | null;
    }>
  >`
    SELECT id, "branchId", "categoryId", status, version, "createdByUserId", "submittedByUserId"
    FROM branch_capability_versions
    WHERE id = ${policyId}::uuid AND "branchId" = ${branchId}::uuid FOR UPDATE`;
  if (!policy) throw new FitmentError(404, "POLICY_NOT_FOUND");
  return { policy, category };
}

function replay(
  existing: Receipt,
  actorId: string,
  action: Action,
  expectedHash: string,
  policyId?: string
) {
  if (existing.actorUserId !== actorId || existing.domain !== "CAPABILITY")
    throw new FitmentError(404, "COMMAND_NOT_FOUND");
  if (
    existing.action !== action ||
    existing.fingerprint !== expectedHash ||
    (policyId && existing.resourceId !== policyId)
  )
    throw new FitmentError(409, "COMMAND_REUSE_CONFLICT");
  return { command: receiptDto(existing), replayed: true, httpStatus: existing.httpStatus };
}

async function writeReceipt(
  tx: Prisma.TransactionClient,
  actor: AuthorizedStaffContext,
  input: { commandId: string },
  action: Action,
  policyId: string,
  hash: string,
  version: number,
  httpStatus: number
) {
  const row = await tx.fitmentCommand.create({
    data: {
      commandId: input.commandId,
      actorUserId: actor.userId,
      domain: "CAPABILITY",
      action,
      resourceId: policyId,
      fingerprint: hash,
      outcome: "APPLIED",
      httpStatus,
      resultVersion: version,
    },
  });
  return { command: receiptDto(row), replayed: false, httpStatus };
}

async function audit(
  tx: Prisma.TransactionClient,
  actor: AuthorizedStaffContext,
  action: Action,
  input: { commandId: string },
  branchId: string,
  categoryId: string,
  policyId: string,
  version: number,
  clientIp?: string
) {
  const types = {
    CREATE: "BRANCH_CAPABILITY_DRAFT_CREATED",
    EDIT: "BRANCH_CAPABILITY_DRAFT_UPDATED",
    SUBMIT: "BRANCH_CAPABILITY_SUBMITTED",
    APPROVE: "BRANCH_CAPABILITY_APPROVED",
    REJECT: "BRANCH_CAPABILITY_REJECTED",
    WITHDRAW: "BRANCH_CAPABILITY_WITHDRAWN",
  } as const;
  const actions = {
    CREATE: "CREATE_CAPABILITY",
    EDIT: "EDIT_CAPABILITY",
    SUBMIT: "SUBMIT_CAPABILITY",
    APPROVE: "APPROVE_CAPABILITY",
    REJECT: "REJECT_CAPABILITY",
    WITHDRAW: "WITHDRAW_CAPABILITY",
  } as const;
  await logAuditEvent(
    {
      actorUserId: actor.userId,
      eventType: types[action],
      targetEntity: `branch_capability:${policyId}`,
      ipFingerprint: clientIp ? createAuditFingerprint(clientIp) : null,
      metadata: {
        action: actions[action],
        commandId: input.commandId,
        branchId,
        categoryId,
        policyId,
        version,
      },
    },
    tx
  );
}

export async function createCapability(
  actor: AuthorizedStaffContext,
  branchId: string,
  input: z.infer<typeof CreateCapabilitySchema>,
  clientIp?: string
) {
  if (actor.grantedPermission !== "branch_fitment:create")
    throw new FitmentError(403, "PERMISSION_DENIED");
  const hash = fingerprint("CREATE", actor.userId, branchId, input);
  return transaction(async (tx) => {
    await lockCommand(tx, input.commandId);
    const { provider, branch } = await lockBranch(tx, branchId);
    const existing = await tx.fitmentCommand.findUnique({ where: { commandId: input.commandId } });
    if (existing) return replay(existing, actor.userId, "CREATE", hash);
    if (provider.status !== "ACTIVE" || branch.status !== "ACTIVE")
      throw new FitmentError(409, "BRANCH_NOT_ACTIVE");
    // Catalog locks precede category locks, matching offer fitment writes.
    const coverage = await validateCoverage(tx, input.coverage);
    const category = await lockCategory(tx, input.categoryId);
    if (!category.isActive) throw new FitmentError(409, "CATEGORY_INACTIVE");
    const newest = await tx.branchCapabilityVersion.aggregate({
      where: { branchId, categoryId: input.categoryId },
      _max: { sequenceNumber: true },
    });
    const policy = await tx.branchCapabilityVersion.create({
      data: {
        branchId,
        categoryId: input.categoryId,
        sequenceNumber: (newest._max.sequenceNumber ?? 0) + 1,
        evidenceRef: input.evidenceRef,
        createdByUserId: actor.userId,
        coverage: {
          create: coverage.map((row) => ({
            makeId: row.makeId,
            modelId: row.modelId,
            yearFrom: row.yearFrom,
            yearTo: row.yearTo,
          })),
        },
      },
    });
    const result = await writeReceipt(
      tx,
      actor,
      input,
      "CREATE",
      policy.id,
      hash,
      policy.version,
      201
    );
    await audit(
      tx,
      actor,
      "CREATE",
      input,
      branchId,
      input.categoryId,
      policy.id,
      policy.version,
      clientIp
    );
    return result;
  });
}

export async function capabilityCommand(
  actor: AuthorizedStaffContext,
  branchId: string,
  policyId: string,
  action: Exclude<Action, "CREATE">,
  input:
    | CommandInput
    | z.infer<typeof EditCapabilitySchema>
    | z.infer<typeof ApproveCapabilitySchema>
    | z.infer<typeof RejectCapabilitySchema>,
  clientIp?: string
) {
  const permissionByAction = {
    EDIT: "branch_fitment:edit",
    SUBMIT: "branch_fitment:submit",
    APPROVE: "branch_fitment:approve",
    REJECT: "branch_fitment:reject",
    WITHDRAW: "branch_fitment:withdraw",
  } as const;
  if (actor.grantedPermission !== permissionByAction[action])
    throw new FitmentError(403, "PERMISSION_DENIED");
  if (action === "APPROVE" && (input as z.infer<typeof ApproveCapabilitySchema>).attested !== true)
    throw new FitmentError(422, "CAPABILITY_ATTESTATION_REQUIRED");
  const hash = fingerprint(action, actor.userId, policyId, input);
  return transaction(async (tx) => {
    await lockCommand(tx, input.commandId);
    const { provider, branch } = await lockBranch(tx, branchId);
    const existing = await tx.fitmentCommand.findUnique({ where: { commandId: input.commandId } });
    if (existing) return replay(existing, actor.userId, action, hash, policyId);
    // EDIT alone obtains canonical catalog locks. Do so before category/policy
    // locks, avoiding an inversion with offer draft fitment submission.
    let editedCoverage: Awaited<ReturnType<typeof validateCoverage>> | null = null;
    if (action === "EDIT") {
      const owned = await tx.branchCapabilityVersion.findFirst({
        where: { id: policyId, branchId, createdByUserId: actor.userId },
        select: { id: true },
      });
      if (!owned) throw new FitmentError(404, "POLICY_NOT_FOUND");
      editedCoverage = await validateCoverage(
        tx,
        (input as z.infer<typeof EditCapabilitySchema>).coverage
      );
    }
    const { policy, category } = await lockPolicy(tx, branchId, policyId);
    if (policy.version !== input.expectedVersion)
      throw new FitmentError(409, "CONCURRENT_MODIFICATION");
    if (action === "EDIT") {
      if (policy.status !== "DRAFT") throw new FitmentError(422, "INVALID_STATE_TRANSITION");
      if (policy.createdByUserId !== actor.userId) throw new FitmentError(404, "POLICY_NOT_FOUND");
      const fields = input as z.infer<typeof EditCapabilitySchema>;
      await tx.branchCapabilityCoverage.deleteMany({ where: { versionId: policyId } });
      await tx.branchCapabilityCoverage.createMany({
        data: editedCoverage!.map((row) => ({
          versionId: policyId,
          makeId: row.makeId,
          modelId: row.modelId,
          yearFrom: row.yearFrom,
          yearTo: row.yearTo,
        })),
      });
      await tx.branchCapabilityVersion.update({
        where: { id: policyId },
        data: { evidenceRef: fields.evidenceRef, version: { increment: 1 } },
      });
    } else if (action === "SUBMIT") {
      if (policy.status !== "DRAFT") throw new FitmentError(422, "INVALID_STATE_TRANSITION");
      if (policy.createdByUserId !== actor.userId) throw new FitmentError(404, "POLICY_NOT_FOUND");
      const checked = await tx.branchCapabilityVersion.findUnique({
        where: { id: policyId },
        select: { evidenceRef: true, coverage: { select: { id: true } } },
      });
      if (!checked?.evidenceRef || checked.coverage.length === 0)
        throw new FitmentError(422, "CAPABILITY_EVIDENCE_REQUIRED");
      await tx.branchCapabilityVersion.update({
        where: { id: policyId },
        data: {
          status: "PENDING_REVIEW",
          version: { increment: 1 },
          submittedByUserId: actor.userId,
          submittedAt: new Date(),
        },
      });
    } else if (action === "APPROVE" || action === "REJECT") {
      if (policy.status !== "PENDING_REVIEW")
        throw new FitmentError(422, "INVALID_STATE_TRANSITION");
      if (policy.createdByUserId === actor.userId || policy.submittedByUserId === actor.userId)
        throw new FitmentError(403, "MAKER_CHECKER_CONFLICT");
      if (action === "APPROVE") {
        if (!getServerEnv().OFFER_EVIDENCE_PACKET_REPOSITORY_READY)
          throw new FitmentError(503, "EVIDENCE_REPOSITORY_UNREADY");
        if (provider.status !== "ACTIVE" || branch.status !== "ACTIVE" || !category.isActive)
          throw new FitmentError(409, "CAPABILITY_DEPENDENCY_INACTIVE");
        const checked = await tx.branchCapabilityVersion.findUnique({
          where: { id: policyId },
          select: { evidenceRef: true, coverage: { select: { id: true } } },
        });
        if (!checked?.evidenceRef || checked.coverage.length === 0)
          throw new FitmentError(422, "CAPABILITY_EVIDENCE_REQUIRED");
        const current = await tx.branchCapabilityCurrent.findUnique({
          where: { branchId_categoryId: { branchId, categoryId: policy.categoryId } },
        });
        if (current?.activeVersionId && current.activeVersionId !== policyId) {
          // The branch lock serializes replacement and withdrawal. The partial
          // unique ACTIVE index requires retiring the old version first; both
          // transitions and pointer switch commit together or all roll back.
          const old = await tx.branchCapabilityVersion.findUnique({
            where: { id: current.activeVersionId },
            select: { status: true, version: true },
          });
          if (!old || old.status !== "ACTIVE")
            throw new FitmentError(409, "CAPABILITY_POINTER_CONFLICT");
          await tx.branchCapabilityVersion.update({
            where: { id: current.activeVersionId },
            data: {
              status: "WITHDRAWN",
              version: { increment: 1 },
              withdrawnAt: new Date(),
            },
          });
          await audit(
            tx,
            actor,
            "WITHDRAW",
            input,
            branchId,
            policy.categoryId,
            current.activeVersionId,
            old.version + 1,
            clientIp
          );
        }
        await tx.branchCapabilityVersion.update({
          where: { id: policyId },
          data: {
            status: "ACTIVE",
            version: { increment: 1 },
            attested: true,
            decidedByUserId: actor.userId,
            decidedAt: new Date(),
          },
        });
        if (current) {
          await tx.branchCapabilityCurrent.update({
            where: { branchId_categoryId: { branchId, categoryId: policy.categoryId } },
            data: { activeVersionId: policyId, version: { increment: 1 } },
          });
        } else {
          await tx.branchCapabilityCurrent.create({
            data: { branchId, categoryId: policy.categoryId, activeVersionId: policyId },
          });
        }
      } else {
        await tx.branchCapabilityVersion.update({
          where: { id: policyId },
          data: {
            status: "REJECTED",
            version: { increment: 1 },
            decidedByUserId: actor.userId,
            decidedAt: new Date(),
            rejectionReason: (input as z.infer<typeof RejectCapabilitySchema>).reason,
          },
        });
      }
    } else {
      if (policy.status !== "ACTIVE") throw new FitmentError(422, "INVALID_STATE_TRANSITION");
      const current = await tx.branchCapabilityCurrent.findUnique({
        where: { branchId_categoryId: { branchId, categoryId: policy.categoryId } },
      });
      if (current?.activeVersionId !== policyId)
        throw new FitmentError(409, "CAPABILITY_POINTER_CONFLICT");
      await tx.branchCapabilityVersion.update({
        where: { id: policyId },
        data: {
          status: "WITHDRAWN",
          version: { increment: 1 },
          withdrawnAt: new Date(),
        },
      });
      await tx.branchCapabilityCurrent.update({
        where: { branchId_categoryId: { branchId, categoryId: policy.categoryId } },
        data: { activeVersionId: null, version: { increment: 1 } },
      });
    }
    const version = policy.version + 1;
    const result = await writeReceipt(tx, actor, input, action, policyId, hash, version, 200);
    await audit(tx, actor, action, input, branchId, policy.categoryId, policyId, version, clientIp);
    return result;
  });
}

export async function getCapabilityVersions(actor: AuthorizedStaffContext, branchId: string) {
  if (actor.grantedPermission !== "branch_fitment:read")
    throw new FitmentError(403, "PERMISSION_DENIED");
  const branch = await getPrisma().providerBranch.findUnique({
    where: { id: branchId },
    select: { id: true },
  });
  if (!branch) throw new FitmentError(404, "BRANCH_NOT_FOUND");
  // Sales can inspect only policies they made; Ops review has cross-maker scope.
  // Evidence references are internal review material, never a public DTO.
  const makerScope =
    actor.roleAssignment.role === "OPS_SUPERVISOR" ? {} : { createdByUserId: actor.userId };
  const policies = await getPrisma().branchCapabilityVersion.findMany({
    where: { branchId, ...makerScope },
    orderBy: [{ categoryId: "asc" }, { sequenceNumber: "desc" }],
    select: {
      id: true,
      categoryId: true,
      sequenceNumber: true,
      status: true,
      version: true,
      evidenceRef: true,
      attested: true,
      coverage: { select: { makeId: true, modelId: true, yearFrom: true, yearTo: true } },
    },
  });
  return { policies };
}

export async function getCapabilityCommand(
  actor: AuthorizedStaffContext,
  branchId: string,
  commandIdValue: string
) {
  const row = await getPrisma().fitmentCommand.findUnique({ where: { commandId: commandIdValue } });
  if (!row || row.actorUserId !== actor.userId || row.domain !== "CAPABILITY")
    throw new FitmentError(404, "COMMAND_NOT_FOUND");
  const policy = await getPrisma().branchCapabilityVersion.findUnique({
    where: { id: row.resourceId },
    select: { branchId: true },
  });
  if (!policy || policy.branchId !== branchId) throw new FitmentError(404, "COMMAND_NOT_FOUND");
  return { command: receiptDto(row) };
}
