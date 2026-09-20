import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { sanitizeReturnUrl } from "@/lib/security/redirect";
import { validateRequestOrigin } from "@/lib/security/origin";
import { getClientIp } from "@/lib/rate-limit";
import { resetServerEnvCache } from "@/lib/env";

describe("Redirect URL Sanitization (Open Redirect Prevention)", () => {
  it("preserves valid same-origin internal relative paths", () => {
    expect(sanitizeReturnUrl("/results")).toBe("/results");
    expect(sanitizeReturnUrl("/offers/123")).toBe("/offers/123");
    expect(sanitizeReturnUrl("/my-reservations?tab=active&page=2#section")).toBe(
      "/my-reservations?tab=active&page=2#section"
    );
  });

  it("rejects absolute URLs with protocol", () => {
    expect(sanitizeReturnUrl("https://evil.example.com")).toBe("/");
    expect(sanitizeReturnUrl("http://evil.example.com/login")).toBe("/");
    expect(sanitizeReturnUrl("ftp://evil.example.com")).toBe("/");
  });

  it("rejects protocol-relative and backslash URLs", () => {
    expect(sanitizeReturnUrl("//evil.example.com")).toBe("/");
    expect(sanitizeReturnUrl("/\\evil.example.com")).toBe("/");
    expect(sanitizeReturnUrl("///evil.example.com")).toBe("/");
  });

  it("rejects javascript: and data: pseudoprotocols", () => {
    expect(sanitizeReturnUrl("javascript:alert(document.cookie)")).toBe("/");
    expect(sanitizeReturnUrl("javascript://alert(1)")).toBe("/");
    expect(sanitizeReturnUrl("data:text/html,<script>alert(1)</script>")).toBe("/");
  });

  it("rejects encoded and double-encoded protocol-relative and scheme bypass attempts", () => {
    expect(sanitizeReturnUrl("/%2f%2fevil.example.com")).toBe("/");
    expect(sanitizeReturnUrl("/%5c%5cevil.example.com")).toBe("/");
    expect(sanitizeReturnUrl("/%252f%252fevil.example.com")).toBe("/");
    expect(sanitizeReturnUrl("/%2f\\evil.example.com")).toBe("/");
    expect(sanitizeReturnUrl("/javascript%3aalert(1)")).toBe("/");
    expect(sanitizeReturnUrl("/%E0%A4%A")).toBe("/");
  });

  it("rejects control characters, newlines, and NUL bytes", () => {
    expect(sanitizeReturnUrl("/\r\nevil")).toBe("/");
    expect(sanitizeReturnUrl("/test\0path")).toBe("/");
    expect(sanitizeReturnUrl("/path\twith\ttabs")).toBe("/");
  });

  it("handles null, undefined, empty string, and non-strings safely", () => {
    expect(sanitizeReturnUrl(null)).toBe("/");
    expect(sanitizeReturnUrl(undefined)).toBe("/");
    expect(sanitizeReturnUrl("")).toBe("/");
    expect(sanitizeReturnUrl("   ")).toBe("/");
  });

  it("respects custom fallback path", () => {
    expect(sanitizeReturnUrl("https://evil.com", "/custom-fallback")).toBe("/custom-fallback");
  });
});

describe("Centralized Request Origin Validation", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetServerEnvCache();
    process.env.APP_RUNTIME_PROFILE = "showcase";
    process.env.APP_DATA_BACKEND = "demo";
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetServerEnvCache();
  });

  it("accepts request with matching Origin header", () => {
    const req = new NextRequest("http://localhost:3000/api/v1/auth/phone/request", {
      method: "POST",
      headers: { origin: "http://localhost:3000" },
    });
    const result = validateRequestOrigin(req);
    expect(result.valid).toBe(true);
    expect(result.matchedOrigin).toBe("http://localhost:3000");
  });

  it("rejects request with untrusted Origin header", () => {
    const req = new NextRequest("http://localhost:3000/api/v1/auth/phone/request", {
      method: "POST",
      headers: { origin: "https://evil.example.com" },
    });
    const result = validateRequestOrigin(req);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Untrusted origin");
  });

  it("falls back to Referer when Origin is absent and accepts trusted Referer", () => {
    const req = new NextRequest("http://localhost:3000/api/v1/auth/phone/request", {
      method: "POST",
      headers: { referer: "http://localhost:3000/auth/login" },
    });
    const result = validateRequestOrigin(req);
    expect(result.valid).toBe(true);
    expect(result.matchedOrigin).toBe("http://localhost:3000");
  });

  it("rejects request when Referer is untrusted", () => {
    const req = new NextRequest("http://localhost:3000/api/v1/auth/phone/request", {
      method: "POST",
      headers: { referer: "https://evil.example.com/phishing" },
    });
    const result = validateRequestOrigin(req);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Untrusted referer");
  });

  it("fails closed when both Origin and Referer are absent", () => {
    const req = new NextRequest("http://localhost:3000/api/v1/auth/phone/request", {
      method: "POST",
    });
    const result = validateRequestOrigin(req);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Missing origin and referer headers");
  });
});

describe("Client IP Resolution & Trusted Proxy Configuration", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetServerEnvCache();
    process.env.APP_RUNTIME_PROFILE = "showcase";
    process.env.APP_DATA_BACKEND = "demo";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetServerEnvCache();
  });

  it("does not trust X-Forwarded-For when TRUSTED_PROXY_HOPS is 0", () => {
    process.env.TRUSTED_PROXY_HOPS = "0";
    resetServerEnvCache();

    const req = new NextRequest("http://localhost:3000/test", {
      headers: {
        "x-forwarded-for": "198.51.100.1, 203.0.113.195",
        "x-real-ip": "10.0.0.1",
      },
    });

    const ip = getClientIp(req);
    expect(ip).toBe("10.0.0.1");
  });

  it("extracts correct client IP from X-Forwarded-For when TRUSTED_PROXY_HOPS is 1", () => {
    process.env.TRUSTED_PROXY_HOPS = "1";
    resetServerEnvCache();

    const req = new NextRequest("http://localhost:3000/test", {
      headers: {
        "x-forwarded-for": "198.51.100.1, 203.0.113.195",
      },
    });

    const ip = getClientIp(req);
    expect(ip).toBe("203.0.113.195");
  });

  it("extracts 2nd rightmost IP when TRUSTED_PROXY_HOPS is 2", () => {
    process.env.TRUSTED_PROXY_HOPS = "2";
    resetServerEnvCache();

    const req = new NextRequest("http://localhost:3000/test", {
      headers: {
        "x-forwarded-for": "198.51.100.1, 203.0.113.195, 172.16.0.1",
      },
    });

    const ip = getClientIp(req);
    expect(ip).toBe("203.0.113.195");
  });
});
