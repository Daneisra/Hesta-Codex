# Création manuelle d'une fiche — v0.5a

Un administrateur Discord autorisé peut créer une fiche depuis `/admin/nouvelle-fiche`.
L'API correspondante est `POST /api/admin/entities`. Elle exige une session admin et une
`Origin` identique à celle du Codex. L'API publique reste en lecture seule.

## Fiche et provenance

La demande contient `entity`, `source` et `evidence`. `source` choisit exactement un mode :
`{ "mode": "existing", "sourceId": "UUID" }` ou
`{ "mode": "new", "data": { ... } }`. La première forme réutilise la Source sans la modifier.
La seconde crée une Source avec les champs éditoriaux `kind`, `label`, `externalId`, `url`,
`authorLabel`, `publishedAt` et `visibility`. Une Source déjà présente avec le même couple
`(kind, externalId)` entraîne `409 SOURCE_CONFLICT` : elle n'est jamais réutilisée ou écrasée
implicitement. Le sélecteur des Sources existantes utilise `GET /api/admin/sources`, avec
`q` facultatif (2 à 100 caractères) et `page` (1 à 1000), à raison de 20 résultats par page.
Lorsque `externalId` est absent, un même label peut désigner plusieurs Sources : la création
n'en déduplique aucune. L'administrateur choisit une Source existante par son UUID, avec son
type, son éventuel ID externe et son auteur affichés pour l'identifier.

`entity` accepte `kind`, `placeKind`, `slug`, `title`, `summary`, `bodyMarkdown`, `aliases`,
`tags` et `visibility`. Le slug doit déjà être en minuscules ASCII séparées par des tirets ;
le serveur ne le réécrit pas. `placeKind` est requis pour `PLACE` et doit être `null` pour
les autres types. `evidence` accepte `claimText`, `sourceExcerpt`, `locator`,
`timeStartSeconds`, `timeEndSeconds`, `confidence` et `visibility`. La preuve cible
exclusivement la nouvelle fiche ; ses IDs de Source et de cible sont construits par le serveur.
Les timestamps sont des secondes entières, non négatives et ordonnées ; l'interface peut les
présenter en `HH:MM:SS`. La confiance est entre 0 et 1, avec trois décimales au plus.

Les champs inconnus sont refusés. Les règles de longueur et de listes sont celles de
l'édition admin et des preuves existantes. Une Source ou une Evidence nouvelle est `GM` par
défaut si sa visibilité est omise. La fiche est toujours créée en `PROPOSED + GM` par défaut,
avec `publishedAt = null`, même lorsqu'une visibilité explicite différente est demandée.
Le client ne peut pas fournir le statut, les dates techniques (`createdAt`, `updatedAt`,
`Entity.publishedAt`), `metadata`, les IDs relationnels ni `editorLabel`. La date éditoriale
`Source.publishedAt` reste autorisée. Le JSON admin est limité à 1 Mo par Express ; un
dépassement donne `413`.

## Transaction et révision

Une transaction Prisma unique vérifie le slug et la Source, crée si nécessaire la Source,
puis crée l'Entity, son Evidence initiale et sa `Revision #1`. Un échec à une étape annule
toutes les écritures du lot, y compris une nouvelle Source. Le snapshot de la révision
utilise le format Entity version 1 déjà employé par l'édition. Son auteur est déduit de
la session Discord côté serveur et son message indique la création manuelle.

Un slug existant donne `409 ENTITY_CONFLICT`. Une Source inexistante donne `404 SOURCE_NOT_FOUND`.
Si une Source sélectionnée disparaît avant la création de la preuve, la transaction est annulée
et la même erreur `SOURCE_NOT_FOUND` est retournée. Si ses informations changent, son UUID reste
la référence choisie ; la fiche créée affiche ensuite l'état actuel de cette Source.
Le statut `PROPOSED` interdit toute visibilité publique, y compris avec `visibility = PUBLIC`.
La publication ultérieure reste une action humaine séparée, avec les mêmes contrôles que
pour les fiches importées.

## Limites

Ce jalon crée une seule fiche et une seule preuve initiale par opération. Les sources et
preuves supplémentaires peuvent être consultées et corrigées, mais leur création séparée
reste reportée. La création manuelle de Relations est disponible depuis v0.5b ; voir
[MANUAL-RELATIONS.md](MANUAL-RELATIONS.md). Aucune nouvelle table ou migration Prisma
n'est nécessaire.
