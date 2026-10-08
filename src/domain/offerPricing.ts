export interface OfferPricingSummary {
  savingsMinor: bigint;
  discountRateBps: bigint;
}

/** Derives display-only discount figures from authoritative integer piastres. */
export function deriveOfferPricing(
  normalPriceMinor: bigint,
  customerPriceMinor: bigint
): OfferPricingSummary {
  if (
    normalPriceMinor <= 0n ||
    customerPriceMinor <= 0n ||
    customerPriceMinor >= normalPriceMinor
  ) {
    throw new RangeError("Offer must have a positive customer price below its normal price.");
  }
  const savingsMinor = normalPriceMinor - customerPriceMinor;
  const discountRateBps = (savingsMinor * 10000n + normalPriceMinor / 2n) / normalPriceMinor;
  return { savingsMinor, discountRateBps };
}
