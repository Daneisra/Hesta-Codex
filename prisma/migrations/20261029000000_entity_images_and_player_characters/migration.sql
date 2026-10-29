ALTER TYPE "EntityKind" ADD VALUE 'PLAYER_CHARACTER';

CREATE TABLE "EntityImage" (
    "id" UUID NOT NULL,
    "entityId" UUID,
    "ownerDiscordId" VARCHAR(32),
    "content" BYTEA NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EntityImage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EntityImage_owner_check" CHECK (
      ("entityId" IS NULL AND "ownerDiscordId" IS NOT NULL) OR
      ("entityId" IS NOT NULL AND "ownerDiscordId" IS NULL)
    ),
    CONSTRAINT "EntityImage_size_check" CHECK (
      "byteSize" = octet_length("content") AND "byteSize" BETWEEN 1 AND 5242880 AND
      "width" BETWEEN 1 AND 6000 AND "height" BETWEEN 1 AND 6000 AND
      "width"::bigint * "height" <= 20000000
    )
);
CREATE INDEX "EntityImage_entityId_idx" ON "EntityImage"("entityId");
CREATE INDEX "EntityImage_ownerDiscordId_createdAt_idx" ON "EntityImage"("ownerDiscordId", "createdAt");
ALTER TABLE "EntityImage" ADD CONSTRAINT "EntityImage_entityId_fkey"
  FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE RESTRICT;
