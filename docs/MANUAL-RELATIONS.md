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

## Création assistée depuis Obsidian

Les listes « Fiches mentionnées » et « Fiches qui mentionnent cette fiche » proposent
« Définir une relation » pour une destination résolue, distincte et non archivée.
L’action ouvre le même formulaire et utilise le même `POST /api/admin/relations`.
Une référence entrante conserve le sens original : la fiche contenant le wikilink est
le départ. Les UUID et slugs des deux fiches permettent de vérifier les homonymes.
« Inverser les fiches » corrige le sens ; les options inverses du catalogue normalisent
toujours le stockage côté serveur. Aucun type n’est choisi automatiquement.

La provenance est calculée depuis l’association Obsidian confirmée de la note contenant
la mention, jamais depuis le nom de la cible. Une origine unique Source/chemin permet
de proposer le repère (250 caractères maximum et sans espaces périphériques requis,
sinon laissé vide plutôt que modifié par la validation existante) et
un fragment exact du Markdown autour de la première occurrence résolue vers cette fiche
(180 caractères de contexte de chaque côté, espaces périphériques retirés ; aucun extrait
si le wikilink dépasse 4 000 caractères). Plusieurs origines distinctes laissent ces
champs vides. La Source n’est présélectionnée que si elle est aussi vérifiée dans les
preuves de la note et de type `OBSIDIAN`. Sinon, elle doit être choisie manuellement.
Le formulaire reste entièrement éditable ; changer la cible efface l’extrait et l’énoncé
pour ne pas attribuer la mention initiale à une autre destination.

Après choix du type, « Utiliser cet énoncé » propose une formulation à vérifier et à
modifier. Ce texte n’est pas une citation ni une preuve automatique de sa signification.
La création exige toujours une Source, une Evidence et une confirmation du récapitulatif.
Relation et Evidence sont `GM` par défaut ; la Relation reste `PROPOSED`.

La sélection assistée reste en mémoire React, sans paramètres d’URL, état d’historique
ou stockage navigateur. Un rechargement ouvre donc le formulaire manuel classique.
Après réussite, le parcours revient à la fiche où la référence a été sélectionnée,
relit ses relations et conserve ses références automatiques. Les relations existantes
sont signalées dans la liste. Le même type et le même sens sont bloqués dans le formulaire ;
un autre type peut être choisi explicitement. Un conflit concurrent recharge les relations
sans effacer la saisie. Le verrou immédiat du bouton et l’unicité transactionnelle évitent
les doubles créations, y compris lors d’une relance après perte de réponse réseau.

Les références absentes, ambiguës, sans fiche associée et les auto-références ne proposent
aucune création directe. Un archivage/suppression après ouverture est aussi vérifié côté
serveur. Aucun Markdown, association, Source existante ou Revision Entity n’est modifié.
Le graphe admin garde les deux types de connexions ; les filtres et protections du graphe
public restent inchangés. Aucun traitement groupé ou migration n’est ajouté.

La revue locale utilise des notes et Sources fictives, des stores transactionnels simulés
et un navigateur Edge avec API locale simulée : aucune base réelle ni coffre privé n’est
consulté. Les contrôles couvrent les deux directions, les homonymes, les types inverses et
symétriques, la provenance exacte, les doublons/conflits, une réponse perdue après création,
les sessions expirées et les protections publiques. Le parcours et le graphe de 130 fiches /
296 références sont vérifiés à 1920 × 1080, 3840 × 2160, 768 × 1024 et 390 × 844.
Ces simulations ne remplacent pas la vérification humaine du sens des relations ni une
recette après déploiement avec la session Discord réelle.

Dans cette session Windows, les délais DOM standards ont provoqué des dépassements,
y compris dans les suites antérieures. La suite complète (412 tests API et 284 tests web)
a ensuite réussi avec une configuration temporaire hors dépôt : attente DOM de 10 secondes
et délai par test de 60 secondes, sans exclusion ni modification des assertions.
La configuration de tests du dépôt reste inchangée.
