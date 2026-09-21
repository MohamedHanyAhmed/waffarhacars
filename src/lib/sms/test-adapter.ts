import type { SmsAdapter, SmsSendInput, SmsSendResult, SmsErrorCategory } from "./types";

export interface CapturedSms {
  toCanonicalE164: string;
  message: string;
  idempotencyKey: string;
  timestamp: Date;
  otpCode?: string;
}

interface DeferredDispatchHandle {
  idempotencyKey: string;
  resolve: (val: SmsSendResult) => void;
  reject: (err: Error) => void;
  input: SmsSendInput;
  ignoreCancellation: boolean;
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
  private defaultIgnoreCancellation = false;
  private deferNextCount = 0;
  private deferNextOptions: { ignoreCancellation?: boolean } | null = null;
  private deferredDispatches = new Map<string, DeferredDispatchHandle>();
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

    const shouldDefer = this.isDeferred || this.deferNextCount > 0;
    const ignoreCancellation =
      this.deferNextCount > 0
        ? (this.deferNextOptions?.ignoreCancellation ?? false)
        : this.defaultIgnoreCancellation;

    if (this.deferNextCount > 0) {
      this.deferNextCount--;
      if (this.deferNextCount === 0) {
        this.deferNextOptions = null;
      }
    }

    if (shouldDefer) {
      return new Promise<SmsSendResult>((resolve, reject) => {
        const handle: DeferredDispatchHandle = {
          idempotencyKey: input.idempotencyKey,
          resolve,
          reject,
          input,
          ignoreCancellation,
        };
        this.deferredDispatches.set(input.idempotencyKey, handle);

        if (input.signal && !ignoreCancellation) {
          input.signal.addEventListener(
            "abort",
            () => {
              this.lastSendAborted = true;
              const current = this.deferredDispatches.get(input.idempotencyKey);
              if (current) {
                this.deferredDispatches.delete(input.idempotencyKey);
                current.resolve({
                  success: false,
                  idempotencyKey: input.idempotencyKey,
                  status: "failed",
                  errorCategory: "GATEWAY_TIMEOUT",
                });
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

  deferNextSend(options?: { ignoreCancellation?: boolean }): void {
    this.deferNextCount = 1;
    this.deferNextOptions = options ?? null;
  }

  setDeferred(enabled: boolean, options?: { ignoreCancellation?: boolean }): void {
    this.isDeferred = enabled;
    this.defaultIgnoreCancellation = options?.ignoreCancellation ?? false;
    // Note: Existing in-flight deferredDispatches are preserved so subsequent resolveDispatch works!
  }

  resolveDispatch(idempotencyKey: string, result?: Partial<SmsSendResult>): boolean {
    const handle = this.deferredDispatches.get(idempotencyKey);
    if (!handle) {
      return false;
    }
    this.deferredDispatches.delete(idempotencyKey);

    const match = handle.input.message.match(/\b(\d{6})\b/);
    const otpCode = match ? match[1] : undefined;

    this.captured.push({
      toCanonicalE164: handle.input.toCanonicalE164,
      message: handle.input.message,
      idempotencyKey: handle.input.idempotencyKey,
      timestamp: new Date(),
      otpCode,
    });

    const defaultResult: SmsSendResult = {
      success: true,
      providerMessageId: `deferred-msg-${this.captured.length}`,
      idempotencyKey: handle.idempotencyKey,
      status: "delivered",
      ...result,
    };
    handle.resolve(defaultResult);
    return true;
  }

  rejectDispatch(idempotencyKey: string, error: Error): boolean {
    const handle = this.deferredDispatches.get(idempotencyKey);
    if (!handle) {
      return false;
    }
    this.deferredDispatches.delete(idempotencyKey);
    handle.reject(error);
    return true;
  }

  hasDeferredDispatch(idempotencyKey: string): boolean {
    return this.deferredDispatches.has(idempotencyKey);
  }

  resolveDeferred(result?: Partial<SmsSendResult>): boolean {
    const entries = Array.from(this.deferredDispatches.entries());
    if (entries.length === 0) {
      return false;
    }
    for (const [key] of entries) {
      this.resolveDispatch(key, result);
    }
    return true;
  }

  rejectDeferred(err: Error): boolean {
    const entries = Array.from(this.deferredDispatches.entries());
    if (entries.length === 0) {
      return false;
    }
    for (const [key] of entries) {
      this.rejectDispatch(key, err);
    }
    return true;
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
    this.defaultIgnoreCancellation = false;
    this.deferNextCount = 0;
    this.deferNextOptions = null;
    this.deferredDispatches.clear();
    this.lastSendAborted = false;
  }
}
