"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useI18n } from "@/context/I18nContext";
import { LocaleToggle } from "@/components/common/LocaleToggle";
import {
  ShieldCheck,
  Building2,
  PlusCircle,
  Inbox,
  LogOut,
  Menu,
  X,
  User,
  LayoutDashboard,
} from "lucide-react";
import type { StaffAuthStatusResponse } from "@/lib/staff/status-contract";

export function StaffNavHeader() {
  const { t, dir } = useI18n();
  const pathname = usePathname();
  const router = useRouter();

  const [staffStatus, setStaffStatus] = useState<StaffAuthStatusResponse | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const isAuthPage =
    pathname === "/staff/login" ||
    pathname === "/staff/activate-password" ||
    pathname.startsWith("/staff/mfa");

  useEffect(() => {
    if (isAuthPage) return;

    let ignore = false;
    async function checkStatus() {
      try {
        const res = await fetch("/api/v1/staff/auth/status", {
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        if (!ignore && res.ok) {
          const data = (await res.json()) as StaffAuthStatusResponse;
          setStaffStatus(data);
        }
      } catch {
        // Handled at page level
      }
    }

    checkStatus();
    return () => {
      ignore = true;
    };
  }, [pathname, isAuthPage]);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await fetch("/api/auth/sign-out", { method: "POST" });
    } finally {
      router.replace("/staff/login");
    }
  };

  const isSales = staffStatus?.department === "SALES" || staffStatus?.department === "ADMIN";
  const isOps = staffStatus?.department === "OPERATIONS" || staffStatus?.department === "ADMIN";

  return (
    <header
      className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-30 shadow-md"
      dir={dir}
    >
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
        {/* Brand Link */}
        <div className="flex items-center gap-3">
          <Link
            href="/staff"
            className="flex items-center gap-2.5 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 rounded-lg p-1"
          >
            <div className="w-9 h-9 rounded-lg bg-brand-600 flex items-center justify-center text-white shadow-xs group-hover:bg-brand-500 transition-colors">
              <ShieldCheck className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-base tracking-tight text-white block leading-tight">
                  {t("brandName")}
                </span>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-brand-500/20 text-brand-300 border border-brand-500/30 uppercase">
                  Staff
                </span>
              </div>
              <span className="text-[10px] font-medium text-slate-400 block leading-tight">
                {t("onboarding.brandSubtitle")}
              </span>
            </div>
          </Link>
        </div>

        {/* Desktop Nav Links (When Authenticated) */}
        {!isAuthPage && staffStatus?.state === "ACTIVE" && (
          <nav
            className="hidden md:flex items-center gap-1 text-xs font-semibold text-slate-300"
            aria-label="Staff navigation"
          >
            <Link
              href="/staff"
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
                pathname === "/staff"
                  ? "bg-slate-800 text-white font-bold"
                  : "hover:bg-slate-800/60 hover:text-white"
              }`}
            >
              <LayoutDashboard className="w-4 h-4 text-brand-400" />
              <span>{t("onboarding.nav.dashboard")}</span>
            </Link>

            <Link
              href="/staff/providers"
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
                pathname.startsWith("/staff/providers") && !pathname.includes("/new")
                  ? "bg-slate-800 text-white font-bold"
                  : "hover:bg-slate-800/60 hover:text-white"
              }`}
            >
              <Building2 className="w-4 h-4 text-sky-400" />
              <span>{t("onboarding.nav.directory")}</span>
            </Link>

            {isSales && (
              <Link
                href="/staff/providers/new"
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
                  pathname === "/staff/providers/new"
                    ? "bg-slate-800 text-white font-bold"
                    : "hover:bg-slate-800/60 hover:text-white"
                }`}
              >
                <PlusCircle className="w-4 h-4 text-emerald-400" />
                <span>{t("onboarding.nav.newProvider")}</span>
              </Link>
            )}

            {isOps && (
              <Link
                href="/staff/ops/queue"
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${
                  pathname === "/staff/ops/queue"
                    ? "bg-slate-800 text-white font-bold"
                    : "hover:bg-slate-800/60 hover:text-white"
                }`}
              >
                <Inbox className="w-4 h-4 text-amber-400" />
                <span>{t("onboarding.nav.opsQueue")}</span>
              </Link>
            )}
          </nav>
        )}

        {/* Right Section: Identity, Locale Toggle, Sign Out */}
        <div className="flex items-center gap-3">
          <LocaleToggle />

          {!isAuthPage && staffStatus?.state === "ACTIVE" && (
            <div className="hidden sm:flex items-center gap-3 ps-3 border-s border-slate-700">
              <div className="text-end">
                <span className="text-xs font-semibold text-white block leading-tight truncate max-w-[140px]">
                  {staffStatus.name}
                </span>
                <span className="text-[10px] font-mono text-slate-400 block leading-tight">
                  {staffStatus.department} • {staffStatus.employeeNumber}
                </span>
              </div>

              <button
                onClick={handleSignOut}
                disabled={isSigningOut}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                title={t("staff.signOut")}
                aria-label={t("staff.signOut")}
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Mobile Menu Button */}
          {!isAuthPage && staffStatus?.state === "ACTIVE" && (
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              aria-label="Toggle navigation menu"
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          )}
        </div>
      </div>

      {/* Mobile Dropdown Menu */}
      {mobileMenuOpen && !isAuthPage && (
        <div className="md:hidden border-t border-slate-800 bg-slate-900 px-4 py-3 space-y-2">
          {staffStatus?.state === "ACTIVE" && (
            <div className="pb-3 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-brand-400" />
                <span className="text-xs font-medium text-slate-200">{staffStatus.name}</span>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                {staffStatus.department}
              </span>
            </div>
          )}

          <nav
            className="flex flex-col gap-1 text-sm font-semibold text-slate-300"
            aria-label="Mobile staff navigation"
          >
            <Link
              href="/staff"
              onClick={() => setMobileMenuOpen(false)}
              className="px-3 py-2 rounded-lg hover:bg-slate-800 hover:text-white flex items-center gap-2"
            >
              <LayoutDashboard className="w-4 h-4 text-brand-400" />
              <span>{t("onboarding.nav.dashboard")}</span>
            </Link>

            <Link
              href="/staff/providers"
              onClick={() => setMobileMenuOpen(false)}
              className="px-3 py-2 rounded-lg hover:bg-slate-800 hover:text-white flex items-center gap-2"
            >
              <Building2 className="w-4 h-4 text-sky-400" />
              <span>{t("onboarding.nav.directory")}</span>
            </Link>

            {isSales && (
              <Link
                href="/staff/providers/new"
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 rounded-lg hover:bg-slate-800 hover:text-white flex items-center gap-2"
              >
                <PlusCircle className="w-4 h-4 text-emerald-400" />
                <span>{t("onboarding.nav.newProvider")}</span>
              </Link>
            )}

            {isOps && (
              <Link
                href="/staff/ops/queue"
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2 rounded-lg hover:bg-slate-800 hover:text-white flex items-center gap-2"
              >
                <Inbox className="w-4 h-4 text-amber-400" />
                <span>{t("onboarding.nav.opsQueue")}</span>
              </Link>
            )}

            <button
              onClick={() => {
                setMobileMenuOpen(false);
                handleSignOut();
              }}
              className="px-3 py-2 rounded-lg hover:bg-slate-800 text-rose-400 flex items-center gap-2 w-full text-start"
            >
              <LogOut className="w-4 h-4" />
              <span>{t("staff.signOut")}</span>
            </button>
          </nav>
        </div>
      )}
    </header>
  );
}
