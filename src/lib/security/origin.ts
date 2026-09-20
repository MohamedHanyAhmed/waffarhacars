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
 */
export function validateRequestOrigin(req: NextRequest): OriginValidationResult {
  const env = getServerEnv();
  const configuredBaseUrl = env.BETTER_AUTH_URL;

  const allowedOrigins: string[] = [];
  if (configuredBaseUrl) {
    try {
      const baseOrigin = new URL(configuredBaseUrl).origin;
      allowedOrigins.push(baseOrigin);
    } catch {
      return { valid: false, reason: "Server misconfiguration: invalid BETTER_AUTH_URL" };
    }
  } else if (env.APP_RUNTIME_PROFILE === "production") {
    return {
      valid: false,
      reason: "Server misconfiguration: missing BETTER_AUTH_URL in production",
    };
  }

  // Add localhost/127.0.0.1 variants if running in non-production
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
      return { valid: false, reason: `Untrusted origin: ${originHeader}` };
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
      return { valid: false, reason: `Untrusted referer: ${refererHeader}` };
    } catch {
      return { valid: false, reason: "Malformed referer header" };
    }
  }

  // 3. Neither header provided on state-changing request -> fail closed
  return { valid: false, reason: "Missing origin and referer headers" };
}
