import type { SmsAdapter } from "./types";
import { TestSmsAdapter } from "./test-adapter";
import { DevCaptureSmsAdapter } from "./dev-capture-adapter";
import { EgyptianSmsGatewayStub } from "./egyptian-gateway-stub";
import { getServerEnv } from "../env";

let cachedAdapter: SmsAdapter | null = null;
let testOverrideAdapter: SmsAdapter | null = null;

/**
 * Returns the configured SMS Provider Adapter.
 *
 * Production Safety Invariant:
 * - If APP_RUNTIME_PROFILE === "production", test and dev_capture adapters are strictly prohibited.
 * - Application fails closed immediately if an unapproved mock adapter is configured.
 */
export function getSmsAdapter(): SmsAdapter {
  if (testOverrideAdapter) {
    return testOverrideAdapter;
  }

  if (cachedAdapter) {
    return cachedAdapter;
  }

  const env = getServerEnv();
  const provider =
    env.OTP_SMS_PROVIDER ||
    (env.APP_RUNTIME_PROFILE === "production" ? "egyptian_gateway" : "dev_capture");

  if (env.APP_RUNTIME_PROFILE === "production") {
    if (provider === "test" || provider === "dev_capture") {
      throw new Error(
        "FATAL: Production runtime profile cannot use test or dev_capture SMS provider."
      );
    }
  }

  switch (provider) {
    case "test":
      cachedAdapter = new TestSmsAdapter();
      break;
    case "dev_capture":
      cachedAdapter = new DevCaptureSmsAdapter();
      break;
    case "egyptian_gateway":
      cachedAdapter = new EgyptianSmsGatewayStub(process.env.OTP_API_KEY);
      break;
    default:
      throw new Error(`Unknown SMS provider: ${provider}`);
  }

  return cachedAdapter;
}

/**
 * Injects an explicit SMS adapter for integration/unit testing.
 */
export function setSmsAdapterForTesting(adapter: SmsAdapter | null): void {
  testOverrideAdapter = adapter;
  cachedAdapter = null;
}
