"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/context/I18nContext";
import { KeyRound, AlertCircle, Loader2, Lock, CheckCircle2 } from "lucide-react";

export function StaffActivatePasswordForm() {
  const { t, dir } = useI18n();
  const router = useRouter();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 12) {
      setError(t("staff.passwordTooShort"));
      return;
    }

    if (newPassword !== confirmPassword) {
      setError(t("staff.passwordMismatch"));
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch("/api/v1/staff/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to update password");
        setIsLoading(false);
        return;
      }

      setSuccess(true);
      // Check status and proceed to MFA enrollment
      setTimeout(() => {
        router.push("/staff/mfa/enroll");
      }, 1000);
    } catch {
      setError("An unexpected error occurred. Please try again.");
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
        <div className="p-3 bg-amber-50 rounded-xl text-amber-600">
          <KeyRound className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">{t("staff.activatePasswordTitle")}</h1>
          <p className="text-xs text-slate-500 mt-0.5">{t("staff.activatePasswordSubtitle")}</p>
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

      {success && (
        <div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start space-x-3 rtl:space-x-reverse text-emerald-800 text-sm">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5 text-emerald-600" />
          <span>Password updated successfully. Redirecting to MFA setup...</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1">
            {t("staff.currentPasswordLabel")}
          </label>
          <div className="relative">
            <span className="absolute inset-y-0 left-0 rtl:left-auto rtl:right-0 flex items-center pl-3 rtl:pl-0 rtl:pr-3 text-slate-400">
              <Lock className="w-5 h-5" />
            </span>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder={t("staff.currentPasswordPlaceholder")}
              className="w-full pl-10 rtl:pl-3 rtl:pr-10 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all text-sm"
              disabled={isLoading || success}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1">
            {t("staff.newPasswordLabel")}
          </label>
          <div className="relative">
            <span className="absolute inset-y-0 left-0 rtl:left-auto rtl:right-0 flex items-center pl-3 rtl:pl-0 rtl:pr-3 text-slate-400">
              <Lock className="w-5 h-5" />
            </span>
            <input
              type="password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={t("staff.newPasswordPlaceholder")}
              className="w-full pl-10 rtl:pl-3 rtl:pr-10 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all text-sm"
              disabled={isLoading || success}
            />
          </div>
          <p className="text-xs text-slate-400 mt-1">{t("staff.passwordRequirements")}</p>
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1">
            {t("staff.confirmPasswordLabel")}
          </label>
          <div className="relative">
            <span className="absolute inset-y-0 left-0 rtl:left-auto rtl:right-0 flex items-center pl-3 rtl:pl-0 rtl:pr-3 text-slate-400">
              <Lock className="w-5 h-5" />
            </span>
            <input
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={t("staff.confirmPasswordPlaceholder")}
              className="w-full pl-10 rtl:pl-3 rtl:pr-10 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all text-sm"
              disabled={isLoading || success}
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={isLoading || success || !currentPassword || !newPassword || !confirmPassword}
          className="w-full mt-2 py-3 px-4 bg-brand-600 hover:bg-brand-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white font-medium rounded-xl shadow-sm transition-colors flex items-center justify-center space-x-2 rtl:space-x-reverse"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>{t("staff.updatingPassword")}</span>
            </>
          ) : (
            <span>{t("staff.updatePasswordButton")}</span>
          )}
        </button>
      </form>
    </div>
  );
}
