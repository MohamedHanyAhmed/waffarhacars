import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/db";
import { discoveryEnabled, eligibleRowsQuery } from "@/lib/publication/discovery";

type CoverageRow = {
  revisionId: string;
  capabilityVersionId: string;
  makeId: string;
  modelId: string;
  makeCode: string;
  makeNameEn: string;
  makeNameAr: string;
  modelCode: string;
  modelNameEn: string;
  modelNameAr: string;
  yearFrom: number;
  yearTo: number;
};
export async function publicCoverageSummary(offerId: string) {
  if (!discoveryEnabled()) return null;
  const rows = await getPrisma().$queryRaw<CoverageRow[]>(Prisma.sql`
    WITH visible AS (${eligibleRowsQuery({ offerId, limit: 1 })})
    SELECT visible."revisionId", cv.id AS "capabilityVersionId",
      vm.id AS "makeId", vm.code AS "makeCode", vm."nameEn" AS "makeNameEn", vm."nameAr" AS "makeNameAr",
      vmo.id AS "modelId", vmo.code AS "modelCode", vmo."nameEn" AS "modelNameEn", vmo."nameAr" AS "modelNameAr",
      GREATEST(ofc."yearFrom",bcc."yearFrom") AS "yearFrom",
      LEAST(ofc."yearTo",bcc."yearTo") AS "yearTo"
    FROM visible
    JOIN offers o ON o.id = visible."offerId"
    JOIN service_definitions sd ON sd.id = o."serviceDefinitionId"
    JOIN branch_capability_current bc ON bc."branchId" = visible."branchId" AND bc."categoryId" = sd."categoryId"
    JOIN branch_capability_versions cv ON cv.id = bc."activeVersionId" AND cv.status = 'ACTIVE'::"BranchCapabilityStatus" AND cv.attested = true
    JOIN offer_fitment_coverage ofc ON ofc."revisionId" = visible."revisionId"
    JOIN branch_capability_coverage bcc ON bcc."versionId" = cv.id AND bcc."modelId" = ofc."modelId"
    JOIN vehicle_makes vm ON vm.id = ofc."makeId" AND vm."isActive" = true
    JOIN vehicle_models vmo ON vmo.id = ofc."modelId" AND vmo."isActive" = true
    WHERE bcc."yearFrom" <= ofc."yearTo" AND ofc."yearFrom" <= bcc."yearTo"
    ORDER BY vm.code,vmo.code,"yearFrom","yearTo"
  `);
  if (rows.length === 0) return null;
  return {
    offerId,
    revisionId: rows[0].revisionId,
    capabilityVersionId: rows[0].capabilityVersionId,
    coverage: rows.map(
      ({
        makeId,
        modelId,
        makeCode,
        makeNameEn,
        makeNameAr,
        modelCode,
        modelNameEn,
        modelNameAr,
        yearFrom,
        yearTo,
      }) => ({
        make: { id: makeId, code: makeCode, nameEn: makeNameEn, nameAr: makeNameAr },
        model: { id: modelId, code: modelCode, nameEn: modelNameEn, nameAr: modelNameAr },
        yearFrom,
        yearTo,
      })
    ),
  };
}

type MatchRow = {
  revisionId: string;
  capabilityVersionId: string;
  capabilityVersion: number;
  vehicleVersion: number;
  catalogAvailable: boolean;
  covered: boolean;
};
export async function ownerOfferMatch(ownerUserId: string, vehicleId: string, offerId: string) {
  if (!discoveryEnabled()) return null;
  const rows = await getPrisma().$queryRaw<MatchRow[]>(Prisma.sql`
    WITH visible AS (${eligibleRowsQuery({ offerId, limit: 1 })}),
      owned AS (
        SELECT v.id,v."makeId",v."modelId",v."modelYear",v.version,
          vm."isActive" AS "makeActive",vmo."isActive" AS "modelActive"
        FROM customer_vehicles v
        JOIN vehicle_makes vm ON vm.id=v."makeId"
        JOIN vehicle_models vmo ON vmo.id=v."modelId" AND vmo."makeId"=v."makeId"
        WHERE v.id=${vehicleId}::uuid AND v."ownerUserId"=${ownerUserId}::uuid AND v."archivedAt" IS NULL
      )
    SELECT visible."revisionId",cv.id AS "capabilityVersionId",cv.version AS "capabilityVersion",
      owned.version AS "vehicleVersion",(owned."makeActive" AND owned."modelActive") AS "catalogAvailable",
      EXISTS (
        SELECT 1 FROM offer_fitment_coverage ofc
        JOIN branch_capability_coverage bcc ON bcc."versionId"=cv.id AND bcc."modelId"=ofc."modelId"
        WHERE ofc."revisionId"=visible."revisionId" AND ofc."makeId"=owned."makeId"
          AND ofc."modelId"=owned."modelId" AND bcc."makeId"=owned."makeId"
          AND ofc."yearFrom"<=owned."modelYear" AND owned."modelYear"<=ofc."yearTo"
          AND bcc."yearFrom"<=owned."modelYear" AND owned."modelYear"<=bcc."yearTo"
      ) AS covered
    FROM visible CROSS JOIN owned
    JOIN offers o ON o.id=visible."offerId"
    JOIN service_definitions sd ON sd.id=o."serviceDefinitionId"
    JOIN branch_capability_current bc ON bc."branchId"=visible."branchId" AND bc."categoryId"=sd."categoryId"
    JOIN branch_capability_versions cv ON cv.id=bc."activeVersionId" AND cv.status='ACTIVE'::"BranchCapabilityStatus" AND cv.attested=true
  `);
  const row = rows[0];
  if (!row) return null;
  const status = !row.catalogAvailable ? "UNKNOWN" : row.covered ? "MATCH" : "NO_MATCH";
  const reason = !row.catalogAvailable
    ? "VEHICLE_CATALOG_INACTIVE"
    : row.covered
      ? "VERIFIED_COVERAGE"
      : "OUTSIDE_VERIFIED_COVERAGE";
  return {
    offerId,
    vehicleId,
    status,
    reason,
    revisionId: row.revisionId,
    vehicleVersion: row.vehicleVersion,
    capabilityVersionId: row.capabilityVersionId,
    capabilityVersion: row.capabilityVersion,
  };
}
