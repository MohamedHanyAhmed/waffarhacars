CREATE TYPE "ServicePricingMode" AS ENUM ('FIXED_SCOPE', 'QUOTE_REQUIRED');
CREATE TYPE "OfferRevisionStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED');
CREATE TYPE "OfferBookingRule" AS ENUM ('APPOINTMENT_REQUIRED', 'WALK_IN_ALLOWED', 'CONTACT_TO_BOOK');
CREATE TYPE "OfferEvidenceType" AS ENUM ('PROVIDER_PRICE_LIST', 'WRITTEN_QUOTE', 'PROVIDER_WRITTEN_CONFIRMATION', 'OTHER');
CREATE TYPE "OfferCommissionBasis" AS ENUM ('DISCOUNTED_CUSTOMER_PRICE');

CREATE TABLE "service_categories" (
    "id" UUID NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
    "code" VARCHAR(48) NOT NULL,
    "nameEn" VARCHAR(100) NOT NULL,
    "nameAr" VARCHAR(100) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "service_categories_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "service_categories_code_format_check" CHECK ("code" ~ '^[A-Z][A-Z0-9_]{1,47}$'),
    CONSTRAINT "service_categories_names_nonempty_check" CHECK (length(btrim("nameEn")) > 0 AND length(btrim("nameAr")) > 0)
);

CREATE TABLE "service_definitions" (
    "id" UUID NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
    "code" VARCHAR(64) NOT NULL,
    "categoryId" UUID NOT NULL,
    "nameEn" VARCHAR(160) NOT NULL,
    "nameAr" VARCHAR(160) NOT NULL,
    "scopeEn" VARCHAR(1000) NOT NULL,
    "scopeAr" VARCHAR(1000) NOT NULL,
    "pricingMode" "ServicePricingMode" NOT NULL,
    "itemSku" VARCHAR(80),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" UUID NOT NULL,
    "updatedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "service_definitions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "service_definitions_code_format_check" CHECK ("code" ~ '^[A-Z][A-Z0-9_]{1,63}$'),
    CONSTRAINT "service_definitions_names_scope_nonempty_check" CHECK (
      length(btrim("nameEn")) > 0 AND length(btrim("nameAr")) > 0 AND
      length(btrim("scopeEn")) > 0 AND length(btrim("scopeAr")) > 0 AND "version" > 0
    )
);

CREATE TABLE "offers" (
    "id" UUID NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
    "providerOrganizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "serviceDefinitionId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "currentApprovedRevisionId" UUID,
    "nextRevisionNumber" INTEGER NOT NULL DEFAULT 2,
    "creationRequestId" UUID NOT NULL,
    "creationRequestFingerprint" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "offers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "offers_revision_counter_check" CHECK ("nextRevisionNumber" > 1),
    CONSTRAINT "offers_creation_fingerprint_check" CHECK ("creationRequestFingerprint" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE "offer_revisions" (
    "id" UUID NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
    "offerId" UUID NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "status" "OfferRevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "requestId" UUID NOT NULL,
    "serviceDefinitionId" UUID NOT NULL,
    "categoryCode" VARCHAR(48) NOT NULL,
    "categoryNameEn" VARCHAR(100) NOT NULL,
    "categoryNameAr" VARCHAR(100) NOT NULL,
    "serviceCode" VARCHAR(64) NOT NULL,
    "serviceNameEn" VARCHAR(160) NOT NULL,
    "serviceNameAr" VARCHAR(160) NOT NULL,
    "serviceScopeEn" VARCHAR(1000) NOT NULL,
    "serviceScopeAr" VARCHAR(1000) NOT NULL,
    "titleEn" VARCHAR(160) NOT NULL,
    "titleAr" VARCHAR(160) NOT NULL,
    "includedLaborEn" VARCHAR(1000) NOT NULL,
    "includedLaborAr" VARCHAR(1000) NOT NULL,
    "includedPartsEn" VARCHAR(1000) NOT NULL,
    "includedPartsAr" VARCHAR(1000) NOT NULL,
    "excludedLaborEn" VARCHAR(1000) NOT NULL,
    "excludedLaborAr" VARCHAR(1000) NOT NULL,
    "excludedPartsEn" VARCHAR(1000) NOT NULL,
    "excludedPartsAr" VARCHAR(1000) NOT NULL,
    "bookingRule" "OfferBookingRule" NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "normalPriceMinor" BIGINT NOT NULL,
    "customerPriceMinor" BIGINT NOT NULL,
    "evidencePacketId" VARCHAR(64) NOT NULL,
    "evidenceType" "OfferEvidenceType" NOT NULL,
    "evidenceDate" TIMESTAMP(3) NOT NULL,
    "priceBasisNotes" VARCHAR(1000) NOT NULL,
    "commercialTermsPacketId" VARCHAR(64) NOT NULL,
    "commercialTermsAgreedAt" TIMESTAMP(3) NOT NULL,
    "commissionBasis" "OfferCommissionBasis" NOT NULL,
    "commissionRateBps" INTEGER NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "submittedByUserId" UUID,
    "submittedAt" TIMESTAMP(3),
    "decidedByUserId" UUID,
    "decidedAt" TIMESTAMP(3),
    "rejectionReason" VARCHAR(1000),
    "evidenceInspected" BOOLEAN NOT NULL DEFAULT false,
    "priceVerified" BOOLEAN NOT NULL DEFAULT false,
    "scopeVerified" BOOLEAN NOT NULL DEFAULT false,
    "providerConsentVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "offer_revisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "offer_revisions_positive_sequence_check" CHECK ("revisionNumber" > 0 AND "version" > 0),
    CONSTRAINT "offer_revisions_scope_window_check" CHECK (
      "durationMinutes" BETWEEN 1 AND 1440 AND "validUntil" > "validFrom"
    ),
    CONSTRAINT "offer_revisions_price_check" CHECK (
      "normalPriceMinor" > 0 AND "customerPriceMinor" > 0 AND "customerPriceMinor" < "normalPriceMinor"
    ),
    CONSTRAINT "offer_revisions_commission_check" CHECK ("commissionRateBps" BETWEEN 0 AND 10000),
    CONSTRAINT "offer_revisions_packet_id_check" CHECK (
      "evidencePacketId" ~ '^[A-Za-z0-9_-]{3,64}$' AND "commercialTermsPacketId" ~ '^[A-Za-z0-9_-]{3,64}$'
    ),
    CONSTRAINT "offer_revisions_required_text_check" CHECK (
      length(btrim("serviceCode")) > 0 AND length(btrim("serviceNameEn")) > 0 AND
      length(btrim("categoryCode")) > 0 AND length(btrim("categoryNameEn")) > 0 AND length(btrim("categoryNameAr")) > 0 AND
      length(btrim("serviceNameAr")) > 0 AND length(btrim("serviceScopeEn")) > 0 AND
      length(btrim("serviceScopeAr")) > 0 AND length(btrim("titleEn")) > 0 AND
      length(btrim("titleAr")) > 0 AND length(btrim("priceBasisNotes")) > 0
    ),
    CONSTRAINT "offer_revisions_lifecycle_check" CHECK (
      ("status" = 'DRAFT' AND "submittedByUserId" IS NULL AND "submittedAt" IS NULL AND "decidedByUserId" IS NULL AND "decidedAt" IS NULL AND "rejectionReason" IS NULL AND NOT "evidenceInspected" AND NOT "priceVerified" AND NOT "scopeVerified" AND NOT "providerConsentVerified") OR
      ("status" = 'PENDING_REVIEW' AND "submittedByUserId" IS NOT NULL AND "submittedAt" IS NOT NULL AND "decidedByUserId" IS NULL AND "decidedAt" IS NULL AND "rejectionReason" IS NULL AND NOT "evidenceInspected" AND NOT "priceVerified" AND NOT "scopeVerified" AND NOT "providerConsentVerified") OR
      ("status" = 'APPROVED' AND "submittedByUserId" IS NOT NULL AND "submittedAt" IS NOT NULL AND "decidedByUserId" IS NOT NULL AND "decidedAt" IS NOT NULL AND "rejectionReason" IS NULL AND "evidenceInspected" AND "priceVerified" AND "scopeVerified" AND "providerConsentVerified") OR
      ("status" = 'REJECTED' AND "submittedByUserId" IS NOT NULL AND "submittedAt" IS NOT NULL AND "decidedByUserId" IS NOT NULL AND "decidedAt" IS NOT NULL AND "rejectionReason" IS NOT NULL AND NOT "evidenceInspected" AND NOT "priceVerified" AND NOT "scopeVerified" AND NOT "providerConsentVerified")
    )
);

CREATE UNIQUE INDEX "service_categories_code_key" ON "service_categories"("code");
CREATE INDEX "service_categories_isActive_sortOrder_idx" ON "service_categories"("isActive", "sortOrder");
CREATE UNIQUE INDEX "service_definitions_code_key" ON "service_definitions"("code");
CREATE INDEX "service_definitions_categoryId_isActive_nameEn_idx" ON "service_definitions"("categoryId", "isActive", "nameEn");
CREATE UNIQUE INDEX "offers_creationRequestId_key" ON "offers"("creationRequestId");
CREATE UNIQUE INDEX "offers_id_providerOrganizationId_key" ON "offers"("id", "providerOrganizationId");
CREATE INDEX "offers_providerOrganizationId_branchId_createdAt_idx" ON "offers"("providerOrganizationId", "branchId", "createdAt");
CREATE UNIQUE INDEX "offer_revisions_requestId_key" ON "offer_revisions"("requestId");
CREATE UNIQUE INDEX "offer_revisions_offerId_revisionNumber_key" ON "offer_revisions"("offerId", "revisionNumber");
CREATE UNIQUE INDEX "offer_revisions_id_offerId_key" ON "offer_revisions"("id", "offerId");
CREATE INDEX "offer_revisions_status_createdAt_idx" ON "offer_revisions"("status", "createdAt");
CREATE INDEX "offer_revisions_offerId_status_idx" ON "offer_revisions"("offerId", "status");

CREATE UNIQUE INDEX "provider_branches_id_providerOrganizationId_key" ON "provider_branches"("id", "providerOrganizationId");

ALTER TABLE "service_definitions" ADD CONSTRAINT "service_definitions_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "service_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_definitions" ADD CONSTRAINT "service_definitions_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_definitions" ADD CONSTRAINT "service_definitions_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offers" ADD CONSTRAINT "offers_providerOrganizationId_fkey" FOREIGN KEY ("providerOrganizationId") REFERENCES "provider_organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offers" ADD CONSTRAINT "offers_branchId_providerOrganizationId_fkey" FOREIGN KEY ("branchId", "providerOrganizationId") REFERENCES "provider_branches"("id", "providerOrganizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offers" ADD CONSTRAINT "offers_serviceDefinitionId_fkey" FOREIGN KEY ("serviceDefinitionId") REFERENCES "service_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offers" ADD CONSTRAINT "offers_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offer_revisions" ADD CONSTRAINT "offer_revisions_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offer_revisions" ADD CONSTRAINT "offer_revisions_serviceDefinitionId_fkey" FOREIGN KEY ("serviceDefinitionId") REFERENCES "service_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offer_revisions" ADD CONSTRAINT "offer_revisions_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offer_revisions" ADD CONSTRAINT "offer_revisions_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offer_revisions" ADD CONSTRAINT "offer_revisions_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offers" ADD CONSTRAINT "offers_currentApprovedRevisionId_offerId_fkey" FOREIGN KEY ("currentApprovedRevisionId", "id") REFERENCES "offer_revisions"("id", "offerId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_offer_revision_mutation_after_submission()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."status" IN ('APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION 'terminal offer revision is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."status" = 'DRAFT' AND NEW."status" NOT IN ('DRAFT', 'PENDING_REVIEW') THEN
    RAISE EXCEPTION 'invalid offer revision transition from draft' USING ERRCODE = '23514';
  END IF;
  IF OLD."status" = 'PENDING_REVIEW' AND NEW."status" NOT IN ('APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION 'invalid offer revision transition from pending review' USING ERRCODE = '23514';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'offer revision version must increase exactly once' USING ERRCODE = '23514';
  END IF;
  IF (OLD."status" = 'PENDING_REVIEW' OR (OLD."status" = 'DRAFT' AND NEW."status" = 'PENDING_REVIEW')) AND (
    NEW."offerId" IS DISTINCT FROM OLD."offerId" OR
    NEW."revisionNumber" IS DISTINCT FROM OLD."revisionNumber" OR
    NEW."requestId" IS DISTINCT FROM OLD."requestId" OR
    NEW."serviceDefinitionId" IS DISTINCT FROM OLD."serviceDefinitionId" OR
    NEW."categoryCode" IS DISTINCT FROM OLD."categoryCode" OR
    NEW."categoryNameEn" IS DISTINCT FROM OLD."categoryNameEn" OR
    NEW."categoryNameAr" IS DISTINCT FROM OLD."categoryNameAr" OR
    NEW."serviceCode" IS DISTINCT FROM OLD."serviceCode" OR
    NEW."serviceNameEn" IS DISTINCT FROM OLD."serviceNameEn" OR
    NEW."serviceNameAr" IS DISTINCT FROM OLD."serviceNameAr" OR
    NEW."serviceScopeEn" IS DISTINCT FROM OLD."serviceScopeEn" OR
    NEW."serviceScopeAr" IS DISTINCT FROM OLD."serviceScopeAr" OR
    NEW."titleEn" IS DISTINCT FROM OLD."titleEn" OR
    NEW."titleAr" IS DISTINCT FROM OLD."titleAr" OR
    NEW."includedLaborEn" IS DISTINCT FROM OLD."includedLaborEn" OR
    NEW."includedLaborAr" IS DISTINCT FROM OLD."includedLaborAr" OR
    NEW."includedPartsEn" IS DISTINCT FROM OLD."includedPartsEn" OR
    NEW."includedPartsAr" IS DISTINCT FROM OLD."includedPartsAr" OR
    NEW."excludedLaborEn" IS DISTINCT FROM OLD."excludedLaborEn" OR
    NEW."excludedLaborAr" IS DISTINCT FROM OLD."excludedLaborAr" OR
    NEW."excludedPartsEn" IS DISTINCT FROM OLD."excludedPartsEn" OR
    NEW."excludedPartsAr" IS DISTINCT FROM OLD."excludedPartsAr" OR
    NEW."bookingRule" IS DISTINCT FROM OLD."bookingRule" OR
    NEW."durationMinutes" IS DISTINCT FROM OLD."durationMinutes" OR
    NEW."validFrom" IS DISTINCT FROM OLD."validFrom" OR
    NEW."validUntil" IS DISTINCT FROM OLD."validUntil" OR
    NEW."normalPriceMinor" IS DISTINCT FROM OLD."normalPriceMinor" OR
    NEW."customerPriceMinor" IS DISTINCT FROM OLD."customerPriceMinor" OR
    NEW."evidencePacketId" IS DISTINCT FROM OLD."evidencePacketId" OR
    NEW."evidenceType" IS DISTINCT FROM OLD."evidenceType" OR
    NEW."evidenceDate" IS DISTINCT FROM OLD."evidenceDate" OR
    NEW."priceBasisNotes" IS DISTINCT FROM OLD."priceBasisNotes" OR
    NEW."commercialTermsPacketId" IS DISTINCT FROM OLD."commercialTermsPacketId" OR
    NEW."commercialTermsAgreedAt" IS DISTINCT FROM OLD."commercialTermsAgreedAt" OR
    NEW."commissionBasis" IS DISTINCT FROM OLD."commissionBasis" OR
    NEW."commissionRateBps" IS DISTINCT FROM OLD."commissionRateBps" OR
    NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId" OR
    NEW."submittedByUserId" IS DISTINCT FROM OLD."submittedByUserId" OR
    NEW."submittedAt" IS DISTINCT FROM OLD."submittedAt"
  ) THEN
    RAISE EXCEPTION 'pending offer revision content is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "offer_revisions_immutable_after_submission"
BEFORE UPDATE ON "offer_revisions"
FOR EACH ROW EXECUTE FUNCTION prevent_offer_revision_mutation_after_submission();

CREATE OR REPLACE FUNCTION prevent_offer_creation_identity_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."creationRequestId" IS DISTINCT FROM OLD."creationRequestId" OR
     NEW."creationRequestFingerprint" IS DISTINCT FROM OLD."creationRequestFingerprint" OR
     NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId" THEN
    RAISE EXCEPTION 'offer creation identity is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "offers_creation_identity_immutable"
BEFORE UPDATE OF "creationRequestId", "creationRequestFingerprint", "createdByUserId" ON "offers"
FOR EACH ROW EXECUTE FUNCTION prevent_offer_creation_identity_mutation();

CREATE OR REPLACE FUNCTION validate_current_offer_revision()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."currentApprovedRevisionId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "offer_revisions"
    WHERE "id" = NEW."currentApprovedRevisionId"
      AND "offerId" = NEW."id"
      AND "status" = 'APPROVED'
  ) THEN
    RAISE EXCEPTION 'current offer revision must be approved for this offer' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "offers_current_revision_must_be_approved"
BEFORE INSERT OR UPDATE OF "currentApprovedRevisionId" ON "offers"
FOR EACH ROW EXECUTE FUNCTION validate_current_offer_revision();

INSERT INTO "service_categories" ("code", "nameEn", "nameAr", "sortOrder", "updatedAt") VALUES
  ('EXPRESS_MAINTENANCE', 'Express maintenance', 'الصيانة السريعة', 10, CURRENT_TIMESTAMP),
  ('GENERAL_REPAIRS', 'General repairs', 'الإصلاحات العامة', 20, CURRENT_TIMESTAMP),
  ('CAR_WASH', 'Car wash', 'غسيل السيارات', 30, CURRENT_TIMESTAMP),
  ('ACCESSORIES', 'Accessories', 'الإكسسوارات', 40, CURRENT_TIMESTAMP);
