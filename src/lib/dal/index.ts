import "server-only";
import { getAuth } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import type { StaffDepartment, StaffRole } from "@/generated/prisma/client";
import { isStaffPermission, roleHasPermission, type StaffPermission } from "./permissions";
import { createAuditFingerprint, logAuditEvent } from "./audit";

export * from "./permissions";
export * from "./audit";

/**
 * Structured Authorization Error conforming to ADR 14 HTTP semantics.
 */
export class AuthorizationError extends Error {
  readonly status: 401 | 403 | 503;
  readonly code: string;

  constructor(status: 401 | 403 | 503, code: string, message: string) {
    super(message);
    this.name = "AuthorizationError";
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

export interface AuthenticatedUserContext {
  id: string;
  email: string;
  name: string;
  isSuspended: boolean;
}

export interface AuthenticatedSessionContext {
  user: AuthenticatedUserContext;
  session: {
    id: string;
    expiresAt: Date;
  };
}

export interface AuthorizedStaffContext {
  userId: string;
  user: {
    id: string;
    email: string;
    name: string;
  };
  membership: {
    id: string;
    employeeNumber: string;
    department: StaffDepartment;
  };
  roleAssignment: {
    id: string;
    role: StaffRole;
  };
  grantedPermission: StaffPermission;
  sessionId: string;
}

function extractRequestHeaders(
  headers: Headers | Record<string, string | string[] | undefined>
): Headers {
  if (headers instanceof Headers) {
    return headers;
  }
  const standardHeaders = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      standardHeaders.set(key, value);
    } else if (Array.isArray(value) && value.length > 0) {
      standardHeaders.set(key, value[0]);
    }
  }
  return standardHeaders;
}

function getClientIpOrIdentifier(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "127.0.0.1"
  );
}

/**
 * Asserts valid authenticated session and unsuspended user account.
 * Throws:
 * - 401 UNAUTHENTICATED: when session is absent or invalid
 * - 403 USER_SUSPENDED: when user is suspended
 * - 503 SERVICE_UNAVAILABLE: when session resolution or storage fails
 */
export async function assertAuthenticated(
  headers: Headers | Record<string, string | string[] | undefined>
): Promise<AuthenticatedSessionContext> {
  const reqHeaders = extractRequestHeaders(headers);

  let sessionData: Awaited<ReturnType<ReturnType<typeof getAuth>["api"]["getSession"]>>;
  try {
    const auth = getAuth();
    sessionData = await auth.api.getSession({ headers: reqHeaders });
  } catch {
    throw new AuthorizationError(
      503,
      "SERVICE_UNAVAILABLE",
      "Authentication service temporarily unavailable"
    );
  }

  if (!sessionData || !sessionData.user) {
    throw new AuthorizationError(401, "UNAUTHENTICATED", "Authentication required");
  }

  let user: { id: string; email: string; name: string; isSuspended: boolean } | null;
  try {
    const prisma = getPrisma();
    user = await prisma.user.findUnique({
      where: { id: sessionData.user.id },
      select: { id: true, email: true, name: true, isSuspended: true },
    });
  } catch {
    throw new AuthorizationError(
      503,
      "SERVICE_UNAVAILABLE",
      "Authentication service temporarily unavailable"
    );
  }

  if (!user) {
    throw new AuthorizationError(401, "UNAUTHENTICATED", "Authentication required");
  }

  if (user.isSuspended) {
    throw new AuthorizationError(403, "USER_SUSPENDED", "User account is suspended");
  }

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      isSuspended: user.isSuspended,
    },
    session: {
      id: sessionData.session.id,
      expiresAt: sessionData.session.expiresAt,
    },
  };
}

/**
 * Central Server-Side DAL Authorization Guard for Internal Staff Operations.
 *
 * Requirements & Invariants:
 * 1. Resolves real database session from Better Auth on every protected request.
 * 2. Requires unsuspended user, active membership (isActive === true), completed password rotation
 *    (mustChangePassword === false), verified TOTP (twoFactorEnabled === true AND twoFactor.verified === true),
 *    and active role assignment (isActive === true) before granting any staff permission.
 * 3. Department is descriptive, NEVER authorization. Role alone resolves permissions.
 * 4. Pilot staff must have exactly one active internal role. Inconsistent state (>1 active roles) or
 *    roleless staff = deny.
 * 5. Unknown permissions or unrecognized roles = deny.
 * 6. Audit logging: Denial events are logged with minimal sanitized metadata and domain fingerprint.
 *    Denial-audit persistence failures must still deny access (fail closed).
 * 7. Structured returns:
 *    - 401 for absent/invalid sessions.
 *    - 403 for authenticated but unauthorized staff.
 *    - 503 when storage or session resolution fails.
 */
export async function assertStaffPermission(
  headers: Headers | Record<string, string | string[] | undefined>,
  permission: unknown
): Promise<AuthorizedStaffContext> {
  const reqHeaders = extractRequestHeaders(headers);
  const rawIdentifier = getClientIpOrIdentifier(reqHeaders);
  const clientFingerprint = createAuditFingerprint(rawIdentifier);

  let sessionData: Awaited<ReturnType<ReturnType<typeof getAuth>["api"]["getSession"]>>;
  try {
    const auth = getAuth();
    sessionData = await auth.api.getSession({ headers: reqHeaders });
  } catch {
    throw new AuthorizationError(
      503,
      "SERVICE_UNAVAILABLE",
      "Authentication service temporarily unavailable"
    );
  }

  // Absent or invalid session
  if (!sessionData || !sessionData.user) {
    await logAuditEvent({
      actorUserId: null,
      eventType: "STAFF_ACCESS_DENIED",
      targetEntity: null,
      ipFingerprint: clientFingerprint,
      metadata: { reason: "UNAUTHENTICATED" },
    });
    throw new AuthorizationError(401, "UNAUTHENTICATED", "Authentication required");
  }

  let user: {
    id: string;
    email: string;
    name: string;
    isSuspended: boolean;
    twoFactorEnabled: boolean | null;
    internalStaffMembership: {
      id: string;
      employeeNumber: string;
      department: StaffDepartment;
      isActive: boolean;
      mustChangePassword: boolean;
      roleAssignments: {
        id: string;
        role: StaffRole;
        isActive: boolean;
      }[];
    } | null;
    twofactors: {
      id: string;
      verified: boolean | null;
    }[];
  } | null;

  try {
    const prisma = getPrisma();
    user = await prisma.user.findUnique({
      where: { id: sessionData.user.id },
      select: {
        id: true,
        email: true,
        name: true,
        isSuspended: true,
        twoFactorEnabled: true,
        internalStaffMembership: {
          select: {
            id: true,
            employeeNumber: true,
            department: true,
            isActive: true,
            mustChangePassword: true,
            roleAssignments: {
              where: { isActive: true },
              select: {
                id: true,
                role: true,
                isActive: true,
              },
            },
          },
        },
        twofactors: {
          take: 1,
          orderBy: { id: "desc" },
          select: {
            id: true,
            verified: true,
          },
        },
      },
    });
  } catch {
    throw new AuthorizationError(
      503,
      "SERVICE_UNAVAILABLE",
      "Authentication service temporarily unavailable"
    );
  }

  // Identity / Staff Membership check
  if (!user || !user.internalStaffMembership) {
    await logAuditEvent({
      actorUserId: sessionData.user.id,
      eventType: "STAFF_ACCESS_DENIED",
      targetEntity: null,
      ipFingerprint: clientFingerprint,
      metadata: { reason: "NOT_STAFF" },
    });
    throw new AuthorizationError(403, "FORBIDDEN", "Not authorized for staff operations");
  }

  const membership = user.internalStaffMembership;

  // Account suspension check
  if (user.isSuspended || !membership.isActive) {
    await logAuditEvent({
      actorUserId: user.id,
      eventType: "STAFF_ACCESS_DENIED",
      targetEntity: `staff_membership:${membership.id}`,
      ipFingerprint: clientFingerprint,
      metadata: { reason: "SUSPENDED" },
    });
    throw new AuthorizationError(403, "FORBIDDEN", "Staff account is suspended or inactive");
  }

  // Password rotation check
  if (membership.mustChangePassword) {
    await logAuditEvent({
      actorUserId: user.id,
      eventType: "STAFF_ACCESS_DENIED",
      targetEntity: `staff_membership:${membership.id}`,
      ipFingerprint: clientFingerprint,
      metadata: { reason: "PASSWORD_CHANGE_REQUIRED" },
    });
    throw new AuthorizationError(403, "FORBIDDEN", "Password change required");
  }

  // Mandatory TOTP enrollment and verification check
  const twoFactor = user.twofactors[0] || null;
  const isTotpVerified = !!user.twoFactorEnabled && twoFactor?.verified === true;

  if (!isTotpVerified) {
    await logAuditEvent({
      actorUserId: user.id,
      eventType: "STAFF_ACCESS_DENIED",
      targetEntity: `staff_membership:${membership.id}`,
      ipFingerprint: clientFingerprint,
      metadata: { reason: "MFA_REQUIRED" },
    });
    throw new AuthorizationError(403, "FORBIDDEN", "Multi-factor authentication required");
  }

  // Active Role Assignment check
  const activeRoles = membership.roleAssignments;

  // Roleless staff have NO permissions
  if (activeRoles.length === 0) {
    await logAuditEvent({
      actorUserId: user.id,
      eventType: "STAFF_ACCESS_DENIED",
      targetEntity: `staff_membership:${membership.id}`,
      ipFingerprint: clientFingerprint,
      metadata: { reason: "NO_ACTIVE_ROLE" },
    });
    throw new AuthorizationError(403, "FORBIDDEN", "No active staff role assigned");
  }

  // Inconsistent state (> 1 active roles) = deny
  if (activeRoles.length > 1) {
    await logAuditEvent({
      actorUserId: user.id,
      eventType: "STAFF_ACCESS_DENIED",
      targetEntity: `staff_membership:${membership.id}`,
      ipFingerprint: clientFingerprint,
      metadata: { reason: "INCONSISTENT_ROLES", roleCount: activeRoles.length },
    });
    throw new AuthorizationError(403, "FORBIDDEN", "Inconsistent role assignment state");
  }

  const activeRoleAssignment = activeRoles[0];

  // Permission validation
  if (!isStaffPermission(permission)) {
    await logAuditEvent({
      actorUserId: user.id,
      eventType: "STAFF_ACCESS_DENIED",
      targetEntity: `staff_membership:${membership.id}`,
      ipFingerprint: clientFingerprint,
      metadata: { reason: "UNKNOWN_PERMISSION" },
    });
    throw new AuthorizationError(403, "FORBIDDEN", "Permission denied");
  }

  if (!roleHasPermission(activeRoleAssignment.role, permission)) {
    await logAuditEvent({
      actorUserId: user.id,
      eventType: "STAFF_ACCESS_DENIED",
      targetEntity: `staff_membership:${membership.id}`,
      ipFingerprint: clientFingerprint,
      metadata: {
        reason: "PERMISSION_DENIED",
        role: activeRoleAssignment.role,
        requiredPermission: permission,
      },
    });
    throw new AuthorizationError(403, "FORBIDDEN", "Permission denied");
  }

  return {
    userId: user.id,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
    },
    membership: {
      id: membership.id,
      employeeNumber: membership.employeeNumber,
      department: membership.department,
    },
    roleAssignment: {
      id: activeRoleAssignment.id,
      role: activeRoleAssignment.role,
    },
    grantedPermission: permission,
    sessionId: sessionData.session.id,
  };
}
