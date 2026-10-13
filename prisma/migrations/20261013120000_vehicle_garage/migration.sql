-- Empty catalog at deployment. Operators provide verified Egypt-market labels and provenance.
CREATE UNIQUE INDEX "customer_profile_id_userId_key" ON "customer_profile"("id", "userId");

CREATE TABLE "vehicle_makes" (
  "id" UUID NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  "code" VARCHAR(48) NOT NULL,
  "nameEn" VARCHAR(120) NOT NULL,
  "nameAr" VARCHAR(120) NOT NULL,
  "evidenceRef" VARCHAR(128) NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "vehicle_makes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vehicle_makes_version_check" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "vehicle_makes_code_key" ON "vehicle_makes"("code");
CREATE INDEX "vehicle_makes_isActive_code_idx" ON "vehicle_makes"("isActive", "code");

CREATE TABLE "vehicle_models" (
  "id" UUID NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  "makeId" UUID NOT NULL,
  "code" VARCHAR(48) NOT NULL,
  "nameEn" VARCHAR(120) NOT NULL,
  "nameAr" VARCHAR(120) NOT NULL,
  "evidenceRef" VARCHAR(128) NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "vehicle_models_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vehicle_models_version_check" CHECK ("version" > 0),
  CONSTRAINT "vehicle_models_makeId_fkey" FOREIGN KEY ("makeId") REFERENCES "vehicle_makes"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "vehicle_models_makeId_code_key" ON "vehicle_models"("makeId", "code");
CREATE UNIQUE INDEX "vehicle_models_id_makeId_key" ON "vehicle_models"("id", "makeId");
CREATE INDEX "vehicle_models_makeId_isActive_code_idx" ON "vehicle_models"("makeId", "isActive", "code");

CREATE TABLE "customer_vehicles" (
  "id" UUID NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  "ownerUserId" UUID NOT NULL,
  "customerProfileId" UUID NOT NULL,
  "makeId" UUID NOT NULL,
  "modelId" UUID NOT NULL,
  "modelYear" INTEGER NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customer_vehicles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_vehicles_year_version_check" CHECK ("modelYear" BETWEEN 1900 AND 2200 AND "version" > 0),
  CONSTRAINT "customer_vehicles_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "customer_vehicles_customerProfileId_ownerUserId_fkey" FOREIGN KEY ("customerProfileId", "ownerUserId") REFERENCES "customer_profile"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "customer_vehicles_makeId_fkey" FOREIGN KEY ("makeId") REFERENCES "vehicle_makes"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "customer_vehicles_modelId_makeId_fkey" FOREIGN KEY ("modelId", "makeId") REFERENCES "vehicle_models"("id", "makeId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "customer_vehicles_ownerUserId_archivedAt_createdAt_id_idx" ON "customer_vehicles"("ownerUserId", "archivedAt", "createdAt", "id");

CREATE TABLE "vehicle_commands" (
  "commandId" UUID NOT NULL,
  "actorUserId" UUID NOT NULL,
  "domain" VARCHAR(16) NOT NULL,
  "action" VARCHAR(24) NOT NULL,
  "resourceId" UUID NOT NULL,
  "fingerprint" VARCHAR(64) NOT NULL,
  "outcome" VARCHAR(16) NOT NULL,
  "httpStatus" INTEGER NOT NULL,
  "errorCode" VARCHAR(64),
  "resultVersion" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vehicle_commands_pkey" PRIMARY KEY ("commandId"),
  CONSTRAINT "vehicle_commands_shape_check" CHECK ("domain" = 'GARAGE' AND "action" IN ('CREATE', 'EDIT', 'ARCHIVE') AND "outcome" = 'APPLIED' AND "httpStatus" IN (200, 201) AND "errorCode" IS NULL AND "resultVersion" > 0 AND "fingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "vehicle_commands_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "vehicle_commands_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "customer_vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "vehicle_commands_actorUserId_domain_resourceId_createdAt_idx" ON "vehicle_commands"("actorUserId", "domain", "resourceId", "createdAt");

CREATE TABLE "vehicle_catalog_commands" (
  "commandId" UUID NOT NULL,
  "actorUserId" UUID NOT NULL,
  "domain" VARCHAR(16) NOT NULL DEFAULT 'CATALOG',
  "action" VARCHAR(24) NOT NULL,
  "resourceId" UUID NOT NULL,
  "fingerprint" VARCHAR(64) NOT NULL,
  "outcome" VARCHAR(16) NOT NULL,
  "httpStatus" INTEGER NOT NULL,
  "errorCode" VARCHAR(64),
  "resultVersion" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vehicle_catalog_commands_pkey" PRIMARY KEY ("commandId"),
  CONSTRAINT "vehicle_catalog_commands_shape_check" CHECK ("domain" = 'CATALOG' AND "action" IN ('CREATE_MAKE', 'CREATE_MODEL', 'UPDATE_MAKE', 'UPDATE_MODEL') AND "outcome" = 'APPLIED' AND "httpStatus" IN (200, 201) AND "errorCode" IS NULL AND "resultVersion" > 0 AND "fingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "vehicle_catalog_commands_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "vehicle_catalog_commands_actorUserId_domain_resourceId_createdAt_idx" ON "vehicle_catalog_commands"("actorUserId", "domain", "resourceId", "createdAt");

-- Immutable canonical identity, including the make/model relationship and garage ownership.
CREATE FUNCTION prevent_vehicle_identity_change() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'vehicle_makes' THEN
    IF NEW.code IS DISTINCT FROM OLD.code THEN
      RAISE EXCEPTION 'immutable vehicle make code' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'vehicle_models' THEN
    IF NEW.code IS DISTINCT FROM OLD.code OR NEW."makeId" IS DISTINCT FROM OLD."makeId" THEN
      RAISE EXCEPTION 'immutable vehicle model identity' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'customer_vehicles' THEN
    IF NEW."ownerUserId" IS DISTINCT FROM OLD."ownerUserId" OR NEW."customerProfileId" IS DISTINCT FROM OLD."customerProfileId" THEN
      RAISE EXCEPTION 'immutable vehicle ownership' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_vehicle_make BEFORE UPDATE ON "vehicle_makes" FOR EACH ROW EXECUTE FUNCTION prevent_vehicle_identity_change();
CREATE TRIGGER immutable_vehicle_model BEFORE UPDATE ON "vehicle_models" FOR EACH ROW EXECUTE FUNCTION prevent_vehicle_identity_change();
CREATE TRIGGER immutable_customer_vehicle_owner BEFORE UPDATE ON "customer_vehicles" FOR EACH ROW EXECUTE FUNCTION prevent_vehicle_identity_change();

