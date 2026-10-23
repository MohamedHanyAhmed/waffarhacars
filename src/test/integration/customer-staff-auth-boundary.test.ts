import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import pg from "pg";
import { NextRequest } from "next/server";
import { createOTP } from "@better-auth/utils/otp";
import { base32 } from "@better-auth/utils/base32";
import { getAuth, resetAuth } from "@/lib/auth";
import { getPrisma, disconnectDb } from "@/lib/db";
import { resetServerEnvCache } from "@/lib/env";
import { assertStaffPermission, AuthorizationError } from "@/lib/dal";
import { resolveStaffSession } from "@/lib/staff/staff-session";
import { TestSmsAdapter } from "@/lib/sms/test-adapter";
import { setSmsAdapterForTesting } from "@/lib/sms/factory";
import { computePhoneLookupHash, generatePlaceholderEmail } from "@/lib/otp/challenge-service";
import { hashEmailIdentifier, hashIpAddress } from "@/lib/rate-limit";
import { createTestAuth } from "@/test/support/test-auth";
import { handleAuth } from "@/app/api/auth/[...all]/route";
import { POST as requestOtp } from "@/app/api/v1/auth/phone/request/route";
import { POST as verifyOtp } from "@/app/api/v1/auth/phone/verify/route";
import { GET as staffRead } from "@/app/api/v1/staff/catalog/services/route";
import { GET as customerRead } from "@/app/api/v1/garage/route";

const originalEnv = { ...process.env };
const origin = "http://localhost:3000";
const ownedUsers: string[] = [];
const ownedEmails = new Set<string>();
const ownedPhoneHashes: string[] = [];
const ownedRateKeys = new Set<string>();
const sms = new TestSmsAdapter();
const testIps = Array.from(
  { length: 3 },
  () => `2001:db8:${crypto.randomBytes(12).toString("hex").match(/.{4}/g)!.join(":")}`
);
let fixtureReady = false;

function request(path: string, cookie = "", payload?: unknown, ip = testIps[0]) {
  const headers = new Headers({ "content-type": "application/json", "x-forwarded-for": ip });
  if (cookie) headers.set("cookie", cookie);
  if (payload !== undefined) headers.set("origin", origin);
  return new NextRequest(`${origin}${path}`, {
    method: payload === undefined ? "GET" : "POST",
    headers,
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
}

// Only transport actual server-issued cookies; never fabricate or sign one.
function responseCookie(response: Response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0].trim())
    .filter((cookie) => cookie && !cookie.endsWith("="))
    .join("; ");
}

async function authPost(path: string, payload: unknown, cookie = "") {
  return handleAuth(request(path, cookie, payload));
}

async function liveSession(cookie: string) {
  return getAuth().api.getSession({ headers: new Headers({ cookie }) });
}

function syntheticPhone() {
  const phone = `+2010${crypto.randomInt(10000000, 99999999)}`;
  const lookup = computePhoneLookupHash(phone);
  ownedPhoneHashes.push(lookup);
  ownedEmails.add(generatePlaceholderEmail(phone));
  for (const action of ["req", "verify"]) ownedRateKeys.add(`rl:phone:${action}:${lookup}`);
  return phone;
}

async function phoneLogin(phone: string, ip: string) {
  for (const action of ["req", "verify"]) ownedRateKeys.add(`rl:ip:${action}:${hashIpAddress(ip)}`);
  const sent = await requestOtp(request("/api/v1/auth/phone/request", "", { phone }, ip));
  expect(sent.status, "OTP_DISPATCH_MUST_COMPLETE").toBe(200);
  const code = sms.getLastOtp(phone);
  expect(typeof code === "string", "REAL_DELIVERY_CAPTURE_REQUIRED").toBe(true);
  const verified = await verifyOtp(request("/api/v1/auth/phone/verify", "", { phone, code }, ip));
  expect(verified.status, "OTP_VERIFICATION_MUST_COMPLETE").toBe(200);
  const cookie = responseCookie(verified);
  expect(cookie.length > 0, "SERVER_COOKIE_REQUIRED").toBe(true);
  const session = await liveSession(cookie);
  expect(Boolean(session?.session?.id && session?.user?.id), "LIVE_OTP_SESSION_REQUIRED").toBe(
    true
  );
  return { cookie, session: session! };
}

describe("Synthetic real-session customer OTP versus staff MFA boundary", () => {
  beforeAll(async () => {
    const databaseUrl = originalEnv.DATABASE_URL;
    if (!databaseUrl) throw new Error("SECURITY_DIAGNOSTIC_DATABASE_CONFIGURATION_REQUIRED");
    const parsed = new URL(databaseUrl);
    if (
      originalEnv.CI !== "true" ||
      originalEnv.APP_RUNTIME_PROFILE !== "showcase" ||
      originalEnv.APP_DATA_BACKEND !== "postgres" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) ||
      parsed.pathname !== "/waffarhacars_test"
    )
      throw new Error("SECURITY_DIAGNOSTIC_REQUIRES_DISPOSABLE_CI_DATABASE");
    const probe = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 3000 });
    try {
      await probe.connect();
      const identity = await probe.query<{ name: string }>("SELECT current_database() AS name");
      if (identity.rows[0].name !== "waffarhacars_test")
        throw new Error("SECURITY_DIAGNOSTIC_DATABASE_IDENTITY_MISMATCH");
    } catch {
      throw new Error("SECURITY_DIAGNOSTIC_DATABASE_PREFLIGHT_INCONCLUSIVE");
    } finally {
      await probe.end().catch(() => {
        throw new Error("SECURITY_DIAGNOSTIC_DATABASE_PROBE_CLEANUP_FAILED");
      });
    }
    process.env = {
      ...originalEnv,
      BETTER_AUTH_SECRET: crypto.randomBytes(32).toString("hex"),
      OTP_PEPPER_SECRET: crypto.randomBytes(32).toString("hex"),
      PHONE_ALIAS_HMAC_KEY: crypto.randomBytes(32).toString("hex"),
      PHONE_LOOKUP_HMAC_KEY: crypto.randomBytes(32).toString("hex"),
      STAFF_LOGIN_HMAC_KEY: crypto.randomBytes(32).toString("hex"),
      BETTER_AUTH_URL: origin,
      AUTH_TRUSTED_ORIGINS: origin,
      OTP_SMS_PROVIDER: "test",
      TRUSTED_PROXY_HOPS: "1",
    };
    resetServerEnvCache();
    resetAuth();
    setSmsAdapterForTesting(sms);
    fixtureReady = true;
  });

  afterAll(async () => {
    let cleanupFailed = false;
    try {
      if (fixtureReady) {
        const db = getPrisma();
        const partialUsers = await db.user.findMany({
          where: { email: { in: [...ownedEmails] } },
          select: { id: true },
        });
        for (const user of partialUsers)
          if (!ownedUsers.includes(user.id)) ownedUsers.push(user.id);
        const verifications = await db.verification.findMany({
          where: { value: { in: ownedUsers } },
          select: { identifier: true },
        });
        await db.verification.deleteMany({
          where: {
            OR: [
              { value: { in: ownedUsers } },
              {
                identifier: {
                  in: verifications.map((row) => `2fa-attempts-${row.identifier}`),
                },
              },
            ],
          },
        });
        await db.otpChallenge.deleteMany({ where: { phoneLookupHash: { in: ownedPhoneHashes } } });
        await db.rateLimitBucket.deleteMany({ where: { key: { in: [...ownedRateKeys] } } });
        // FK cascades remove only these owned users' sessions, credentials,
        // memberships, role assignments, two-factor records and profiles.
        // Existing security audit history is retained with its actor set null.
        await db.user.deleteMany({ where: { id: { in: ownedUsers } } });
        expect(await db.user.count({ where: { id: { in: ownedUsers } } })).toBe(0);
        expect(await db.session.count({ where: { userId: { in: ownedUsers } } })).toBe(0);
        expect(await db.customerProfile.count({ where: { userId: { in: ownedUsers } } })).toBe(0);
        expect(
          await db.otpChallenge.count({ where: { phoneLookupHash: { in: ownedPhoneHashes } } })
        ).toBe(0);
        console.info(
          JSON.stringify({
            event: "synthetic_auth_boundary_cleanup",
            ownedFixtureStateRemoved: true,
          })
        );
      }
    } catch {
      cleanupFailed = true;
    } finally {
      sms.clear();
      setSmsAdapterForTesting(null);
      try {
        await disconnectDb();
      } catch {
        cleanupFailed = true;
      } finally {
        resetAuth();
        resetServerEnvCache();
        process.env = originalEnv;
      }
    }
    if (cleanupFailed) throw new Error("SECURITY_DIAGNOSTIC_OWNED_CLEANUP_FAILED");
  });

  it("denies a genuine dual-profile phone-OTP session staff reads while a fresh password-plus-TOTP session succeeds", async () => {
    let stage = "FIXTURE_SETUP";
    try {
      const db = getPrisma();
      const email = `security-boundary-${crypto.randomUUID()}@test.invalid`;
      ownedEmails.add(email);
      const password = `Synthetic-${crypto.randomBytes(20).toString("hex")}!`;
      const phone = syntheticPhone();
      const fixtureAuth = createTestAuth();
      const signup = await fixtureAuth.api.signUpEmail({
        body: { email, password, name: "Synthetic auth-boundary fixture" },
        asResponse: true,
      });
      expect(signup.status, "FIXTURE_CREDENTIAL_CREATION_REQUIRED").toBe(200);
      const user = await db.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
      ownedUsers.push(user.id);
      await fixtureAuth.api.signOut({
        headers: new Headers({ cookie: responseCookie(signup) }),
        asResponse: true,
      });
      expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
      await db.user.update({
        where: { id: user.id },
        data: { phoneNumber: phone, phoneNumberVerified: true },
      });
      await db.customerProfile.create({ data: { userId: user.id } });
      const membership = await db.internalStaffMembership.create({
        data: {
          userId: user.id,
          employeeNumber: `SEC_${crypto.randomUUID().replaceAll("-", "")}`,
          department: "OPERATIONS",
          mustChangePassword: false,
          roleAssignments: { create: { role: "OPS_SUPERVISOR", isActive: true } },
        },
      });
      ownedRateKeys.add(`rate_limit:staff_login_ip:${hashIpAddress(testIps[0])}`);
      ownedRateKeys.add(
        `rate_limit:staff_login_account:${hashEmailIdentifier(email, process.env.STAFF_LOGIN_HMAC_KEY!)}`
      );

      stage = "REAL_TOTP_ENROLLMENT";
      const initialLogin = await authPost("/api/auth/sign-in/email", { email, password });
      expect(initialLogin.status).toBe(200);
      const initialCookie = responseCookie(initialLogin);
      const enabled = await authPost(
        "/api/auth/two-factor/enable",
        { password, method: "totp" },
        initialCookie
      );
      expect(enabled.status).toBe(200);
      const enabledBody = (await enabled.json()) as { totpURI?: string };
      expect(typeof enabledBody.totpURI === "string").toBe(true);
      const encodedSecret = new URL(enabledBody.totpURI!).searchParams.get("secret");
      expect(Boolean(encodedSecret)).toBe(true);
      const secret = Buffer.from(base32.decode(encodedSecret!)).toString("utf8");
      const enrollment = await authPost(
        "/api/auth/two-factor/verify-totp",
        { code: await createOTP(secret, { digits: 6, period: 30 }).totp() },
        responseCookie(enabled) || initialCookie
      );
      expect(enrollment.status).toBe(200);
      const enrolledCookie = responseCookie(enrollment) || responseCookie(enabled) || initialCookie;
      expect((await authPost("/api/auth/sign-out", {}, enrolledCookie)).status).toBe(200);
      expect(await liveSession(enrolledCookie)).toBeNull();

      stage = "FRESH_PASSWORD_AND_TOTP_POSITIVE_CONTROL";
      const freshLogin = await authPost("/api/auth/sign-in/email", { email, password });
      expect(freshLogin.status).toBe(200);
      expect((await freshLogin.json()).twoFactorRedirect).toBe(true);
      const challengeCookie = responseCookie(freshLogin);
      expect(await liveSession(challengeCookie)).toBeNull();
      expect(
        (await staffRead(request("/api/v1/staff/catalog/services", challengeCookie))).status
      ).toBe(401);
      const verifiedTotp = await authPost(
        "/api/auth/two-factor/verify-totp",
        { code: await createOTP(secret, { digits: 6, period: 30 }).totp() },
        challengeCookie
      );
      expect(verifiedTotp.status).toBe(200);
      const mfaCookie = responseCookie(verifiedTotp);
      const mfaSession = await liveSession(mfaCookie);
      expect(mfaSession?.user.id === user.id).toBe(true);
      const baseline = await staffRead(request("/api/v1/staff/catalog/services", mfaCookie));
      expect(baseline.status, "REAL_MFA_STAFF_READ_MUST_SUCCEED").toBe(200);
      expect((await customerRead(request("/api/v1/garage", mfaCookie))).status).toBe(200);

      stage = "ANONYMOUS_AND_CUSTOMER_ONLY_NEGATIVE_CONTROLS";
      const anonymousResult = await staffRead(request("/api/v1/staff/catalog/services"));
      expect(anonymousResult.status).toBe(401);
      const customerPhone = syntheticPhone();
      const customerOnly = await phoneLogin(customerPhone, testIps[1]);
      expect(customerOnly.session.user.email === generatePlaceholderEmail(customerPhone)).toBe(
        true
      );
      ownedUsers.push(customerOnly.session.user.id);
      expect((await customerRead(request("/api/v1/garage", customerOnly.cookie))).status).toBe(200);
      const customerOnlyStaffResult = await staffRead(
        request("/api/v1/staff/catalog/services", customerOnly.cookie)
      );
      expect(customerOnlyStaffResult.status).toBe(403);

      stage = "REAL_DUAL_PROFILE_OTP_SESSION";
      const membershipBefore = await db.internalStaffMembership.findUniqueOrThrow({
        where: { id: membership.id },
        include: { roleAssignments: true },
      });
      const sessionCountBeforeOtp = await db.session.count({ where: { userId: user.id } });
      const otp = await phoneLogin(phone, testIps[2]);
      expect(otp.session.user.id === user.id).toBe(true);
      expect(otp.session.session.id !== mfaSession!.session.id).toBe(true);
      const customerResult = await customerRead(request("/api/v1/garage", otp.cookie));
      expect(customerResult.status, "OTP_CUSTOMER_SESSION_MUST_BE_USABLE").toBe(200);
      const resolved = await resolveStaffSession(new Headers({ cookie: otp.cookie }));
      let dalStatus = 200;
      try {
        await assertStaffPermission(new Headers({ cookie: otp.cookie }), "service_catalog:read");
      } catch (error) {
        if (!(error instanceof AuthorizationError)) throw error;
        dalStatus = error.status;
      }
      const protectedResult = await staffRead(
        request("/api/v1/staff/catalog/services", otp.cookie)
      );
      expect([200, 403].includes(protectedResult.status), "STAFF_RESULT_MUST_BE_CONCLUSIVE").toBe(
        true
      );
      expect([200, 403].includes(dalStatus), "DAL_RESULT_MUST_BE_CONCLUSIVE").toBe(true);

      stage = "PERSISTENT_STATE_EVIDENCE";
      const membershipAfter = await db.internalStaffMembership.findUniqueOrThrow({
        where: { id: membership.id },
        include: { roleAssignments: true },
      });
      expect(membershipAfter).toEqual(membershipBefore);
      const storedUser = await db.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { twoFactorEnabled: true, customerProfile: { select: { id: true } } },
      });
      const factors = await db.twoFactor.findMany({
        where: { userId: user.id },
        select: { verified: true },
      });
      const challenge = await db.otpChallenge.findFirstOrThrow({
        where: { phoneLookupHash: computePhoneLookupHash(phone) },
        orderBy: { createdAt: "desc" },
        select: { status: true, consumedAt: true, failedAttemptCount: true },
      });
      const sessions = await db.session.findMany({
        where: { userId: user.id },
        select: { id: true, lastReauthenticatedAt: true },
      });
      expect(storedUser.twoFactorEnabled && Boolean(storedUser.customerProfile)).toBe(true);
      expect(factors.some((factor) => factor.verified === true)).toBe(true);
      expect(challenge.status).toBe("CONSUMED");
      expect(Boolean(challenge.consumedAt)).toBe(true);
      expect(sessions.some((session) => session.id === otp.session.session.id)).toBe(true);
      expect(sessions.some((session) => session.id === mfaSession!.session.id)).toBe(true);
      expect(sessions.length).toBe(sessionCountBeforeOtp + 1);
      console.info(
        JSON.stringify({
          event: "synthetic_auth_boundary_diagnostic",
          passwordTotpStaffStatus: baseline.status,
          anonymousStaffStatus: anonymousResult.status,
          customerOnlyStaffStatus: customerOnlyStaffResult.status,
          dualOtpCustomerStatus: customerResult.status,
          dualOtpStaffStatus: protectedResult.status,
          dualOtpDalStatus: dalStatus,
          dualOtpStaffResolverAllowsAccess: resolved.canAccessStaffApp,
          distinctOtpAndMfaSessions: true,
          ownedDualUserSessionCount: sessions.length,
          newSessionsFromOtp: sessions.length - sessionCountBeforeOtp,
          passwordTotpSessionReauthenticatedAtIsNull:
            sessions.find((session) => session.id === mfaSession!.session.id)
              ?.lastReauthenticatedAt === null,
          otpSessionReauthenticatedAtIsNull:
            sessions.find((session) => session.id === otp.session.session.id)
              ?.lastReauthenticatedAt === null,
          challengeStatus: challenge.status,
          consumedAtPresent: Boolean(challenge.consumedAt),
          failedOtpAttempts: challenge.failedAttemptCount,
          customerProfilePresent: Boolean(storedUser.customerProfile),
          verifiedTotpEnrollmentPresent: true,
          membershipAndRolesUnchanged: true,
        })
      );
      stage = "EXPECTED_SECURITY_DENIAL";
      expect(protectedResult.status, "OTP_ONLY_SESSION_MUST_NOT_GRANT_STAFF_READ").toBe(403);
      expect(dalStatus, "OTP_ONLY_SESSION_MUST_NOT_PASS_STAFF_DAL").toBe(403);
      expect(resolved.canAccessStaffApp).toBe(false);
    } catch (error) {
      if (error instanceof Error && error.name === "AssertionError") throw error;
      throw new Error(`SECURITY_DIAGNOSTIC_INCONCLUSIVE_${stage}`);
    }
  });
});
