import { describe, it, expect, beforeEach } from "vitest";
import { getAuthOptions, getAuth, resetAuth } from "@/lib/auth";
import { createTestAuth } from "@/test/support/test-auth";
import { GET as authGet, POST as authPost } from "@/app/api/auth/[...all]/route";
import { GET as probeGet } from "@/app/api/auth/probe/route";
import { resetServerEnvCache } from "@/lib/env";
import { NextRequest } from "next/server";

describe("Better Auth Server Configuration and Security Invariants", () => {
  beforeEach(() => {
    process.env.APP_RUNTIME_PROFILE = "showcase";
    process.env.APP_DATA_BACKEND = "postgres";
    process.env.DATABASE_URL =
      "postgresql://test_user:test_password@localhost:5432/waffarhacars_test";
    process.env.BETTER_AUTH_SECRET = "dev-secret-at-least-32-chars-long-with-entropy-12345";
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    resetServerEnvCache();
    resetAuth();
  });

  it("strictly disables public email/password signup in production-mounted options", () => {
    const options = getAuthOptions();
    expect(options.emailAndPassword?.enabled).toBe(true);
    expect(options.emailAndPassword?.disableSignUp).toBe(true);
  });

  it("declares server-owned fields with input: false on User and Session", () => {
    const options = getAuthOptions();

    // User fields
    const userFields = options.user?.additionalFields;
    expect(userFields).toBeDefined();
    expect(userFields?.isSuspended).toMatchObject({
      type: "boolean",
      defaultValue: false,
      input: false,
    });

    // Session fields
    const sessionFields = options.session?.additionalFields;
    expect(sessionFields).toBeDefined();
    expect(sessionFields?.lastActivityAt).toMatchObject({
      type: "date",
      input: false,
      required: true,
    });
    expect(sessionFields?.lastReauthenticatedAt).toMatchObject({
      type: "date",
      input: false,
      required: false,
    });
  });

  it("disables cookie cache on database sessions", () => {
    const options = getAuthOptions();
    expect(options.session?.cookieCache?.enabled).toBe(false);
  });

  it("configures UUID ID generation under advanced.database", () => {
    const options = getAuthOptions();
    expect(options.advanced?.database?.generateId).toBe("uuid");
  });

  it("fails closed when BETTER_AUTH_SECRET is missing with no fallback runtime secret", () => {
    delete process.env.BETTER_AUTH_SECRET;
    resetServerEnvCache();
    resetAuth();
    expect(() => getAuthOptions()).toThrow(
      "Configuration error: BETTER_AUTH_SECRET is required when using postgres backend."
    );
  });

  it("lazily initializes and returns singleton auth instance via getAuth()", () => {
    const auth1 = getAuth();
    const auth2 = getAuth();
    expect(auth1).toBe(auth2);
  });

  it("provides an isolated test auth instance with signup explicitly enabled from test support", () => {
    const testAuth = createTestAuth();
    expect(testAuth.options.emailAndPassword?.disableSignUp).toBe(false);
  });
});

describe("Route Handlers Showcase/Demo Fail-Closed Behavior", () => {
  it("fails closed with HTTP 503 and Cache-Control: no-store on GET /api/auth/[...all] in demo mode", async () => {
    process.env.APP_RUNTIME_PROFILE = "showcase";
    process.env.APP_DATA_BACKEND = "demo";
    resetServerEnvCache();

    const req = new NextRequest("http://localhost:3000/api/auth/session");
    const res = await authGet(req);

    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const json = await res.json();
    expect(json).toEqual({
      error: "Authentication service unavailable in showcase/demo mode",
    });
  });

  it("fails closed with HTTP 503 and Cache-Control: no-store on POST /api/auth/[...all] in demo mode", async () => {
    process.env.APP_RUNTIME_PROFILE = "showcase";
    process.env.APP_DATA_BACKEND = "demo";
    resetServerEnvCache();

    const req = new NextRequest("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@example.com", password: "pass" }),
    });
    const res = await authPost(req);

    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const json = await res.json();
    expect(json).toEqual({
      error: "Authentication service unavailable in showcase/demo mode",
    });
  });

  it("fails closed with HTTP 503 on GET /api/auth/probe in demo mode", async () => {
    process.env.APP_RUNTIME_PROFILE = "showcase";
    process.env.APP_DATA_BACKEND = "demo";
    resetServerEnvCache();

    const req = new NextRequest("http://localhost:3000/api/auth/probe");
    const res = await probeGet(req);

    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const json = await res.json();
    expect(json.title).toBe("Service Unavailable");
    expect(json.status).toBe(503);
  });
});
