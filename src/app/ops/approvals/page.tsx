"use client";

import React from "react";
import Link from "next/link";
import { CommissionLedgerTable } from "../../../components/ops/CommissionLedgerTable";
import { useI18n } from "../../../context/I18nContext";
import { ArrowLeft, ArrowRight } from "lucide-react";

export default function OpsApprovalsPage() {
  const { t, locale, dir } = useI18n();
  const isAr = locale === "ar";

  return (
    <div className="max-w-5xl mx-auto space-y-6 text-start">
      {/* Ops Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-teal-600 block">
            {isAr ? "بوابة العمليات والمطابقة المالية" : "Operations & Financial Settlement"}
          </span>
          <h1 className="text-xl font-extrabold text-slate-900">{t("ops.title")}</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {isAr
              ? "مراجعة واعتماد عروض المبيعات ومراقبة دفتر استحقاقات العمولات والحدود الائتمانية."
              : "Maker-checker offer approvals, commission receivables ledger, and provider credit monitoring."}
          </p>
        </div>

        <Link
          href="/sales/new-offer"
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-purple-50 hover:bg-purple-100 text-purple-800 border border-purple-200 text-xs font-bold transition-colors"
        >
          <span>{isAr ? "معالج مسودات المبيعات" : "Sales Offer Wizard"}</span>
          {dir === "rtl" ? (
            <ArrowLeft className="w-3.5 h-3.5" />
          ) : (
            <ArrowRight className="w-3.5 h-3.5" />
          )}
        </Link>
      </div>

      {/* Main Commission Ledger & Ops Approvals Table */}
      <CommissionLedgerTable />
    </div>
  );
}
