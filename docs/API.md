# API publique et administration éditoriale

L’API Express utilise un seul client Prisma par processus. Les routes publiques restent en
lecture seule ; l'administration peut modifier et publier des `Entity` et `Relation`, ainsi que
corriger des `Source` et `Evidence`, après authentification.
`DATABASE_URL` est requis au démarrage ; copier `.env.example` en `.env` pour le
développement local. Le client est fermé lors de l’arrêt du serveur. Les tests utilisent des
doubles en mémoire et ne contactent pas PostgreSQL.

Sur `/api/v1`, seules les `Entity` et `Relation` dont le statut est `PUBLISHED` et la
visibilité `PUBLIC` sont renvoyées. Les deux extrémités d’une relation doivent également être
publiées et publiques. Les fiches non visibles répondent comme une fiche absente. Sources,
preuves et révisions restent exclues de l'API publique.

| Route | Réponse |
| --- | --- |
| `GET /api/v1/health` | `{ status, service, version, database }` ; `200` si PostgreSQL répond, `503` sinon, sans détail de connexion. |
| `GET /api/v1/relation-types` | Catalogue des types de relations trié par `code` croissant. |
| `GET /api/v1/entities` | Jusqu’à 100 fiches de navigation, triées par titre puis slug. Paramètres facultatifs : `kind` (valeur exacte de `EntityKind`) et `q` (2 à 100 caractères, recherche insensible à la casse dans titre, résumé et slug). |
| `GET /api/v1/entities/:slug` | Fiche avec Markdown, dates, alias et relations `outgoingRelations`/`incomingRelations`. Chaque relation contient son type et la fiche voisine. `404` si absente ou non publique. |
| `GET /api/v1/graph` | Nœuds et arêtes publics minimaux. Chaque nœud inclut `summary` et `aliases` pour la recherche locale, sans provenance ni données privées. |

Les paramètres inconnus, répétés ou mal formés renvoient `400` avec
`{ "error": { "code": "INVALID_REQUEST", "message": "..." } }`. Les erreurs internes renvoient
un message générique avec `500`. Il n’y a pas encore de pagination ; la limite de 100 fiches
est provisoire. Les recherches avancées, backlinks calculés à partir du Markdown et accès aux
contenus réservés seront traités dans un jalon ultérieur.

Le JSON libre `Entity.metadata` n’est pas exposé : ses futures clés publiques devront être
définies explicitement avant d’entrer dans le contrat de l’API.

Le staging d'ingestion v0.7a n'a aucune route `/api/v1` et ne participe ni à la bibliothèque,
ni à la recherche, ni au graphe publics. Aucun contenu/metadata d'ingestion n'est projeté publiquement.

## Authentification et administration

`GET /api/auth/session` retourne `{ authenticated, isAdmin, user }` sans Discord ID ni token.
`GET /api/auth/discord/login` et `GET /api/auth/discord/callback` réalisent OAuth ;
`POST /api/auth/logout` révoque la session. Voir [AUTH.md](AUTH.md).

Toutes les routes `/api/admin/**` exigent une session active et un Discord ID présent dans
`DISCORD_ADMIN_IDS` : `401` sans session, `403` pour un utilisateur non admin. Les réponses
portent `Cache-Control: no-store`.

| Route admin | Réponse |
| --- | --- |
| `GET /api/admin/ingestion/batches` | Batches, comptes et Sources ; 20 par page. |
| `GET /api/admin/ingestion/batches/:id` | Résumé privé du batch UUID. |
| `GET /api/admin/ingestion/items` | Réceptions paginées, 20/page ; aucun contenu brut/metadata. |
| `GET /api/admin/ingestion/items/:id` | Snapshot UUID, texte/metadata de la dernière réception ou de `receiptId` UUID, résumé des 20 dernières versions. |
| `GET /api/admin/ingestion/items/:id/matches` | Détection v0.7b à la demande : statut EXACT/AMBIGUOUS/POSSIBLE/NONE, jusqu’à 10 candidats minimaux, raisons et indicateurs de troncature. |
| `GET /api/admin/stats` | Comptes par statut et visibilité, nombre de sources et relations. |
| `GET /api/admin/graph` | Nœuds et arêtes éditoriaux minimaux, avec `summary`, `aliases`, statut et visibilité ; requiert un admin. |
| `GET /api/admin/entities` | `{ items, total, page, pageSize }` ; 50 fiches par page, tous statuts et visibilités. Filtres facultatifs `status`, `visibility`, `kind`, `q` (2 à 100 caractères), `page` (1 à 9999). |
| `POST /api/admin/entities` | Crée une fiche `PROPOSED` avec une Source existante ou nouvelle, une Evidence et une `Revision #1` dans une transaction ; retourne la fiche admin (`201`). |
| `GET /api/admin/entities/:slug` | Fiche éditoriale complète, preuves avec Source, relations entrantes/sortantes avec preuves, historique des Revision ; `404` si absente. |
| `GET /api/admin/sources` | `{ items, total, page, pageSize }` ; 20 Sources par page, recherche facultative `q` (2 à 100 caractères) et `page` (1 à 1000). |
| `GET /api/admin/relation-types` | Catalogue complet des types et sens inverses, trié par code. |
| `POST /api/admin/relations` | Crée une Relation `PROPOSED` avec Source et Evidence initiales dans une transaction ; retourne la fiche admin de départ (`201`). |
| `POST /api/admin/entities/:slug/evidence` | Ajoute une Evidence à une fiche avec Source existante ou nouvelle ; retourne `{ id }` (`201`). |
| `POST /api/admin/relations/:id/evidence` | Ajoute une Evidence à une relation avec Source existante ou nouvelle ; retourne `{ id }` (`201`). |
| `PATCH /api/admin/entities/:slug` | Remplace les champs éditables de la fiche ; retourne la fiche et ses révisions à jour. |
| `POST /api/admin/entities/:slug/publish` | Publie une fiche `PROPOSED` sourcée ; retourne la fiche à jour. |
| `POST /api/admin/entities/:slug/unpublish` | Retire une fiche `PUBLISHED` de la publication ; retourne la fiche à jour. |
| `PATCH /api/admin/relations/:id` | Modifie `description` et `visibility` ; retourne `{ id, updatedAt, status }`. |
| `POST /api/admin/relations/:id/publish` | Publie une relation `PROPOSED` avec une Evidence directement liée ; retourne `{ id, updatedAt, status }`. |
| `POST /api/admin/relations/:id/unpublish` | Retire une relation `PUBLISHED` de la publication ; retourne `{ id, updatedAt, status }`. |
| `PATCH /api/admin/sources/:id` | Modifie les champs éditoriaux de la Source ; retourne `{ id, updatedAt }`. |
| `PATCH /api/admin/evidence/:id` | Corrige le contenu et les repères de l'Evidence ; retourne `{ id, updatedAt }`. |

Les filtres inconnus, répétés ou invalides donnent `400`. Les champs `metadata` restent exclus
des projections éditoriales pour éviter d'exposer un JSON dont le contenu n'a pas encore été classé.
Exception privée : le détail d'un item de staging expose ses metadata uniquement aux administrateurs.
Les listes staging acceptent `sourceKind`, `sourceId`, `outcome`, `after`/`before` ISO inclusifs,
`page` (1–1000) ; la liste d'items
ajoute `batchId`. Les détails exigent des UUID, un intervalle inversé est refusé. Aucun endpoint
de mutation staging n'existe. Voir [INGESTION.md](INGESTION.md) pour les projections et limites.
La recherche privée (2–100 caractères, titre/identifiant/locator uniquement) passe par
`X-Hesta-Ingestion-Search`, encodé avec `encodeURIComponent`, jamais par un paramètre `q` d'URL.
L'en-tête est borné à 1 200 caractères ; un encodage invalide ou plusieurs occurrences donnent 400.

Le matching accepte uniquement `receiptId` UUID facultatif, avec le même ordre de dernière
réception que le détail. La réception doit appartenir à l’item : sinon 404, comme pour un item
absent. Paramètres inconnus/répétés, UUID invalide : 400 ; accès : 401/403 ; erreur interne : 500
générique. Il réutilise le middleware Origin admin existant (vérification des mutations,
lectures GET exemptées) et `no-store`, sans ajouter de CORS. La projection de chaque candidat contient uniquement id, slug, titre,
type/sous-type, jusqu’à cinq alias rapprochés, statut, visibilité, score et codes de raisons.
Aucun contenu brut, metadata, corps de fiche, Source, Evidence ou Revision n’est renvoyé.
Le serveur ne reçoit aucun titre de recherche dans l’URL : il résout la réception en interne.
Les comptes `exactCandidateCount` et `strongCandidateCount` couvrent toutes les identités
exactes en base, avant limite d’affichage. `searchTruncated` concerne seulement la réserve
approximative de 200 fiches ; il peut coexister avec EXACT. `approximateEvaluatedCount` est
borné à 200 ; `evaluatedCount` inclut jusqu’à 12 projections exactes supplémentaires (≤212).
Voir [MATCHING.md](MATCHING.md) pour les scores, plafonds et limites. Aucune route publique,
persistance, mutation ou association de matching.

Le `PATCH` exige un JSON complet contenant `title`, `summary`, `bodyMarkdown`, `kind`,
`placeKind`, `aliases`, `tags`, `visibility`, `expectedUpdatedAt` et éventuellement
`revisionMessage`. Les actions de publication exigent `expectedUpdatedAt` et acceptent
`revisionMessage`. Les propriétés supplémentaires sont refusées avec `400 INVALID_REQUEST` ;
le slug, le statut, les dates, `metadata`, les relations et les preuves ne peuvent pas être
modifiés via le formulaire. Une fiche absente donne `404`, une version obsolète
`409 ENTITY_MODIFIED`, un statut inadapté `409 INVALID_STATUS` et une publication sans preuve
`422 EVIDENCE_REQUIRED`. Les routes de correction de provenance exigent des UUID et des JSON
complets et stricts avec `expectedUpdatedAt`. Une version périmée donne respectivement
`409 RELATION_MODIFIED`, `SOURCE_MODIFIED` ou `EVIDENCE_MODIFIED`. Une collision de
`(Source.kind, Source.externalId)` donne `409 SOURCE_CONFLICT`. Les champs d'identité et de cible
ne sont pas éditables. Les routes de création admin sont limitées aux fiches et relations ;
elles refusent les champs inconnus, le statut et les IDs de provenance injectés par le client.
Un slug déjà utilisé donne `409 ENTITY_CONFLICT`, une Source inexistante `404 SOURCE_NOT_FOUND`,
et un identifiant externe de Source déjà utilisé `409 SOURCE_CONFLICT`. La création de Relation
accepte le code direct ou inverse du catalogue, mais interdit les doublons et toute fiche
`ARCHIVED`. Voir [MANUAL-CREATION.md](MANUAL-CREATION.md) et
[MANUAL-RELATIONS.md](MANUAL-RELATIONS.md). Aucune route de suppression n'est exposée.

L'ajout v0.5c accepte strictement `{ source, evidence }` selon le format de création manuelle :
`source` est `{ mode: "existing", sourceId }` ou `{ mode: "new", data }` ; `evidence` contient
les champs éditoriaux de la preuve, sans ID de cible ni de Source. `visibility` vaut `GM` par
défaut. Une preuve de même cible, même Source, même énoncé, extrait, repère et timestamps donne
`409 EVIDENCE_CONFLICT`. Les variantes de confiance ou de visibilité d'un passage identique
doivent être corrigées sur la preuve existante. Une cible absente donne `404 ENTITY_NOT_FOUND`
ou `404 RELATION_NOT_FOUND`. Une cible `ARCHIVED` ou une relation liée à une fiche `ARCHIVED`
refuse l'ajout en `409`. Ces routes ne changent ni la cible ni ses Revision.

Toutes les mutations admin exigent une session et une Origin identique à l'origine configurée,
y compris si le cookie est présent. Une Origin absente ou différente donne `403 INVALID_ORIGIN`.
Voir [EDITORIAL-WORKFLOW.md](EDITORIAL-WORKFLOW.md) pour les états, révisions et règles de
visibilité.
