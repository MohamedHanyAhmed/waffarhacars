"use client";

import React, { useState } from "react";
import { useI18n } from "@/context/I18nContext";
import { CheckCircle2, X, AlertTriangle, ShieldCheck, Loader2 } from "lucide-react";

export interface BranchVettingModalProps {
  isOpen: boolean;
  branchName: string;
  onClose: () => void;
  onConfirm: (data: {
    legalIdentityChecked: boolean;
    physicalLocationChecked: boolean;
    contactAndHoursChecked: boolean;
    evidenceDocumentRef: string;
  }) => Promise<void>;
}

const EVIDENCE_REGEX = /^[A-Za-z0-9_-]{3,64}$/;

export function BranchVettingModal({
  isOpen,
  branchName,
  onClose,
  onConfirm,
}: BranchVettingModalProps) {
  const { t, dir } = useI18n();

  const [legalIdentity, setLegalIdentity] = useState(false);
  const [physicalLocation, setPhysicalLocation] = useState(false);
  const [contactHours, setContactHours] = useState(false);
  const [evidenceRef, setEvidenceRef] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const isEvidenceValid = EVIDENCE_REGEX.test(evidenceRef.trim());
  const canActivate = legalIdentity && physicalLocation && contactHours && isEvidenceValid;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canActivate || isSubmitting) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      await onConfirm({
        legalIdentityChecked: legalIdentity,
        physicalLocationChecked: physicalLocation,
        contactAndHoursChecked: contactHours,
        evidenceDocumentRef: evidenceRef.trim(),
      });
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to activate branch";
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
      aria-labelledby="vetting-modal-title"
    >
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-lg overflow-hidden animate-in fade-in-50 zoom-in-95 duration-150">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-50 rounded-xl text-emerald-600">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 id="vetting-modal-title" className="text-base font-bold text-slate-900">
                {t("onboarding.modals.branchActivateTitle")}
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
          <div className="p-3 bg-amber-50 border border-amber-200/80 rounded-xl text-amber-900 text-xs flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="leading-relaxed">{t("onboarding.vetting.attestationWarning")}</p>
          </div>

          {errorMessage && (
            <div
              role="alert"
              className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-medium"
            >
              {errorMessage}
            </div>
          )}

          {/* 3 Offline Checklist Attestations */}
          <div className="space-y-3 pt-1">
            <label className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 hover:bg-slate-50/80 cursor-pointer transition-colors">
              <input
                type="checkbox"
                id="check-legal-identity"
                checked={legalIdentity}
                disabled={isSubmitting}
                onChange={(e) => setLegalIdentity(e.target.checked)}
                className="w-4 h-4 rounded text-brand-600 focus:ring-brand-500 border-slate-300 mt-0.5"
              />
              <span className="text-xs text-slate-700 font-medium leading-relaxed">
                {t("onboarding.vetting.check1")}
              </span>
            </label>

            <label className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 hover:bg-slate-50/80 cursor-pointer transition-colors">
              <input
                type="checkbox"
                id="check-physical-location"
                checked={physicalLocation}
                disabled={isSubmitting}
                onChange={(e) => setPhysicalLocation(e.target.checked)}
                className="w-4 h-4 rounded text-brand-600 focus:ring-brand-500 border-slate-300 mt-0.5"
              />
              <span className="text-xs text-slate-700 font-medium leading-relaxed">
                {t("onboarding.vetting.check2")}
              </span>
            </label>

            <label className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 hover:bg-slate-50/80 cursor-pointer transition-colors">
              <input
                type="checkbox"
                id="check-contact-hours"
                checked={contactHours}
                disabled={isSubmitting}
                onChange={(e) => setContactHours(e.target.checked)}
                className="w-4 h-4 rounded text-brand-600 focus:ring-brand-500 border-slate-300 mt-0.5"
              />
              <span className="text-xs text-slate-700 font-medium leading-relaxed">
                {t("onboarding.vetting.check3")}
              </span>
            </label>
          </div>

          {/* Opaque Evidence Document Reference */}
          <div className="pt-2">
            <label
              htmlFor="evidence-document-ref"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              {t("onboarding.vetting.evidenceRefLabel")} <span className="text-rose-600">*</span>
            </label>
            <input
              id="evidence-document-ref"
              type="text"
              required
              disabled={isSubmitting}
              value={evidenceRef}
              dir="ltr"
              placeholder={t("onboarding.vetting.evidenceRefPlaceholder")}
              onChange={(e) => setEvidenceRef(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-500 font-mono"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              {t("onboarding.vetting.evidenceRefHelp")}
            </p>
            {evidenceRef.length > 0 && !isEvidenceValid && (
              <p className="text-[11px] text-rose-600 font-medium mt-1">
                Must be alphanumeric with optional dashes or underscores (3 to 64 characters).
              </p>
            )}
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
              disabled={!canActivate || isSubmitting}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg transition-colors shadow-xs"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{t("onboarding.vetting.activatingBranch")}</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{t("onboarding.vetting.activateBranch")}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
