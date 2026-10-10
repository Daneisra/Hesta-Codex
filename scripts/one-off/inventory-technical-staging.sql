-- Inventaire ponctuel uniquement. Ne lit aucun corps, titre de note ou auteur.
-- Exécuter avec psql -X --set=ON_ERROR_STOP=1 --file ... dans un terminal privé.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = pg_catalog, public;

SELECT current_database() AS database_name, current_user AS database_user,
       inet_server_addr() AS server_address, inet_server_port() AS server_port;

SELECT (SELECT count(*) FROM public."IngestionBatch") AS batches,
       (SELECT count(*) FROM public."IngestionItem") AS items,
       (SELECT count(*) FROM public."IngestionReceipt") AS receipts,
       (SELECT count(*) FROM public."IngestionAssociation") AS associations,
       (SELECT count(*) FROM public."IngestionAssociationDecision") AS decisions,
       (SELECT count(*) FROM public."Entity") AS entities,
       (SELECT count(*) FROM public."Relation") AS relations,
       (SELECT count(*) FROM public."Evidence") AS evidence,
       (SELECT count(*) FROM public."Revision") AS revisions;

-- Tous les lots : les libellés facilitent la revue, les UUID font foi.
SELECT b.id AS batch_id, b.label, b."createdAt", b."receivedCount",
       (SELECT count(*) FROM public."IngestionItem" i WHERE i."batchId" = b.id) AS items,
       (SELECT count(*) FROM public."IngestionReceipt" r WHERE r."batchId" = b.id) AS receipts
FROM public."IngestionBatch" b
ORDER BY b."createdAt", b.id;

-- Provenance des réceptions, y compris celles réutilisant un item d'un autre lot.
SELECT r."batchId" AS receipt_batch_id, i."batchId" AS item_batch_id,
       s.id AS source_id, s.kind, s."externalId" AS source_external_id,
       count(*) AS receipts, count(DISTINCT i.id) AS referenced_items
FROM public."IngestionReceipt" r
JOIN public."IngestionItem" i ON i.id = r."itemId"
JOIN public."Source" s ON s.id = i."sourceId"
GROUP BY r."batchId", i."batchId", s.id, s.kind, s."externalId"
ORDER BY r."batchId", i."batchId", s.id;

-- Sources, dont les sources déjà orphelines. Aucune sélection automatique à supprimer.
SELECT s.id AS source_id, s.kind, s."externalId", s.label, s."derivedFromSourceId",
       (SELECT count(*) FROM public."IngestionItem" i WHERE i."sourceId" = s.id) AS items,
       (SELECT count(*) FROM public."IngestionAssociation" a WHERE a."sourceId" = s.id) AS associations,
       (SELECT count(*) FROM public."Evidence" e WHERE e."sourceId" = s.id) AS evidence,
       (SELECT count(*) FROM public."Source" child WHERE child."derivedFromSourceId" = s.id) AS derived_sources
FROM public."Source" s
ORDER BY s.kind, s.id;

-- Les UUID des items permettent de vérifier la sélection sans afficher leur Markdown.
SELECT i.id AS item_id, i."batchId", i."sourceId", i.version,
       (SELECT count(*) FROM public."IngestionReceipt" r WHERE r."itemId" = i.id) AS receipts
FROM public."IngestionItem" i
ORDER BY i."batchId", i."sourceId", i.id;

SELECT a.id AS association_id, a."sourceId", a."itemId", i."batchId" AS item_batch_id,
       a.revision,
       (SELECT count(*) FROM public."IngestionAssociationDecision" d WHERE d."associationId" = a.id) AS decisions
FROM public."IngestionAssociation" a
JOIN public."IngestionItem" i ON i.id = a."itemId"
ORDER BY a."sourceId", a.id;

-- Candidat protégé, uniquement à vérifier : ne choisit pas de lots à supprimer.
SELECT s.id AS protected_source_candidate, i."batchId" AS protected_batch_candidate,
       count(*) AS items, count(DISTINCT i."identityKey") AS identities,
       count(DISTINCT i."externalId") AS external_paths
FROM public."Source" s
JOIN public."IngestionItem" i ON i."sourceId" = s.id
WHERE s.kind = 'OBSIDIAN' AND s."externalId" = 'hesta-obsidian-principal'
GROUP BY s.id, i."batchId"
ORDER BY i."batchId";

COMMIT;
