"use client";

import React, { useState } from "react";
import { useI18n } from "@/context/I18nContext";
import { normalizeDigits, normalizeEgyptianPhone } from "@/lib/phone";

interface PhoneInputStepProps {
  initialPhone?: string;
  onSubmit: (phone: string) => Promise<void>;
  isLoading: boolean;
  error?: string | null;
}

function formatInitialPhone(val: string): string {
  if (!val) return "";
  const norm = normalizeEgyptianPhone(val);
  if (norm.success) {
    return "0" + norm.nationalNumber;
  }
  return val;
}

export function PhoneInputStep({
  initialPhone = "",
  onSubmit,
  isLoading,
  error,
}: PhoneInputStepProps) {
  const { t } = useI18n();
  const [phone, setPhone] = useState(() => formatInitialPhone(initialPhone));
  const [clientError, setClientError] = useState<string | null>(null);

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const translated = normalizeDigits(raw);
    setPhone(translated);
    if (clientError) setClientError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setClientError(null);

    const norm = normalizeEgyptianPhone(phone);
    if (!norm.success) {
      setClientError(t("auth.invalidPhone"));
      return;
    }

    await onSubmit(norm.canonicalE164);
  };

  const displayedError = clientError || error;

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      <div>
        <label htmlFor="phone-input" className="block text-sm font-semibold text-slate-800 mb-2">
          {t("auth.phoneLabel")}
        </label>
        <div className="relative flex rounded-xl shadow-sm ring-1 ring-inset ring-slate-300 focus-within:ring-2 focus-within:ring-inset focus-within:ring-brand-600 bg-white">
          <div className="flex items-center px-3.5 border-e border-slate-200 bg-slate-50 text-slate-600 text-sm font-medium rounded-s-xl select-none">
            <span className="me-1.5" aria-hidden="true">
              🇪🇬
            </span>
            <span>+20</span>
          </div>
          <input
            id="phone-input"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            data-testid="phone-input"
            value={phone}
            onChange={handlePhoneChange}
            placeholder={t("auth.phonePlaceholder")}
            disabled={isLoading}
            className="block w-full border-0 bg-transparent py-3 px-3.5 text-slate-900 placeholder:text-slate-400 focus:ring-0 text-base sm:text-sm font-mono tracking-wider"
            aria-describedby={displayedError ? "phone-error" : "phone-hint"}
            aria-invalid={!!displayedError}
          />
        </div>
        <p id="phone-hint" className="mt-2 text-xs text-slate-500">
          {t("auth.phoneHint")}
        </p>
        {displayedError && (
          <p
            id="phone-error"
            role="alert"
            data-testid="phone-error"
            className="mt-2 text-sm text-red-600 font-medium flex items-center gap-1.5"
          >
            <span aria-hidden="true">⚠️</span>
            <span>{displayedError}</span>
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={isLoading || !phone.trim()}
        data-testid="send-otp-button"
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
            <span>{t("auth.sending")}</span>
          </span>
        ) : (
          t("auth.sendCode")
        )}
      </button>
    </form>
  );
}
