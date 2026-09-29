import { describe, it, expect } from "vitest";
import {
  STAFF_PERMISSIONS,
  ROLE_PERMISSIONS_CATALOG,
  isRoleCompatibleWithDepartment,
  isStaffPermission,
  roleHasPermission,
  type StaffPermission,
} from "@/lib/dal/permissions";
import type { StaffRole } from "@/generated/prisma/client";

describe("DAL Role-to-Permission Catalog Unit Tests", () => {
  it("strictly enumerates capabilities with zero wildcard '*' permissions", () => {
    expect(STAFF_PERMISSIONS).not.toContain("*");
    for (const [, perms] of Object.entries(ROLE_PERMISSIONS_CATALOG)) {
      expect(perms.has("*" as StaffPermission)).toBe(false);
      expect(perms.size).toBeGreaterThan(0);
    }
  });

  it("enforces separation of duties for PLATFORM_ADMIN (no offer maker/checker or payout capabilities)", () => {
    const adminPerms = ROLE_PERMISSIONS_CATALOG.PLATFORM_ADMIN;

    // Platform admin has governance and directory
    expect(adminPerms.has("staff:read")).toBe(true);
    expect(adminPerms.has("staff:provision")).toBe(true);
    expect(adminPerms.has("staff:manage_roles")).toBe(true);
    expect(adminPerms.has("audit:read")).toBe(true);

    // Platform admin is strictly prohibited from business transaction maker-checker
    expect(adminPerms.has("offer_draft:create")).toBe(false);
    expect(adminPerms.has("offer_draft:submit")).toBe(false);
    expect(adminPerms.has("offer_draft:approve")).toBe(false);
    expect(adminPerms.has("offer_draft:reject")).toBe(false);
    expect(adminPerms.has("payout:export")).toBe(false);
    expect(adminPerms.has("payout:view")).toBe(false);
  });

  it("enforces maker capabilities for SALES_AGENT and excludes checker/admin capabilities", () => {
    const salesPerms = ROLE_PERMISSIONS_CATALOG.SALES_AGENT;

    expect(salesPerms.has("staff:read")).toBe(true);
    expect(salesPerms.has("offer_draft:create")).toBe(true);
    expect(salesPerms.has("offer_draft:edit")).toBe(true);
    expect(salesPerms.has("offer_draft:submit")).toBe(true);

    // Excluded checker/admin
    expect(salesPerms.has("offer_draft:approve")).toBe(false);
    expect(salesPerms.has("offer_draft:reject")).toBe(false);
    expect(salesPerms.has("staff:provision")).toBe(false);
    expect(salesPerms.has("payout:export")).toBe(false);
  });

  it("enforces checker capabilities for OPS_SUPERVISOR and excludes maker draft creation", () => {
    const opsPerms = ROLE_PERMISSIONS_CATALOG.OPS_SUPERVISOR;

    expect(opsPerms.has("staff:read")).toBe(true);
    expect(opsPerms.has("offer_draft:review")).toBe(true);
    expect(opsPerms.has("offer_draft:approve")).toBe(true);
    expect(opsPerms.has("offer_draft:reject")).toBe(true);

    // Excluded maker draft creation/edit/submission
    expect(opsPerms.has("offer_draft:create")).toBe(false);
    expect(opsPerms.has("offer_draft:submit")).toBe(false);
    expect(opsPerms.has("payout:export")).toBe(false);
  });

  it("enforces settlement capabilities for FINANCE_OFFICER", () => {
    const financePerms = ROLE_PERMISSIONS_CATALOG.FINANCE_OFFICER;

    expect(financePerms.has("staff:read")).toBe(true);
    expect(financePerms.has("payout:view")).toBe(true);
    expect(financePerms.has("payout:export")).toBe(true);
    expect(financePerms.has("ledger:read")).toBe(true);

    // Excluded maker/checker/admin
    expect(financePerms.has("offer_draft:create")).toBe(false);
    expect(financePerms.has("offer_draft:approve")).toBe(false);
    expect(financePerms.has("staff:manage_roles")).toBe(false);
  });

  it("fails closed on unknown permissions and unknown roles", () => {
    expect(isStaffPermission("unknown:permission")).toBe(false);
    expect(isStaffPermission("")).toBe(false);
    expect(isStaffPermission(null)).toBe(false);
    expect(isStaffPermission(undefined)).toBe(false);
    expect(isStaffPermission("admin:*")).toBe(false);

    expect(roleHasPermission("SALES_AGENT", "unknown:action")).toBe(false);
    expect(roleHasPermission("UNKNOWN_ROLE" as StaffRole, "staff:read")).toBe(false);
  });

  it("verifies department-to-role compatibility rules", () => {
    // Ordinary compatible mappings
    expect(isRoleCompatibleWithDepartment("SALES_AGENT", "SALES")).toBe(true);
    expect(isRoleCompatibleWithDepartment("OPS_SUPERVISOR", "OPERATIONS")).toBe(true);
    expect(isRoleCompatibleWithDepartment("FINANCE_OFFICER", "FINANCE")).toBe(true);

    // Incompatible ordinary mappings
    expect(isRoleCompatibleWithDepartment("SALES_AGENT", "OPERATIONS")).toBe(false);
    expect(isRoleCompatibleWithDepartment("OPS_SUPERVISOR", "FINANCE")).toBe(false);
    expect(isRoleCompatibleWithDepartment("FINANCE_OFFICER", "SALES")).toBe(false);

    // PLATFORM_ADMIN is prohibited for ordinary non-bootstrap provisioning
    expect(isRoleCompatibleWithDepartment("PLATFORM_ADMIN", "ADMIN", false)).toBe(false);
    expect(isRoleCompatibleWithDepartment("PLATFORM_ADMIN", "OPERATIONS", false)).toBe(false);
    expect(isRoleCompatibleWithDepartment("PLATFORM_ADMIN", "SALES", false)).toBe(false);

    // PLATFORM_ADMIN is ONLY compatible with ADMIN when isBootstrap is true
    expect(isRoleCompatibleWithDepartment("PLATFORM_ADMIN", "ADMIN", true)).toBe(true);
    expect(isRoleCompatibleWithDepartment("PLATFORM_ADMIN", "SALES", true)).toBe(false);

    // Ordinary staff cannot have ADMIN department
    expect(isRoleCompatibleWithDepartment("SALES_AGENT", "ADMIN", false)).toBe(false);
    expect(isRoleCompatibleWithDepartment("OPS_SUPERVISOR", "ADMIN", false)).toBe(false);
  });
});
