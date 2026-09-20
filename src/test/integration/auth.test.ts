import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import pg from "pg";
import crypto from "node:crypto";
import { getPrisma, disconnectDb } from "@/lib/db";
import { getAuth, resetAuth } from "@/lib/auth";
import { createTestAuth } from "@/test/support/test-auth";
import { resetServerEnvCache } from "@/lib/env";
import { GET as probeHandler } from "@/app/api/auth/probe/route";
import { handleAuth } from "@/app/api/auth/[...all]/route";
import { NextRequest } from "next/server";

const DEFAULT_TEST_DB_URL =
  process.env.DATABASE_URL ||
  "postgresql://test_user:test_password@localhost:5432/waffarhacars_test";

const TEST_SECRET = "test-secret-at-least-32-characters-long-12345";
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("Real PostgreSQL 17 Better Auth Database Session Integration Suite", () => {
  let isDbReachable = false;
  const originalEnv = { ...process.env };
  const createdUserEmails: string[] = [];
  let testAuth: ReturnType<typeof createTestAuth>;

  beforeAll(async () => {
    const probe = new pg.Client({
      connectionString: DEFAULT_TEST_DB_URL,
      connectionTimeoutMillis: 3000,
    });
    try {
      await probe.connect();
      const res = await probe.query("SELECT 1 AS probe");
      if (res.rows[0]?.probe === 1) {
        isDbReachable = true;
      }
    } catch {
      isDbReachable = false;
    } finally {
      await probe.end().catch(() => {});
    }
  });

  beforeEach(() => {
    resetServerEnvCache();
    resetAuth();
    process.env = { ...originalEnv };
    process.env.APP_RUNTIME_PROFILE = "showcase";
    process.env.APP_DATA_BACKEND = "postgres";
    process.env.DATABASE_URL = DEFAULT_TEST_DB_URL;
    process.env.DATABASE_DIRECT_URL = DEFAULT_TEST_DB_URL;
    process.env.BETTER_AUTH_SECRET = TEST_SECRET;
    process.env.BETTER_AUTH_URL = "http://localhost:3000";

    testAuth = createTestAuth({
      baseURL: "http://localhost:3000",
      secret: TEST_SECRET,
    });
  });

  afterEach(async () => {
    if (isDbReachable && createdUserEmails.length > 0) {
      try {
        const prisma = getPrisma();
        // Clean database rows strictly in foreign-key order
        const users = await prisma.user.findMany({
          where: { email: { in: createdUserEmails } },
          select: { id: true },
        });
        const userIds = users.map((u) => u.id);
        if (userIds.length > 0) {
          await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
          await prisma.account.deleteMany({ where: { userId: { in: userIds } } });
          await prisma.user.deleteMany({ where: { id: { in: userIds } } });
        }
      } catch (err) {
        console.error("Cleanup error in afterEach:", err);
      }
      createdUserEmails.length = 0;
    }
    await disconnectDb();
    resetAuth();
    resetServerEnvCache();
    process.env = { ...originalEnv };
  });

  afterAll(async () => {
    await disconnectDb();
    resetAuth();
    resetServerEnvCache();
    process.env = originalEnv;
  });

  function generateRandomTestUser() {
    const unique = crypto.randomUUID();
    const email = `user-${unique}@waffarhacars.test`;
    const password = `Pass-${unique}-123!`;
    const name = `Test User ${unique.slice(0, 8)}`;
    createdUserEmails.push(email);
    return { email, password, name };
  }

  it("proves test-only signup creates User and Account records with valid UUIDs and hashed password", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const { email, password, name } = generateRandomTestUser();
    const signUpResult = await testAuth.api.signUpEmail({
      body: { email, password, name },
    });

    expect(signUpResult).toBeDefined();
    expect(signUpResult.user.email).toBe(email);

    // Verify User record in real PostgreSQL
    const prisma = getPrisma();
    const dbUser = await prisma.user.findUnique({ where: { email } });
    expect(dbUser).not.toBeNull();
    expect(UUID_REGEX.test(dbUser!.id)).toBe(true);
    expect(dbUser!.name).toBe(name);
    expect(dbUser!.isSuspended).toBe(false);

    // Verify Account record in real PostgreSQL
    const dbAccount = await prisma.account.findFirst({ where: { userId: dbUser!.id } });
    expect(dbAccount).not.toBeNull();
    expect(UUID_REGEX.test(dbAccount!.id)).toBe(true);
    expect(dbAccount!.providerId).toBe("credential");
    // Password must be hashed with scrypt and never stored in plaintext
    expect(dbAccount!.password).not.toBe(password);
    expect(dbAccount!.password).toMatch(/^[0-9a-f]+:[0-9a-f]+$/i);
  });

  it("proves email sign-in creates exactly one database session with UUID and unique token", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const { email, password, name } = generateRandomTestUser();
    await testAuth.api.signUpEmail({ body: { email, password, name } });

    const prisma = getPrisma();
    const dbUser = await prisma.user.findUnique({ where: { email } });
    expect(dbUser).not.toBeNull();

    const preSignInCount = await prisma.session.count({ where: { userId: dbUser!.id } });

    const signInRes = await testAuth.api.signInEmail({
      body: { email, password },
      asResponse: true,
    });

    expect(signInRes.status).toBe(200);

    const postSignInSessions = await prisma.session.findMany({
      where: { userId: dbUser!.id },
      orderBy: { createdAt: "asc" },
    });
    expect(postSignInSessions.length - preSignInCount).toBe(1);
    const latestSession = postSignInSessions[postSignInSessions.length - 1];

    expect(UUID_REGEX.test(latestSession.id)).toBe(true);
    expect(latestSession.token).toBeDefined();
    expect(latestSession.token.length).toBeGreaterThanOrEqual(20);
    expect(latestSession.lastActivityAt).toBeInstanceOf(Date);
    expect(latestSession.lastReauthenticatedAt).toBeNull();
  });

  it("proves cookie assertions: HttpOnly, SameSite=Lax, Path=/, and Secure flag in production", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const { email, password, name } = generateRandomTestUser();
    await testAuth.api.signUpEmail({ body: { email, password, name } });

    // Non-production sign-in response
    const devSignInRes = await testAuth.api.signInEmail({
      body: { email, password },
      asResponse: true,
    });

    const setCookie = devSignInRes.headers.get("set-cookie") || "";
    expect(setCookie).toContain("better-auth.session_token=");
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("samesite=lax");
    expect(setCookie.toLowerCase()).toContain("path=/");

    // Production auth instance with useSecureCookies enabled
    const prodAuth = createTestAuth({
      baseURL: "https://waffarhacars.com",
      secret: TEST_SECRET,
      advanced: {
        useSecureCookies: true,
      },
    });

    const prodSignInRes = await prodAuth.api.signInEmail({
      body: { email, password },
      asResponse: true,
    });

    const prodSetCookie = prodSignInRes.headers.get("set-cookie") || "";
    expect(prodSetCookie.toLowerCase()).toContain("secure");
  });

  it("proves session retrieval succeeds using cookie and fails immediately upon revocation (cookie cache disabled)", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const { email, password, name } = generateRandomTestUser();
    await testAuth.api.signUpEmail({ body: { email, password, name } });

    const signInRes = await testAuth.api.signInEmail({
      body: { email, password },
      asResponse: true,
    });

    const setCookie = signInRes.headers.get("set-cookie") || "";
    const cookieHeader = setCookie.split(";")[0]; // "better-auth.session_token=..."

    // Session retrieval with valid issued cookie
    const sessionRes = await testAuth.api.getSession({
      headers: new Headers({ cookie: cookieHeader }),
    });

    expect(sessionRes).not.toBeNull();
    expect(sessionRes!.user.email).toBe(email);
    expect(sessionRes!.session.token).toBeDefined();

    // Revoke session via signOut
    await testAuth.api.signOut({
      headers: new Headers({ cookie: cookieHeader }),
    });

    // Verify session row is deleted from PostgreSQL
    const prisma = getPrisma();
    const dbSession = await prisma.session.findUnique({
      where: { token: sessionRes!.session.token },
    });
    expect(dbSession).toBeNull();

    // Immediately verify the same cookie fails (proves cookieCache is disabled)
    const postRevocationRes = await testAuth.api.getSession({
      headers: new Headers({ cookie: cookieHeader }),
    });
    expect(postRevocationRes).toBeNull();
  });

  it("proves invalid, random, or expired session tokens do not authenticate", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const fakeTokenCookie = "better-auth.session_token=totally-invalid-random-token-123456789";
    const res = await testAuth.api.getSession({
      headers: new Headers({ cookie: fakeTokenCookie }),
    });
    expect(res).toBeNull();
  });

  it("proves a genuinely expired database session in PostgreSQL is rejected by both session lookup and probe", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const { email, password, name } = generateRandomTestUser();
    await testAuth.api.signUpEmail({ body: { email, password, name } });

    const signInRes = await testAuth.api.signInEmail({
      body: { email, password },
      asResponse: true,
    });

    const setCookie = signInRes.headers.get("set-cookie") || "";
    const cookieHeader = setCookie.split(";")[0]; // "better-auth.session_token=..."

    // Confirm session is initially valid
    const initialSession = await testAuth.api.getSession({
      headers: new Headers({ cookie: cookieHeader }),
    });
    expect(initialSession).not.toBeNull();
    const token = initialSession!.session.token;

    // Mutate the session in real PostgreSQL to expire in the past
    const prisma = getPrisma();
    await prisma.session.update({
      where: { token },
      data: {
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    });

    // 1. Better Auth session retrieval must reject the expired session row
    const expiredSessionRes = await testAuth.api.getSession({
      headers: new Headers({ cookie: cookieHeader }),
    });
    expect(expiredSessionRes).toBeNull();

    // 2. Protected probe endpoint must return 401 Problem Details
    const probeReq = new NextRequest("http://localhost:3000/api/auth/probe", {
      headers: { cookie: cookieHeader },
    });
    const probeRes = await probeHandler(probeReq);
    expect(probeRes.status).toBe(401);
    expect(probeRes.headers.get("Content-Type")).toBe("application/problem+json");

    const problemJson = await probeRes.json();
    expect(problemJson).toMatchObject({
      type: "https://waffarhacars.com/errors/unauthorized",
      status: 401,
      title: "Unauthorized",
      detail: "Authentication required",
    });
  });

  it("proves untrusted Origin is rejected with exact INVALID_ORIGIN and configured trusted Origin is accepted", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const { email, password, name } = generateRandomTestUser();
    await testAuth.api.signUpEmail({ body: { email, password, name } });

    // Auth instance with explicit origin checking enabled
    const originAuth = createTestAuth({
      baseURL: "http://localhost:3000",
      secret: TEST_SECRET,
      advanced: {
        disableOriginCheck: false,
      },
    });

    // Request with untrusted origin
    const untrustedReq = new Request("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        Origin: "https://malicious-attacker.com",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });

    const untrustedRes = await originAuth.handler(untrustedReq);
    expect(untrustedRes.status).toBe(403);
    const untrustedBody = await untrustedRes.json();
    expect(untrustedBody).toEqual({
      code: "INVALID_ORIGIN",
      message: "Invalid origin",
    });

    // Request with trusted origin
    const trustedReq = new Request("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        Origin: "http://localhost:3000",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });

    const trustedRes = await originAuth.handler(trustedReq);
    expect(trustedRes.status).toBe(200);
  });

  it("proves browser-facing sign-in JSON response strips session tokens while preserving HttpOnly Set-Cookie", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const { email, password, name } = generateRandomTestUser();
    await testAuth.api.signUpEmail({ body: { email, password, name } });

    const req = new NextRequest("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify({ email, password }),
    });

    const res = await handleAuth(req);
    expect(res.status).toBe(200);

    const setCookie = res.headers.get("set-cookie") || "";
    expect(setCookie).toContain("better-auth.session_token=");
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("samesite=lax");

    const body = await res.json();
    expect(body).toBeDefined();
    expect(body.token).toBeUndefined();
    if (body.session) {
      expect(body.session.token).toBeUndefined();
    }
    expect(body.user?.email).toBe(email);
  });

  it("proves public email signup is strictly rejected against the production-mounted auth instance", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const { email, password, name } = generateRandomTestUser();

    // Attempting signup against the production auth instance (which has disableSignUp: true)
    const res = await getAuth().api.signUpEmail({
      body: { email, password, name },
      asResponse: true,
    });

    // Public signup must fail with 403 or 400 and error message indicating signup is disabled
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = await res.json();
    expect(body.message || body.error || "").toMatch(/sign.*up.*(?:disabled|not enabled)/i);
  });

  it("proves protected session probe returns 401 Problem Details without valid session and 200 without leaking PII when authenticated", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    // 1. Unauthenticated probe request
    const unauthReq = new NextRequest("http://localhost:3000/api/auth/probe");
    const unauthRes = await probeHandler(unauthReq);

    expect(unauthRes.status).toBe(401);
    expect(unauthRes.headers.get("Content-Type")).toBe("application/problem+json");
    expect(unauthRes.headers.get("Cache-Control")).toBe("no-store");

    const problemJson = await unauthRes.json();
    expect(problemJson).toMatchObject({
      type: "https://waffarhacars.com/errors/unauthorized",
      title: "Unauthorized",
      status: 401,
      detail: "Authentication required",
    });

    // 2. Authenticated probe request
    const { email, password, name } = generateRandomTestUser();
    await testAuth.api.signUpEmail({ body: { email, password, name } });

    const signInRes = await testAuth.api.signInEmail({
      body: { email, password },
      asResponse: true,
    });
    const setCookie = signInRes.headers.get("set-cookie") || "";
    const cookieHeader = setCookie.split(";")[0];

    const authReq = new NextRequest("http://localhost:3000/api/auth/probe", {
      headers: { cookie: cookieHeader },
    });
    const authRes = await probeHandler(authReq);

    expect(authRes.status).toBe(200);
    expect(authRes.headers.get("Cache-Control")).toBe("no-store");

    const authJson = await authRes.json();
    expect(authJson).toEqual({ authenticated: true });
    // Invariant: No PII (email, user ID, tokens, or names) leaked in probe response
    const serialized = JSON.stringify(authJson);
    expect(serialized).not.toContain(email);
    expect(serialized).not.toContain(name);
  });
});
