import { describe, it, expect } from "vitest";
import {
  isValidStaffDepartment,
  isCompleteActiveStaffStatus,
  type StaffAuthStatusResponse,
  type StaffDepartment,
} from "@/lib/staff/status-contract";

describe("Staff Status Contract & Runtime Invariant Validation", () => {
  it("validates recognized staff departments and rejects unrecognized strings or nulls", () => {
    expect(isValidStaffDepartment("ADMIN")).toBe(true);
    expect(isValidStaffDepartment("OPERATIONS")).toBe(true);
    expect(isValidStaffDepartment("SALES")).toBe(true);
    expect(isValidStaffDepartment("FINANCE")).toBe(true);

    expect(isValidStaffDepartment("")).toBe(false);
    expect(isValidStaffDepartment("ENGINEERING")).toBe(false);
    expect(isValidStaffDepartment("admin")).toBe(false);
    expect(isValidStaffDepartment(null)).toBe(false);
    expect(isValidStaffDepartment(undefined)).toBe(false);
    expect(isValidStaffDepartment(123)).toBe(false);
  });

  it("accepts a complete active staff status payload", () => {
    const validPayload: StaffAuthStatusResponse = {
      state: "ACTIVE",
      name: "Alice Admin",
      email: "alice@waffarhacars.com",
      department: "ADMIN",
      employeeNumber: "EMP-ADMIN-001",
      mustChangePassword: false,
      twoFactorEnabled: true,
      canAccessStaffApp: true,
      canAccessEnrollment: false,
      canAccessPasswordChange: false,
    };

    expect(isCompleteActiveStaffStatus(validPayload)).toBe(true);
  });

  it("rejects non-ACTIVE lifecycle states even if identity fields are present", () => {
    const pendingPayload: StaffAuthStatusResponse = {
      state: "PASSWORD_CHANGE_REQUIRED",
      name: "Bob Specialist",
      email: "bob@waffarhacars.com",
      department: "OPERATIONS",
      employeeNumber: "EMP-OPS-002",
      mustChangePassword: true,
      twoFactorEnabled: false,
      canAccessStaffApp: false,
      canAccessEnrollment: false,
      canAccessPasswordChange: true,
    };

    expect(isCompleteActiveStaffStatus(pendingPayload)).toBe(false);
  });

  it("rejects payloads with missing or invalid department without falling back to OPERATIONS", () => {
    const missingDept: StaffAuthStatusResponse = {
      state: "ACTIVE",
      name: "Charlie Finance",
      email: "charlie@waffarhacars.com",
      // department omitted
      employeeNumber: "EMP-FIN-003",
      mustChangePassword: false,
      twoFactorEnabled: true,
      canAccessStaffApp: true,
      canAccessEnrollment: false,
      canAccessPasswordChange: false,
    };

    expect(isCompleteActiveStaffStatus(missingDept)).toBe(false);

    const invalidDept = {
      ...missingDept,
      department: "INVALID_DEPT" as unknown as StaffDepartment,
    };

    expect(isCompleteActiveStaffStatus(invalidDept)).toBe(false);
  });

  it("rejects payloads with missing name, email, or employee number", () => {
    const base: StaffAuthStatusResponse = {
      state: "ACTIVE",
      name: "Dave Sales",
      email: "dave@waffarhacars.com",
      department: "SALES",
      employeeNumber: "EMP-SALES-004",
      mustChangePassword: false,
      twoFactorEnabled: true,
      canAccessStaffApp: true,
      canAccessEnrollment: false,
      canAccessPasswordChange: false,
    };

    expect(isCompleteActiveStaffStatus({ ...base, name: "" })).toBe(false);
    expect(isCompleteActiveStaffStatus({ ...base, name: undefined })).toBe(false);
    expect(isCompleteActiveStaffStatus({ ...base, email: "" })).toBe(false);
    expect(isCompleteActiveStaffStatus({ ...base, email: undefined })).toBe(false);
    expect(isCompleteActiveStaffStatus({ ...base, employeeNumber: "" })).toBe(false);
    expect(isCompleteActiveStaffStatus({ ...base, employeeNumber: undefined })).toBe(false);
    expect(isCompleteActiveStaffStatus(null)).toBe(false);
    expect(isCompleteActiveStaffStatus({})).toBe(false);
  });
});
