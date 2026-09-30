"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useI18n } from "@/context/I18nContext";
import { Building2, MapPin, AlertTriangle, Send, Loader2, Edit2 } from "lucide-react";
import type {
  ProviderOrganizationWithBranches,
  ProviderBranchSummary,
} from "@/lib/provider/validation";

export interface CheckAnswersSummaryProps {
  provider: ProviderOrganizationWithBranches;
  branches?: ProviderBranchSummary[];
  onEditOrg?: () => void;
  onSubmitForReview?: () => Promise<void>;
  onSubmit?: () => Promise<void>;
  onBack?: () => void;
  isSubmitting?: boolean;
}

export function CheckAnswersSummary({
  provider,
  branches: propBranches,
  onEditOrg,
  onSubmitForReview,
  onSubmit,
  onBack,
  isSubmitting = false,
}: CheckAnswersSummaryProps) {
  const { t, dir } = useI18n();

  const [confirmOpen, setConfirmOpen] = useState(false);

  const branches = propBranches || provider.branches || [];
  const hasBranches = branches.length > 0;

  const handleSubmit = async () => {
    setConfirmOpen(false);
    if (onSubmitForReview) {
      await onSubmitForReview();
    } else if (onSubmit) {
      await onSubmit();
    }
  };

  return (
    <div className="space-y-6" dir={dir}>
      {/* Top Banner Notice */}
      <div className="p-4 bg-amber-50 border border-amber-200/80 rounded-2xl text-amber-900 text-xs flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div>
          <span className="font-bold text-sm block mb-0.5">
            {t("onboarding.review.checkAnswersTitle")}
          </span>
          <p className="leading-relaxed text-amber-800">{t("onboarding.notice.salesDraftLock")}</p>
        </div>
      </div>

      {/* 1. Organization Legal & Commercial Details Card */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-brand-600" />
            <h3 className="text-sm font-bold text-slate-900">
              {t("onboarding.review.organizationSummary")}
            </h3>
          </div>

          <button
            type="button"
            onClick={onEditOrg}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-brand-700 bg-brand-50 hover:bg-brand-100 transition-colors"
          >
            <Edit2 className="w-3.5 h-3.5" />
            <span>{t("onboarding.directory.editDraft")}</span>
          </button>
        </div>

        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-xs">
          <div>
            <span className="text-slate-400 font-medium block">
              {t("onboarding.providerForm.legalNameLabel")}
            </span>
            <span className="font-semibold text-slate-900 block mt-0.5">{provider.legalName}</span>
          </div>

          <div>
            <span className="text-slate-400 font-medium block">
              {t("onboarding.providerForm.nameEnLabel")}
            </span>
            <span className="font-semibold text-slate-900 block mt-0.5">{provider.nameEn}</span>
          </div>

          <div>
            <span className="text-slate-400 font-medium block">
              {t("onboarding.providerForm.nameArLabel")}
            </span>
            <span className="font-semibold text-slate-900 block mt-0.5">{provider.nameAr}</span>
          </div>

          <div>
            <span className="text-slate-400 font-medium block">
              {t("onboarding.providerForm.taxIdLabel")}
            </span>
            <span dir="ltr" className="font-mono font-semibold text-slate-900 block mt-0.5">
              {provider.taxRegistrationNumber}
            </span>
          </div>

          <div>
            <span className="text-slate-400 font-medium block">
              {t("onboarding.providerForm.crLabel")}
            </span>
            <span dir="ltr" className="font-mono font-semibold text-slate-900 block mt-0.5">
              {provider.commercialRegistrationNumber}
            </span>
          </div>

          <div>
            <span className="text-slate-400 font-medium block">
              {t("onboarding.providerForm.clusterLabel")}
            </span>
            <span className="font-semibold text-slate-900 block mt-0.5">
              {provider.primaryCluster}
            </span>
          </div>

          <div>
            <span className="text-slate-400 font-medium block">
              {t("onboarding.providerForm.contactPersonLabel")}
            </span>
            <span className="font-semibold text-slate-900 block mt-0.5">
              {provider.contactPersonName}
            </span>
          </div>

          <div>
            <span className="text-slate-400 font-medium block">
              {t("onboarding.providerForm.contactEmailLabel")}
            </span>
            <span dir="ltr" className="font-mono text-slate-900 block mt-0.5">
              {provider.contactEmail}
            </span>
          </div>

          <div>
            <span className="text-slate-400 font-medium block">
              {t("onboarding.providerForm.contactPhoneLabel")}
            </span>
            <span dir="ltr" className="font-mono text-slate-900 block mt-0.5">
              {provider.contactPhone}
            </span>
          </div>
        </div>
      </div>

      {/* 2. Branches Summary Card */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-emerald-600" />
            <h3 className="text-sm font-bold text-slate-900">
              {t("onboarding.review.branchesSummary", { count: branches.length })}
            </h3>
          </div>

          <Link
            href={`/staff/providers/${provider.id}/branches/new`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors"
          >
            <span>+ {t("onboarding.branch.addBranch")}</span>
          </Link>
        </div>

        {!hasBranches ? (
          <div className="p-6 text-center text-xs text-rose-700 bg-rose-50/50">
            <p className="font-semibold">{t("onboarding.branch.noBranchesNotice")}</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {branches.map((b: ProviderBranchSummary) => (
              <div
                key={b.id}
                className="p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
              >
                <div className="space-y-1.5 text-xs">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      dir="ltr"
                      className="px-2 py-0.5 rounded font-mono text-[11px] font-bold bg-slate-100 text-slate-700"
                    >
                      {b.branchCode}
                    </span>
                    <span className="font-bold text-slate-900">{b.nameEn}</span>
                    <span className="text-slate-400">•</span>
                    <span className="text-slate-700">{b.nameAr}</span>
                    <span className="text-slate-400">•</span>
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600">
                      {b.status}
                    </span>
                  </div>

                  <p className="text-slate-600 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                    <span>
                      {b.streetAddressEn} ({b.cluster})
                    </span>
                  </p>

                  <div className="flex items-center gap-4 text-slate-500 font-mono text-[11px] flex-wrap">
                    <span dir="ltr">
                      Lat: {b.latitude.toFixed(4)}, Lng: {b.longitude.toFixed(4)}
                    </span>
                    <span dir="ltr">{b.contactPhone}</span>
                  </div>
                </div>

                <Link
                  href={`/staff/providers/${provider.id}/branches/${b.id}/edit`}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors border border-slate-200"
                >
                  {t("onboarding.directory.editDraft")}
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 3. Submit Action Area */}
      <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <span className="text-xs font-bold text-slate-900 block">
            Ready to submit for Operations verification?
          </span>
          <span className="text-xs text-slate-500 block">
            {hasBranches
              ? "All required fields and at least one branch have been captured."
              : t("onboarding.branch.noBranchesNotice")}
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              disabled={isSubmitting}
              className="px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 border border-slate-200 rounded-xl transition-colors"
            >
              {t("common.back") || "Back"}
            </button>
          )}

          <button
            type="button"
            disabled={!hasBranches || isSubmitting}
            onClick={() => setConfirmOpen(true)}
            className="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-xs font-bold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50 transition-colors shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{t("onboarding.review.submitting")}</span>
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                <span>{t("onboarding.review.submitForReview")}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Confirmation Dialog */}
      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-brand-50 text-brand-600 rounded-xl">
                <Send className="w-5 h-5" />
              </div>
              <h4 className="text-base font-bold text-slate-900">
                {t("onboarding.review.confirmSubmitTitle")}
              </h4>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              {t("onboarding.review.confirmSubmitDesc")}
            </p>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                {t("onboarding.providerForm.cancel")}
              </button>

              <button
                type="button"
                onClick={handleSubmit}
                className="px-4 py-2 text-xs font-bold text-white bg-brand-600 hover:bg-brand-700 rounded-lg shadow-xs"
              >
                {t("onboarding.review.confirmSubmitButton")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
