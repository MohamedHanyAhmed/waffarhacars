import "server-only";
import crypto from "node:crypto";
import { getPrisma } from "@/lib/db";
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
] as const;

export type SecurityAuditEventType = (typeof SECURITY_AUDIT_EVENT_TYPES)[number];

export function isSecurityAuditEventType(type: unknown): type is SecurityAuditEventType {
  return (
    typeof type === "string" && (SECURITY_AUDIT_EVENT_TYPES as readonly string[]).includes(type)
  );
}

/**
 * Domain-separated HMAC-SHA256 fingerprint for client identifiers (e.g. IP addresses).
 * Raw IP addresses and PII are NEVER stored in the database.
 */
export function createAuditFingerprint(rawIdentifier: string): string {
  const hmacKey =
    process.env.STAFF_LOGIN_HMAC_KEY ||
    process.env.BETTER_AUTH_SECRET ||
    "default-audit-fingerprint-key-at-least-32-chars-long";

  return crypto
    .createHmac("sha256", hmacKey)
    .update(`audit-fingerprint:v1\0${rawIdentifier.trim().toLowerCase()}`)
    .digest("hex");
}

const SENSITIVE_KEY_PATTERN =
  /(password|secret|token|cookie|otp|code|auth|bearer|key|credential|authorization|session)/i;
const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const IPV4_PATTERN = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const HOST_OR_URL_PATTERN = /(https?:\/\/|\.localhost|\.invalid|\.com|\.org|\.net)/i;
const SQL_PATTERN = /\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|EXEC|FROM|WHERE)\b/i;
const LONG_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,}$/;
const STACK_TRACE_PATTERN = /\bat\s+.*\(\S+:\d+:\d+\)/;

/**
 * Sanitizes audit metadata strictly removing:
 * - Passwords, OTPs, backup codes, raw tokens, cookies, auth headers
 * - Raw IP addresses, emails, hostnames, SQL statements, and exception text/stack traces.
 */
export function sanitizeAuditMetadata(
  rawMetadata?: Record<string, unknown> | null
): Prisma.InputJsonObject {
  if (!rawMetadata || typeof rawMetadata !== "object") {
    return {};
  }

  const sanitized: Record<string, string | number | boolean | null> = {};

  for (const [key, value] of Object.entries(rawMetadata)) {
    // 1. Strip sensitive keys
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      continue;
    }

    // 2. Only allow primitive values
    if (value === null || typeof value === "boolean" || typeof value === "number") {
      sanitized[key] = value;
      continue;
    }

    if (typeof value === "string") {
      const trimmed = value.trim();

      // Check against forbidden value types
      if (
        EMAIL_PATTERN.test(trimmed) ||
        IPV4_PATTERN.test(trimmed) ||
        HOST_OR_URL_PATTERN.test(trimmed) ||
        SQL_PATTERN.test(trimmed) ||
        LONG_TOKEN_PATTERN.test(trimmed) ||
        STACK_TRACE_PATTERN.test(trimmed)
      ) {
        // Redact or drop
        continue;
      }

      // Truncate to maximum 128 characters
      sanitized[key] = trimmed.slice(0, 128);
    }
  }

  return sanitized as Prisma.InputJsonObject;
}

/**
 * In-memory sliding window cache for anonymous event deduplication.
 * Prevents denial-of-service storage exhaustion from rapid probes.
 */
const anonymousEventCache = new Map<string, number>();
const DEDUPLICATION_WINDOW_MS = 60_000; // 60 seconds
const MAX_CACHE_ENTRIES = 5_000;

function isAnonymousEventDeduplicated(fingerprint: string, eventType: string): boolean {
  const cacheKey = `${fingerprint}:${eventType}`;
  const now = Date.now();
  const lastSeen = anonymousEventCache.get(cacheKey);

  if (lastSeen && now - lastSeen < DEDUPLICATION_WINDOW_MS) {
    return true;
  }

  // Evict stale entries if cache gets too large
  if (anonymousEventCache.size >= MAX_CACHE_ENTRIES) {
    for (const [k, ts] of anonymousEventCache.entries()) {
      if (now - ts >= DEDUPLICATION_WINDOW_MS) {
        anonymousEventCache.delete(k);
      }
    }
  }

  anonymousEventCache.set(cacheKey, now);
  return false;
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
 * Requirements:
 * 1. Strictly allowlisted event types.
 * 2. Minimal, sanitized metadata with zero PII/secrets.
 * 3. Bounded deduplication for anonymous events to protect database storage.
 * 4. When tx is provided, failure throws (rolling back outer transaction, e.g. provisioning).
 * 5. When tx is omitted (standalone denial logging), failure does NOT throw to ensure fail-closed denial.
 */
export async function logAuditEvent(
  params: LogAuditEventParams,
  tx?: Prisma.TransactionClient
): Promise<string | null> {
  const { actorUserId, eventType, targetEntity, ipFingerprint, metadata } = params;

  if (!isSecurityAuditEventType(eventType)) {
    throw new Error(`INVALID_AUDIT_EVENT_TYPE: ${eventType}`);
  }

  // Deduplicate anonymous events (actorUserId is null or absent)
  if (!actorUserId && ipFingerprint) {
    if (isAnonymousEventDeduplicated(ipFingerprint, eventType)) {
      return null;
    }
  }

  const sanitizedMeta = sanitizeAuditMetadata(metadata);

  try {
    const client = tx || getPrisma();

    // Secondary database check for anonymous deduplication if not in a transaction
    if (!tx && !actorUserId && ipFingerprint) {
      const recent = await client.securityAuditEvent.findFirst({
        where: {
          ipFingerprint,
          eventType,
          timestamp: { gte: new Date(Date.now() - DEDUPLICATION_WINDOW_MS) },
        },
        select: { id: true },
      });
      if (recent) {
        return null;
      }
    }

    const record = await client.securityAuditEvent.create({
      data: {
        actorUserId: actorUserId || null,
        eventType,
        targetEntity: targetEntity ? targetEntity.slice(0, 128) : null,
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
