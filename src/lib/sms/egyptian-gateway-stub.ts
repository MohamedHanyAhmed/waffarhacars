import type { SmsAdapter, SmsSendInput, SmsSendResult } from "./types";

/**
 * Placeholder contract stub for future Egyptian SMS Gateway adapter
 * (e.g. Unifonic, CEQUENS, VictoryLink, Infobip).
 *
 * NOTE: Production customer OTP deployment remains intentionally unavailable
 * until a real commercial SMS aggregator adapter is selected and integrated.
 * This stub strictly fails closed in all environments.
 */
export class EgyptianSmsGatewayStub implements SmsAdapter {
  readonly providerId = "egyptian_gateway";

  async send(input: SmsSendInput): Promise<SmsSendResult> {
    if (input.signal?.aborted) {
      return {
        success: false,
        idempotencyKey: input.idempotencyKey,
        status: "failed",
        errorCategory: "GATEWAY_TIMEOUT",
      };
    }

    // Commercial aggregator integration deferred post-ADR 14
    return {
      success: false,
      idempotencyKey: input.idempotencyKey,
      status: "failed",
      errorCategory: "PROVIDER_UNAVAILABLE",
    };
  }
}
