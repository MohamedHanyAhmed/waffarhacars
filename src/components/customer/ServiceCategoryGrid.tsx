"use client";

import React from "react";
import Link from "next/link";
import { useI18n } from "../../context/I18nContext";
import { SERVICE_CATEGORIES } from "../../domain/fixtures";
import {
  Wrench,
  AlertTriangle,
  Sparkles,
  CircleDot,
  Zap,
  Wind,
  Sliders,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";

export function ServiceCategoryGrid() {
  const { locale, dir } = useI18n();
  const isAr = locale === "ar";

  const iconMap: Record<string, React.ElementType> = {
    Wrench,
    AlertTriangle,
    Sparkles,
    CircleDot,
    Zap,
    Wind,
    Sliders,
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-slate-900">
          {isAr ? "فئات الخدمات والصيانة" : "Service Categories"}
        </h2>
        <Link
          href="/results"
          className="text-xs font-semibold text-brand-600 hover:text-brand-700 flex items-center gap-1"
        >
          <span>{isAr ? "عرض كل العروض" : "View All"}</span>
          {dir === "rtl" ? (
            <ChevronLeft className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
        </Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {SERVICE_CATEGORIES.map((cat) => {
          const Icon = iconMap[cat.iconName] || Wrench;
          const isPrimary = cat.id === "maintenance";

          return (
            <Link
              key={cat.id}
              href={`/results?category=${cat.id}`}
              className={`p-3.5 rounded-2xl border transition-all flex flex-col justify-between group ${
                isPrimary
                  ? "border-brand-500/50 bg-gradient-to-br from-brand-50/50 to-white hover:border-brand-500 shadow-xs"
                  : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/60"
              }`}
            >
              <div>
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 transition-colors ${
                    isPrimary
                      ? "bg-brand-600 text-white shadow-xs"
                      : "bg-slate-100 text-slate-700 group-hover:bg-slate-200"
                  }`}
                >
                  <Icon className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-sm text-slate-900 mb-1 group-hover:text-brand-600 transition-colors">
                  {isAr ? cat.nameAr : cat.nameEn}
                </h3>
                <p className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed">
                  {isAr ? cat.descriptionAr : cat.descriptionEn}
                </p>
              </div>

              <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] font-semibold text-brand-600">
                <span>{isAr ? "استكشف العروض" : "Explore"}</span>
                {dir === "rtl" ? (
                  <ChevronLeft className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
