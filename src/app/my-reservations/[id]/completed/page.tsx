"use client";

import React, { use, useState } from "react";
import Link from "next/link";
import { useDemoState } from "../../../../context/DemoStateContext";
import { useI18n } from "../../../../context/I18nContext";
import { StatusBadge } from "../../../../components/common/StatusBadge";
import { VerifiedReviewModal } from "../../../../components/customer/VerifiedReviewModal";
import { formatMoney } from "../../../../domain/money";
import {
  CheckCircle2,
  Receipt,
  HelpCircle,
  Clock,
  AlertTriangle,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
} from "lucide-react";

interface CompletedPageProps {
  params: Promise<{ id: string }>;
}

export default function CompletedPage({ params }: CompletedPageProps) {
  const resolvedParams = use(params);
  const { currentReservation } = useDemoState();
  const { t, locale } = useI18n();
  const isAr = locale === "ar";
  const BackArrow = isAr ? ArrowLeft : ArrowRight;
  const [supportTicketSubmitted, setSupportTicketSubmitted] = useState(false);

  // Route Guard: Require active reservation, ID match, and status === 'completed'
  const isMismatch = !currentReservation || currentReservation.id !== resolvedParams.id;
  const isNotCompleted = currentReservation && currentReservation.status !== "completed";

  if (isMismatch || isNotCompleted) {
    return (
      <div
        data-testid="completed-page-guard"
        className="max-w-md mx-auto my-12 p-8 bg-white rounded-3xl border border-amber-200 shadow-xs text-center space-y-4"
      >
        <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mx-auto">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <h2 className="font-extrabold text-base text-slate-900">
          {isAr ? "الحجز غير مكتمل بعد" : "Service Not Completed Yet"}
        </h2>
        <p className="text-xs text-slate-600 leading-relaxed">
          {isAr
            ? "صفحة إتمام الخدمة والتقييم متاحة فقط بعد تسجيل الحضور لدى المركز وإدخال رمز التأكيد (PIN) من بطاقة الخصم بنجاح."
            : "The completion and review receipt is accessible only after provider check-in and mutual confirmation with your 4-digit PIN."}
        </p>
        <div className="pt-2">
          <Link
            href="/my-reservations"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs shadow-xs"
          >
            <span>{isAr ? "العودة إلى بطاقة الخصم" : "Return to Discount Pass"}</span>
            <BackArrow className="w-4 h-4" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 text-start">
      {/* Page Header */}
      <div className="border-b border-slate-200 pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h1 className="text-xl font-extrabold text-slate-900 flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            <span>{t("completed.title")}</span>
          </h1>
          <StatusBadge status={currentReservation.status} />
        </div>
        <p className="text-xs text-slate-500 mt-1">{t("completed.subtitle")}</p>
      </div>

      {/* Completion Summary Card */}
      <div className="bg-white rounded-3xl border border-slate-200 p-6 space-y-4 shadow-xs text-xs">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 flex-wrap gap-2">
          <div>
            <span className="text-slate-400 block mb-0.5">
              {isAr ? "الخدمة المنفذة" : "Completed Service"}
            </span>
            <span className="font-bold text-slate-900 text-sm block">
              {isAr
                ? currentReservation.offerSnapshot.titleAr
                : currentReservation.offerSnapshot.titleEn}
            </span>
          </div>
          <span className="font-mono text-xs bg-slate-100 px-2.5 py-1 rounded-lg text-slate-700">
            {currentReservation.passCode}
          </span>
        </div>

        {/* Center & Price Details */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/70">
            <span className="text-slate-400 block mb-0.5">
              {isAr ? "الفرع المنفذ" : "Fulfilling Branch"}
            </span>
            <span className="font-bold text-slate-900">
              {isAr ? "أوربت أوتو كير — مصر الجديدة" : "Orbit Auto Care — Heliopolis"}
            </span>
          </div>

          <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200">
            <span className="text-emerald-700 block mb-0.5">
              {isAr ? "المبلغ المسدد للمركز" : "Locked Price Paid to Center"}
            </span>
            <span className="font-extrabold text-base text-emerald-900">
              {formatMoney(currentReservation.pricingSnapshot.lockedPrice, locale)}
            </span>
          </div>
        </div>

        {/* Timestamp */}
        <div className="flex items-center gap-2 text-slate-500 pt-1">
          <Clock className="w-4 h-4 text-slate-400" />
          <span>
            {t("completed.timestamp", {
              time: currentReservation.completionTimestamp
                ? currentReservation.completionTimestamp.replace("T", " ").substring(0, 16)
                : "2026-09-13 12:00",
            })}
          </span>
        </div>

        {/* Center Receipt Notice */}
        <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-[11px] text-slate-600 flex items-start gap-2.5">
          <Receipt className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            {isAr
              ? "ملاحظة: الفاتورة الضريبية وإيصال السداد يصدران مباشرة من مركز أوربت أوتو كير؛ حيث تم تحصيل المبلغ لديهم ولم تقم المنصة بتحصيل أي مبالغ مسبقة."
              : "Tax Notice: Your payment receipt is issued directly by Orbit Auto Care workshop as payment was collected directly by them."}
          </p>
        </div>
      </div>

      {/* Verified Customer Review Card */}
      <VerifiedReviewModal reservation={currentReservation} />

      {/* Support / Problem Report */}
      <div className="space-y-3">
        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs flex items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-2 text-slate-700">
            <HelpCircle className="w-4 h-4 text-slate-400 shrink-0" />
            <span>
              {isAr ? "هل واجهتك أي مشكلة في المركز؟" : "Did you face any issues at the center?"}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setSupportTicketSubmitted(true)}
            data-testid="report-issue-button"
            className="text-xs font-bold text-rose-700 hover:text-rose-800 underline shrink-0"
          >
            {t("completed.supportCta")}
          </button>
        </div>

        {supportTicketSubmitted && (
          <div
            role="status"
            aria-live="polite"
            data-testid="support-ticket-banner"
            className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-2 shadow-xs"
          >
            <div className="flex items-center justify-between font-bold">
              <span className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>
                  {isAr
                    ? "تم فتح تذكرة دعم للعمليات (محاكاة تجريبية رقم WC-SUPP-9021)"
                    : "Support Ticket Opened (Simulated Local Action #WC-SUPP-9021)"}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setSupportTicketSubmitted(false)}
                className="text-amber-700 hover:text-amber-900 text-xs px-2 py-1 rounded-md hover:bg-amber-100 font-semibold"
                aria-label={isAr ? "إغلاق التنبيه" : "Dismiss notice"}
              >
                ✕
              </button>
            </div>
            <p className="text-amber-800 leading-relaxed text-[11px]">
              {isAr
                ? "توضيح: هذه محاكاة تجريبية لواجهة الدعم. في المنظومة التشغيلية الحية، يتم إرسال هذا الإخطار فوراً لفريق العمليات للتحقق من التزام المركز بالسعر والنطاق المسجل."
                : "Demo note: Support escalation is simulated in this local demo. In production, this immediately alerts Operations to audit partner workshop compliance against the recorded price and scope."}
            </p>
          </div>
        )}
      </div>

      {/* Back to Home Link */}
      <div className="text-center pt-2">
        <Link href="/" className="text-xs font-semibold text-brand-600 hover:underline">
          {isAr ? "← العودة إلى الصفحة الرئيسية" : "← Return to Home"}
        </Link>
      </div>
    </div>
  );
}
