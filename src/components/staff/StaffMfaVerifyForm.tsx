"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/context/I18nContext";
import { ShieldCheck, AlertCircle, Loader2, Key, LifeBuoy } from "lucide-react";

type VerifyMode = "totp" | "backup_code";

export function StaffMfaVerifyForm() {
  const { t, dir } = useI18n();
  const router = useRouter();

  const [mode, setMode] = useState<VerifyMode>("totp");
  const [code, setCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const endpoint =
      mode === "totp"
        ? "/api/auth/two-factor/verify-totp"
        : "/api/auth/two-factor/verify-backup-code";

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: code.trim(),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message || data.error || "Invalid verification code");
        setIsLoading(false);
        return;
      }

      // Check status to see if password change required or proceed to staff portal
      const statusRes = await fetch("/api/v1/staff/auth/status");
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        if (statusData.state === "PASSWORD_CHANGE_REQUIRED") {
          router.push("/staff/activate-password");
          return;
        }
      }

      router.push("/staff");
    } catch {
      setError("Verification failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="w-full max-w-md mx-auto bg-white rounded-2xl shadow-xl border border-slate-100 p-6 sm:p-8"
      dir={dir}
    >
      <div className="flex items-center space-x-3 rtl:space-x-reverse mb-6">
        <div className="p-3 bg-brand-50 rounded-xl text-brand-600">
          <ShieldCheck className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">{t("staff.mfaVerifyTitle")}</h1>
          <p className="text-xs text-slate-500 mt-0.5">{t("staff.mfaVerifySubtitle")}</p>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-6 p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-start space-x-3 rtl:space-x-reverse text-rose-800 text-sm"
        >
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-rose-600" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {mode === "totp" ? (
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">
              {t("staff.totpCodeLabel")}
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 rtl:left-auto rtl:right-0 flex items-center pl-3 rtl:pl-0 rtl:pr-3 text-slate-400">
                <Key className="w-5 h-5" />
              </span>
              <input
                type="text"
                required
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder={t("staff.totpCodePlaceholder")}
                className="w-full pl-10 rtl:pl-3 rtl:pr-10 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 font-mono text-lg tracking-widest text-center placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                disabled={isLoading}
              />
            </div>
          </div>
        ) : (
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">
              {t("staff.backupCodeLabel")}
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 rtl:left-auto rtl:right-0 flex items-center pl-3 rtl:pl-0 rtl:pr-3 text-slate-400">
                <LifeBuoy className="w-5 h-5" />
              </span>
              <input
                type="text"
                required
                value={code}
                onChange={(e) => setCode(e.target.value.trim())}
                placeholder={t("staff.backupCodePlaceholder")}
                className="w-full pl-10 rtl:pl-3 rtl:pr-10 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 font-mono text-center placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                disabled={isLoading}
              />
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={isLoading || !code}
          className="w-full mt-2 py-3 px-4 bg-brand-600 hover:bg-brand-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white font-medium rounded-xl shadow-sm transition-colors flex items-center justify-center space-x-2 rtl:space-x-reverse"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>{t("staff.verifying")}</span>
            </>
          ) : (
            <span>{t("staff.verifyButton")}</span>
          )}
        </button>

        <div className="text-center pt-2">
          <button
            type="button"
            onClick={() => {
              setCode("");
              setError(null);
              setMode((prev) => (prev === "totp" ? "backup_code" : "totp"));
            }}
            className="text-xs text-brand-600 hover:text-brand-800 font-medium hover:underline transition-colors"
          >
            {mode === "totp" ? t("staff.useBackupCodeLink") : t("staff.useTotpCodeLink")}
          </button>
        </div>
      </form>
    </div>
  );
}
