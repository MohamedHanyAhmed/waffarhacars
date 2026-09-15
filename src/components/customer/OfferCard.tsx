"use client";

import React from "react";
import Link from "next/link";
import { OfferVariant } from "../../domain/types";
import { useDemoState } from "../../context/DemoStateContext";
import { useI18n } from "../../context/I18nContext";
import { checkCompatibility } from "../../domain/stateTransitions";
import { PriceTag } from "../common/PriceTag";
import {
  CheckCircle2,
  AlertTriangle,
  MapPin,
  Clock,
  Star,
  ShieldCheck,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";

interface OfferCardProps {
  offer: OfferVariant;
}

export function OfferCard({ offer }: OfferCardProps) {
  const { selectedVehicle } = useDemoState();
  const { locale, dir, t } = useI18n();
  const isAr = locale === "ar";

  const compatibility = checkCompatibility(selectedVehicle, offer);
  const isCompatible = compatibility.compatible;

  return (
    <div
      className={`rounded-2xl border transition-all bg-white p-5 flex flex-col justify-between shadow-xs ${
        isCompatible
          ? "border-slate-200 hover:border-brand-400 hover:shadow-md"
          : "border-rose-200 bg-rose-50/20"
      }`}
    >
      <div>
        {/* Top Badges: Provider & Fit */}
        <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-800 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-brand-600" />
              {isAr ? "أوربت أوتو كير — مصر الجديدة" : "Orbit Auto Care — Heliopolis"}
            </span>
            <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-medium">
              Demo
            </span>
          </div>

          {/* Compatibility Pill */}
          {isCompatible ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>
                {isAr
                  ? `متوافق مع ${selectedVehicle.model} ${selectedVehicle.year}`
                  : `Fits your ${selectedVehicle.year} ${selectedVehicle.model}`}
              </span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>{isAr ? "غير متوافق مع سيارتك" : "Incompatible Vehicle"}</span>
            </span>
          )}
        </div>

        {/* Offer Title & Subtitle */}
        <h3 className="font-extrabold text-base text-slate-900 mb-1 leading-snug">
          {isAr ? offer.titleAr : offer.titleEn}
        </h3>
        <p className="text-xs text-slate-600 mb-4 leading-relaxed">
          {isAr ? offer.subtitleAr : offer.subtitleEn}
        </p>

        {/* Location, Distance & Availability */}
        <div className="flex items-center gap-4 text-xs text-slate-500 mb-4 flex-wrap">
          <span className="flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5 text-slate-400" />
            <span>
              {isAr ? "مصر الجديدة" : "Heliopolis"} (3.8 {t("results.kmAway")})
            </span>
          </span>
          <span className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <span>{isAr ? "اليوم، ٣:٣٠ م" : "Today, 3:30 PM"}</span>
          </span>
          <span className="flex items-center gap-1 text-amber-700 font-semibold">
            <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
            <span>4.85 (42)</span>
          </span>
        </div>

        {/* Incompatibility Notice if applicable */}
        {!isCompatible && (
          <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              {isAr ? compatibility.reasonAr : compatibility.reasonEn}
            </p>
          </div>
        )}
      </div>

      {/* Bottom Row: Price Breakdown & CTA */}
      <div className="pt-4 border-t border-slate-100 flex items-end justify-between gap-4 flex-wrap">
        <PriceTag
          normalPrice={offer.normalPrice}
          lockedPrice={offer.lockedPrice}
          savings={offer.saving}
          size="sm"
        />

        {isCompatible ? (
          <Link
            href={`/offers/${offer.id}`}
            data-testid="view-details-button"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold shadow-xs transition-colors"
          >
            <span>{t("results.viewDetails")}</span>
            {dir === "rtl" ? (
              <ChevronLeft className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
          </Link>
        ) : (
          <button
            disabled
            className="px-4 py-2 rounded-xl bg-slate-100 text-slate-400 text-xs font-semibold cursor-not-allowed border border-slate-200"
          >
            {isAr ? "غير متاح للحجز" : "Cannot Reserve"}
          </button>
        )}
      </div>
    </div>
  );
}
