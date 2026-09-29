"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "@/context/I18nContext";
import {
  Building2,
  PlusCircle,
  Search,
  RefreshCw,
  Loader2,
  MapPin,
  ChevronRight,
  AlertCircle,
} from "lucide-react";
import { ProviderStatusBadge } from "@/components/staff/ProviderStatusBadge";
import { OffersNotConfiguredNotice } from "@/components/staff/OffersNotConfiguredNotice";
import type { ProviderOrganizationWithBranches } from "@/lib/provider/validation";
import type { StaffAuthStatusResponse } from "@/lib/staff/status-contract";

export default function ProviderDirectoryPage() {
  const { t, dir } = useI18n();
  const router = useRouter();

  const [providers, setProviders] = useState<ProviderOrganizationWithBranches[]>([]);
  const [staffStatus, setStaffStatus] = useState<StaffAuthStatusResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("ALL");
  const [selectedCluster, setSelectedCluster] = useState("ALL");

  const [refreshTrigger, setRefreshTrigger] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;

    async function executeLoad() {
      try {
        const authRes = await fetch("/api/v1/staff/auth/status", {
          signal,
          headers: { Accept: "application/json" },
          cache: "no-store",
        });

        if (authRes.status === 401) {
          router.replace("/staff/login");
          return;
        }

        if (authRes.ok) {
          const authData = (await authRes.json()) as StaffAuthStatusResponse;
          setStaffStatus(authData);
        }

        const res = await fetch("/api/v1/staff/providers", {
          signal,
          headers: { Accept: "application/json" },
          cache: "no-store",
        });

        if (res.status === 401) {
          router.replace("/staff/login");
          return;
        }

        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(errJson.message || "Failed to load provider organizations");
        }

        const json = await res.json();
        const list = Array.isArray(json) ? json : json.providers || [];
        setProviders(list);
      } catch (err: unknown) {
        if (signal?.aborted) return;
        setError(err instanceof Error ? err.message : "Error connecting to service");
      } finally {
        if (!signal?.aborted) {
          setIsLoading(false);
        }
      }
    }

    executeLoad();
    return () => controller.abort();
  }, [router, refreshTrigger]);

  const handleRefresh = () => {
    setIsLoading(true);
    setError(null);
    setRefreshTrigger((prev) => prev + 1);
  };

  const isSales = staffStatus?.department === "SALES" || staffStatus?.department === "ADMIN";

  const filteredProviders = providers.filter((p) => {
    if (selectedStatus !== "ALL" && p.status !== selectedStatus) {
      return false;
    }
    if (selectedCluster !== "ALL" && p.primaryCluster !== selectedCluster) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchNameEn = p.nameEn.toLowerCase().includes(q);
      const matchNameAr = p.nameAr.toLowerCase().includes(q);
      const matchLegal = p.legalName.toLowerCase().includes(q);
      const matchTax = p.taxRegistrationNumber.includes(q);
      const matchCr = p.commercialRegistrationNumber.toLowerCase().includes(q);
      return matchNameEn || matchNameAr || matchLegal || matchTax || matchCr;
    }
    return true;
  });

  return (
    <div className="space-y-6" dir={dir}>
      {/* Header Area */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
            <Building2 className="w-7 h-7 text-brand-600" />
            <span>{t("onboarding.directory.title")}</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">{t("onboarding.directory.subtitle")}</p>
        </div>

        {isSales && (
          <Link
            href="/staff/providers/new"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold text-white bg-brand-600 hover:bg-brand-700 transition-colors shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <PlusCircle className="w-4 h-4" />
            <span>{t("onboarding.directory.newProviderCta")}</span>
          </Link>
        )}
      </div>

      {/* Truthful Notice Banner on Offers Configuration */}
      <OffersNotConfiguredNotice />

      {/* Filters & Search */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Search Input */}
          <div className="relative sm:col-span-1">
            <Search className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("onboarding.directory.searchPlaceholder")}
              className="w-full ps-9 pe-3 py-2 text-xs border border-slate-200 rounded-xl focus:ring-2 focus:ring-brand-500"
            />
          </div>

          {/* Status Filter */}
          <div>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              aria-label={t("onboarding.directory.filterStatus")}
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:ring-2 focus:ring-brand-500 bg-white"
            >
              <option value="ALL">{t("onboarding.status.all")}</option>
              <option value="DRAFT">{t("onboarding.status.draft")}</option>
              <option value="PENDING_REVIEW">{t("onboarding.status.pendingReview")}</option>
              <option value="ACTIVE">{t("onboarding.status.active")}</option>
              <option value="PAUSED">{t("onboarding.status.paused")}</option>
              <option value="REJECTED">{t("onboarding.status.rejected")}</option>
            </select>
          </div>

          {/* Cluster Filter */}
          <div>
            <select
              value={selectedCluster}
              onChange={(e) => setSelectedCluster(e.target.value)}
              aria-label={t("onboarding.directory.filterCluster")}
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:ring-2 focus:ring-brand-500 bg-white"
            >
              <option value="ALL">{t("onboarding.clusters.all")}</option>
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

      {/* Main Content Area */}
      {isLoading ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-brand-600 mx-auto mb-3" />
          <p className="text-xs text-slate-500 font-medium">Loading provider directory...</p>
        </div>
      ) : error ? (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-6 text-rose-800 text-xs flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={handleRefresh}
            className="px-3 py-1.5 rounded-lg bg-rose-600 text-white font-semibold hover:bg-rose-700 transition-colors flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Retry</span>
          </button>
        </div>
      ) : filteredProviders.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center space-y-3">
          <Building2 className="w-10 h-10 text-slate-300 mx-auto" />
          <h3 className="text-base font-bold text-slate-800">
            {t("onboarding.directory.emptyTitle")}
          </h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            {t("onboarding.directory.emptyDesc")}
          </p>
          {isSales && (
            <Link
              href="/staff/providers/new"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-brand-700 bg-brand-50 hover:bg-brand-100 transition-colors mt-2"
            >
              <PlusCircle className="w-4 h-4" />
              <span>{t("onboarding.directory.newProviderCta")}</span>
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredProviders.map((provider) => {
            const branchCount = provider.branches?.length ?? 0;
            return (
              <div
                key={provider.id}
                className="bg-white rounded-2xl border border-slate-200/80 shadow-xs hover:border-brand-200 transition-all p-5 flex flex-col justify-between gap-4"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-base font-bold text-slate-900 leading-snug">
                        {provider.nameEn}
                      </h2>
                      <span className="text-xs text-slate-600 font-medium block">
                        {provider.nameAr}
                      </span>
                    </div>

                    <ProviderStatusBadge status={provider.status} showOffersNotice={true} />
                  </div>

                  <p className="text-xs text-slate-500 line-clamp-1">
                    <span className="font-semibold text-slate-700">{provider.legalName}</span>
                  </p>

                  <div className="grid grid-cols-2 gap-2 text-[11px] pt-2 border-t border-slate-100 text-slate-500">
                    <div>
                      <span className="text-slate-400 block">
                        {t("onboarding.providerForm.taxIdLabel")}
                      </span>
                      <span dir="ltr" className="font-mono font-medium text-slate-800">
                        {provider.taxRegistrationNumber}
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-400 block">
                        {t("onboarding.providerForm.clusterLabel")}
                      </span>
                      <span className="font-medium text-slate-800">{provider.primaryCluster}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-slate-100 text-xs text-slate-500">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-3.5 h-3.5 text-slate-400" />
                    <span>
                      {branchCount === 1
                        ? t("onboarding.directory.singleBranch")
                        : t("onboarding.directory.branchCount", { count: branchCount })}
                    </span>
                    <span className="text-slate-300">•</span>
                    <span className="font-mono text-[11px] text-slate-400">
                      v{provider.version}
                    </span>
                  </div>

                  <Link
                    href={`/staff/providers/${provider.id}`}
                    className="inline-flex items-center gap-1 font-bold text-brand-600 hover:text-brand-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded p-1"
                  >
                    <span>{t("onboarding.directory.viewDetails")}</span>
                    <ChevronRight className="w-4 h-4 rtl:rotate-180" />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
