"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useI18n } from "@/context/I18nContext";

export default function CustomerDiscoveryShell({ children }: { children: ReactNode }) {
  const { locale, toggleLocale, t } = useI18n();
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#customer-content" className="sr-only focus:not-sr-only focus:p-3">
        {t("customerDiscovery.skip")}
      </a>
      <header className="border-b border-slate-200 bg-white">
        <nav
          aria-label={t("customerDiscovery.navigation")}
          className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 p-4"
        >
          <Link className="min-h-11 content-center font-bold" href="/customer/offers">
            {t("brandName")}
          </Link>
          <button
            data-testid="discovery-locale"
            type="button"
            onClick={toggleLocale}
            lang={locale === "ar" ? "en" : "ar"}
            className="min-h-11 rounded-lg border border-slate-300 px-4 font-semibold"
          >
            {locale === "ar" ? "English" : "العربية"}
          </button>
        </nav>
      </header>
      <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm text-amber-950">
        {t("customerDiscovery.preview")}
      </div>
      <main
        id="customer-content"
        className="mx-auto w-full max-w-5xl flex-1 space-y-6 p-4 sm:p-6"
        tabIndex={-1}
      >
        {children}
      </main>
      <footer className="border-t border-slate-200 bg-white px-4 py-5 text-center text-sm text-slate-600">
        {t("customerDiscovery.workingName")}
      </footer>
    </div>
  );
}
