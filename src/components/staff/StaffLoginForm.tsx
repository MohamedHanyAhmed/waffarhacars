"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/context/I18nContext";
import { ShieldCheck, AlertCircle, Loader2, Lock, Mail } from "lucide-react";

export function StaffLoginForm() {
  const { t, dir } = useI18n();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
        }),
      });

      if (!res.ok) {
        if (res.status === 429) {
          setError(t("staff.rateLimitError"));
        } else {
          setError(t("staff.invalidCredentials"));
        }
        setIsLoading(false);
        return;
      }

      const data = await res.json().catch(() => ({}));

      // If user has 2FA enabled, Better Auth returns twoFactorRedirect
      if (data?.twoFactorRedirect) {
        router.push("/staff/mfa/verify");
        return;
      }

      // Check staff lifecycle state
      const statusRes = await fetch("/api/v1/staff/auth/status");
      if (!statusRes.ok) {
        setError(t("staff.unauthorized"));
        setIsLoading(false);
        return;
      }

      const statusData = await statusRes.json();
      if (statusData.state === "PASSWORD_CHANGE_REQUIRED") {
        router.push("/staff/activate-password");
      } else if (statusData.state === "MFA_ENROLLMENT_REQUIRED") {
        router.push("/staff/mfa/enroll");
      } else if (statusData.state === "ACTIVE") {
        router.push("/staff");
      } else if (statusData.state === "SUSPENDED") {
        setError(t("staff.suspended"));
      } else {
        router.push("/staff");
      }
    } catch {
      setError(t("staff.invalidCredentials"));
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
          <h1 className="text-xl font-bold text-slate-900">{t("staff.loginTitle")}</h1>
          <p className="text-xs text-slate-500 mt-0.5">{t("staff.loginSubtitle")}</p>
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
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1">
            {t("staff.emailLabel")}
          </label>
          <div className="relative">
            <span className="absolute inset-y-0 left-0 rtl:left-auto rtl:right-0 flex items-center pl-3 rtl:pl-0 rtl:pr-3 text-slate-400">
              <Mail className="w-5 h-5" />
            </span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("staff.emailPlaceholder")}
              className="w-full pl-10 rtl:pl-3 rtl:pr-10 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all text-sm"
              disabled={isLoading}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1">
            {t("staff.passwordLabel")}
          </label>
          <div className="relative">
            <span className="absolute inset-y-0 left-0 rtl:left-auto rtl:right-0 flex items-center pl-3 rtl:pl-0 rtl:pr-3 text-slate-400">
              <Lock className="w-5 h-5" />
            </span>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("staff.passwordPlaceholder")}
              className="w-full pl-10 rtl:pl-3 rtl:pr-10 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all text-sm"
              disabled={isLoading}
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={isLoading || !email || !password}
          className="w-full mt-2 py-3 px-4 bg-brand-600 hover:bg-brand-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white font-medium rounded-xl shadow-sm transition-colors flex items-center justify-center space-x-2 rtl:space-x-reverse"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>{t("staff.signingIn")}</span>
            </>
          ) : (
            <span>{t("staff.signInButton")}</span>
          )}
        </button>
      </form>
    </div>
  );
}
