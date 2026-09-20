import { describe, it, expect, beforeEach } from "vitest";
import { TestSmsAdapter } from "@/lib/sms/test-adapter";
import { getSmsAdapter, setSmsAdapterForTesting } from "@/lib/sms/factory";
import { resetServerEnvCache } from "@/lib/env";

describe("SMS Provider Abstraction Suite", () => {
  beforeEach(() => {
    resetServerEnvCache();
    setSmsAdapterForTesting(null);
  });

  it("TestSmsAdapter captures messages and extracts 6-digit OTP", async () => {
    const adapter = new TestSmsAdapter();
    const result = await adapter.send({
      toCanonicalE164: "+201012345678",
      message: "Your code is 654321",
      idempotencyKey: "test-idempotency-1",
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe("delivered");
    expect(adapter.getLastOtp("+201012345678")).toBe("654321");
    expect(adapter.getCapturedMessages().length).toBe(1);

    adapter.clear();
    expect(adapter.getCapturedMessages().length).toBe(0);
    expect(adapter.getLastOtp()).toBeUndefined();
  });

  it("TestSmsAdapter simulates provider failures accurately", async () => {
    const adapter = new TestSmsAdapter();
    adapter.simulateFailure("PROVIDER_UNAVAILABLE");

    const result = await adapter.send({
      toCanonicalE164: "+201012345678",
      message: "Code: 112233",
      idempotencyKey: "test-idempotency-2",
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.errorCategory).toBe("PROVIDER_UNAVAILABLE");
  });

  it("getSmsAdapter fails closed in production if mock or dev capture provider is configured", () => {
    const originalEnv = { ...process.env };
    process.env.APP_RUNTIME_PROFILE = "production";
    process.env.APP_DATA_BACKEND = "postgres";
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/db";
    process.env.BETTER_AUTH_SECRET = "prod-secret-at-least-32-chars-long-with-entropy-123";
    process.env.BETTER_AUTH_URL = "https://waffarhacars.com";
    process.env.OTP_SMS_PROVIDER = "test";

    expect(() => {
      resetServerEnvCache();
      getSmsAdapter();
    }).toThrow(/Production runtime profile cannot use test or dev_capture SMS provider/);

    process.env = originalEnv;
    resetServerEnvCache();
  });
});
