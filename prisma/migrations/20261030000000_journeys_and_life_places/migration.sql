-- Add vocabulary only. Never rewrite existing definitions, UUIDs or editorial data.
DO $catalog$
DECLARE
    new_types CONSTANT jsonb := '[
  {
    "id": "8c412e13-d18b-4f5b-89a4-000000000001",
    "code": "visited",
    "label": "a voyagé en",
    "inverseCode": "visited_by",
    "inverseLabel": "a reçu la visite de",
    "symmetric": false
  },
  {
    "id": "8c412e13-d18b-4f5b-89a4-000000000002",
    "code": "lived_in",
    "label": "a vécu en",
    "inverseCode": "previously_inhabited_by",
    "inverseLabel": "a été habité par",
    "symmetric": false
  },
  {
    "id": "8c412e13-d18b-4f5b-89a4-000000000003",
    "code": "born_in",
    "label": "est né à",
    "inverseCode": "birthplace_of",
    "inverseLabel": "est le lieu de naissance de",
    "symmetric": false
  },
  {
    "id": "8c412e13-d18b-4f5b-89a4-000000000004",
    "code": "died_in",
    "label": "est mort à",
    "inverseCode": "deathplace_of",
    "inverseLabel": "est le lieu de décès de",
    "symmetric": false
  }
]'::jsonb;
    requested record;
BEGIN
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
