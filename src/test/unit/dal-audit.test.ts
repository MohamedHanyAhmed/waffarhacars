import { describe, it, expect, vi } from "vitest";
import {
  isSecurityAuditEventType,
  SECURITY_AUDIT_EVENT_TYPES,
  createAuditFingerprint,
  sanitizeAuditMetadata,
  logAuditEvent,
} from "@/lib/dal/audit";

describe("DAL Security Audit Unit Tests", () => {
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

  describe("Domain-Separated Fingerprinting", () => {
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
  });

  describe("Metadata Sanitizer", () => {
    it("strips sensitive credential keys (passwords, tokens, cookies, secrets, otps)", () => {
      const raw = {
        action: "TEST_ACTION",
        password: "super-secret-password-123",
        secret: "my-jwt-secret-here",
        sessionToken: "sess_xyz1234567890",
        cookie: "better-auth.session_token=abcdef",
        otpCode: "123456",
        bearerAuth: "Bearer eyJhbGciOi...",
        apiKey: "pk_live_123456",
        safeNumericId: 42,
        safeBool: true,
      };

      const sanitized = sanitizeAuditMetadata(raw);

      expect(sanitized).toEqual({
        action: "TEST_ACTION",
        safeNumericId: 42,
        safeBool: true,
      });
      expect(sanitized).not.toHaveProperty("password");
      expect(sanitized).not.toHaveProperty("secret");
      expect(sanitized).not.toHaveProperty("sessionToken");
      expect(sanitized).not.toHaveProperty("cookie");
      expect(sanitized).not.toHaveProperty("otpCode");
      expect(sanitized).not.toHaveProperty("bearerAuth");
      expect(sanitized).not.toHaveProperty("apiKey");
    });

    it("strips values that contain emails, IP addresses, URLs, SQL queries, or stack traces", () => {
      const raw = {
        validNote: "Normal event note",
        emailPayload: "admin@waffarhacars.com",
        clientIp: "192.168.1.1",
        websiteUrl: "https://evil.attacker.com/payload",
        sqlInjection: "SELECT * FROM users WHERE 1=1",
        stackTrace: "Error: failure\n    at Object.test (C:/file.ts:10:5)",
        longToken: "abcdef1234567890abcdef1234567890abcdef1234567890",
      };

      const sanitized = sanitizeAuditMetadata(raw);

      expect(sanitized).toEqual({
        validNote: "Normal event note",
      });
      expect(sanitized).not.toHaveProperty("emailPayload");
      expect(sanitized).not.toHaveProperty("clientIp");
      expect(sanitized).not.toHaveProperty("websiteUrl");
      expect(sanitized).not.toHaveProperty("sqlInjection");
      expect(sanitized).not.toHaveProperty("stackTrace");
      expect(sanitized).not.toHaveProperty("longToken");
    });

    it("truncates safe string values to 128 characters", () => {
      const longSafeString =
        "This is a safe operational note containing multiple words explaining the action. ".repeat(
          3
        );
      const sanitized = sanitizeAuditMetadata({ note: longSafeString });
      expect(sanitized.note).toBeDefined();
      expect((sanitized.note as string).length).toBe(128);
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
            actorUserId: "user-123",
            eventType: "STAFF_PROVISIONED",
            metadata: { action: "TEST" },
          },
          mockTx
        )
      ).rejects.toThrow("Database write failure");
    });
  });
});
