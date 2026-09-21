"use client";

import React, { useState, useRef, useEffect } from "react";
import { useI18n } from "@/context/I18nContext";
import { formatMaskedPhone, normalizeDigits } from "@/lib/phone";
import { ResendCountdown } from "./ResendCountdown";

interface OtpInputStepProps {
  canonicalPhone: string;
  onVerify: (code: string) => Promise<void>;
  onResend: () => Promise<void>;
  onEditPhone: () => void;
  isLoading: boolean;
  isResending: boolean;
  error?: string | null;
  cooldownSeconds: number;
}

export function OtpInputStep({
  canonicalPhone,
  onVerify,
  onResend,
  onEditPhone,
  isLoading,
  isResending,
  error,
  cooldownSeconds,
}: OtpInputStepProps) {
  const { t } = useI18n();
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [countdown, setCountdown] = useState(cooldownSeconds);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Countdown interval effect
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  const handleResendClick = async () => {
    await onResend();
    setCountdown(cooldownSeconds);
  };

  // Focus first input on mount
  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  const handleChange = (index: number, value: string) => {
    const translated = normalizeDigits(value);
    const cleaned = translated.replace(/\D/g, "");

    if (cleaned.length > 1) {
      // Pasting into an input
      handlePaste(cleaned);
      return;
    }

    const newDigits = [...digits];
    newDigits[index] = cleaned;
    setDigits(newDigits);

    // Auto-advance
    if (cleaned && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (pastedText: string) => {
    const translated = normalizeDigits(pastedText);
    const code = translated.replace(/\D/g, "").slice(0, 6);
    if (!code) return;

    const newDigits = [...digits];
    for (let i = 0; i < 6; i++) {
      newDigits[i] = code[i] || "";
    }
    setDigits(newDigits);

    // Focus last filled or first empty
    const nextIdx = Math.min(code.length, 5);
    inputRefs.current[nextIdx]?.focus();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = digits.join("");
    if (code.length !== 6) return;
    await onVerify(code);
  };

  const isComplete = digits.every((d) => d.length === 1);
  const maskedPhone = formatMaskedPhone(canonicalPhone);

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      <div className="text-center">
        <p className="text-sm text-slate-600 mb-1">{t("auth.otpSubtitle")}</p>
        <div className="inline-flex items-center gap-2 bg-slate-100 py-1 px-3 rounded-full">
          <span
            className="font-mono font-semibold text-slate-800 text-sm"
            data-testid="masked-phone"
          >
            {maskedPhone}
          </span>
          <button
            type="button"
            onClick={onEditPhone}
            data-testid="edit-phone-button"
            className="text-xs text-brand-600 hover:text-brand-700 font-medium underline underline-offset-2 focus:outline-none"
          >
            {t("auth.editPhone")}
          </button>
        </div>
      </div>

      <div>
        <label className="sr-only">{t("auth.otpTitle")}</label>
        <div className="flex justify-center gap-2 sm:gap-3" dir="ltr">
          {digits.map((digit, idx) => (
            <input
              key={idx}
              ref={(el) => {
                inputRefs.current[idx] = el;
              }}
              type="text"
              inputMode="numeric"
              autoComplete={idx === 0 ? "one-time-code" : "off"}
              maxLength={1}
              data-testid={`otp-box-${idx}`}
              value={digit}
              onChange={(e) => handleChange(idx, e.target.value)}
              onKeyDown={(e) => handleKeyDown(idx, e)}
              onPaste={(e) => {
                e.preventDefault();
                handlePaste(e.clipboardData.getData("text"));
              }}
              disabled={isLoading}
              className="w-11 h-13 sm:w-12 sm:h-14 text-center text-xl font-bold font-mono text-slate-900 bg-white border border-slate-300 rounded-xl shadow-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500 disabled:opacity-50 transition-all"
            />
          ))}
        </div>

        {error && (
          <p
            role="alert"
            data-testid="otp-error"
            className="mt-4 text-center text-sm text-red-600 font-medium flex items-center justify-center gap-1.5"
          >
            <span aria-hidden="true">⚠️</span>
            <span>{error}</span>
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={isLoading || !isComplete}
        data-testid="verify-otp-button"
        className="w-full flex items-center justify-center py-3 px-4 border border-transparent rounded-xl shadow-sm text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150"
      >
        {isLoading ? (
          <span className="flex items-center gap-2">
            <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            <span>{t("auth.verifying")}</span>
          </span>
        ) : (
          t("auth.verifyCode")
        )}
      </button>

      <ResendCountdown
        secondsLeft={countdown}
        onResend={handleResendClick}
        isResending={isResending}
      />
    </form>
  );
}
