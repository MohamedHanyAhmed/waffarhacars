import { betterAuth, type BetterAuthOptions } from "better-auth";
import { phoneNumber } from "better-auth/plugins";
import { authCoreOptions } from "./auth-core-options";

/**
 * Pure schema configuration used strictly for Better Auth CLI schema generation.
 * Reuses the single source of truth authCoreOptions.
 * Contains no runtime database imports, no server-only dependencies,
 * and no production environment secret dependencies.
 */
export const schemaOptions: BetterAuthOptions = {
  baseURL: "http://localhost:3000",
  secret: "schema-generation-placeholder-secret-at-least-32-chars",
  user: {
    ...authCoreOptions.user,
  },
  session: {
    ...authCoreOptions.session,
  },
  advanced: {
    ...authCoreOptions.advanced,
  },
  plugins: [phoneNumber()],
};

export const auth = betterAuth(schemaOptions);
export default auth;
