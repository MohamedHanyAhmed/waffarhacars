import { describe, it, expect } from "vitest";
import {
  computeCodeHash,
  computePhoneLookupHash,
  generatePlaceholderEmail,
  generateOtpCode,
} from "@/lib/otp/challenge-service";

describe("OTP Challenge Security & Cryptography Primitives", () => {
  const TEST_PEPPER = "test-pepper-at-least-32-chars-long-with-entropy-123";
  const TEST_ALIAS_KEY = "test-alias-key-at-least-32-chars-long-with-entropy-456";
  const TEST_LOOKUP_KEY = "test-lookup-key-at-least-32-chars-long-with-entropy-789";

  it("generateOtpCode returns a 6-digit decimal string", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateOtpCode();
      expect(code).toMatch(/^\d{6}$/);
      const num = parseInt(code, 10);
      expect(num).toBeGreaterThanOrEqual(100000);
      expect(num).toBeLessThan(1000000);
    }
  });

  it("computeCodeHash produces deterministic HMAC-SHA-256 digests", () => {
    const hash1 = computeCodeHash("123456", TEST_PEPPER);
    const hash2 = computeCodeHash("123456", TEST_PEPPER);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);

    const hashDiffCode = computeCodeHash("123457", TEST_PEPPER);
    expect(hashDiffCode).not.toBe(hash1);
  });

  it("computePhoneLookupHash produces deterministic non-reversible hashes", () => {
    const lookup1 = computePhoneLookupHash("+201012345678", TEST_LOOKUP_KEY);
    const lookup2 = computePhoneLookupHash("+201012345678", TEST_LOOKUP_KEY);
    expect(lookup1).toBe(lookup2);
    expect(lookup1).toMatch(/^[0-9a-f]{64}$/);

    const lookupDiffPhone = computePhoneLookupHash("+201012345679", TEST_LOOKUP_KEY);
    expect(lookupDiffPhone).not.toBe(lookup1);
  });

  it("generatePlaceholderEmail generates deterministic emails with reserved .invalid TLD", () => {
    const email1 = generatePlaceholderEmail("+201012345678", TEST_ALIAS_KEY);
    const email2 = generatePlaceholderEmail("+201012345678", TEST_ALIAS_KEY);
    expect(email1).toBe(email2);
    expect(email1).toMatch(/^phone_[0-9a-f]{32}@phone\.waffarhacars\.invalid$/);

    // Verify domain cannot be resolved / routed (RFC 2606)
    expect(email1.endsWith(".invalid")).toBe(true);
  });
});
