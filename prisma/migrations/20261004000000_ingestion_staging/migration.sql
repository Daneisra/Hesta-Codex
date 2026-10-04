-- CreateEnum
CREATE TYPE "IngestionOutcome" AS ENUM ('NEW', 'UNCHANGED', 'MODIFIED');

-- CreateTable
CREATE TABLE "IngestionBatch" (
    "id" UUID NOT NULL,
    "label" VARCHAR(250) NOT NULL,
    "formatVersion" INTEGER NOT NULL DEFAULT 1,
    "receivedCount" INTEGER NOT NULL,
    "newCount" INTEGER NOT NULL,
    "unchangedCount" INTEGER NOT NULL,
    "modifiedCount" INTEGER NOT NULL,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngestionBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestionItem" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "identityKey" CHAR(66) NOT NULL,
    "externalId" VARCHAR(1024),
    "version" INTEGER NOT NULL,
    "contentHash" CHAR(64) NOT NULL,
    "content" TEXT NOT NULL,
    "ingestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngestionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestionReceipt" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "outcome" "IngestionOutcome" NOT NULL,
    "title" VARCHAR(250),
    "locator" VARCHAR(1024),
    "contentType" VARCHAR(100) NOT NULL DEFAULT 'text/plain',
    "observedAt" TIMESTAMPTZ(3),
    "metadata" JSONB,
    "rawVariant" TEXT,
    "ingestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngestionReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IngestionBatch_createdAt_id_idx" ON "IngestionBatch"("createdAt", "id");

-- CreateIndex
CREATE INDEX "IngestionItem_sourceId_externalId_idx" ON "IngestionItem"("sourceId", "externalId");

-- CreateIndex
CREATE INDEX "IngestionItem_sourceId_contentHash_idx" ON "IngestionItem"("sourceId", "contentHash");

-- CreateIndex
CREATE INDEX "IngestionItem_contentHash_idx" ON "IngestionItem"("contentHash");

-- CreateIndex
CREATE INDEX "IngestionItem_batchId_idx" ON "IngestionItem"("batchId");

-- CreateIndex
CREATE INDEX "IngestionItem_ingestedAt_id_idx" ON "IngestionItem"("ingestedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "IngestionItem_sourceId_identityKey_version_key" ON "IngestionItem"("sourceId", "identityKey", "version");

-- CreateIndex
CREATE INDEX "IngestionReceipt_itemId_idx" ON "IngestionReceipt"("itemId");

-- CreateIndex
CREATE INDEX "IngestionReceipt_outcome_ingestedAt_idx" ON "IngestionReceipt"("outcome", "ingestedAt");

-- CreateIndex
CREATE INDEX "IngestionReceipt_ingestedAt_id_idx" ON "IngestionReceipt"("ingestedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "IngestionReceipt_batchId_ordinal_key" ON "IngestionReceipt"("batchId", "ordinal");

-- AddForeignKey
ALTER TABLE "IngestionItem" ADD CONSTRAINT "IngestionItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "IngestionBatch"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "IngestionItem" ADD CONSTRAINT "IngestionItem_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "IngestionReceipt" ADD CONSTRAINT "IngestionReceipt_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "IngestionBatch"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "IngestionReceipt" ADD CONSTRAINT "IngestionReceipt_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "IngestionItem"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Additional staging invariants; only the new tables are altered.
ALTER TABLE "IngestionBatch" ADD CONSTRAINT "IngestionBatch_counts_check" CHECK (
    "formatVersion" = 1 AND "receivedCount" BETWEEN 1 AND 500 AND
    "newCount" >= 0 AND "unchangedCount" >= 0 AND "modifiedCount" >= 0 AND "warningCount" >= 0 AND
    "receivedCount" = "newCount" + "unchangedCount" + "modifiedCount"
);
ALTER TABLE "IngestionItem" ADD CONSTRAINT "IngestionItem_snapshot_check" CHECK (
    "version" > 0 AND "contentHash" ~ '^[0-9a-f]{64}$' AND "identityKey" ~ '^[eh]:[0-9a-f]{64}$' AND
    octet_length("content") BETWEEN 1 AND 262144 AND
    ("externalId" IS NULL OR octet_length("externalId") BETWEEN 1 AND 1024)
);
ALTER TABLE "IngestionReceipt" ADD CONSTRAINT "IngestionReceipt_limits_check" CHECK (
    "ordinal" BETWEEN 0 AND 499 AND
    ("rawVariant" IS NULL OR octet_length("rawVariant") BETWEEN 1 AND 262144)
);
