import { describe, it, expect } from "vitest";
import { trustedDeviceGuardPlugin } from "@/lib/auth/trusted-device-guard";

interface MockEndpointContext {
  path: string;
  body?: Record<string, unknown> | null;
}

type HookMatcher = (context: MockEndpointContext) => boolean;
type HookHandler = (context: MockEndpointContext) => Promise<void>;

describe("Trusted Device Guard Plugin Unit Tests", () => {
  const plugin = trustedDeviceGuardPlugin();

  it("has correct plugin metadata", () => {
    expect(plugin.id).toBe("trusted-device-guard");
    expect(plugin.hooks).toBeDefined();
    expect(plugin.hooks?.before).toBeDefined();
  });

  it("before-hook matches /two-factor/verify-totp and /two-factor/verify-backup-code", () => {
    const beforeHook = plugin.hooks!.before![0];
    const matcher = beforeHook.matcher as unknown as HookMatcher;
    expect(matcher({ path: "/two-factor/verify-totp" })).toBe(true);
    expect(matcher({ path: "/two-factor/verify-backup-code" })).toBe(true);
    expect(matcher({ path: "/two-factor/enable" })).toBe(false);
    expect(matcher({ path: "/sign-in/email" })).toBe(false);
    expect(matcher({ path: "/two-factor/verify-otp" })).toBe(false);
  });

  it("before-hook forces trustDevice to false when body has trustDevice: true", async () => {
    const beforeHook = plugin.hooks!.before![0];
    const handler = beforeHook.handler as unknown as HookHandler;
    const ctx: MockEndpointContext = {
      path: "/two-factor/verify-totp",
      body: {
        code: "123456",
        trustDevice: true,
      },
    };

    await handler(ctx);
    expect(ctx.body?.trustDevice).toBe(false);
  });

  it("before-hook forces trustDevice to false when body is an empty object", async () => {
    const beforeHook = plugin.hooks!.before![0];
    const handler = beforeHook.handler as unknown as HookHandler;
    const ctx: MockEndpointContext = {
      path: "/two-factor/verify-backup-code",
      body: {
        code: "backup-code-123",
      },
    };

    await handler(ctx);
    expect(ctx.body?.trustDevice).toBe(false);
  });

  it("before-hook handles non-object body without throwing", async () => {
    const beforeHook = plugin.hooks!.before![0];
    const handler = beforeHook.handler as unknown as HookHandler;
    const ctx: MockEndpointContext = {
      path: "/two-factor/verify-backup-code",
      body: null,
    };

    await expect(handler(ctx)).resolves.not.toThrow();
  });
});
