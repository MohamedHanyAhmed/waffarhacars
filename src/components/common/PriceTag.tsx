"use client";

import React from "react";
import { useI18n } from "../../context/I18nContext";
import { Money, formatMoney } from "../../domain/money";

interface PriceTagProps {
  normalPrice: Money;
  lockedPrice: Money;
  savings: Money;
  size?: "sm" | "md" | "lg";
}

export function PriceTag({ normalPrice, lockedPrice, savings, size = "md" }: PriceTagProps) {
  const { locale, t } = useI18n();

  const isAr = locale === "ar";

  const sizeClasses = {
    sm: {
      locked: "text-lg font-bold text-slate-900",
      normal: "text-xs text-slate-400 line-through",
      saving:
        "text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200",
    },
    md: {
      locked: "text-2xl font-extrabold text-slate-900",
      normal: "text-sm text-slate-400 line-through",
      saving:
        "text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200",
    },
    lg: {
      locked: "text-3xl font-extrabold text-slate-900",
      normal: "text-base text-slate-400 line-through",
      saving:
        "text-sm font-semibold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200",
    },
  }[size];

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline gap-2.5 flex-wrap">
        <span className={sizeClasses.locked}>
          <bdi>{formatMoney(lockedPrice, locale)}</bdi>
        </span>
        <span className={sizeClasses.normal}>
          <bdi>{formatMoney(normalPrice, locale)}</bdi>
        </span>
        <span className={sizeClasses.saving}>
          {t("results.save")} <bdi>{formatMoney(savings, locale)}</bdi>
        </span>
      </div>
      <p className="text-xs font-medium text-slate-500">
        {isAr ? "السعر مثبت ويُدفع مباشرة في المركز" : "Locked price paid directly at center"}
      </p>
    </div>
  );
}
