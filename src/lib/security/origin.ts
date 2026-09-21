import { NextRequest } from "next/server";
import { getServerEnv } from "@/lib/env";

export interface OriginValidationResult {
  valid: boolean;
  reason?: string;
  matchedOrigin?: string;
}

/**
 * Validates request Origin and Referer headers against configured trusted origins.
 * State-changing POST/PUT/DELETE requests MUST provide an approved Origin or Referer.
 *
 * Security Guarantee:
 * - Allowlist is built directly from env.AUTH_TRUSTED_ORIGINS (which contains BETTER_AUTH_URL
 *   plus any configured additional origins).
 * - RFC 7807 error details NEVER reflect attacker-controlled Origin/Referer headers.
 */
export function validateRequestOrigin(req: NextRequest): OriginValidationResult {
  const env = getServerEnv();

  // Allowlist sourced from centrally validated AUTH_TRUSTED_ORIGINS
  const allowedOrigins: string[] = [...env.AUTH_TRUSTED_ORIGINS];

  // In non-production profiles only, include local loopback origins
  if (env.APP_RUNTIME_PROFILE !== "production") {
    if (!allowedOrigins.includes("http://localhost:3000")) {
      allowedOrigins.push("http://localhost:3000");
    }
    if (!allowedOrigins.includes("http://127.0.0.1:3000")) {
      allowedOrigins.push("http://127.0.0.1:3000");
    }
  }

  const originHeader = req.headers.get("origin");
  const refererHeader = req.headers.get("referer");

  // 1. Check Origin header first if present
  if (originHeader) {
    try {
      const parsed = new URL(originHeader).origin;
      if (allowedOrigins.includes(parsed)) {
        return { valid: true, matchedOrigin: parsed };
      }
      return { valid: false, reason: "Untrusted request origin" };
    } catch {
      return { valid: false, reason: "Malformed origin header" };
    }
  }

  // 2. Fall back to Referer header if Origin is absent
  if (refererHeader) {
    try {
      const parsed = new URL(refererHeader).origin;
      if (allowedOrigins.includes(parsed)) {
        return { valid: true, matchedOrigin: parsed };
      }
      return { valid: false, reason: "Untrusted request referer" };
    } catch {
      return { valid: false, reason: "Malformed referer header" };
    }
  }

  // 3. Neither header provided on state-changing request -> fail closed
  return { valid: false, reason: "Missing origin and referer headers" };
}
