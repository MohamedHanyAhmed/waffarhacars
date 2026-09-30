"use client";

import React, { useState } from "react";
import { useI18n } from "@/context/I18nContext";
import { X, AlertOctagon, RefreshCw, Loader2 } from "lucide-react";

export interface BranchRejectModalProps {
  isOpen: boolean;
  branchName: string;
  onClose: () => void;
  onConfirm: (data: {
    remediable: boolean;
    reasonCode: string;
    rejectionReason: string;
  }) => Promise<void>;
}

const ALLOWED_REASON_CODES = [
  { value: "UNVERIFIED_LOCATION", label: "Unverified Physical Location" },
  { value: "CONTACT_UNREACHABLE", label: "Contact / Hours Unreachable" },
  { value: "INCOMPLETE_DOCUMENTATION", label: "Incomplete Documentation" },
  { value: "INVALID_TAX_OR_CR", label: "Invalid Commercial Registry / Tax Match" },
  { value: "COMPLIANCE_HOLD", label: "Compliance & Safety Violation" },
  { value: "OTHER", label: "Other Operational Reason" },
];

export function BranchRejectModal({
  isOpen,
  branchName,
  onClose,
  onConfirm,
}: BranchRejectModalProps) {
  const { t, dir } = useI18n();

  const [remediable, setRemediable] = useState(true);
  const [reasonCode, setReasonCode] = useState("UNVERIFIED_LOCATION");
  const [rejectionReason, setRejectionReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectionReason.trim() || isSubmitting) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      await onConfirm({
        remediable,
        reasonCode,
        rejectionReason: rejectionReason.trim(),
      });
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to reject branch";
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
      aria-labelledby="branch-reject-title"
    >
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-lg overflow-hidden animate-in fade-in-50 zoom-in-95 duration-150">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-rose-50 rounded-xl text-rose-600">
              <AlertOctagon className="w-5 h-5" />
            </div>
            <div>
              <h3 id="branch-reject-title" className="text-base font-bold text-slate-900">
                {t("onboarding.modals.branchRejectTitle")}
              </h3>
              <p className="text-xs text-slate-500 font-medium truncate max-w-xs">{branchName}</p>
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
          {errorMessage && (
            <div
              role="alert"
              className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-medium"
            >
              {errorMessage}
            </div>
          )}

          {/* Remediable vs Terminal Selector */}
          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-800">
              {t("onboarding.modals.rejectionType")}
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setRemediable(true)}
                className={`p-3 rounded-xl border text-start transition-all ${
                  remediable
                    ? "border-amber-500 bg-amber-50/70 ring-2 ring-amber-400/40"
                    : "border-slate-200 hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center gap-1.5 font-bold text-xs text-amber-900 mb-1">
                  <RefreshCw className="w-3.5 h-3.5 text-amber-600" />
                  <span>Remediable</span>
                </div>
                <p className="text-[11px] text-amber-800 leading-snug">
                  {t("onboarding.modals.remediableDesc")}
                </p>
              </button>

              <button
                type="button"
                onClick={() => setRemediable(false)}
                className={`p-3 rounded-xl border text-start transition-all ${
                  !remediable
                    ? "border-rose-500 bg-rose-50/70 ring-2 ring-rose-400/40"
                    : "border-slate-200 hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center gap-1.5 font-bold text-xs text-rose-900 mb-1">
                  <AlertOctagon className="w-3.5 h-3.5 text-rose-600" />
                  <span>Terminal</span>
                </div>
                <p className="text-[11px] text-rose-800 leading-snug">
                  {t("onboarding.modals.terminalDesc")}
                </p>
              </button>
            </div>
          </div>

          {/* Reason Code */}
          <div>
            <label
              htmlFor="branch-reason-code"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              {t("onboarding.modals.reasonCodeLabel")}
            </label>
            <select
              id="branch-reason-code"
              value={reasonCode}
              disabled={isSubmitting}
              onChange={(e) => setReasonCode(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-500 bg-white"
            >
              {ALLOWED_REASON_CODES.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Details / Notes */}
          <div>
            <label
              htmlFor="branch-rejection-notes"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              {t("onboarding.modals.reasonNoteLabel")} <span className="text-rose-600">*</span>
            </label>
            <textarea
              id="branch-rejection-notes"
              rows={3}
              required
              disabled={isSubmitting}
              value={rejectionReason}
              placeholder={t("onboarding.modals.reasonNotePlaceholder")}
              onChange={(e) => setRejectionReason(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-500"
            />
          </div>

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
              disabled={!rejectionReason.trim() || isSubmitting}
              className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white rounded-lg transition-colors shadow-xs disabled:opacity-50 ${
                remediable ? "bg-amber-600 hover:bg-amber-700" : "bg-rose-600 hover:bg-rose-700"
              }`}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Submitting...</span>
                </>
              ) : (
                <span>{remediable ? "Return to Draft" : "Decommission Permanently"}</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
