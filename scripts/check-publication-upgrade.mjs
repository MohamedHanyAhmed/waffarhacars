import crypto from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

const url = process.env.DATABASE_DIRECT_URL;
if (!url || process.env.CI !== "true" || new URL(url).pathname !== "/waffarhacars_test") {
  throw new Error(
    "Publication upgrade verification is restricted to the ephemeral CI test database."
  );
}

const migrationsRoot = "prisma/migrations";
const publicationMigration = "20261012120000_offer_publication";
const migrationDirs = (await readdir(migrationsRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const publicationIndex = migrationDirs.indexOf(publicationMigration);
if (publicationIndex < 0) {
  throw new Error("Publication migration is missing from this focused upgrade check.");
}

const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
const schema = `publication_upgrade_${crypto.randomUUID().replaceAll("-", "")}`;
const userId = crypto.randomUUID();
const profileId = crypto.randomUUID();
const sessionId = crypto.randomUUID();
const providerId = crypto.randomUUID();
const branchId = crypto.randomUUID();
const serviceId = crypto.randomUUID();
const offerId = crypto.randomUUID();
const revisionId = crypto.randomUUID();

await client.connect();
try {
  await client.query("BEGIN");
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET LOCAL search_path TO "${schema}", public`);
  for (const name of migrationDirs.slice(0, publicationIndex)) {
    await client.query(await readFile(join(migrationsRoot, name, "migration.sql"), "utf8"));
  }
  await client.query(
    `INSERT INTO "user" (id, name, email, "updatedAt") VALUES ($1, 'Upgrade checker', 'upgrade-check@test.eg', CURRENT_TIMESTAMP)`,
    [userId]
  );
  await client.query(
    `INSERT INTO customer_profile (id, "userId", "updatedAt") VALUES ($1, $2, CURRENT_TIMESTAMP)`,
    [profileId, userId]
  );
  await client.query(
    `INSERT INTO "session" (id, "userId", token, "expiresAt", "lastActivityAt", "updatedAt") VALUES ($1, $2, $3, CURRENT_TIMESTAMP + INTERVAL '1 day', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [sessionId, userId, `upgrade-${sessionId}`]
  );
  await client.query(
    `INSERT INTO provider_organizations
      (id, "nameEn", "nameAr", "legalName", "taxRegistrationNumber", "commercialRegistrationNumber",
       "primaryCluster", status, "contactPersonName", "contactEmail", "contactPhone", "createdByUserId", "updatedAt")
     VALUES ($1, 'Upgrade provider', 'مركز تجريبي', 'Upgrade legal', '123456789', 'UPGRADE-CR',
       'NASR_CITY_HELIOPOLIS', 'ACTIVE', 'Upgrade checker', 'upgrade@test.eg', '+201011112222', $2, CURRENT_TIMESTAMP)`,
    [providerId, userId]
  );
  await client.query(
    `INSERT INTO provider_branches
      (id, "providerOrganizationId", "branchCode", "nameEn", "nameAr", cluster,
       "streetAddressEn", "streetAddressAr", latitude, longitude, "contactPhone", "operatingHours",
       status, "legalIdentityChecked", "physicalLocationChecked", "contactAndHoursChecked",
       "evidenceDocumentRef", "vettedByUserId", "vettedAt", "updatedAt")
     VALUES ($1, $2, 'UPGRADE', 'Upgrade branch', 'فرع تجريبي', 'NASR_CITY_HELIOPOLIS',
       'Test Street 12', 'شارع الاختبار ١٢', 30.060000, 31.340000, '+201011112222',
       '[{"dayOfWeek":1,"openTime":"09:00","closeTime":"17:00","isClosed":false}]'::jsonb,
       'ACTIVE', true, true, true, 'UPGRADE-PACKET', $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [branchId, providerId, userId]
  );
  const category = await client.query(
    `SELECT id FROM service_categories WHERE code = 'EXPRESS_MAINTENANCE'`
  );
  if (category.rowCount !== 1) throw new Error("Baseline category seed missing.");
  await client.query(
    `INSERT INTO service_definitions
      (id, code, "categoryId", "nameEn", "nameAr", "scopeEn", "scopeAr", "pricingMode",
       "createdByUserId", "updatedByUserId", "updatedAt")
     VALUES ($1, 'UPGRADE_SERVICE', $2, 'Upgrade service', 'خدمة تجريبية', 'Fixed scope', 'نطاق ثابت',
       'FIXED_SCOPE', $3, $3, CURRENT_TIMESTAMP)`,
    [serviceId, category.rows[0].id, userId]
  );
  await client.query(
    `INSERT INTO offers
      (id, "providerOrganizationId", "branchId", "serviceDefinitionId", "createdByUserId",
       "creationRequestId", "creationRequestFingerprint", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)`,
    [offerId, providerId, branchId, serviceId, userId, crypto.randomUUID(), "a".repeat(64)]
  );
  await client.query(
    `INSERT INTO offer_revisions
      (id, "offerId", "revisionNumber", status, "requestId", "serviceDefinitionId", "categoryCode",
       "categoryNameEn", "categoryNameAr", "serviceCode", "serviceNameEn", "serviceNameAr",
       "serviceScopeEn", "serviceScopeAr", "titleEn", "titleAr", "includedLaborEn", "includedLaborAr",
       "includedPartsEn", "includedPartsAr", "excludedLaborEn", "excludedLaborAr", "excludedPartsEn",
       "excludedPartsAr", "bookingRule", "durationMinutes", "validFrom", "validUntil", "normalPriceMinor",
       "customerPriceMinor", "evidencePacketId", "evidenceType", "evidenceDate", "priceBasisNotes",
       "commercialTermsPacketId", "commercialTermsAgreedAt", "commissionBasis", "commissionRateBps",
       "createdByUserId", "submittedByUserId", "submittedAt", "decidedByUserId", "decidedAt",
       "evidenceInspected", "priceVerified", "scopeVerified", "providerConsentVerified", "updatedAt")
     VALUES ($1, $2, 1, 'APPROVED', $3, $4, 'EXPRESS_MAINTENANCE', 'Express maintenance', 'الصيانة السريعة',
       'UPGRADE_SERVICE', 'Upgrade service', 'خدمة تجريبية', 'Fixed scope', 'نطاق ثابت', 'Upgrade offer',
       'عرض تجريبي', 'Labor', 'أجور', 'Parts', 'قطع', 'Exclusions', 'استثناءات', 'Other exclusions', 'استثناءات أخرى',
       'APPOINTMENT_REQUIRED', 30, CURRENT_TIMESTAMP - INTERVAL '1 day', CURRENT_TIMESTAMP + INTERVAL '1 day',
       100000, 80000, 'UPGRADE-EVIDENCE', 'PROVIDER_PRICE_LIST', CURRENT_TIMESTAMP - INTERVAL '1 day',
       'Documented price basis', 'UPGRADE-TERMS', CURRENT_TIMESTAMP - INTERVAL '1 day',
       'DISCOUNTED_CUSTOMER_PRICE', 0, $5, $5, CURRENT_TIMESTAMP, $5, CURRENT_TIMESTAMP,
       true, true, true, true, CURRENT_TIMESTAMP)`,
    [revisionId, offerId, crypto.randomUUID(), serviceId, userId]
  );
  await client.query(`UPDATE offers SET "currentApprovedRevisionId" = $1 WHERE id = $2`, [
    revisionId,
    offerId,
  ]);
  const before = await client.query(
    `SELECT o."currentApprovedRevisionId", r.status, r."customerPriceMinor"::text AS price
       FROM offers o JOIN offer_revisions r ON r.id = o."currentApprovedRevisionId" WHERE o.id = $1`,
    [offerId]
  );
  await client.query(
    await readFile(join(migrationsRoot, publicationMigration, "migration.sql"), "utf8")
  );
  const after = await client.query(
    `SELECT o."currentApprovedRevisionId", r.status, r."customerPriceMinor"::text AS price
       FROM offers o JOIN offer_revisions r ON r.id = o."currentApprovedRevisionId" WHERE o.id = $1`,
    [offerId]
  );
  const publications = await client.query(`SELECT count(*)::int AS count FROM offer_publications`);
  const commands = await client.query(
    `SELECT count(*)::int AS count FROM offer_publication_commands`
  );
  if (
    before.rowCount !== 1 ||
    after.rowCount !== 1 ||
    JSON.stringify(before.rows) !== JSON.stringify(after.rows) ||
    after.rows[0].status !== "APPROVED" ||
    publications.rows[0].count !== 0 ||
    commands.rows[0].count !== 0
  ) {
    throw new Error(
      "Publication migration changed an existing approved offer or backfilled visibility."
    );
  }
  // Later additive migrations must preserve the same approved offer and the explicit
  // absence of publication backfill. This check remains anchored at publication.
  for (const name of migrationDirs.slice(publicationIndex + 1)) {
    await client.query(await readFile(join(migrationsRoot, name, "migration.sql"), "utf8"));
  }
  const afterLater = await client.query(
    `SELECT o."currentApprovedRevisionId", r.status, r."customerPriceMinor"::text AS price
       FROM offers o JOIN offer_revisions r ON r.id = o."currentApprovedRevisionId" WHERE o.id = $1`,
    [offerId]
  );
  if (JSON.stringify(afterLater.rows) !== JSON.stringify(before.rows)) {
    throw new Error("A later migration changed the existing approved offer.");
  }
  const identity = await client.query(
    `SELECT u.id, p.id AS profile_id, s.id AS session_id FROM "user" u
     JOIN customer_profile p ON p."userId" = u.id JOIN "session" s ON s."userId" = u.id
     WHERE u.id = $1`,
    [userId]
  );
  if (
    identity.rowCount !== 1 ||
    identity.rows[0].profile_id !== profileId ||
    identity.rows[0].session_id !== sessionId
  ) {
    throw new Error("A later migration changed an existing user, customer profile, or session.");
  }
  console.log(
    "Publication and later upgrade check passed: approved offer preserved; no publication backfill."
  );
} finally {
  await client.query("ROLLBACK").catch(() => {});
  await client.end();
}
