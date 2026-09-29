import "server-only";
import crypto from "node:crypto";
import { z } from "zod";
import { getPrisma } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Strictly allowlisted domain security audit event types.
 */
export const SECURITY_AUDIT_EVENT_TYPES = [
  "STAFF_PROVISIONED",
  "STAFF_ROLE_ASSIGNED",
  "STAFF_LOGIN_SUCCEEDED",
  "STAFF_LOGIN_FAILED",
  "STAFF_ACCESS_DENIED",
  "STAFF_PASSWORD_ROTATED",
  "STAFF_MFA_ENROLLED",
  "STAFF_SESSION_REVOKED",

  // Provider Organization Audit Events
  "PROVIDER_DRAFT_CREATED",
  "PROVIDER_DRAFT_UPDATED",
  "PROVIDER_SUBMITTED_FOR_REVIEW",
  "PROVIDER_ACTIVATED",
  "PROVIDER_REJECTED",
  "PROVIDER_PAUSED",
  "PROVIDER_RESUMED",

  // Provider Branch Audit Events
  "BRANCH_DRAFT_CREATED",
  "BRANCH_DRAFT_UPDATED",
  "BRANCH_ACTIVATED",
  "BRANCH_REJECTED",
  "BRANCH_PAUSED",
  "BRANCH_RESUMED",
] as const;

export type SecurityAuditEventType = (typeof SECURITY_AUDIT_EVENT_TYPES)[number];

export function isSecurityAuditEventType(type: unknown): type is SecurityAuditEventType {
  return (
    typeof type === "string" && (SECURITY_AUDIT_EVENT_TYPES as readonly string[]).includes(type)
  );
}

/**
 * Domain-separated HMAC-SHA256 fingerprint for client identifiers (e.g. IP addresses).
 * Uses validated server configuration. Raw IP addresses and PII are NEVER stored in the database.
 */
export function createAuditFingerprint(rawIdentifier: string): string {
  const env = getServerEnv();
  const hmacKey = env.STAFF_LOGIN_HMAC_KEY || env.BETTER_AUTH_SECRET;
  if (!hmacKey) {
    throw new Error(
      "Configuration error: Validated server key (STAFF_LOGIN_HMAC_KEY or BETTER_AUTH_SECRET) is required for audit fingerprinting."
    );
  }

  return crypto
    .createHmac("sha256", hmacKey)
    .update(`audit-fingerprint:v1\0${rawIdentifier.trim().toLowerCase()}`)
    .digest("hex");
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PERMISSION_REGEX = /^[a-z_]{2,32}:[a-z_]{2,32}$/;

/**
 * Validates target identifiers to ensure only strongly typed, expected domain formats are recorded.
 * Supported target schemas:
 * - staff_membership:<uuid>
 * - user:<uuid>
 * - role_assignment:<uuid>
 * - permission:<domain>:<action>
 *
 * Any malformed, arbitrary, or unexpected string resolves to null.
 */
export function validateTargetIdentifier(target: unknown): string | null {
  if (typeof target !== "string" || !target.trim()) {
    return null;
  }
  const trimmed = target.trim();
  const firstColon = trimmed.indexOf(":");
  if (firstColon <= 0) {
    return null;
  }
  const prefix = trimmed.slice(0, firstColon);
  const identifier = trimmed.slice(firstColon + 1);

  if (prefix === "permission") {
    if (PERMISSION_REGEX.test(identifier)) {
      return `permission:${identifier}`;
    }
    return null;
  }

  if (
    prefix === "staff_membership" ||
    prefix === "user" ||
    prefix === "role_assignment" ||
    prefix === "provider" ||
    prefix === "provider_branch"
  ) {
    if (UUID_REGEX.test(identifier)) {
      return `${prefix}:${identifier.toLowerCase()}`;
    }
    return null;
  }

  return null;
}

// Event-Specific Allowlisted Metadata Schemas
const StaffProvisionedMetadataSchema = z.object({
  action: z.literal("PROVISION_STAFF"),
  department: z.enum(["SALES", "OPERATIONS", "FINANCE", "ADMIN"]),
  role: z.enum(["SALES_AGENT", "OPS_SUPERVISOR", "FINANCE_OFFICER", "PLATFORM_ADMIN"]),
  isBootstrap: z.boolean(),
});

const StaffRoleAssignedMetadataSchema = z.object({
  action: z.literal("ASSIGN_ROLE"),
  role: z.enum(["SALES_AGENT", "OPS_SUPERVISOR", "FINANCE_OFFICER", "PLATFORM_ADMIN"]),
  previousRole: z
    .enum(["SALES_AGENT", "OPS_SUPERVISOR", "FINANCE_OFFICER", "PLATFORM_ADMIN"])
    .optional(),
  assignedBy: z
    .string()
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
});

const StaffAccessDeniedMetadataSchema = z.object({
  reason: z.enum([
    "NOT_STAFF",
    "SUSPENDED",
    "PASSWORD_CHANGE_REQUIRED",
    "MFA_REQUIRED",
    "NO_ACTIVE_ROLE",
    "INCONSISTENT_ROLES",
    "UNKNOWN_PERMISSION",
    "PERMISSION_DENIED",
  ]),
  role: z.enum(["SALES_AGENT", "OPS_SUPERVISOR", "FINANCE_OFFICER", "PLATFORM_ADMIN"]).optional(),
  requiredPermission: z
    .string()
    .regex(/^[a-z_]{2,32}:[a-z_]{2,32}$/)
    .max(64)
    .optional(),
  roleCount: z.number().int().min(0).max(10).optional(),
});

const StaffPasswordRotatedMetadataSchema = z.object({
  action: z.literal("PASSWORD_ROTATED"),
});

const StaffMfaEnrolledMetadataSchema = z.object({
  action: z.literal("MFA_ENROLLED"),
  method: z.literal("totp"),
});

const StaffLoginSucceededMetadataSchema = z.object({
  authMethod: z.enum(["email_password", "totp"]),
});

const StaffLoginFailedMetadataSchema = z.object({
  reason: z.enum(["INVALID_CREDENTIALS", "RATE_LIMITED", "MFA_FAILED"]),
});

const StaffSessionRevokedMetadataSchema = z.object({
  action: z.literal("REVOKE_SESSION"),
  reason: z.enum(["USER_SIGNOUT", "PASSWORD_CHANGED", "ADMIN_ACTION"]),
});

// Provider & Branch Metadata Schemas
const CairoClusterEnum = z.enum(["NASR_CITY_HELIOPOLIS", "NEW_CAIRO", "MAADI", "OCTOBER_ZAYED"]);

const ProviderDraftCreatedMetadataSchema = z.object({
  action: z.literal("CREATE_PROVIDER_DRAFT"),
  providerId: z.string().uuid(),
  cluster: CairoClusterEnum,
});

const ProviderDraftUpdatedMetadataSchema = z.object({
  action: z.literal("UPDATE_PROVIDER_DRAFT"),
  providerId: z.string().uuid(),
  version: z.number().int().positive(),
});

const ProviderSubmittedMetadataSchema = z.object({
  action: z.literal("SUBMIT_PROVIDER"),
  providerId: z.string().uuid(),
  cluster: CairoClusterEnum,
  branchCount: z.number().int().nonnegative(),
  version: z.number().int().positive(),
});

const ProviderActivatedMetadataSchema = z.object({
  action: z.literal("ACTIVATE_PROVIDER"),
  providerId: z.string().uuid(),
  cluster: CairoClusterEnum,
  branchCount: z.number().int().nonnegative(),
  submittedByUserId: z.string().uuid().optional(),
});

export const PROVIDER_REJECTION_REASON_CODES = [
  "INCOMPLETE_DOCUMENTATION",
  "INVALID_TAX_OR_CR",
  "UNVERIFIED_LOCATION",
  "CONTACT_UNREACHABLE",
  "COMPLIANCE_HOLD",
  "DUPLICATE_ENTITY",
  "OTHER",
] as const;
export type ProviderRejectionReasonCode = (typeof PROVIDER_REJECTION_REASON_CODES)[number];

export const PROVIDER_PAUSE_REASON_CODES = [
  "OPERATIONAL_HOLD",
  "COMPLIANCE_REVIEW",
  "MAINTENANCE_OR_RENOVATION",
  "PAYMENT_DISPUTE",
  "LEGAL_DISPUTE",
  "OTHER",
] as const;
export type ProviderPauseReasonCode = (typeof PROVIDER_PAUSE_REASON_CODES)[number];

const ProviderRejectedMetadataSchema = z.object({
  action: z.literal("REJECT_PROVIDER"),
  providerId: z.string().uuid(),
  returnToDraft: z.boolean(),
  reasonCode: z.enum(PROVIDER_REJECTION_REASON_CODES),
});

const ProviderPausedMetadataSchema = z.object({
  action: z.literal("PAUSE_PROVIDER"),
  providerId: z.string().uuid(),
  reasonCode: z.enum(PROVIDER_PAUSE_REASON_CODES),
});

const ProviderResumedMetadataSchema = z.object({
  action: z.literal("RESUME_PROVIDER"),
  providerId: z.string().uuid(),
});

const BranchDraftCreatedMetadataSchema = z.object({
  action: z.literal("CREATE_BRANCH_DRAFT"),
  branchId: z.string().uuid(),
  providerId: z.string().uuid(),
  branchCode: z.string().max(32),
  cluster: CairoClusterEnum,
});

const BranchDraftUpdatedMetadataSchema = z.object({
  action: z.literal("UPDATE_BRANCH_DRAFT"),
  branchId: z.string().uuid(),
  version: z.number().int().positive(),
});

const BranchActivatedMetadataSchema = z.object({
  action: z.literal("ACTIVATE_BRANCH"),
  branchId: z.string().uuid(),
  providerId: z.string().uuid(),
  cluster: CairoClusterEnum,
  evidenceDocumentRef: z.string().max(128),
});

const BranchRejectedMetadataSchema = z.object({
  action: z.literal("REJECT_BRANCH"),
  branchId: z.string().uuid(),
  providerId: z.string().uuid(),
  returnToDraft: z.boolean(),
  reasonCode: z.enum(PROVIDER_REJECTION_REASON_CODES),
});

const BranchPausedMetadataSchema = z.object({
  action: z.literal("PAUSE_BRANCH"),
  branchId: z.string().uuid(),
  reasonCode: z.enum(PROVIDER_PAUSE_REASON_CODES),
});

const BranchResumedMetadataSchema = z.object({
  action: z.literal("RESUME_BRANCH"),
  branchId: z.string().uuid(),
});

export const AUDIT_METADATA_SCHEMAS: Record<SecurityAuditEventType, z.ZodTypeAny> = {
  STAFF_PROVISIONED: StaffProvisionedMetadataSchema,
  STAFF_ROLE_ASSIGNED: StaffRoleAssignedMetadataSchema,
  STAFF_ACCESS_DENIED: StaffAccessDeniedMetadataSchema,
  STAFF_PASSWORD_ROTATED: StaffPasswordRotatedMetadataSchema,
  STAFF_MFA_ENROLLED: StaffMfaEnrolledMetadataSchema,
  STAFF_LOGIN_SUCCEEDED: StaffLoginSucceededMetadataSchema,
  STAFF_LOGIN_FAILED: StaffLoginFailedMetadataSchema,
  STAFF_SESSION_REVOKED: StaffSessionRevokedMetadataSchema,

  // Provider Organization
  PROVIDER_DRAFT_CREATED: ProviderDraftCreatedMetadataSchema,
  PROVIDER_DRAFT_UPDATED: ProviderDraftUpdatedMetadataSchema,
  PROVIDER_SUBMITTED_FOR_REVIEW: ProviderSubmittedMetadataSchema,
  PROVIDER_ACTIVATED: ProviderActivatedMetadataSchema,
  PROVIDER_REJECTED: ProviderRejectedMetadataSchema,
  PROVIDER_PAUSED: ProviderPausedMetadataSchema,
  PROVIDER_RESUMED: ProviderResumedMetadataSchema,

  // Provider Branch
  BRANCH_DRAFT_CREATED: BranchDraftCreatedMetadataSchema,
  BRANCH_DRAFT_UPDATED: BranchDraftUpdatedMetadataSchema,
  BRANCH_ACTIVATED: BranchActivatedMetadataSchema,
  BRANCH_REJECTED: BranchRejectedMetadataSchema,
  BRANCH_PAUSED: BranchPausedMetadataSchema,
  BRANCH_RESUMED: BranchResumedMetadataSchema,
};

/**
 * Sanitizes audit metadata using event-specific allowlists:
 * - Only recognized scalar/enum fields defined for that event type are retained.
 * - Unexpected keys, free-form sentences, credentials, and URLs are stripped.
 * - String values are checked against embedded PII/URL patterns and truncated to 128 chars.
 */
export function sanitizeAuditMetadata(
  eventType: SecurityAuditEventType,
  rawMetadata?: Record<string, unknown> | null
): Prisma.InputJsonObject {
  if (!rawMetadata || typeof rawMetadata !== "object") {
    return {};
  }

  const schema = AUDIT_METADATA_SCHEMAS[eventType];
  if (!schema) {
    return {};
  }

  const parsed = schema.safeParse(rawMetadata);
  if (!parsed.success) {
    return {};
  }

  // Defensive value scrubbing on allowlisted fields
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(parsed.data as Record<string, unknown>)) {
    if (value === null || typeof value === "boolean" || typeof value === "number") {
      result[key] = value;
    } else if (typeof value === "string") {
      const trimmed = value.trim();
      if (
        trimmed.includes("@") ||
        trimmed.includes("://") ||
        /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(trimmed)
      ) {
        continue;
      }
      result[key] = trimmed.slice(0, 128);
    }
  }

  return result as Prisma.InputJsonObject;
}

export interface LogAuditEventParams {
  actorUserId?: string | null;
  eventType: SecurityAuditEventType;
  targetEntity?: string | null;
  ipFingerprint?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Persists an allowlisted security audit event to the append-oriented audit ledger.
 *
 * Requirements & Invariants:
 * 1. Strictly allowlisted event types.
 * 2. Event-specific allowlisted metadata schemas; free-form fields, PII, and credentials are eliminated.
 * 3. Validated target entity identifiers only.
 * 4. MVP Invariant: Unauthenticated requests do NOT persist database audit events, completely
 *    eliminating storage exhaustion vulnerabilities from unauthenticated callers.
 * 5. When tx is provided, persistence failure throws (rolling back outer transaction, e.g. provisioning).
 * 6. When tx is omitted (standalone denial logging), failure does NOT throw to ensure fail-closed denial.
 */
export async function logAuditEvent(
  params: LogAuditEventParams,
  tx?: Prisma.TransactionClient
): Promise<string | null> {
  const { actorUserId, eventType, targetEntity, ipFingerprint, metadata } = params;

  if (!isSecurityAuditEventType(eventType)) {
    throw new Error(`INVALID_AUDIT_EVENT_TYPE: ${eventType}`);
  }

  // MVP Invariant: Do not persist database audit events for unauthenticated/anonymous requests.
  if (!actorUserId) {
    return null;
  }

  const validatedTarget = targetEntity ? validateTargetIdentifier(targetEntity) : null;
  const sanitizedMeta = sanitizeAuditMetadata(eventType, metadata);

  try {
    const client = tx || getPrisma();

    const record = await client.securityAuditEvent.create({
      data: {
        actorUserId,
        eventType,
        targetEntity: validatedTarget,
        ipFingerprint: ipFingerprint || null,
        metadata: sanitizedMeta,
      },
      select: { id: true },
    });

    return record.id;
  } catch (err) {
    if (tx) {
      // In transaction: must throw so outer transaction rolls back (e.g. provisioning)
      throw err;
    }
    // Standalone: log warning to stderr, do not crash caller so authorization denial still proceeds
    console.error("[SecurityAudit] Failed to persist audit event:", eventType);
    return null;
  }
}
