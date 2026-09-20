"use client";

import React, { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/context/I18nContext";
import { PhoneInputStep } from "./PhoneInputStep";
import { OtpInputStep } from "./OtpInputStep";

type Step = "phone" | "otp";

export function CustomerLoginForm() {
  const { t, dir } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnUrl = searchParams.get("returnUrl") || "/";

  const [step, setStep] = useState<Step>("phone");
  const [canonicalPhone, setCanonicalPhone] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isResending, setIsResending] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState<number>(60);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Step 1: Submit Phone Number
  const handleRequestOtp = async (phoneE164: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/v1/auth/phone/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phoneE164 }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 429) {
          const retryAfter = res.headers.get("Retry-After");
          if (retryAfter) {
            setCooldownSeconds(parseInt(retryAfter, 10));
          }
          setError(data.detail || t("auth.rateLimitError"));
        } else {
          setError(data.detail || t("auth.invalidPhone"));
        }
        setIsLoading(false);
        return;
      }

      setCanonicalPhone(phoneE164);
      setCooldownSeconds(60);
      setStep("otp");
    } catch {
      setError(t("auth.rateLimitError"));
    } finally {
      setIsLoading(false);
    }
  };

  // Step 2: Verify OTP
  const handleVerifyOtp = async (code: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/v1/auth/phone/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: canonicalPhone,
          code,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.detail || t("auth.invalidOtp"));
        setIsLoading(false);
        return;
      }

      setSuccessMessage(t("auth.verificationSuccess"));
      // Short delay to allow user to see success state, then redirect
      setTimeout(() => {
        router.push(returnUrl);
        router.refresh();
      }, 500);
    } catch {
      setError(t("auth.invalidOtp"));
      setIsLoading(false);
    }
  };

  // Resend OTP
  const handleResendOtp = async () => {
    setIsResending(true);
    setError(null);

    try {
      const res = await fetch("/api/v1/auth/phone/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: canonicalPhone }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 429) {
          const retryAfter = res.headers.get("Retry-After");
          if (retryAfter) {
            setCooldownSeconds(parseInt(retryAfter, 10));
          }
          setError(data.detail || t("auth.rateLimitError"));
        } else {
          setError(data.detail || t("auth.invalidPhone"));
        }
        setIsResending(false);
        return;
      }

      setCooldownSeconds(60);
    } catch {
      setError(t("auth.rateLimitError"));
    } finally {
      setIsResending(false);
    }
  };

  return (
    <div
      dir={dir}
      className="w-full max-w-md mx-auto bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100 p-6 sm:p-8"
      data-testid="customer-login-card"
    >
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          {step === "phone" ? t("auth.loginTitle") : t("auth.otpTitle")}
        </h1>
        {step === "phone" && (
          <p className="mt-2 text-sm text-slate-600">{t("auth.loginSubtitle")}</p>
        )}
      </div>

      {successMessage && (
        <div
          role="status"
          data-testid="auth-success-message"
          className="mb-6 p-4 rounded-xl bg-green-50 border border-green-200 text-green-800 text-sm font-medium text-center flex items-center justify-center gap-2"
        >
          <span>✓</span>
          <span>{successMessage}</span>
        </div>
      )}

      {step === "phone" ? (
        <PhoneInputStep
          initialPhone={canonicalPhone}
          onSubmit={handleRequestOtp}
          isLoading={isLoading}
          error={error}
        />
      ) : (
        <OtpInputStep
          canonicalPhone={canonicalPhone}
          onVerify={handleVerifyOtp}
          onResend={handleResendOtp}
          onEditPhone={() => {
            setStep("phone");
            setError(null);
          }}
          isLoading={isLoading}
          isResending={isResending}
          error={error}
          cooldownSeconds={cooldownSeconds}
        />
      )}
    </div>
  );
}
