"use client";

import React from "react";
import Link from "next/link";
import { useDemoState } from "../../context/DemoStateContext";
import { useI18n } from "../../context/I18nContext";
import { formatMoney, moneyFromMinor } from "../../domain/money";
import { DemoScenarioMode } from "../../domain/types";
import {
  Sliders,
  X,
  RotateCcw,
  ShieldAlert,
  Car,
  CheckCircle2,
  Lock,
  User,
  Wrench,
  FileSpreadsheet,
  Briefcase,
  AlertTriangle,
  Clock,
  Ban,
  HelpCircle,
  Sparkles,
} from "lucide-react";

interface DemoScenarioDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function DemoScenarioDrawer({ isOpen, onClose }: DemoScenarioDrawerProps) {
  const {
    activeScenario,
    setScenario,
    resetDemoState,
    selectedVehicle,
    currentReservation,
    commissionAccruals,
  } = useDemoState();
  const { locale, t } = useI18n();
  const isAr = locale === "ar";

  if (!isOpen) return null;

  const scenarios: Array<{
    id: DemoScenarioMode;
    titleKey: string;
    descKey: string;
    icon: React.ReactNode;
    colorClasses: string;
  }> = [
    {
      id: "clean_empty",
      titleKey: "drawer.cleanEmptyTitle",
      descKey: "drawer.cleanEmptyDesc",
      icon: <Sparkles className="w-3.5 h-3.5 text-slate-500" />,
      colorClasses: "border-slate-500 bg-slate-50 text-slate-900",
    },
    {
      id: "loading",
      titleKey: "drawer.loadingTitle",
      descKey: "drawer.loadingDesc",
      icon: <Clock className="w-3.5 h-3.5 text-blue-500" />,
      colorClasses: "border-blue-500 bg-blue-50 text-blue-900",
    },
    {
      id: "incompatible_vehicle",
      titleKey: "drawer.incompatibleTitle",
      descKey: "drawer.incompatibleDesc",
      icon: <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />,
      colorClasses: "border-rose-500 bg-rose-50 text-rose-900",
    },
    {
      id: "confirmed",
      titleKey: "drawer.confirmedTitle",
      descKey: "drawer.confirmedDesc",
      icon: <Lock className="w-3.5 h-3.5 text-brand-600" />,
      colorClasses: "border-brand-500 bg-brand-50 text-brand-900",
    },
    {
      id: "checked_in_unissued",
      titleKey: "drawer.checkedInUnissuedTitle",
      descKey: "drawer.checkedInUnissuedDesc",
      icon: <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />,
      colorClasses: "border-amber-500 bg-amber-50 text-amber-900",
    },
    {
      id: "checked_in_valid_pin",
      titleKey: "drawer.checkedInValidPinTitle",
      descKey: "drawer.checkedInValidPinDesc",
      icon: <CheckCircle2 className="w-3.5 h-3.5 text-teal-600" />,
      colorClasses: "border-teal-500 bg-teal-50 text-teal-900",
    },
    {
      id: "wrong_pin",
      titleKey: "drawer.wrongPinTitle",
      descKey: "drawer.wrongPinDesc",
      icon: <HelpCircle className="w-3.5 h-3.5 text-orange-600" />,
      colorClasses: "border-orange-500 bg-orange-50 text-orange-900",
    },
    {
      id: "expired_pin",
      titleKey: "drawer.expiredPinTitle",
      descKey: "drawer.expiredPinDesc",
      icon: <Clock className="w-3.5 h-3.5 text-red-600" />,
      colorClasses: "border-red-500 bg-red-50 text-red-900",
    },
    {
      id: "cancelled",
      titleKey: "drawer.cancelledTitle",
      descKey: "drawer.cancelledDesc",
      icon: <Ban className="w-3.5 h-3.5 text-slate-600" />,
      colorClasses: "border-slate-500 bg-slate-100 text-slate-900",
    },
    {
      id: "no_show",
      titleKey: "drawer.noShowTitle",
      descKey: "drawer.noShowDesc",
      icon: <AlertTriangle className="w-3.5 h-3.5 text-amber-700" />,
      colorClasses: "border-amber-600 bg-amber-50 text-amber-950",
    },
    {
      id: "already_completed",
      titleKey: "drawer.alreadyCompletedTitle",
      descKey: "drawer.alreadyCompletedDesc",
      icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />,
      colorClasses: "border-emerald-500 bg-emerald-50 text-emerald-900",
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/50 backdrop-blur-xs transition-opacity"
      role="dialog"
      aria-modal="true"
      aria-labelledby="scenario-drawer-title"
    >
      <div className="w-full max-w-md bg-white h-full shadow-2xl flex flex-col overflow-y-auto">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-900 text-white">
          <div className="flex items-center gap-2">
            <Sliders className="w-5 h-5 text-brand-400" />
            <h2 id="scenario-drawer-title" className="font-bold text-base">
              {t("drawer.title")}
            </h2>
          </div>
          <button
            onClick={onClose}
            data-testid="close-drawer-button"
            className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            aria-label={isAr ? "إغلاق اللوحة" : "Close drawer"}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-6 flex-1">
          {/* Quick Route Switcher */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
              {t("drawer.routesTitle")}
            </h3>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <Link
                href="/"
                onClick={onClose}
                className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 hover:border-brand-500 hover:bg-brand-50 transition-colors font-medium text-slate-700 min-h-[44px]"
              >
                <User className="w-4 h-4 text-brand-600 shrink-0" />
                <span>{t("drawer.routeHome")}</span>
              </Link>
              <Link
                href="/results"
                onClick={onClose}
                className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 hover:border-brand-500 hover:bg-brand-50 transition-colors font-medium text-slate-700 min-h-[44px]"
              >
                <Car className="w-4 h-4 text-brand-600 shrink-0" />
                <span>{t("drawer.routeResults")}</span>
              </Link>
              <Link
                href="/offers/offer-oil-change-sunny"
                onClick={onClose}
                className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 hover:border-brand-500 hover:bg-brand-50 transition-colors font-medium text-slate-700 min-h-[44px]"
              >
                <Wrench className="w-4 h-4 text-brand-600 shrink-0" />
                <span>{t("drawer.routeOffer")}</span>
              </Link>
              <Link
                href="/reserve/offer-oil-change-sunny"
                onClick={onClose}
                className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 hover:border-brand-500 hover:bg-brand-50 transition-colors font-medium text-slate-700 min-h-[44px]"
              >
                <Lock className="w-4 h-4 text-brand-600 shrink-0" />
                <span>{t("drawer.routeReserve")}</span>
              </Link>
              <Link
                href="/my-reservations"
                onClick={onClose}
                className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 hover:border-brand-500 hover:bg-brand-50 transition-colors font-medium text-slate-700 min-h-[44px]"
              >
                <CheckCircle2 className="w-4 h-4 text-brand-600 shrink-0" />
                <span>{t("drawer.routePass")}</span>
              </Link>
              <Link
                href="/provider/check-in"
                onClick={onClose}
                className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 hover:border-brand-500 hover:bg-brand-50 transition-colors font-medium text-slate-700 min-h-[44px]"
              >
                <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
                <span>{t("drawer.routeCheckIn")}</span>
              </Link>
              <Link
                href="/provider/complete"
                onClick={onClose}
                className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 hover:border-brand-500 hover:bg-brand-50 transition-colors font-medium text-slate-700 min-h-[44px]"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{t("drawer.routeComplete")}</span>
              </Link>
              <Link
                href={
                  currentReservation
                    ? `/my-reservations/${currentReservation.id}/completed`
                    : "/my-reservations/res-sunny-5688/completed"
                }
                onClick={onClose}
                className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 hover:border-brand-500 hover:bg-brand-50 transition-colors font-medium text-slate-700 min-h-[44px]"
              >
                <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
                <span>{t("drawer.routeReview")}</span>
              </Link>
              <Link
                href="/sales/new-offer"
                onClick={onClose}
                className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 hover:border-brand-500 hover:bg-brand-50 transition-colors font-medium text-slate-700 min-h-[44px]"
              >
                <Briefcase className="w-4 h-4 text-purple-600 shrink-0" />
                <span>{t("drawer.routeSales")}</span>
              </Link>
              <Link
                href="/ops/approvals"
                onClick={onClose}
                className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 hover:border-brand-500 hover:bg-brand-50 transition-colors font-medium text-slate-700 min-h-[44px]"
              >
                <FileSpreadsheet className="w-4 h-4 text-teal-600 shrink-0" />
                <span>{t("drawer.routeOps")}</span>
              </Link>
            </div>
          </div>

          {/* All 11 Preset Reachable States */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
              {t("drawer.scenariosTitle")}
            </h3>
            <div className="space-y-2" role="radiogroup" aria-label={t("drawer.scenariosTitle")}>
              {scenarios.map((sc) => {
                const isCurrent = activeScenario === sc.id;
                return (
                  <button
                    key={sc.id}
                    role="radio"
                    aria-checked={isCurrent}
                    data-testid={`scenario-option-${sc.id}`}
                    onClick={() => setScenario(sc.id)}
                    className={`w-full text-start p-3 rounded-xl border text-xs transition-all min-h-[44px] ${
                      isCurrent
                        ? `${sc.colorClasses} font-bold shadow-xs`
                        : "border-slate-200 hover:bg-slate-50 text-slate-700"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold flex items-center gap-2">
                        <span
                          className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${
                            isCurrent
                              ? "border-brand-600 bg-brand-600"
                              : "border-slate-300 bg-white"
                          }`}
                        >
                          {isCurrent && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                        </span>
                        {sc.icon}
                        <span>{t(sc.titleKey)}</span>
                      </span>
                      {isCurrent && (
                        <span className="text-[10px] bg-slate-900 text-white px-2 py-0.5 rounded-full font-bold">
                          {t("drawer.activeBadge")}
                        </span>
                      )}
                    </div>
                    <p className="text-slate-500 font-normal leading-relaxed">{t(sc.descKey)}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Current Live State Summary */}
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1.5">
            <h4 className="font-bold text-slate-800">{t("drawer.liveStateTitle")}</h4>
            <div className="flex justify-between text-slate-600">
              <span>{t("drawer.car")}</span>
              <span className="font-semibold text-slate-900">
                {selectedVehicle.year} {selectedVehicle.make} {selectedVehicle.model}
              </span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>{t("drawer.reservationStatus")}</span>
              <span className="font-bold text-brand-700 uppercase">
                {currentReservation
                  ? `${currentReservation.status} (rev ${currentReservation.revision})`
                  : isAr
                    ? "لا يوجد (حالة نظيفة)"
                    : "NONE (CLEAN BASELINE)"}
              </span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>{t("drawer.accruedCommission")}</span>
              <span className="font-bold text-emerald-700">
                {formatMoney(
                  moneyFromMinor(
                    commissionAccruals.reduce((sum, a) => sum + a.commissionAmount.amountMinor, 0)
                  ),
                  locale
                )}{" "}
                ({commissionAccruals.length} {isAr ? "سجل" : "records"})
              </span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>{t("drawer.passPin")}</span>
              <span className="font-mono text-slate-800">
                {currentReservation
                  ? `${currentReservation.passCode} / ${currentReservation.completionPinDetails?.isIssued ? currentReservation.completionPinDetails.pin : isAr ? "غير صادر" : "UNISSUED"}`
                  : "N/A"}
              </span>
            </div>
          </div>

          {/* Reset Button */}
          <button
            onClick={() => {
              resetDemoState();
              onClose();
            }}
            className="w-full flex items-center justify-center gap-2 p-3 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700 font-semibold text-xs transition-colors min-h-[44px]"
            aria-label={t("resetDemo")}
          >
            <RotateCcw className="w-4 h-4" />
            <span>{t("resetDemo")}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
