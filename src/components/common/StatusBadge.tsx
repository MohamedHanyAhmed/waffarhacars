"use client";

import React from "react";
import { ReservationStatus } from "../../domain/types";
import { useI18n } from "../../context/I18nContext";
import { CheckCircle2, Clock, XCircle, AlertCircle, ShieldCheck } from "lucide-react";

interface StatusBadgeProps {
  status: ReservationStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const { t } = useI18n();

  const configs = {
    confirmed: {
      label: t("pass.confirmed"),
      icon: Clock,
      style: "bg-blue-50 text-blue-700 border-blue-200",
    },
    checked_in: {
      label: t("pass.checkedIn"),
      icon: ShieldCheck,
      style: "bg-amber-50 text-amber-800 border-amber-200",
    },
    completed: {
      label: t("pass.completed"),
      icon: CheckCircle2,
      style: "bg-emerald-50 text-emerald-800 border-emerald-300",
    },
    customer_cancelled: {
      label: t("pass.cancelled"),
      icon: XCircle,
      style: "bg-rose-50 text-rose-700 border-rose-200",
    },
    no_show: {
      label: t("pass.noShow"),
      icon: AlertCircle,
      style: "bg-slate-100 text-slate-700 border-slate-300",
    },
    disputed: {
      label: "Disputed",
      icon: AlertCircle,
      style: "bg-purple-50 text-purple-700 border-purple-200",
    },
  }[status] || {
    label: status,
    icon: Clock,
    style: "bg-slate-100 text-slate-700 border-slate-300",
  };

  const Icon = configs.icon;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border shadow-xs ${configs.style}`}
      role="status"
    >
      <Icon className="w-3.5 h-3.5" aria-hidden="true" />
      <span>{configs.label}</span>
    </span>
  );
}
