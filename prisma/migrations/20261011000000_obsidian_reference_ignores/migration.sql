-- Only editorial review decisions; no existing lore, relation or staging data is changed.
CREATE TABLE "ObsidianReferenceIgnore" (
    "fromEntityId" UUID NOT NULL,
    "toEntityId" UUID NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "revision" UUID NOT NULL,
    "authorDiscordId" VARCHAR(32) NOT NULL,
    "authorLabel" VARCHAR(200) NOT NULL,
    "decidedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ObsidianReferenceIgnore_pkey" PRIMARY KEY ("fromEntityId", "toEntityId"),
    CONSTRAINT "ObsidianReferenceIgnore_fromEntityId_fkey" FOREIGN KEY ("fromEntityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT "ObsidianReferenceIgnore_toEntityId_fkey" FOREIGN KEY ("toEntityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE RESTRICT
);
CREATE INDEX "ObsidianReferenceIgnore_toEntityId_idx" ON "ObsidianReferenceIgnore"("toEntityId");
