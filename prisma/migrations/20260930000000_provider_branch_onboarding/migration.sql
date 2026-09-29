-- CreateEnum
CREATE TYPE "ProviderStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'PAUSED', 'REJECTED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "BranchStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'DECOMMISSIONED');

-- CreateEnum
CREATE TYPE "CairoCluster" AS ENUM ('NASR_CITY_HELIOPOLIS', 'NEW_CAIRO', 'MAADI', 'OCTOBER_ZAYED');

-- CreateTable
CREATE TABLE "provider_organizations" (
    "id" UUID NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
    "nameEn" VARCHAR(128) NOT NULL,
    "nameAr" VARCHAR(128) NOT NULL,
    "legalName" VARCHAR(255) NOT NULL,
    "taxRegistrationNumber" VARCHAR(9) NOT NULL,
    "commercialRegistrationNumber" VARCHAR(32) NOT NULL,
    "primaryCluster" "CairoCluster" NOT NULL,
    "status" "ProviderStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "contactPersonName" VARCHAR(128) NOT NULL,
    "contactEmail" VARCHAR(255) NOT NULL,
    "contactPhone" VARCHAR(20) NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "submittedByUserId" UUID,
    "activatedByUserId" UUID,
    "rejectionReason" TEXT,
    "pauseReason" TEXT,
    "submittedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_branches" (
    "id" UUID NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
    "providerOrganizationId" UUID NOT NULL,
    "branchCode" VARCHAR(32) NOT NULL,
    "nameEn" VARCHAR(128) NOT NULL,
    "nameAr" VARCHAR(128) NOT NULL,
    "cluster" "CairoCluster" NOT NULL,
    "streetAddressEn" VARCHAR(255) NOT NULL,
    "streetAddressAr" VARCHAR(255) NOT NULL,
    "landmarkEn" VARCHAR(255),
    "landmarkAr" VARCHAR(255),
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "contactPhone" VARCHAR(20) NOT NULL,
    "operatingHours" JSONB NOT NULL,
    "status" "BranchStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "pauseReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_branches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "provider_organizations_taxRegistrationNumber_key" ON "provider_organizations"("taxRegistrationNumber");

-- CreateIndex
CREATE UNIQUE INDEX "provider_organizations_commercialRegistrationNumber_key" ON "provider_organizations"("commercialRegistrationNumber");

-- CreateIndex
CREATE INDEX "provider_organizations_status_primaryCluster_idx" ON "provider_organizations"("status", "primaryCluster");

-- CreateIndex
CREATE INDEX "provider_organizations_createdByUserId_idx" ON "provider_organizations"("createdByUserId");

-- CreateIndex
CREATE INDEX "provider_branches_cluster_status_idx" ON "provider_branches"("cluster", "status");

-- CreateIndex
CREATE UNIQUE INDEX "provider_branches_providerOrganizationId_branchCode_key" ON "provider_branches"("providerOrganizationId", "branchCode");

-- AddForeignKey
ALTER TABLE "provider_organizations" ADD CONSTRAINT "provider_organizations_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_organizations" ADD CONSTRAINT "provider_organizations_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_organizations" ADD CONSTRAINT "provider_organizations_activatedByUserId_fkey" FOREIGN KEY ("activatedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_branches" ADD CONSTRAINT "provider_branches_providerOrganizationId_fkey" FOREIGN KEY ("providerOrganizationId") REFERENCES "provider_organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
