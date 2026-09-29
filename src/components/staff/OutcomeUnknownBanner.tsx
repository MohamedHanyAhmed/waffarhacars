"use client";

import React from "react";
import { useI18n } from "@/context/I18nContext";
import { AlertTriangle, RefreshCw, Loader2, RotateCcw } from "lucide-react";

export interface OutcomeUnknownBannerProps {
  isOpen: boolean;
  message?: string | null;
  isRechecking?: boolean;
  canRetry?: boolean;
  onRecheck: () => Promise<void> | void;
  onRetry?: () => void;
}

export function OutcomeUnknownBanner({
  isOpen,
  message,
  isRechecking = false,
  canRetry = false,
  onRecheck,
  onRetry,
}: OutcomeUnknownBannerProps) {
  const { t, dir } = useI18n();

  if (!isOpen) return null;

  return (
    <div
      role="alert"
      data-testid="outcome-unknown-banner"
      dir={dir}
      className="p-4 bg-amber-50 border border-amber-300 rounded-2xl space-y-3 text-amber-950 text-xs shadow-xs"
    >
      <div className="flex items-start gap-3">
        <div className="p-1.5 bg-amber-100 rounded-xl text-amber-700 shrink-0 mt-0.5">
          <AlertTriangle className="w-5 h-5" />
        </div>
        <div className="space-y-1">
          <h4 className="font-bold text-sm text-amber-900">
            {t("onboarding.uncertainty.outcomeUnknownTitle")}
          </h4>
          <p className="leading-relaxed text-amber-800">
            {message || t("onboarding.uncertainty.outcomeUnknownDesc")}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-amber-200/60">
        <button
          type="button"
          data-testid="recheck-status-btn"
          onClick={onRecheck}
          disabled={isRechecking}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-semibold rounded-xl text-xs shadow-xs transition-colors"
        >
          {isRechecking ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>{t("onboarding.uncertainty.rechecking")}</span>
            </>
          ) : (
            <>
              <RefreshCw className="w-3.5 h-3.5" />
              <span>{t("onboarding.uncertainty.recheckStatus")}</span>
            </>
          )}
        </button>

        {canRetry && onRetry && (
          <button
            type="button"
            data-testid="deliberate-retry-btn"
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-amber-100/70 border border-amber-300 text-amber-900 font-semibold rounded-xl text-xs transition-colors shadow-xs"
          >
            <RotateCcw className="w-3.5 h-3.5 text-amber-700" />
            <span>{t("onboarding.uncertainty.retryNow")}</span>
          </button>
        )}
      </div>
    </div>
  );
}
