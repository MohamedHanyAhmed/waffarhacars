import type { BetterAuthOptions } from "better-auth";

/**
 * Pure core schema and options definition shared across runtime auth,
 * schema generation, and test suites.
 * Contains ZERO server-only, database, secret, or environment imports.
 */
export const authCoreOptions = {
  user: {
    additionalFields: {
      isSuspended: {
        type: "boolean",
        defaultValue: false,
        input: false,
      },
    },
  },
  session: {
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
  advanced: {
    database: {
      generateId: "uuid",
    },
  },
} as const satisfies Partial<BetterAuthOptions>;

export type AuthCoreOptions = typeof authCoreOptions;
