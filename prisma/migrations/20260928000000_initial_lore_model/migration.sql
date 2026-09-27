-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "EditorialStatus" AS ENUM ('DRAFT', 'PROPOSED', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('PUBLIC', 'PLAYERS', 'GM', 'SECRET');

-- CreateEnum
CREATE TYPE "EntityKind" AS ENUM ('PERSON', 'PLACE', 'ORGANIZATION', 'FAMILY', 'RELIGION', 'DEITY', 'SPECIES', 'CREATURE', 'ARTIFACT', 'EVENT', 'QUEST', 'SESSION', 'CONCEPT', 'OTHER');

-- CreateEnum
CREATE TYPE "PlaceKind" AS ENUM ('CITY', 'CONTINENT', 'REGION', 'SEA', 'OCEAN', 'OTHER');

-- CreateEnum
CREATE TYPE "SourceKind" AS ENUM ('MANUAL', 'OBSIDIAN', 'DISCORD', 'HESTA_MAP', 'YOUTUBE', 'AI_DERIVED', 'OTHER');

-- CreateTable
CREATE TABLE "Entity" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(200) NOT NULL,
    "kind" "EntityKind" NOT NULL,
    "placeKind" "PlaceKind",
    "title" VARCHAR(200) NOT NULL,
    "summary" VARCHAR(500),
    "bodyMarkdown" TEXT NOT NULL DEFAULT '',
    "status" "EditorialStatus" NOT NULL DEFAULT 'DRAFT',
    "visibility" "Visibility" NOT NULL DEFAULT 'GM',
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "publishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Entity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelationType" (
    "id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "inverseCode" VARCHAR(64),
    "inverseLabel" VARCHAR(200),
    "symmetric" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RelationType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Relation" (
    "id" UUID NOT NULL,
    "fromEntityId" UUID NOT NULL,
    "toEntityId" UUID NOT NULL,
    "relationTypeId" UUID NOT NULL,
    "description" TEXT,
    "status" "EditorialStatus" NOT NULL DEFAULT 'DRAFT',
    "visibility" "Visibility" NOT NULL DEFAULT 'GM',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Relation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Source" (
    "id" UUID NOT NULL,
    "kind" "SourceKind" NOT NULL,
    "label" VARCHAR(250) NOT NULL,
    "externalId" VARCHAR(250),
    "url" TEXT,
    "authorLabel" VARCHAR(200),
    "publishedAt" TIMESTAMPTZ(3),
    "metadata" JSONB,
    "derivedFromSourceId" UUID,
    "visibility" "Visibility" NOT NULL DEFAULT 'GM',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "entityId" UUID,
    "relationId" UUID,
    "claimText" TEXT NOT NULL,
    "sourceExcerpt" TEXT,
    "locator" VARCHAR(250),
    "timeStartSeconds" INTEGER,
    "timeEndSeconds" INTEGER,
    "confidence" DECIMAL(4,3),
    "visibility" "Visibility" NOT NULL DEFAULT 'GM',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Revision" (
    "id" UUID NOT NULL,
    "entityId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "message" TEXT,
    "editorLabel" VARCHAR(200),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Revision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Entity_slug_key" ON "Entity"("slug");

-- CreateIndex
CREATE INDEX "Entity_kind_placeKind_idx" ON "Entity"("kind", "placeKind");

-- CreateIndex
CREATE INDEX "Entity_status_visibility_idx" ON "Entity"("status", "visibility");

-- CreateIndex
CREATE UNIQUE INDEX "RelationType_code_key" ON "RelationType"("code");

-- CreateIndex
CREATE UNIQUE INDEX "RelationType_inverseCode_key" ON "RelationType"("inverseCode");

-- CreateIndex
CREATE INDEX "Relation_fromEntityId_idx" ON "Relation"("fromEntityId");

-- CreateIndex
CREATE INDEX "Relation_toEntityId_idx" ON "Relation"("toEntityId");

-- CreateIndex
CREATE INDEX "Relation_relationTypeId_idx" ON "Relation"("relationTypeId");

-- CreateIndex
CREATE INDEX "Relation_status_visibility_idx" ON "Relation"("status", "visibility");

-- CreateIndex
CREATE UNIQUE INDEX "Relation_fromEntityId_toEntityId_relationTypeId_key" ON "Relation"("fromEntityId", "toEntityId", "relationTypeId");

-- CreateIndex
CREATE INDEX "Source_derivedFromSourceId_idx" ON "Source"("derivedFromSourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Source_kind_externalId_key" ON "Source"("kind", "externalId");

-- CreateIndex
CREATE INDEX "Evidence_sourceId_idx" ON "Evidence"("sourceId");

-- CreateIndex
CREATE INDEX "Evidence_entityId_idx" ON "Evidence"("entityId");

-- CreateIndex
CREATE INDEX "Evidence_relationId_idx" ON "Evidence"("relationId");

-- CreateIndex
CREATE UNIQUE INDEX "Revision_entityId_number_key" ON "Revision"("entityId", "number");

-- AddForeignKey
ALTER TABLE "Relation" ADD CONSTRAINT "Relation_fromEntityId_fkey" FOREIGN KEY ("fromEntityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Relation" ADD CONSTRAINT "Relation_toEntityId_fkey" FOREIGN KEY ("toEntityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Relation" ADD CONSTRAINT "Relation_relationTypeId_fkey" FOREIGN KEY ("relationTypeId") REFERENCES "RelationType"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Source" ADD CONSTRAINT "Source_derivedFromSourceId_fkey" FOREIGN KEY ("derivedFromSourceId") REFERENCES "Source"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_relationId_fkey" FOREIGN KEY ("relationId") REFERENCES "Relation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Revision" ADD CONSTRAINT "Revision_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Hand-written integrity constraints not represented by Prisma schema syntax.
ALTER TABLE "Entity" ADD CONSTRAINT "Entity_placeKind_matches_kind_check"
    CHECK (("kind" = 'PLACE') = ("placeKind" IS NOT NULL));

ALTER TABLE "Entity" ADD CONSTRAINT "Entity_publishedAt_required_check"
    CHECK ("status" <> 'PUBLISHED' OR "publishedAt" IS NOT NULL);

ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_exactly_one_target_check"
    CHECK (("entityId" IS NOT NULL) <> ("relationId" IS NOT NULL));

ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_time_start_nonnegative_check"
    CHECK ("timeStartSeconds" IS NULL OR "timeStartSeconds" >= 0);

ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_time_end_nonnegative_check"
    CHECK ("timeEndSeconds" IS NULL OR "timeEndSeconds" >= 0);

ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_time_order_check"
    CHECK ("timeStartSeconds" IS NULL OR "timeEndSeconds" IS NULL OR "timeEndSeconds" >= "timeStartSeconds");

ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_confidence_range_check"
    CHECK ("confidence" IS NULL OR "confidence" BETWEEN 0 AND 1);

ALTER TABLE "RelationType" ADD CONSTRAINT "RelationType_symmetric_inverse_check"
    CHECK (NOT "symmetric" OR ("inverseCode" IS NULL AND "inverseLabel" IS NULL));

ALTER TABLE "RelationType" ADD CONSTRAINT "RelationType_distinct_codes_check"
    CHECK ("inverseCode" IS NULL OR "inverseCode" <> "code");

ALTER TABLE "Revision" ADD CONSTRAINT "Revision_positive_number_check"
    CHECK ("number" > 0);
