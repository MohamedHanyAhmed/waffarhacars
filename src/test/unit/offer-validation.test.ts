import { describe, expect, it } from "vitest";
import { deriveOfferPricing } from "@/domain/offerPricing";
import { OfferDraftFieldsSchema } from "@/lib/offer/validation";

const validDraft = {
  titleEn: "Exterior wash",
  titleAr: "غسيل خارجي",
  includedLaborEn: "Exterior hand wash",
  includedLaborAr: "غسيل يدوي خارجي",
  includedPartsEn: "Water and shampoo",
  includedPartsAr: "مياه وشامبو",
  excludedLaborEn: "Interior detailing",
  excludedLaborAr: "تنظيف داخلي تفصيلي",
  excludedPartsEn: "Wax",
  excludedPartsAr: "شمع",
  bookingRule: "APPOINTMENT_REQUIRED",
  durationMinutes: 30,
  validFrom: "2026-10-10T00:00:00+02:00",
  validUntil: "2026-11-10T00:00:00+02:00",
  normalPriceMinor: "10000",
  customerPriceMinor: "8000",
  evidencePacketId: "PRICE-PACKET-1",
  evidenceType: "PROVIDER_PRICE_LIST",
  evidenceDate: "2026-10-01T12:00:00+02:00",
  priceBasisNotes: "Printed price list observed at the center",
  commercialTermsPacketId: "TERMS-PACKET-1",
  commercialTermsAgreedAt: "2026-10-01T12:00:00+02:00",
  commissionBasis: "DISCOUNTED_CUSTOMER_PRICE",
  commissionRateBps: 0,
};

describe("offer price and evidence validation", () => {
  it("accepts integer piastre inputs and an explicit zero introductory rate", () => {
    const result = OfferDraftFieldsSchema.safeParse(validDraft);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.normalPriceMinor).toBe(10000n);
      expect(result.data.customerPriceMinor).toBe(8000n);
      expect(result.data.commissionRateBps).toBe(0);
    }
  });

  it("rejects free or non-discounted offers and fractional-piastre input", () => {
    expect(
      OfferDraftFieldsSchema.safeParse({ ...validDraft, customerPriceMinor: "0" }).success
    ).toBe(false);
    expect(
      OfferDraftFieldsSchema.safeParse({ ...validDraft, customerPriceMinor: "10000" }).success
    ).toBe(false);
    expect(
      OfferDraftFieldsSchema.safeParse({ ...validDraft, normalPriceMinor: "100.50" }).success
    ).toBe(false);
  });

  it("rejects URLs, email, and phone data in public copy and evidence notes", () => {
    expect(
      OfferDraftFieldsSchema.safeParse({ ...validDraft, titleEn: "Call +201012345678" }).success
    ).toBe(false);
    expect(
      OfferDraftFieldsSchema.safeParse({
        ...validDraft,
        priceBasisNotes: "https://drive.example/file",
      }).success
    ).toBe(false);
    expect(
      OfferDraftFieldsSchema.safeParse({ ...validDraft, includedLaborEn: "owner@example.com" })
        .success
    ).toBe(false);
  });

  it("requires opaque packet IDs instead of URLs or filesystem paths", () => {
    expect(
      OfferDraftFieldsSchema.safeParse({ ...validDraft, evidencePacketId: "https://private/file" })
        .success
    ).toBe(false);
    expect(
      OfferDraftFieldsSchema.safeParse({
        ...validDraft,
        commercialTermsPacketId: "C:\\secret\\folder",
      }).success
    ).toBe(false);
  });

  it("derives exact savings and basis-point display using overflow-safe integer math", () => {
    expect(deriveOfferPricing(10001n, 8000n)).toEqual({
      savingsMinor: 2001n,
      discountRateBps: 2001n,
    });
    expect(deriveOfferPricing(9007199254740991000n, 4503599627370495500n)).toEqual({
      savingsMinor: 4503599627370495500n,
      discountRateBps: 5000n,
    });
    expect(() => deriveOfferPricing(100n, 100n)).toThrow(RangeError);
  });
});
