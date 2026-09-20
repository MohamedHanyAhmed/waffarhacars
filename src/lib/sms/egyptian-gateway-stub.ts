import type { SmsAdapter, SmsSendInput, SmsSendResult } from "./types";

/**
 * Placeholder stub for future Egyptian SMS Gateway adapter
 * (Unifonic / CEQUENS / VictoryLink / Infobip).
 *
 * Integration of a commercial paid SMS gateway is strictly deferred post-ADR 14.
 */
export class EgyptianSmsGatewayStub implements SmsAdapter {
  readonly providerId = "egyptian_gateway";

  constructor(private readonly apiKey?: string) {}

  async send(input: SmsSendInput): Promise<SmsSendResult> {
    if (!this.apiKey) {
      return {
        success: false,
        idempotencyKey: input.idempotencyKey,
        status: "failed",
        errorCategory: "CONFIGURATION_ERROR",
      };
    }

    // Commercial gateway integration deferred
    return {
      success: false,
      idempotencyKey: input.idempotencyKey,
      status: "failed",
      errorCategory: "PROVIDER_UNAVAILABLE",
    };
  }
}
