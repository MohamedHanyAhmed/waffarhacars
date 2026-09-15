"use client";

import React from "react";
import { useI18n } from "../../context/I18nContext";

export function LocalizedFooter() {
  const { t } = useI18n();

  return (
    <footer
      data-testid="app-footer"
      className="border-t border-slate-200 bg-white py-6 px-4 text-xs text-slate-500"
    >
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-start">
        <span data-testid="footer-copyright">{t("footer.copyright")}</span>
        <span data-testid="footer-disclaimer" className="font-medium text-slate-600">
          {t("footer.disclaimer")}
        </span>
      </div>
    </footer>
  );
}
