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
  private simulatedTimeout = false;
  private simulatedException: Error | null = null;
  private isDeferred = false;
  private ignoreCancellation = false;
  private deferredPromise: {
    resolve: (val: SmsSendResult) => void;
    reject: (err: Error) => void;
  } | null = null;
  private lastSendAborted = false;

  async send(input: SmsSendInput): Promise<SmsSendResult> {
    this.lastSendAborted = false;

    if (input.signal?.aborted) {
      this.lastSendAborted = true;
      return {
        success: false,
        idempotencyKey: input.idempotencyKey,
        status: "failed",
        errorCategory: "GATEWAY_TIMEOUT",
      };
    }

    if (input.signal) {
      input.signal.addEventListener(
        "abort",
        () => {
          this.lastSendAborted = true;
        },
        { once: true }
      );
    }

    if (this.simulatedException) {
      throw this.simulatedException;
    }

    if (this.isDeferred) {
      return new Promise<SmsSendResult>((resolve, reject) => {
        this.deferredPromise = { resolve, reject };
        if (input.signal && !this.ignoreCancellation) {
          input.signal.addEventListener(
            "abort",
            () => {
              this.lastSendAborted = true;
              if (this.deferredPromise) {
                this.deferredPromise.resolve({
                  success: false,
                  idempotencyKey: input.idempotencyKey,
                  status: "failed",
                  errorCategory: "GATEWAY_TIMEOUT",
                });
                this.deferredPromise = null;
              }
            },
            { once: true }
          );
        }
      });
    }

    if (this.simulatedTimeout) {
      // Delay longer than default timeout, but respect AbortSignal
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, (input.timeoutMs ?? 8000) + 100);
        if (input.signal) {
          input.signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true }
          );
        }
      });

      return {
        success: false,
        idempotencyKey: input.idempotencyKey,
        status: "failed",
        errorCategory: "GATEWAY_TIMEOUT",
      };
    }

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

  setSimulateTimeout(enabled: boolean): void {
    this.simulatedTimeout = enabled;
  }

  setSimulateException(err: Error | null): void {
    this.simulatedException = err;
  }

  setDeferred(enabled: boolean, options?: { ignoreCancellation?: boolean }): void {
    this.isDeferred = enabled;
    this.ignoreCancellation = options?.ignoreCancellation ?? false;
    if (!enabled) {
      this.deferredPromise = null;
    }
  }

  resolveDeferred(result?: Partial<SmsSendResult>): void {
    if (this.deferredPromise) {
      const defaultResult: SmsSendResult = {
        success: true,
        idempotencyKey: "deferred-key",
        status: "delivered",
        ...result,
      };
      this.deferredPromise.resolve(defaultResult);
      this.deferredPromise = null;
    }
  }

  rejectDeferred(err: Error): void {
    if (this.deferredPromise) {
      this.deferredPromise.reject(err);
      this.deferredPromise = null;
    }
  }

  wasLastSendAborted(): boolean {
    return this.lastSendAborted;
  }

  clear(): void {
    this.captured = [];
    this.simulatedFailureCategory = null;
    this.simulatedTimeout = false;
    this.simulatedException = null;
    this.isDeferred = false;
    this.ignoreCancellation = false;
    this.deferredPromise = null;
    this.lastSendAborted = false;
  }
}
