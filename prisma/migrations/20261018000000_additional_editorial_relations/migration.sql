-- Add five direct/inverse pairs only; preserve every existing definition and editorial fact.
-- Definitions mirrored from packages/shared/src/relation-catalog.ts, checked by PostgreSQL tests.
DO $catalog$
DECLARE
    new_types CONSTANT jsonb := '[
  {
    "id": "cb9415c6-f258-4d92-aaf2-000000000001",
    "code": "works_for",
    "label": "travaille pour",
    "inverseCode": "employs",
    "inverseLabel": "emploie",
    "symmetric": false
  },
  {
    "id": "cb9415c6-f258-4d92-aaf2-000000000002",
    "code": "protects",
    "label": "protège",
    "inverseCode": "protected_by",
    "inverseLabel": "est protégé par",
    "symmetric": false
  },
  {
    "id": "cb9415c6-f258-4d92-aaf2-000000000003",
    "code": "can_become",
    "label": "peut devenir",
    "inverseCode": "possible_transformation_of",
    "inverseLabel": "est une transformation possible de",
    "symmetric": false
  },
  {
    "id": "cb9415c6-f258-4d92-aaf2-000000000004",
    "code": "previously_owned",
    "label": "a possédé",
    "inverseCode": "previously_owned_by",
    "inverseLabel": "a appartenu à",
    "symmetric": false
  },
  {
    "id": "cb9415c6-f258-4d92-aaf2-000000000005",
    "code": "previously_used",
    "label": "a utilisé",
    "inverseCode": "previously_used_by",
    "inverseLabel": "a été utilisé par",
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
