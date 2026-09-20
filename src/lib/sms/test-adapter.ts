import type { SmsAdapter, SmsSendInput, SmsSendResult, SmsErrorCategory } from "./types";

export interface CapturedSms {
  toCanonicalE164: string;
  message: string;
  idempotencyKey: string;
  timestamp: Date;
  otpCode?: string;
}

/**
 * Deterministic in-memory test capture SMS adapter.
 * Used exclusively in automated tests. Never sends real network requests.
 */
export class TestSmsAdapter implements SmsAdapter {
  readonly providerId = "test";
  private captured: CapturedSms[] = [];
  private simulatedFailureCategory: SmsErrorCategory | null = null;

  async send(input: SmsSendInput): Promise<SmsSendResult> {
    if (this.simulatedFailureCategory) {
      return {
        success: false,
        idempotencyKey: input.idempotencyKey,
        status: "failed",
        errorCategory: this.simulatedFailureCategory,
      };
    }

    // Extract 6-digit OTP code from message body if present
    const match = input.message.match(/\b(\d{6})\b/);
    const otpCode = match ? match[1] : undefined;

    this.captured.push({
      toCanonicalE164: input.toCanonicalE164,
      message: input.message,
      idempotencyKey: input.idempotencyKey,
      timestamp: new Date(),
      otpCode,
    });

    return {
      success: true,
      providerMessageId: `test-msg-${this.captured.length}`,
      idempotencyKey: input.idempotencyKey,
      status: "delivered",
    };
  }

  getCapturedMessages(): readonly CapturedSms[] {
    return [...this.captured];
  }

  getLastOtp(toCanonicalE164?: string): string | undefined {
    if (toCanonicalE164) {
      const msgs = this.captured.filter((m) => m.toCanonicalE164 === toCanonicalE164);
      return msgs[msgs.length - 1]?.otpCode;
    }
    return this.captured[this.captured.length - 1]?.otpCode;
  }

  simulateFailure(category: SmsErrorCategory | null): void {
    this.simulatedFailureCategory = category;
  }

  clear(): void {
    this.captured = [];
    this.simulatedFailureCategory = null;
  }
}
