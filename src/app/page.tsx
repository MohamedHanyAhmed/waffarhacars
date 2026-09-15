"use client";

import React from "react";
import Link from "next/link";
import { useI18n } from "../context/I18nContext";
import { VehicleSelector } from "../components/customer/VehicleSelector";
import { ServiceCategoryGrid } from "../components/customer/ServiceCategoryGrid";
import { ShieldCheck, ChevronRight, ChevronLeft, Wrench, CheckCircle2 } from "lucide-react";

export default function CustomerHome() {
  const { t, locale, dir } = useI18n();
  const isAr = locale === "ar";

  return (
    <div className="space-y-8 text-start max-w-5xl mx-auto">
      {/* Hero Section */}
      <section className="bg-gradient-to-b from-slate-900 via-slate-850 to-slate-900 text-white rounded-3xl p-6 sm:p-10 shadow-lg relative overflow-hidden">
        <div className="max-w-2xl space-y-4 relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-500/20 text-brand-300 border border-brand-400/30 text-xs font-bold">
            <ShieldCheck className="w-4 h-4 text-brand-400" />
            <span>
              {isAr
                ? "دفع في المركز فقط — بدون أي دفع مسبق للمنصة"
                : "Pay at center only — Zero upfront platform charge"}
            </span>
          </div>

          <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight leading-tight">
            {t("home.heroTitle")}
          </h1>

          <p className="text-sm sm:text-base text-slate-300 leading-relaxed">
            {t("home.heroSubtitle")}
          </p>
        </div>

        {/* Decorative background grid subtle overlay */}
        <div className="absolute -end-10 -bottom-10 opacity-10 pointer-events-none">
          <Wrench className="w-80 h-80" />
        </div>
      </section>

      {/* Vehicle and Area Selection Bar */}
      <section>
        <VehicleSelector />
      </section>

      {/* Service Categories Grid */}
      <section>
        <ServiceCategoryGrid />
      </section>

      {/* 3-Step How It Works Section */}
      <section className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 space-y-6 shadow-xs">
        <div>
          <h2 className="text-lg font-bold text-slate-900">{t("home.howItWorksTitle")}</h2>
          <p className="text-xs text-slate-500 mt-1">
            {isAr
              ? "نموذج شفاف مصمم لحماية مالكي السيارات ومراكز الصيانة المشاركة."
              : "A transparent model designed to protect car owners and participating service centers alike."}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2">
            <div className="w-9 h-9 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center font-extrabold text-sm">
              1
            </div>
            <h3 className="font-bold text-sm text-slate-900">{t("home.step1Title")}</h3>
            <p className="text-xs text-slate-600 leading-relaxed">{t("home.step1Desc")}</p>
          </div>

          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center font-extrabold text-sm">
              2
            </div>
            <h3 className="font-bold text-sm text-slate-900">{t("home.step2Title")}</h3>
            <p className="text-xs text-slate-600 leading-relaxed">{t("home.step2Desc")}</p>
          </div>

          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2">
            <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-700 flex items-center justify-center font-extrabold text-sm">
              3
            </div>
            <h3 className="font-bold text-sm text-slate-900">{t("home.step3Title")}</h3>
            <p className="text-xs text-slate-600 leading-relaxed">{t("home.step3Desc")}</p>
          </div>
        </div>

        {/* Trust Guarantee Box */}
        <div className="p-4 rounded-2xl bg-slate-900 text-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h4 className="font-bold text-sm text-white flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>{t("home.trustPromiseTitle")}</span>
            </h4>
            <p className="text-xs text-slate-400">{t("home.trustPromiseDesc")}</p>
          </div>

          <Link
            href="/results?category=maintenance"
            className="inline-flex items-center justify-center gap-2 px-5 py-3 min-h-[44px] rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-bold text-xs shadow-xs transition-colors shrink-0"
          >
            <span>{isAr ? "ابدأ بحجز صيانة مجاناً" : "Browse Maintenance Offers"}</span>
            {dir === "rtl" ? (
              <ChevronLeft className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </Link>
        </div>
      </section>
    </div>
  );
}
