"use client";

import React, { useState } from "react";
import { useI18n } from "@/context/I18nContext";
import { X, PauseCircle, PlayCircle, Loader2 } from "lucide-react";

export interface PauseResumeModalProps {
  isOpen: boolean;
  mode: "PAUSE" | "RESUME";
  entityName: string;
  onClose: () => void;
  onConfirm: (data: { reasonCode?: string; pauseReason?: string }) => Promise<void>;
}

const PAUSE_REASONS = [
  { value: "OPERATIONAL_HOLD", label: "Temporary Operational Maintenance" },
  { value: "COMPLIANCE_HOLD", label: "Compliance & Inspection Review" },
  { value: "CONTACT_UNREACHABLE", label: "Contact Phone / Schedule Unavailable" },
  { value: "OTHER", label: "Other Administrative Hold" },
];

export function PauseResumeModal({
  isOpen,
  mode,
  entityName,
  onClose,
  onConfirm,
}: PauseResumeModalProps) {
  const { t, dir } = useI18n();

  const [reasonCode, setReasonCode] = useState("OPERATIONAL_HOLD");
  const [pauseReason, setPauseReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "PAUSE" && !pauseReason.trim()) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      await onConfirm(mode === "PAUSE" ? { reasonCode, pauseReason: pauseReason.trim() } : {});
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Action failed";
      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
      dir={dir}
      role="dialog"
      aria-modal="true"
      aria-labelledby="pause-resume-title"
    >
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md overflow-hidden animate-in fade-in-50 zoom-in-95 duration-150">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div
              className={`p-2 rounded-xl ${
                mode === "PAUSE" ? "bg-orange-50 text-orange-600" : "bg-emerald-50 text-emerald-600"
              }`}
            >
              {mode === "PAUSE" ? (
                <PauseCircle className="w-5 h-5" />
              ) : (
                <PlayCircle className="w-5 h-5" />
              )}
            </div>
            <div>
              <h3 id="pause-resume-title" className="text-base font-bold text-slate-900">
                {mode === "PAUSE"
                  ? t("onboarding.modals.pauseTitle")
                  : t("onboarding.modals.resumeTitle")}
              </h3>
              <p className="text-xs text-slate-500 font-medium truncate max-w-xs">{entityName}</p>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-brand-500"
            aria-label={t("onboarding.modals.cancel")}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <p className="text-xs text-slate-600 leading-relaxed">
            {mode === "PAUSE"
              ? t("onboarding.modals.pauseDesc")
              : t("onboarding.modals.resumeDesc")}
          </p>

          {errorMessage && (
            <div
              role="alert"
              className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-medium"
            >
              {errorMessage}
            </div>
          )}

          {mode === "PAUSE" && (
            <>
              <div>
                <label
                  htmlFor="pause-reason-code"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  {t("onboarding.modals.pauseReasonCode")}
                </label>
                <select
                  id="pause-reason-code"
                  value={reasonCode}
                  disabled={isSubmitting}
                  onChange={(e) => setReasonCode(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-500 bg-white"
                >
                  {PAUSE_REASONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="pause-reason-notes"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  {t("onboarding.modals.reasonNoteLabel")} <span className="text-rose-600">*</span>
                </label>
                <textarea
                  id="pause-reason-notes"
                  rows={3}
                  required
                  disabled={isSubmitting}
                  value={pauseReason}
                  placeholder={t("onboarding.modals.pauseNotePlaceholder")}
                  onChange={(e) => setPauseReason(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-500"
                />
              </div>
            </>
          )}

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              {t("onboarding.modals.cancel")}
            </button>

            <button
              type="submit"
              disabled={isSubmitting || (mode === "PAUSE" && !pauseReason.trim())}
              className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white rounded-lg transition-colors shadow-xs disabled:opacity-50 ${
                mode === "PAUSE"
                  ? "bg-orange-600 hover:bg-orange-700"
                  : "bg-emerald-600 hover:bg-emerald-700"
              }`}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Submitting...</span>
                </>
              ) : (
                <span>{mode === "PAUSE" ? "Pause Entity" : "Resume Entity"}</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
