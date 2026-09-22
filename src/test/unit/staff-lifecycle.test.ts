import { describe, it, expect } from "vitest";
import { resolveStaffLifecycleState } from "@/lib/staff/staff-session";

describe("Staff Lifecycle State Machine Unit Tests", () => {
  it("resolves SUSPENDED when isSuspended is true regardless of membership or MFA", () => {
    expect(
      resolveStaffLifecycleState({
        isSuspended: true,
        isActive: true,
        mustChangePassword: false,
        twoFactorEnabled: true,
      })
    ).toBe("SUSPENDED");
  });

  it("resolves SUSPENDED when isActive is false", () => {
    expect(
      resolveStaffLifecycleState({
        isSuspended: false,
        isActive: false,
        mustChangePassword: false,
        twoFactorEnabled: true,
      })
    ).toBe("SUSPENDED");
  });

  it("resolves PASSWORD_CHANGE_REQUIRED when mustChangePassword is true", () => {
    expect(
      resolveStaffLifecycleState({
        isSuspended: false,
        isActive: true,
        mustChangePassword: true,
        twoFactorEnabled: false,
      })
    ).toBe("PASSWORD_CHANGE_REQUIRED");

    // Even if twoFactor is enabled, password change takes precedence
    expect(
      resolveStaffLifecycleState({
        isSuspended: false,
        isActive: true,
        mustChangePassword: true,
        twoFactorEnabled: true,
      })
    ).toBe("PASSWORD_CHANGE_REQUIRED");
  });

  it("resolves MFA_ENROLLMENT_REQUIRED when password changed but MFA not yet initiated", () => {
    expect(
      resolveStaffLifecycleState({
        isSuspended: false,
        isActive: true,
        mustChangePassword: false,
        twoFactorEnabled: false,
        hasTwoFactorSecret: false,
      })
    ).toBe("MFA_ENROLLMENT_REQUIRED");
  });

  it("resolves MFA_ENROLLMENT_PENDING when secret is generated but not verified", () => {
    expect(
      resolveStaffLifecycleState({
        isSuspended: false,
        isActive: true,
        mustChangePassword: false,
        twoFactorEnabled: false,
        hasTwoFactorSecret: true,
        twoFactorVerified: false,
      })
    ).toBe("MFA_ENROLLMENT_PENDING");
  });

  it("resolves ACTIVE only when active, not suspended, password changed, and TOTP verified", () => {
    expect(
      resolveStaffLifecycleState({
        isSuspended: false,
        isActive: true,
        mustChangePassword: false,
        twoFactorEnabled: true,
        twoFactorVerified: true,
      })
    ).toBe("ACTIVE");
  });

  it("handles default fallback values safely", () => {
    // If twoFactorVerified is omitted or false when twoFactorEnabled is true
    expect(
      resolveStaffLifecycleState({
        isSuspended: false,
        isActive: true,
        mustChangePassword: false,
        twoFactorEnabled: true,
        twoFactorVerified: false,
      })
    ).toBe("MFA_ENROLLMENT_PENDING");
  });
});
