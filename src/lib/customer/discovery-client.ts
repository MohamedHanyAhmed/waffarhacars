import { z } from "zod";
import { deriveOfferPricing } from "@/domain/offerPricing";

// Deliberately client-safe mirrors of the public route's bounded filter vocabulary.
export const PUBLIC_CATEGORY_CODES = [
  "EXPRESS_MAINTENANCE",
  "GENERAL_REPAIRS",
  "CAR_WASH",
  "ACCESSORIES",
] as const;
export const PUBLIC_CAIRO_CLUSTERS = [
  "NASR_CITY_HELIOPOLIS",
  "NEW_CAIRO",
  "MAADI",
  "OCTOBER_ZAYED",
] as const;

const uuid = z.string().uuid();
const text = (max: number) => z.string().min(1).max(max);
const minor = z.string().regex(/^(?:0|[1-9][0-9]{0,17})$/);
const basisPoints = z
  .string()
  .regex(/^(?:0|[1-9][0-9]{0,4})$/)
  .refine((value) => /^(?:0|[1-9][0-9]{0,4})$/.test(value) && BigInt(value) <= 10000n);
const timestamp = z.string().datetime({ offset: true });
const cursor = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/);
const namedEntity = z.object({ id: uuid, nameEn: text(128), nameAr: text(128) }).strict();
const hour = z.string().regex(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/);
const hours = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    openTime: hour,
    closeTime: hour,
    isClosed: z.boolean(),
  })
  .strict();

export const PublicOfferSchema = z
  .object({
    offerId: uuid,
    revisionId: uuid,
    provider: namedEntity,
    branch: namedEntity.extend({
      cluster: z.enum(PUBLIC_CAIRO_CLUSTERS),
      streetAddressEn: text(255),
      streetAddressAr: text(255),
      landmarkEn: z.string().max(255).nullable(),
      landmarkAr: z.string().max(255).nullable(),
      latitude: z
        .string()
        .max(32)
        .regex(/^-?[0-9]+(?:\.[0-9]+)?$/),
      longitude: z
        .string()
        .max(32)
        .regex(/^-?[0-9]+(?:\.[0-9]+)?$/),
      operatingHours: z.array(hours).max(7),
    }),
    category: z
      .object({ code: z.enum(PUBLIC_CATEGORY_CODES), nameEn: text(160), nameAr: text(160) })
      .strict(),
    service: z
      .object({
        code: text(64),
        nameEn: text(160),
        nameAr: text(160),
        scopeEn: text(1000),
        scopeAr: text(1000),
      })
      .strict(),
    titleEn: text(160),
    titleAr: text(160),
    includedLaborEn: text(1000),
    includedLaborAr: text(1000),
    includedPartsEn: text(1000),
    includedPartsAr: text(1000),
    excludedLaborEn: text(1000),
    excludedLaborAr: text(1000),
    excludedPartsEn: text(1000),
    excludedPartsAr: text(1000),
    bookingRule: z.enum(["APPOINTMENT_REQUIRED", "WALK_IN_ALLOWED", "CONTACT_TO_BOOK"]),
    durationMinutes: z.number().int().min(1).max(1440),
    validFrom: timestamp,
    validUntil: timestamp,
    normalPriceMinor: minor,
    customerPriceMinor: minor,
    savingsMinor: minor,
    discountRateBps: basisPoints,
  })
  .strict()
  .refine((offer) => new Date(offer.validFrom) < new Date(offer.validUntil))
  .refine((offer) => {
    // Reject incoherent transport data; never replace the server's projected amounts.
    if (
      ![offer.normalPriceMinor, offer.customerPriceMinor, offer.savingsMinor].every(
        (value) => minor.safeParse(value).success
      )
    )
      return false;
    if (!basisPoints.safeParse(offer.discountRateBps).success) return false;
    const normal = BigInt(offer.normalPriceMinor);
    const customer = BigInt(offer.customerPriceMinor);
    if (customer <= 0n || customer >= normal) return false;
    const pricing = deriveOfferPricing(normal, customer);
    return (
      pricing.savingsMinor === BigInt(offer.savingsMinor) &&
      pricing.discountRateBps === BigInt(offer.discountRateBps)
    );
  });
export type PublicOffer = z.infer<typeof PublicOfferSchema>;

export const PublicOfferPageSchema = z
  .object({ items: z.array(PublicOfferSchema).max(20), nextCursor: cursor.nullable() })
  .strict()
  .refine((page) => new Set(page.items.map((item) => item.offerId)).size === page.items.length)
  .refine((page) => page.items.length > 0 || page.nextCursor === null);
export type PublicOfferPage = z.infer<typeof PublicOfferPageSchema>;

const vehicleName = z
  .object({ id: uuid, code: text(64), nameEn: text(160), nameAr: text(160) })
  .strict();
const range = z
  .object({
    make: vehicleName,
    model: vehicleName,
    yearFrom: z.number().int().min(1900).max(9999),
    yearTo: z.number().int().min(1900).max(9999),
  })
  .strict()
  .refine((row) => row.yearFrom <= row.yearTo);
export const PublicCoverageSchema = z
  .object({
    offerId: uuid,
    revisionId: uuid,
    capabilityVersionId: uuid,
    // Both underlying lists are capped at 50; their SQL intersection has at most 50×50 rows.
    coverage: z.array(range).min(1).max(2500),
  })
  .strict()
  .refine((summary) => {
    const modelMakes = new Map<string, string>();
    const names = new Map<string, string>();
    return summary.coverage.every((row) => {
      if (modelMakes.has(row.model.id) && modelMakes.get(row.model.id) !== row.make.id)
        return false;
      modelMakes.set(row.model.id, row.make.id);
      return [row.make, row.model].every((entity) => {
        const label = JSON.stringify([entity.code, entity.nameEn, entity.nameAr]);
        if (names.has(entity.id) && names.get(entity.id) !== label) return false;
        names.set(entity.id, label);
        return true;
      });
    });
  });
export type PublicCoverage = z.infer<typeof PublicCoverageSchema>;

export type DiscoveryReadCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "SERVICE_UNAVAILABLE"
  | "INVALID_RESPONSE"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "CANCELLED";
export class DiscoveryReadError extends Error {
  constructor(
    readonly status: 0 | 400 | 404 | 503,
    readonly code: DiscoveryReadCode
  ) {
    super(code);
    this.name = "DiscoveryReadError";
  }
}

async function readPublic<T>(path: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let cancel = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    cancel = () => {
      controller.abort();
      reject(new DiscoveryReadError(0, "CANCELLED"));
    };
    if (signal?.aborted) cancel();
    else signal?.addEventListener("abort", cancel, { once: true });
    deadline = setTimeout(() => {
      controller.abort();
      reject(new DiscoveryReadError(0, "TIMEOUT"));
    }, 12000);
  });
  try {
    if (signal?.aborted) return await cancelled;
    const read = async () => {
      const response = await fetch(path, {
        method: "GET",
        mode: "same-origin",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 400) throw new DiscoveryReadError(400, "VALIDATION_ERROR");
        if (response.status === 404) throw new DiscoveryReadError(404, "NOT_FOUND");
        throw new DiscoveryReadError(503, "SERVICE_UNAVAILABLE");
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new DiscoveryReadError(503, "INVALID_RESPONSE");
      }
      const parsed = schema.safeParse(body);
      if (!parsed.success) throw new DiscoveryReadError(503, "INVALID_RESPONSE");
      return parsed.data;
    };
    return await Promise.race([read(), cancelled]);
  } catch (error) {
    if (error instanceof DiscoveryReadError) throw error;
    throw new DiscoveryReadError(0, "NETWORK_ERROR");
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener("abort", cancel);
  }
}

export async function loadPublicOffers(
  filters: { category?: string; cluster?: string; cursor?: string } = {},
  signal?: AbortSignal
): Promise<PublicOfferPage> {
  const parsed = z
    .object({
      category: z.enum(PUBLIC_CATEGORY_CODES).optional(),
      cluster: z.enum(PUBLIC_CAIRO_CLUSTERS).optional(),
      cursor: cursor.optional(),
    })
    .strict()
    .safeParse(filters);
  if (!parsed.success) throw new DiscoveryReadError(400, "VALIDATION_ERROR");
  const query = new URLSearchParams({ limit: "10" });
  for (const [key, value] of Object.entries(parsed.data))
    if (value !== undefined) query.set(key, value);
  const page = await readPublic(`/api/v1/offers?${query}`, PublicOfferPageSchema, signal);
  if (
    page.items.length > 10 ||
    page.items.some(
      (offer) =>
        (parsed.data.category && offer.category.code !== parsed.data.category) ||
        (parsed.data.cluster && offer.branch.cluster !== parsed.data.cluster)
    )
  )
    throw new DiscoveryReadError(503, "INVALID_RESPONSE");
  return page;
}

export async function loadPublicOffer(offerId: string, signal?: AbortSignal): Promise<PublicOffer> {
  if (!uuid.safeParse(offerId).success) throw new DiscoveryReadError(400, "VALIDATION_ERROR");
  const offer = await readPublic(`/api/v1/offers/${offerId}`, PublicOfferSchema, signal);
  if (offer.offerId.toLowerCase() !== offerId.toLowerCase())
    throw new DiscoveryReadError(503, "INVALID_RESPONSE");
  return offer;
}

export async function loadPublicCoverage(
  offerId: string,
  signal?: AbortSignal
): Promise<PublicCoverage> {
  if (!uuid.safeParse(offerId).success) throw new DiscoveryReadError(400, "VALIDATION_ERROR");
  const coverage = await readPublic(
    `/api/v1/offers/${offerId}/fitment`,
    PublicCoverageSchema,
    signal
  );
  if (coverage.offerId.toLowerCase() !== offerId.toLowerCase())
    throw new DiscoveryReadError(503, "INVALID_RESPONSE");
  return coverage;
}

function exactDecimal(integer: bigint, fraction: bigint, locale: "en" | "ar"): string {
  const language = locale === "ar" ? "ar-EG" : "en-EG";
  const whole = new Intl.NumberFormat(language).format(integer);
  const decimal =
    new Intl.NumberFormat(language).formatToParts(1.1).find((part) => part.type === "decimal")
      ?.value ?? ".";
  const digits = new Intl.NumberFormat(language, {
    minimumIntegerDigits: 2,
    useGrouping: false,
  }).format(fraction);
  return `${whole}${decimal}${digits}`;
}

export function formatPublicMoney(value: string, locale: "en" | "ar"): string {
  if (!minor.safeParse(value).success) throw new DiscoveryReadError(503, "INVALID_RESPONSE");
  const amount = BigInt(value);
  const formatted = exactDecimal(amount / 100n, amount % 100n, locale);
  return locale === "ar" ? `${formatted} ج.م` : `EGP ${formatted}`;
}

export function formatPublicDiscount(value: string, locale: "en" | "ar"): string {
  if (!basisPoints.safeParse(value).success) throw new DiscoveryReadError(503, "INVALID_RESPONSE");
  const bps = BigInt(value);
  return `${exactDecimal(bps / 100n, bps % 100n, locale)}${locale === "ar" ? "٪" : "%"}`;
}

export function formatPublicDate(iso: string, locale: "en" | "ar"): string {
  if (!timestamp.safeParse(iso).success) throw new DiscoveryReadError(503, "INVALID_RESPONSE");
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-EG", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}
