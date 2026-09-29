-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('SALES_AGENT', 'OPS_SUPERVISOR', 'FINANCE_OFFICER', 'PLATFORM_ADMIN');

-- CreateTable
CREATE TABLE "internal_role_assignments" (
    "id" UUID NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
    "staffMembershipId" UUID NOT NULL,
    "role" "StaffRole" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedBy" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "internal_role_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_audit_events" (
    "id" UUID NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
    "actorUserId" UUID,
    "eventType" VARCHAR(64) NOT NULL,
    "targetEntity" VARCHAR(128),
    "ipFingerprint" VARCHAR(64),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "internal_role_assignments_staffMembershipId_isActive_idx" ON "internal_role_assignments"("staffMembershipId", "isActive");

-- CreateIndex
CREATE INDEX "security_audit_events_timestamp_idx" ON "security_audit_events"("timestamp");

-- CreateIndex
CREATE INDEX "security_audit_events_eventType_timestamp_idx" ON "security_audit_events"("eventType", "timestamp");

-- CreateIndex
CREATE INDEX "security_audit_events_actorUserId_timestamp_idx" ON "security_audit_events"("actorUserId", "timestamp");

-- CreateIndex
CREATE INDEX "security_audit_events_ipFingerprint_eventType_timestamp_idx" ON "security_audit_events"("ipFingerprint", "eventType", "timestamp");

-- AddForeignKey
ALTER TABLE "internal_role_assignments" ADD CONSTRAINT "internal_role_assignments_staffMembershipId_fkey" FOREIGN KEY ("staffMembershipId") REFERENCES "internal_staff_membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_audit_events" ADD CONSTRAINT "security_audit_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
