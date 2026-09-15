"use client";

import React, { useState } from "react";
import { useDemoState } from "../../context/DemoStateContext";
import { useI18n } from "../../context/I18nContext";
import { formatMoney, sumCommissionAccruals } from "../../domain/money";
import { KeyRound, CheckCircle2, AlertCircle, ShieldCheck, RefreshCw } from "lucide-react";

interface PinPadProps {
  onCompletionSuccess?: () => void;
}

export function PinPad({ onCompletionSuccess }: PinPadProps) {
  const { currentReservation, completeService, commissionAccruals } = useDemoState();
  const { t, locale } = useI18n();

  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    code: string;
    message: string;
  } | null>(null);

  if (!currentReservation) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center text-slate-500 text-xs">
        {t("provider.scanOrEnter")}
      </div>
    );
  }

  const isCompleted = currentReservation.status === "completed";
  const pinDetails = currentReservation.completionPinDetails;
  const isAr = locale === "ar";

  // Authoritatively derive total commission from ledger accruals using production domain helper
  const totalCommission = sumCommissionAccruals(commissionAccruals);
  const totalCommissionFormatted = formatMoney(totalCommission, locale);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const res = await completeService(pin);
    const isSuccess = res.code === "SUCCESS";
    setResult({
      success: isSuccess,
      code: res.code,
      message: isAr ? res.messageAr : res.messageEn,
    });
    setLoading(false);
    if (isSuccess && onCompletionSuccess) {
      onCompletionSuccess();
    }
  };

  const handleTestDuplicate = async () => {
    setLoading(true);
    // Submit with previous/stale revision or against completed state to demonstrate CAS guard
    const res = await completeService(pinDetails?.pin || "4921");
    setResult({
      success: false,
      code: res.code,
      message: isAr ? res.messageAr : res.messageEn,
    });
    setLoading(false);
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5 shadow-xs text-start">
      <div className="border-b border-slate-100 pb-3">
        <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
          <KeyRound className="w-5 h-5 text-brand-600" />
          <span>{t("provider.completeTitle")}</span>
        </h3>
        <p className="text-xs text-slate-500 mt-1">
          {t("provider.pinExplanatoryNotice", {
            price: formatMoney(currentReservation.pricingSnapshot.lockedPrice, locale),
          })}
        </p>
      </div>

      {/* Already Completed Prominent Display */}
      {isCompleted && (
        <div
          data-testid="provider-already-completed-card"
          className="p-4 rounded-2xl bg-blue-50 border border-blue-200 text-xs space-y-2 text-blue-900"
        >
          <div className="flex items-center gap-2 font-bold text-sm">
            <RefreshCw className="w-5 h-5 text-blue-600 shrink-0" />
            <span>{t("provider.alreadyCompletedTitle")}</span>
          </div>
          <p className="text-blue-800 leading-relaxed">
            {t("provider.alreadyCompletedDesc", {
              time: currentReservation.completionTimestamp
                ? currentReservation.completionTimestamp.replace("T", " ").substring(0, 16)
                : "2026-09-13 12:00",
              commission: totalCommissionFormatted,
            })}
          </p>
          <div className="pt-2">
            <button
              type="button"
              onClick={handleTestDuplicate}
              disabled={loading}
              data-testid="simulate-duplicate-button"
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-xs flex items-center gap-2"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>{loading ? "..." : t("provider.simulateDuplicateCta")}</span>
            </button>
          </div>
        </div>
      )}

      {/* PIN Entry Form */}
      {!isCompleted && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              {t("provider.pinPrompt")}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                maxLength={4}
                value={pin}
                disabled={loading}
                onChange={(e) => setPin(e.target.value)}
                placeholder={t("provider.pinPlaceholder")}
                data-testid="provider-pin-input"
                className="flex-1 text-center font-mono text-xl tracking-widest px-4 py-3 rounded-xl border-2 border-slate-300 focus:border-brand-500 focus:outline-none"
              />
              {pinDetails?.isIssued && !pinDetails.isConsumed && (
                <button
                  type="button"
                  onClick={() => setPin(pinDetails.pin)}
                  data-testid="autofill-pin-button"
                  className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold"
                  title={t("provider.autofillTitle")}
                >
                  {t("provider.autofillPin", { pin: pinDetails.pin })}
                </button>
              )}
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || pin.trim().length === 0}
            data-testid="confirm-complete-button"
            className={`w-full py-3 px-4 rounded-xl text-white font-bold text-xs shadow-xs transition-colors flex items-center justify-center gap-2 ${
              pin.trim().length > 0 && !loading
                ? "bg-emerald-600 hover:bg-emerald-700"
                : "bg-slate-300 cursor-not-allowed"
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>{loading ? "..." : t("provider.confirmCompleteCta")}</span>
          </button>
        </form>
      )}

      {/* Result / Idempotency Feedback */}
      {result && (
        <div
          data-testid="completion-result-banner"
          className={`p-4 rounded-xl border text-xs space-y-1.5 ${
            result.code === "SUCCESS"
              ? "bg-emerald-50 border-emerald-300 text-emerald-900"
              : result.code === "ALREADY_COMPLETED"
                ? "bg-blue-50 border-blue-300 text-blue-900"
                : "bg-rose-50 border-rose-300 text-rose-900"
          }`}
        >
          <div className="flex items-center gap-2 font-bold">
            {result.code === "SUCCESS" && <ShieldCheck className="w-4 h-4 text-emerald-600" />}
            {result.code === "ALREADY_COMPLETED" && <RefreshCw className="w-4 h-4 text-blue-600" />}
            {result.code !== "SUCCESS" && result.code !== "ALREADY_COMPLETED" && (
              <AlertCircle className="w-4 h-4 text-rose-600" />
            )}
            <span data-testid="completion-result-title">
              {result.code === "SUCCESS"
                ? t("provider.successRecordedTitle")
                : result.code === "ALREADY_COMPLETED"
                  ? t("provider.idempotentGuardTitle")
                  : t("provider.completionFailedTitle")}
            </span>
          </div>
          <p data-testid="completion-result-message" className="leading-relaxed">
            {result.message}
          </p>
        </div>
      )}

      {/* Current Commission Status */}
      <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1">
        <div className="flex justify-between text-slate-600">
          <span>{t("provider.reservationStatusLabel")}</span>
          <span
            data-testid="provider-completion-status"
            className="font-bold uppercase text-slate-900"
          >
            {currentReservation.status} (rev {currentReservation.revision})
          </span>
        </div>
        <div className="flex justify-between text-slate-600">
          <span>{t("provider.commissionCountLabel")}</span>
          <span data-testid="provider-completion-accruals" className="font-bold text-emerald-700">
            {t("provider.accrualRecordFormat", {
              count: commissionAccruals.length,
              amount: totalCommissionFormatted,
            })}
          </span>
        </div>
      </div>
    </div>
  );
}
