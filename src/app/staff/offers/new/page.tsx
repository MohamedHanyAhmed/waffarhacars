"use client";

import Link from "next/link";
import { useI18n } from "@/context/I18nContext";
import { OfferForm } from "@/components/staff/OfferForm";

export default function NewStaffOfferPage() {
  const { t, dir } = useI18n();
  return (
    <main className="mx-auto max-w-5xl space-y-6" dir={dir}>
      <header>
        <Link href="/staff/offers" className="text-sm font-semibold text-brand-700 hover:underline">
          {t("staffOffers.back")}
        </Link>
        <h1 className="mt-3 text-2xl font-bold">{t("staffOffers.newOffer")}</h1>
        <p className="mt-1 text-sm text-slate-600">{t("staffOffers.offersIntro")}</p>
      </header>
      <OfferForm />
    </main>
  );
}
