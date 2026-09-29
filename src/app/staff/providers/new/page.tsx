"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "@/context/I18nContext";
import {
  Building2,
  ArrowLeft,
  Save,
  Loader2,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import type { CairoCluster } from "@/lib/provider/validation";

export default function NewProviderPage() {
  const { t, dir } = useI18n();
  const router = useRouter();

  // Form State
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [legalName, setLegalName] = useState("");
  const [taxRegistrationNumber, setTaxRegistrationNumber] = useState("");
  const [commercialRegistrationNumber, setCommercialRegistrationNumber] = useState("");
  const [primaryCluster, setPrimaryCluster] = useState<CairoCluster>("NASR_CITY_HELIOPOLIS");
  const [contactPersonName, setContactPersonName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("+20");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [uncertainOutcome, setUncertainOutcome] = useState(false);

  const handleFieldChange = (setter: React.Dispatch<React.SetStateAction<string>>) => {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setter(e.target.value);
      setIsDirty(true);
      setFieldErrors({});
      setGeneralError(null);
      setUncertainOutcome(false);
    };
  };

  const validate = (): boolean => {
    const errors: Record<string, string> = {};

    if (!nameEn.trim()) errors.nameEn = "English commercial name is required";
    if (!nameAr.trim()) errors.nameAr = "Arabic commercial name is required";
    if (!legalName.trim()) errors.legalName = "Legal entity name is required";

    const cleanTax = taxRegistrationNumber.trim();
    if (!/^\d{9}$/.test(cleanTax)) {
      errors.taxRegistrationNumber = "Tax Registration Number must be exactly 9 digits";
    }

    if (!commercialRegistrationNumber.trim()) {
      errors.commercialRegistrationNumber = "Commercial Registration Number is required";
    }

    if (!contactPersonName.trim()) {
      errors.contactPersonName = "Contact person name is required";
    }

    if (!contactEmail.trim() || !contactEmail.includes("@")) {
      errors.contactEmail = "Valid contact email is required";
    }

    if (!/^\+20\d{9,10}$/.test(contactPhone.trim())) {
      errors.contactPhone = "Egyptian phone number required (+20 followed by 9-10 digits)";
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    if (!validate()) {
      setGeneralError("Please review the highlighted validation errors.");
      return;
    }

    setIsSubmitting(true);
    setGeneralError(null);
    setUncertainOutcome(false);

    try {
      const res = await fetch("/api/v1/staff/providers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          nameEn: nameEn.trim(),
          nameAr: nameAr.trim(),
          legalName: legalName.trim(),
          taxRegistrationNumber: taxRegistrationNumber.trim(),
          commercialRegistrationNumber: commercialRegistrationNumber.trim(),
          primaryCluster,
          contactPersonName: contactPersonName.trim(),
          contactEmail: contactEmail.trim().toLowerCase(),
          contactPhone: contactPhone.trim(),
        }),
      });

      if (res.status === 401) {
        router.replace("/staff/login");
        return;
      }

      if (res.status === 403) {
        setGeneralError("Access Denied: Only Sales agents can create provider drafts.");
        setIsSubmitting(false);
        return;
      }

      const json = await res.json().catch(() => ({}));

      if (res.status === 409) {
        setGeneralError(json.message || "A provider with this Tax ID or CR already exists.");
        setIsSubmitting(false);
        return;
      }

      if (!res.ok) {
        if (json.details && typeof json.details === "object") {
          setFieldErrors(json.details);
        }
        setGeneralError(json.message || "Failed to create provider draft.");
        setIsSubmitting(false);
        return;
      }

      // Success -> navigate to provider detail page to add branches
      setIsDirty(false);
      const targetId = json.id || json.provider?.id;
      router.push(`/staff/providers/${targetId}`);
    } catch {
      // Network timeout / unknown outcome: do NOT create blindly again
      setUncertainOutcome(true);
      setGeneralError(
        "Network connection interrupted. The server outcome is unconfirmed. Do NOT submit again blindly; please check the Provider Directory to reconcile before attempting again."
      );
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6" dir={dir}>
      {/* Top Header & Breadcrumb */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link
            href="/staff/providers"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-brand-600 transition-colors mb-2"
          >
            <ArrowLeft className="w-4 h-4 rtl:rotate-180" />
            <span>{t("onboarding.nav.backToDirectory")}</span>
          </Link>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
            <Building2 className="w-7 h-7 text-brand-600" />
            <span>{t("onboarding.providerForm.newTitle")}</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">{t("onboarding.providerForm.newSubtitle")}</p>
        </div>

        {/* Saved/Unsaved Status Indicator */}
        <div className="flex items-center gap-2">
          {isDirty ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">
              <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
              <span>{t("onboarding.providerForm.unsavedChanges")}</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200">
              <CheckCircle2 className="w-3.5 h-3.5 text-slate-400" />
              <span>{t("onboarding.providerForm.allChangesSaved")}</span>
            </span>
          )}
        </div>
      </div>

      {/* Error Summary Banner */}
      {generalError && (
        <div
          role="alert"
          className={`p-4 rounded-2xl text-xs flex items-start gap-3 ${
            uncertainOutcome
              ? "bg-amber-50 border border-amber-300 text-amber-950"
              : "bg-rose-50 border border-rose-200 text-rose-900"
          }`}
        >
          {uncertainOutcome ? (
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
          )}
          <div className="space-y-1">
            <span className="font-bold block">
              {uncertainOutcome
                ? "Unconfirmed Operation Outcome"
                : t("onboarding.providerForm.errorSummaryTitle")}
            </span>
            <p className="leading-relaxed">{generalError}</p>
            {uncertainOutcome && (
              <div className="pt-2">
                <Link
                  href="/staff/providers"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 text-white font-bold hover:bg-amber-700 transition-colors"
                >
                  <span>Go to Provider Directory to Reconcile</span>
                </Link>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Section 1: Legal & Commercial Identity */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
          <h2 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-3 flex items-center gap-2">
            <Building2 className="w-4 h-4 text-brand-600" />
            <span>{t("onboarding.providerForm.legalSection")}</span>
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label
                htmlFor="legalName"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                {t("onboarding.providerForm.legalNameLabel")}{" "}
                <span className="text-rose-600">*</span>
              </label>
              <input
                id="legalName"
                type="text"
                required
                disabled={isSubmitting}
                value={legalName}
                onChange={handleFieldChange(setLegalName)}
                placeholder={t("onboarding.providerForm.legalNamePlaceholder")}
                className={`w-full px-3 py-2 text-xs border rounded-xl focus:ring-2 focus:ring-brand-500 ${
                  fieldErrors.legalName ? "border-rose-400 bg-rose-50/50" : "border-slate-200"
                }`}
              />
              {fieldErrors.legalName && (
                <p className="text-[11px] text-rose-600 font-medium mt-1">
                  {fieldErrors.legalName}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="nameEn" className="block text-xs font-semibold text-slate-700 mb-1">
                {t("onboarding.providerForm.nameEnLabel")} <span className="text-rose-600">*</span>
              </label>
              <input
                id="nameEn"
                type="text"
                required
                disabled={isSubmitting}
                value={nameEn}
                onChange={handleFieldChange(setNameEn)}
                placeholder={t("onboarding.providerForm.nameEnPlaceholder")}
                className={`w-full px-3 py-2 text-xs border rounded-xl focus:ring-2 focus:ring-brand-500 ${
                  fieldErrors.nameEn ? "border-rose-400 bg-rose-50/50" : "border-slate-200"
                }`}
              />
              {fieldErrors.nameEn && (
                <p className="text-[11px] text-rose-600 font-medium mt-1">{fieldErrors.nameEn}</p>
              )}
            </div>

            <div>
              <label htmlFor="nameAr" className="block text-xs font-semibold text-slate-700 mb-1">
                {t("onboarding.providerForm.nameArLabel")} <span className="text-rose-600">*</span>
              </label>
              <input
                id="nameAr"
                type="text"
                required
                disabled={isSubmitting}
                value={nameAr}
                onChange={handleFieldChange(setNameAr)}
                placeholder={t("onboarding.providerForm.nameArPlaceholder")}
                className={`w-full px-3 py-2 text-xs border rounded-xl focus:ring-2 focus:ring-brand-500 ${
                  fieldErrors.nameAr ? "border-rose-400 bg-rose-50/50" : "border-slate-200"
                }`}
              />
              {fieldErrors.nameAr && (
                <p className="text-[11px] text-rose-600 font-medium mt-1">{fieldErrors.nameAr}</p>
              )}
            </div>

            <div>
              <label htmlFor="taxId" className="block text-xs font-semibold text-slate-700 mb-1">
                {t("onboarding.providerForm.taxIdLabel")} <span className="text-rose-600">*</span>
              </label>
              <input
                id="taxId"
                type="text"
                maxLength={9}
                required
                disabled={isSubmitting}
                value={taxRegistrationNumber}
                dir="ltr"
                onChange={handleFieldChange(setTaxRegistrationNumber)}
                placeholder={t("onboarding.providerForm.taxIdPlaceholder")}
                className={`w-full px-3 py-2 text-xs border rounded-xl focus:ring-2 focus:ring-brand-500 font-mono ${
                  fieldErrors.taxRegistrationNumber
                    ? "border-rose-400 bg-rose-50/50"
                    : "border-slate-200"
                }`}
              />
              {fieldErrors.taxRegistrationNumber && (
                <p className="text-[11px] text-rose-600 font-medium mt-1">
                  {fieldErrors.taxRegistrationNumber}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="crNumber" className="block text-xs font-semibold text-slate-700 mb-1">
                {t("onboarding.providerForm.crLabel")} <span className="text-rose-600">*</span>
              </label>
              <input
                id="crNumber"
                type="text"
                required
                disabled={isSubmitting}
                value={commercialRegistrationNumber}
                dir="ltr"
                onChange={handleFieldChange(setCommercialRegistrationNumber)}
                placeholder={t("onboarding.providerForm.crPlaceholder")}
                className={`w-full px-3 py-2 text-xs border rounded-xl focus:ring-2 focus:ring-brand-500 font-mono ${
                  fieldErrors.commercialRegistrationNumber
                    ? "border-rose-400 bg-rose-50/50"
                    : "border-slate-200"
                }`}
              />
              {fieldErrors.commercialRegistrationNumber && (
                <p className="text-[11px] text-rose-600 font-medium mt-1">
                  {fieldErrors.commercialRegistrationNumber}
                </p>
              )}
            </div>

            <div className="sm:col-span-2">
              <label
                htmlFor="primaryCluster"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                {t("onboarding.providerForm.clusterLabel")} <span className="text-rose-600">*</span>
              </label>
              <select
                id="primaryCluster"
                value={primaryCluster}
                disabled={isSubmitting}
                onChange={(e) => {
                  setPrimaryCluster(e.target.value as CairoCluster);
                  setIsDirty(true);
                }}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:ring-2 focus:ring-brand-500 bg-white"
              >
                <option value="NASR_CITY_HELIOPOLIS">
                  {t("onboarding.clusters.nasrCityHeliopolis")}
                </option>
                <option value="NEW_CAIRO">{t("onboarding.clusters.newCairo")}</option>
                <option value="MAADI">{t("onboarding.clusters.maadi")}</option>
                <option value="OCTOBER_ZAYED">{t("onboarding.clusters.octoberZayed")}</option>
              </select>
            </div>
          </div>
        </div>

        {/* Section 2: Contact Information */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
          <h2 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-3">
            {t("onboarding.providerForm.contactSection")}
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label
                htmlFor="contactPerson"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                {t("onboarding.providerForm.contactPersonLabel")}{" "}
                <span className="text-rose-600">*</span>
              </label>
              <input
                id="contactPerson"
                type="text"
                required
                disabled={isSubmitting}
                value={contactPersonName}
                onChange={handleFieldChange(setContactPersonName)}
                placeholder={t("onboarding.providerForm.contactPersonPlaceholder")}
                className={`w-full px-3 py-2 text-xs border rounded-xl focus:ring-2 focus:ring-brand-500 ${
                  fieldErrors.contactPersonName
                    ? "border-rose-400 bg-rose-50/50"
                    : "border-slate-200"
                }`}
              />
              {fieldErrors.contactPersonName && (
                <p className="text-[11px] text-rose-600 font-medium mt-1">
                  {fieldErrors.contactPersonName}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="contactEmail"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                {t("onboarding.providerForm.contactEmailLabel")}{" "}
                <span className="text-rose-600">*</span>
              </label>
              <input
                id="contactEmail"
                type="email"
                required
                disabled={isSubmitting}
                value={contactEmail}
                dir="ltr"
                onChange={handleFieldChange(setContactEmail)}
                placeholder={t("onboarding.providerForm.contactEmailPlaceholder")}
                className={`w-full px-3 py-2 text-xs border rounded-xl focus:ring-2 focus:ring-brand-500 font-mono ${
                  fieldErrors.contactEmail ? "border-rose-400 bg-rose-50/50" : "border-slate-200"
                }`}
              />
              {fieldErrors.contactEmail && (
                <p className="text-[11px] text-rose-600 font-medium mt-1">
                  {fieldErrors.contactEmail}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="contactPhone"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                {t("onboarding.providerForm.contactPhoneLabel")}{" "}
                <span className="text-rose-600">*</span>
              </label>
              <input
                id="contactPhone"
                type="tel"
                required
                disabled={isSubmitting}
                value={contactPhone}
                dir="ltr"
                onChange={handleFieldChange(setContactPhone)}
                placeholder={t("onboarding.providerForm.contactPhonePlaceholder")}
                className={`w-full px-3 py-2 text-xs border rounded-xl focus:ring-2 focus:ring-brand-500 font-mono ${
                  fieldErrors.contactPhone ? "border-rose-400 bg-rose-50/50" : "border-slate-200"
                }`}
              />
              {fieldErrors.contactPhone && (
                <p className="text-[11px] text-rose-600 font-medium mt-1">
                  {fieldErrors.contactPhone}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-between gap-4 pt-2">
          <Link
            href="/staff/providers"
            className="px-4 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
          >
            {t("onboarding.providerForm.cancel")}
          </Link>

          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-bold text-white bg-brand-600 hover:bg-brand-700 disabled:opacity-50 transition-colors shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{t("onboarding.providerForm.saving")}</span>
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                <span>{t("onboarding.providerForm.saveDraft")}</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
