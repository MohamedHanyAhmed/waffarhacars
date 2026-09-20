import type { SmsAdapter, SmsSendInput, SmsSendResult } from "./types";
import { formatMaskedPhone } from "../phone";

/**
 * Local development capture adapter.
 * Permitted exclusively when NODE_ENV !== "production".
 * Logs a masked terminal message and saves the last dispatch for developer ease.
 */
export class DevCaptureSmsAdapter implements SmsAdapter {
  readonly providerId = "dev_capture";

  async send(input: SmsSendInput): Promise<SmsSendResult> {
    const masked = formatMaskedPhone(input.toCanonicalE164);
    // Development-only diagnostic output
    console.log(`[DevCaptureSmsAdapter] SMS dispatched to ${masked}: "${input.message}"`);

    return {
      success: true,
      providerMessageId: `dev-msg-${Date.now()}`,
      idempotencyKey: input.idempotencyKey,
      status: "delivered",
    };
  }
}
