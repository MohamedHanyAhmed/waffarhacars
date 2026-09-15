"use client";

import React from "react";
import Link from "next/link";
import { useDemoState } from "../../../context/DemoStateContext";
import { useI18n } from "../../../context/I18nContext";
import { PinPad } from "../../../components/provider/PinPad";
import { CheckCircle2, ChevronRight, ChevronLeft } from "lucide-react";

export default function ProviderCompletePage() {
  const { currentReservation } = useDemoState();
  const { t, locale, dir } = useI18n();
  const isAr = locale === "ar";

  const isCompleted = currentReservation?.status === "completed";

  return (
    <div className="max-w-2xl mx-auto space-y-6 text-start">
      {/* Workshop Header */}
      <div className="bg-slate-900 text-white rounded-3xl p-6 shadow-md border-b-4 border-emerald-500">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500 flex items-center justify-center text-slate-950 font-black shadow-inner">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400 block">
              {isAr
                ? "محطة الورشة — تأكيد الإتمام المتبادل"
                : "Workshop Terminal — Mutual Completion"}
            </span>
            <h1 className="text-xl font-black tracking-tight">{t("provider.completeTitle")}</h1>
            <p className="text-xs text-slate-300">{t("provider.subtitle")}</p>
          </div>
        </div>
      </div>

      {/* Pin Entry Pad */}
      <PinPad />

      {/* Success Links */}
      {isCompleted && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3 shadow-xs text-xs">
          <h4 className="font-bold text-slate-900">
            {isAr ? "الخطوات التالية في سيناريو العرض:" : "Next Steps in Demo Walkthrough:"}
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Link
              href={
                currentReservation
                  ? `/my-reservations/${currentReservation.id}/completed`
                  : "/my-reservations/res-sunny-7492/completed"
              }
              className="p-3 rounded-xl border border-blue-200 bg-blue-50/60 hover:bg-blue-100 text-blue-900 font-bold flex items-center justify-between transition-colors"
            >
              <span>{isAr ? "الانتقال لشاشة تقييم العميل" : "View Customer Review Screen"}</span>
              {dir === "rtl" ? (
                <ChevronLeft className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </Link>

            <Link
              href="/ops/approvals"
              className="p-3 rounded-xl border border-teal-200 bg-teal-50/60 hover:bg-teal-100 text-teal-900 font-bold flex items-center justify-between transition-colors"
            >
              <span>
                {isAr ? "مراجعة كشف حساب العمليات (٩٦ ج.م)" : "Inspect Ops Commission Ledger"}
              </span>
              {dir === "rtl" ? (
                <ChevronLeft className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
