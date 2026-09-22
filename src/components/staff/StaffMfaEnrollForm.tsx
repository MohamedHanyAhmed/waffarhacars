"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/context/I18nContext";
import { QrCodeSvg } from "./QrCodeSvg";
import {
  ShieldAlert,
  ShieldCheck,
  AlertCircle,
  Loader2,
  Lock,
  Copy,
  Check,
  CheckCircle2,
  Key,
} from "lucide-react";

type EnrollStep = "password" | "setup" | "backup_codes";

export function StaffMfaEnrollForm() {
  const { t, dir } = useI18n();
  const router = useRouter();

  const [step, setStep] = useState<EnrollStep>("password");
  const [password, setPassword] = useState("");
  const [totpURI, setTotpURI] = useState<string>("");
  const [secret, setSecret] = useState<string>("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [verifyCode, setVerifyCode] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [copiedAllCodes, setCopiedAllCodes] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1: Initiate MFA Setup
  const handleInitiate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/two-factor/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password,
          method: "totp",
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          data.message || data.error || "Failed to initiate MFA setup. Check your password."
        );
        setIsLoading(false);
        return;
      }

      const data = await res.json();
      setTotpURI(data.totpURI || "");
      setBackupCodes(data.backupCodes || []);

      // Extract secret from totpURI (otpauth://totp/...?secret=...)
      try {
        const url = new URL(data.totpURI);
        const secretParam = url.searchParams.get("secret");
        setSecret(secretParam || "");
      } catch {
        setSecret("");
      }

      setStep("setup");
    } catch {
      setError("Network error initiating MFA setup. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  // Step 2: Verify TOTP Code
  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/two-factor/verify-totp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: verifyCode.trim(),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          data.message || data.error || "Invalid authenticator code. Please check and try again."
        );
        setIsLoading(false);
        return;
      }

      setStep("backup_codes");
    } catch {
      setError("Verification failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = async (text: string, setCopied: (val: boolean) => void) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  return (
    <div
      className="w-full max-w-lg mx-auto bg-white rounded-2xl shadow-xl border border-slate-100 p-6 sm:p-8"
      dir={dir}
    >
      <div className="flex items-center space-x-3 rtl:space-x-reverse mb-6">
        <div className="p-3 bg-brand-50 rounded-xl text-brand-600">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">{t("staff.mfaEnrollTitle")}</h1>
          <p className="text-xs text-slate-500 mt-0.5">{t("staff.mfaEnrollSubtitle")}</p>
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

      {/* STEP 1: Enter Password to Enable */}
      {step === "password" && (
        <form onSubmit={handleInitiate} className="space-y-4">
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 text-sm text-slate-600">
            <p className="font-semibold text-slate-800 mb-1">{t("staff.mfaStep1")}</p>
            <p className="text-xs text-slate-500">
              For security, confirm your current password to generate your TOTP authenticator secret
              and backup recovery keys.
            </p>
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
            disabled={isLoading || !password}
            className="w-full mt-2 py-3 px-4 bg-brand-600 hover:bg-brand-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white font-medium rounded-xl shadow-sm transition-colors flex items-center justify-center space-x-2 rtl:space-x-reverse"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>{t("staff.initiatingMfa")}</span>
              </>
            ) : (
              <span>{t("staff.initiateMfaButton")}</span>
            )}
          </button>
        </form>
      )}

      {/* STEP 2: Scan QR & Enter 6-digit Code */}
      {step === "setup" && (
        <form onSubmit={handleVerify} className="space-y-5">
          <div className="text-sm text-slate-600 space-y-1">
            <p className="font-semibold text-slate-800">{t("staff.mfaStep2")}</p>
            <p className="text-xs text-slate-500">{t("staff.scanQrDesc")}</p>
          </div>

          {/* QR Code Container */}
          <div className="flex justify-center py-2">
            <QrCodeSvg value={totpURI} size={190} />
          </div>

          {/* Manual Secret Box */}
          {secret && (
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs">
              <span className="text-slate-500 block mb-1 font-medium">
                {t("staff.manualSecretLabel")}:
              </span>
              <div className="flex items-center justify-between">
                <code className="font-mono text-slate-800 font-bold tracking-wider break-all">
                  {secret}
                </code>
                <button
                  type="button"
                  onClick={() => copyToClipboard(secret, setCopiedSecret)}
                  className="ml-2 rtl:ml-0 rtl:mr-2 px-2.5 py-1 text-xs bg-white border border-slate-300 hover:bg-slate-100 rounded-lg text-slate-700 flex items-center space-x-1 rtl:space-x-reverse flex-shrink-0"
                >
                  {copiedSecret ? (
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>{copiedSecret ? t("staff.copied") : t("staff.copySecret")}</span>
                </button>
              </div>
            </div>
          )}

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
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ""))}
                placeholder={t("staff.totpCodePlaceholder")}
                className="w-full pl-10 rtl:pl-3 rtl:pr-10 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 font-mono text-lg tracking-widest text-center placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all"
                disabled={isLoading}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading || verifyCode.length !== 6}
            className="w-full py-3 px-4 bg-brand-600 hover:bg-brand-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white font-medium rounded-xl shadow-sm transition-colors flex items-center justify-center space-x-2 rtl:space-x-reverse"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>{t("staff.verifyingMfa")}</span>
              </>
            ) : (
              <span>{t("staff.verifyAndEnableButton")}</span>
            )}
          </button>
        </form>
      )}

      {/* STEP 3: Backup Recovery Codes */}
      {step === "backup_codes" && (
        <div className="space-y-5">
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-sm">
            <div className="flex items-center space-x-2 rtl:space-x-reverse mb-1 font-semibold">
              <ShieldCheck className="w-5 h-5 text-amber-600" />
              <span>{t("staff.backupCodesTitle")}</span>
            </div>
            <p className="text-xs text-amber-800">{t("staff.backupCodesWarning")}</p>
          </div>

          <div className="bg-slate-900 p-4 rounded-xl shadow-inner">
            <div className="grid grid-cols-2 gap-2 font-mono text-sm text-emerald-400">
              {backupCodes.map((code, idx) => (
                <div
                  key={idx}
                  className="px-2 py-1 bg-slate-800/60 rounded border border-slate-700/50 text-center"
                >
                  {code}
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => copyToClipboard(backupCodes.join("\n"), setCopiedAllCodes)}
              className="px-3 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg text-slate-700 flex items-center space-x-1.5 rtl:space-x-reverse"
            >
              {copiedAllCodes ? (
                <Check className="w-4 h-4 text-emerald-600" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
              <span>{copiedAllCodes ? t("staff.copied") : t("staff.copyAllCodes")}</span>
            </button>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-start space-x-3 rtl:space-x-reverse">
            <input
              type="checkbox"
              id="ack-backup"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-1 h-4 w-4 text-brand-600 rounded border-slate-300 focus:ring-brand-500 cursor-pointer"
            />
            <label
              htmlFor="ack-backup"
              className="text-xs text-slate-700 font-medium cursor-pointer select-none"
            >
              {t("staff.acknowledgeBackupCodes")}
            </label>
          </div>

          <button
            type="button"
            disabled={!acknowledged}
            onClick={() => router.push("/staff")}
            className="w-full py-3 px-4 bg-brand-600 hover:bg-brand-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white font-medium rounded-xl shadow-sm transition-colors flex items-center justify-center space-x-2 rtl:space-x-reverse"
          >
            <CheckCircle2 className="w-5 h-5" />
            <span>{t("staff.continueToPortal")}</span>
          </button>
        </div>
      )}
    </div>
  );
}
