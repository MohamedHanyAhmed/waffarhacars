import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/db";
import { deriveOfferPricing } from "@/domain/offerPricing";
import { getServerEnv } from "@/lib/env";
import { OperatingHoursSchema } from "@/lib/provider/validation";

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

type PublicOfferRow = {
  offerId: string;
  revisionId: string;
  providerId: string;
  providerNameEn: string;
  providerNameAr: string;
  branchId: string;
  branchNameEn: string;
  branchNameAr: string;
  branchCluster: string;
  streetAddressEn: string;
  streetAddressAr: string;
  landmarkEn: string | null;
  landmarkAr: string | null;
  latitude: Prisma.Decimal;
  longitude: Prisma.Decimal;
  operatingHours: unknown;
  categoryCode: string;
  categoryNameEn: string;
  categoryNameAr: string;
  serviceCode: string;
  serviceNameEn: string;
  serviceNameAr: string;
  serviceScopeEn: string;
  serviceScopeAr: string;
  titleEn: string;
  titleAr: string;
  includedLaborEn: string;
  includedLaborAr: string;
  includedPartsEn: string;
  includedPartsAr: string;
  excludedLaborEn: string;
  excludedLaborAr: string;
  excludedPartsEn: string;
  excludedPartsAr: string;
  bookingRule: string;
  durationMinutes: number;
  validFrom: Date;
  validUntil: Date;
  normalPriceMinor: bigint;
  customerPriceMinor: bigint;
};

function discoveryEnabled() {
  const env = getServerEnv();
  return (
    env.APP_DATA_BACKEND === "postgres" &&
    env.OFFER_PUBLICATION_ENABLED &&
    env.OFFER_EVIDENCE_PACKET_REPOSITORY_READY &&
    env.OFFER_PUBLICATION_PILOT_CLUSTER !== null
  );
}

function mapPublicOffer(row: PublicOfferRow) {
  const pricing = deriveOfferPricing(row.normalPriceMinor, row.customerPriceMinor);
  const hours = OperatingHoursSchema.safeParse(row.operatingHours);
  return {
    offerId: row.offerId,
    revisionId: row.revisionId,
    provider: { id: row.providerId, nameEn: row.providerNameEn, nameAr: row.providerNameAr },
    branch: {
      id: row.branchId,
      nameEn: row.branchNameEn,
      nameAr: row.branchNameAr,
      cluster: row.branchCluster,
      streetAddressEn: row.streetAddressEn,
      streetAddressAr: row.streetAddressAr,
      landmarkEn: row.landmarkEn,
      landmarkAr: row.landmarkAr,
      latitude: String(row.latitude),
      longitude: String(row.longitude),
      operatingHours: hours.success
        ? hours.data.map(({ dayOfWeek, openTime, closeTime, isClosed }) => ({
            dayOfWeek,
            openTime,
            closeTime,
            isClosed,
          }))
        : [],
    },
    category: {
      code: row.categoryCode,
      nameEn: row.categoryNameEn,
      nameAr: row.categoryNameAr,
    },
    service: {
      code: row.serviceCode,
      nameEn: row.serviceNameEn,
      nameAr: row.serviceNameAr,
      scopeEn: row.serviceScopeEn,
      scopeAr: row.serviceScopeAr,
    },
    titleEn: row.titleEn,
    titleAr: row.titleAr,
    includedLaborEn: row.includedLaborEn,
    includedLaborAr: row.includedLaborAr,
    includedPartsEn: row.includedPartsEn,
    includedPartsAr: row.includedPartsAr,
    excludedLaborEn: row.excludedLaborEn,
    excludedLaborAr: row.excludedLaborAr,
    excludedPartsEn: row.excludedPartsEn,
    excludedPartsAr: row.excludedPartsAr,
    bookingRule: row.bookingRule,
    durationMinutes: row.durationMinutes,
    validFrom: row.validFrom.toISOString(),
    validUntil: row.validUntil.toISOString(),
    normalPriceMinor: row.normalPriceMinor.toString(),
    customerPriceMinor: row.customerPriceMinor.toString(),
    savingsMinor: pricing.savingsMinor.toString(),
    discountRateBps: pricing.discountRateBps.toString(),
  };
}

function eligibleRowsQuery(args: {
  offerId?: string;
  category?: string;
  cluster?: string;
  cursor?: { validUntil: Date; offerId: string };
  limit?: number;
  asOf?: Date;
}) {
  const pilot = getServerEnv().OFFER_PUBLICATION_PILOT_CLUSTER;
  if (!pilot) throw new Error("Publication pilot cluster is unset.");
  const databaseNow = args.asOf
    ? Prisma.sql`${args.asOf}::timestamp`
    : Prisma.sql`(statement_timestamp() AT TIME ZONE 'UTC')`;
  return Prisma.sql`
    SELECT o.id AS "offerId", r.id AS "revisionId", po.id AS "providerId",
      po."nameEn" AS "providerNameEn", po."nameAr" AS "providerNameAr",
      b.id AS "branchId", b."nameEn" AS "branchNameEn", b."nameAr" AS "branchNameAr",
      b.cluster AS "branchCluster", b."streetAddressEn", b."streetAddressAr",
      b."landmarkEn", b."landmarkAr", b.latitude, b.longitude, b."operatingHours",
      r."categoryCode", r."categoryNameEn", r."categoryNameAr",
      r."serviceCode", r."serviceNameEn", r."serviceNameAr", r."serviceScopeEn", r."serviceScopeAr",
      r."titleEn", r."titleAr", r."includedLaborEn", r."includedLaborAr", r."includedPartsEn",
      r."includedPartsAr", r."excludedLaborEn", r."excludedLaborAr", r."excludedPartsEn",
      r."excludedPartsAr", r."bookingRule", r."durationMinutes", r."validFrom", r."validUntil",
      r."normalPriceMinor", r."customerPriceMinor"
    FROM offer_publications pub
    JOIN offers o ON o.id = pub."offerId"
    JOIN offer_revisions r ON r.id = pub."pinnedRevisionId" AND r."offerId" = o.id
    JOIN provider_organizations po ON po.id = o."providerOrganizationId"
    JOIN provider_branches b ON b.id = o."branchId" AND b."providerOrganizationId" = po.id
    JOIN service_definitions sd ON sd.id = r."serviceDefinitionId"
    JOIN service_categories c ON c.id = sd."categoryId"
    WHERE pub.status = 'PUBLISHED'::"OfferPublicationStatus"
      AND r.status = 'APPROVED'::"OfferRevisionStatus"
      AND po.status = 'ACTIVE'::"ProviderStatus"
      AND b.status = 'ACTIVE'::"BranchStatus"
      AND b.cluster = ${pilot}::"CairoCluster"
      AND b."legalIdentityChecked" = true AND b."physicalLocationChecked" = true
      AND b."contactAndHoursChecked" = true AND b."evidenceDocumentRef" IS NOT NULL
      AND b."vettedByUserId" IS NOT NULL AND b."vettedAt" IS NOT NULL
      AND sd."isActive" = true AND c."isActive" = true
      AND sd."pricingMode" = 'FIXED_SCOPE'::"ServicePricingMode"
      AND o."serviceDefinitionId" = r."serviceDefinitionId"
      AND sd.code = r."serviceCode" AND c.code = r."categoryCode"
      AND r."evidenceInspected" = true AND r."priceVerified" = true
      AND r."scopeVerified" = true AND r."providerConsentVerified" = true
      AND r."validFrom" <= ${databaseNow} AND ${databaseNow} < r."validUntil"
      ${args.offerId ? Prisma.sql`AND o.id = ${args.offerId}::uuid` : Prisma.empty}
      ${args.category ? Prisma.sql`AND c.code = ${args.category}` : Prisma.empty}
      ${args.cluster ? Prisma.sql`AND b.cluster = ${args.cluster}::"CairoCluster"` : Prisma.empty}
      ${
        args.cursor
          ? Prisma.sql`AND (r."validUntil", o.id) > (${args.cursor.validUntil}::timestamp, ${args.cursor.offerId}::uuid)`
          : Prisma.empty
      }
    ORDER BY r."validUntil" ASC, o.id ASC
    LIMIT ${args.limit ?? 1}
  `;
}

export async function getPublicOffer(offerId: string, asOf?: Date) {
  if (!discoveryEnabled()) return null;
  const rows = await getPrisma().$queryRaw<PublicOfferRow[]>(
    eligibleRowsQuery({ offerId, asOf, limit: 1 })
  );
  return rows[0] ? mapPublicOffer(rows[0]) : null;
}

export async function listPublicOffers(args: {
  category?: string;
  cluster?: string;
  cursor?: { validUntil: Date; offerId: string };
  limit: number;
  asOf?: Date;
}) {
  if (!discoveryEnabled()) return { items: [], nextCursor: null };
  const rows = await getPrisma().$queryRaw<PublicOfferRow[]>(
    eligibleRowsQuery({ ...args, limit: args.limit + 1 })
  );
  const page = rows.slice(0, args.limit);
  const nextCursor =
    rows.length > args.limit && page.length > 0
      ? Buffer.from(
          JSON.stringify({
            validUntil: page[page.length - 1].validUntil.toISOString(),
            offerId: page[page.length - 1].offerId,
          })
        ).toString("base64url")
      : null;
  return { items: page.map(mapPublicOffer), nextCursor };
}
