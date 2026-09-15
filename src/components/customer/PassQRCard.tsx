"use client";

import React, { useState } from "react";
import { Reservation } from "../../domain/types";
import { useI18n } from "../../context/I18nContext";
import { useDemoState } from "../../context/DemoStateContext";
import { Copy, Check, KeyRound, ShieldCheck, Clock } from "lucide-react";

interface PassQRCardProps {
  reservation: Reservation;
}

export function PassQRCard({ reservation }: PassQRCardProps) {
  const { revealPin } = useDemoState();
  const { t, locale } = useI18n();
  const [copied, setCopied] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const isAr = locale === "ar";

  const handleCopyCode = () => {
    navigator.clipboard.writeText(reservation.passCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReveal = async () => {
    setRevealing(true);
    await revealPin();
    setRevealing(false);
  };

  const isCheckedIn = reservation.status === "checked_in";
  const isCompleted = reservation.status === "completed";
  const pinDetails = reservation.completionPinDetails;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col items-center text-center space-y-4">
      {/* Title */}
      <div>
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
          {t("pass.qrTitle")}
        </span>
        <h3 className="font-extrabold text-base text-slate-900 mt-0.5">
          {isAr ? "أظهر هذا الرمز عند الوصول للمركز" : "Present this code upon arrival"}
        </h3>
      </div>

      {/* Synthetic Mock QR Matrix (Zero PII SVG pattern) */}
      <div className="relative p-4 bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl flex flex-col items-center">
        <svg
          viewBox="0 0 160 160"
          className="w-40 h-40 text-slate-900"
          fill="currentColor"
          role="img"
          aria-label="Mock QR Code"
        >
          {/* Top-left position marker */}
          <rect x="10" y="10" width="40" height="40" rx="6" fill="#0f172a" />
          <rect x="18" y="18" width="24" height="24" rx="3" fill="#f8fafc" />
          <rect x="24" y="24" width="12" height="12" rx="2" fill="#0f172a" />

          {/* Top-right position marker */}
          <rect x="110" y="10" width="40" height="40" rx="6" fill="#0f172a" />
          <rect x="118" y="18" width="24" height="24" rx="3" fill="#f8fafc" />
          <rect x="124" y="24" width="12" height="12" rx="2" fill="#0f172a" />

          {/* Bottom-left position marker */}
          <rect x="10" y="110" width="40" height="40" rx="6" fill="#0f172a" />
          <rect x="18" y="118" width="24" height="24" rx="3" fill="#f8fafc" />
          <rect x="24" y="124" width="12" height="12" rx="2" fill="#0f172a" />

          {/* Synthetic data matrix dots */}
          <rect x="60" y="20" width="8" height="8" fill="#0f172a" />
          <rect x="75" y="20" width="8" height="8" fill="#0f172a" />
          <rect x="90" y="30" width="8" height="8" fill="#0f172a" />
          <rect x="60" y="45" width="8" height="8" fill="#0f172a" />
          <rect x="80" y="55" width="8" height="8" fill="#0f172a" />
          <rect x="25" y="65" width="8" height="8" fill="#0f172a" />
          <rect x="40" y="75" width="8" height="8" fill="#0f172a" />
          <rect x="60" y="70" width="12" height="12" fill="#0284c7" />
          <rect x="80" y="80" width="8" height="8" fill="#0f172a" />
          <rect x="100" y="70" width="8" height="8" fill="#0f172a" />
          <rect x="125" y="65" width="8" height="8" fill="#0f172a" />
          <rect x="140" y="80" width="8" height="8" fill="#0f172a" />
          <rect x="60" y="105" width="8" height="8" fill="#0f172a" />
          <rect x="80" y="115" width="8" height="8" fill="#0f172a" />
          <rect x="100" y="105" width="8" height="8" fill="#0f172a" />
          <rect x="120" y="120" width="8" height="8" fill="#0f172a" />
          <rect x="135" y="135" width="8" height="8" fill="#0f172a" />
        </svg>

        <span className="mt-2 text-[10px] text-slate-400 font-mono tracking-tight">
          SHA-256 Verified Synthetic Token
        </span>
      </div>

      {/* Alphanumeric Fallback Code & Copy */}
      <div className="w-full flex flex-col items-center gap-2">
        <span className="text-xs text-slate-500 font-medium">{t("pass.codeFallback")}</span>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xl font-extrabold tracking-widest bg-slate-100 text-slate-900 px-4 py-2 rounded-xl border border-slate-200">
            {reservation.passCode}
          </span>
          <button
            onClick={handleCopyCode}
            aria-label="Copy pass code"
            className="p-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors flex items-center gap-1 text-xs font-semibold"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                <span className="text-emerald-700">{isAr ? "تم النسخ" : "Copied"}</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>{isAr ? "نسخ" : "Copy"}</span>
              </>
            )}
          </button>
        </div>

        {/* Dynamic PIN Lifecycle Box */}
        <div className="w-full max-w-xs rounded-xl p-3.5 text-start mt-2 border transition-all">
          {isCompleted ? (
            <div className="bg-slate-50 border-slate-200 text-slate-600 p-1">
              <div className="flex items-center gap-2 font-bold text-xs text-slate-800 mb-1">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{isAr ? "تم تأكيد إتمام الخدمة" : "Service Mutually Confirmed"}</span>
              </div>
              <p className="text-[11px] text-slate-500">
                {isAr
                  ? "تم استهلاك رمز PIN بنجاح وتسجيل استحقاق العمولة."
                  : "Completion PIN was consumed successfully. Receivable recorded."}
              </p>
            </div>
          ) : isCheckedIn ? (
            pinDetails?.isIssued ? (
              <div className="bg-amber-50 border-amber-200 text-amber-900">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5 font-bold text-xs text-amber-800">
                    <KeyRound className="w-4 h-4 text-amber-600" />
                    <span>{isAr ? "رمز إتمام الخدمة (PIN):" : "Completion PIN:"}</span>
                  </div>
                  <span className="font-mono text-base font-extrabold px-2 py-0.5 bg-amber-200/80 rounded-lg text-amber-950">
                    {pinDetails.pin}
                  </span>
                </div>
                <p className="text-[11px] text-amber-700 leading-relaxed">
                  {isAr
                    ? "أملِ هذا الرمز لفني الورشة فقط بعد دفع المبلغ المثبت واستلام سيارتك."
                    : "Read this PIN to provider staff only after paying locked price and receiving your car."}
                </p>
              </div>
            ) : (
              <div className="bg-blue-50 border-blue-200 p-2 rounded-lg">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <span className="font-bold text-xs text-blue-900 block">
                      {isAr ? "تم تسجيل الوصول بالورشة" : "Arrived at Workshop"}
                    </span>
                    <span className="text-[11px] text-blue-700 block">
                      {isAr
                        ? "أظهر رمز PIN لإتمام الخدمة بعد الفحص"
                        : "Reveal PIN to complete service"}
                    </span>
                  </div>
                  <button
                    onClick={handleReveal}
                    disabled={revealing}
                    data-testid="reveal-pin-button"
                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shrink-0 flex items-center gap-1"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    <span>{isAr ? "إظهار PIN" : "Reveal PIN"}</span>
                  </button>
                </div>
              </div>
            )
          ) : (
            <div className="bg-slate-50 border-slate-200 text-slate-600 p-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 mb-1">
                <Clock className="w-4 h-4 text-slate-400" />
                <span>{isAr ? "رمز PIN يصدر عند الوصول" : "PIN Issued Upon Arrival"}</span>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                {isAr
                  ? "لأمانك، سيتاح رمز PIN للتأكيد بعد تسجيل فني المركز حضورك."
                  : "For security, your 4-digit confirmation PIN will unlock once workshop staff checks you in."}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
