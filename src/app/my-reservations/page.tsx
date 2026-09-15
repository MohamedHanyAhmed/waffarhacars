"use client";

import React from "react";
import Link from "next/link";
import { useDemoState } from "../../context/DemoStateContext";
import { useI18n } from "../../context/I18nContext";
import { StatusBadge } from "../../components/common/StatusBadge";
import { PassQRCard } from "../../components/customer/PassQRCard";
import { formatMoney } from "../../domain/money";
import { MapPin, Car, Clock, XCircle, ExternalLink, ShieldCheck } from "lucide-react";

export default function MyReservationsPage() {
  const { currentReservation, cancelReservation } = useDemoState();
  const { t, locale } = useI18n();
  const isAr = locale === "ar";

  if (!currentReservation) {
    return (
      <div className="max-w-md mx-auto my-12 p-8 bg-white rounded-2xl border border-slate-200 shadow-xs text-center space-y-4">
        <h2 className="font-extrabold text-base text-slate-900">
          {isAr ? "لا توجد حجوزات نشطة" : "No Active Reservations"}
        </h2>
        <p className="text-xs text-slate-500">
          {isAr
            ? "لم تقم بحجز أي خدمة صيانة بعد. استعرض عروض مراكز الصيانة المشاركة واحجز مجاناً."
            : "You have not reserved any maintenance service yet. Browse verified offers and reserve for free."}
        </p>
        <Link
          href="/results"
          className="inline-block px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs"
        >
          {isAr ? "تصفح العروض المتاحة" : "Browse Verified Offers"}
        </Link>
      </div>
    );
  }

  const isCompleted = currentReservation.status === "completed";
  const isCancelled = currentReservation.status === "customer_cancelled";

  return (
    <div className="max-w-3xl mx-auto space-y-6 text-start">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900">{t("pass.title")}</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {isAr
              ? "حجزك مؤكد بدون دفع مسبق. بطاقة الخصم جاهزة للاستخدام."
              : "Your reservation is confirmed. Show your pass when arriving at the center."}
          </p>
        </div>

        <StatusBadge status={currentReservation.status} />
      </div>

      {/* Completed Alert Banner if finished */}
      {isCompleted && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-300 text-emerald-900 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-xs font-semibold">
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
            <span>
              {isAr
                ? "تم إتمام الخدمة بالمركز بنجاح وتوثيقها!"
                : "Service completed and mutually verified with provider!"}
            </span>
          </div>
          <Link
            href={`/my-reservations/${currentReservation.id}/completed`}
            className="px-3.5 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs shadow-xs"
          >
            {isAr ? "عرض ملخص الإتمام والتقييم" : "View Completion & Review"}
          </Link>
        </div>
      )}

      {/* Cancelled Alert Banner if cancelled */}
      {isCancelled && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-300 text-rose-900 text-xs flex items-center gap-2">
          <XCircle className="w-5 h-5 text-rose-600 shrink-0" />
          <span>
            {isAr
              ? "تم إلغاء هذا الحجز مسبقاً. تم تحرير الموعد بالمركز."
              : "This reservation has been cancelled. The workshop slot was released."}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Pass QR and Fallback Code */}
        <div>
          <PassQRCard reservation={currentReservation} />
        </div>

        {/* Detailed Reservation Facts & Center Payment */}
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4 shadow-xs text-xs">
            <h3 className="font-bold text-sm text-slate-900 border-b border-slate-100 pb-2">
              {isAr ? "تفاصيل الحجز المؤكد" : "Confirmed Booking Summary"}
            </h3>

            {/* Service Title */}
            <div>
              <span className="text-slate-400 block mb-0.5">
                {isAr ? "الخدمة المحجوزة" : "Reserved Service"}
              </span>
              <span className="font-bold text-slate-900 text-sm block">
                {isAr
                  ? currentReservation.offerSnapshot.titleAr
                  : currentReservation.offerSnapshot.titleEn}
              </span>
            </div>

            {/* Vehicle */}
            <div className="flex items-center gap-2.5 text-slate-700">
              <Car className="w-4 h-4 text-brand-600 shrink-0" />
              <span>
                {currentReservation.vehicle.year} {currentReservation.vehicle.make}{" "}
                {currentReservation.vehicle.model}
              </span>
            </div>

            {/* Center / Branch */}
            <div className="flex items-start gap-2.5 text-slate-700">
              <MapPin className="w-4 h-4 text-brand-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold block text-slate-900">
                  {isAr ? "أوربت أوتو كير — فرع مصر الجديدة" : "Orbit Auto Care — Heliopolis"}
                </span>
                <span className="text-slate-500 text-[11px]">
                  {isAr
                    ? "١٤ شارع بيروت، مصر الجديدة (٣.٨ كم)"
                    : "14 Beirut St, Heliopolis (3.8 km)"}
                </span>
              </div>
            </div>

            {/* Appointment Time */}
            <div className="flex items-center gap-2.5 text-slate-700">
              <Clock className="w-4 h-4 text-brand-600 shrink-0" />
              <span className="font-medium text-slate-900">
                {isAr ? "اليوم، ٣:٣٠ مساءً" : "Today, 3:30 PM"}
              </span>
            </div>

            {/* Price due at center */}
            <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 flex items-center justify-between">
              <div>
                <span className="font-bold text-emerald-950 block">
                  {isAr ? "المبلغ المطلوب في المركز:" : "Amount to pay at center:"}
                </span>
                <span className="text-[11px] text-emerald-700">
                  {isAr
                    ? "سعر مثبت بالخصم (وفرت ٢٤٠ ج.م)"
                    : "Locked discounted price (Save EGP 240)"}
                </span>
              </div>
              <span className="font-extrabold text-base text-emerald-800">
                {formatMoney(currentReservation.pricingSnapshot.lockedPrice, locale)}
              </span>
            </div>

            {/* Scope / Inclusions & Exclusions */}
            <div className="pt-2 border-t border-slate-100 space-y-2">
              <span className="font-bold text-slate-800 block text-xs">
                {isAr ? "نطاق الخدمة المسجل والمستثنيات:" : "Recorded Service Scope & Exclusions:"}
              </span>
              <ul className="space-y-1 text-[11px] text-slate-600">
                {(isAr
                  ? currentReservation.offerSnapshot.inclusionsAr
                  : currentReservation.offerSnapshot.inclusionsEn
                ).map((inc, idx) => (
                  <li key={idx} className="flex items-start gap-1.5">
                    <span className="text-emerald-600 font-bold">✓</span>
                    <span>{inc}</span>
                  </li>
                ))}
              </ul>
              <ul className="space-y-1 text-[11px] text-slate-500 pt-1 border-t border-slate-100/60">
                {(isAr
                  ? currentReservation.offerSnapshot.exclusionsAr
                  : currentReservation.offerSnapshot.exclusionsEn
                ).map((exc, idx) => (
                  <li key={idx} className="flex items-start gap-1.5">
                    <span className="text-rose-500 font-bold">✕</span>
                    <span>{exc}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2 shadow-xs text-xs">
            <span className="font-bold text-slate-900 block mb-1">{t("pass.actionsTitle")}</span>

            {/* Provider Terminal Switcher */}
            <Link
              href="/provider/check-in"
              className="w-full py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs shadow-xs transition-colors flex items-center justify-center gap-2"
            >
              <ExternalLink className="w-4 h-4" />
              <span>{t("pass.testInProvider")}</span>
            </Link>

            {/* Cancel Button */}
            {!isCompleted && !isCancelled && (
              <button
                onClick={cancelReservation}
                className="w-full py-2 px-3 rounded-xl border border-slate-200 hover:bg-slate-50 text-rose-700 font-semibold text-xs transition-colors"
              >
                {t("pass.cancel")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
