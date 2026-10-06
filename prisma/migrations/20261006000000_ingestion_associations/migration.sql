-- PostgreSQL DDL is transactional; do not leave a partially created association model on failure.
BEGIN;

-- CreateEnum
CREATE TYPE "IngestionDecision" AS ENUM ('CONFIRMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "IngestionDecisionOrigin" AS ENUM ('MATCH', 'MANUAL');

-- CreateTable
CREATE TABLE "IngestionAssociation" (
    "id" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "identityKey" CHAR(66) NOT NULL,
    "externalId" VARCHAR(1024),
    "itemId" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngestionAssociation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestionAssociationDecision" (
    "id" UUID NOT NULL,
    "associationId" UUID NOT NULL,
    "entityId" UUID NOT NULL,
    "decision" "IngestionDecision" NOT NULL,
    "origin" "IngestionDecisionOrigin" NOT NULL,
    "authorDiscordId" VARCHAR(32) NOT NULL,
    "authorLabel" VARCHAR(200) NOT NULL,
    "decidedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngestionAssociationDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IngestionAssociation_itemId_idx" ON "IngestionAssociation"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "IngestionAssociation_sourceId_identityKey_key" ON "IngestionAssociation"("sourceId", "identityKey");

-- CreateIndex
CREATE INDEX "IngestionAssociationDecision_entityId_idx" ON "IngestionAssociationDecision"("entityId");

-- CreateIndex
CREATE UNIQUE INDEX "IngestionAssociationDecision_associationId_entityId_key" ON "IngestionAssociationDecision"("associationId", "entityId");

-- AddForeignKey
ALTER TABLE "IngestionAssociation" ADD CONSTRAINT "IngestionAssociation_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "IngestionAssociation" ADD CONSTRAINT "IngestionAssociation_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "IngestionItem"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "IngestionAssociationDecision" ADD CONSTRAINT "IngestionAssociationDecision_associationId_fkey" FOREIGN KEY ("associationId") REFERENCES "IngestionAssociation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "IngestionAssociationDecision" ADD CONSTRAINT "IngestionAssociationDecision_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- At most one active confirmation per staging identity, including concurrent transactions.
CREATE UNIQUE INDEX "IngestionAssociationDecision_one_confirmed_key"
    ON "IngestionAssociationDecision"("associationId") WHERE "decision" = 'CONFIRMED';
CREATE INDEX "IngestionAssociationDecision_recent_idx"
    ON "IngestionAssociationDecision"("associationId", "decision", "decidedAt", "id");

ALTER TABLE "IngestionAssociation" ADD CONSTRAINT "IngestionAssociation_identity_check" CHECK (
    "revision" >= 0 AND "identityKey" ~ '^[eh]:[0-9a-f]{64}$' AND
    (("externalId" IS NULL AND "identityKey" LIKE 'h:%') OR
     ("externalId" IS NOT NULL AND "identityKey" LIKE 'e:%' AND octet_length("externalId") BETWEEN 1 AND 1024))
);
ALTER TABLE "IngestionAssociationDecision" ADD CONSTRAINT "IngestionAssociationDecision_author_check" CHECK (
    "authorDiscordId" ~ '^[0-9]{1,32}$' AND length(btrim("authorLabel")) BETWEEN 1 AND 200
);

COMMIT;
