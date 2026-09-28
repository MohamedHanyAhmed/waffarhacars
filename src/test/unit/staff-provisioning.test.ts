import { describe, it, expect } from "vitest";
import { ProvisionStaffSchema } from "@/lib/staff/provisioning";

describe("Staff Provisioning Input Schema Validation Unit Tests", () => {
  it("accepts valid staff provisioning payload", () => {
    const valid = {
      email: "engineer@waffarhacars.com",
      fullName: "Tarek Mostafa",
      department: "OPERATIONS",
      employeeNumber: "EMP-100200",
      password: "TemporaryPassword123!",
    };

    const parsed = ProvisionStaffSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.email).toBe("engineer@waffarhacars.com");
      expect(parsed.data.department).toBe("OPERATIONS");
    }
  });

  it("rejects invalid email address", () => {
    const payload = {
      email: "invalid-email",
      fullName: "Nouran Ali",
      department: "FINANCE",
      employeeNumber: "EMP-300400",
      password: "TemporaryPassword123!",
    };

    const parsed = ProvisionStaffSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });

  it("rejects password shorter than 12 characters", () => {
    const payload = {
      email: "staff@waffarhacars.com",
      fullName: "Staff Member",
      department: "OPERATIONS",
      employeeNumber: "EMP-500600",
      password: "ShortPass1!", // 11 chars
    };

    const parsed = ProvisionStaffSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.path.includes("password"))).toBe(true);
    }
  });

  it("rejects invalid department enum value", () => {
    const payload = {
      email: "staff@waffarhacars.com",
      fullName: "Staff Member",
      department: "MARKETING_EXTERNAL",
      employeeNumber: "EMP-500600",
      password: "ValidPassword123456!",
    };

    const parsed = ProvisionStaffSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });

  it("rejects invalid employee number characters", () => {
    const payload = {
      email: "staff@waffarhacars.com",
      fullName: "Staff Member",
      department: "OPERATIONS",
      employeeNumber: "EMP#123$",
      password: "ValidPassword123456!",
    };

    const parsed = ProvisionStaffSchema.safeParse(payload);
    expect(parsed.success).toBe(false);
  });
});
