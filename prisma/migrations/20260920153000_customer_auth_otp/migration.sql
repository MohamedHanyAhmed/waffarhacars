-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('CUSTOMER_AUTH');

-- CreateEnum
CREATE TYPE "OtpChallengeStatus" AS ENUM ('PENDING', 'ACTIVE', 'CONSUMED', 'EXPIRED', 'LOCKED', 'SUPERSEDED', 'DELIVERY_FAILED', 'DELIVERY_UNKNOWN');

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "phoneNumber" TEXT,
ADD COLUMN     "phoneNumberVerified" BOOLEAN;

-- CreateTable
CREATE TABLE "otp_challenge" (
    "id" UUID NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
    "phoneLookupHash" VARCHAR(64) NOT NULL,
    "purpose" "OtpPurpose" NOT NULL DEFAULT 'CUSTOMER_AUTH',
    "status" "OtpChallengeStatus" NOT NULL DEFAULT 'PENDING',
    "codeHash" VARCHAR(64) NOT NULL,
    "dispatchId" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "cooldownUntil" TIMESTAMP(3) NOT NULL,
    "dispatchLeaseExpiresAt" TIMESTAMP(3),
    "lockoutUntil" TIMESTAMP(3),
    "failedAttemptCount" INTEGER NOT NULL DEFAULT 0,
    "sendCount" INTEGER NOT NULL DEFAULT 1,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "otp_challenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_profile" (
    "id" UUID NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
    "userId" UUID NOT NULL,
    "preferredLanguage" VARCHAR(5) NOT NULL DEFAULT 'ar',
    "notificationPreferences" JSONB NOT NULL DEFAULT '{"sms": true, "whatsapp": false}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_bucket" (
    "key" VARCHAR(128) NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "expireAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limit_bucket_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "otp_challenge_dispatchId_key" ON "otp_challenge"("dispatchId");

-- CreateIndex
CREATE INDEX "otp_challenge_phoneLookupHash_status_idx" ON "otp_challenge"("phoneLookupHash", "status");

-- CreateIndex
CREATE INDEX "otp_challenge_expiresAt_idx" ON "otp_challenge"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "customer_profile_userId_key" ON "customer_profile"("userId");

-- CreateIndex
CREATE INDEX "rate_limit_bucket_expireAt_idx" ON "rate_limit_bucket"("expireAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_phoneNumber_key" ON "user"("phoneNumber");

-- AddForeignKey
ALTER TABLE "customer_profile" ADD CONSTRAINT "customer_profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Partial unique index ensuring at most one ACTIVE challenge exists per phone and purpose
CREATE UNIQUE INDEX "unique_active_otp_challenge" ON "otp_challenge" ("phoneLookupHash", "purpose") WHERE "status" = 'ACTIVE';

-- Partial unique index ensuring at most one PENDING challenge exists per phone and purpose
CREATE UNIQUE INDEX "unique_pending_otp_challenge" ON "otp_challenge" ("phoneLookupHash", "purpose") WHERE "status" = 'PENDING';
