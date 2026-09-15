"use client";

import React, { useState } from "react";
import { useDemoState } from "../../context/DemoStateContext";
import { useI18n } from "../../context/I18nContext";
import { ServiceCategoryId } from "../../domain/types";
import { createMoney } from "../../domain/money";
import { Briefcase, FileCheck, AlertTriangle, Upload, CheckCircle2, Lock } from "lucide-react";

export function OfferDraftWizard() {
  const { submitSalesDraft } = useDemoState();
  const { t, locale } = useI18n();
  const isAr = locale === "ar";

  // Form states
  const [category, setCategory] = useState<ServiceCategoryId>("maintenance");
  const [title, setTitle] = useState("Standard Synthetic Oil Service (4L)");
  const [titleAr, setTitleAr] = useState("خدمة زيت تخليقي أساسية (٤ لتر)");
  const [normalPrice, setNormalPrice] = useState(1000);
  const [discountPercent, setDiscountPercent] = useState(20);
  const [hasEvidence, setHasEvidence] = useState(false);
  const [evidenceFileName, setEvidenceFileName] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const providerName = isAr
    ? "مركز أوربيت لصيانة السيارات - مدينة نصر"
    : "Orbit Auto Care - Nasr City";

  const lockedPrice = Math.round(normalPrice * (1 - discountPercent / 100));
  const commission = Math.round(lockedPrice * 0.1);
  const providerNet = lockedPrice - commission;

  const handleSimulateUpload = () => {
    setHasEvidence(true);
    setEvidenceFileName("orbit_heliopolis_official_price_card_2026.pdf");
    setErrorMsg("");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");

    // ENFORCE INVARIANT: Missing price evidence blocks sales submission
    if (!hasEvidence) {
      setErrorMsg(t("sales.evidenceMissingError"));
      return;
    }

    const normalMoney = createMoney(normalPrice);
    const discountBps = discountPercent * 100;

    submitSalesDraft({
      providerId: "prov-orbit-care",
      branchId: "branch-nasr-city-01",
      serviceCategory: category,
      titleEn: title,
      titleAr: titleAr,
      subtitleEn: "Sales draft submitted for operations compliance audit",
      subtitleAr: "مسودة مبيعات مرسلة لمراجعة قسم العمليات والاعتماد",
      normalPrice: normalMoney,
      discountBps,
      commissionBps: 1000,
      priceEvidence: {
        id: "evid-sales-sample-01",
        fileName: evidenceFileName,
        evidenceType: "official_price_list",
        capturedDate: "2026-09-13T12:00:00Z",
        fileSizeBytes: 1024000,
        description: "Official workshop price evidence attached by sales",
      },
      createdBySalesId: "sales-rep-cairo-01",
    });
    setSuccessMsg(t("sales.submittedSuccess"));
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs text-start space-y-6">
      {/* Header & Segregation notice */}
      <div className="border-b border-slate-100 pb-4">
        <div className="flex items-center gap-2 mb-1">
          <Briefcase className="w-5 h-5 text-purple-600" />
          <h2 className="font-extrabold text-base text-slate-900">{t("sales.title")}</h2>
        </div>
        <p className="text-xs text-slate-500">{t("sales.subtitle")}</p>
        <div className="mt-3 p-3 rounded-xl bg-purple-50 border border-purple-200 text-purple-900 text-xs flex items-center gap-2">
          <Lock className="w-4 h-4 text-purple-600 shrink-0" />
          <p className="font-medium leading-relaxed">{t("sales.salesCannotPublish")}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Step 1: Provider & Service */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              {isAr ? "المركز والفرع" : "Provider & Branch"}
            </label>
            <input
              type="text"
              disabled
              value={providerName}
              className="w-full p-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 font-medium"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              {isAr ? "فئة الخدمة" : "Service Category"}
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as ServiceCategoryId)}
              className="w-full p-2.5 rounded-xl border border-slate-200 bg-white text-slate-800 font-medium focus:ring-2 focus:ring-purple-500"
            >
              <option value="maintenance">
                {isAr ? "صيانة دورية وتغيير زيت" : "Periodic Maintenance & Oil"}
              </option>
              <option value="repairs">{isAr ? "فحص وتشخيص" : "Diagnostics & Inspection"}</option>
              <option value="wash">{isAr ? "غسيل وتلميع" : "Wash & Detailing"}</option>
              <option value="tyres">{isAr ? "إطارات وضبط زوايا" : "Tyres & Alignment"}</option>
            </select>
          </div>
        </div>

        {/* Step 2: Titles */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              {isAr ? "عنوان العرض (إنجليزي)" : "Offer Title (English)"}
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full p-2.5 rounded-xl border border-slate-200 bg-white text-slate-800"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              {isAr ? "عنوان العرض (عربي)" : "Offer Title (Arabic)"}
            </label>
            <input
              type="text"
              value={titleAr}
              onChange={(e) => setTitleAr(e.target.value)}
              className="w-full p-2.5 rounded-xl border border-slate-200 bg-white text-slate-800"
            />
          </div>
        </div>

        {/* Step 3: Prices & Commission Schedule */}
        <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
          <h4 className="font-bold text-xs text-slate-800">
            {isAr ? "حاسبة الأسعار والعمولة التعاقدية" : "Pricing & Commission Calculator"}
          </h4>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <label className="block text-slate-600 mb-1">
                {isAr ? "السعر المعتاد (ج.م)" : "Normal Price (EGP)"}
              </label>
              <input
                type="number"
                value={normalPrice}
                onChange={(e) => setNormalPrice(Number(e.target.value))}
                className="w-full p-2 rounded-lg border border-slate-300 bg-white font-bold text-slate-900"
              />
            </div>
            <div>
              <label className="block text-slate-600 mb-1">
                {isAr ? "نسبة الخصم (٪)" : "Discount (%)"}
              </label>
              <input
                type="number"
                value={discountPercent}
                onChange={(e) => setDiscountPercent(Number(e.target.value))}
                className="w-full p-2 rounded-lg border border-slate-300 bg-white font-bold text-slate-900"
              />
            </div>
            <div>
              <label className="block text-slate-600 mb-1">
                {isAr ? "السعر المثبت للعميل (ج.م)" : "Locked Customer Price"}
              </label>
              <input
                type="text"
                disabled
                value={`EGP ${lockedPrice}`}
                className="w-full p-2 rounded-lg border border-emerald-300 bg-emerald-50 font-extrabold text-emerald-800"
              />
            </div>
          </div>

          <div className="pt-2 border-t border-slate-200 text-xs flex justify-between text-slate-600">
            <span>
              {isAr ? "عمولة المنصة بعد الإتمام (١٠٪):" : "WaffarhaCars Commission (10%):"}{" "}
              <strong className="text-purple-700">EGP {commission}</strong>
            </span>
            <span>
              {isAr ? "صافي حصة المركز قبل مصاريفه:" : "Center Net Amount:"}{" "}
              <strong className="text-slate-900">EGP {providerNet}</strong>
            </span>
          </div>
        </div>

        {/* Step 4: Normal-Price Evidence (MANDATORY INVARIANT) */}
        <div className="p-4 rounded-xl border-2 border-dashed border-slate-300 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-bold text-xs text-slate-900 flex items-center gap-1.5">
              <Upload className="w-4 h-4 text-purple-600" />
              {isAr ? "إثبات السعر المعتاد للمركز (إلزامي)" : "Normal Price Evidence (Mandatory)"}
            </span>
            {hasEvidence && (
              <span className="text-xs font-bold text-emerald-700 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {isAr ? "تم الإرفاق" : "Attached"}
              </span>
            )}
          </div>

          <p className="text-[11px] text-slate-500">{t("sales.evidenceRequiredNotice")}</p>

          {!hasEvidence ? (
            <button
              type="button"
              onClick={handleSimulateUpload}
              className="mt-2 py-2 px-3 rounded-lg border border-purple-300 bg-purple-50 hover:bg-purple-100 text-purple-700 text-xs font-semibold flex items-center gap-1.5"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>
                {isAr
                  ? "محاكاة إرفاق قائمة أسعار المركز المعلنة (PDF)"
                  : "Simulate Attaching Price Card (PDF)"}
              </span>
            </button>
          ) : (
            <div className="p-2 bg-slate-50 rounded-lg border border-slate-200 text-xs text-slate-700 flex items-center justify-between">
              <span className="font-mono text-[11px]">{evidenceFileName}</span>
              <button
                type="button"
                onClick={() => setHasEvidence(false)}
                className="text-[11px] text-rose-600 hover:underline"
              >
                {isAr ? "إزالة لاختبار حجب الإرسال" : "Remove (Test Failure)"}
              </button>
            </div>
          )}
        </div>

        {/* Error & Success Notices */}
        {errorMsg && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Submission CTA */}
        <button
          type="submit"
          className="w-full py-3 px-4 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs shadow-xs transition-colors flex items-center justify-center gap-2"
        >
          <FileCheck className="w-4 h-4" />
          <span>{t("sales.submitForApproval")}</span>
        </button>
      </form>
    </div>
  );
}
