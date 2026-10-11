-- Additive vocabulary only; preserve the original four types and all editorial data.
-- Definitions mirrored from packages/shared/src/relation-catalog.ts, checked by PostgreSQL tests.
DO $catalog$
DECLARE
    new_types CONSTANT jsonb := '[
  {
    "id": "d706ed9d-0ccb-4df1-8a6e-000000000001",
    "code": "capital_of",
    "label": "est la capitale de",
    "inverseCode": "has_capital",
    "inverseLabel": "a pour capitale",
    "symmetric": false
  },
  {
    "id": "d706ed9d-0ccb-4df1-8a6e-000000000002",
    "code": "borders",
    "label": "est frontalier de",
    "inverseCode": null,
    "inverseLabel": null,
    "symmetric": true
  },
  {
    "id": "d706ed9d-0ccb-4df1-8a6e-000000000003",
    "code": "inhabits",
    "label": "habite dans",
    "inverseCode": "inhabited_by",
    "inverseLabel": "est habité par",
    "symmetric": false
  },
  {
    "id": "d706ed9d-0ccb-4df1-8a6e-000000000004",
    "code": "originates_from",
    "label": "est originaire de",
    "inverseCode": "origin_of",
    "inverseLabel": "est le lieu d’origine de",
    "symmetric": false
  },
  {
    "id": "d706ed9d-0ccb-4df1-8a6e-000000000005",
    "code": "sibling_of",
    "label": "frère ou sœur de",
    "inverseCode": null,
    "inverseLabel": null,
    "symmetric": true
  },
  {
    "id": "d706ed9d-0ccb-4df1-8a6e-000000000006",
    "code": "spouse_of",
    "label": "conjoint de",
    "inverseCode": null,
    "inverseLabel": null,
    "symmetric": true
  },
  {
    "id": "d706ed9d-0ccb-4df1-8a6e-000000000007",
    "code": "descendant_of",
    "label": "descendant de",
    "inverseCode": "ancestor_of",
    "inverseLabel": "ancêtre de",
    "symmetric": false
  },
  {
    "id": "d706ed9d-0ccb-4df1-8a6e-000000000008",
    "code": "mentor_of",
    "label": "mentor de",
    "inverseCode": "mentored_by",
    "inverseLabel": "a pour mentor",
    "symmetric": false
  },
  {
    "id": "d706ed9d-0ccb-4df1-8a6e-000000000009",
    "code": "leads",
    "label": "dirige",
    "inverseCode": "led_by",
    "inverseLabel": "est dirigé par",
    "symmetric": false
  },
  {
    "id": "d706ed9d-0ccb-4df1-8a6e-000000000010",
    "code": "founded",
    "label": "a fondé",
    "inverseCode": "founded_by",
    "inverseLabel": "a été fondé par",
    "symmetric": false
  },
  {
    "id": "d706ed9d-0ccb-4df1-8a6e-000000000011",
    "code": "collaborates_with",
    "label": "collabore avec",
    "inverseCode": null,
    "inverseLabel": null,
    "symmetric": true
  },
  {
    "id": "d706ed9d-0ccb-4df1-8a6e-000000000012",
    "code": "rules_over",
    "label": "gouverne",
    "inverseCode": "ruled_by",
    "inverseLabel": "est gouverné par",
    "symmetric": false
  },
  {
    "id": "d706ed9d-0ccb-4df1-8a6e-000000000013",
    "code": "vassal_of",
    "label": "vassal de",
    "inverseCode": "overlord_of",
    "inverseLabel": "suzerain de",
    "symmetric": false
  },
  {
    "id": "d706ed9d-0ccb-4df1-8a6e-000000000014",
    "code": "enemy_of",
    "label": "ennemi de",
    "inverseCode": null,
    "inverseLabel": null,
    "symmetric": true
  },
  {
    "id": "d706ed9d-0ccb-4df1-8a6e-000000000015",
    "code": "rival_of",
    "label": "rival de",
    "inverseCode": null,
    "inverseLabel": null,
    "symmetric": true
  },
  {
    "id": "d706ed9d-0ccb-4df1-8a6e-000000000016",
    "code": "worships",
    "label": "vénère",
    "inverseCode": "worshipped_by",
    "inverseLabel": "est vénéré par",
    "symmetric": false
  },
  {
    "id": "d706ed9d-0ccb-4df1-8a6e-000000000017",
    "code": "patron_deity_of",
    "label": "est la divinité protectrice de",
    "inverseCode": "has_patron_deity",
    "inverseLabel": "a pour divinité protectrice",
    "symmetric": false
  },
  {
    "id": "d706ed9d-0ccb-4df1-8a6e-000000000018",
    "code": "participated_in",
    "label": "a participé à",
    "inverseCode": "had_participant",
    "inverseLabel": "a eu pour participant",
    "symmetric": false
  },
  {
    "id": "d706ed9d-0ccb-4df1-8a6e-000000000019",
    "code": "precedes",
    "label": "précède",
    "inverseCode": "follows",
    "inverseLabel": "suit chronologiquement",
    "symmetric": false
  },
  {
    "id": "d706ed9d-0ccb-4df1-8a6e-000000000020",
    "code": "caused",
    "label": "a provoqué",
    "inverseCode": "caused_by",
    "inverseLabel": "a été provoqué par",
    "symmetric": false
  },
  {
    "id": "d706ed9d-0ccb-4df1-8a6e-000000000021",
    "code": "created",
    "label": "a créé",
    "inverseCode": "created_by",
    "inverseLabel": "a été créé par",
    "symmetric": false
  },
  {
    "id": "d706ed9d-0ccb-4df1-8a6e-000000000022",
    "code": "owns",
    "label": "possède",
    "inverseCode": "owned_by",
    "inverseLabel": "appartient à",
    "symmetric": false
  },
  {
    "id": "d706ed9d-0ccb-4df1-8a6e-000000000023",
    "code": "uses",
    "label": "utilise",
    "inverseCode": "used_by",
    "inverseLabel": "est utilisé par",
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
