"use client";

import React from "react";
import { useI18n } from "@/context/I18nContext";
import { Info } from "lucide-react";

export function OffersNotConfiguredNotice() {
  const { t } = useI18n();

  return (
    <div
      role="note"
      className="p-3.5 bg-sky-50 border border-sky-200/80 rounded-xl text-sky-900 text-xs flex items-start gap-2.5"
    >
      <Info className="w-4 h-4 text-sky-600 flex-shrink-0 mt-0.5" />
      <div>
        <span className="font-bold block">{t("onboarding.notice.offersNotConfigured")}</span>
        <span className="text-sky-800 leading-relaxed block mt-0.5">
          {t("onboarding.notice.offersNotConfiguredDesc")}
        </span>
      </div>
    </div>
  );
}
