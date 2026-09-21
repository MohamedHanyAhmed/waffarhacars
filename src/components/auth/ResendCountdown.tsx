"use client";

import React from "react";
import { useI18n } from "@/context/I18nContext";

interface ResendCountdownProps {
  secondsLeft: number;
  onResend: () => void;
  isResending: boolean;
}

export function ResendCountdown({ secondsLeft, onResend, isResending }: ResendCountdownProps) {
  const { t } = useI18n();

  return (
    <div className="flex flex-col sm:flex-row items-center justify-center gap-2 text-sm text-slate-600 mt-4">
      <span>{t("auth.resendPrompt")}</span>
      {secondsLeft > 0 ? (
        <span
          className="font-medium text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full text-xs"
          data-testid="countdown-timer"
        >
          {t("auth.resendIn", { seconds: secondsLeft })}
        </span>
      ) : (
        <button
          type="button"
          onClick={onResend}
          disabled={isResending}
          data-testid="resend-button"
          className="text-brand-600 hover:text-brand-700 font-semibold underline underline-offset-4 disabled:opacity-50 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 rounded"
        >
          {isResending ? t("auth.sending") : t("auth.resendNow")}
        </button>
      )}
    </div>
  );
}
