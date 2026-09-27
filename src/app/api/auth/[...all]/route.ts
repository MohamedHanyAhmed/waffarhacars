import { getAuth } from "@/lib/auth";
import { getServerEnv } from "@/lib/env";
import { sanitizeAuthResponse } from "@/lib/auth-response-sanitizer";
import { getClientIp, hashIpAddress, hashEmailIdentifier, checkRateLimit } from "@/lib/rate-limit";
import type { NextRequest } from "next/server";
import type { StaffLifecycleState } from "@/lib/staff/staff-session";

function getStaffAllowedEndpoints(state: StaffLifecycleState): string[] {
  // Explicit allowlist: staff sessions can only access endpoints matching their lifecycle state.
  // Customer OTP sessions never reach this check because non-staff sessions are exempt.
  const commonEndpoints = ["/api/auth/sign-out", "/api/auth/get-session"];

  switch (state) {
    case "PASSWORD_CHANGE_REQUIRED":
      // Password change goes through /api/v1/staff/auth/change-password, not the catch-all.
      return [...commonEndpoints];
    case "MFA_ENROLLMENT_REQUIRED":
    case "MFA_ENROLLMENT_PENDING":
      return [
        ...commonEndpoints,
        "/api/auth/two-factor/enable",
        "/api/auth/two-factor/verify-totp",
      ];
    case "ACTIVE":
      return [
        ...commonEndpoints,
        "/api/auth/two-factor/verify-totp",
        "/api/auth/two-factor/verify-backup-code",
        "/api/auth/change-password",
      ];
    case "SUSPENDED":
      return [...commonEndpoints];
    default:
      return [...commonEndpoints];
  }
}

export async function handleAuth(req: NextRequest): Promise<Response> {
  let env;
  try {
    env = getServerEnv();
  } catch {
    return Response.json(
      { error: "Configuration error" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }

  // Preserve showcase/demo mode: fail closed with sanitized 503 if running demo backend
  if (env.APP_DATA_BACKEND === "demo") {
    return Response.json(
      { error: "Authentication service unavailable in showcase/demo mode" },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }

  // Block public exposure of Better Auth stock phone endpoints (Issue #10449 mitigation)
  let normalizedPath = "";
  try {
    const url = new URL(req.url, "http://localhost");
    normalizedPath = url.pathname.replace(/\/+/g, "/").toLowerCase();
  } catch {
    normalizedPath = "";
  }

  const isBlockedPhoneEndpoint =
    normalizedPath === "/api/auth/phone-number" ||
    normalizedPath.startsWith("/api/auth/phone-number/") ||
    normalizedPath === "/api/auth/sign-in/phone-number" ||
    normalizedPath.startsWith("/api/auth/sign-in/phone-number/") ||
    normalizedPath.includes("/phone-number");

  if (isBlockedPhoneEndpoint) {
    return Response.json(
      {
        type: "https://waffarhacars.com/errors/not-found",
        title: "Not Found",
        status: 404,
        detail: "Endpoint not found",
      },
      {
        status: 404,
        headers: {
          "Content-Type": "application/problem+json",
          "Cache-Control": "no-store",
        },
      }
    );
  }

  // Rate-limiting for email sign-in endpoint (staff authentication brute-force defense)
  if (normalizedPath === "/api/auth/sign-in/email" && req.method === "POST") {
    const ip = getClientIp(req);
    const ipKey = `rate_limit:staff_login_ip:${hashIpAddress(ip)}`;
    let ipLimit;
    try {
      ipLimit = await checkRateLimit(ipKey, 20, 900);
    } catch {
      return Response.json(
        { error: "SERVICE_UNAVAILABLE", message: "Authentication service temporarily unavailable" },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }

    if (!ipLimit.allowed) {
      return Response.json(
        { error: "TOO_MANY_REQUESTS", message: "Too many login attempts. Please try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(ipLimit.retryAfterSeconds),
            "Cache-Control": "no-store",
          },
        }
      );
    }

    try {
      const clone = req.clone();
      const body = await clone.json();
      if (body && typeof body.email === "string" && body.email.trim()) {
        if (!env.STAFF_LOGIN_HMAC_KEY) {
          return Response.json(
            { error: "SERVICE_UNAVAILABLE", message: "Authentication service configuration error" },
            { status: 503, headers: { "Cache-Control": "no-store" } }
          );
        }
        const accountKey = `rate_limit:staff_login_account:${hashEmailIdentifier(body.email, env.STAFF_LOGIN_HMAC_KEY)}`;
        const accountLimit = await checkRateLimit(accountKey, 5, 900);
        if (!accountLimit.allowed) {
          return Response.json(
            {
              error: "TOO_MANY_REQUESTS",
              message: "Too many login attempts. Please try again later.",
            },
            {
              status: 429,
              headers: {
                "Retry-After": String(accountLimit.retryAfterSeconds),
                "Cache-Control": "no-store",
              },
            }
          );
        }
      }
    } catch {
      // If body is unparseable or not JSON, defer to Better Auth request validator
    }
  }

  // Server-side staff session state machine enforcement (P1-3)
  // Endpoints that don't require/use session cookies (sign-in creates session, 2FA uses its own cookie)
  const isSessionExemptEndpoint =
    normalizedPath === "/api/auth/sign-in/email" ||
    normalizedPath === "/api/auth/sign-up/email" ||
    normalizedPath === "/api/auth/callback" ||
    normalizedPath.startsWith("/api/auth/callback/") ||
    normalizedPath === "/api/auth/ok";

  if (!isSessionExemptEndpoint && req.method === "POST") {
    // Check if this is a 2FA verification with a two-factor cookie (no session required)
    const hasTwoFactorCookie = req.headers.get("cookie")?.includes("better-auth.two_factor");

    if (!hasTwoFactorCookie) {
      // Import resolveStaffSession and check session state
      const { resolveStaffSession } = await import("@/lib/staff/staff-session");
      const staffSession = await resolveStaffSession(req.headers);

      if (staffSession.isAuthenticated && staffSession.isStaff) {
        // Staff session state machine enforcement via explicit allowlist
        const staffAllowedEndpoints = getStaffAllowedEndpoints(staffSession.state);

        // Block /two-factor/disable for ALL staff regardless of state
        if (normalizedPath === "/api/auth/two-factor/disable") {
          return Response.json(
            {
              error: "STAFF_SESSION_RESTRICTED",
              message: "Operation not permitted for staff accounts.",
            },
            { status: 403, headers: { "Cache-Control": "no-store" } }
          );
        }

        if (
          !staffAllowedEndpoints.some(
            (ep) => normalizedPath === ep || normalizedPath.startsWith(ep + "/")
          )
        ) {
          return Response.json(
            {
              error: "STAFF_SESSION_RESTRICTED",
              message: "Your account state does not permit this action.",
            },
            { status: 403, headers: { "Cache-Control": "no-store" } }
          );
        }
      }
    }
  }

  // Server-side boundary protection against trusted device requests
  let effectiveReq: NextRequest = req;
  const is2FaVerification =
    normalizedPath === "/api/auth/two-factor/verify-totp" ||
    normalizedPath === "/api/auth/two-factor/verify-backup-code";

  if (is2FaVerification && req.method === "POST") {
    try {
      const clone = req.clone();
      const body = await clone.json();
      if (body && typeof body === "object" && "trustDevice" in body) {
        // Rewrite body to guarantee trustDevice: false before passing to Better Auth handler
        const sanitizedBody = { ...body, trustDevice: false };
        const serialized = JSON.stringify(sanitizedBody);
        const headers = new Headers(req.headers);
        headers.set("content-length", String(Buffer.byteLength(serialized, "utf-8")));
        effectiveReq = new Request(req.url, {
          method: req.method,
          headers,
          body: serialized,
        }) as unknown as NextRequest;
      }
    } catch {
      // Let Better Auth handle invalid JSON bodies
    }
  }

  try {
    const auth = getAuth();
    const res = await auth.handler(effectiveReq);
    const sanitized = await sanitizeAuthResponse(effectiveReq, res);

    const headers = new Headers(sanitized.headers);

    // Defense-in-depth: strip any trust-device cookie from Set-Cookie headers
    const setCookie = headers.get("set-cookie");
    if (setCookie && setCookie.includes("better-auth.trust-device")) {
      headers.delete("set-cookie");
      const cookieEntries = setCookie.split(/,(?=[^;]+=[^;]+)/g);
      for (const entry of cookieEntries) {
        if (!entry.includes("better-auth.trust-device")) {
          headers.append("set-cookie", entry);
        }
      }
    }

    if (!headers.has("Cache-Control")) {
      headers.set("Cache-Control", "no-store");
    }

    return new Response(sanitized.body, {
      status: sanitized.status,
      statusText: sanitized.statusText,
      headers,
    });
  } catch {
    return Response.json(
      { error: "Authentication service error" },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  return handleAuth(req);
}

export async function POST(req: NextRequest): Promise<Response> {
  return handleAuth(req);
}
