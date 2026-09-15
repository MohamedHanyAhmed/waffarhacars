"use client";

import React from "react";
import { useDemoState } from "../../context/DemoStateContext";
import { useI18n } from "../../context/I18nContext";
import { formatMoney, calculateDiscount, calculateCommission } from "../../domain/money";
import { FileSpreadsheet, ShieldCheck, TrendingUp } from "lucide-react";

export function CommissionLedgerTable() {
  const { commissionAccruals, offerDrafts, approveSalesDraft, providerStatement } = useDemoState();
  const { t, locale } = useI18n();
  const isAr = locale === "ar";

  const pendingDrafts = offerDrafts.filter((d) => d.status === "pending_ops_approval");

  return (
    <div className="space-y-6 text-start">
      {/* 1. Operations Maker-Checker Draft Approval Queue */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-extrabold text-base text-slate-900 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-teal-600" />
              <span>{t("ops.draftsTitle")}</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {isAr
                ? "مراجعة واعتماد عروض المبيعات بعد التحقق من إثبات الأسعار والمطابقة الفنية."
                : "Operations maker-checker review: Verify price evidence before approving publication."}
            </p>
          </div>
          <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700">
            {pendingDrafts.length} {isAr ? "مسودات معلقة" : "Pending Drafts"}
          </span>
        </div>

        {pendingDrafts.length === 0 ? (
          <div className="p-6 rounded-xl border border-dashed border-slate-200 bg-slate-50 text-center text-xs text-slate-500">
            {isAr
              ? "لا توجد مسودات مبيعات بانتظار الاعتماد حالياً. يمكنك استخدام معالج المبيعات لتقديم مسودة جديدة."
              : "No pending sales drafts awaiting approval. Use the Sales Wizard to create a new draft."}
          </div>
        ) : (
          <div className="space-y-3">
            {pendingDrafts.map((draft) => (
              <div
                key={draft.id}
                className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs"
              >
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-slate-900 text-sm">
                      {isAr ? draft.titleAr : draft.titleEn}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900">
                      {draft.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-slate-600 flex-wrap">
                    {(() => {
                      const { lockedPrice } = calculateDiscount(
                        draft.normalPrice,
                        draft.discountBps
                      );
                      const { commissionAmount } = calculateCommission(
                        lockedPrice,
                        draft.commissionBps
                      );
                      return (
                        <>
                          <span>
                            {isAr ? "السعر الأساسي:" : "Normal:"}{" "}
                            <b>{formatMoney(draft.normalPrice, locale)}</b>
                          </span>
                          <span>
                            {isAr ? "السعر المثبت:" : "Locked:"}{" "}
                            <b>{formatMoney(lockedPrice, locale)}</b>
                          </span>
                          <span>
                            {isAr ? "العمولة المستحقة:" : "Commission:"}{" "}
                            <b className="text-emerald-700">
                              {formatMoney(commissionAmount, locale)} (10%)
                            </b>
                          </span>
                        </>
                      );
                    })()}
                  </div>
                  {draft.priceEvidence && (
                    <p className="text-[11px] text-teal-700 mt-1 flex items-center gap-1 font-medium">
                      <span>
                        ✓{" "}
                        {isAr
                          ? "إثبات السعر مرفق للمراجعة:"
                          : "Price evidence attached for review:"}
                      </span>
                      <span className="underline">{draft.priceEvidence.fileName}</span>
                    </p>
                  )}
                </div>

                <button
                  onClick={() => approveSalesDraft(draft.id)}
                  data-testid="approve-draft-button"
                  className="px-4 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-bold text-xs shadow-xs transition-colors shrink-0"
                >
                  {t("ops.approveButton")}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 2. Derived Provider Financial Statement Summary */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-extrabold text-base text-slate-900 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-emerald-600" />
              <span>{t("ops.statementTitle")}</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {isAr
                ? "كشف حساب مالي مستنتج محلياً للعرض التجريبي لمركز أوربيت أوتو كير."
                : "Reactively derived local demo statement and receivables position for Orbit Auto Care."}
            </p>
          </div>
          <span
            className={
              "text-xs font-bold px-3 py-1 rounded-full border " +
              (providerStatement.isExposureHealthy
                ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                : "bg-rose-50 text-rose-800 border-rose-200")
            }
          >
            {providerStatement.isExposureHealthy ? t("ops.healthyExposure") : t("ops.limitWarning")}
          </span>
        </div>

        {/* Financial KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/70">
            <span className="text-[11px] font-semibold text-slate-500 block mb-1">
              {t("ops.kpiCompleted")}
            </span>
            <span className="text-xl font-extrabold text-slate-900 block">
              {providerStatement.completedReservationsCount}
            </span>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/70">
            <span className="text-[11px] font-semibold text-slate-500 block mb-1">
              {t("ops.kpiTotalService")}
            </span>
            <span className="text-xl font-extrabold text-slate-900 block">
              {formatMoney(providerStatement.totalServiceVolume, locale)}
            </span>
          </div>

          <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200">
            <span className="text-[11px] font-semibold text-emerald-700 block mb-1">
              {t("ops.kpiCommissionAccrued")}
            </span>
            <span
              data-testid="ops-kpi-accrued-commission"
              className="text-xl font-extrabold text-emerald-800 block"
            >
              {formatMoney(providerStatement.totalCommissionAccrued, locale)}
            </span>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/70">
            <span className="text-[11px] font-semibold text-slate-500 block mb-1">
              {t("ops.kpiCreditLimit")}
            </span>
            <span className="text-xl font-extrabold text-slate-900 block">
              {formatMoney(providerStatement.creditLimit, locale)}
            </span>
          </div>
        </div>
      </div>

      {/* 3. Authoritative Commission Ledger Table */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
        <div>
          <h3 className="font-extrabold text-base text-slate-900 flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-brand-600" />
            <span>{t("ops.ledgerTitle")}</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {isAr
              ? "سجل استحقاقات العمولات الناتجة حصراً عن تأكيد الخدمة المتبادل بواسطة رمز PIN."
              : "Authoritative ledger of commission receivables generated strictly upon PIN completion."}
          </p>
        </div>

        {/* Commission Accrual Ledger Table */}
        <div className="overflow-x-auto pt-2">
          <table className="w-full text-xs text-start">
            <thead>
              <tr className="border-b border-slate-200 text-slate-400 font-semibold uppercase text-[10px]">
                <th className="pb-2 text-start">{t("ops.tableReservation")}</th>
                <th className="pb-2 text-start">{t("ops.tablePass")}</th>
                <th className="pb-2 text-start">{t("ops.tableService")}</th>
                <th className="pb-2 text-end">{t("ops.tablePrice")}</th>
                <th className="pb-2 text-end">{t("ops.tableCommission")}</th>
                <th className="pb-2 text-center">{t("ops.tableStatus")}</th>
                <th className="pb-2 text-end">{t("ops.tableDate")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100" data-testid="ops-commission-tbody">
              {commissionAccruals.length === 0 ? (
                <tr data-testid="ops-empty-ledger-row">
                  <td colSpan={7} className="py-6 text-center text-slate-400 text-xs italic">
                    {isAr
                      ? "لا توجد عمولات مسجلة بعد. أكمل الحجز في واجهة المركز بإدخال رمز PIN لإضافة استحقاق العمولة."
                      : "No commission accruals recorded yet. Complete the service in provider terminal using customer PIN."}
                  </td>
                </tr>
              ) : (
                commissionAccruals.map((item) => (
                  <tr
                    key={item.id}
                    data-testid="ops-commission-row"
                    className="hover:bg-slate-50/80 transition-colors"
                  >
                    <td className="py-3 font-mono text-slate-900 font-medium">
                      {item.reservationId}
                    </td>
                    <td className="py-3 font-mono font-bold text-slate-800">{item.passCode}</td>
                    <td className="py-3 text-slate-700 max-w-xs truncate">
                      {isAr ? item.serviceTitleAr : item.serviceTitleEn}
                    </td>
                    <td className="py-3 text-end font-semibold text-slate-900">
                      {formatMoney(item.lockedPrice, locale)}
                    </td>
                    <td className="py-3 text-end font-extrabold text-emerald-700">
                      {formatMoney(item.commissionAmount, locale)}
                    </td>
                    <td className="py-3 text-center">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                        {item.status}
                      </span>
                    </td>
                    <td className="py-3 text-end text-slate-500 text-[11px]">{item.accruedAt}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
