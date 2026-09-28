import { createAuthMiddleware } from "@better-auth/core/api";
import type { BetterAuthPlugin } from "@better-auth/core";

export const TRUST_DEVICE_GUARD_PLUGIN_ID = "trusted-device-guard";

/**
 * Server-side trusted device enforcement guard plugin for Better Auth 1.7.5.
 *
 * Security Invariant:
 * Callers cannot make an internal staff device trusted by passing `trustDevice: true`
 * to public TOTP or backup-code verification endpoints (/two-factor/verify-totp,
 * /two-factor/verify-backup-code).
 *
 * This hook executes BEFORE Better Auth's verifyTwoFactor logic and forces
 * `ctx.body.trustDevice = false`, guaranteeing that Better Auth's verifyTwoFactor
 * never executes the trust device branch:
 * 1. Zero `better-auth.trust-device` cookie is issued.
 * 2. Zero `trust-device-*` verification record is created in PostgreSQL.
 * 3. Subsequent logins still mandate MFA.
 */
export function trustedDeviceGuardPlugin(): BetterAuthPlugin {
  return {
    id: TRUST_DEVICE_GUARD_PLUGIN_ID,
    hooks: {
      before: [
        {
          matcher: (ctx) => {
            return (
              ctx.path === "/two-factor/verify-totp" ||
              ctx.path === "/two-factor/verify-backup-code"
            );
          },
          handler: createAuthMiddleware(async (ctx) => {
            if (ctx.body && typeof ctx.body === "object") {
              // Force trustDevice to false regardless of caller input
              (ctx.body as Record<string, unknown>).trustDevice = false;
            }
          }),
        },
      ],
    },
  };
}
