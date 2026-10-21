-- Add three vocabulary pairs only; preserve existing types and all editorial data.
-- Definitions mirrored from packages/shared/src/relation-catalog.ts, checked by PostgreSQL tests.
DO $catalog$
DECLARE
    new_types CONSTANT jsonb := '[
  {
    "id": "dcb2d3a4-7eb1-4b35-bab3-000000000001",
    "code": "seeks",
    "label": "recherche",
    "inverseCode": "sought_by",
    "inverseLabel": "est recherché par",
    "symmetric": false
  },
  {
    "id": "dcb2d3a4-7eb1-4b35-bab3-000000000002",
    "code": "covets",
    "label": "convoite",
    "inverseCode": "coveted_by",
    "inverseLabel": "est convoité par",
    "symmetric": false
  },
  {
    "id": "dcb2d3a4-7eb1-4b35-bab3-000000000003",
    "code": "holds",
    "label": "détient",
    "inverseCode": "held_by",
    "inverseLabel": "est détenu par",
    "symmetric": false
  }
]'::jsonb;
    requested record;
BEGIN
    -- Serialize installers, including the optional seed, across both code namespaces.
    LOCK TABLE "RelationType" IN SHARE ROW EXCLUSIVE MODE;
    FOR requested IN SELECT * FROM jsonb_to_recordset(new_types) AS definitions(
        id uuid, code text, label text, "inverseCode" text, "inverseLabel" text, "symmetric" boolean
    ) LOOP
        IF EXISTS (SELECT 1 FROM "RelationType" existing WHERE existing.code <> requested.code AND (
            existing.code = requested."inverseCode" OR existing."inverseCode" = requested.code OR
            existing."inverseCode" = requested."inverseCode"
        )) THEN
            RAISE EXCEPTION 'Conflicting relation code: %', requested.code;
        END IF;
        IF EXISTS (SELECT 1 FROM "RelationType" existing WHERE existing.code = requested.code AND (
            existing.label IS DISTINCT FROM requested.label OR
            existing."inverseCode" IS DISTINCT FROM requested."inverseCode" OR
            existing."inverseLabel" IS DISTINCT FROM requested."inverseLabel" OR
            existing."symmetric" IS DISTINCT FROM requested."symmetric"
        )) THEN
            RAISE EXCEPTION 'Existing relation definition differs: %', requested.code;
        END IF;
        INSERT INTO "RelationType" (id, code, label, "inverseCode", "inverseLabel", "symmetric", "updatedAt")
        SELECT requested.id, requested.code, requested.label, requested."inverseCode", requested."inverseLabel", requested."symmetric", CURRENT_TIMESTAMP
        WHERE NOT EXISTS (SELECT 1 FROM "RelationType" existing WHERE existing.code = requested.code)
        ON CONFLICT (code) DO NOTHING;
    END LOOP;
END;
$catalog$;
