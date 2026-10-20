import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DiscoveryReadError,
  PublicCoverageSchema,
  PublicOfferPageSchema,
  PublicOfferSchema,
  formatPublicDate,
  formatPublicDiscount,
  formatPublicMoney,
  loadPublicCoverage,
  loadPublicOffer,
  loadPublicOffers,
  type PublicCoverage,
  type PublicOffer,
} from "@/lib/customer/discovery-client";

const offerId = "10000000-0000-4000-8000-000000000001";
const revisionId = "20000000-0000-4000-8000-000000000001";
const otherId = "30000000-0000-4000-8000-000000000001";
function offer(): PublicOffer {
  return {
    offerId,
    revisionId,
    provider: {
      id: "40000000-0000-4000-8000-000000000001",
      nameEn: "Synthetic provider",
      nameAr: "مقدم تجريبي",
    },
    branch: {
      id: "50000000-0000-4000-8000-000000000001",
      nameEn: "Synthetic branch",
      nameAr: "فرع تجريبي",
      cluster: "NASR_CITY_HELIOPOLIS",
      streetAddressEn: "Synthetic address",
      streetAddressAr: "عنوان تجريبي",
      landmarkEn: null,
      landmarkAr: null,
      latitude: "30.1",
      longitude: "31.3",
      operatingHours: [{ dayOfWeek: 0, openTime: "09:00", closeTime: "17:00", isClosed: false }],
    },
    category: { code: "CAR_WASH", nameEn: "Car wash", nameAr: "غسيل سيارات" },
    service: {
      code: "SYNTHETIC_WASH",
      nameEn: "Wash",
      nameAr: "غسيل",
      scopeEn: "Exterior wash",
      scopeAr: "غسيل خارجي",
    },
    titleEn: "Synthetic wash offer",
    titleAr: "عرض غسيل تجريبي",
    includedLaborEn: "Exterior wash",
    includedLaborAr: "غسيل خارجي",
    includedPartsEn: "None",
    includedPartsAr: "لا يوجد",
    excludedLaborEn: "Interior",
    excludedLaborAr: "داخلي",
    excludedPartsEn: "None",
    excludedPartsAr: "لا يوجد",
    bookingRule: "WALK_IN_ALLOWED",
    durationMinutes: 30,
    validFrom: "2026-01-01T00:00:00.000Z",
    validUntil: "2027-01-01T00:00:00.000Z",
    normalPriceMinor: "10000",
    customerPriceMinor: "7500",
    savingsMinor: "2500",
    discountRateBps: "2500",
  };
}
function coverage(): PublicCoverage {
  return {
    offerId,
    revisionId,
    capabilityVersionId: otherId,
    coverage: [
      {
        make: {
          id: "60000000-0000-4000-8000-000000000001",
          code: "SYNTHETIC",
          nameEn: "Synthetic",
          nameAr: "تجريبي",
        },
        model: {
          id: "70000000-0000-4000-8000-000000000001",
          code: "SYNTHETIC_MODEL",
          nameEn: "Model",
          nameAr: "موديل",
        },
        yearFrom: 2015,
        yearTo: 2025,
      },
    ],
  };
}
function respond(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue(Response.json(body, { status }));
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Anonymous discovery transport validation (not database eligibility)", () => {
  it("reads the actual unwrapped public DTO through a relative anonymous no-store GET", async () => {
    const fetch = respond(offer());
    vi.stubGlobal("fetch", fetch);
    expect(await loadPublicOffer(offerId)).toEqual(offer());
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      `/api/v1/offers/${offerId}`,
      expect.objectContaining({
        method: "GET",
        mode: "same-origin",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        headers: { Accept: "application/json" },
        signal: expect.any(AbortSignal),
      })
    );
  });
  it("accepts genuine empty pages without substituting inventory", async () => {
    vi.stubGlobal("fetch", respond({ items: [], nextCursor: null }));
    expect(await loadPublicOffers()).toEqual({ items: [], nextCursor: null });
  });
  it("limits each list request to10 and encodes only bounded category cluster and cursor", async () => {
    const fetch = respond({ items: [offer()], nextCursor: "cursor_1" });
    vi.stubGlobal("fetch", fetch);
    expect(
      (
        await loadPublicOffers({
          category: "CAR_WASH",
          cluster: "NASR_CITY_HELIOPOLIS",
          cursor: "cursor_0",
        })
      ).items
    ).toHaveLength(1);
    expect(fetch.mock.calls[0][0]).toBe(
      "/api/v1/offers?limit=10&category=CAR_WASH&cluster=NASR_CITY_HELIOPOLIS&cursor=cursor_0"
    );
  });
  it.each([
    { category: "unrecognized" },
    { cluster: "OTHER" },
    { cursor: "x".repeat(257) },
    { cursor: "https://example.test" },
    { limit: 100 },
  ])("rejects invalid or extra filter input before any fetch: %j", async (filters) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(loadPublicOffers(filters)).rejects.toMatchObject({
      status: 400,
      code: "VALIDATION_ERROR",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["../staff", "https://example.test", "not-a-uuid"])(
    "rejects arbitrary resource paths before detail or coverage fetch: %s",
    async (id) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      await expect(loadPublicOffer(id)).rejects.toMatchObject({ status: 400 });
      await expect(loadPublicCoverage(id)).rejects.toMatchObject({ status: 400 });
      expect(fetch).not.toHaveBeenCalled();
    }
  );
  it("rejects malformed success envelopes and does not return an empty page", async () => {
    vi.stubGlobal("fetch", respond({ data: { items: [], nextCursor: null } }));
    await expect(loadPublicOffers()).rejects.toMatchObject({
      status: 503,
      code: "INVALID_RESPONSE",
    });
  });
  it("rejects a detail or coverage response for another offer", async () => {
    vi.stubGlobal("fetch", respond({ ...offer(), offerId: otherId }));
    await expect(loadPublicOffer(offerId)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    vi.stubGlobal("fetch", respond({ ...coverage(), offerId: otherId }));
    await expect(loadPublicCoverage(offerId)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("rejects a page that contradicts the requested category or cluster", async () => {
    vi.stubGlobal("fetch", respond({ items: [offer()], nextCursor: null }));
    await expect(loadPublicOffers({ category: "ACCESSORIES" })).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    await expect(loadPublicOffers({ cluster: "MAADI" })).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
  it("rejects oversized API pages and pages larger than the fixed requested limit", async () => {
    const items = Array.from({ length: 21 }, (_, index) => ({
      ...offer(),
      offerId: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    }));
    expect(PublicOfferPageSchema.safeParse({ items, nextCursor: null }).success).toBe(false);
    vi.stubGlobal("fetch", respond({ items: items.slice(0, 11), nextCursor: null }));
    await expect(loadPublicOffers()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("rejects duplicate offer IDs and nonempty continuation on an empty page", () => {
    expect(
      PublicOfferPageSchema.safeParse({ items: [offer(), offer()], nextCursor: null }).success
    ).toBe(false);
    expect(PublicOfferPageSchema.safeParse({ items: [], nextCursor: "cursor" }).success).toBe(
      false
    );
  });
  it("rejects unknown fields at top level and within every customer object", () => {
    expect(PublicOfferSchema.safeParse({ ...offer(), evidenceRef: "private" }).success).toBe(false);
    for (const key of ["provider", "branch", "category", "service"] as const) {
      expect(
        PublicOfferSchema.safeParse({
          ...offer(),
          [key]: { ...offer()[key], evidenceRef: "private" },
        }).success
      ).toBe(false);
    }
    const value = offer();
    value.branch.operatingHours[0] = {
      ...value.branch.operatingHours[0],
      secret: "private",
    } as (typeof value.branch.operatingHours)[number];
    expect(PublicOfferSchema.safeParse(value).success).toBe(false);
    expect(PublicCoverageSchema.safeParse({ ...coverage(), evidenceRef: "private" }).success).toBe(
      false
    );
    const row = coverage().coverage[0];
    for (const key of ["make", "model"] as const) {
      expect(
        PublicCoverageSchema.safeParse({
          ...coverage(),
          coverage: [{ ...row, [key]: { ...row[key], secret: "private" } }],
        }).success
      ).toBe(false);
    }
    expect(
      PublicCoverageSchema.safeParse({ ...coverage(), coverage: [{ ...row, secret: "private" }] })
        .success
    ).toBe(false);
  });
  it("rejects oversized text, invalid hours, reversed validity and incoherent prices", () => {
    expect(PublicOfferSchema.safeParse({ ...offer(), titleEn: "x".repeat(161) }).success).toBe(
      false
    );
    expect(PublicOfferSchema.safeParse({ ...offer(), validFrom: offer().validUntil }).success).toBe(
      false
    );
    expect(PublicOfferSchema.safeParse({ ...offer(), savingsMinor: "1" }).success).toBe(false);
    expect(PublicOfferSchema.safeParse({ ...offer(), discountRateBps: "10001" }).success).toBe(
      false
    );
    expect(PublicOfferSchema.safeParse({ ...offer(), discountRateBps: "5000" }).success).toBe(
      false
    );
    const value = offer();
    value.branch.operatingHours[0].openTime = "99:00";
    expect(PublicOfferSchema.safeParse(value).success).toBe(false);
  });
  it.each(["not-an-integer", "1.25", "-1", "1e5", "x".repeat(100)])(
    "rejects malformed numeric success data without leaking parsing exceptions: %s",
    async (invalid) => {
      for (const field of [
        "normalPriceMinor",
        "customerPriceMinor",
        "savingsMinor",
        "discountRateBps",
      ]) {
        vi.stubGlobal("fetch", respond({ ...offer(), [field]: invalid }));
        await expect(loadPublicOffer(offerId)).rejects.toMatchObject({
          status: 503,
          code: "INVALID_RESPONSE",
        });
      }
    }
  );
  it("accepts the effective coverage DTO but rejects inconsistent model-to-make identities or labels", async () => {
    vi.stubGlobal("fetch", respond(coverage()));
    expect(await loadPublicCoverage(offerId)).toEqual(coverage());
    const row = coverage().coverage[0];
    expect(
      PublicCoverageSchema.safeParse({
        ...coverage(),
        coverage: [row, { ...row, make: { ...row.make, id: otherId } }],
      }).success
    ).toBe(false);
    expect(
      PublicCoverageSchema.safeParse({
        ...coverage(),
        coverage: [row, { ...row, model: { ...row.model, nameEn: "Different" } }],
      }).success
    ).toBe(false);
    expect(
      PublicCoverageSchema.safeParse({
        ...coverage(),
        coverage: [{ ...row, yearTo: row.yearFrom - 1 }],
      }).success
    ).toBe(false);
    expect(
      PublicCoverageSchema.safeParse({
        ...coverage(),
        coverage: Array.from({ length: 2501 }, () => row),
      }).success
    ).toBe(false);
  });
  it.each([
    [400, "VALIDATION_ERROR"],
    [404, "NOT_FOUND"],
    [503, "SERVICE_UNAVAILABLE"],
    [500, "SERVICE_UNAVAILABLE"],
    [401, "SERVICE_UNAVAILABLE"],
  ] as const)(
    "maps HTTP%s to an allowlisted safe error, ignoring the raw body",
    async (status, code) => {
      vi.stubGlobal("fetch", respond({ error: "private database hostname and exception" }, status));
      const error = await loadPublicOffer(offerId).catch((error: unknown) => error);
      expect(error).toBeInstanceOf(DiscoveryReadError);
      expect(error).toMatchObject({
        status: status === 400 || status === 404 ? status : 503,
        code,
        message: code,
      });
      expect(JSON.stringify(error)).not.toContain("hostname");
    }
  );
  it("sanitizes network exceptions and invalid JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("private hostname")));
    await expect(loadPublicOffer(offerId)).rejects.toMatchObject({
      status: 0,
      message: "NETWORK_ERROR",
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not JSON", { status: 200 })));
    await expect(loadPublicOffer(offerId)).rejects.toMatchObject({
      status: 503,
      message: "INVALID_RESPONSE",
    });
  });
  it("bounds a stalled request at12 seconds even when its transport ignores abort", async () => {
    vi.useFakeTimers();
    let receivedSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_path: string, init: RequestInit) => {
        receivedSignal = init.signal as AbortSignal;
        return new Promise(() => {});
      })
    );
    const result = loadPublicOffer(offerId).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(12000);
    expect(await result).toMatchObject({ status: 0, code: "TIMEOUT" });
    expect(receivedSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("also bounds stalled response-body parsing", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => new Promise(() => {}) })
    );
    const result = loadPublicOffer(offerId).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(12000);
    expect(await result).toMatchObject({ code: "TIMEOUT" });
  });
  it("cancels current reads and pre-aborted requests without retaining deadlines", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetch = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetch);
    const result = loadPublicOffer(offerId, controller.signal).catch((error: unknown) => error);
    controller.abort();
    expect(await result).toMatchObject({ code: "CANCELLED" });
    expect(vi.getTimerCount()).toBe(0);
    fetch.mockClear();
    await expect(loadPublicCoverage(offerId, controller.signal)).rejects.toMatchObject({
      code: "CANCELLED",
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("Exact display-only public price and Cairo date formatting", () => {
  it("preserves minor units above the safe integer range in English and Arabic", () => {
    expect(formatPublicMoney("999999999999999999", "en")).toBe("EGP 9,999,999,999,999,999.99");
    expect(formatPublicMoney("999999999999999999", "ar")).toBe("٩٬٩٩٩٬٩٩٩٬٩٩٩٬٩٩٩٬٩٩٩٫٩٩ ج.م");
    expect(formatPublicMoney("1", "en")).toBe("EGP 0.01");
    expect(formatPublicMoney("100", "ar")).toBe("١٫٠٠ ج.م");
  });
  it("formats server-provided BPS without floating-point monetary arithmetic", () => {
    expect(formatPublicDiscount("1525", "en")).toBe("15.25%");
    expect(formatPublicDiscount("1525", "ar")).toBe("١٥٫٢٥٪");
    expect(formatPublicDiscount("10000", "en")).toBe("100.00%");
  });
  it("uses Cairo calendar and clock across UTC midnight in each locale", () => {
    const iso = "2026-01-01T23:30:00.000Z";
    const en = formatPublicDate(iso, "en");
    const ar = formatPublicDate(iso, "ar");
    expect(en).toContain("Jan 2, 2026");
    expect(en).toContain("01:30");
    expect(ar).toContain("٢ يناير ٢٠٢٦");
    expect(ar).toContain("٠١:٣٠");
  });
  it("rejects unsafe numerical or date inputs rather than silently rounding or rendering invalid data", () => {
    for (const value of ["1.1", "-1", "1e9", "1000000000000000000"])
      expect(() => formatPublicMoney(value, "en")).toThrow(DiscoveryReadError);
    expect(() => formatPublicDiscount("10001", "en")).toThrow(DiscoveryReadError);
    expect(() => formatPublicDate("not a date", "en")).toThrow(DiscoveryReadError);
  });
});
