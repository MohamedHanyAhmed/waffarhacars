"use client";

import React, { useState, useEffect, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "@/context/I18nContext";
import { MapPin, ArrowLeft, Save, Loader2, AlertCircle, AlertTriangle } from "lucide-react";
import {
  OperatingHoursEditor,
  DEFAULT_WEEKLY_HOURS,
} from "@/components/staff/OperatingHoursEditor";
import { GeolocationCapture } from "@/components/staff/GeolocationCapture";
import { ConflictResolver } from "@/components/staff/ConflictResolver";
import type { CairoCluster, OperatingHoursEntry } from "@/lib/provider/validation";

interface BranchData {
  id: string;
  providerOrganizationId: string;
  branchCode: string;
  nameEn: string;
  nameAr: string;
  cluster: CairoCluster;
  streetAddressEn: string;
  streetAddressAr: string;
  landmarkEn?: string | null;
  landmarkAr?: string | null;
  latitude: number;
  longitude: number;
  contactPhone: string;
  operatingHours: OperatingHoursEntry[];
  status: string;
  version: number;
  providerOrganization?: {
    id: string;
    nameEn: string;
    nameAr: string;
    status: string;
  };
}

export default function EditBranchPage({
  params,
}: {
  params: Promise<{ id: string; branchId: string }>;
}) {
  const resolvedParams = use(params);
  const providerId = resolvedParams.id;
  const branchId = resolvedParams.branchId;

  const { t, dir } = useI18n();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [initialBranch, setInitialBranch] = useState<BranchData | null>(null);

  // Form State
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [cluster, setCluster] = useState<CairoCluster>("NASR_CITY_HELIOPOLIS");
  const [streetAddressEn, setStreetAddressEn] = useState("");
  const [streetAddressAr, setStreetAddressAr] = useState("");
  const [landmarkEn, setLandmarkEn] = useState("");
  const [landmarkAr, setLandmarkAr] = useState("");
  const [latitude, setLatitude] = useState<number | "">(30.05);
  const [longitude, setLongitude] = useState<number | "">(31.33);
  const [contactPhone, setContactPhone] = useState("+20");
  const [operatingHours, setOperatingHours] = useState<OperatingHoursEntry[]>(DEFAULT_WEEKLY_HOURS);
  const [expectedVersion, setExpectedVersion] = useState<number>(1);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);

  // Concurrency Conflict State
  const [conflictOpen, setConflictOpen] = useState(false);
  const [serverBranch, setServerBranch] = useState<BranchData | null>(null);

  const [reloadTrigger, setReloadTrigger] = useState(0);

  useEffect(() => {
    let isMounted = true;
    async function loadBranch() {
      try {
        const res = await fetch(`/api/v1/staff/providers/${providerId}/branches/${branchId}`, {
          headers: { Accept: "application/json" },
        });

        if (res.status === 401) {
          router.replace("/staff/login");
          return;
        }

        if (!res.ok) {
          if (isMounted) {
            setGeneralError("Branch not found or you lack permission to view it.");
            setLoading(false);
          }
          return;
        }

        const raw = await res.json();
        const data: BranchData = (raw.branch || raw) as BranchData;
        if (isMounted) {
          setInitialBranch(data);
          setNameEn(data.nameEn);
          setNameAr(data.nameAr);
          setCluster(data.cluster);
          setStreetAddressEn(data.streetAddressEn);
          setStreetAddressAr(data.streetAddressAr);
          setLandmarkEn(data.landmarkEn || "");
          setLandmarkAr(data.landmarkAr || "");
          setLatitude(data.latitude);
          setLongitude(data.longitude);
          setContactPhone(data.contactPhone);
          setOperatingHours(
            Array.isArray(data.operatingHours) && data.operatingHours.length > 0
              ? data.operatingHours
              : DEFAULT_WEEKLY_HOURS
          );
          setExpectedVersion(data.version);
          setLoading(false);
        }
      } catch {
        if (isMounted) {
          setGeneralError("Failed to load branch details. Please refresh the page.");
          setLoading(false);
        }
      }
    }

    loadBranch();
    return () => {
      isMounted = false;
    };
  }, [providerId, branchId, router, reloadTrigger]);

  const validate = (): boolean => {
    const errors: Record<string, string> = {};

    if (!nameEn.trim()) errors.nameEn = "English branch name is required";
    if (!nameAr.trim()) errors.nameAr = "Arabic branch name is required";
    if (!streetAddressEn.trim()) errors.streetAddressEn = "English street address is required";
    if (!streetAddressAr.trim()) errors.streetAddressAr = "Arabic street address is required";

    if (typeof latitude !== "number" || latitude < 29.75 || latitude > 30.35) {
      errors.latitude = "Latitude must be within Greater Cairo (29.75 to 30.35)";
    }

    if (typeof longitude !== "number" || longitude < 31.05 || longitude > 31.75) {
      errors.longitude = "Longitude must be within Greater Cairo (31.05 to 31.75)";
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

    try {
      const res = await fetch(`/api/v1/staff/providers/${providerId}/branches/${branchId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          expectedVersion,
          nameEn: nameEn.trim(),
          nameAr: nameAr.trim(),
          cluster,
          streetAddressEn: streetAddressEn.trim(),
          streetAddressAr: streetAddressAr.trim(),
          landmarkEn: landmarkEn.trim() || null,
          landmarkAr: landmarkAr.trim() || null,
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
        setGeneralError("Access Denied: Only Sales agents can edit branch drafts.");
        setIsSubmitting(false);
        return;
      }

      const json = await res.json().catch(() => ({}));

      if (res.status === 409) {
        // Concurrency conflict: fetch latest server state to display diff
        const freshRes = await fetch(`/api/v1/staff/providers/${providerId}/branches/${branchId}`);
        if (freshRes.ok) {
          const freshRaw = await freshRes.json();
          const freshData: BranchData = (freshRaw.branch || freshRaw) as BranchData;
          setServerBranch(freshData);
          setExpectedVersion(freshData.version);
        }
        setConflictOpen(true);
        setIsSubmitting(false);
        return;
      }

      if (!res.ok) {
        if (json.details && typeof json.details === "object") {
          setFieldErrors(json.details);
        }
        setGeneralError(json.message || "Failed to update branch draft.");
        setIsSubmitting(false);
        return;
      }

      // Success
      router.push(`/staff/providers/${providerId}`);
    } catch {
      setGeneralError("Network connection interrupted. Please verify connection and retry.");
      setIsSubmitting(false);
    }
  };

  const handleApplyServerState = () => {
    if (!serverBranch) return;
    setInitialBranch(serverBranch);
    setNameEn(serverBranch.nameEn);
    setNameAr(serverBranch.nameAr);
    setCluster(serverBranch.cluster);
    setStreetAddressEn(serverBranch.streetAddressEn);
    setStreetAddressAr(serverBranch.streetAddressAr);
    setLandmarkEn(serverBranch.landmarkEn || "");
    setLandmarkAr(serverBranch.landmarkAr || "");
    setLatitude(serverBranch.latitude);
    setLongitude(serverBranch.longitude);
    setContactPhone(serverBranch.contactPhone);
    setOperatingHours(serverBranch.operatingHours);
    setExpectedVersion(serverBranch.version);
    setReloadTrigger((n) => n + 1);
    setConflictOpen(false);
    setGeneralError(null);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-500">
        <Loader2 className="w-8 h-8 animate-spin text-brand-600 mb-3" />
        <p className="text-sm font-medium">Loading branch details...</p>
      </div>
    );
  }

  if (!initialBranch) {
    return (
      <div className="max-w-xl mx-auto py-12 text-center">
        <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-slate-900 mb-2">Branch Not Found</h2>
        <p className="text-sm text-slate-600 mb-6">
          {generalError || "Unable to find the requested branch."}
        </p>
        <Link
          href={`/staff/providers/${providerId}`}
          className="inline-flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-semibold hover:bg-brand-700"
        >
          <ArrowLeft className="w-4 h-4 rtl:rotate-180" />
          <span>{t("onboarding.nav.backToProvider")}</span>
        </Link>
      </div>
    );
  }

  const isEditable =
    initialBranch.status === "DRAFT" &&
    (!initialBranch.providerOrganization || initialBranch.providerOrganization.status === "DRAFT");

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
            <MapPin className="w-6 h-6 text-brand-600 shrink-0" />
            <span>{t("onboarding.branch.editTitle")}</span>
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {t("onboarding.branch.editSubtitle")}{" "}
            <span className="font-mono font-bold text-slate-800" dir="ltr">
              [{initialBranch.branchCode}]
            </span>
          </p>
        </div>
      </div>

      {!isEditable && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">{t("onboarding.branch.readOnlyNotice")}</p>
            <p className="text-xs text-amber-700 mt-1">
              {t("onboarding.branch.readOnlyExplanation")}
            </p>
          </div>
        </div>
      )}

      {/* General Error Banner */}
      {generalError && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <p className="font-medium leading-relaxed">{generalError}</p>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Branch Code (Immutable) */}
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-6 space-y-5">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider text-xs text-slate-400">
            {t("onboarding.branch.identifiersSection")}
          </h2>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              {t("onboarding.branch.branchCodeLabel")}
            </label>
            <input
              type="text"
              readOnly
              disabled
              value={initialBranch.branchCode}
              dir="ltr"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 font-mono text-sm text-slate-500 cursor-not-allowed"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              {t("onboarding.branch.branchCodeImmutable")}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                {t("onboarding.branch.nameEnLabel")} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                disabled={!isEditable || isSubmitting}
                value={nameEn}
                onChange={(e) => setNameEn(e.target.value)}
                placeholder="e.g. Nasr City Main Service Center"
                className={`w-full px-3.5 py-2.5 rounded-xl border ${
                  fieldErrors.nameEn
                    ? "border-red-500 bg-red-50/30"
                    : "border-slate-200 focus:border-brand-500"
                } text-sm focus:outline-none transition-colors disabled:bg-slate-50 disabled:cursor-not-allowed`}
              />
              {fieldErrors.nameEn && (
                <p className="text-xs text-red-600 mt-1 font-medium">{fieldErrors.nameEn}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                {t("onboarding.branch.nameArLabel")} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                disabled={!isEditable || isSubmitting}
                value={nameAr}
                onChange={(e) => setNameAr(e.target.value)}
                placeholder="مثال: مركز خدمة مدينة نصر الرئيسي"
                dir="rtl"
                className={`w-full px-3.5 py-2.5 rounded-xl border ${
                  fieldErrors.nameAr
                    ? "border-red-500 bg-red-50/30"
                    : "border-slate-200 focus:border-brand-500"
                } text-sm focus:outline-none transition-colors disabled:bg-slate-50 disabled:cursor-not-allowed`}
              />
              {fieldErrors.nameAr && (
                <p className="text-xs text-red-600 mt-1 font-medium">{fieldErrors.nameAr}</p>
              )}
            </div>
          </div>
        </div>

        {/* Location & Cluster Section */}
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-6 space-y-5">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider text-xs text-slate-400">
            {t("onboarding.branch.locationSection")}
          </h2>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              {t("onboarding.branch.clusterLabel")} <span className="text-red-500">*</span>
            </label>
            <select
              disabled={!isEditable || isSubmitting}
              value={cluster}
              onChange={(e) => setCluster(e.target.value as CairoCluster)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:border-brand-500 focus:outline-none bg-white disabled:bg-slate-50 disabled:cursor-not-allowed"
            >
              <option value="NASR_CITY_HELIOPOLIS">
                {t("onboarding.clusters.nasrCityHeliopolis")}
              </option>
              <option value="NEW_CAIRO">{t("onboarding.clusters.newCairo")}</option>
              <option value="MAADI">{t("onboarding.clusters.maadi")}</option>
              <option value="OCTOBER_ZAYED">{t("onboarding.clusters.octoberZayed")}</option>
            </select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                {t("onboarding.branch.streetAddressEnLabel")}{" "}
                <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                disabled={!isEditable || isSubmitting}
                value={streetAddressEn}
                onChange={(e) => setStreetAddressEn(e.target.value)}
                placeholder="e.g. 15 Abbas El Akkad Street"
                className={`w-full px-3.5 py-2.5 rounded-xl border ${
                  fieldErrors.streetAddressEn
                    ? "border-red-500 bg-red-50/30"
                    : "border-slate-200 focus:border-brand-500"
                } text-sm focus:outline-none transition-colors disabled:bg-slate-50 disabled:cursor-not-allowed`}
              />
              {fieldErrors.streetAddressEn && (
                <p className="text-xs text-red-600 mt-1 font-medium">
                  {fieldErrors.streetAddressEn}
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                {t("onboarding.branch.streetAddressArLabel")}{" "}
                <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                disabled={!isEditable || isSubmitting}
                value={streetAddressAr}
                onChange={(e) => setStreetAddressAr(e.target.value)}
                placeholder="مثال: ١٥ شارع عباس العقاد"
                dir="rtl"
                className={`w-full px-3.5 py-2.5 rounded-xl border ${
                  fieldErrors.streetAddressAr
                    ? "border-red-500 bg-red-50/30"
                    : "border-slate-200 focus:border-brand-500"
                } text-sm focus:outline-none transition-colors disabled:bg-slate-50 disabled:cursor-not-allowed`}
              />
              {fieldErrors.streetAddressAr && (
                <p className="text-xs text-red-600 mt-1 font-medium">
                  {fieldErrors.streetAddressAr}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                {t("onboarding.branch.landmarkEnLabel")}{" "}
                <span className="text-slate-400 font-normal">({t("common.optional")})</span>
              </label>
              <input
                type="text"
                disabled={!isEditable || isSubmitting}
                value={landmarkEn}
                onChange={(e) => setLandmarkEn(e.target.value)}
                placeholder="e.g. Near International Park"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:border-brand-500 focus:outline-none transition-colors disabled:bg-slate-50 disabled:cursor-not-allowed"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                {t("onboarding.branch.landmarkArLabel")}{" "}
                <span className="text-slate-400 font-normal">({t("common.optional")})</span>
              </label>
              <input
                type="text"
                disabled={!isEditable || isSubmitting}
                value={landmarkAr}
                onChange={(e) => setLandmarkAr(e.target.value)}
                placeholder="مثال: بالقرب من الحديقة الدولية"
                dir="rtl"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:border-brand-500 focus:outline-none transition-colors disabled:bg-slate-50 disabled:cursor-not-allowed"
              />
            </div>
          </div>

          {/* Explicit Geolocation Capture Component */}
          {isEditable && (
            <div className="pt-2">
              <GeolocationCapture
                onCoordinatesCaptured={(lat, lng) => {
                  setLatitude(lat);
                  setLongitude(lng);
                }}
              />
            </div>
          )}

          {/* Coordinates Inputs */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                {t("onboarding.branch.latitudeLabel")} <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                step="any"
                disabled={!isEditable || isSubmitting}
                value={latitude}
                onChange={(e) => setLatitude(e.target.value === "" ? "" : Number(e.target.value))}
                dir="ltr"
                className={`w-full px-3.5 py-2.5 rounded-xl border ${
                  fieldErrors.latitude
                    ? "border-red-500 bg-red-50/30"
                    : "border-slate-200 focus:border-brand-500"
                } font-mono text-sm focus:outline-none transition-colors disabled:bg-slate-50 disabled:cursor-not-allowed`}
              />
              {fieldErrors.latitude && (
                <p className="text-xs text-red-600 mt-1 font-medium">{fieldErrors.latitude}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                {t("onboarding.branch.longitudeLabel")} <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                step="any"
                disabled={!isEditable || isSubmitting}
                value={longitude}
                onChange={(e) => setLongitude(e.target.value === "" ? "" : Number(e.target.value))}
                dir="ltr"
                className={`w-full px-3.5 py-2.5 rounded-xl border ${
                  fieldErrors.longitude
                    ? "border-red-500 bg-red-50/30"
                    : "border-slate-200 focus:border-brand-500"
                } font-mono text-sm focus:outline-none transition-colors disabled:bg-slate-50 disabled:cursor-not-allowed`}
              />
              {fieldErrors.longitude && (
                <p className="text-xs text-red-600 mt-1 font-medium">{fieldErrors.longitude}</p>
              )}
            </div>
          </div>
        </div>

        {/* Contact Phone & Hours */}
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-6 space-y-5">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider text-xs text-slate-400">
            {t("onboarding.branch.contactHoursSection")}
          </h2>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              {t("onboarding.branch.contactPhoneLabel")} <span className="text-red-500">*</span>
            </label>
            <input
              type="tel"
              disabled={!isEditable || isSubmitting}
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              dir="ltr"
              placeholder="+201012345678"
              className={`w-full px-3.5 py-2.5 rounded-xl border ${
                fieldErrors.contactPhone
                  ? "border-red-500 bg-red-50/30"
                  : "border-slate-200 focus:border-brand-500"
              } font-mono text-sm focus:outline-none transition-colors disabled:bg-slate-50 disabled:cursor-not-allowed`}
            />
            {fieldErrors.contactPhone && (
              <p className="text-xs text-red-600 mt-1 font-medium">{fieldErrors.contactPhone}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-2">
              {t("onboarding.branch.operatingHoursLabel")} <span className="text-red-500">*</span>
            </label>
            <OperatingHoursEditor
              value={operatingHours}
              onChange={setOperatingHours}
              readOnly={!isEditable || isSubmitting}
            />
          </div>
        </div>

        {/* Action Buttons */}
        {isEditable && (
          <div className="flex items-center justify-end gap-3 pt-2">
            <Link
              href={`/staff/providers/${providerId}`}
              className="px-5 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              {t("common.cancel")}
            </Link>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold shadow-xs disabled:opacity-50 transition-colors cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{t("common.saving")}</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>{t("onboarding.branch.saveButton")}</span>
                </>
              )}
            </button>
          </div>
        )}
      </form>

      {/* 409 Concurrency Conflict Resolver */}
      {conflictOpen && serverBranch && (
        <ConflictResolver
          isOpen={conflictOpen}
          entityType="branch"
          currentVersion={expectedVersion}
          serverVersion={serverBranch.version}
          clientValues={{
            nameEn,
            nameAr,
            streetAddressEn,
            streetAddressAr,
            contactPhone,
          }}
          serverValues={{
            nameEn: serverBranch.nameEn,
            nameAr: serverBranch.nameAr,
            streetAddressEn: serverBranch.streetAddressEn,
            streetAddressAr: serverBranch.streetAddressAr,
            contactPhone: serverBranch.contactPhone,
          }}
          onApplyServer={handleApplyServerState}
          onOverwrite={() => {
            // Overwrite using the updated expectedVersion from server
            setExpectedVersion(serverBranch.version);
            setConflictOpen(false);
          }}
          onCancel={() => setConflictOpen(false)}
        />
      )}
    </div>
  );
}
