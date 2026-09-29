import "server-only";
import type { StaffRole, StaffDepartment } from "@/generated/prisma/client";

/**
 * Authoritative enumerated catalog of internal staff permissions.
 *
 * Invariants:
 * 1. Strictly explicit capabilities - NO wildcard "*" permissions exist.
 * 2. Separation of duties: PLATFORM_ADMIN possesses administrative governance
 *    capabilities but is strictly excluded from maker-checker offer approvals and payouts.
 * 3. SALES_AGENT holds maker capabilities (draft creation, submission).
 * 4. OPS_SUPERVISOR holds checker capabilities (review, approval, rejection).
 * 5. FINANCE_OFFICER holds settlement capabilities (payout, ledger).
 */
export const STAFF_PERMISSIONS = [
  // Directory & Self
  "staff:read",

  // Administration & Governance
  "staff:provision",
  "staff:manage_roles",
  "audit:read",

  // Offer lifecycle (Maker)
  "offer_draft:create",
  "offer_draft:edit",
  "offer_draft:submit",

  // Offer lifecycle (Checker)
  "offer_draft:review",
  "offer_draft:approve",
  "offer_draft:reject",

  // Finance & Settlement
  "payout:view",
  "payout:export",
  "ledger:read",
] as const;

export type StaffPermission = (typeof STAFF_PERMISSIONS)[number];

/**
 * Static Role-to-Permission mapping.
 * Pure in-memory catalog guaranteeing O(1) permission resolution without wildcard elevation.
 */
export const ROLE_PERMISSIONS_CATALOG: Record<StaffRole, ReadonlySet<StaffPermission>> = {
  SALES_AGENT: new Set<StaffPermission>([
    "staff:read",
    "offer_draft:create",
    "offer_draft:edit",
    "offer_draft:submit",
  ]),
  OPS_SUPERVISOR: new Set<StaffPermission>([
    "staff:read",
    "offer_draft:review",
    "offer_draft:approve",
    "offer_draft:reject",
  ]),
  FINANCE_OFFICER: new Set<StaffPermission>([
    "staff:read",
    "payout:view",
    "payout:export",
    "ledger:read",
  ]),
  PLATFORM_ADMIN: new Set<StaffPermission>([
    "staff:read",
    "staff:provision",
    "staff:manage_roles",
    "audit:read",
  ]),
};

/**
 * Expected role mapping per department for staff provisioning.
 */
export const DEPARTMENT_ROLE_MAP: Record<StaffDepartment, StaffRole> = {
  SALES: "SALES_AGENT",
  OPERATIONS: "OPS_SUPERVISOR",
  FINANCE: "FINANCE_OFFICER",
  ADMIN: "PLATFORM_ADMIN",
};

/**
 * Verifies compatibility between a role and a department.
 * Invariant: PLATFORM_ADMIN is ONLY compatible with ADMIN department in one-time bootstrap mode.
 */
export function isRoleCompatibleWithDepartment(
  role: StaffRole,
  department: StaffDepartment,
  isBootstrap: boolean = false
): boolean {
  if (role === "PLATFORM_ADMIN") {
    return isBootstrap && department === "ADMIN";
  }
  if (department === "ADMIN") {
    return false; // Ordinary staff cannot have ADMIN department
  }
  return DEPARTMENT_ROLE_MAP[department] === role;
}

/**
 * Type guard for known staff permissions.
 * Fails closed on unknown strings.
 */
export function isStaffPermission(permission: unknown): permission is StaffPermission {
  return (
    typeof permission === "string" && (STAFF_PERMISSIONS as readonly string[]).includes(permission)
  );
}

/**
 * Pure evaluation of role permission membership.
 * Fails closed if role is unrecognized or permission is unknown.
 */
export function roleHasPermission(role: StaffRole, permission: unknown): boolean {
  if (!isStaffPermission(permission)) {
    return false;
  }
  const roleSet = ROLE_PERMISSIONS_CATALOG[role];
  if (!roleSet) {
    return false;
  }
  return roleSet.has(permission);
}
