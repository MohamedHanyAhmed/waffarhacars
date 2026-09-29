"use client";

import React, { useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "@/context/I18nContext";
import { MapPin, ArrowLeft, Save, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import {
  OperatingHoursEditor,
  DEFAULT_WEEKLY_HOURS,
} from "@/components/staff/OperatingHoursEditor";
import { GeolocationCapture } from "@/components/staff/GeolocationCapture";
import type { CairoCluster, OperatingHoursEntry } from "@/lib/provider/validation";

export default function NewBranchPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const providerId = resolvedParams.id;

  const { t, dir } = useI18n();
  const router = useRouter();

  const [branchCode, setBranchCode] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [cluster, setCluster] = useState<CairoCluster>("NASR_CITY_HELIOPOLIS");
  const [streetAddressEn, setStreetAddressEn] = useState("");
  const [streetAddressAr, setStreetAddressAr] = useState("");
  const [latitude, setLatitude] = useState<number | "">("");
  const [longitude, setLongitude] = useState<number | "">("");
  const [contactPhone, setContactPhone] = useState("+20");
  const [operatingHours, setOperatingHours] = useState<OperatingHoursEntry[]>(DEFAULT_WEEKLY_HOURS);
  const [hoursConfirmed, setHoursConfirmed] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);

  const validate = (): boolean => {
    const errors: Record<string, string> = {};

    if (!branchCode.trim()) errors.branchCode = "Branch code is required";
    if (!nameEn.trim()) errors.nameEn = "English branch name is required";
    if (!nameAr.trim()) errors.nameAr = "Arabic branch name is required";
    if (!streetAddressEn.trim()) errors.streetAddressEn = "English street address is required";
    if (!streetAddressAr.trim()) errors.streetAddressAr = "Arabic street address is required";

    if (typeof latitude !== "number" || latitude < 29.75 || latitude > 30.35) {
      errors.latitude = "Valid latitude within Greater Cairo (29.75 to 30.35) is required";
    }

    if (typeof longitude !== "number" || longitude < 31.05 || longitude > 31.75) {
      errors.longitude = "Valid longitude within Greater Cairo (31.05 to 31.75) is required";
    }

    if (!/^\+20\d{9,10}$/.test(contactPhone.trim())) {
      errors.contactPhone = "Egyptian phone number required (+20 followed by 9-10 digits)";
    }

    if (!hoursConfirmed) {
      errors.operatingHours =
        t("onboarding.branch.hoursConfirmedRequired") ||
        "You must explicitly confirm the actual operating hours for this branch.";
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

    try {
      const res = await fetch(`/api/v1/staff/providers/${providerId}/branches`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          branchCode: branchCode.trim().toUpperCase(),
          nameEn: nameEn.trim(),
          nameAr: nameAr.trim(),
          cluster,
          streetAddressEn: streetAddressEn.trim(),
          streetAddressAr: streetAddressAr.trim(),
          latitude: Number(latitude),
          longitude: Number(longitude),
          contactPhone: contactPhone.trim(),
          operatingHours,
        }),
      });

      if (res.status === 401) {
        router.replace("/staff/login");
        return;
      }

      if (res.status === 403) {
        setGeneralError("Access Denied: Only Sales agents can add branch drafts.");
        setIsSubmitting(false);
        return;
      }

      const json = await res.json().catch(() => ({}));

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
        setGeneralError(json.message || "Failed to create branch draft.");
        setIsSubmitting(false);
        return;
      }

      // Success
      setIsDirty(false);
      router.push(`/staff/providers/${providerId}`);
    } catch {
      // Invariant: Treat outcome as unknown; read back provider branches before offering deliberate retry
      try {
        const checkRes = await fetch(`/api/v1/staff/providers/${providerId}/branches`);
        if (checkRes.ok) {
          const branches = await checkRes.json();
          const match = Array.isArray(branches)
            ? branches.find(
                (b: { branchCode: string }) => b.branchCode === branchCode.trim().toUpperCase()
              )
            : null;
          if (match) {
            // Branch was indeed created
            setIsDirty(false);
            router.push(`/staff/providers/${providerId}`);
            return;
          }
        }
      } catch {
        // Read-back failed
      }

      setGeneralError(
        "Network connection interrupted. We checked the server and this branch was not created yet. Your inputs have been preserved; you may safely retry."
      );
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6" dir={dir}>
      {/* Top Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link
            href={`/staff/providers/${providerId}`}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-brand-600 transition-colors mb-2"
          >
            <ArrowLeft className="w-4 h-4 rtl:rotate-180" />
            <span>{t("onboarding.nav.backToProvider")}</span>
          </Link>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
            <MapPin className="w-7 h-7 text-brand-600" />
            <span>{t("onboarding.branch.newBranchTitle")}</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">{t("onboarding.branch.newBranchSubtitle")}</p>
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

      {generalError && (
        <div
          role="alert"
          className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-900 text-xs flex items-center gap-3"
        >
          <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0" />
          <span>{generalError}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Section 1: Branch Identification */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
          <h2 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-3">
            Branch Identity
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="branchCode"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                {t("onboarding.branch.branchCodeLabel")} <span className="text-rose-600">*</span>
              </label>
              <input
                id="branchCode"
                type="text"
                required
                disabled={isSubmitting}
                value={branchCode}
                dir="ltr"
                onChange={(e) => {
                  setBranchCode(e.target.value);
                  setIsDirty(true);
                  setFieldErrors({});
                }}
                placeholder={t("onboarding.branch.branchCodePlaceholder")}
                className={`w-full px-3 py-2 text-xs border rounded-xl focus:ring-2 focus:ring-brand-500 font-mono uppercase ${
                  fieldErrors.branchCode ? "border-rose-400 bg-rose-50/50" : "border-slate-200"
                }`}
              />
              {fieldErrors.branchCode && (
                <p className="text-[11px] text-rose-600 font-medium mt-1">
                  {fieldErrors.branchCode}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="branchCluster"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                {t("onboarding.branch.clusterLabel")} <span className="text-rose-600">*</span>
              </label>
              <select
                id="branchCluster"
                value={cluster}
                disabled={isSubmitting}
                onChange={(e) => {
                  setCluster(e.target.value as CairoCluster);
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

            <div>
              <label
                htmlFor="branchNameEn"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                {t("onboarding.branch.nameEnLabel")} <span className="text-rose-600">*</span>
              </label>
              <input
                id="branchNameEn"
                type="text"
                required
                disabled={isSubmitting}
                value={nameEn}
                onChange={(e) => {
                  setNameEn(e.target.value);
                  setIsDirty(true);
                  setFieldErrors({});
                }}
                placeholder={t("onboarding.branch.nameEnPlaceholder")}
                className={`w-full px-3 py-2 text-xs border rounded-xl focus:ring-2 focus:ring-brand-500 ${
                  fieldErrors.nameEn ? "border-rose-400 bg-rose-50/50" : "border-slate-200"
                }`}
              />
              {fieldErrors.nameEn && (
                <p className="text-[11px] text-rose-600 font-medium mt-1">{fieldErrors.nameEn}</p>
              )}
            </div>

            <div>
              <label
                htmlFor="branchNameAr"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                {t("onboarding.branch.nameArLabel")} <span className="text-rose-600">*</span>
              </label>
              <input
                id="branchNameAr"
                type="text"
                required
                disabled={isSubmitting}
                value={nameAr}
                onChange={(e) => {
                  setNameAr(e.target.value);
                  setIsDirty(true);
                  setFieldErrors({});
                }}
                placeholder={t("onboarding.branch.nameArPlaceholder")}
                className={`w-full px-3 py-2 text-xs border rounded-xl focus:ring-2 focus:ring-brand-500 ${
                  fieldErrors.nameAr ? "border-rose-400 bg-rose-50/50" : "border-slate-200"
                }`}
              />
              {fieldErrors.nameAr && (
                <p className="text-[11px] text-rose-600 font-medium mt-1">{fieldErrors.nameAr}</p>
              )}
            </div>

            <div className="sm:col-span-2">
              <label
                htmlFor="branchContactPhone"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                {t("onboarding.providerForm.contactPhoneLabel")}{" "}
                <span className="text-rose-600">*</span>
              </label>
              <input
                id="branchContactPhone"
                type="tel"
                required
                disabled={isSubmitting}
                value={contactPhone}
                dir="ltr"
                onChange={(e) => {
                  setContactPhone(e.target.value);
                  setIsDirty(true);
                  setFieldErrors({});
                }}
                placeholder="+201123456789"
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

        {/* Section 2: Address & Coordinates */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
          <h2 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-3 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-emerald-600" />
            <span>{t("onboarding.branch.addressSection")}</span>
          </h2>

          <div className="space-y-4">
            <div>
              <label htmlFor="streetEn" className="block text-xs font-semibold text-slate-700 mb-1">
                {t("onboarding.branch.streetEnLabel")} <span className="text-rose-600">*</span>
              </label>
              <input
                id="streetEn"
                type="text"
                required
                disabled={isSubmitting}
                value={streetAddressEn}
                onChange={(e) => {
                  setStreetAddressEn(e.target.value);
                  setIsDirty(true);
                  setFieldErrors({});
                }}
                placeholder={t("onboarding.branch.streetEnPlaceholder")}
                className={`w-full px-3 py-2 text-xs border rounded-xl focus:ring-2 focus:ring-brand-500 ${
                  fieldErrors.streetAddressEn ? "border-rose-400 bg-rose-50/50" : "border-slate-200"
                }`}
              />
              {fieldErrors.streetAddressEn && (
                <p className="text-[11px] text-rose-600 font-medium mt-1">
                  {fieldErrors.streetAddressEn}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="streetAr" className="block text-xs font-semibold text-slate-700 mb-1">
                {t("onboarding.branch.streetArLabel")} <span className="text-rose-600">*</span>
              </label>
              <input
                id="streetAr"
                type="text"
                required
                disabled={isSubmitting}
                value={streetAddressAr}
                onChange={(e) => {
                  setStreetAddressAr(e.target.value);
                  setIsDirty(true);
                  setFieldErrors({});
                }}
                placeholder={t("onboarding.branch.streetArPlaceholder")}
                className={`w-full px-3 py-2 text-xs border rounded-xl focus:ring-2 focus:ring-brand-500 ${
                  fieldErrors.streetAddressAr ? "border-rose-400 bg-rose-50/50" : "border-slate-200"
                }`}
              />
              {fieldErrors.streetAddressAr && (
                <p className="text-[11px] text-rose-600 font-medium mt-1">
                  {fieldErrors.streetAddressAr}
                </p>
              )}
            </div>

            {/* Geolocation Component */}
            <div className="pt-2">
              <GeolocationCapture
                latitude={latitude}
                longitude={longitude}
                disabled={isSubmitting}
                onChange={(coords) => {
                  setLatitude(coords.latitude);
                  setLongitude(coords.longitude);
                  setIsDirty(true);
                }}
              />
            </div>
          </div>
        </div>

        {/* Section 3: Operating Hours */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
          <h2 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-3">
            {t("onboarding.branch.hoursSection")}
          </h2>

          <OperatingHoursEditor
            value={operatingHours}
            disabled={isSubmitting}
            onChange={(h) => {
              setOperatingHours(h);
              setIsDirty(true);
            }}
          />

          <div className="pt-2">
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200">
              <input
                id="confirm-operating-hours"
                type="checkbox"
                checked={hoursConfirmed}
                onChange={(e) => {
                  setHoursConfirmed(e.target.checked);
                  setIsDirty(true);
                  if (e.target.checked && fieldErrors.operatingHours) {
                    setFieldErrors((prev) => {
                      const next = { ...prev };
                      delete next.operatingHours;
                      return next;
                    });
                  }
                }}
                className="w-4 h-4 mt-0.5 rounded text-brand-600 focus:ring-brand-500 border-slate-300"
              />
              <label
                htmlFor="confirm-operating-hours"
                className="text-xs text-slate-700 font-medium cursor-pointer"
              >
                {t("onboarding.branch.confirmOperatingHoursLabel")}
              </label>
            </div>
            {fieldErrors.operatingHours && (
              <p className="text-[11px] text-rose-600 font-medium mt-1">
                {fieldErrors.operatingHours}
              </p>
            )}
          </div>
        </div>

        {/* Form Actions */}
        <div className="flex items-center justify-between gap-4 pt-2">
          <Link
            href={`/staff/providers/${providerId}`}
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
                <span>{t("onboarding.branch.savingBranch")}</span>
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                <span>{t("onboarding.branch.saveBranch")}</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
