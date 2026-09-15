"use client";

import React, { useState } from "react";
import { Reservation } from "../../domain/types";
import { useDemoState } from "../../context/DemoStateContext";
import { useI18n } from "../../context/I18nContext";
import { Star, CheckCircle2, ShieldCheck } from "lucide-react";

interface VerifiedReviewModalProps {
  reservation: Reservation;
}

export function VerifiedReviewModal({ reservation }: VerifiedReviewModalProps) {
  const { submitReview } = useDemoState();
  const { t, locale } = useI18n();
  const isAr = locale === "ar";

  const [rating, setRating] = useState(5);
  const [scopeHonored, setScopeHonored] = useState(true);
  const [priceHonored, setPriceHonored] = useState(true);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const isCompleted = reservation.status === "completed";
  const existingReview = reservation.verifiedReview;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitReview({
      rating,
      scopeHonored,
      priceHonored,
      comment:
        comment.trim() ||
        (isAr ? "خدمة ممتازة والتزام بالسعر والمواعيد." : "Great service and exact price honored."),
    });
    setSubmitted(true);
  };

  if (!isCompleted) {
    return (
      <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 text-slate-500 text-xs text-center">
        {isAr
          ? "لا يمكن كتابة تقييم موثق إلا بعد إتمام الخدمة وتأكيدها بالرمز في المركز."
          : "Verified reviews are only available after service completion is mutually confirmed with your PIN."}
      </div>
    );
  }

  if (existingReview || submitted) {
    const r = existingReview || { rating, scopeHonored, priceHonored, comment };
    return (
      <div className="p-5 rounded-2xl border border-emerald-200 bg-emerald-50/50 text-start space-y-3">
        <div className="flex items-center gap-2 text-emerald-800">
          <ShieldCheck className="w-5 h-5 text-emerald-600" />
          <h4 className="font-bold text-sm">{t("completed.reviewSubmitted")}</h4>
        </div>
        <div className="flex items-center gap-1 text-amber-500">
          {[1, 2, 3, 4, 5].map((s) => (
            <Star
              key={s}
              className={`w-4 h-4 ${s <= r.rating ? "fill-amber-400 text-amber-400" : "text-slate-300"}`}
            />
          ))}
        </div>
        <p className="text-xs text-slate-700 italic">&ldquo;{r.comment}&rdquo;</p>
        <div className="pt-2 border-t border-emerald-200/60 flex items-center gap-4 text-[11px] text-emerald-700 font-medium">
          <span>✓ {isAr ? "تم الالتزام بالسعر المعلن" : "Locked price honored"}</span>
          <span>✓ {isAr ? "تم تنفيذ البنود المتفق عليها" : "Full scope delivered"}</span>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="p-5 rounded-2xl border border-slate-200 bg-white space-y-4 shadow-xs text-start"
    >
      <div className="flex items-center gap-2 text-slate-900 border-b border-slate-100 pb-3">
        <CheckCircle2 className="w-5 h-5 text-brand-600" />
        <h3 className="font-bold text-base">{t("completed.reviewTitle")}</h3>
      </div>

      {/* Star Rating */}
      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1.5">
          {t("completed.reviewRating")}
        </label>
        <div className="flex items-center gap-1.5">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              type="button"
              key={star}
              onClick={() => setRating(star)}
              className="p-1 rounded hover:bg-slate-50 focus:outline-none"
              aria-label={`Rate ${star} stars`}
            >
              <Star
                className={`w-6 h-6 transition-colors ${
                  star <= rating ? "fill-amber-400 text-amber-400" : "text-slate-300"
                }`}
              />
            </button>
          ))}
        </div>
      </div>

      {/* Audit Checkboxes */}
      <div className="space-y-2 bg-slate-50 p-3 rounded-xl border border-slate-200">
        <span className="text-xs font-bold text-slate-800 block">
          {t("completed.checklistTitle")}
        </span>
        <label className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={scopeHonored}
            onChange={(e) => setScopeHonored(e.target.checked)}
            className="rounded text-brand-600 focus:ring-brand-500 w-4 h-4"
          />
          <span>{t("completed.scopeHonored")}</span>
        </label>
        <label className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={priceHonored}
            onChange={(e) => setPriceHonored(e.target.checked)}
            className="rounded text-brand-600 focus:ring-brand-500 w-4 h-4"
          />
          <span>{t("completed.priceHonored")}</span>
        </label>
      </div>

      {/* Comments */}
      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1.5">
          {t("completed.reviewComment")}
        </label>
        <textarea
          rows={3}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={
            isAr
              ? "اكتب رأيك في التعامل وجودة الزيت وسرعة التنفيذ..."
              : "Write your feedback regarding service speed, cleanliness and parts quality..."
          }
          className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>

      <button
        type="submit"
        className="w-full py-2.5 px-4 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs shadow-xs transition-colors"
      >
        {t("completed.submitReview")}
      </button>
    </form>
  );
}
