export interface Money {
  amountMinor: number; // e.g. 120000 for EGP 1,200.00
  currency: "EGP";
}

export type BasisPoints = number; // e.g. 2000 for 20.00%, 1000 for 10.00%

export function createMoney(egp: number): Money {
  return {
    amountMinor: Math.round(egp * 100),
    currency: "EGP",
  };
}

export function moneyFromMinor(amountMinor: number): Money {
  return {
    amountMinor: Math.round(amountMinor),
    currency: "EGP",
  };
}

export function formatMoney(money: Money, locale: "en" | "ar" = "en"): string {
  const egp = money.amountMinor / 100;
  const isAr = locale === "ar";
  const formatted = egp.toLocaleString(isAr ? "ar-EG" : "en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return isAr ? `${formatted} ج.م` : `EGP ${formatted}`;
}

export function formatBps(bps: BasisPoints): string {
  const percent = bps / 100;
  return `${percent}%`;
}

export function calculateDiscount(
  normalPrice: Money,
  discountBps: BasisPoints
): {
  lockedPrice: Money;
  saving: Money;
} {
  const savingMinor = Math.round((normalPrice.amountMinor * discountBps) / 10000);
  const lockedMinor = normalPrice.amountMinor - savingMinor;
  return {
    lockedPrice: { amountMinor: lockedMinor, currency: "EGP" },
    saving: { amountMinor: savingMinor, currency: "EGP" },
  };
}

export function calculateCommission(
  lockedPrice: Money,
  commissionBps: BasisPoints
): {
  commissionAmount: Money;
  providerNet: Money;
} {
  const commissionMinor = Math.round((lockedPrice.amountMinor * commissionBps) / 10000);
  const providerNetMinor = lockedPrice.amountMinor - commissionMinor;
  return {
    commissionAmount: { amountMinor: commissionMinor, currency: "EGP" },
    providerNet: { amountMinor: providerNetMinor, currency: "EGP" },
  };
}

export function sumCommissionAccruals(
  accruals: { commissionAmount: Money }[] | undefined | null
): Money {
  if (!accruals || accruals.length === 0) {
    return { amountMinor: 0, currency: "EGP" };
  }

  let totalMinor = 0;
  for (const item of accruals) {
    if (item.commissionAmount.currency !== "EGP") {
      throw new Error(`Unsupported currency: ${item.commissionAmount.currency}`);
    }
    totalMinor += Math.round(item.commissionAmount.amountMinor);
  }

  return {
    amountMinor: totalMinor,
    currency: "EGP",
  };
}
