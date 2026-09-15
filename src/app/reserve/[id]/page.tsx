"use client";

import React, { use, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useDemoState } from "../../../context/DemoStateContext";
import { useI18n } from "../../../context/I18nContext";
import { checkCompatibility } from "../../../domain/stateTransitions";
import { formatMoney } from "../../../domain/money";
import { AlertTriangle, Car, MapPin, Clock, Lock } from "lucide-react";

interface ReservePageProps {
  params: Promise<{ id: string }>;
}

export default function ReservePage({ params }: ReservePageProps) {
  const resolvedParams = use(params);
  const router = useRouter();
  const { publishedOffers, selectedVehicle, createNewReservation } = useDemoState();
  const { t, locale } = useI18n();
  const isAr = locale === "ar";

  const [acceptedTerms, setAcceptedTerms] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const offer = publishedOffers.find((o) => o.id === resolvedParams.id);
  if (!offer) {
    return (
      <div className="p-8 text-center text-slate-500">
        <p>{isAr ? "العرض غير موجود" : "Offer not found"}</p>
        <Link href="/results" className="text-brand-600 underline font-semibold text-xs mt-2 block">
          {isAr ? "العودة للنتائج" : "Back to results"}
        </Link>
      </div>
    );
  }

  const compatibility = checkCompatibility(selectedVehicle, offer);
  if (!compatibility.compatible) {
    return (
      <div className="max-w-xl mx-auto p-6 bg-white rounded-3xl border border-rose-200 shadow-sm text-start space-y-4">
        <div className="flex items-center gap-2 text-rose-700 font-bold">
          <AlertTriangle className="w-5 h-5" />
          <span>
            {isAr
              ? "لا يمكن حجز هذا العرض لعدم التوافق"
              : "Reservation Blocked: Incompatible Vehicle"}
          </span>
        </div>
        <p className="text-xs text-slate-600 leading-relaxed">
          {isAr ? compatibility.reasonAr : compatibility.reasonEn}
        </p>
        <Link
          href="/results"
          className="inline-block px-4 py-2 rounded-xl bg-brand-600 text-white font-bold text-xs"
        >
          {isAr ? "عرض الخدمات المتوافقة" : "Browse Compatible Services"}
        </Link>
      </div>
    );
  }

  const handleConfirmReservation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!acceptedTerms) return;

    setIsSubmitting(true);
    try {
      await createNewReservation(offer);
      router.push("/my-reservations");
    } catch (err) {
      console.error("Failed to create reservation:", err);
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 text-start">
      {/* Page Header */}
      <div className="border-b border-slate-200 pb-3">
        <h1 className="text-xl font-extrabold text-slate-900">{t("reserve.title")}</h1>
        <p className="text-xs text-slate-500 mt-1">{t("reserve.subtitle")}</p>
      </div>

      <form onSubmit={handleConfirmReservation} className="space-y-6">
        {/* Reservation Summary Card */}
        <div className="bg-white rounded-3xl border border-slate-200 p-6 space-y-4 shadow-xs">
          <h2 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-3">
            {t("reserve.summaryTitle")}
          </h2>

          <div className="space-y-3 text-xs">
            {/* Service & Title */}
            <div>
              <span className="text-slate-400 block mb-0.5">{isAr ? "الخدمة" : "Service"}</span>
              <span className="font-bold text-slate-900 text-sm block">
                {isAr ? offer.titleAr : offer.titleEn}
              </span>
            </div>

            {/* Vehicle */}
            <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200/70">
              <Car className="w-5 h-5 text-brand-600 shrink-0" />
              <div>
                <span className="text-slate-500 block text-[11px]">
                  {t("reserve.vehicleTitle")}
                </span>
                <span className="font-bold text-slate-900">
                  {selectedVehicle.year} {selectedVehicle.make} {selectedVehicle.model}{" "}
                  <span className="font-normal text-slate-500">({selectedVehicle.engineTrim})</span>
                </span>
              </div>
            </div>

            {/* Branch */}
            <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200/70">
              <MapPin className="w-5 h-5 text-brand-600 shrink-0" />
              <div>
                <span className="text-slate-500 block text-[11px]">{t("reserve.branchTitle")}</span>
                <span className="font-bold text-slate-900">
                  {isAr
                    ? "أوربت أوتو كير — فرع مصر الجديدة"
                    : "Orbit Auto Care — Heliopolis Branch"}
                </span>
                <span className="text-slate-500 text-[11px] block">
                  {isAr
                    ? "١٤ شارع بيروت، مصر الجديدة، القاهرة"
                    : "14 Beirut Street, Heliopolis, Cairo"}
                </span>
              </div>
            </div>

            {/* Appointment Slot */}
            <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200/70">
              <Clock className="w-5 h-5 text-brand-600 shrink-0" />
              <div>
                <span className="text-slate-500 block text-[11px]">
                  {t("reserve.appointmentTitle")}
                </span>
                <span className="font-bold text-slate-900">
                  {isAr ? "اليوم، ٣:٣٠ مساءً" : "Today, 3:30 PM"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Clear Financial Responsibility Box */}
        <div className="bg-white rounded-3xl border border-slate-200 p-6 space-y-4 shadow-xs">
          <h2 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-3">
            {isAr ? "تفاصيل الدفع والمستحقات" : "Payment & Charges Breakdown"}
          </h2>

          <div className="space-y-3 text-xs">
            {/* Due Now */}
            <div className="flex items-center justify-between p-3.5 bg-brand-50/50 rounded-xl border border-brand-200">
              <div>
                <span className="font-bold text-slate-900 block">{t("reserve.dueNowTitle")}</span>
                <span className="text-slate-500 text-[11px]">
                  {isAr
                    ? "حجز مجاني تماماً وبدون أي رسوم دفع إلكتروني"
                    : "Zero online charge. Completely free to reserve"}
                </span>
              </div>
              <span className="font-extrabold text-base text-brand-700">
                {t("reserve.dueNowAmount")}
              </span>
            </div>

            {/* Pay Center */}
            <div className="flex items-center justify-between p-3.5 bg-emerald-50 rounded-xl border border-emerald-200">
              <div>
                <span className="font-bold text-emerald-950 block">
                  {t("reserve.payCenterTitle")}
                </span>
                <span className="text-emerald-700 text-[11px]">
                  {isAr
                    ? "يُسدد مباشرة في المركز نقداً أو بالبطاقة بعد تنفيذ الخدمة"
                    : "Paid directly to workshop staff after service completion"}
                </span>
              </div>
              <span className="font-extrabold text-lg text-emerald-800">
                {formatMoney(offer.lockedPrice, locale)}
              </span>
            </div>
          </div>

          <p className="text-[11px] text-slate-500 leading-relaxed pt-1">
            {t("reserve.termsNotice")}
          </p>
        </div>

        {/* Terms Checkbox */}
        <label className="flex items-start gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-200 text-xs text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={acceptedTerms}
            onChange={(e) => setAcceptedTerms(e.target.checked)}
            className="mt-0.5 rounded text-brand-600 focus:ring-brand-500 w-4 h-4 shrink-0"
          />
          <span className="leading-relaxed">
            {isAr
              ? "أوافق على شروط حجز المركز: تم تسجيل السعر والنطاق المحدد عند تأكيد الحجز؛ أي أعمال إضافية تتطلب مقايسة منفصلة وموافقة العميل."
              : "I accept the center booking terms: Price and listed scope were recorded when the reservation was confirmed; separately requested work requires a separate quote and customer approval."}
          </span>
        </label>

        {/* Confirm Action CTA */}
        <button
          type="submit"
          disabled={!acceptedTerms || isSubmitting}
          className={`w-full py-4 px-6 rounded-2xl font-extrabold text-sm text-white shadow-md transition-all flex items-center justify-center gap-2 ${
            acceptedTerms && !isSubmitting
              ? "bg-brand-600 hover:bg-brand-700"
              : "bg-slate-300 cursor-not-allowed"
          }`}
        >
          <Lock className="w-4 h-4" />
          <span>{isSubmitting ? t("reserve.processing") : t("reserve.confirmCta")}</span>
        </button>
      </form>
    </div>
  );
}
