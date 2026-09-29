import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isSecurityAuditEventType,
  SECURITY_AUDIT_EVENT_TYPES,
  createAuditFingerprint,
  sanitizeAuditMetadata,
  validateTargetIdentifier,
  logAuditEvent,
} from "@/lib/dal/audit";
import { resetServerEnvCache } from "@/lib/env";

describe("DAL Security Audit Unit Tests", () => {
  beforeEach(() => {
    resetServerEnvCache();
    process.env.APP_RUNTIME_PROFILE = "showcase";
    process.env.APP_DATA_BACKEND = "demo";
    process.env.STAFF_LOGIN_HMAC_KEY = "test-audit-hmac-key-at-least-32-characters-long-12345";
  });

  describe("Event Types Allowlist", () => {
    it("recognizes all allowlisted event types", () => {
      for (const type of SECURITY_AUDIT_EVENT_TYPES) {
        expect(isSecurityAuditEventType(type)).toBe(true);
      }
    });

    it("rejects unauthorized arbitrary event types", () => {
      expect(isSecurityAuditEventType("USER_HACKED")).toBe(false);
      expect(isSecurityAuditEventType("")).toBe(false);
      expect(isSecurityAuditEventType(null)).toBe(false);
      expect(isSecurityAuditEventType(undefined)).toBe(false);
      expect(isSecurityAuditEventType("STAFF_PROVISIONED; DROP TABLE users;")).toBe(false);
    });
  });

  describe("Validated Target Identifiers", () => {
    it("accepts valid domain target identifiers", () => {
      expect(
        validateTargetIdentifier("staff_membership:a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d")
      ).toBe("staff_membership:a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d");
      expect(validateTargetIdentifier("user:b2c3d4e5-f6a1-4b2c-9d3e-4f5a6b7c8d9e")).toBe(
        "user:b2c3d4e5-f6a1-4b2c-9d3e-4f5a6b7c8d9e"
      );
      expect(validateTargetIdentifier("role_assignment:c3d4e5f6-a1b2-4c3d-8e4f-5a6b7c8d9e0f")).toBe(
        "role_assignment:c3d4e5f6-a1b2-4c3d-8e4f-5a6b7c8d9e0f"
      );
      expect(validateTargetIdentifier("permission:offer_draft:create")).toBe(
        "permission:offer_draft:create"
      );
    });

    it("rejects arbitrary strings, malformed UUIDs, URLs, and injection attempts", () => {
      expect(validateTargetIdentifier("malformed-target")).toBeNull();
      expect(validateTargetIdentifier("staff_membership:not-a-uuid")).toBeNull();
      expect(validateTargetIdentifier("https://attacker.com/leak")).toBeNull();
      expect(validateTargetIdentifier("../../etc/passwd")).toBeNull();
      expect(
        validateTargetIdentifier("unknown_prefix:a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d")
      ).toBeNull();
      expect(validateTargetIdentifier("permission:DROP_TABLE")).toBeNull();
      expect(validateTargetIdentifier("")).toBeNull();
      expect(validateTargetIdentifier(null)).toBeNull();
      expect(validateTargetIdentifier(undefined)).toBeNull();
    });
  });

  describe("Domain-Separated Fingerprinting with Validated Configuration", () => {
    it("generates deterministic 64-character hex digests for identifiers", () => {
      const fp1 = createAuditFingerprint("192.168.1.100");
      const fp2 = createAuditFingerprint("192.168.1.100");
      const fp3 = createAuditFingerprint("192.168.1.101");

      expect(fp1).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/.test(fp1)).toBe(true);
      expect(fp1).toBe(fp2);
      expect(fp1).not.toBe(fp3);
    });

    it("ensures raw identifier or IP cannot be extracted from the digest", () => {
      const rawIp = "10.0.0.55";
      const fp = createAuditFingerprint(rawIp);
      expect(fp).not.toContain(rawIp);
      expect(fp).not.toContain("10.0.0");
    });

    it("fails closed when HMAC key is missing from server configuration", () => {
      resetServerEnvCache();
      delete process.env.STAFF_LOGIN_HMAC_KEY;
      delete process.env.BETTER_AUTH_SECRET;

      expect(() => createAuditFingerprint("127.0.0.1")).toThrow("Configuration error");
    });
  });

  describe("Event-Specific Metadata Sanitizer", () => {
    it("preserves allowlisted fields for STAFF_ACCESS_DENIED and strips unexpected/PII keys", () => {
      const raw = {
        reason: "PERMISSION_DENIED",
        role: "SALES_AGENT",
        requiredPermission: "offer_draft:approve",
        password: "super-secret-password-123",
        secret: "my-jwt-secret-here",
        sessionToken: "sess_xyz1234567890",
        cookie: "better-auth.session_token=abcdef",
        clientIp: "192.168.1.1",
        websiteUrl: "https://evil.attacker.com/payload",
        sqlInjection: "SELECT * FROM users WHERE 1=1",
        stackTrace: "Error: failure\n    at Object.test (C:/file.ts:10:5)",
        unexpectedPayload: { foo: "bar" },
      };

      const sanitized = sanitizeAuditMetadata("STAFF_ACCESS_DENIED", raw);

      expect(sanitized).toEqual({
        reason: "PERMISSION_DENIED",
        role: "SALES_AGENT",
        requiredPermission: "offer_draft:approve",
      });
      expect(sanitized).not.toHaveProperty("password");
      expect(sanitized).not.toHaveProperty("secret");
      expect(sanitized).not.toHaveProperty("sessionToken");
      expect(sanitized).not.toHaveProperty("cookie");
      expect(sanitized).not.toHaveProperty("clientIp");
      expect(sanitized).not.toHaveProperty("websiteUrl");
      expect(sanitized).not.toHaveProperty("sqlInjection");
      expect(sanitized).not.toHaveProperty("stackTrace");
      expect(sanitized).not.toHaveProperty("unexpectedPayload");
    });

    it("discards free-form sentence text or non-allowlisted reason values", () => {
      const raw = {
        reason: "An attacker with IP 10.0.0.1 attempted SQL injection with password secret",
      };

      const sanitized = sanitizeAuditMetadata("STAFF_ACCESS_DENIED", raw);
      expect(sanitized).toEqual({});
    });

    it("preserves allowlisted fields for STAFF_PROVISIONED and strips unexpected fields", () => {
      const raw = {
        action: "PROVISION_STAFF",
        department: "SALES",
        role: "SALES_AGENT",
        isBootstrap: false,
        extraToken: "tok_1234567890",
        rawError: "Connection dropped",
      };

      const sanitized = sanitizeAuditMetadata("STAFF_PROVISIONED", raw);

      expect(sanitized).toEqual({
        action: "PROVISION_STAFF",
        department: "SALES",
        role: "SALES_AGENT",
        isBootstrap: false,
      });
      expect(sanitized).not.toHaveProperty("extraToken");
      expect(sanitized).not.toHaveProperty("rawError");
    });

    it("preserves allowlisted fields for BRANCH_ACTIVATED and strictly strips evidenceDocumentRef, PII, and free-text notes", () => {
      const raw = {
        action: "ACTIVATE_BRANCH",
        branchId: "b1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d",
        providerId: "a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d",
        cluster: "NASR_CITY_HELIOPOLIS",
        evidenceDocumentRef: "DOC-EGY-2026-0914-01",
        contactPhone: "+201012345678",
        notes: "Inspection passed by officer John",
      };

      const sanitized = sanitizeAuditMetadata("BRANCH_ACTIVATED", raw);

      expect(sanitized).toEqual({
        action: "ACTIVATE_BRANCH",
        branchId: "b1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d",
        providerId: "a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d",
        cluster: "NASR_CITY_HELIOPOLIS",
      });
      expect(sanitized).not.toHaveProperty("evidenceDocumentRef");
      expect(sanitized).not.toHaveProperty("contactPhone");
      expect(sanitized).not.toHaveProperty("notes");
    });
  });

  describe("Anonymous Storage Exhaustion Prevention", () => {
    it("returns null immediately when actorUserId is absent, never persisting to database", async () => {
      const mockCreate = vi.fn();
      const mockTx = {
        securityAuditEvent: {
          create: mockCreate,
        },
      } as unknown as Parameters<typeof logAuditEvent>[1];

      const result = await logAuditEvent(
        {
          actorUserId: null,
          eventType: "STAFF_ACCESS_DENIED",
          targetEntity: null,
          ipFingerprint: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          metadata: { reason: "UNAUTHENTICATED" },
        },
        mockTx
      );

      expect(result).toBeNull();
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe("Transaction rollback propagation", () => {
    it("throws inside an active interactive transaction so outer work rolls back", async () => {
      const mockTx = {
        securityAuditEvent: {
          create: vi.fn().mockRejectedValue(new Error("Database write failure")),
        },
      } as unknown as Parameters<typeof logAuditEvent>[1];

      await expect(
        logAuditEvent(
          {
            actorUserId: "a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d",
            eventType: "STAFF_PROVISIONED",
            metadata: {
              action: "PROVISION_STAFF",
              department: "SALES",
              role: "SALES_AGENT",
              isBootstrap: false,
            },
          },
          mockTx
        )
      ).rejects.toThrow("Database write failure");
    });
  });
});
