import { describe, it, expect } from "vitest";
import { sanitizeAuthResponse } from "@/lib/auth-response-sanitizer";

describe("sanitizeAuthResponse Unit Test Suite", () => {
  it("sanitizes token and session.token on exact /api/auth/sign-in/email endpoint", async () => {
    const rawData = {
      token: "secret-session-token-12345",
      user: { id: "user-uuid", email: "user@example.com" },
      session: {
        id: "session-uuid",
        token: "secret-session-token-12345",
        userId: "user-uuid",
      },
    };
    const bodyStr = JSON.stringify(rawData);
    const headers = new Headers();
    headers.set("Content-Type", "application/json");
    headers.set("Content-Length", String(Buffer.byteLength(bodyStr, "utf-8")));
    headers.append(
      "Set-Cookie",
      "better-auth.session_token=secret-session-token-12345; Path=/; HttpOnly"
    );

    const req = { url: "http://localhost:3000/api/auth/sign-in/email" };
    const upstreamRes = new Response(bodyStr, {
      status: 200,
      headers,
    });

    const sanitizedRes = await sanitizeAuthResponse(req, upstreamRes);
    expect(sanitizedRes.status).toBe(200);

    // Body tokens removed
    const body = await sanitizedRes.json();
    expect(body.token).toBeUndefined();
    expect(body.session.token).toBeUndefined();
    expect(body.user.email).toBe("user@example.com");

    // Stale Content-Length recalculated
    const expectedLength = Buffer.byteLength(JSON.stringify(body), "utf-8");
    expect(sanitizedRes.headers.get("Content-Length")).toBe(String(expectedLength));
    expect(sanitizedRes.headers.get("Content-Length")).not.toBe(headers.get("Content-Length"));

    // Set-Cookie preserved
    const setCookie = sanitizedRes.headers.get("Set-Cookie");
    expect(setCookie).toContain("better-auth.session_token=secret-session-token-12345");
    expect(setCookie).toContain("HttpOnly");
  });

  it("leaves unrelated endpoint like /get-session?next=/sign-in completely untouched without consuming body", async () => {
    const rawData = {
      user: { id: "user-uuid" },
      session: { token: "active-token-keep-intact" },
    };
    const bodyStr = JSON.stringify(rawData);
    const upstreamRes = new Response(bodyStr, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    const req = { url: "http://localhost:3000/api/auth/get-session?next=/sign-in" };
    const sanitizedRes = await sanitizeAuthResponse(req, upstreamRes);

    // Must be the exact same response object (not reconstructed or consumed)
    expect(sanitizedRes).toBe(upstreamRes);
    expect(sanitizedRes.bodyUsed).toBe(false);

    // Body still intact
    const body = await sanitizedRes.json();
    expect(body.session.token).toBe("active-token-keep-intact");
  });

  it("leaves JSON error response (e.g. 401 / 403) untouched without consuming body", async () => {
    const errorData = {
      error: "INVALID_CREDENTIALS",
      message: "Invalid email or password",
    };
    const upstreamRes = new Response(JSON.stringify(errorData), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });

    const req = { url: "http://localhost:3000/api/auth/sign-in/email" };
    const sanitizedRes = await sanitizeAuthResponse(req, upstreamRes);

    expect(sanitizedRes).toBe(upstreamRes);
    expect(sanitizedRes.bodyUsed).toBe(false);
  });

  it("leaves non-JSON response untouched without consuming body", async () => {
    const upstreamRes = new Response("OK", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });

    const req = { url: "http://localhost:3000/api/auth/sign-in/email" };
    const sanitizedRes = await sanitizeAuthResponse(req, upstreamRes);

    expect(sanitizedRes).toBe(upstreamRes);
    expect(sanitizedRes.bodyUsed).toBe(false);
  });

  it("preserves multiple Set-Cookie headers on sanitized response", async () => {
    const rawData = { token: "token-1", user: { id: "1" } };
    const upstreamRes = new Response(JSON.stringify(rawData), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
    upstreamRes.headers.append("Set-Cookie", "cookie1=val1; Path=/; HttpOnly");
    upstreamRes.headers.append("Set-Cookie", "cookie2=val2; Path=/; Secure");

    const req = { url: "http://localhost:3000/api/auth/sign-in/email" };
    const sanitizedRes = await sanitizeAuthResponse(req, upstreamRes);

    const getSetCookie = sanitizedRes.headers.getSetCookie?.();
    if (getSetCookie) {
      expect(getSetCookie.length).toBe(2);
      expect(getSetCookie[0]).toContain("cookie1=val1");
      expect(getSetCookie[1]).toContain("cookie2=val2");
    } else {
      const cookieHeader = sanitizedRes.headers.get("Set-Cookie") || "";
      expect(cookieHeader).toContain("cookie1=val1");
      expect(cookieHeader).toContain("cookie2=val2");
    }
  });
});
