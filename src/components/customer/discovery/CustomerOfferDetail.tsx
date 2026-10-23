"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/context/I18nContext";
import {
  DiscoveryReadError,
  loadPublicOffer,
  loadPublicCoverage,
  formatPublicDate,
  type PublicOffer,
  type PublicCoverage,
} from "@/lib/customer/discovery-client";
import {
  actionClass,
  panelClass,
  DiscoveryFailure,
  DiscoveryLimitations,
  DiscoveryPrices,
  useFocusRefresh,
} from "./DiscoveryContent";

type DetailState =
  | { key: string; kind: "loaded"; offer: PublicOffer; coverage: PublicCoverage }
  | { key: string; kind: "loading" | "missing" | "changed" | "unavailable" };

export default function CustomerOfferDetail({ offerId }: { offerId: string }) {
  const { locale, t } = useI18n();
  const [refreshIndex, setRefreshIndex] = useState(0);
  const refresh = useCallback(() => setRefreshIndex((value) => value + 1), []);
  useFocusRefresh(refresh);
  const key = `${offerId}:${locale}:${refreshIndex}`;
  const [state, setState] = useState<DetailState>({ key: "", kind: "loading" });
  const generation = useRef(0);
  const [coverageWindow, setCoverageWindow] = useState({ key: "", size: 20 });
  const current: DetailState = state.key === key ? state : { key, kind: "loading" };
  const coverageSize = coverageWindow.key === key ? coverageWindow.size : 20;

  useEffect(() => {
    const ownedGeneration = ++generation.current;
    const controller = new AbortController();
    void Promise.all([
      loadPublicOffer(offerId, controller.signal),
      loadPublicCoverage(offerId, controller.signal),
    ])
      .then(([offer, coverage]) => {
        if (controller.signal.aborted || generation.current !== ownedGeneration) return;
        if (offer.offerId !== coverage.offerId || offer.revisionId !== coverage.revisionId) {
          setState({ key, kind: "changed" });
          return;
        }
        setState({ key, kind: "loaded", offer, coverage });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || generation.current !== ownedGeneration) return;
        setState({
          key,
          kind:
            error instanceof DiscoveryReadError && (error.status === 404 || error.status === 400)
              ? "missing"
              : "unavailable",
        });
        controller.abort();
      });
    return () => controller.abort();
  }, [key, offerId]);

  const ar = locale === "ar";
  return (
    <>
      <Link
        href="/customer/offers"
        data-testid="discovery-back"
        className={`${actionClass} inline-flex items-center`}
      >
        {t("customerDiscovery.back")}
      </Link>
      <DiscoveryLimitations />
      <button
        type="button"
        data-testid="discovery-refresh"
        className={actionClass}
        onClick={refresh}
        disabled={current.kind === "loading"}
      >
        {t("customerDiscovery.refresh")}
      </button>
      {current.kind === "loading" && <p role="status">{t("customerDiscovery.loading")}</p>}
      {current.kind !== "loaded" && current.kind !== "loading" && (
        <DiscoveryFailure kind={current.kind} retry={refresh} />
      )}
      {current.kind === "loaded" && (
        <div data-testid="discovery-detail" className="min-w-0 space-y-6 break-words">
          <section className={`${panelClass} space-y-4`}>
            <p className="text-sm text-slate-600">
              {ar ? current.offer.provider.nameAr : current.offer.provider.nameEn} ·{" "}
              {ar ? current.offer.branch.nameAr : current.offer.branch.nameEn}
            </p>
            <h1 className="text-2xl font-bold">
              {ar ? current.offer.titleAr : current.offer.titleEn}
            </h1>
            <p>{ar ? current.offer.category.nameAr : current.offer.category.nameEn}</p>
            <DiscoveryPrices offer={current.offer} />
          </section>
          <section className={`${panelClass} space-y-4`}>
            <h2 className="text-xl font-bold">{t("customerDiscovery.scope")}</h2>
            <h3 className="font-semibold">
              {ar ? current.offer.service.nameAr : current.offer.service.nameEn}
            </h3>
            <p className="whitespace-pre-wrap">
              {ar ? current.offer.service.scopeAr : current.offer.service.scopeEn}
            </p>
            <dl className="grid gap-4 sm:grid-cols-2">
              {(
                [
                  [
                    "includedLabor",
                    ar ? current.offer.includedLaborAr : current.offer.includedLaborEn,
                  ],
                  [
                    "includedParts",
                    ar ? current.offer.includedPartsAr : current.offer.includedPartsEn,
                  ],
                  [
                    "excludedLabor",
                    ar ? current.offer.excludedLaborAr : current.offer.excludedLaborEn,
                  ],
                  [
                    "excludedParts",
                    ar ? current.offer.excludedPartsAr : current.offer.excludedPartsEn,
                  ],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <dt className="font-semibold">{t(`customerDiscovery.${label}`)}</dt>
                  <dd className="whitespace-pre-wrap">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section className={`${panelClass} space-y-3`}>
            <h2 className="text-xl font-bold">{t("customerDiscovery.validity")}</h2>
            <dl className="space-y-2">
              <div>
                <dt>{t("customerDiscovery.from")}</dt>
                <dd>
                  <time dateTime={current.offer.validFrom}>
                    {formatPublicDate(current.offer.validFrom, locale)}
                  </time>
                </dd>
              </div>
              <div>
                <dt>{t("customerDiscovery.until")}</dt>
                <dd>
                  <time dateTime={current.offer.validUntil}>
                    {formatPublicDate(current.offer.validUntil, locale)}
                  </time>
                </dd>
              </div>
            </dl>
            <p>{t("customerDiscovery.duration", { minutes: current.offer.durationMinutes })}</p>
            <h3 className="font-semibold">{t("customerDiscovery.bookingRule")}</h3>
            <p>{t(`customerDiscovery.${current.offer.bookingRule}`)}</p>
          </section>
          <section className={`${panelClass} space-y-3`}>
            <h2 className="text-xl font-bold">{t("customerDiscovery.branch")}</h2>
            <p className="font-semibold">
              {ar ? current.offer.branch.nameAr : current.offer.branch.nameEn}
            </p>
            <p>{t(`customerDiscovery.${current.offer.branch.cluster}`)}</p>
            <p className="whitespace-pre-wrap">
              {ar ? current.offer.branch.streetAddressAr : current.offer.branch.streetAddressEn}
            </p>
            {(ar ? current.offer.branch.landmarkAr : current.offer.branch.landmarkEn) && (
              <p>{ar ? current.offer.branch.landmarkAr : current.offer.branch.landmarkEn}</p>
            )}
            <h3 className="font-semibold">{t("customerDiscovery.hours")}</h3>
            <p className="text-sm text-slate-600">{t("customerDiscovery.hoursNote")}</p>
            {current.offer.branch.operatingHours.length ? (
              <dl className="space-y-2">
                {current.offer.branch.operatingHours.map((hours) => (
                  <div
                    key={hours.dayOfWeek}
                    className="flex flex-wrap justify-between gap-2 border-b border-slate-100 pb-2"
                  >
                    <dt>{t(`customerDiscovery.day${hours.dayOfWeek}`)}</dt>
                    <dd>
                      {hours.isClosed ? (
                        t("customerDiscovery.closed")
                      ) : (
                        <bdi dir="ltr">
                          {hours.openTime}–{hours.closeTime}
                        </bdi>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p>{t("customerDiscovery.hoursMissing")}</p>
            )}
          </section>
          <section data-testid="discovery-coverage" className={`${panelClass} space-y-3`}>
            <h2 className="text-xl font-bold">{t("customerDiscovery.coverage")}</h2>
            <p className="text-sm text-slate-600">{t("customerDiscovery.coverageNote")}</p>
            <p>
              {t("customerDiscovery.coverageCount", {
                shown: Math.min(coverageSize, current.coverage.coverage.length),
                total: current.coverage.coverage.length,
              })}
            </p>
            <ul className="space-y-2">
              {current.coverage.coverage.slice(0, coverageSize).map((row, index) => (
                <li
                  key={`${row.make.id}:${row.model.id}:${row.yearFrom}:${row.yearTo}:${index}`}
                  className="rounded-lg bg-slate-50 p-3"
                >
                  <span className="font-semibold">
                    {ar ? row.make.nameAr : row.make.nameEn} ·{" "}
                    {ar ? row.model.nameAr : row.model.nameEn}
                  </span>{" "}
                  <bdi dir="ltr">
                    {row.yearFrom}–{row.yearTo}
                  </bdi>
                </li>
              ))}
            </ul>
            {coverageSize < current.coverage.coverage.length && (
              <button
                className={actionClass}
                type="button"
                onClick={() => setCoverageWindow({ key, size: coverageSize + 20 })}
              >
                {t("customerDiscovery.moreCoverage")}
              </button>
            )}
          </section>
        </div>
      )}
    </>
  );
}
