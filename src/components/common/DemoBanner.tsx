"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useI18n } from "../../context/I18nContext";
import { LocaleToggle } from "./LocaleToggle";
import { DemoScenarioDrawer } from "./DemoScenarioDrawer";
import { Sliders, Wrench, Menu, X } from "lucide-react";

export function DemoBanner() {
  const { t } = useI18n();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <>
      {/* 1. Top Persistent Notice Banner */}
      <div className="bg-slate-900 text-slate-200 border-b border-slate-800 text-xs py-1.5 px-4 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-medium text-slate-300">{t("demoBannerText")}</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setDrawerOpen(true)}
              data-testid="open-drawer-button"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-xs transition-colors"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>{t("demoScenarios")}</span>
            </button>
            <LocaleToggle />
          </div>
        </div>
      </div>

      {/* 2. Main Navigation Bar */}
      <header className="bg-white border-b border-slate-200 sticky top-8 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          {/* Brand Logo & Name */}
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="w-9 h-9 rounded-lg bg-slate-900 flex items-center justify-center text-white shadow-xs group-hover:bg-brand-600 transition-colors">
              <Wrench className="w-5 h-5 text-brand-400 group-hover:text-white" />
            </div>
            <div>
              <span className="font-extrabold text-base tracking-tight text-slate-900 block leading-tight">
                {t("brandName")}
              </span>
              <span className="text-[10px] font-medium text-slate-500 block leading-tight">
                {t("brandTagline")}
              </span>
            </div>
          </Link>

          {/* Desktop Nav Links */}
          <nav className="hidden md:flex items-center gap-6 text-xs font-semibold text-slate-600">
            <Link href="/" className="hover:text-brand-600 transition-colors">
              {t("nav.home")}
            </Link>
            <Link href="/results" className="hover:text-brand-600 transition-colors">
              {t("nav.services")}
            </Link>
            <Link href="/my-reservations" className="hover:text-brand-600 transition-colors">
              {t("nav.myReservations")}
            </Link>
            <span className="h-4 w-px bg-slate-200" />
            <Link
              href="/provider/check-in"
              className="text-amber-700 hover:text-amber-800 flex items-center gap-1"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              {t("nav.providerPortal")}
            </Link>
            <Link
              href="/sales/new-offer"
              className="text-purple-700 hover:text-purple-800 flex items-center gap-1"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
              {t("nav.salesPortal")}
            </Link>
            <Link
              href="/ops/approvals"
              className="text-teal-700 hover:text-teal-800 flex items-center gap-1"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-teal-500" />
              {t("nav.opsPortal")}
            </Link>
          </nav>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* Mobile Dropdown */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-slate-200 bg-white px-4 py-3 space-y-2 text-sm font-medium shadow-lg">
            <Link
              href="/"
              onClick={() => setMobileMenuOpen(false)}
              className="block py-2 text-slate-700 hover:text-brand-600"
            >
              {t("nav.home")}
            </Link>
            <Link
              href="/results"
              onClick={() => setMobileMenuOpen(false)}
              className="block py-2 text-slate-700 hover:text-brand-600"
            >
              {t("nav.services")}
            </Link>
            <Link
              href="/my-reservations"
              onClick={() => setMobileMenuOpen(false)}
              className="block py-2 text-slate-700 hover:text-brand-600"
            >
              {t("nav.myReservations")}
            </Link>
            <div className="pt-2 border-t border-slate-100 space-y-2">
              <Link
                href="/provider/check-in"
                onClick={() => setMobileMenuOpen(false)}
                className="block py-1 text-amber-700 font-semibold"
              >
                {t("nav.providerPortal")}
              </Link>
              <Link
                href="/sales/new-offer"
                onClick={() => setMobileMenuOpen(false)}
                className="block py-1 text-purple-700 font-semibold"
              >
                {t("nav.salesPortal")}
              </Link>
              <Link
                href="/ops/approvals"
                onClick={() => setMobileMenuOpen(false)}
                className="block py-1 text-teal-700 font-semibold"
              >
                {t("nav.opsPortal")}
              </Link>
            </div>
          </div>
        )}
      </header>

      {/* Scenario & Route Drawer */}
      <DemoScenarioDrawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </>
  );
}
