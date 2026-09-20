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

interface ParsedCookie {
  name: string;
  value: string;
  isHttpOnly: boolean;
  isSecure: boolean;
  sameSite?: string;
  path?: string;
}

function parseSetCookie(headerValue: string): ParsedCookie {
  const parts = headerValue.split(";").map((p) => p.trim());
  const [name, ...valParts] = parts[0].split("=");
  const value = valParts.join("=");

  let isHttpOnly = false;
  let isSecure = false;
  let sameSite: string | undefined;
  let path: string | undefined;

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    const lower = part.toLowerCase();
    if (lower === "httponly") {
      isHttpOnly = true;
    } else if (lower === "secure") {
      isSecure = true;
    } else if (lower.startsWith("samesite=")) {
      sameSite = part.split("=")[1];
    } else if (lower.startsWith("path=")) {
      path = part.split("=")[1];
    }
  }

  return {
    name,
    value,
    isHttpOnly,
    isSecure,
    sameSite,
    path,
  };
}

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

  it("proves two independent sign-ins create two distinct sessions and verifies database uniqueness", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const { email, password, name } = generateRandomTestUser();
    await testAuth.api.signUpEmail({ body: { email, password, name } });

    const prisma = getPrisma();
    const dbUser = await prisma.user.findUnique({ where: { email } });
    expect(dbUser).not.toBeNull();

    // Baseline session count before explicit sign-ins
    const countBaseline = await prisma.session.count({ where: { userId: dbUser!.id } });

    // First independent sign-in
    const signInRes1 = await testAuth.api.signInEmail({
      body: { email, password },
      asResponse: true,
    });
    expect(signInRes1.status).toBe(200);

    const countAfterFirst = await prisma.session.count({ where: { userId: dbUser!.id } });
    expect(countAfterFirst - countBaseline).toBe(1);

    // Second independent sign-in
    const signInRes2 = await testAuth.api.signInEmail({
      body: { email, password },
      asResponse: true,
    });
    expect(signInRes2.status).toBe(200);

    const countAfterSecond = await prisma.session.count({ where: { userId: dbUser!.id } });
    expect(countAfterSecond - countAfterFirst).toBe(1);

    // Retrieve both created sessions from PostgreSQL
    const sessions = await prisma.session.findMany({
      where: { userId: dbUser!.id },
      orderBy: { createdAt: "asc" },
    });
    expect(sessions.length - countBaseline).toBe(2);

    const session1 = sessions[sessions.length - 2];
    const session2 = sessions[sessions.length - 1];

    // Assert UUID format
    expect(UUID_REGEX.test(session1.id)).toBe(true);
    expect(UUID_REGEX.test(session2.id)).toBe(true);
    expect(session1.id).not.toBe(session2.id);

    // Assert the two session tokens are strictly different
    expect(session1.token).toBeDefined();
    expect(session2.token).toBeDefined();
    expect(session1.token).not.toBe(session2.token);
    expect(session1.token.length).toBeGreaterThanOrEqual(20);
    expect(session2.token.length).toBeGreaterThanOrEqual(20);

    // Assert database uniqueness invariant: attempting to insert duplicate token throws unique constraint error
    await expect(
      prisma.session.create({
        data: {
          id: crypto.randomUUID(),
          token: session1.token,
          userId: dbUser!.id,
          expiresAt: new Date(Date.now() + 86400000),
          lastActivityAt: new Date(),
        },
      })
    ).rejects.toThrow();
  });

  it("proves structural cookie assertions: HttpOnly, SameSite=Lax, Path=/, Secure=false in dev, Secure=true in prod", async () => {
    if (!isDbReachable) {
      throw new Error("PostgreSQL integration service is unavailable. Run 'npm run db:test:up'.");
    }

    const { email, password, name } = generateRandomTestUser();
    await testAuth.api.signUpEmail({ body: { email, password, name } });

    // 1. Non-production / development sign-in
    const devSignInRes = await testAuth.api.signInEmail({
      body: { email, password },
      asResponse: true,
    });

    const devSetCookie = devSignInRes.headers.get("set-cookie") || "";
    const parsedDevCookie = parseSetCookie(devSetCookie);

    expect(parsedDevCookie.name).toBe("better-auth.session_token");
    expect(parsedDevCookie.value).toBeTruthy();
    expect(parsedDevCookie.isHttpOnly).toBe(true);
    expect(parsedDevCookie.isSecure).toBe(false); // Secure=false in development
    expect(parsedDevCookie.sameSite?.toLowerCase()).toBe("lax");
    expect(parsedDevCookie.path).toBe("/");

    // 2. Production auth instance with useSecureCookies enabled
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
    const parsedProdCookie = parseSetCookie(prodSetCookie);

    expect(parsedProdCookie.name).toBe("__Secure-better-auth.session_token");
    expect(parsedProdCookie.value).toBeTruthy();
    expect(parsedProdCookie.isHttpOnly).toBe(true);
    expect(parsedProdCookie.isSecure).toBe(true); // Secure=true in production
    expect(parsedProdCookie.sameSite?.toLowerCase()).toBe("lax");
    expect(parsedProdCookie.path).toBe("/");
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

  it("proves browser-facing sign-in JSON strips session tokens, body does not contain DB token, and preserved cookie authenticates", async () => {
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
    const parsedCookie = parseSetCookie(setCookie);
    expect(parsedCookie.name).toBe("better-auth.session_token");
    expect(parsedCookie.isHttpOnly).toBe(true);
    expect(parsedCookie.isSecure).toBe(false);
    expect(parsedCookie.sameSite?.toLowerCase()).toBe("lax");

    // Retrieve database session row from PostgreSQL for the signed-in user
    const prisma = getPrisma();
    const dbUser = await prisma.user.findUnique({ where: { email } });
    expect(dbUser).not.toBeNull();

    const dbSessions = await prisma.session.findMany({
      where: { userId: dbUser!.id },
      orderBy: { createdAt: "desc" },
    });
    expect(dbSessions.length).toBeGreaterThanOrEqual(1);
    const realDbToken = dbSessions[0].token;

    // Verify response body JSON
    const bodyText = await res.text();
    const body = JSON.parse(bodyText);

    // 1. Neither token nor session.token present in parsed JSON
    expect(body.token).toBeUndefined();
    if (body.session) {
      expect(body.session.token).toBeUndefined();
    }
    expect(body.user?.email).toBe(email);

    // 2. Serialized body does not contain the actual PostgreSQL session token
    expect(bodyText).not.toContain(realDbToken);

    // 3. Authentication using the preserved cookie still succeeds on session probe
    const probeReq = new NextRequest("http://localhost:3000/api/auth/probe", {
      headers: { cookie: setCookie.split(";")[0] },
    });
    const probeRes = await probeHandler(probeReq);
    expect(probeRes.status).toBe(200);
    const probeJson = await probeRes.json();
    expect(probeJson).toEqual({ authenticated: true });
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
