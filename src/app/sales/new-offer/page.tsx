"use client";

import React from "react";
import Link from "next/link";
import { OfferDraftWizard } from "../../../components/sales/OfferDraftWizard";
import { useI18n } from "../../../context/I18nContext";
import { ArrowLeft, ArrowRight, ShieldCheck } from "lucide-react";

export default function SalesNewOfferPage() {
  const { t, locale, dir } = useI18n();
  const isAr = locale === "ar";

  return (
    <div className="max-w-3xl mx-auto space-y-6 text-start">
      {/* Top Header & Context */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-purple-600 block">
            {isAr ? "بوابة فريق المبيعات والشركاء" : "Sales Team & Supply Acquisition"}
          </span>
          <h1 className="text-xl font-extrabold text-slate-900">{t("sales.title")}</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {isAr
              ? "تسجيل عروض المراكز الشريكة وإرسالها للاعتماد من فريق العمليات."
              : "Onboard partner workshop offers and submit for Operations compliance verification."}
          </p>
        </div>

        <Link
          href="/ops/approvals"
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200 text-xs font-bold transition-colors"
        >
          <ShieldCheck className="w-4 h-4 text-teal-600" />
          <span>{isAr ? "شاشة اعتماد العمليات" : "Go to Ops Approvals"}</span>
          {dir === "rtl" ? (
            <ArrowLeft className="w-3.5 h-3.5" />
          ) : (
            <ArrowRight className="w-3.5 h-3.5" />
          )}
        </Link>
      </div>

      {/* Main Wizard Form */}
      <OfferDraftWizard />
    </div>
  );
}
