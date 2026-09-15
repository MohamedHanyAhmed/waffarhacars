"use client";

import React from "react";
import Link from "next/link";
import { useDemoState } from "../../../context/DemoStateContext";
import { useI18n } from "../../../context/I18nContext";
import { ScanSimulator } from "../../../components/provider/ScanSimulator";
import { formatMoney, sumCommissionAccruals } from "../../../domain/money";
import { Wrench, CheckCircle2, ArrowRight, ArrowLeft, KeyRound } from "lucide-react";

export default function ProviderCheckInPage() {
  const { currentReservation, commissionAccruals } = useDemoState();
  const { t, locale, dir } = useI18n();
  const isAr = locale === "ar";

  const isCheckedIn = currentReservation
    ? currentReservation.status === "checked_in" || currentReservation.status === "completed"
    : false;

  // Authoritatively derive accrued commission total from ledger accruals using production domain helper
  const totalCommission = sumCommissionAccruals(commissionAccruals);
  const totalCommissionFormatted = formatMoney(totalCommission, locale);

  return (
    <div className="max-w-3xl mx-auto space-y-6 text-start">
      {/* Distinct Provider Terminal Header */}
      <div className="bg-slate-900 text-white rounded-3xl p-6 shadow-md border-b-4 border-amber-500">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-amber-500 flex items-center justify-center text-slate-950 font-black shadow-inner">
              <Wrench className="w-6 h-6" />
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400 block">
                {isAr
                  ? "محطة المركز المشارك — شاشة الاستقبال"
                  : "Participating Workshop — Reception Terminal"}
              </span>
              <h1 className="text-xl font-black tracking-tight">{t("provider.title")}</h1>
              <p className="text-xs text-slate-300">{t("provider.subtitle")}</p>
            </div>
          </div>

          <div className="text-end text-xs">
            <span className="text-slate-400 block">{t("provider.accruedCommissionLabel")}</span>
            <span
              data-testid="provider-header-commission"
              className="font-extrabold text-amber-400 font-mono text-sm"
            >
              {totalCommissionFormatted}{" "}
              {t("provider.servicesCount", { count: commissionAccruals.length })}
            </span>
          </div>
        </div>
      </div>

      {/* Main Scan & Check-In Component */}
      <ScanSimulator
        onCheckInSuccess={() => {
          // Check-in succeeds
        }}
      />

      {/* Next Step Banner: Move to Completion */}
      {isCheckedIn && (
        <div className="p-5 rounded-2xl bg-gradient-to-r from-emerald-50 to-white border border-emerald-300 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h4 className="font-bold text-sm text-emerald-950 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>
                {isAr
                  ? "العميل مسجل الحضور — جاهز للإتمام بعد الخدمة"
                  : "Customer Checked In — Ready for Completion"}
              </span>
            </h4>
            <p className="text-xs text-emerald-800">
              {isAr
                ? "بعد تحصيل مبلغ ٩٦٠ ج.م بالمركز، انتقل إلى خطوة الإتمام لطلب رمز PIN من العميل."
                : "After service delivery and collecting EGP 960 at center, proceed to enter customer PIN."}
            </p>
          </div>

          <Link
            href="/provider/complete"
            className="px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs transition-colors flex items-center gap-2 whitespace-nowrap"
          >
            <KeyRound className="w-4 h-4" />
            <span>{isAr ? "الانتقال لتأكيد الإتمام بالرمز (PIN)" : "Proceed to Enter PIN"}</span>
            {dir === "rtl" ? <ArrowLeft className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
          </Link>
        </div>
      )}
    </div>
  );
}
