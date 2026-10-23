"use client";

import { useEffect } from "react";
import { useI18n } from "@/context/I18nContext";
import {
  formatPublicMoney,
  formatPublicDiscount,
  type PublicOffer,
} from "@/lib/customer/discovery-client";

export const actionClass =
  "min-h-11 rounded-lg border border-slate-300 bg-white px-4 py-2 font-semibold disabled:opacity-50";
export const panelClass = "rounded-2xl border border-slate-200 bg-white p-4 sm:p-6";

export function useFocusRefresh(refresh: () => void) {
  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);
}

export function DiscoveryLimitations() {
  const { t } = useI18n();
  return (
    <aside className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
      <p>{t("customerDiscovery.notChecked")}</p>
      <p>{t("customerDiscovery.noReservation")}</p>
    </aside>
  );
}

export function DiscoveryPrices({ offer }: { offer: PublicOffer }) {
  const { locale, t } = useI18n();
  return (
    <dl className="grid grid-cols-2 gap-3 text-sm">
      <div>
        <dt className="text-slate-600">{t("customerDiscovery.normalPrice")}</dt>
        <dd>
          <bdi>{formatPublicMoney(offer.normalPriceMinor, locale)}</bdi>
        </dd>
      </div>
      <div>
        <dt className="text-slate-600">{t("customerDiscovery.customerPrice")}</dt>
        <dd className="text-lg font-bold">
          <bdi>{formatPublicMoney(offer.customerPriceMinor, locale)}</bdi>
        </dd>
      </div>
      <div>
        <dt className="text-slate-600">{t("customerDiscovery.savings")}</dt>
        <dd>
          <bdi>{formatPublicMoney(offer.savingsMinor, locale)}</bdi>
        </dd>
      </div>
      <div>
        <dt className="text-slate-600">{t("customerDiscovery.discount")}</dt>
        <dd>
          <bdi>{formatPublicDiscount(offer.discountRateBps, locale)}</bdi>
        </dd>
      </div>
    </dl>
  );
}

export function DiscoveryFailure({
  kind,
  retry,
}: {
  kind: "invalid" | "missing" | "changed" | "unavailable";
  retry: () => void;
}) {
  const { t } = useI18n();
  return (
    <section className={`${panelClass} space-y-4`}>
      <p role="alert">{t(`customerDiscovery.${kind}`)}</p>
      {kind !== "missing" && (
        <button type="button" data-testid="discovery-retry" className={actionClass} onClick={retry}>
          {t(kind === "invalid" ? "customerDiscovery.reset" : "customerDiscovery.retry")}
        </button>
      )}
    </section>
  );
}
