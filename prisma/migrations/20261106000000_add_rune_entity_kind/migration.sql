-- Add the category without reclassifying existing artefacts or changing editorial data.
ALTER TYPE "EntityKind" ADD VALUE IF NOT EXISTS 'RUNE' AFTER 'ARTIFACT';
