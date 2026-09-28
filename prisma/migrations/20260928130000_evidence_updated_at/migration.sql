-- Backfill existing evidence with its creation time before requiring the new column.
ALTER TABLE "Evidence" ADD COLUMN "updatedAt" TIMESTAMPTZ(3);
UPDATE "Evidence" SET "updatedAt" = "createdAt";
ALTER TABLE "Evidence" ALTER COLUMN "updatedAt" SET NOT NULL;
