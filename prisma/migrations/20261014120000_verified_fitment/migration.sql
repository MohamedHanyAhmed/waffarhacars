-- Additive fitment foundation. Existing revisions remain unassessed (NULL mode).
CREATE TYPE "OfferFitmentMode" AS ENUM ('BASE_VEHICLE_ALL_VARIANTS_VERIFIED', 'SERVICE_VEHICLE_INDEPENDENT_WITHIN_LISTED_COVERAGE');
CREATE TYPE "BranchCapabilityStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'REJECTED', 'WITHDRAWN');

ALTER TABLE "offer_revisions"
  ADD COLUMN "fitmentMode" "OfferFitmentMode",
  ADD COLUMN "fitmentEvidenceRef" VARCHAR(128),
  ADD COLUMN "fitmentAllVariantsAttested" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "fitmentScopePriceAttested" BOOLEAN NOT NULL DEFAULT false,
  ADD CONSTRAINT "offer_revisions_fitment_evidence_check" CHECK (
    ("fitmentMode" IS NULL AND "fitmentEvidenceRef" IS NULL AND NOT "fitmentAllVariantsAttested" AND NOT "fitmentScopePriceAttested") OR
    ("fitmentMode" IS NOT NULL AND "fitmentEvidenceRef" ~ '^[A-Za-z0-9_-]{3,128}$')
  );

CREATE TABLE "offer_fitment_coverage" (
  "id" UUID NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  "revisionId" UUID NOT NULL,
  "makeId" UUID NOT NULL,
  "modelId" UUID NOT NULL,
  "yearFrom" INTEGER NOT NULL,
  "yearTo" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "offer_fitment_coverage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "offer_fitment_coverage_year_check" CHECK ("yearFrom" BETWEEN 1900 AND 2200 AND "yearTo" BETWEEN "yearFrom" AND 2200),
  CONSTRAINT "offer_fitment_coverage_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "offer_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "offer_fitment_coverage_makeId_fkey" FOREIGN KEY ("makeId") REFERENCES "vehicle_makes"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "offer_fitment_coverage_modelId_makeId_fkey" FOREIGN KEY ("modelId", "makeId") REFERENCES "vehicle_models"("id", "makeId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "offer_fitment_coverage_revisionId_modelId_yearFrom_yearTo_idx" ON "offer_fitment_coverage"("revisionId", "modelId", "yearFrom", "yearTo");

CREATE TABLE "branch_capability_versions" (
  "id" UUID NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  "branchId" UUID NOT NULL,
  "categoryId" UUID NOT NULL,
  "sequenceNumber" INTEGER NOT NULL,
  "status" "BranchCapabilityStatus" NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 1,
  "evidenceRef" VARCHAR(128),
  "attested" BOOLEAN NOT NULL DEFAULT false,
  "createdByUserId" UUID NOT NULL,
  "submittedByUserId" UUID,
  "submittedAt" TIMESTAMP(3),
  "decidedByUserId" UUID,
  "decidedAt" TIMESTAMP(3),
  "rejectionReason" VARCHAR(1000),
  "withdrawnAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "branch_capability_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "branch_capability_versions_shape_check" CHECK (
    "sequenceNumber" > 0 AND "version" > 0 AND
    ("evidenceRef" IS NULL OR "evidenceRef" ~ '^[A-Za-z0-9_-]{3,128}$')
  ),
  CONSTRAINT "branch_capability_versions_state_check" CHECK (
    ("status" = 'DRAFT' AND "submittedByUserId" IS NULL AND "submittedAt" IS NULL AND "decidedByUserId" IS NULL AND "decidedAt" IS NULL AND "rejectionReason" IS NULL AND "withdrawnAt" IS NULL AND NOT "attested") OR
    ("status" = 'PENDING_REVIEW' AND "submittedByUserId" IS NOT NULL AND "submittedAt" IS NOT NULL AND "decidedByUserId" IS NULL AND "decidedAt" IS NULL AND "rejectionReason" IS NULL AND "withdrawnAt" IS NULL AND NOT "attested") OR
    ("status" = 'ACTIVE' AND "submittedByUserId" IS NOT NULL AND "submittedAt" IS NOT NULL AND "decidedByUserId" IS NOT NULL AND "decidedAt" IS NOT NULL AND "rejectionReason" IS NULL AND "withdrawnAt" IS NULL AND "attested") OR
    ("status" = 'REJECTED' AND "submittedByUserId" IS NOT NULL AND "submittedAt" IS NOT NULL AND "decidedByUserId" IS NOT NULL AND "decidedAt" IS NOT NULL AND "rejectionReason" IS NOT NULL AND "withdrawnAt" IS NULL AND NOT "attested") OR
    ("status" = 'WITHDRAWN' AND "submittedByUserId" IS NOT NULL AND "submittedAt" IS NOT NULL AND "decidedByUserId" IS NOT NULL AND "decidedAt" IS NOT NULL AND "rejectionReason" IS NULL AND "withdrawnAt" IS NOT NULL AND "attested")
  ),
  CONSTRAINT "branch_capability_versions_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "provider_branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "branch_capability_versions_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "service_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "branch_capability_versions_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "branch_capability_versions_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "branch_capability_versions_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "branch_capability_versions_branchId_categoryId_sequenceNumber_key" ON "branch_capability_versions"("branchId", "categoryId", "sequenceNumber");
CREATE UNIQUE INDEX "branch_capability_versions_id_branchId_categoryId_key" ON "branch_capability_versions"("id", "branchId", "categoryId");
CREATE UNIQUE INDEX "branch_capability_versions_one_active_key" ON "branch_capability_versions"("branchId", "categoryId") WHERE "status" = 'ACTIVE';
CREATE INDEX "branch_capability_versions_branchId_categoryId_status_idx" ON "branch_capability_versions"("branchId", "categoryId", "status");

CREATE TABLE "branch_capability_coverage" (
  "id" UUID NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  "versionId" UUID NOT NULL,
  "makeId" UUID NOT NULL,
  "modelId" UUID NOT NULL,
  "yearFrom" INTEGER NOT NULL,
  "yearTo" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "branch_capability_coverage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "branch_capability_coverage_year_check" CHECK ("yearFrom" BETWEEN 1900 AND 2200 AND "yearTo" BETWEEN "yearFrom" AND 2200),
  CONSTRAINT "branch_capability_coverage_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "branch_capability_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "branch_capability_coverage_makeId_fkey" FOREIGN KEY ("makeId") REFERENCES "vehicle_makes"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "branch_capability_coverage_modelId_makeId_fkey" FOREIGN KEY ("modelId", "makeId") REFERENCES "vehicle_models"("id", "makeId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "branch_capability_coverage_versionId_modelId_yearFrom_yearTo_idx" ON "branch_capability_coverage"("versionId", "modelId", "yearFrom", "yearTo");

CREATE TABLE "branch_capability_current" (
  "branchId" UUID NOT NULL,
  "categoryId" UUID NOT NULL,
  "activeVersionId" UUID,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "branch_capability_current_pkey" PRIMARY KEY ("branchId", "categoryId"),
  CONSTRAINT "branch_capability_current_version_check" CHECK ("version" > 0),
  CONSTRAINT "branch_capability_current_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "provider_branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "branch_capability_current_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "service_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "branch_capability_current_activeVersionId_branchId_categoryId_fkey" FOREIGN KEY ("activeVersionId", "branchId", "categoryId") REFERENCES "branch_capability_versions"("id", "branchId", "categoryId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "branch_capability_current_activeVersionId_idx" ON "branch_capability_current"("activeVersionId");

CREATE TABLE "fitment_commands" (
  "commandId" UUID NOT NULL,
  "actorUserId" UUID NOT NULL,
  "domain" VARCHAR(16) NOT NULL,
  "action" VARCHAR(32) NOT NULL,
  "resourceId" UUID NOT NULL,
  "fingerprint" VARCHAR(64) NOT NULL,
  "outcome" VARCHAR(16) NOT NULL,
  "httpStatus" INTEGER NOT NULL,
  "errorCode" VARCHAR(64),
  "resultVersion" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fitment_commands_pkey" PRIMARY KEY ("commandId"),
  CONSTRAINT "fitment_commands_shape_check" CHECK (
    "domain" IN ('FITMENT', 'CAPABILITY') AND "action" ~ '^[A-Z_]{3,32}$' AND
    "fingerprint" ~ '^[0-9a-f]{64}$' AND "outcome" = 'APPLIED' AND
    "httpStatus" IN (200, 201) AND "errorCode" IS NULL AND "resultVersion" > 0
  ),
  CONSTRAINT "fitment_commands_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "fitment_commands_actorUserId_domain_resourceId_createdAt_idx" ON "fitment_commands"("actorUserId", "domain", "resourceId", "createdAt");

-- A child takes its parent lock first. Submit/approval takes that same lock, so
-- a concurrent child edit cannot sneak across the draft/pending boundary.
CREATE FUNCTION guard_fitment_coverage() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  parent_status "OfferRevisionStatus";
  target_revision UUID;
  target_id UUID;
  target_model UUID;
  lower_year INTEGER;
  upper_year INTEGER;
  max_cairo_year INTEGER;
BEGIN
  target_revision := CASE WHEN TG_OP = 'DELETE' THEN OLD."revisionId" ELSE NEW."revisionId" END;
  IF TG_OP = 'UPDATE' AND (
    NEW."id" IS DISTINCT FROM OLD."id" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" OR
    NEW."revisionId" IS DISTINCT FROM OLD."revisionId"
  ) THEN
    RAISE EXCEPTION 'fitment coverage parent is immutable' USING ERRCODE = '23514';
  END IF;
  SELECT "status" INTO parent_status FROM "offer_revisions" WHERE "id" = target_revision FOR UPDATE;
  IF parent_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'fitment coverage is not draft' USING ERRCODE = '23514';
  END IF;
  IF TG_OP <> 'DELETE' THEN
    target_id := NEW."id";
    target_model := NEW."modelId";
    lower_year := NEW."yearFrom";
    upper_year := NEW."yearTo";
    max_cairo_year := EXTRACT(YEAR FROM (CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Cairo'))::INTEGER + 1;
    IF lower_year > max_cairo_year OR upper_year > max_cairo_year THEN
      RAISE EXCEPTION 'fitment coverage future year exceeds Cairo limit' USING ERRCODE = '23514';
    END IF;
    IF (SELECT count(*) FROM "offer_fitment_coverage" WHERE "revisionId" = target_revision AND "id" <> target_id) >= 50 AND TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'fitment coverage row limit' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM "offer_fitment_coverage" WHERE "revisionId" = target_revision AND "modelId" = target_model AND "id" <> target_id AND "yearFrom" <= upper_year AND "yearTo" >= lower_year) THEN
      RAISE EXCEPTION 'overlapping fitment coverage' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "offer_fitment_coverage_guard" BEFORE INSERT OR UPDATE OR DELETE ON "offer_fitment_coverage" FOR EACH ROW EXECUTE FUNCTION guard_fitment_coverage();

CREATE FUNCTION guard_capability_coverage() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  parent_status "BranchCapabilityStatus";
  target_version UUID;
  max_cairo_year INTEGER;
BEGIN
  target_version := CASE WHEN TG_OP = 'DELETE' THEN OLD."versionId" ELSE NEW."versionId" END;
  IF TG_OP = 'UPDATE' AND (
    NEW."id" IS DISTINCT FROM OLD."id" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" OR
    NEW."versionId" IS DISTINCT FROM OLD."versionId"
  ) THEN
    RAISE EXCEPTION 'capability coverage parent is immutable' USING ERRCODE = '23514';
  END IF;
  SELECT "status" INTO parent_status FROM "branch_capability_versions" WHERE "id" = target_version FOR UPDATE;
  IF parent_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'capability coverage is not draft' USING ERRCODE = '23514';
  END IF;
  IF TG_OP <> 'DELETE' THEN
    max_cairo_year := EXTRACT(YEAR FROM (CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Cairo'))::INTEGER + 1;
    IF NEW."yearFrom" > max_cairo_year OR NEW."yearTo" > max_cairo_year THEN
      RAISE EXCEPTION 'capability coverage future year exceeds Cairo limit' USING ERRCODE = '23514';
    END IF;
    IF (SELECT count(*) FROM "branch_capability_coverage" WHERE "versionId" = target_version AND "id" <> NEW."id") >= 50 AND TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'capability coverage row limit' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM "branch_capability_coverage" WHERE "versionId" = target_version AND "modelId" = NEW."modelId" AND "id" <> NEW."id" AND "yearFrom" <= NEW."yearTo" AND "yearTo" >= NEW."yearFrom") THEN
      RAISE EXCEPTION 'overlapping capability coverage' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "branch_capability_coverage_guard" BEFORE INSERT OR UPDATE OR DELETE ON "branch_capability_coverage" FOR EACH ROW EXECUTE FUNCTION guard_capability_coverage();

CREATE FUNCTION guard_offer_fitment_transition() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" <> 'DRAFT' OR NEW."status" <> 'DRAFT' THEN
    IF NEW."fitmentMode" IS DISTINCT FROM OLD."fitmentMode" OR NEW."fitmentEvidenceRef" IS DISTINCT FROM OLD."fitmentEvidenceRef" THEN
      RAISE EXCEPTION 'submitted fitment content is immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW."fitmentAllVariantsAttested" IS DISTINCT FROM OLD."fitmentAllVariantsAttested" OR NEW."fitmentScopePriceAttested" IS DISTINCT FROM OLD."fitmentScopePriceAttested" THEN
    IF NOT (OLD."status" = 'PENDING_REVIEW' AND NEW."status" = 'APPROVED' AND NEW."fitmentAllVariantsAttested" AND NEW."fitmentScopePriceAttested") THEN
      RAISE EXCEPTION 'fitment attestation requires approval' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF OLD."status" = 'DRAFT' AND NEW."status" = 'PENDING_REVIEW' THEN
    IF NEW."fitmentMode" IS NULL OR NEW."fitmentEvidenceRef" IS NULL OR NOT EXISTS (SELECT 1 FROM "offer_fitment_coverage" WHERE "revisionId" = NEW."id") THEN
      RAISE EXCEPTION 'fitment assessment and coverage required for submission' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF OLD."status" = 'PENDING_REVIEW' AND NEW."status" = 'APPROVED' THEN
    IF NEW."fitmentMode" IS NULL OR NOT NEW."fitmentAllVariantsAttested" OR NOT NEW."fitmentScopePriceAttested" OR NEW."decidedByUserId" = NEW."createdByUserId" OR NEW."decidedByUserId" = NEW."submittedByUserId" THEN
      RAISE EXCEPTION 'fitment checker approval invalid' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "offer_revision_fitment_transition_guard" BEFORE UPDATE ON "offer_revisions" FOR EACH ROW EXECUTE FUNCTION guard_offer_fitment_transition();

-- Legacy terminal rows are preserved, but newly assessed terminal content must
-- travel through draft submission and checker approval rather than direct INSERT.
CREATE FUNCTION guard_offer_fitment_insert() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" = 'DRAFT' AND (NEW."fitmentAllVariantsAttested" OR NEW."fitmentScopePriceAttested") THEN
    RAISE EXCEPTION 'draft fitment cannot be attested' USING ERRCODE = '23514';
  END IF;
  IF NEW."status" <> 'DRAFT' AND (
    NEW."fitmentMode" IS NOT NULL OR NEW."fitmentEvidenceRef" IS NOT NULL OR
    NEW."fitmentAllVariantsAttested" OR NEW."fitmentScopePriceAttested"
  ) THEN
    RAISE EXCEPTION 'assessed fitment requires draft lifecycle' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "offer_revision_fitment_insert_guard" BEFORE INSERT ON "offer_revisions" FOR EACH ROW EXECUTE FUNCTION guard_offer_fitment_insert();

CREATE FUNCTION guard_capability_version_insert() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" <> 'DRAFT' OR NEW."version" <> 1 OR NEW."attested" OR
     NEW."submittedByUserId" IS NOT NULL OR NEW."decidedByUserId" IS NOT NULL THEN
    RAISE EXCEPTION 'new capability must be a draft' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "branch_capability_insert_guard" BEFORE INSERT ON "branch_capability_versions" FOR EACH ROW EXECUTE FUNCTION guard_capability_version_insert();

CREATE FUNCTION guard_capability_version_transition() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."branchId" IS DISTINCT FROM OLD."branchId" OR NEW."categoryId" IS DISTINCT FROM OLD."categoryId" OR NEW."sequenceNumber" IS DISTINCT FROM OLD."sequenceNumber" OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'capability identity immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."status" IN ('REJECTED', 'WITHDRAWN') OR
     (OLD."status" = 'DRAFT' AND NEW."status" NOT IN ('DRAFT', 'PENDING_REVIEW')) OR
     (OLD."status" = 'PENDING_REVIEW' AND NEW."status" NOT IN ('ACTIVE', 'REJECTED')) OR
     (OLD."status" = 'ACTIVE' AND NEW."status" <> 'WITHDRAWN') THEN
    RAISE EXCEPTION 'invalid capability transition' USING ERRCODE = '23514';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'capability version must increment once' USING ERRCODE = '23514';
  END IF;
  IF (OLD."status" <> 'DRAFT' OR NEW."status" <> 'DRAFT') AND NEW."evidenceRef" IS DISTINCT FROM OLD."evidenceRef" THEN
    RAISE EXCEPTION 'submitted capability content immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."attested" IS DISTINCT FROM OLD."attested" AND NOT (OLD."status" = 'PENDING_REVIEW' AND NEW."status" = 'ACTIVE' AND NEW."attested") THEN
    RAISE EXCEPTION 'capability attestation requires approval' USING ERRCODE = '23514';
  END IF;
  IF OLD."status" = 'DRAFT' AND NEW."status" = 'PENDING_REVIEW' AND
     (NEW."evidenceRef" IS NULL OR NOT EXISTS (SELECT 1 FROM "branch_capability_coverage" WHERE "versionId" = NEW."id")) THEN
    RAISE EXCEPTION 'capability evidence and coverage required' USING ERRCODE = '23514';
  END IF;
  IF OLD."status" = 'PENDING_REVIEW' THEN
    IF NEW."submittedByUserId" IS DISTINCT FROM OLD."submittedByUserId" OR NEW."submittedAt" IS DISTINCT FROM OLD."submittedAt" THEN
      RAISE EXCEPTION 'submitted capability metadata immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF OLD."status" = 'ACTIVE' AND (
    NEW."submittedByUserId" IS DISTINCT FROM OLD."submittedByUserId" OR
    NEW."submittedAt" IS DISTINCT FROM OLD."submittedAt" OR
    NEW."decidedByUserId" IS DISTINCT FROM OLD."decidedByUserId" OR
    NEW."decidedAt" IS DISTINCT FROM OLD."decidedAt" OR
    NEW."attested" IS DISTINCT FROM OLD."attested"
  ) THEN
    RAISE EXCEPTION 'active capability review metadata immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."status" = 'PENDING_REVIEW' AND NEW."status" = 'ACTIVE' AND
     (NOT NEW."attested" OR NEW."decidedByUserId" = NEW."createdByUserId" OR NEW."decidedByUserId" = NEW."submittedByUserId") THEN
    RAISE EXCEPTION 'capability checker approval invalid' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "branch_capability_version_guard" BEFORE UPDATE ON "branch_capability_versions" FOR EACH ROW EXECUTE FUNCTION guard_capability_version_transition();

CREATE FUNCTION guard_capability_pointer() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'capability current pointer cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW."branchId" IS DISTINCT FROM OLD."branchId" OR NEW."categoryId" IS DISTINCT FROM OLD."categoryId" OR NEW."version" <> OLD."version" + 1) THEN
    RAISE EXCEPTION 'capability pointer identity/version invalid' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "branch_capability_pointer_guard" BEFORE INSERT OR UPDATE OR DELETE ON "branch_capability_current" FOR EACH ROW EXECUTE FUNCTION guard_capability_pointer();

CREATE FUNCTION validate_capability_pointer_at_commit() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  pointed UUID;
  active_id UUID;
BEGIN
  SELECT "activeVersionId" INTO pointed FROM "branch_capability_current"
    WHERE "branchId" = NEW."branchId" AND "categoryId" = NEW."categoryId";
  SELECT "id" INTO active_id FROM "branch_capability_versions"
    WHERE "branchId" = NEW."branchId" AND "categoryId" = NEW."categoryId" AND "status" = 'ACTIVE';
  IF pointed IS DISTINCT FROM active_id THEN
    RAISE EXCEPTION 'current capability must identify the sole active version' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "branch_capability_pointer_valid_at_commit"
AFTER INSERT OR UPDATE ON "branch_capability_current" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_capability_pointer_at_commit();

CREATE FUNCTION validate_capability_version_pointer_at_commit() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "branch_capability_versions" v
    LEFT JOIN "branch_capability_current" p
      ON p."branchId" = v."branchId" AND p."categoryId" = v."categoryId"
    WHERE v."branchId" = NEW."branchId" AND v."categoryId" = NEW."categoryId"
      AND ((v."status" = 'ACTIVE' AND p."activeVersionId" IS DISTINCT FROM v."id") OR
           (v."status" <> 'ACTIVE' AND p."activeVersionId" = v."id"))
  ) THEN
    RAISE EXCEPTION 'capability active version and pointer disagree' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "branch_capability_version_pointer_valid_at_commit"
AFTER UPDATE OF "status" ON "branch_capability_versions" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_capability_version_pointer_at_commit();
