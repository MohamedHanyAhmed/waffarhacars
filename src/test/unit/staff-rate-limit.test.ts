import { describe, it, expect } from "vitest";
import { hashEmailIdentifier } from "@/lib/rate-limit";

describe("Staff Rate Limit Email Hashing Unit Tests", () => {
  const secretKey = "test-secret-key-123456789012345678901234567890";

  it("produces deterministic HMAC-SHA256 hex digest for identical email", () => {
    const email = "admin@waffarhacars.com";
    const hash1 = hashEmailIdentifier(email, secretKey);
    const hash2 = hashEmailIdentifier(email, secretKey);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{32}$/);
  });

  it("normalizes whitespace and case insensitivity", () => {
    const email1 = "admin@waffarhacars.com";
    const email2 = "  ADMIN@WaffarhaCars.COM  ";
    const email3 = "Admin@waffarhacars.com";

    const hash1 = hashEmailIdentifier(email1, secretKey);
    const hash2 = hashEmailIdentifier(email2, secretKey);
    const hash3 = hashEmailIdentifier(email3, secretKey);

    expect(hash1).toBe(hash2);
    expect(hash2).toBe(hash3);
  });

  it("produces completely different hashes for different secret keys (domain separation)", () => {
    const email = "admin@waffarhacars.com";
    const hashA = hashEmailIdentifier(email, "secret-A");
    const hashB = hashEmailIdentifier(email, "secret-B");

    expect(hashA).not.toBe(hashB);
  });

  it("produces distinct digests for different emails", () => {
    const hash1 = hashEmailIdentifier("staff1@waffarhacars.com", secretKey);
    const hash2 = hashEmailIdentifier("staff2@waffarhacars.com", secretKey);

    expect(hash1).not.toBe(hash2);
  });
});
