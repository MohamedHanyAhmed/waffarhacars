import { betterAuth, type BetterAuthOptions } from "better-auth";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import type { PrismaClient } from "@/generated/prisma/client";
// Defer resolution of ./db until runtime execution so CLI schema generation
// does not trigger Next.js 'server-only' package restrictions.
async function resolvePrisma(): Promise<PrismaClient> {
  const { getPrisma } = await import("./db");
  return getPrisma();
}

const prismaProxy = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    if (prop === "then" || prop === "_runtimeDataModel") {
      return undefined;
    }

    if (typeof prop === "string" && prop.startsWith("$")) {
      return async (...args: unknown[]) => {
        const client = await resolvePrisma();
        const clientRecord = client as unknown as Record<string | symbol, unknown>;
        const fn = clientRecord[prop];
        if (typeof fn === "function") {
          return Reflect.apply(fn, client, args);
        }
        return fn;
      };
    }

    return new Proxy(
      {},
      {
        get(_subTarget, subProp) {
          if (subProp === "then") {
            return undefined;
          }
          return async (...args: unknown[]) => {
            const client = await resolvePrisma();
            const clientRecord = client as unknown as Record<
              string | symbol,
              Record<string | symbol, unknown>
            >;
            const model = clientRecord[prop];
            const targetFn = model?.[subProp];
            if (typeof targetFn === "function") {
              return Reflect.apply(targetFn, model, args);
            }
            return targetFn;
          };
        },
      }
    );
  },
});

export function getAuthOptions(overrides: Partial<BetterAuthOptions> = {}): BetterAuthOptions {
  const runtimeProfile = process.env.APP_RUNTIME_PROFILE || "showcase";
  const authSecret =
    process.env.BETTER_AUTH_SECRET || "waffarhacars-development-auth-secret-min32-characters";
  const authUrl = process.env.BETTER_AUTH_URL || "http://localhost:3000";

  const trustedOrigins = [authUrl];
  if (process.env.AUTH_TRUSTED_ORIGINS) {
    const extra = process.env.AUTH_TRUSTED_ORIGINS.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    trustedOrigins.push(...extra);
  }

  return {
    baseURL: authUrl,
    secret: authSecret,
    trustedOrigins,
    database: prismaAdapter(prismaProxy, {
      provider: "postgresql",
    }),
    advanced: {
      database: {
        generateId: "uuid",
      },
      useSecureCookies: runtimeProfile === "production",
    },
    session: {
      cookieCache: {
        enabled: false,
      },
      additionalFields: {
        lastActivityAt: {
          type: "date",
          input: false,
          required: true,
        },
        lastReauthenticatedAt: {
          type: "date",
          input: false,
          required: false,
        },
      },
    },
    user: {
      additionalFields: {
        isSuspended: {
          type: "boolean",
          defaultValue: false,
          input: false,
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true, // Public email/password signup strictly disabled in production
    },
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
    ...overrides,
  };
}

// Export auth instance for Route Handlers and CLI schema generation discovery
export const auth = betterAuth(getAuthOptions());

// Test auth factory for isolated integration test user provisioning
export function createTestAuth(customOptions: Partial<BetterAuthOptions> = {}) {
  return betterAuth(
    getAuthOptions({
      emailAndPassword: {
        enabled: true,
        disableSignUp: false, // Enable signup only within explicit test execution
      },
      ...customOptions,
    })
  );
}
