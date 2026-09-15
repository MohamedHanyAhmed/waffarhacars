"use client";

import React from "react";
import { useI18n } from "../../context/I18nContext";
import { Globe } from "lucide-react";

export function LocaleToggle() {
  const { locale, toggleLocale } = useI18n();

  return (
    <button
      onClick={toggleLocale}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 shadow-xs focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors"
      aria-label="Toggle language between Arabic and English"
    >
      <Globe className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
      <span>{locale === "en" ? "العربية (RTL)" : "English (LTR)"}</span>
    </button>
  );
}
