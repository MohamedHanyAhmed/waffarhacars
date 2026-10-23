"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/context/I18nContext";
import {
  DiscoveryReadError,
  loadPublicOffers,
  PUBLIC_CATEGORY_CODES,
  PUBLIC_CAIRO_CLUSTERS,
  type PublicOffer,
} from "@/lib/customer/discovery-client";
import {
  actionClass,
  panelClass,
  DiscoveryFailure,
  DiscoveryLimitations,
  DiscoveryPrices,
  useFocusRefresh,
} from "./DiscoveryContent";

type ListState = {
  key: string;
  status: "loading" | "loaded" | "empty" | "invalid" | "unavailable";
  items: PublicOffer[];
  nextCursor: string | null;
  morePending: boolean;
};

export default function CustomerOfferList() {
  const { locale, t } = useI18n();
  const router = useRouter();
  const search = useSearchParams();
  const query = search.toString();
  const category = search.get("category") || undefined;
  const cluster = search.get("cluster") || undefined;
  const invalid =
    [...search.keys()].some(
      (key) => !["category", "cluster"].includes(key) || search.getAll(key).length !== 1
    ) ||
    (category !== undefined && !(PUBLIC_CATEGORY_CODES as readonly string[]).includes(category)) ||
    (cluster !== undefined && !(PUBLIC_CAIRO_CLUSTERS as readonly string[]).includes(cluster));
  const [refreshIndex, setRefreshIndex] = useState(0);
  const refresh = useCallback(() => setRefreshIndex((value) => value + 1), []);
  useFocusRefresh(refresh);
  const key = `${locale}:${query}:${refreshIndex}`;
  const [state, setState] = useState<ListState>({
    key: "",
    status: "loading",
    items: [],
    nextCursor: null,
    morePending: false,
  });
  const generation = useRef(0);
  const controllers = useRef(new Set<AbortController>());
  const moreBusy = useRef(false);
  const seenCursors = useRef(new Set<string>());
  const current: ListState =
    state.key === key
      ? state
      : {
          key,
          status: invalid ? "invalid" : "loading",
          items: [],
          nextCursor: null,
          morePending: false,
        };

  useEffect(() => {
    const ownedGeneration = ++generation.current;
    const pending = controllers.current;
    for (const controller of pending) controller.abort();
    pending.clear();
    moreBusy.current = false;
    seenCursors.current.clear();
    const controller = new AbortController();
    pending.add(controller);
    const empty = { key, items: [], nextCursor: null, morePending: false };
    if (invalid) {
      pending.delete(controller);
      controller.abort();
      return;
    }
    void loadPublicOffers({ category, cluster }, controller.signal)
      .then((page) => {
        if (controller.signal.aborted || generation.current !== ownedGeneration) return;
        setState({
          key,
          status: page.items.length ? "loaded" : "empty",
          items: [...new Map(page.items.map((offer) => [offer.offerId, offer])).values()],
          nextCursor: page.nextCursor,
          morePending: false,
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || generation.current !== ownedGeneration) return;
        setState({
          ...empty,
          status:
            error instanceof DiscoveryReadError && error.status === 400 ? "invalid" : "unavailable",
        });
      })
      .finally(() => pending.delete(controller));
    return () => {
      controller.abort();
      for (const child of pending) child.abort();
      pending.clear();
    };
  }, [key, category, cluster, invalid]);

  const loadMore = async () => {
    if (moreBusy.current || current.status !== "loaded" || !current.nextCursor) return;
    const ownedGeneration = generation.current;
    const cursor = current.nextCursor;
    moreBusy.current = true;
    const controller = new AbortController();
    const pending = controllers.current;
    pending.add(controller);
    setState((previous) => ({ ...previous, morePending: true }));
    try {
      if (seenCursors.current.has(cursor)) throw new Error("INVALID_PAGINATION");
      seenCursors.current.add(cursor);
      const page = await loadPublicOffers({ category, cluster, cursor }, controller.signal);
      if (controller.signal.aborted || generation.current !== ownedGeneration) return;
      if (page.nextCursor && seenCursors.current.has(page.nextCursor))
        throw new Error("INVALID_PAGINATION");
      setState((previous) =>
        previous.key !== key
          ? previous
          : {
              ...previous,
              items: [
                ...new Map(
                  [...previous.items, ...page.items].map((offer) => [offer.offerId, offer])
                ).values(),
              ],
              nextCursor: page.nextCursor,
              morePending: false,
            }
      );
    } catch (error) {
      if (controller.signal.aborted || generation.current !== ownedGeneration) return;
      setState({
        key,
        status:
          error instanceof DiscoveryReadError && error.status === 400 ? "invalid" : "unavailable",
        items: [],
        nextCursor: null,
        morePending: false,
      });
    } finally {
      pending.delete(controller);
      if (generation.current === ownedGeneration) moreBusy.current = false;
    }
  };
  const changeFilter = (name: "category" | "cluster", value: string) => {
    const next = new URLSearchParams(query);
    if (value) next.set(name, value);
    else next.delete(name);
    router.push(`/customer/offers${next.size ? `?${next}` : ""}`, { scroll: false });
  };

  return (
    <>
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">{t("customerDiscovery.title")}</h1>
        <p className="text-slate-600">{t("customerDiscovery.intro")}</p>
      </div>
      <DiscoveryLimitations />
      <section
        className={`${panelClass} grid gap-4 sm:grid-cols-2`}
        aria-label={t("customerDiscovery.navigation")}
      >
        <label className="space-y-2">
          <span className="block font-semibold">{t("customerDiscovery.category")}</span>
          <select
            data-testid="discovery-category"
            className="min-h-11 w-full rounded-lg border border-slate-300 bg-white p-2"
            value={category ?? ""}
            onChange={(event) => changeFilter("category", event.target.value)}
          >
            <option value="">{t("customerDiscovery.allCategories")}</option>
            {PUBLIC_CATEGORY_CODES.map((code) => (
              <option key={code} value={code}>
                {t(`customerDiscovery.${code}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-2">
          <span className="block font-semibold">{t("customerDiscovery.cluster")}</span>
          <select
            data-testid="discovery-cluster"
            className="min-h-11 w-full rounded-lg border border-slate-300 bg-white p-2"
            value={cluster ?? ""}
            onChange={(event) => changeFilter("cluster", event.target.value)}
          >
            <option value="">{t("customerDiscovery.allClusters")}</option>
            {PUBLIC_CAIRO_CLUSTERS.map((code) => (
              <option key={code} value={code}>
                {t(`customerDiscovery.${code}`)}
              </option>
            ))}
          </select>
        </label>
      </section>
      <button
        type="button"
        data-testid="discovery-refresh"
        className={actionClass}
        onClick={refresh}
        disabled={current.status === "loading"}
      >
        {t("customerDiscovery.refresh")}
      </button>
      {current.status === "loading" && <p role="status">{t("customerDiscovery.loading")}</p>}
      {current.status === "empty" && (
        <p role="status" className={panelClass}>
          {t("customerDiscovery.empty")}
        </p>
      )}
      {(current.status === "invalid" || current.status === "unavailable") && (
        <DiscoveryFailure
          kind={current.status}
          retry={() => {
            if (current.status === "invalid") router.replace("/customer/offers");
            refresh();
          }}
        />
      )}
      {current.status === "loaded" && (
        <>
          <p role="status">{t("customerDiscovery.count", { count: current.items.length })}</p>
          <p className="text-sm text-slate-600">{t("customerDiscovery.ordering")}</p>
          <div className="grid gap-4 md:grid-cols-2">
            {current.items.map((offer) => (
              <article
                key={offer.offerId}
                data-testid="discovery-offer-card"
                className={`${panelClass} min-w-0 space-y-4 break-words`}
              >
                <div className="space-y-1">
                  <p className="text-sm text-slate-600">
                    {locale === "ar" ? offer.provider.nameAr : offer.provider.nameEn} ·{" "}
                    {locale === "ar" ? offer.branch.nameAr : offer.branch.nameEn}
                  </p>
                  <h2 className="text-xl font-bold">
                    {locale === "ar" ? offer.titleAr : offer.titleEn}
                  </h2>
                  <p className="text-sm">
                    {locale === "ar" ? offer.category.nameAr : offer.category.nameEn} ·{" "}
                    {t(`customerDiscovery.${offer.branch.cluster}`)}
                  </p>
                </div>
                <DiscoveryPrices offer={offer} />
                <Link
                  className={`${actionClass} inline-flex items-center`}
                  href={`/customer/offers/${offer.offerId}`}
                >
                  {t("customerDiscovery.details")}
                  <span className="sr-only">
                    : {locale === "ar" ? offer.titleAr : offer.titleEn}
                  </span>
                </Link>
              </article>
            ))}
          </div>
          {current.nextCursor && (
            <button
              type="button"
              data-testid="discovery-load-more"
              className={actionClass}
              onClick={() => void loadMore()}
              disabled={current.morePending}
            >
              {t(current.morePending ? "customerDiscovery.loading" : "customerDiscovery.more")}
            </button>
          )}
          {current.morePending && <p role="status">{t("customerDiscovery.loading")}</p>}
        </>
      )}
    </>
  );
}
