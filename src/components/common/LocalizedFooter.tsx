"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { useI18n } from "../../context/I18nContext";

export function LocalizedFooter() {
  const pathname = usePathname();
  const { t, dir } = useI18n();

  if (pathname?.startsWith("/staff")) {
    return (
      <footer
        data-testid="staff-footer"
        className="border-t border-slate-200 bg-white py-4 px-4 text-xs text-slate-500"
        dir={dir}
      >
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-start">
          <span data-testid="staff-footer-copyright">
            © {new Date().getFullYear()} WaffarhaCars.
          </span>
          <span
            data-testid="staff-footer-badge"
            className="font-medium text-slate-600 flex items-center gap-1.5"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block shrink-0" />
            <span>{t("staff.authorizedSystems")}</span>
          </span>
        </div>
      </footer>
    );
  }

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
