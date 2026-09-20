import { betterAuth, type BetterAuthOptions } from "better-auth";
import { getAuthOptions } from "@/lib/auth";

/**
 * Test-only auth instance factory enabling user provisioning solely for test execution.
 * Kept strictly within test-only support code outside the production runtime path.
 */
export function createTestAuth(customOptions: Partial<BetterAuthOptions> = {}) {
  return betterAuth(
    getAuthOptions({
      emailAndPassword: {
        enabled: true,
        disableSignUp: false, // Enable signup solely for test fixture creation
      },
      ...customOptions,
    })
  );
}
