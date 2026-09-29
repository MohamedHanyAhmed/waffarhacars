"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "@/context/I18nContext";
import {
  ClipboardCheck,
  Clock,
  User,
  ArrowRight,
  RefreshCw,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import type { CairoCluster } from "@/lib/provider/validation";

interface PendingBranch {
  id: string;
  branchCode: string;
  nameEn: string;
  status: string;
}

interface PendingProvider {
  id: string;
  nameEn: string;
  nameAr: string;
  legalName: string;
  primaryCluster: CairoCluster;
  status: string;
  submittedAt: string;
  submittedByUser?: {
    id: string;
    name: string;
    email: string;
  } | null;
  branches: PendingBranch[];
}

export default function OpsPendingQueuePage() {
  const { t, dir } = useI18n();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [providers, setProviders] = useState<PendingProvider[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reloadTrigger, setReloadTrigger] = useState(0);

  useEffect(() => {
    let isMounted = true;
    async function loadQueue() {
      try {
        const res = await fetch("/api/v1/staff/ops/providers/pending", {
          headers: { Accept: "application/json" },
        });

        if (res.status === 401) {
          router.replace("/staff/login");
          return;
        }

        if (res.status === 403) {
          if (isMounted) {
            setError("Access Denied: Only Operations staff can access the review queue.");
            setLoading(false);
          }
          return;
        }

        if (!res.ok) {
          if (isMounted) {
            setError("Failed to load operations pending queue.");
            setLoading(false);
          }
          return;
        }

        const data = await res.json();
        const list: PendingProvider[] = Array.isArray(data)
          ? data
          : Array.isArray(data?.providers)
            ? data.providers
            : [];
        if (isMounted) {
          setProviders(list);
          setLoading(false);
        }
      } catch {
        if (isMounted) {
          setError("Network connection interrupted. Please refresh to retry.");
          setLoading(false);
        }
      }
    }

    loadQueue();
    return () => {
      isMounted = false;
    };
  }, [router, reloadTrigger]);

  const handleRefresh = () => {
    setLoading(true);
    setError(null);
    setReloadTrigger((n) => n + 1);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6" dir={dir}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
            <ClipboardCheck className="w-6 h-6 text-brand-600 shrink-0" />
            <span>{t("onboarding.opsQueue.title")}</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">{t("onboarding.opsQueue.subtitle")}</p>
        </div>

        <button
          onClick={handleRefresh}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-xs disabled:opacity-50 transition-colors cursor-pointer self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          <span>{t("common.refresh")}</span>
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <p className="font-medium">{error}</p>
        </div>
      )}

      {/* Loading state */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-500">
          <Loader2 className="w-8 h-8 animate-spin text-brand-600 mb-3" />
          <p className="text-sm font-medium">Loading pending queue...</p>
        </div>
      ) : providers.length === 0 ? (
        /* Empty Queue state */
        <div className="bg-white rounded-2xl border border-slate-200/80 p-12 text-center shadow-xs">
          <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
          <h3 className="text-lg font-bold text-slate-900 mb-1">
            {t("onboarding.opsQueue.emptyTitle")}
          </h3>
          <p className="text-sm text-slate-500 max-w-md mx-auto">
            {t("onboarding.opsQueue.emptyDesc")}
          </p>
        </div>
      ) : (
        /* Queue Table / Cards */
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600 rtl:text-right">
              <thead className="bg-slate-50 border-b border-slate-100 text-xs font-bold uppercase tracking-wider text-slate-400">
                <tr>
                  <th scope="col" className="px-6 py-4">
                    {t("onboarding.opsQueue.tableProvider")}
                  </th>
                  <th scope="col" className="px-6 py-4">
                    {t("onboarding.opsQueue.tableCluster")}
                  </th>
                  <th scope="col" className="px-6 py-4">
                    {t("onboarding.opsQueue.tableBranches")}
                  </th>
                  <th scope="col" className="px-6 py-4">
                    {t("onboarding.opsQueue.tableSubmittedBy")}
                  </th>
                  <th scope="col" className="px-6 py-4">
                    {t("onboarding.opsQueue.tableSubmittedAt")}
                  </th>
                  <th scope="col" className="px-6 py-4 text-right rtl:text-left">
                    {t("onboarding.opsQueue.tableAction")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {providers.map((provider) => (
                  <tr key={provider.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-bold text-slate-900">{provider.nameEn}</div>
                      <div className="text-xs text-slate-500 font-medium mt-0.5">
                        {provider.nameAr}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">
                        {t(
                          `onboarding.clusters.${provider.primaryCluster
                            .toLowerCase()
                            .replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase())}`
                        )}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                        <span className="font-mono">{provider.branches.length}</span>
                        <span>branches</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-1.5 text-xs text-slate-700">
                        <User className="w-3.5 h-3.5 text-slate-400" />
                        <span className="font-medium">
                          {provider.submittedByUser?.name || "Sales Agent"}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div
                        className="flex items-center gap-1.5 text-xs font-mono text-slate-500"
                        dir="ltr"
                      >
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        <span>
                          {provider.submittedAt
                            ? new Date(provider.submittedAt).toLocaleDateString()
                            : "—"}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right rtl:text-left">
                      <Link
                        href={`/staff/providers/${provider.id}`}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold shadow-xs transition-colors"
                      >
                        <span>{t("onboarding.opsQueue.inspect")}</span>
                        <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
