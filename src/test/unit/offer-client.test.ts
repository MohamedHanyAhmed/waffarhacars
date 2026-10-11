import { describe, expect, it } from "vitest";
import {
  cairoInputToUtc,
  clearPendingOfferOperation,
  egpToMinor,
  minorToEgp,
  offerDiscountBps,
  readPendingOfferOperation,
  utcToCairoInput,
  writePendingOfferOperation,
} from "@/lib/offer/client";

describe("staff offer client-safe money and Cairo time helpers", () => {
  it("converts decimal EGP exactly and preserves explicit zero commission independently", () => {
    expect(egpToMinor("0")).toBe("0");
    expect(egpToMinor("1234.5")).toBe("123450");
    expect(minorToEgp("123450")).toBe("1234.50");
    expect(egpToMinor("9999999999999999.99")).toBe("999999999999999999");
    expect(egpToMinor("10000000000000000")).toBeNull();
    expect(offerDiscountBps("100000", "80000")).toBe("2000");
  });

  it("rejects invalid monetary precision and non-decimal input", () => {
    for (const value of ["", "1.234", "1e3", "-1", ".50", "1,000", "01.00"]) {
      expect(egpToMinor(value)).toBeNull();
    }
  });

  it("round-trips Cairo local time without assuming a fixed UTC offset", () => {
    for (const instant of ["2026-01-15T10:30:00.000Z", "2026-07-15T10:30:00.000Z"]) {
      const cairo = utcToCairoInput(instant);
      expect(cairoInputToUtc(cairo)).toBe(instant);
    }
  });

  it("rejects invalid, skipped, and repeated Cairo clock times at DST boundaries", () => {
    expect(cairoInputToUtc("2026-02-31T12:00")).toBeNull();
    // Egypt advances at the last Friday in April and reverses at the last Thursday in October.
    expect(cairoInputToUtc("2026-04-24T00:30")).toBeNull();
    expect(cairoInputToUtc("2026-10-29T23:30")).toBeNull();
  });

  it("retains only request identity and unresolved status in the tab journal", () => {
    const operation = {
      kind: "create" as const,
      creationRequestId: "creation-1",
      revisionRequestId: "revision-1",
      unresolved: true as const,
    };
    writePendingOfferOperation(operation);
    expect(readPendingOfferOperation()).toEqual(operation);
    const stored = sessionStorage.getItem("waffarhacars_offer_pending_v1");
    expect(stored).not.toContain("normalPriceMinor");
    expect(stored).not.toContain("evidencePacketId");
    clearPendingOfferOperation();
    expect(readPendingOfferOperation()).toBeNull();
  });
});
