import { betterAuth, type BetterAuthOptions } from "better-auth";

/**
 * Pure schema configuration used strictly for Better Auth CLI schema generation.
 * Contains no runtime database imports, no server-only dependencies,
 * and no production environment secret dependencies.
 */
export const schemaOptions: BetterAuthOptions = {
  baseURL: "http://localhost:3000",
  secret: "schema-generation-placeholder-secret-at-least-32-chars",
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
};

export const auth = betterAuth(schemaOptions);
export default auth;
