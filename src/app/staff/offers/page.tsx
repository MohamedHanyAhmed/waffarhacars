"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "@/context/I18nContext";
import {
  minorToEgp,
  offerStatusKey,
  type OfferRevisionDto,
  type OfferStatus,
} from "@/lib/offer/client";
import { offerApi, offerFailureMessage } from "@/lib/offer/client-api";
import type { StaffAuthStatusResponse } from "@/lib/staff/status-contract";

const statuses: Array<OfferStatus | "ALL"> = [
  "ALL",
  "DRAFT",
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
];

export default function StaffOffersPage() {
  const { t, locale, dir } = useI18n();
  const router = useRouter();
  const [rows, setRows] = useState<OfferRevisionDto[]>([]);
  const [status, setStatus] = useState<OfferStatus | "ALL">("ALL");
  const [staff, setStaff] = useState<StaffAuthStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function executeLoad() {
      setLoading(true);
      setError(null);
      try {
        const [auth, offers] = await Promise.all([
          offerApi<StaffAuthStatusResponse>("/api/v1/staff/auth/status", {
            signal: controller.signal,
          }),
          offerApi<OfferRevisionDto[]>(
            `/api/v1/staff/offers${status === "ALL" ? "" : `?status=${status}`}`,
            { signal: controller.signal }
          ),
        ]);
        if (controller.signal.aborted) return;
        if ((!auth.ok && auth.status === 401) || (!offers.ok && offers.status === 401))
          return router.replace("/staff/login");
        if (!auth.ok || !offers.ok) {
          setRows([]);
          setStaff(null);
          setError(!offers.ok ? offerFailureMessage(offers, t) : t("staffOffers.denied"));
        } else {
          setStaff(auth.data);
          setRows(offers.data);
        }
      } catch {
        if (!controller.signal.aborted) setError(t("staffOffers.genericError"));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void executeLoad();
    return () => controller.abort();
  }, [status, reload, router, t]);

  const canCreate = staff?.state === "ACTIVE" && staff.department === "SALES";
  return (
    <main className="mx-auto max-w-6xl space-y-6" dir={dir}>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t("staffOffers.offers")}</h1>
          <p className="mt-1 text-sm text-slate-600">{t("staffOffers.offersIntro")}</p>
        </div>
        {canCreate && (
          <Link
            href="/staff/offers/new"
            className="rounded-xl bg-brand-600 px-4 py-3 text-sm font-bold text-white focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {t("staffOffers.newOffer")}
          </Link>
        )}
      </header>
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border bg-white p-4">
        <div>
          <label htmlFor="offers-status" className="block text-sm font-semibold">
            {t("staffOffers.offers")}
          </label>
          <select
            id="offers-status"
            value={status}
            onChange={(event) => setStatus(event.target.value as OfferStatus | "ALL")}
            className="mt-1 rounded-xl border p-2.5"
          >
            {statuses.map((item) => (
              <option value={item} key={item}>
                {item === "ALL" ? t("onboarding.status.all") : t(offerStatusKey(item))}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => setReload((value) => value + 1)}
          className="rounded-xl border px-4 py-2.5 text-sm font-semibold"
        >
          {t("staffOffers.refresh")}
        </button>
      </div>
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
            <div className="flex justify-between gap-2">
              <h2 className="font-bold">{locale === "ar" ? revision.titleAr : revision.titleEn}</h2>
              <span className="text-xs font-bold text-slate-600">
                {t(offerStatusKey(revision.status))}
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-600">
              {locale === "ar"
                ? revision.offer?.providerOrganization?.nameAr
                : revision.offer?.providerOrganization?.nameEn}{" "}
              — {locale === "ar" ? revision.offer?.branch?.nameAr : revision.offer?.branch?.nameEn}
            </p>
            <p className="mt-1 text-sm">
              <bdi dir="ltr">EGP {minorToEgp(revision.customerPriceMinor)}</bdi> · v
              {revision.version}
            </p>
            <Link
              href={`/staff/offers/${revision.offerId}`}
              className="mt-4 inline-block rounded-lg border px-4 py-2 text-sm font-semibold text-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              {t("staffOffers.offerDetails")}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
