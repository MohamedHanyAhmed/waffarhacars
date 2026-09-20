import "server-only";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { phoneNumber } from "better-auth/plugins";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { getPrisma } from "./db";
import { getServerEnv } from "./env";
import { authCoreOptions } from "./auth-core-options";
import { normalizeEgyptianPhone, formatMaskedPhone } from "./phone";
import { verifyAndConsumeOtpChallenge, generatePlaceholderEmail } from "./otp/challenge-service";

let cachedAuth: ReturnType<typeof betterAuth> | null = null;

export function getAuthOptions(overrides: Partial<BetterAuthOptions> = {}): BetterAuthOptions {
  const env = getServerEnv();

  const trustedOrigins = [...env.AUTH_TRUSTED_ORIGINS];

  const baseOptions: BetterAuthOptions = {
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins,
    database: prismaAdapter(getPrisma(), {
      provider: "postgresql",
    }),
    advanced: {
      ...authCoreOptions.advanced,
      useSecureCookies: env.APP_RUNTIME_PROFILE === "production",
    },
    session: {
      cookieCache: {
        enabled: false,
      },
      ...authCoreOptions.session,
    },
    user: {
      ...authCoreOptions.user,
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true, // Public email/password signup strictly disabled in production
    },
    plugins: [
      phoneNumber({
        sendOTP: async () => {
          // No-op: Public send-otp is blocked, application uses /api/v1/auth/phone/request
        },
        phoneNumberValidator: (phone) => normalizeEgyptianPhone(phone).success,
        signUpOnVerification: {
          getTempEmail: (phone) => generatePlaceholderEmail(phone),
          getTempName: (phone) => formatMaskedPhone(phone),
        },
        verifyOTP: async ({ phoneNumber: phone, code }) => {
          const res = await verifyAndConsumeOtpChallenge(phone, code);
          return res.success;
        },
        callbackOnVerification: async ({ user }) => {
          const prisma = getPrisma();
          await prisma.customerProfile.upsert({
            where: { userId: user.id },
            create: {
              userId: user.id,
              preferredLanguage: "ar",
              notificationPreferences: { sms: true, whatsapp: false },
            },
            update: {},
          });
        },
      }),
    ],
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const s = session as unknown as Record<string, unknown>;
            return {
              data: {
                ...session,
                lastActivityAt: (s.lastActivityAt as Date | undefined) || new Date(),
                lastReauthenticatedAt: (s.lastReauthenticatedAt as Date | null | undefined) || null,
              },
            };
          },
        },
      },
    },
  };

  return {
    ...baseOptions,
    ...overrides,
    advanced: {
      useSecureCookies: env.APP_RUNTIME_PROFILE === "production",
      ...overrides.advanced,
      database: {
        generateId: "uuid",
        ...overrides.advanced?.database,
      },
    },
  };
}

/**
 * Lazy singleton getter for Better Auth instance using validated environment data.
 * Zero fallback runtime secrets: strictly fails closed if configuration is invalid.
 */
export function getAuth(): ReturnType<typeof betterAuth> {
  if (!cachedAuth) {
    cachedAuth = betterAuth(getAuthOptions());
  }
  return cachedAuth;
}

/**
 * Resets cached auth instance. Intended for testing when environment variables change.
 */
export function resetAuth(): void {
  cachedAuth = null;
}
