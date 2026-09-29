"use client";

import React, { useState, useEffect, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "@/context/I18nContext";
import { Building2, ArrowLeft, Save, Loader2, AlertCircle, AlertTriangle } from "lucide-react";
import { ConflictResolver } from "@/components/staff/ConflictResolver";
import { ProviderStatusBadge } from "@/components/staff/ProviderStatusBadge";
import type { CairoCluster } from "@/lib/provider/validation";
import type { ProviderOrganizationDto } from "@/lib/provider/dto";

export default function EditProviderOrganizationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const providerId = resolvedParams.id;

  const { t, dir } = useI18n();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState<ProviderOrganizationDto | null>(null);

  // Form Fields
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [legalName, setLegalName] = useState("");
  const [taxRegistrationNumber, setTaxRegistrationNumber] = useState("");
  const [commercialRegistrationNumber, setCommercialRegistrationNumber] = useState("");
  const [primaryCluster, setPrimaryCluster] = useState<CairoCluster>("NASR_CITY_HELIOPOLIS");
  const [contactPersonName, setContactPersonName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("+20");
  const [expectedVersion, setExpectedVersion] = useState<number>(1);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [uncertainOutcome, setUncertainOutcome] = useState(false);

  // Concurrency Conflict State
  const [conflictOpen, setConflictOpen] = useState(false);
  const [serverProvider, setServerProvider] = useState<ProviderOrganizationDto | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function loadProvider() {
      try {
        const res = await fetch(`/api/v1/staff/providers/${providerId}`, {
          headers: { Accept: "application/json" },
        });

        if (res.status === 401) {
          router.replace("/staff/login");
          return;
        }

        if (!res.ok) {
          if (isMounted) {
            setGeneralError("Provider organization not found or access denied.");
            setLoading(false);
          }
          return;
        }

        const data: ProviderOrganizationDto = await res.json();
        if (isMounted) {
          setProvider(data);
          setNameEn(data.nameEn);
          setNameAr(data.nameAr);
          setLegalName(data.legalName);
          setTaxRegistrationNumber(data.taxRegistrationNumber);
          setCommercialRegistrationNumber(data.commercialRegistrationNumber);
          setPrimaryCluster(data.primaryCluster as CairoCluster);
          setContactPersonName(data.contactPersonName);
          setContactEmail(data.contactEmail);
          setContactPhone(data.contactPhone);
          setExpectedVersion(data.version);
          setLoading(false);
        }
      } catch {
        if (isMounted) {
          setGeneralError("Failed to load provider organization. Please refresh the page.");
          setLoading(false);
        }
      }
    }

    loadProvider();
    return () => {
      isMounted = false;
    };
  }, [providerId, router]);

  const validate = (): boolean => {
    const errors: Record<string, string> = {};

    if (!nameEn.trim()) errors.nameEn = "English commercial name is required";
    if (!nameAr.trim()) errors.nameAr = "Arabic commercial name is required";
    if (!legalName.trim()) errors.legalName = "Legal entity name is required";

    const cleanTax = taxRegistrationNumber.trim();
    if (!/^\d{9}$/.test(cleanTax)) {
      errors.taxRegistrationNumber = "Tax Registration Number must be exactly 9 digits";
    }

    const cleanCr = commercialRegistrationNumber.trim();
    if (!cleanCr || !/^[A-Za-z0-9_-]{3,32}$/.test(cleanCr)) {
      errors.commercialRegistrationNumber =
        "Commercial Registration Number must be 3 to 32 alphanumeric characters";
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

  const handleFieldChange =
    (setter: React.Dispatch<React.SetStateAction<string>>) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setter(e.target.value);
      setIsDirty(true);
      if (fieldErrors[e.target.id]) {
        setFieldErrors((prev) => {
          const next = { ...prev };
          delete next[e.target.id];
          return next;
        });
      }
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
      const res = await fetch(`/api/v1/staff/providers/${providerId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          expectedVersion,
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
        setGeneralError("Access Denied: Only Sales or Admin staff can edit provider drafts.");
        setIsSubmitting(false);
        return;
      }

      const json = await res.json().catch(() => ({}));

      if (res.status === 409) {
        // Concurrency conflict: fetch fresh server record without silently modifying expectedVersion
        const freshRes = await fetch(`/api/v1/staff/providers/${providerId}`);
        if (freshRes.ok) {
          const freshData: ProviderOrganizationDto = await freshRes.json();
          setServerProvider(freshData);
        }
        setConflictOpen(true);
        setIsSubmitting(false);
        return;
      }

      if (!res.ok) {
        if (Array.isArray(json.details)) {
          const mapped: Record<string, string> = {};
          for (const item of json.details) {
            if (item.path && item.message) {
              mapped[item.path] = item.message;
            }
          }
          setFieldErrors(mapped);
        } else if (json.details && typeof json.details === "object") {
          setFieldErrors(json.details);
        }
        setGeneralError(json.message || "Failed to update provider draft.");
        setIsSubmitting(false);
        return;
      }

      // Success
      setIsDirty(false);
      router.push(`/staff/providers/${providerId}`);
    } catch {
      // Invariant: Treat outcome as unknown, read back record before allowing deliberate retry
      try {
        const checkRes = await fetch(`/api/v1/staff/providers/${providerId}`);
        if (checkRes.ok) {
          const latest: ProviderOrganizationDto = await checkRes.json();
          if (latest.version > expectedVersion) {
            // Update actually succeeded on the server before network interruption
            setIsDirty(false);
            router.push(`/staff/providers/${providerId}`);
            return;
          }
        }
      } catch {
        // Read-back failed as well
      }

      setUncertainOutcome(true);
      setGeneralError(
        "Network connection interrupted. We verified the server and your draft updates were not applied. Your entered data has been preserved; you may safely retry."
      );
      setIsSubmitting(false);
    }
  };

  const handleApplyServerState = () => {
    if (!serverProvider) return;
    setNameEn(serverProvider.nameEn);
    setNameAr(serverProvider.nameAr);
    setLegalName(serverProvider.legalName);
    setTaxRegistrationNumber(serverProvider.taxRegistrationNumber);
    setCommercialRegistrationNumber(serverProvider.commercialRegistrationNumber);
    setPrimaryCluster(serverProvider.primaryCluster as CairoCluster);
    setContactPersonName(serverProvider.contactPersonName);
    setContactEmail(serverProvider.contactEmail);
    setContactPhone(serverProvider.contactPhone);
    setExpectedVersion(serverProvider.version);
    setProvider(serverProvider);
    setIsDirty(false);
    setConflictOpen(false);
  };

  const handleKeepLocalWithNewVersion = () => {
    if (!serverProvider) return;
    setExpectedVersion(serverProvider.version);
    setConflictOpen(false);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-slate-500">
        <Loader2 className="w-8 h-8 animate-spin text-brand-600 mb-3" />
        <p className="text-sm font-medium">Loading provider details...</p>
      </div>
    );
  }

  if (!provider) {
    return (
      <div className="max-w-xl mx-auto py-12 text-center">
        <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-slate-900 mb-2">Provider Not Found</h2>
        <p className="text-sm text-slate-600 mb-6">
          {generalError || "Unable to locate provider organization."}
        </p>
        <Link
          href="/staff/providers"
          className="inline-flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-semibold hover:bg-brand-700"
        >
          {t("onboarding.nav.directory")}
        </Link>
      </div>
    );
  }

  // Guard: Only DRAFT providers can be edited
  if (provider.status !== "DRAFT") {
    return (
      <div className="max-w-2xl mx-auto py-12 space-y-6" dir={dir}>
        <div className="p-6 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 space-y-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0" />
            <div>
              <h2 className="text-lg font-bold">Editing Not Permitted</h2>
              <p className="text-xs text-amber-700 mt-0.5">
                Current Status: <strong className="font-semibold">{provider.status}</strong>
              </p>
            </div>
          </div>
          <p className="text-xs text-amber-800 leading-relaxed">
            Provider organization drafts can only be modified while in{" "}
            <strong className="font-semibold">DRAFT</strong> status. Records in PENDING_REVIEW,
            ACTIVE, PAUSED, or terminal statuses cannot be modified directly by Sales. If
            operational changes are required for an active provider, please request an amendment
            from Operations.
          </p>
          <div className="pt-2">
            <Link
              href={`/staff/providers/${provider.id}`}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 transition-colors shadow-xs"
            >
              <ArrowLeft className="w-4 h-4 rtl:rotate-180" />
              <span>{t("onboarding.nav.backToProvider")}</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6" dir={dir}>
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link
            href={`/staff/providers/${provider.id}`}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-brand-600 transition-colors mb-2"
          >
            <ArrowLeft className="w-3.5 h-3.5 rtl:rotate-180" />
            <span>{t("onboarding.nav.backToProvider")}</span>
          </Link>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Building2 className="w-5 h-5 text-brand-600" />
            <span>{t("onboarding.providerForm.editTitle")}</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {t("onboarding.providerForm.editSubtitle")} • Version v{expectedVersion}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <ProviderStatusBadge status={provider.status} />
        </div>
      </div>

      {/* General Error Notice */}
      {generalError && (
        <div
          role="alert"
          className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-3"
        >
          <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold">{generalError}</p>
            {uncertainOutcome && (
              <p className="mt-1 text-rose-700 text-[11px]">
                Your form changes are safely preserved. Click &quot;Save Changes&quot; below to
                retry.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Section 1: Legal Entity Identity */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
          <h2 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-3">
            {t("onboarding.providerForm.legalSection")}
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
                required
                maxLength={9}
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
                maxLength={32}
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

        {/* Section 2: Primary Business Contact */}
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
        <div className="flex items-center justify-between pt-2">
          <Link
            href={`/staff/providers/${provider.id}`}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 border border-slate-200 bg-white hover:bg-slate-50 rounded-xl transition-colors"
          >
            {t("onboarding.providerForm.cancel")}
          </Link>

          <button
            type="submit"
            id="save-provider-edit-btn"
            disabled={isSubmitting || !isDirty}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-xs font-semibold shadow-xs disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>{t("onboarding.providerForm.saving")}</span>
              </>
            ) : (
              <>
                <Save className="w-3.5 h-3.5" />
                <span>{t("onboarding.providerForm.saveChanges")}</span>
              </>
            )}
          </button>
        </div>
      </form>

      {/* Concurrency Conflict Dialog */}
      {conflictOpen && serverProvider && (
        <ConflictResolver
          isOpen={conflictOpen}
          serverVersion={serverProvider.version}
          expectedVersion={expectedVersion}
          entityType="Provider Organization"
          clientValues={{
            nameEn,
            nameAr,
            legalName,
            taxRegistrationNumber,
            commercialRegistrationNumber,
            primaryCluster,
            contactPersonName,
            contactEmail,
            contactPhone,
          }}
          serverValues={{
            nameEn: serverProvider.nameEn,
            nameAr: serverProvider.nameAr,
            legalName: serverProvider.legalName,
            taxRegistrationNumber: serverProvider.taxRegistrationNumber,
            commercialRegistrationNumber: serverProvider.commercialRegistrationNumber,
            primaryCluster: serverProvider.primaryCluster,
            contactPersonName: serverProvider.contactPersonName,
            contactEmail: serverProvider.contactEmail,
            contactPhone: serverProvider.contactPhone,
          }}
          onClose={() => setConflictOpen(false)}
          onAcceptServer={handleApplyServerState}
          onKeepLocalWithNewVersion={handleKeepLocalWithNewVersion}
        />
      )}
    </div>
  );
}
