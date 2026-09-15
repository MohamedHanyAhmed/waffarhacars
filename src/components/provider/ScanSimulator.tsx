"use client";

import React, { useState } from "react";
import { useDemoState } from "../../context/DemoStateContext";
import { useI18n } from "../../context/I18nContext";
import { formatMoney } from "../../domain/money";
import { QrCode, Search, CheckCircle2, ShieldCheck, AlertCircle, Car, Clock } from "lucide-react";

interface ScanSimulatorProps {
  onCheckInSuccess: () => void;
}

export function ScanSimulator({ onCheckInSuccess }: ScanSimulatorProps) {
  const { currentReservation, checkIn } = useDemoState();
  const { t, locale } = useI18n();
  const isAr = locale === "ar";

  const [inputCode, setInputCode] = useState(currentReservation?.passCode || "WC-7492");
  const [isScanning, setIsScanning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ success?: boolean; message?: string } | null>(null);

  if (!currentReservation) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center text-slate-500 text-xs">
        {isAr ? "لا يوجد حجز محدد لتسجيل الوصول." : "No active reservation selected for check-in."}
      </div>
    );
  }

  const handleSimulateScan = () => {
    setIsScanning(true);
    setTimeout(() => {
      setIsScanning(false);
      setInputCode(currentReservation.passCode);
      setFeedback({
        success: true,
        message: isAr ? "تم مسح البطاقة بنجاح!" : "Pass scanned successfully!",
      });
    }, 800);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputCode.trim().toUpperCase() === currentReservation.passCode.toUpperCase()) {
      setFeedback(null);
    } else {
      setFeedback({
        success: false,
        message: isAr ? "كود البطاقة غير موجود أو غير صالح." : "Invalid pass code.",
      });
    }
  };

  const handleCheckIn = async () => {
    setLoading(true);
    const res = await checkIn("staff-heliopolis-01");
    if (res.code === "SUCCESS") {
      setFeedback({
        success: true,
        message: isAr ? res.messageAr : res.messageEn,
      });
      onCheckInSuccess();
    } else {
      setFeedback({
        success: false,
        message: isAr ? res.messageAr : res.messageEn,
      });
    }
    setLoading(false);
  };

  const isCheckedIn =
    currentReservation.status === "checked_in" || currentReservation.status === "completed";

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs text-start space-y-6">
      {/* Header */}
      <div className="border-b border-slate-100 pb-4">
        <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
          <QrCode className="w-5 h-5 text-brand-600" />
          <span>{t("provider.checkInTitle")}</span>
        </h3>
        <p className="text-xs text-slate-500 mt-1">
          {isAr
            ? "امسح رمز QR الخاص بالعميل أو أدخل كود الحجز للتحقق من نطاق الصيانة والسعر المثبت."
            : "Scan customer QR pass or enter pass code to inspect locked service scope and price."}
        </p>
      </div>

      {/* Lookup Controls */}
      <div className="space-y-3">
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute start-3 top-3.5" />
            <input
              type="text"
              value={inputCode}
              onChange={(e) => setInputCode(e.target.value)}
              placeholder={t("provider.inputPlaceholder")}
              data-testid="provider-pass-code-input"
              className="w-full ps-9 pe-3 py-2.5 rounded-xl border border-slate-300 text-xs font-mono font-bold uppercase tracking-wider focus:outline-none focus:border-brand-500"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold"
          >
            {t("provider.lookupButton")}
          </button>
        </form>

        {/* Scan Simulator Button */}
        <button
          type="button"
          onClick={handleSimulateScan}
          disabled={isScanning}
          className="w-full py-2.5 px-3 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-medium flex items-center justify-center gap-2 transition-colors"
        >
          <QrCode className="w-4 h-4 text-brand-600" />
          <span>{isScanning ? t("provider.simulatingScan") : t("provider.scanPassCta")}</span>
        </button>
      </div>

      {/* Feedback Alert */}
      {feedback && (
        <div
          className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
            feedback.success
              ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
              : "bg-rose-50 text-rose-800 border border-rose-200"
          }`}
        >
          {feedback.success ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* Reservation Details Card (Read-Only) */}
      {currentReservation && (
        <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="text-[10px] uppercase font-bold text-slate-400">
                {isAr ? "كود الحجز" : "Reservation Code"}
              </span>
              <div className="font-mono text-sm font-black text-slate-900">
                {currentReservation.passCode}{" "}
                <span
                  data-testid="provider-reservation-revision"
                  className="text-xs text-slate-500 font-normal"
                >
                  (rev {currentReservation.revision})
                </span>
              </div>
            </div>

            <span
              data-testid="provider-reservation-status"
              className={`px-3 py-1 rounded-full text-xs font-bold border flex items-center gap-1.5 ${
                isCheckedIn
                  ? "bg-amber-50 text-amber-800 border-amber-300"
                  : "bg-blue-50 text-blue-800 border-blue-200"
              }`}
            >
              {isCheckedIn ? (
                <>
                  <Clock className="w-3.5 h-3.5 text-amber-600" />
                  <span>{isAr ? "تم تسجيل الوصول بالمركز" : "Checked In at Center"}</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-blue-600" />
                  <span>{isAr ? "حجز مؤكد" : "Confirmed Reservation"}</span>
                </>
              )}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="p-3 bg-white rounded-xl border border-slate-200/70">
              <span className="text-slate-400 block mb-0.5">{isAr ? "السيارة" : "Vehicle"}</span>
              <span className="font-bold text-slate-900 flex items-center gap-1.5">
                <Car className="w-4 h-4 text-slate-500" />
                <span>
                  {currentReservation.vehicle.year} {currentReservation.vehicle.make}{" "}
                  {currentReservation.vehicle.model}
                </span>
              </span>
            </div>

            <div className="p-3 bg-white rounded-xl border border-slate-200/70">
              <span className="text-slate-400 block mb-0.5">{isAr ? "العميل" : "Customer"}</span>
              <span className="font-bold text-slate-900">
                {currentReservation.customerName}{" "}
                <span className="font-mono text-slate-500 text-[11px]">
                  ({currentReservation.customerPhoneMasked})
                </span>
              </span>
            </div>
          </div>

          {/* Locked Service Scope (Strictly Read-Only) */}
          <div
            data-testid="provider-agreed-scope"
            className="p-3.5 bg-white rounded-xl border border-slate-200/70 space-y-3 text-xs"
          >
            <div className="flex items-center justify-between">
              <span className="text-slate-400 font-medium">
                {isAr
                  ? "نطاق الصيانة المتفق عليه (للقراءة فقط):"
                  : "Agreed Service Scope (Read-Only):"}
              </span>
              <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono font-bold">
                LOCKED
              </span>
            </div>

            <h4 className="font-bold text-slate-900 text-sm">
              {isAr
                ? currentReservation.offerSnapshot.titleAr
                : currentReservation.offerSnapshot.titleEn}
            </h4>

            {/* Inclusions */}
            <div className="space-y-1">
              <span className="font-bold text-emerald-800 block text-[11px]">
                {t("offer.inclusionsTitle")}:
              </span>
              <ul className="text-[11px] text-slate-600 space-y-1">
                {(isAr
                  ? currentReservation.offerSnapshot.inclusionsAr
                  : currentReservation.offerSnapshot.inclusionsEn
                ).map((item, idx) => (
                  <li key={idx} className="flex items-start gap-1.5">
                    <span className="text-emerald-600 font-bold">✓</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Exclusions */}
            <div className="space-y-1 pt-2 border-t border-slate-100">
              <span className="font-bold text-amber-800 block text-[11px]">
                {t("offer.exclusionsTitle")}:
              </span>
              <ul className="text-[11px] text-slate-600 space-y-1">
                {(isAr
                  ? currentReservation.offerSnapshot.exclusionsAr
                  : currentReservation.offerSnapshot.exclusionsEn
                ).map((item, idx) => (
                  <li key={idx} className="flex items-start gap-1.5">
                    <span className="text-amber-600 font-bold">✕</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Parts & Fluid Specifications */}
            <div className="space-y-1 pt-2 border-t border-slate-100">
              <span className="font-bold text-slate-800 block text-[11px]">
                {t("provider.partsSpecTitle")}:
              </span>
              <p className="text-[11px] text-slate-600 bg-slate-50 p-2 rounded-lg border border-slate-200">
                {isAr
                  ? currentReservation.offerSnapshot.partsSpecificationAr
                  : currentReservation.offerSnapshot.partsSpecificationEn}
              </p>
            </div>

            {/* Mandatory Additional Work Rule */}
            <div className="space-y-1 pt-2 border-t border-slate-100">
              <span className="font-bold text-slate-800 block text-[11px]">
                {t("provider.additionalWorkRuleTitle")}:
              </span>
              <p className="text-[11px] text-amber-900 bg-amber-50/70 p-2 rounded-lg border border-amber-200 leading-relaxed">
                {isAr
                  ? currentReservation.offerSnapshot.additionalWorkRuleAr
                  : currentReservation.offerSnapshot.additionalWorkRuleEn}
              </p>
            </div>

            <div className="pt-2 border-t border-slate-100 text-[11px] font-semibold text-slate-700">
              {t("provider.lockedPriceNotice", {
                price: formatMoney(currentReservation.pricingSnapshot.lockedPrice, locale),
              })}
            </div>
          </div>

          {/* Check-In Action Button */}
          {!isCheckedIn ? (
            <div className="space-y-2 pt-2">
              <button
                onClick={handleCheckIn}
                disabled={loading}
                className="w-full py-3 px-4 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shadow-xs transition-colors flex items-center justify-center gap-2"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>{loading ? "..." : t("provider.checkInCta")}</span>
              </button>
              <p className="text-[11px] text-slate-500 text-center">
                {t("provider.checkInNeutrality")}
              </p>
            </div>
          ) : (
            <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2 font-semibold">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>{t("provider.checkInDone")}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
