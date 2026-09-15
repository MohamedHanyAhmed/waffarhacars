"use client";

import React, { use } from "react";
import Link from "next/link";
import { useDemoState } from "../../../context/DemoStateContext";
import { useI18n } from "../../../context/I18nContext";
import { checkCompatibility } from "../../../domain/stateTransitions";
import { formatMoney } from "../../../domain/money";
import { PriceTag } from "../../../components/common/PriceTag";
import {
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Clock,
  MapPin,
  Wrench,
  AlertCircle,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";

interface OfferDetailPageProps {
  params: Promise<{ id: string }>;
}

export default function OfferDetailPage({ params }: OfferDetailPageProps) {
  const resolvedParams = use(params);
  const { publishedOffers, selectedVehicle } = useDemoState();
  const { t, locale, dir } = useI18n();
  const isAr = locale === "ar";

  const offer = publishedOffers.find((o) => o.id === resolvedParams.id);
  if (!offer) {
    return (
      <div className="p-8 text-center text-slate-500">
        <p>{isAr ? "العرض غير موجود" : "Offer not found"}</p>
        <Link href="/results" className="text-brand-600 underline font-semibold text-xs mt-2 block">
          {isAr ? "العودة للنتائج" : "Back to results"}
        </Link>
      </div>
    );
  }

  const compatibility = checkCompatibility(selectedVehicle, offer);
  const isCompatible = compatibility.compatible;

  return (
    <div className="max-w-4xl mx-auto space-y-6 text-start">
      {/* Breadcrumb Navigation */}
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Link href="/results" className="hover:text-brand-600">
          {t("nav.services")}
        </Link>
        <span>/</span>
        <span className="text-slate-900 font-semibold truncate">
          {isAr ? offer.titleAr : offer.titleEn}
        </span>
      </div>

      {/* Main Top Card: Title, Compatibility, Price & Primary CTA */}
      <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-extrabold text-slate-900 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-brand-600" />
              {isAr ? "أوربت أوتو كير — مصر الجديدة" : "Orbit Auto Care — Heliopolis"}
            </span>
            <span className="text-[10px] bg-slate-100 text-slate-600 font-semibold px-2 py-0.5 rounded">
              {isAr ? "ورشة مشاركة تجريبية" : "Demo participating workshop"}
            </span>
          </div>

          {/* Compatibility Pill */}
          {isCompatible ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>
                {isAr
                  ? `متوافق مع سيارتك (${selectedVehicle.year} ${selectedVehicle.make} ${selectedVehicle.model})`
                  : `Fits your ${selectedVehicle.year} ${selectedVehicle.make} ${selectedVehicle.model}`}
              </span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-800 border border-rose-200">
              <AlertTriangle className="w-4 h-4 text-rose-600" />
              <span>
                {isAr
                  ? `غير متوافق مع سيارتك (${selectedVehicle.year} ${selectedVehicle.make} ${selectedVehicle.model})`
                  : `Incompatible with your ${selectedVehicle.year} ${selectedVehicle.make} ${selectedVehicle.model}`}
              </span>
            </span>
          )}
        </div>

        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 leading-tight">
            {isAr ? offer.titleAr : offer.titleEn}
          </h1>
          <p className="text-sm text-slate-600 mt-2 leading-relaxed">
            {isAr ? offer.subtitleAr : offer.subtitleEn}
          </p>
        </div>

        {/* Incompatibility Warning if applicable */}
        {!isCompatible && (
          <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-900 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="font-bold block">
                {isAr
                  ? "تم حجب إمكانية الحجز لعدم مطابقة مواصفات السيارة"
                  : "Reservation Blocked: Vehicle Incompatibility"}
              </span>
              <p className="leading-relaxed">
                {isAr ? compatibility.reasonAr : compatibility.reasonEn}
              </p>
            </div>
          </div>
        )}

        {/* Pricing Breakdown & Action Row */}
        <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <PriceTag
            normalPrice={offer.normalPrice}
            lockedPrice={offer.lockedPrice}
            savings={offer.saving}
            size="lg"
          />

          {isCompatible ? (
            <Link
              href={`/reserve/${offer.id}`}
              data-testid="reserve-cta-button"
              className="w-full sm:w-auto px-6 py-3.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-extrabold text-sm shadow-md transition-all text-center flex items-center justify-center gap-2"
            >
              <span>
                {t("offer.reserveCta", { price: formatMoney(offer.lockedPrice, locale) })}
              </span>
              {dir === "rtl" ? (
                <ChevronLeft className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </Link>
          ) : (
            <button
              disabled
              className="w-full sm:w-auto px-6 py-3.5 rounded-xl bg-slate-200 text-slate-400 font-bold text-sm cursor-not-allowed border border-slate-300"
            >
              {t("offer.incompatibleCta")}
            </button>
          )}
        </div>
      </div>

      {/* Structured Details Sections */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Scope & Inclusions */}
        <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-3">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            <span>{t("offer.inclusionsTitle")}</span>
          </h2>
          <ul className="space-y-2 text-xs text-slate-700">
            {(isAr ? offer.inclusionsAr : offer.inclusionsEn).map((item, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="text-emerald-600 font-bold">✓</span>
                <span className="leading-relaxed">{item}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Specifications & Parts */}
        <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-3">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Wrench className="w-5 h-5 text-brand-600" />
            <span>{t("offer.partsTitle")}</span>
          </h2>
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-800 font-medium leading-relaxed">
            {isAr ? offer.partsSpecificationAr : offer.partsSpecificationEn}
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-500 pt-1">
            <span className="flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-slate-400" />
              <span>
                {t("offer.durationTitle")}: {offer.durationMinutes} {isAr ? "دقيقة" : "mins"}
              </span>
            </span>
          </div>
        </div>

        {/* Exclusions */}
        <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-3">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-amber-600" />
            <span>{t("offer.exclusionsTitle")}</span>
          </h2>
          <ul className="space-y-2 text-xs text-slate-600">
            {(isAr ? offer.exclusionsAr : offer.exclusionsEn).map((item, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="text-amber-600 font-bold">✕</span>
                <span className="leading-relaxed">{item}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Fulfilling Branch & Booking info */}
        <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-3">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <MapPin className="w-5 h-5 text-brand-600" />
            <span>{t("offer.branchTitle")}</span>
          </h2>
          <div className="space-y-1 text-xs text-slate-700">
            <p className="font-bold text-slate-900">
              {isAr ? "أوربت أوتو كير — فرع مصر الجديدة" : "Orbit Auto Care — Heliopolis Branch"}
            </p>
            <p className="text-slate-500">
              {isAr
                ? "١٤ شارع بيروت، مصر الجديدة، القاهرة (٣.٨ كم من مدينة نصر)"
                : "14 Beirut Street, Heliopolis, Cairo (3.8 km from Nasr City)"}
            </p>
            <p className="text-slate-500">
              {isAr
                ? "مواعيد العمل: يومياً من ٩ ص حتى ٩ م"
                : "Working Hours: Daily 9:00 AM – 9:00 PM"}
            </p>
          </div>
        </div>
      </div>

      {/* Mandatory Additional Work Rule & Cancellation Policies */}
      <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-5">
        {/* Additional Work Rule */}
        <div className="p-4 rounded-2xl bg-amber-50/70 border border-amber-200 text-xs space-y-1.5 text-amber-950">
          <h3 className="font-bold text-sm text-amber-900 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-amber-700" />
            <span>{t("offer.extraWorkTitle")}</span>
          </h3>
          <p className="leading-relaxed">
            {isAr ? offer.additionalWorkRuleAr : offer.additionalWorkRuleEn}
          </p>
        </div>

        {/* Provisional Warranty & Cancellation */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
            <span className="font-bold text-slate-900 block">{t("offer.warrantyTitle")}</span>
            <p className="text-slate-600 leading-relaxed">
              {isAr ? offer.warrantyTermsAr : offer.warrantyTermsEn}{" "}
              <span className="text-[10px] text-slate-400 block mt-0.5">
                (Provisional workshop recourse terms)
              </span>
            </p>
          </div>

          <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
            <span className="font-bold text-slate-900 block">{t("offer.cancellationTitle")}</span>
            <p className="text-slate-600 leading-relaxed">
              {isAr ? offer.cancellationPolicyAr : offer.cancellationPolicyEn}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
