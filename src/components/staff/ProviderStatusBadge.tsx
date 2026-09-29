"use client";

import React from "react";
import { useI18n } from "@/context/I18nContext";
import { Clock, CheckCircle2, PauseCircle, XCircle, FileEdit, AlertOctagon } from "lucide-react";
import type { ProviderStatus, BranchStatus } from "@/lib/provider/validation";

export interface StatusBadgeProps {
  status: ProviderStatus | BranchStatus;
  size?: "sm" | "md";
  showOffersNotice?: boolean;
}

export function ProviderStatusBadge({
  status,
  size = "md",
  showOffersNotice = false,
}: StatusBadgeProps) {
  const { t } = useI18n();

  const config: Record<
    ProviderStatus | BranchStatus,
    { label: string; bg: string; text: string; border: string; icon: React.ReactNode }
  > = {
    DRAFT: {
      label: t("onboarding.status.draft"),
      bg: "bg-slate-100",
      text: "text-slate-700",
      border: "border-slate-200",
      icon: <FileEdit className="w-3.5 h-3.5 text-slate-500" />,
    },
    PENDING_REVIEW: {
      label: t("onboarding.status.pendingReview"),
      bg: "bg-amber-50",
      text: "text-amber-800",
      border: "border-amber-200",
      icon: <Clock className="w-3.5 h-3.5 text-amber-600" />,
    },
    ACTIVE: {
      label: t("onboarding.status.active"),
      bg: "bg-emerald-50",
      text: "text-emerald-800",
      border: "border-emerald-200",
      icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />,
    },
    PAUSED: {
      label: t("onboarding.status.paused"),
      bg: "bg-orange-50",
      text: "text-orange-800",
      border: "border-orange-200",
      icon: <PauseCircle className="w-3.5 h-3.5 text-orange-600" />,
    },
    REJECTED: {
      label: t("onboarding.status.rejected"),
      bg: "bg-rose-50",
      text: "text-rose-800",
      border: "border-rose-200",
      icon: <XCircle className="w-3.5 h-3.5 text-rose-600" />,
    },
    TERMINATED: {
      label: t("onboarding.status.terminated") || "Terminated",
      bg: "bg-stone-100",
      text: "text-stone-700",
      border: "border-stone-300",
      icon: <AlertOctagon className="w-3.5 h-3.5 text-stone-500" />,
    },
    DECOMMISSIONED: {
      label: t("onboarding.status.decommissioned") || "Decommissioned",
      bg: "bg-stone-100",
      text: "text-stone-700",
      border: "border-stone-300",
      icon: <AlertOctagon className="w-3.5 h-3.5 text-stone-500" />,
    },
  };

  const unknownConfig = {
    label: t("onboarding.status.unknown") || "Unknown Status",
    bg: "bg-rose-50",
    text: "text-rose-700",
    border: "border-rose-200",
    icon: <AlertOctagon className="w-3.5 h-3.5 text-rose-500" />,
  };

  const current = status in config ? config[status as keyof typeof config] : unknownConfig;
  const sizeClasses = size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs";

  return (
    <div className="inline-flex items-center gap-1.5 flex-wrap">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full font-semibold border ${current.bg} ${current.text} ${current.border} ${sizeClasses}`}
      >
        {current.icon}
        <span>{current.label}</span>
      </span>

      {status === "ACTIVE" && showOffersNotice && (
        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
          {t("onboarding.notice.offersNotConfigured")}
        </span>
      )}
    </div>
  );
}
