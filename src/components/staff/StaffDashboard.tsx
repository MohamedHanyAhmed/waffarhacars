"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/context/I18nContext";
import {
  ShieldCheck,
  User,
  Building2,
  BadgeCheck,
  LogOut,
  Loader2,
  Lock,
  AlertTriangle,
} from "lucide-react";

interface StaffStatusResponse {
  authenticated: boolean;
  state: string;
  user?: {
    id: string;
    email: string;
    name: string;
  };
  membership?: {
    department: string;
    employeeNumber: string;
    status: string;
  };
}

export function StaffDashboard() {
  const { t, dir } = useI18n();
  const router = useRouter();

  const [data, setData] = useState<StaffStatusResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadStatus() {
      try {
        const res = await fetch("/api/v1/staff/auth/status");
        if (!res.ok) {
          if (mounted) router.replace("/staff/login");
          return;
        }

        const json = await res.json();
        if (!mounted) return;

        if (json.state === "PASSWORD_CHANGE_REQUIRED") {
          router.replace("/staff/activate-password");
          return;
        }
        if (json.state === "MFA_ENROLLMENT_REQUIRED" || json.state === "MFA_ENROLLMENT_PENDING") {
          router.replace("/staff/mfa/enroll");
          return;
        }
        if (json.state === "SUSPENDED") {
          setError(t("staff.suspended"));
          setIsLoading(false);
          return;
        }

        setData(json);
      } catch {
        if (mounted) setError("Failed to load staff session status");
      } finally {
        if (mounted) setIsLoading(false);
      }
    }

    loadStatus();

    return () => {
      mounted = false;
    };
  }, [router, t]);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await fetch("/api/auth/sign-out", {
        method: "POST",
      });
      router.replace("/staff/login");
    } catch {
      router.replace("/staff/login");
    }
  };

  if (isLoading) {
    return (
      <div className="w-full max-w-2xl mx-auto min-h-[300px] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-brand-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="w-full max-w-md mx-auto p-6 bg-rose-50 border border-rose-200 rounded-2xl text-rose-800"
        dir={dir}
      >
        <div className="flex items-center space-x-3 rtl:space-x-reverse mb-3 font-semibold">
          <AlertTriangle className="w-6 h-6 text-rose-600" />
          <span>Access Restricted</span>
        </div>
        <p className="text-sm">{error}</p>
        <button
          onClick={handleSignOut}
          className="mt-4 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-sm font-medium transition-colors"
        >
          {t("staff.signOut")}
        </button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-3xl mx-auto space-y-6" dir={dir}>
      {/* Header Banner */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 p-6 sm:p-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-slate-100">
          <div className="flex items-center space-x-4 rtl:space-x-reverse">
            <div className="p-3.5 bg-brand-50 rounded-2xl text-brand-600">
              <ShieldCheck className="w-8 h-8" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{t("staff.portalTitle")}</h1>
              <p className="text-xs text-slate-500 mt-1">{t("staff.portalSubtitle")}</p>
            </div>
          </div>

          <button
            onClick={handleSignOut}
            disabled={isSigningOut}
            className="flex items-center space-x-2 rtl:space-x-reverse px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-xl text-sm transition-colors"
          >
            {isSigningOut ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <LogOut className="w-4 h-4" />
            )}
            <span>{t("staff.signOut")}</span>
          </button>
        </div>

        {/* Staff Identity Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center space-x-1.5 rtl:space-x-reverse">
              <User className="w-3.5 h-3.5" />
              <span>{t("staff.nameLabel")} / Email</span>
            </span>
            <p className="text-base font-semibold text-slate-900">
              {data?.user?.name || "Staff Member"}
            </p>
            <p className="text-xs text-slate-500 font-mono">{data?.user?.email}</p>
          </div>

          <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center space-x-1.5 rtl:space-x-reverse">
              <Building2 className="w-3.5 h-3.5" />
              <span>{t("staff.departmentLabel")}</span>
            </span>
            <p className="text-base font-semibold text-slate-900">
              {data?.membership?.department || "OPERATIONS"}
            </p>
            <p className="text-xs text-slate-500 font-mono">
              {t("staff.employeeNumberLabel")}: {data?.membership?.employeeNumber}
            </p>
          </div>
        </div>

        {/* Security Assurance Badges */}
        <div className="mt-6 pt-6 border-t border-slate-100 space-y-3">
          <div className="flex items-center justify-between p-3.5 bg-emerald-50 border border-emerald-200/80 rounded-xl text-emerald-900 text-sm">
            <div className="flex items-center space-x-2.5 rtl:space-x-reverse">
              <BadgeCheck className="w-5 h-5 text-emerald-600 flex-shrink-0" />
              <div>
                <span className="font-semibold block">{t("staff.mfaStatusLabel")}</span>
                <span className="text-xs text-emerald-700">{t("staff.mfaEnforced")}</span>
              </div>
            </div>
            <span className="px-2.5 py-1 bg-emerald-100 font-mono text-xs font-bold rounded-lg text-emerald-800">
              ACTIVE
            </span>
          </div>

          <div className="flex items-center justify-between p-3.5 bg-slate-50 border border-slate-200/80 rounded-xl text-slate-800 text-sm">
            <div className="flex items-center space-x-2.5 rtl:space-x-reverse">
              <Lock className="w-5 h-5 text-slate-600 flex-shrink-0" />
              <div>
                <span className="font-semibold block">{t("staff.trustedDevicePolicy")}</span>
                <span className="text-xs text-slate-500">{t("staff.trustedDeviceEnforced")}</span>
              </div>
            </div>
            <span className="px-2.5 py-1 bg-slate-200 font-mono text-xs font-semibold rounded-lg text-slate-700">
              ZERO-BYPASS
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
