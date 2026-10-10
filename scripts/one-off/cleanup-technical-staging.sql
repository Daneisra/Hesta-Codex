-- Opération ponctuelle avant la première création éditoriale. Aucun lancement automatique.
-- Modèle volontairement INCOMPLET : compléter les UUID dans une copie privée hors Git.
-- Voir docs/STAGING-CLEANUP.md. psql -X --set=ON_ERROR_STOP=1 --file ... obligatoire.
-- La dernière instruction est ROLLBACK : répétition annulée par défaut.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = pg_catalog, public, pg_temp;

CREATE TEMP TABLE cleanup_protected (
    source_id uuid PRIMARY KEY,
    batch_id uuid UNIQUE NOT NULL
) ON COMMIT DROP;
CREATE TEMP TABLE cleanup_batches (id uuid PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE cleanup_sources (id uuid PRIMARY KEY) ON COMMIT DROP;

-- ZONE À COMPLÉTER après inventaire et vérification humaine des UUID exacts.
-- INSERT INTO pg_temp.cleanup_protected (source_id, batch_id)
-- VALUES ('<UUID_SOURCE_OBSIDIAN>', '<UUID_LOT_OBSIDIAN>');
-- INSERT INTO pg_temp.cleanup_batches (id) VALUES
-- ('<UUID_LOT_FICTIF_1>'),
-- ('<UUID_LOT_FICTIF_2>'),
-- ('<UUID_LOT_FICTIF_3>'),
-- ('<UUID_LOT_FICTIF_4>'),
-- ('<UUID_LOT_FICTIF_5>'),
-- ('<UUID_LOT_FICTIF_6>'),
-- ('<UUID_LOT_FICTIF_7>'),
-- ('<UUID_LOT_FICTIF_8>');
-- INSERT INTO pg_temp.cleanup_sources (id) VALUES
-- ('<UUID_SOURCE_FICTIVE_1>');
-- Ajouter à ce dernier INSERT tous les UUID de Sources fictives vérifiées.
-- Ne pas insérer de libellé à la place d'un UUID, ni automatiser cette liste.

DO $guard$
BEGIN
    IF (SELECT count(*) FROM pg_temp.cleanup_protected) <> 1
       OR (SELECT count(*) FROM pg_temp.cleanup_batches) <> 8
       OR NOT EXISTS (SELECT 1 FROM pg_temp.cleanup_sources) THEN
        RAISE EXCEPTION 'Liste incomplète : une Source et un lot protégés, huit lots fictifs et leurs Sources explicitement vérifiées requis';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_temp.cleanup_batches b
               JOIN pg_temp.cleanup_protected p ON p.batch_id = b.id)
       OR EXISTS (SELECT 1 FROM pg_temp.cleanup_sources s
                  JOIN pg_temp.cleanup_protected p ON p.source_id = s.id) THEN
        RAISE EXCEPTION 'La liste de suppression contient une identité protégée';
    END IF;
END;
$guard$;

-- Bloque les écritures concurrentes pendant inventaire, suppression et comparaison.
-- Les lectures ordinaires restent possibles. En cas de contention, abandon après 5 s.
LOCK TABLE public."Source", public."Entity", public."Relation", public."Evidence",
    public."Revision", public."IngestionBatch", public."IngestionItem",
    public."IngestionReceipt", public."IngestionAssociation",
    public."IngestionAssociationDecision" IN SHARE ROW EXCLUSIVE MODE;

DO $guard$
BEGIN
    IF (SELECT count(*) FROM public."IngestionBatch") <> 9
       OR (SELECT count(*) FROM public."IngestionItem") <> 139
       OR (SELECT count(*) FROM public."IngestionReceipt") <> 148 THEN
        RAISE EXCEPTION 'État initial différent de 9 lots / 139 items / 148 réceptions : nouvel inventaire requis';
    END IF;
    IF EXISTS (SELECT 1 FROM public."Entity") OR EXISTS (SELECT 1 FROM public."Relation")
       OR EXISTS (SELECT 1 FROM public."Evidence") OR EXISTS (SELECT 1 FROM public."Revision") THEN
        RAISE EXCEPTION 'Des données éditoriales existent : nettoyage ponctuel refusé';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public."Source" s JOIN pg_temp.cleanup_protected p ON p.source_id = s.id
        WHERE s.kind = 'OBSIDIAN' AND s."externalId" = 'hesta-obsidian-principal'
    ) OR NOT EXISTS (
        SELECT 1 FROM public."IngestionBatch" b JOIN pg_temp.cleanup_protected p ON p.batch_id = b.id
        WHERE b."receivedCount" = 130
    ) THEN
        RAISE EXCEPTION 'Source ou lot Obsidian protégé incorrect';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_temp.cleanup_batches t
               LEFT JOIN public."IngestionBatch" b ON b.id = t.id WHERE b.id IS NULL)
       OR EXISTS (SELECT 1 FROM pg_temp.cleanup_sources t
                  LEFT JOIN public."Source" s ON s.id = t.id WHERE s.id IS NULL) THEN
        RAISE EXCEPTION 'UUID de lot ou Source fictive absent de la base';
    END IF;
    IF (SELECT count(*) FROM public."IngestionItem" i
        JOIN pg_temp.cleanup_protected p ON p.source_id = i."sourceId") <> 130
       OR (SELECT count(DISTINCT i."identityKey") FROM public."IngestionItem" i
           JOIN pg_temp.cleanup_protected p ON p.source_id = i."sourceId") <> 130
       OR (SELECT count(DISTINCT i."externalId") FROM public."IngestionItem" i
           JOIN pg_temp.cleanup_protected p ON p.source_id = i."sourceId") <> 130
       OR (SELECT count(*) FROM public."IngestionReceipt" r
           JOIN pg_temp.cleanup_protected p ON p.batch_id = r."batchId") <> 130 THEN
        RAISE EXCEPTION 'La Source protégée doit contenir exactement 130 notes distinctes et son lot 130 réceptions';
    END IF;
    IF EXISTS (SELECT 1 FROM public."IngestionItem" i
               CROSS JOIN pg_temp.cleanup_protected p
               WHERE (i."sourceId" = p.source_id) <> (i."batchId" = p.batch_id)) THEN
        RAISE EXCEPTION 'Le lot protégé est mixte ou ses notes appartiennent à un autre lot';
    END IF;
    IF EXISTS (SELECT 1 FROM public."IngestionItem" i
               JOIN pg_temp.cleanup_batches b ON b.id = i."batchId"
               LEFT JOIN pg_temp.cleanup_sources s ON s.id = i."sourceId" WHERE s.id IS NULL) THEN
        RAISE EXCEPTION 'Source des items fictifs absente de la liste explicitement vérifiée';
    END IF;
    -- UNCHANGED peut référencer un item d'un autre lot : interdire toute frontière réelle/fictive.
    IF EXISTS (SELECT 1 FROM public."IngestionReceipt" r
               JOIN public."IngestionItem" i ON i.id = r."itemId"
               CROSS JOIN pg_temp.cleanup_protected p
               WHERE (r."batchId" = p.batch_id) <> (i."sourceId" = p.source_id)) THEN
        RAISE EXCEPTION 'Une réception traverse la frontière entre staging réel et fictif';
    END IF;
END;
$guard$;

CREATE TEMP TABLE cleanup_items ON COMMIT DROP AS
SELECT i.id FROM public."IngestionItem" i JOIN pg_temp.cleanup_batches b ON b.id = i."batchId";

-- Les racines d'association peuvent pointer une ancienne version ou une Source déjà orpheline.
CREATE TEMP TABLE cleanup_associations ON COMMIT DROP AS
SELECT a.id FROM public."IngestionAssociation" a
WHERE a."itemId" IN (SELECT id FROM pg_temp.cleanup_items)
   OR a."sourceId" IN (SELECT id FROM pg_temp.cleanup_sources);

DO $guard$
BEGIN
    IF (SELECT count(*) FROM pg_temp.cleanup_items) <> 9 THEN
        RAISE EXCEPTION 'La liste doit cibler exactement neuf items fictifs';
    END IF;
    IF EXISTS (SELECT 1 FROM public."IngestionAssociation" a
               JOIN pg_temp.cleanup_associations t ON t.id = a.id
               WHERE a."sourceId" NOT IN (SELECT id FROM pg_temp.cleanup_sources)
                  OR a."itemId" NOT IN (SELECT id FROM pg_temp.cleanup_items)) THEN
        RAISE EXCEPTION 'Une association ciblée touche une Source ou un item non autorisé';
    END IF;
    IF EXISTS (SELECT 1 FROM public."IngestionItem" i
               JOIN public."IngestionAssociation" a
                 ON a."sourceId" = i."sourceId" AND a."identityKey" = i."identityKey"
               JOIN pg_temp.cleanup_associations t ON t.id = a.id
               WHERE i.id NOT IN (SELECT id FROM pg_temp.cleanup_items)) THEN
        RAISE EXCEPTION 'Une association ciblée appartient aussi à une identité conservée';
    END IF;
END;
$guard$;

-- Snapshot complet des lignes à conserver et de toutes les Sources, en tables temporaires.
-- Les corps et métadonnées ne sont jamais affichés ni écrits dans un fichier d'inventaire.
CREATE TEMP TABLE cleanup_preserved_before ON COMMIT DROP AS
SELECT 'Source'::text AS table_name, to_jsonb(s) AS row_data FROM public."Source" s
UNION ALL
SELECT 'IngestionBatch', to_jsonb(b) FROM public."IngestionBatch" b
WHERE b.id NOT IN (SELECT id FROM pg_temp.cleanup_batches)
UNION ALL
SELECT 'IngestionItem', to_jsonb(i) FROM public."IngestionItem" i
WHERE i.id NOT IN (SELECT id FROM pg_temp.cleanup_items)
UNION ALL
SELECT 'IngestionReceipt', to_jsonb(r) FROM public."IngestionReceipt" r
WHERE r."batchId" NOT IN (SELECT id FROM pg_temp.cleanup_batches)
UNION ALL
SELECT 'IngestionAssociation', to_jsonb(a) FROM public."IngestionAssociation" a
WHERE a.id NOT IN (SELECT id FROM pg_temp.cleanup_associations)
UNION ALL
SELECT 'IngestionAssociationDecision', to_jsonb(d) FROM public."IngestionAssociationDecision" d
WHERE d."associationId" NOT IN (SELECT id FROM pg_temp.cleanup_associations);

-- INVENTAIRE AVANT SUPPRESSION : UUID explicites, aucun contenu de lore.
SELECT b.id AS target_batch_id, b.label,
       (SELECT count(*) FROM public."IngestionItem" i WHERE i."batchId" = b.id) AS items,
       (SELECT count(*) FROM public."IngestionReceipt" r WHERE r."batchId" = b.id) AS receipts
FROM public."IngestionBatch" b JOIN pg_temp.cleanup_batches t ON t.id = b.id ORDER BY b.id;
SELECT s.id AS authorized_fictitious_source_id, s.kind, s."externalId", s."derivedFromSourceId"
FROM public."Source" s JOIN pg_temp.cleanup_sources t ON t.id = s.id ORDER BY s.id;
SELECT id AS target_item_id FROM pg_temp.cleanup_items ORDER BY id;
SELECT id AS target_association_id FROM pg_temp.cleanup_associations ORDER BY id;
SELECT (SELECT count(*) FROM pg_temp.cleanup_batches) AS target_batches,
       (SELECT count(*) FROM pg_temp.cleanup_items) AS target_items,
       (SELECT count(*) FROM public."IngestionReceipt" r
        JOIN pg_temp.cleanup_batches b ON b.id = r."batchId") AS target_receipts,
       (SELECT count(*) FROM pg_temp.cleanup_associations) AS target_associations,
       (SELECT count(*) FROM public."IngestionAssociationDecision" d
        JOIN pg_temp.cleanup_associations a ON a.id = d."associationId") AS target_decisions;

-- Clés étrangères RESTRICT : dépendances d'abord. Aucun CASCADE ni TRUNCATE.
DELETE FROM public."IngestionAssociationDecision" d
USING pg_temp.cleanup_associations a WHERE d."associationId" = a.id;
DELETE FROM public."IngestionAssociation" a
USING pg_temp.cleanup_associations t WHERE a.id = t.id;
DELETE FROM public."IngestionReceipt" r
USING pg_temp.cleanup_batches b WHERE r."batchId" = b.id;
DELETE FROM public."IngestionItem" i
USING pg_temp.cleanup_items t WHERE i.id = t.id;
DELETE FROM public."IngestionBatch" b
USING pg_temp.cleanup_batches t WHERE b.id = t.id;

-- Sources explicitement autorisées, et seulement quand toutes leurs références ont disparu.
-- Dérivations : les feuilles d'abord ; un parent encore utilisé est intégralement conservé.
CREATE TEMP TABLE cleanup_deleted_sources (id uuid PRIMARY KEY) ON COMMIT DROP;
DO $cleanup$
DECLARE removed integer;
BEGIN
    LOOP
        WITH deleted AS (
            DELETE FROM public."Source" s USING pg_temp.cleanup_sources t
            WHERE s.id = t.id
              AND NOT EXISTS (SELECT 1 FROM public."IngestionItem" i WHERE i."sourceId" = s.id)
              AND NOT EXISTS (SELECT 1 FROM public."IngestionAssociation" a WHERE a."sourceId" = s.id)
              AND NOT EXISTS (SELECT 1 FROM public."Evidence" e WHERE e."sourceId" = s.id)
              AND NOT EXISTS (SELECT 1 FROM public."Source" child WHERE child."derivedFromSourceId" = s.id)
            RETURNING s.id
        )
        INSERT INTO pg_temp.cleanup_deleted_sources (id) SELECT id FROM deleted;
        GET DIAGNOSTICS removed = ROW_COUNT;
        EXIT WHEN removed = 0;
    END LOOP;
END;
$cleanup$;

CREATE TEMP TABLE cleanup_preserved_after ON COMMIT DROP AS
SELECT 'Source'::text AS table_name, to_jsonb(s) AS row_data FROM public."Source" s
UNION ALL
SELECT 'IngestionBatch', to_jsonb(b) FROM public."IngestionBatch" b
WHERE b.id NOT IN (SELECT id FROM pg_temp.cleanup_batches)
UNION ALL
SELECT 'IngestionItem', to_jsonb(i) FROM public."IngestionItem" i
WHERE i.id NOT IN (SELECT id FROM pg_temp.cleanup_items)
UNION ALL
SELECT 'IngestionReceipt', to_jsonb(r) FROM public."IngestionReceipt" r
WHERE r."batchId" NOT IN (SELECT id FROM pg_temp.cleanup_batches)
UNION ALL
SELECT 'IngestionAssociation', to_jsonb(a) FROM public."IngestionAssociation" a
WHERE a.id NOT IN (SELECT id FROM pg_temp.cleanup_associations)
UNION ALL
SELECT 'IngestionAssociationDecision', to_jsonb(d) FROM public."IngestionAssociationDecision" d
WHERE d."associationId" NOT IN (SELECT id FROM pg_temp.cleanup_associations);

-- Exclure du snapshot attendu uniquement les Sources effectivement supprimées.
-- Toute Source autorisée mais encore utilisée doit elle aussi rester inchangée.
CREATE TEMP TABLE cleanup_preserved_expected ON COMMIT DROP AS
SELECT * FROM pg_temp.cleanup_preserved_before
WHERE table_name <> 'Source'
   OR (row_data ->> 'id')::uuid NOT IN (SELECT id FROM pg_temp.cleanup_deleted_sources);

DO $guard$
BEGIN
    IF EXISTS (SELECT * FROM pg_temp.cleanup_preserved_expected
               EXCEPT SELECT * FROM pg_temp.cleanup_preserved_after)
       OR EXISTS (SELECT * FROM pg_temp.cleanup_preserved_after
                  EXCEPT SELECT * FROM pg_temp.cleanup_preserved_expected) THEN
        RAISE EXCEPTION 'Une ligne conservée a été modifiée, ajoutée ou supprimée : annulation obligatoire';
    END IF;
    IF (SELECT count(*) FROM public."IngestionBatch") <> 1
       OR (SELECT count(*) FROM public."IngestionItem") <> 130
       OR (SELECT count(*) FROM public."IngestionReceipt") <> 130
       OR EXISTS (SELECT 1 FROM public."IngestionAssociation" a
                  WHERE a."sourceId" <> (SELECT source_id FROM pg_temp.cleanup_protected))
       OR EXISTS (SELECT 1 FROM public."Entity") OR EXISTS (SELECT 1 FROM public."Relation")
       OR EXISTS (SELECT 1 FROM public."Evidence") OR EXISTS (SELECT 1 FROM public."Revision") THEN
        RAISE EXCEPTION 'État final incompatible avec 1 lot / 130 items / 130 réceptions et aucune donnée éditoriale';
    END IF;
END;
$guard$;

SELECT (SELECT count(*) FROM public."IngestionBatch") AS remaining_batches,
       (SELECT count(*) FROM public."IngestionItem") AS remaining_items,
       (SELECT count(*) FROM public."IngestionReceipt") AS remaining_receipts,
       (SELECT count(*) FROM public."Entity") AS entities,
       (SELECT count(*) FROM pg_temp.cleanup_deleted_sources) AS deleted_fictitious_sources;
SELECT id AS deleted_fictitious_source_id FROM pg_temp.cleanup_deleted_sources ORDER BY id;
-- Une Source autorisée mais toujours référencée ne doit PAS être forcée à disparaître.
SELECT s.id AS retained_referenced_fictitious_source_id, s."derivedFromSourceId"
FROM public."Source" s JOIN pg_temp.cleanup_sources t ON t.id = s.id ORDER BY s.id;

-- FINAL : conserver ROLLBACK pour la répétition. COMMIT seulement dans la copie approuvée.
ROLLBACK;
