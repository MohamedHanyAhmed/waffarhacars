/**
 * SMS delivery lifecycle status.
 */
export type SmsDeliveryStatus = "accepted" | "delivered" | "failed" | "queued";

/**
 * Sanitized error classification categories for SMS dispatch.
 * Avoids exposing raw gateway vendor errors or diagnostic traces.
 */
export type SmsErrorCategory =
  | "RATE_LIMITED"
  | "INVALID_DESTINATION"
  | "GATEWAY_TIMEOUT"
  | "NETWORK_ERROR"
  | "CONFIGURATION_ERROR"
  | "PROVIDER_UNAVAILABLE";

/**
 * Input parameters for sending an SMS OTP.
 */
export interface SmsSendInput {
  toCanonicalE164: string;
  message: string;
  idempotencyKey: string;
  timeoutMs?: number;
}

/**
 * Standardized SMS dispatch result.
 */
export interface SmsSendResult {
  success: boolean;
  providerMessageId?: string;
  idempotencyKey: string;
  status: SmsDeliveryStatus;
  errorCategory?: SmsErrorCategory;
}

/**
 * Pluggable SMS Provider Adapter interface.
 */
export interface SmsAdapter {
  readonly providerId: string;
  send(input: SmsSendInput): Promise<SmsSendResult>;
}
