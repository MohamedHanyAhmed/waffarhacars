"use client";

import React, { useState } from "react";
import { useDemoState } from "../../context/DemoStateContext";
import { useI18n } from "../../context/I18nContext";
import { OfferCard } from "../../components/customer/OfferCard";
import { VehicleSelector } from "../../components/customer/VehicleSelector";
import { checkCompatibility } from "../../domain/stateTransitions";
import { Car } from "lucide-react";

export default function ResultsPage() {
  const { publishedOffers, selectedVehicle } = useDemoState();
  const { t, locale } = useI18n();
  const isAr = locale === "ar";

  const [filterCompatibleOnly, setFilterCompatibleOnly] = useState(false);

  const displayedOffers = publishedOffers.filter((offer) => {
    if (filterCompatibleOnly) {
      return checkCompatibility(selectedVehicle, offer).compatible;
    }
    return true;
  });

  return (
    <div className="space-y-6 text-start max-w-5xl mx-auto">
      {/* Top Context: Vehicle and Area bar */}
      <VehicleSelector />

      {/* Header & Filters */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900">{t("results.title")}</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {isAr
              ? `عرض نتائج الصيانة لـ ${selectedVehicle.year} ${selectedVehicle.make} ${selectedVehicle.model}`
              : `Showing service results for your ${selectedVehicle.year} ${selectedVehicle.make} ${selectedVehicle.model}`}
          </p>
        </div>

        {/* Filter toggle */}
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 cursor-pointer shadow-xs hover:bg-slate-50">
            <input
              type="checkbox"
              checked={filterCompatibleOnly}
              onChange={(e) => setFilterCompatibleOnly(e.target.checked)}
              className="rounded text-brand-600 focus:ring-brand-500 w-4 h-4"
            />
            <span>{t("results.compatibleOnly")}</span>
          </label>
        </div>
      </div>

      {/* Offers List */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {displayedOffers.map((offer) => (
          <OfferCard key={offer.id} offer={offer} />
        ))}
      </div>

      {/* Incompatible Offer Educational Callout */}
      <div className="p-4 rounded-2xl border border-slate-200 bg-slate-100/70 text-xs text-slate-600 flex items-start gap-3">
        <Car className="w-5 h-5 text-slate-500 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <span className="font-bold text-slate-800 block">
            {isAr ? "ميزة التحقق من توافق السيارات بالمنصة" : "Platform Vehicle Fit Verification"}
          </span>
          <p className="leading-relaxed">
            {isAr
              ? "تحرص المنصة على منع حجز أي عروض صيانة لا تطابق مواصفات زيت أو فرامل سيارتك بدقة، لتجنب أي خلاف أو تعديل في السعر داخل المركز."
              : "Our marketplace strictly prevents reservations for offers that do not match your exact engine oil specifications or parts, ensuring zero surprises or price disputes at the center."}
          </p>
        </div>
      </div>
    </div>
  );
}
