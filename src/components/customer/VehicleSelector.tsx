"use client";

import React, { useState } from "react";
import { useDemoState } from "../../context/DemoStateContext";
import { useI18n } from "../../context/I18nContext";
import { DEMO_VEHICLE, INCOMPATIBLE_VEHICLE } from "../../domain/fixtures";
import { Car, MapPin, CheckCircle2, ChevronDown } from "lucide-react";

export function VehicleSelector() {
  const { selectedVehicle, setSelectedVehicle, selectedArea, setSelectedArea } = useDemoState();
  const { t, locale } = useI18n();
  const [vehicleModalOpen, setVehicleModalOpen] = useState(false);
  const [areaModalOpen, setAreaModalOpen] = useState(false);

  const areas = [
    { id: "nasr_city", nameEn: "Nasr City", nameAr: "مدينة نصر" },
    { id: "heliopolis", nameEn: "Heliopolis", nameAr: "مصر الجديدة" },
    { id: "maadi", nameEn: "Maadi", nameAr: "المعادي" },
    {
      id: "new_cairo",
      nameEn: "New Cairo / 5th Settlement",
      nameAr: "القاهرة الجديدة / التجمع الخامس",
    },
  ];

  const isAr = locale === "ar";

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 divide-y md:divide-y-0 md:divide-x md:rtl:divide-x-reverse divide-slate-100">
        {/* Vehicle Selection */}
        <div className="flex items-center justify-between pe-0 md:pe-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700">
              <Car className="w-5 h-5" />
            </div>
            <div>
              <span className="text-xs font-semibold text-slate-400 block">
                {t("home.vehicleLabel")}
              </span>
              <span className="text-sm font-bold text-slate-900 block">
                {selectedVehicle.year} {selectedVehicle.make} {selectedVehicle.model}{" "}
                <span className="text-xs font-normal text-slate-500">
                  ({selectedVehicle.engineTrim})
                </span>
              </span>
            </div>
          </div>

          <button
            onClick={() => setVehicleModalOpen(!vehicleModalOpen)}
            className="text-xs font-semibold text-brand-600 hover:text-brand-700 flex items-center gap-1 p-1.5 rounded-lg hover:bg-brand-50"
          >
            <span>{t("home.changeVehicle")}</span>
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Cairo Area Selection */}
        <div className="flex items-center justify-between pt-3 md:pt-0 ps-0 md:ps-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center text-brand-600">
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <span className="text-xs font-semibold text-slate-400 block">
                {t("home.areaLabel")}
              </span>
              <span className="text-sm font-bold text-slate-900 block">
                {selectedArea},{" "}
                <span className="text-xs font-normal text-slate-500">
                  {isAr ? "القاهرة" : "Cairo"}
                </span>
              </span>
            </div>
          </div>

          <button
            onClick={() => setAreaModalOpen(!areaModalOpen)}
            className="text-xs font-semibold text-brand-600 hover:text-brand-700 flex items-center gap-1 p-1.5 rounded-lg hover:bg-brand-50"
          >
            <span>{t("home.changeArea")}</span>
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Vehicle Switcher Dropdown */}
      {vehicleModalOpen && (
        <div className="mt-3 pt-3 border-t border-slate-100 flex flex-col gap-2">
          <p className="text-xs font-semibold text-slate-500">
            {isAr ? "اختر سيارة لاختبار التوافق:" : "Select vehicle to test compatibility:"}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              onClick={() => {
                setSelectedVehicle(DEMO_VEHICLE);
                setVehicleModalOpen(false);
              }}
              className={`p-2.5 rounded-xl border text-start flex items-center justify-between text-xs transition-colors ${
                selectedVehicle.id === DEMO_VEHICLE.id
                  ? "border-brand-500 bg-brand-50 font-bold text-brand-900"
                  : "border-slate-200 hover:bg-slate-50 text-slate-700"
              }`}
            >
              <div>
                <span className="block font-bold">2021 Nissan Sunny (1.5L)</span>
                <span className="text-[11px] text-emerald-600 font-medium">
                  {isAr ? "✓ متوافق مع عروض الصيانة" : "✓ Compatible with standard offers"}
                </span>
              </div>
              {selectedVehicle.id === DEMO_VEHICLE.id && (
                <CheckCircle2 className="w-4 h-4 text-brand-600" />
              )}
            </button>

            <button
              onClick={() => {
                setSelectedVehicle(INCOMPATIBLE_VEHICLE);
                setVehicleModalOpen(false);
              }}
              className={`p-2.5 rounded-xl border text-start flex items-center justify-between text-xs transition-colors ${
                selectedVehicle.id === INCOMPATIBLE_VEHICLE.id
                  ? "border-rose-500 bg-rose-50 font-bold text-rose-900"
                  : "border-slate-200 hover:bg-slate-50 text-slate-700"
              }`}
            >
              <div>
                <span className="block font-bold">2023 BMW 330i M-Sport (2.0L)</span>
                <span className="text-[11px] text-rose-600 font-medium">
                  {isAr ? "⚠ غير متوافق (محرك ألماني خاص)" : "⚠ Incompatible (High-spec BMW)"}
                </span>
              </div>
              {selectedVehicle.id === INCOMPATIBLE_VEHICLE.id && (
                <CheckCircle2 className="w-4 h-4 text-rose-600" />
              )}
            </button>
          </div>
        </div>
      )}

      {/* Area Switcher Dropdown */}
      {areaModalOpen && (
        <div className="mt-3 pt-3 border-t border-slate-100 flex flex-col gap-2">
          <p className="text-xs font-semibold text-slate-500">
            {isAr ? "اختر منطقة البحث في القاهرة:" : "Select Cairo cluster:"}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            {areas.map((a) => (
              <button
                key={a.id}
                onClick={() => {
                  setSelectedArea(isAr ? a.nameAr : a.nameEn);
                  setAreaModalOpen(false);
                }}
                className={`p-2 rounded-lg border text-center font-medium transition-colors ${
                  selectedArea === (isAr ? a.nameAr : a.nameEn)
                    ? "border-brand-500 bg-brand-50 text-brand-900 font-bold"
                    : "border-slate-200 hover:bg-slate-50 text-slate-700"
                }`}
              >
                {isAr ? a.nameAr : a.nameEn}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
