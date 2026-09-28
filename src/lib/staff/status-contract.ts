/**
 * Shared client-safe contract for staff authentication status.
 * This file is imported by both server route handlers and client components.
 * It MUST remain free of server-only imports, database models, and private secrets.
 */

export type StaffDepartment = "SALES" | "OPERATIONS" | "FINANCE" | "ADMIN";

export type StaffLifecycleState =
  | "PASSWORD_CHANGE_REQUIRED"
  | "MFA_ENROLLMENT_REQUIRED"
  | "MFA_ENROLLMENT_PENDING"
  | "ACTIVE"
  | "SUSPENDED";

export interface StaffAuthStatusResponse {
  state: StaffLifecycleState;
  email?: string;
  name?: string;
  department?: StaffDepartment;
  employeeNumber?: string;
  mustChangePassword?: boolean;
  twoFactorEnabled?: boolean;
  canAccessStaffApp: boolean;
  canAccessEnrollment: boolean;
  canAccessPasswordChange: boolean;
}

export type ActiveStaffStatus = StaffAuthStatusResponse & {
  state: "ACTIVE";
  name: string;
  email: string;
  department: StaffDepartment;
  employeeNumber: string;
};

export const VALID_STAFF_DEPARTMENTS: readonly StaffDepartment[] = [
  "SALES",
  "OPERATIONS",
  "FINANCE",
  "ADMIN",
] as const;

export function isValidStaffDepartment(dept: unknown): dept is StaffDepartment {
  return typeof dept === "string" && (VALID_STAFF_DEPARTMENTS as readonly string[]).includes(dept);
}

export function isCompleteActiveStaffStatus(data: unknown): data is ActiveStaffStatus {
  if (!data || typeof data !== "object") return false;
  const s = data as Partial<StaffAuthStatusResponse>;
  return (
    s.state === "ACTIVE" &&
    typeof s.name === "string" &&
    s.name.trim().length > 0 &&
    typeof s.email === "string" &&
    s.email.trim().length > 0 &&
    isValidStaffDepartment(s.department) &&
    typeof s.employeeNumber === "string" &&
    s.employeeNumber.trim().length > 0
  );
}
