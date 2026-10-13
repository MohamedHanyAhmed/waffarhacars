CREATE TYPE "OfferPublicationStatus" AS ENUM ('PUBLISHED', 'UNPUBLISHED');
CREATE TYPE "OfferPublicationAction" AS ENUM ('PUBLISH', 'REPLACE', 'UNPUBLISH');
CREATE TYPE "OfferPublicationOutcome" AS ENUM ('APPLIED', 'REJECTED');

CREATE TABLE "offer_publications" (
  "offerId" UUID NOT NULL,
  "status" "OfferPublicationStatus" NOT NULL,
  "pinnedRevisionId" UUID,
  "version" INTEGER NOT NULL,
  "lastActorUserId" UUID NOT NULL,
  "publishedAt" TIMESTAMP(3),
  "unpublishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "offer_publications_pkey" PRIMARY KEY ("offerId"),
  CONSTRAINT "offer_publications_state_check" CHECK (
    "version" > 0 AND ("status" <> 'PUBLISHED' OR ("pinnedRevisionId" IS NOT NULL AND "publishedAt" IS NOT NULL))
  )
);

CREATE INDEX "offer_publications_status_pinnedRevisionId_idx" ON "offer_publications"("status", "pinnedRevisionId");
ALTER TABLE "offer_publications" ADD CONSTRAINT "offer_publications_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offer_publications" ADD CONSTRAINT "offer_publications_pinnedRevisionId_offerId_fkey" FOREIGN KEY ("pinnedRevisionId", "offerId") REFERENCES "offer_revisions"("id", "offerId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offer_publications" ADD CONSTRAINT "offer_publications_lastActorUserId_fkey" FOREIGN KEY ("lastActorUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "offer_publication_commands" (
  "commandId" UUID NOT NULL,
  "offerId" UUID NOT NULL,
  "actorUserId" UUID NOT NULL,
  "action" "OfferPublicationAction" NOT NULL,
  "targetRevisionId" UUID,
  "expectedVersion" INTEGER NOT NULL,
  "fingerprint" VARCHAR(64) NOT NULL,
  "outcome" "OfferPublicationOutcome" NOT NULL,
  "httpStatus" INTEGER NOT NULL,
  "errorCode" VARCHAR(64),
  "resultVersion" INTEGER NOT NULL,
  "resultStatus" "OfferPublicationStatus" NOT NULL,
  "pinnedRevisionId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "offer_publication_commands_pkey" PRIMARY KEY ("commandId"),
  CONSTRAINT "offer_publication_commands_shape_check" CHECK (
    "expectedVersion" >= 0 AND "resultVersion" >= 0 AND "fingerprint" ~ '^[0-9a-f]{64}$' AND
    (("action" = 'UNPUBLISH' AND "targetRevisionId" IS NULL) OR ("action" <> 'UNPUBLISH' AND "targetRevisionId" IS NOT NULL)) AND
    (("outcome" = 'APPLIED' AND "httpStatus" = 200 AND "errorCode" IS NULL) OR
      ("outcome" = 'REJECTED' AND "httpStatus" IN (409, 422) AND "errorCode" IS NOT NULL))
  )
);

CREATE INDEX "offer_publication_commands_offerId_createdAt_idx" ON "offer_publication_commands"("offerId", "createdAt");
CREATE INDEX "offer_publication_commands_actorUserId_createdAt_idx" ON "offer_publication_commands"("actorUserId", "createdAt");
ALTER TABLE "offer_publication_commands" ADD CONSTRAINT "offer_publication_commands_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offer_publication_commands" ADD CONSTRAINT "offer_publication_commands_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offer_publication_commands" ADD CONSTRAINT "offer_publication_commands_pinnedRevisionId_offerId_fkey" FOREIGN KEY ("pinnedRevisionId", "offerId") REFERENCES "offer_revisions"("id", "offerId") ON DELETE RESTRICT ON UPDATE CASCADE;
