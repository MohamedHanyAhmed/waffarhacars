"use client";

import { Info } from "lucide-react";
import { useI18n } from "@/context/I18nContext";

export function CustomerPublicationNotice() {
  const { t } = useI18n();
  return (
    <div
      role="note"
      className="flex items-start gap-2.5 rounded-xl border border-sky-200 bg-sky-50 p-3.5 text-xs text-sky-900"
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
      <div>
        <span className="block font-bold">{t("staffOffers.internalOnly")}</span>
        <span className="mt-0.5 block leading-relaxed">{t("staffOffers.offersIntro")}</span>
      </div>
    </div>
  );
}
