"use client";

import React, { useState, useEffect, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "@/context/I18nContext";
import {
  Building2,
  MapPin,
  Plus,
  Send,
  CheckCircle2,
  XCircle,
  PauseCircle,
  PlayCircle,
  AlertCircle,
  AlertTriangle,
  Loader2,
  Clock,
  Phone,
  ShieldCheck,
  ChevronRight,
  Edit2,
} from "lucide-react";
import { ProviderStatusBadge } from "@/components/staff/ProviderStatusBadge";
import { OffersNotConfiguredNotice } from "@/components/staff/OffersNotConfiguredNotice";
import { BranchVettingModal } from "@/components/staff/BranchVettingModal";
import { BranchRejectModal } from "@/components/staff/BranchRejectModal";
import { ProviderRejectModal } from "@/components/staff/ProviderRejectModal";
import { PauseResumeModal } from "@/components/staff/PauseResumeModal";
import { CheckAnswersSummary } from "@/components/staff/CheckAnswersSummary";
import { ConflictResolver } from "@/components/staff/ConflictResolver";
import type { StaffAuthStatusResponse } from "@/lib/staff/status-contract";
import type { BranchDto, ProviderOrganizationDto } from "@/lib/provider/dto";

type Branch = BranchDto;
type Provider = ProviderOrganizationDto;

export default function ProviderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const providerId = resolvedParams.id;

  const { t, dir } = useI18n();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState<Provider | null>(null);
  const [currentStaff, setCurrentStaff] = useState<StaffAuthStatusResponse | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  // Active Modals state
  const [vettingBranch, setVettingBranch] = useState<Branch | null>(null);
  const [rejectingBranch, setRejectingBranch] = useState<Branch | null>(null);
  const [rejectingProviderOpen, setRejectingProviderOpen] = useState(false);
  const [pauseResumeTarget, setPauseResumeTarget] = useState<{
    entityType: "provider" | "branch";
    action: "pause" | "resume";
    branchId?: string;
    branchCode?: string;
  } | null>(null);

  // Check answers modal / view
  const [checkAnswersOpen, setCheckAnswersOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isActivatingProvider, setIsActivatingProvider] = useState(false);

  // Concurrency conflict modal
  const [conflictOpen, setConflictOpen] = useState(false);
  const [serverProvider, setServerProvider] = useState<Provider | null>(null);

  const [reloadTrigger, setReloadTrigger] = useState(0);

  const fetchProvider = async () => {
    setLoading(true);
    setGeneralError(null);
    setReloadTrigger((n) => n + 1);
  };

  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      try {
        const [authRes, provRes] = await Promise.all([
          fetch("/api/v1/staff/auth/status", { headers: { Accept: "application/json" } }),
          fetch(`/api/v1/staff/providers/${providerId}`, {
            headers: { Accept: "application/json" },
          }),
        ]);

        if (authRes.status === 401 || provRes.status === 401) {
          router.replace("/staff/login");
          return;
        }

        if (authRes.ok) {
          const authData: StaffAuthStatusResponse = await authRes.json();
          if (isMounted) setCurrentStaff(authData);
        }

        if (!provRes.ok) {
          if (isMounted) {
            setGeneralError("Provider organization not found or access denied.");
            setLoading(false);
          }
          return;
        }

        const raw = await provRes.json();
        const data: Provider = (raw.provider ? raw.provider : raw) as Provider;
        if (isMounted) {
          setProvider(data);
          setLoading(false);
        }
      } catch {
        if (isMounted) {
          setGeneralError("Network connection interrupted. Failed to load provider.");
          setLoading(false);
        }
      }
    }

    loadData();
    return () => {
      isMounted = false;
    };
  }, [providerId, router, reloadTrigger]);

  // Operations: Submit provider for review (Sales action)
  const handleSubmitForReview = async () => {
    if (!provider || isSubmitting) return;
    setIsSubmitting(true);
    setGeneralError(null);
    setSuccessNotice(null);

    try {
      const res = await fetch(`/api/v1/staff/providers/${provider.id}/submit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ expectedVersion: provider.version }),
      });

      if (res.status === 409) {
        const fresh = await fetch(`/api/v1/staff/providers/${provider.id}`).then((r) => r.json());
        setServerProvider(fresh);
        setConflictOpen(true);
        setIsSubmitting(false);
        return;
      }

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setGeneralError(json.message || "Failed to submit provider for review.");
        setIsSubmitting(false);
        return;
      }

      setSuccessNotice("Provider submitted successfully for Operations review.");
      setCheckAnswersOpen(false);
      await fetchProvider();
    } catch {
      setGeneralError("Network error while submitting provider.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Operations: Activate Provider
  const handleActivateProvider = async () => {
    if (!provider || isActivatingProvider) return;
    setIsActivatingProvider(true);
    setGeneralError(null);
    setSuccessNotice(null);

    try {
      const res = await fetch(`/api/v1/staff/ops/providers/${provider.id}/activate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ expectedVersion: provider.version }),
      });

      if (res.status === 409) {
        const fresh = await fetch(`/api/v1/staff/providers/${provider.id}`).then((r) => r.json());
        setServerProvider(fresh);
        setConflictOpen(true);
        setIsActivatingProvider(false);
        return;
      }

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setGeneralError(json.message || "Failed to activate provider organization.");
        setIsActivatingProvider(false);
        return;
      }

      setSuccessNotice("Provider organization activated successfully.");
      await fetchProvider();
    } catch {
      setGeneralError("Network error while activating provider.");
    } finally {
      setIsActivatingProvider(false);
    }
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

  const isOps = currentStaff?.department === "OPERATIONS" || currentStaff?.department === "ADMIN";
  const isSubmitter = !!(
    currentStaff?.userId && provider.submittedByUserId === currentStaff.userId
  );

  const activeBranchesCount = provider.branches.filter((b) => b.status === "ACTIVE").length;
  const canActivateProvider =
    provider.status === "PENDING_REVIEW" && activeBranchesCount >= 1 && !isSubmitter;

  return (
    <div className="max-w-6xl mx-auto space-y-6" dir={dir}>
      {/* Top Breadcrumb & Actions Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <Link
            href="/staff/providers"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-brand-600 transition-colors mb-2"
          >
            <ChevronRight className="w-3.5 h-3.5 rtl:rotate-180" />
            <span>{t("onboarding.nav.directory")}</span>
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <Building2 className="w-6 h-6 text-brand-600 shrink-0" />
              <span>{provider.nameEn}</span>
              <span className="text-slate-400 font-normal">|</span>
              <span className="text-slate-700 font-semibold">{provider.nameAr}</span>
            </h1>
            <ProviderStatusBadge status={provider.status} />
          </div>
          <p className="text-xs text-slate-500 mt-1 flex items-center gap-2">
            <span>
              Version: <strong className="font-mono text-slate-700">{provider.version}</strong>
            </span>
            <span>•</span>
            <span>
              Cluster:{" "}
              <strong className="text-slate-700">
                {t(
                  `onboarding.clusters.${provider.primaryCluster.toLowerCase().replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase())}`
                )}
              </strong>
            </span>
            {provider.submittedAt && (
              <>
                <span>•</span>
                <span>
                  Submitted:{" "}
                  <strong className="font-mono">
                    {new Date(provider.submittedAt).toLocaleDateString()}
                  </strong>
                </span>
              </>
            )}
          </p>
        </div>

        {/* Global Lifecycle Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Sales Actions: Provider in DRAFT */}
          {provider.status === "DRAFT" && (
            <>
              <Link
                id="edit-provider-details-link"
                href={`/staff/providers/${provider.id}/edit`}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-xs transition-colors"
              >
                <Edit2 className="w-4 h-4 text-slate-600" />
                <span>{t("onboarding.actions.editProvider")}</span>
              </Link>
              <Link
                href={`/staff/providers/${provider.id}/branches/new`}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-xs transition-colors"
              >
                <Plus className="w-4 h-4 text-brand-600" />
                <span>{t("onboarding.branch.addBranchButton")}</span>
              </Link>
              <button
                type="button"
                onClick={() => setCheckAnswersOpen(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{t("onboarding.review.submitButton")}</span>
              </button>
            </>
          )}

          {/* Operations Actions: Provider in PENDING_REVIEW */}
          {provider.status === "PENDING_REVIEW" && isOps && (
            <>
              <button
                type="button"
                disabled={!canActivateProvider || isActivatingProvider}
                onClick={handleActivateProvider}
                title={
                  isSubmitter
                    ? "Dual custody: Cannot activate a provider you submitted"
                    : activeBranchesCount === 0
                      ? "Must activate at least 1 branch first"
                      : "Activate provider"
                }
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                {isActivatingProvider ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                )}
                <span>{t("onboarding.opsQueue.activateProvider")}</span>
              </button>

              <button
                type="button"
                onClick={() => setRejectingProviderOpen(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-semibold transition-colors cursor-pointer"
              >
                <XCircle className="w-3.5 h-3.5" />
                <span>{t("onboarding.opsQueue.rejectProvider")}</span>
              </button>
            </>
          )}

          {/* Operations Live Management: Pause / Resume */}
          {provider.status === "ACTIVE" && isOps && (
            <button
              type="button"
              onClick={() =>
                setPauseResumeTarget({
                  entityType: "provider",
                  action: "pause",
                })
              }
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 text-xs font-semibold transition-colors cursor-pointer"
            >
              <PauseCircle className="w-3.5 h-3.5 text-amber-600" />
              <span>{t("onboarding.modals.pauseProviderTitle")}</span>
            </button>
          )}

          {provider.status === "PAUSED" && isOps && (
            <button
              type="button"
              onClick={() =>
                setPauseResumeTarget({
                  entityType: "provider",
                  action: "resume",
                })
              }
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-semibold transition-colors cursor-pointer"
            >
              <PlayCircle className="w-3.5 h-3.5 text-emerald-600" />
              <span>{t("onboarding.modals.resumeProviderTitle")}</span>
            </button>
          )}
        </div>
      </div>

      {/* Offers Not Configured Disclaimer Banner on ACTIVE */}
      {provider.status === "ACTIVE" && <OffersNotConfiguredNotice />}

      {/* Dual Custody Warning Banner for Submitter */}
      {provider.status === "PENDING_REVIEW" && isSubmitter && (
        <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-800 text-sm flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">{t("onboarding.opsQueue.makerCheckerViolationTitle")}</p>
            <p className="text-xs text-amber-700 mt-1 leading-relaxed">
              {t("onboarding.opsQueue.makerCheckerViolationNotice")}
            </p>
          </div>
        </div>
      )}

      {/* Success Notification */}
      {successNotice && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span className="font-medium">{successNotice}</span>
          </div>
          <button
            onClick={() => setSuccessNotice(null)}
            className="text-xs font-semibold text-emerald-700 hover:text-emerald-900 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Error Notification */}
      {generalError && (
        <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <p className="font-medium">{generalError}</p>
        </div>
      )}

      {/* Organization Details Card */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-6 space-y-6">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider text-xs text-slate-400 flex items-center gap-2">
            <Building2 className="w-4 h-4 text-slate-500" />
            <span>{t("onboarding.review.providerLegalSection")}</span>
          </h2>
          {provider.status === "DRAFT" && (
            <Link
              id="edit-org-card-button"
              href={`/staff/providers/${provider.id}/edit`}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs text-brand-600 font-semibold bg-brand-50 hover:bg-brand-100 rounded-lg transition-colors"
            >
              <Edit2 className="w-3.5 h-3.5" />
              <span>{t("onboarding.actions.editProvider")}</span>
            </Link>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 text-sm">
          <div>
            <p className="text-xs text-slate-400 font-medium">
              {t("onboarding.providerForm.legalNameLabel")}
            </p>
            <p className="font-semibold text-slate-900 mt-1">{provider.legalName}</p>
          </div>

          <div>
            <p className="text-xs text-slate-400 font-medium">
              {t("onboarding.providerForm.taxIdLabel")}
            </p>
            <p className="font-mono font-semibold text-slate-900 mt-1" dir="ltr">
              {provider.taxRegistrationNumber}
            </p>
          </div>

          <div>
            <p className="text-xs text-slate-400 font-medium">
              {t("onboarding.providerForm.crNumberLabel")}
            </p>
            <p className="font-mono font-semibold text-slate-900 mt-1" dir="ltr">
              {provider.commercialRegistrationNumber}
            </p>
          </div>

          <div>
            <p className="text-xs text-slate-400 font-medium">
              {t("onboarding.providerForm.contactPersonLabel")}
            </p>
            <p className="font-medium text-slate-900 mt-1">{provider.contactPersonName}</p>
          </div>

          <div>
            <p className="text-xs text-slate-400 font-medium">
              {t("onboarding.providerForm.contactEmailLabel")}
            </p>
            <p className="font-mono text-slate-900 mt-1" dir="ltr">
              {provider.contactEmail}
            </p>
          </div>

          <div>
            <p className="text-xs text-slate-400 font-medium">
              {t("onboarding.providerForm.contactPhoneLabel")}
            </p>
            <p className="font-mono font-semibold text-slate-900 mt-1" dir="ltr">
              {provider.contactPhone}
            </p>
          </div>
        </div>
      </div>

      {/* Branches Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <MapPin className="w-5 h-5 text-brand-600" />
              <span>{t("onboarding.review.branchesSection")}</span>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                {provider.branches.length}
              </span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {activeBranchesCount} of {provider.branches.length} branches vetted and active
            </p>
          </div>

          {provider.status === "DRAFT" && (
            <Link
              href={`/staff/providers/${provider.id}/branches/new`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-brand-50 hover:bg-brand-100 text-brand-700 text-xs font-semibold transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t("onboarding.branch.addBranchButton")}</span>
            </Link>
          )}
        </div>

        {provider.branches.length === 0 ? (
          <div className="p-8 text-center bg-white rounded-2xl border border-dashed border-slate-300">
            <MapPin className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <h3 className="text-sm font-bold text-slate-800 mb-1">
              {t("onboarding.review.noBranchesWarning")}
            </h3>
            <p className="text-xs text-slate-500 mb-4 max-w-sm mx-auto">
              A provider organization must register at least one branch before submission for
              review.
            </p>
            {provider.status === "DRAFT" && (
              <Link
                href={`/staff/providers/${provider.id}/branches/new`}
                className="inline-flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-xl text-xs font-semibold hover:bg-brand-700 shadow-xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{t("onboarding.branch.addBranchButton")}</span>
              </Link>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {provider.branches.map((branch) => (
              <div
                key={branch.id}
                className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-5 hover:border-slate-300 transition-all space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span
                      className="font-mono font-bold text-xs px-2.5 py-1 rounded-lg bg-slate-100 text-slate-800"
                      dir="ltr"
                    >
                      {branch.branchCode}
                    </span>
                    <h3 className="text-base font-bold text-slate-900">
                      {branch.nameEn} /{" "}
                      <span className="font-semibold text-slate-700">{branch.nameAr}</span>
                    </h3>
                    <ProviderStatusBadge status={branch.status} />
                  </div>

                  {/* Branch Action Buttons */}
                  <div className="flex items-center gap-2">
                    {/* Sales edit button */}
                    {provider.status === "DRAFT" && branch.status === "DRAFT" && (
                      <Link
                        href={`/staff/providers/${provider.id}/branches/${branch.id}/edit`}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                      >
                        <Edit2 className="w-3 h-3 text-slate-500" />
                        <span>{t("common.edit")}</span>
                      </Link>
                    )}

                    {/* Operations Vetting & Activation */}
                    {isOps &&
                      (provider.status === "PENDING_REVIEW" || provider.status === "ACTIVE") && (
                        <>
                          {branch.status === "DRAFT" && (
                            <>
                              <button
                                type="button"
                                disabled={isSubmitter}
                                onClick={() => setVettingBranch(branch)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                              >
                                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                                <span>{t("onboarding.vetting.activateBranchButton")}</span>
                              </button>

                              {provider.status === "PENDING_REVIEW" && (
                                <button
                                  type="button"
                                  disabled={isSubmitter}
                                  onClick={() => setRejectingBranch(branch)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-200 text-red-700 text-xs font-semibold hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                                >
                                  <XCircle className="w-3.5 h-3.5 text-red-500" />
                                  <span>{t("onboarding.modals.rejectBranchTitle")}</span>
                                </button>
                              )}
                            </>
                          )}

                          {branch.status === "ACTIVE" && (
                            <button
                              type="button"
                              onClick={() =>
                                setPauseResumeTarget({
                                  entityType: "branch",
                                  action: "pause",
                                  branchId: branch.id,
                                  branchCode: branch.branchCode,
                                })
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-xs font-semibold hover:bg-amber-100 transition-colors cursor-pointer"
                            >
                              <PauseCircle className="w-3.5 h-3.5 text-amber-600" />
                              <span>{t("onboarding.modals.pauseBranchTitle")}</span>
                            </button>
                          )}

                          {branch.status === "PAUSED" && (
                            <button
                              type="button"
                              onClick={() =>
                                setPauseResumeTarget({
                                  entityType: "branch",
                                  action: "resume",
                                  branchId: branch.id,
                                  branchCode: branch.branchCode,
                                })
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs font-semibold hover:bg-emerald-100 transition-colors cursor-pointer"
                            >
                              <PlayCircle className="w-3.5 h-3.5 text-emerald-600" />
                              <span>{t("onboarding.modals.resumeBranchTitle")}</span>
                            </button>
                          )}
                        </>
                      )}
                  </div>
                </div>

                {/* Branch Details Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-slate-600">
                  <div>
                    <span className="text-slate-400 block font-medium mb-0.5">
                      {t("onboarding.branch.locationSection")}
                    </span>
                    <p className="font-semibold text-slate-800">{branch.streetAddressEn}</p>
                    <p className="text-slate-600 mt-0.5" dir="rtl">
                      {branch.streetAddressAr}
                    </p>
                    <p className="font-mono text-slate-500 text-[11px] mt-1" dir="ltr">
                      📍 {branch.latitude.toFixed(5)}, {branch.longitude.toFixed(5)}
                    </p>
                  </div>

                  <div>
                    <span className="text-slate-400 block font-medium mb-0.5">
                      {t("onboarding.branch.contactHoursSection")}
                    </span>
                    <p
                      className="font-mono font-semibold text-slate-800 flex items-center gap-1"
                      dir="ltr"
                    >
                      <Phone className="w-3 h-3 text-slate-400" />
                      {branch.contactPhone}
                    </p>
                    <p className="text-slate-500 text-[11px] mt-1 flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-400" />
                      {branch.operatingHours?.filter((h) => !h.isClosed).length || 0} days
                      active/week
                    </p>
                  </div>

                  <div>
                    <span className="text-slate-400 block font-medium mb-0.5">Vetting & Audit</span>
                    {branch.status === "ACTIVE" && branch.evidenceDocumentRef ? (
                      <div className="space-y-0.5">
                        <p className="text-emerald-700 font-semibold flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Vetted & Active</span>
                        </p>
                        <p className="font-mono text-[11px] text-slate-500" dir="ltr">
                          Ref: {branch.evidenceDocumentRef}
                        </p>
                        {branch.vettedAt && (
                          <p className="text-[10px] text-slate-400 font-mono">
                            {new Date(branch.vettedAt).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                    ) : branch.status === "DECOMMISSIONED" || branch.rejectionReason ? (
                      <p className="text-red-600 font-medium">
                        {branch.status === "DECOMMISSIONED" ? "Decommissioned" : "Rejected"}:{" "}
                        {branch.rejectionReason || "Criteria not met"}
                      </p>
                    ) : (
                      <p className="text-slate-400 italic">Pending offline human verification</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Read-Only Check Answers Submission Summary (For Sales in DRAFT) */}
      {checkAnswersOpen && provider.status === "DRAFT" && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="max-w-4xl w-full my-8">
            <CheckAnswersSummary
              provider={provider}
              branches={provider.branches}
              onSubmit={handleSubmitForReview}
              onBack={() => setCheckAnswersOpen(false)}
              isSubmitting={isSubmitting}
            />
          </div>
        </div>
      )}

      {/* Operations Vetting Modal for Branch */}
      {vettingBranch && (
        <BranchVettingModal
          isOpen={!!vettingBranch}
          branchName={vettingBranch.nameEn}
          onClose={() => setVettingBranch(null)}
          onConfirm={async (data) => {
            const res = await fetch(
              `/api/v1/staff/ops/providers/${provider.id}/branches/${vettingBranch.id}/activate`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  expectedVersion: vettingBranch.version,
                  ...data,
                }),
              }
            );
            if (res.status === 409) {
              const fresh = await fetch(`/api/v1/staff/providers/${provider.id}`).then((r) =>
                r.json()
              );
              setServerProvider(fresh);
              setConflictOpen(true);
              setVettingBranch(null);
              return;
            }
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              throw new Error(err.message || "Failed to activate branch.");
            }
            setVettingBranch(null);
            setSuccessNotice(`Branch ${vettingBranch.branchCode} vetted and activated.`);
            await fetchProvider();
          }}
        />
      )}

      {/* Operations Rejection Modal for Branch */}
      {rejectingBranch && (
        <BranchRejectModal
          isOpen={!!rejectingBranch}
          branchName={rejectingBranch.nameEn}
          onClose={() => setRejectingBranch(null)}
          onConfirm={async (data) => {
            const res = await fetch(
              `/api/v1/staff/ops/providers/${provider.id}/branches/${rejectingBranch.id}/reject`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  expectedVersion: rejectingBranch.version,
                  ...data,
                }),
              }
            );
            if (res.status === 409) {
              const fresh = await fetch(`/api/v1/staff/providers/${provider.id}`).then((r) =>
                r.json()
              );
              setServerProvider(fresh);
              setConflictOpen(true);
              setRejectingBranch(null);
              return;
            }
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              throw new Error(err.message || "Failed to reject branch.");
            }
            setRejectingBranch(null);
            setSuccessNotice(`Branch ${rejectingBranch.branchCode} rejection processed.`);
            await fetchProvider();
          }}
        />
      )}

      {/* Operations Rejection Modal for Provider */}
      {rejectingProviderOpen && (
        <ProviderRejectModal
          isOpen={rejectingProviderOpen}
          providerName={provider.nameEn}
          onClose={() => setRejectingProviderOpen(false)}
          onConfirm={async (data) => {
            const res = await fetch(`/api/v1/staff/ops/providers/${provider.id}/reject`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                expectedVersion: provider.version,
                ...data,
              }),
            });
            if (res.status === 409) {
              const fresh = await fetch(`/api/v1/staff/providers/${provider.id}`).then((r) =>
                r.json()
              );
              setServerProvider(fresh);
              setConflictOpen(true);
              setRejectingProviderOpen(false);
              return;
            }
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              throw new Error(err.message || "Failed to reject provider.");
            }
            setRejectingProviderOpen(false);
            setSuccessNotice("Provider rejection processed.");
            await fetchProvider();
          }}
        />
      )}

      {/* Pause/Resume Modal */}
      {pauseResumeTarget && (
        <PauseResumeModal
          isOpen={!!pauseResumeTarget}
          mode={pauseResumeTarget.action === "pause" ? "PAUSE" : "RESUME"}
          entityName={
            pauseResumeTarget.entityType === "provider"
              ? provider.nameEn
              : pauseResumeTarget.branchCode || "Branch"
          }
          onClose={() => setPauseResumeTarget(null)}
          onConfirm={async (data) => {
            const isProv = pauseResumeTarget.entityType === "provider";
            const url = isProv
              ? `/api/v1/staff/ops/providers/${provider.id}/${pauseResumeTarget.action}`
              : `/api/v1/staff/ops/providers/${provider.id}/branches/${pauseResumeTarget.branchId}/${pauseResumeTarget.action}`;

            const expectedVersion = isProv
              ? provider.version
              : provider.branches.find((b) => b.id === pauseResumeTarget.branchId)?.version || 1;

            const res = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                expectedVersion,
                ...data,
              }),
            });

            if (res.status === 409) {
              const fresh = await fetch(`/api/v1/staff/providers/${provider.id}`).then((r) =>
                r.json()
              );
              setServerProvider(fresh);
              setConflictOpen(true);
              setPauseResumeTarget(null);
              return;
            }

            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              throw new Error(err.message || `Failed to ${pauseResumeTarget.action} entity.`);
            }

            setPauseResumeTarget(null);
            setSuccessNotice(
              `${isProv ? "Provider" : "Branch"} ${pauseResumeTarget.action}d successfully.`
            );
            await fetchProvider();
          }}
        />
      )}

      {/* Concurrency Conflict Resolver */}
      {conflictOpen && serverProvider && (
        <ConflictResolver
          isOpen={conflictOpen}
          entityType="provider"
          currentVersion={provider.version}
          serverVersion={serverProvider.version}
          clientValues={{
            nameEn: provider.nameEn,
            nameAr: provider.nameAr,
            legalName: provider.legalName,
            status: provider.status,
          }}
          serverValues={{
            nameEn: serverProvider.nameEn,
            nameAr: serverProvider.nameAr,
            legalName: serverProvider.legalName,
            status: serverProvider.status,
          }}
          onApplyServer={() => {
            setProvider(serverProvider);
            setConflictOpen(false);
          }}
          onOverwrite={() => {
            setProvider({ ...provider, version: serverProvider.version });
            setConflictOpen(false);
          }}
          onCancel={() => setConflictOpen(false)}
        />
      )}
    </div>
  );
}
