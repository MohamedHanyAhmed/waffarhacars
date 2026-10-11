"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "@/context/I18nContext";
import type { OfferRevisionDto } from "@/lib/offer/client";
import { minorToEgp } from "@/lib/offer/client";
import { offerApi, offerFailureMessage } from "@/lib/offer/client-api";

export default function OperationsOfferQueuePage() {
  const { t, locale, dir } = useI18n();
  const router = useRouter();
  const [rows, setRows] = useState<OfferRevisionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function executeLoad() {
      setLoading(true);
      try {
        const result = await offerApi<OfferRevisionDto[]>("/api/v1/staff/ops/offers/pending", {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (!result.ok && result.status === 401) return router.replace("/staff/login");
        if (!result.ok) {
          setRows([]);
          setError(offerFailureMessage(result, t));
        } else {
          setRows(result.data);
          setError(null);
        }
      } catch {
        if (!controller.signal.aborted) setError(t("staffOffers.genericError"));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void executeLoad();
    return () => controller.abort();
  }, [reload, router, t]);

  return (
    <main className="mx-auto max-w-6xl space-y-6" dir={dir}>
      <header>
        <h1 className="text-2xl font-bold">{t("staffOffers.pendingOffers")}</h1>
        <p className="mt-1 text-sm text-slate-600">{t("staffOffers.pendingIntro")}</p>
      </header>
      <button
        type="button"
        onClick={() => setReload((value) => value + 1)}
        className="rounded-xl border bg-white px-4 py-2.5 text-sm font-semibold"
      >
        {t("staffOffers.refresh")}
      </button>
      {loading && <p role="status">{t("staffOffers.loading")}</p>}
      {error && (
        <p role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-rose-900">
          {error}
        </p>
      )}
      {!loading && !error && rows.length === 0 && (
        <p className="rounded-xl border bg-white p-5">{t("staffOffers.empty")}</p>
      )}
      <ul className="grid gap-4 sm:grid-cols-2">
        {rows.map((revision) => (
          <li key={revision.id} className="rounded-2xl border bg-white p-5 shadow-sm">
            <h2 className="font-bold">{locale === "ar" ? revision.titleAr : revision.titleEn}</h2>
            <p className="mt-2 text-sm text-slate-600">
              {locale === "ar"
                ? revision.offer?.providerOrganization?.nameAr
                : revision.offer?.providerOrganization?.nameEn}{" "}
              — {locale === "ar" ? revision.offer?.branch?.nameAr : revision.offer?.branch?.nameEn}
            </p>
            <p className="mt-2 text-sm">
              <bdi dir="ltr">EGP {minorToEgp(revision.customerPriceMinor)}</bdi> · v
              {revision.version}
            </p>
            <Link
              href={`/staff/offers/${revision.offerId}`}
              className="mt-4 inline-block rounded-lg border px-4 py-2 text-sm font-semibold text-brand-700"
            >
              {t("staffOffers.offerDetails")}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
