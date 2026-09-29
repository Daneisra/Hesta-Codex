# Création manuelle des relations — v0.5b

Depuis `/admin/fiches/:slug`, « Ajouter une relation » ouvre
`/admin/fiches/:slug/nouvelle-relation`. La création demande une session Discord administrateur,
une `Origin` exactement égale à celle du Codex et une Source avec une Evidence initiale. Le
formulaire ne publie rien : la Relation est toujours `PROPOSED`, avec `GM` par défaut.

## Sens et stockage

`GET /api/admin/relation-types` fournit le catalogue réel, y compris `code`, `label`,
`inverseCode`, `inverseLabel` et `symmetric`. L'interface présente les formulations directes et
inverses, mais transmet seulement le code choisi avec les UUID des fiches affichées. Le
récapitulatif montre également l'orientation de stockage calculée à partir du catalogue ; le
serveur reste l'autorité pour cette normalisation.

`POST /api/admin/relations` résout ce code côté serveur. Un `inverseCode` échange les deux
extrémités avant insertion : `Archipel contains Barolt` devient
`Barolt located_in Archipel`. Aucune seconde ligne inverse n'est créée. Pour un type symétrique
comme `allied_with`, les UUID sont ordonnés de manière déterministe ; A–B et B–A sont donc la
même arête. La lecture des fiches affiche `inverseLabel` pour une relation entrante non symétrique
et `label` pour une relation symétrique.

Le service refuse les doublons avant écriture. Il cherche aussi les anciennes arêtes
symétriques éventuellement enregistrées dans le sens opposé. L'unicité SQL actuelle sur
`(fromEntityId, toEntityId, relationTypeId)` intercepte deux créations concurrentes qui passent
par cette normalisation. Une course résiduelle reste possible si un ancien outil écrit
simultanément la même relation symétrique dans l'ordre opposé : cette contrainte SQL est
directionnelle. L'import CLI existant normalise les arêtes symétriques mais n'utilise pas de
verrou commun avec cette route. Une contrainte SQL indépendante du sens pourra être envisagée
si d'autres écrivains concurrents apparaissent.

## Payload et provenance

La demande comporte `fromEntityId`, `toEntityId`, `relationCode`, `description` facultative,
`visibility` facultative, `source` et `evidence`. `source` choisit exactement un mode :
`{ "mode": "existing", "sourceId": "UUID" }` ou `{ "mode": "new", "data": { ... } }`.
La nouvelle Source accepte les mêmes champs et validations que la création manuelle de fiche.
L'Evidence accepte `claimText`, `sourceExcerpt`, `locator`, `timeStartSeconds`,
`timeEndSeconds`, `confidence` et `visibility`, selon les mêmes bornes que v0.5a/v0.4c.
Elle est liée à la nouvelle Relation (`relationId` défini, `entityId = null`) et à la Source
résolue. La Relation, la Source éventuelle et l'Evidence sont écrites dans **une transaction
Prisma unique**. Tout échec annule le lot. Une Source existante n'est jamais modifiée ; une
Source sans `externalId` n'est pas fusionnée sur son label.

Le serveur refuse tout champ interne ou supplémentaire : IDs de relation, `relationTypeId`,
`status`, dates techniques, `metadata`, IDs de cible/Source dans `evidence`. La description est
élaguée, limitée à 10 000 caractères et devient `null` si elle est vide. Les visibilités de
Relation, Source et Evidence sont indépendantes ; chacune vaut `GM` par défaut.

Les deux fiches doivent exister et ne pas être `ARCHIVED`. Les autres statuts sont acceptés.
Une relation vers soi-même est refusée. Les erreurs métier principales sont
`404 FROM_ENTITY_NOT_FOUND`, `404 TO_ENTITY_NOT_FOUND`, `404 RELATION_TYPE_NOT_FOUND`,
`404 SOURCE_NOT_FOUND`, `400 RELATION_SELF_REFERENCE`, `409 ENTITY_ARCHIVED`,
`409 RELATION_CONFLICT` et `409 SOURCE_CONFLICT`. Un catalogue incohérent où un code est à la
fois direct et inverse donne `409 RELATION_TYPE_AMBIGUOUS`. Une référence supprimée entre lecture
et insertion donne `409 RELATION_REFERENCE_CHANGED` ; l'administrateur doit recharger.

La création ne modifie aucune Entity et ne crée aucune `Revision` Entity. Relation n'a pas
encore d'historique de révisions propre ; ses corrections ultérieures utilisent `updatedAt` et
`expectedUpdatedAt`. Le formulaire conserve la saisie après erreur et demande confirmation
avant l'écriture. Les recherches de fiches et de Sources sont paginées et bornées ; elles ne
chargent pas toute la base.

Une Relation `PROPOSED`, même `PUBLIC`, n'apparaît jamais dans l'API publique. Après publication
explicite, elle n'y apparaît que si elle et **ses deux fiches** sont `PUBLISHED + PUBLIC`.
Source et Evidence restent privées.
