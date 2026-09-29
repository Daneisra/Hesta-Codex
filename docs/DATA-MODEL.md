# Modèle de données initial

Le schéma est dans [`prisma/schema.prisma`](../prisma/schema.prisma). La première migration
PostgreSQL est dans `prisma/migrations/20260928000000_initial_lore_model/`. Le Codex garde
le lore durable ; les coordonnées et le rendu restent dans Carte Hesta, et les règles
d'armure restent dans Système PA.

## Principes

- Chaque fiche et chaque relation possède un UUID stable. Le slug unique sert aux URL ;
  changer un titre ne change ni l'UUID ni les liens relationnels.
- Le texte narratif est en Markdown. Les types, relations, sources et preuves sont des
  colonnes et tables relationnelles ; `metadata` JSONB sert uniquement aux variantes
  encore non stabilisées. Le JSON libre n'est pas exposé par l'API publique tant que ses clés
  publiques ne sont pas définies. Les snapshots JSONB de `Revision` servent à l'historique.
- `DRAFT`, `PROPOSED`, `PUBLISHED` et `ARCHIVED` sont les statuts éditoriaux. Un import ou
  une extraction IA reste `PROPOSED` jusqu'à validation humaine ; `PUBLISHED` désigne le canon.
- `PUBLIC`, `PLAYERS`, `GM` et `SECRET` sont des niveaux de visibilité, avec `GM` par défaut.
  Sans authentification, l’API de lecture expose seulement les fiches et relations à la fois
  `PUBLISHED` et `PUBLIC`. Les fiches voisines doivent respecter la même règle. Sources,
  preuves et révisions ne sont pas encore exposées par l’API.
- Les suppressions physiques de fiches, sources, arêtes ou types référencés sont interdites
  par des clés étrangères `ON DELETE RESTRICT`. Les UUID référencés ne peuvent pas changer
  (`ON UPDATE RESTRICT`). Archiver une fiche conserve son historique.

## Tables

| Table | Rôle | Champs et relations essentiels |
| --- | --- | --- |
| `Entity` | Fiche canonique générique | `kind`, `placeKind?`, `slug`, titre, résumé, Markdown, alias, tags, metadata, statut, visibilité, dates ; relations entrantes/sortantes, preuves et révisions. |
| `RelationType` | Catalogue contrôlé | `code` unique, libellé, `inverseCode?` unique, libellé inverse, `symmetric` ; aucune fiche lore. |
| `Relation` | Arête orientée | `fromEntityId` → `toEntityId`, `relationTypeId`, description, statut, visibilité, dates ; preuves. |
| `Source` | Document ou origine | Type (`MANUAL`, `OBSIDIAN`, `DISCORD`, `HESTA_MAP`, `YOUTUBE`, `AI_DERIVED`, `OTHER`), identifiant externe et URL facultatifs, auteur, metadata ; une source dérivée peut référencer sa source d'origine. Aucune clé étrangère vers une autre application. |
| `Evidence` | Fait précis soutenu par une source | Une source, exactement une fiche ou une relation, énoncé, extrait, repère et timestamps facultatifs, confiance facultative, dates de création/modification. |
| `Revision` | Historique d'une fiche | Numéro par `Entity`, snapshot, message et attribution textuelle facultative. |
| `User` | Identité Discord minimale pour l'administration | Discord ID unique, username, display name facultatif ; aucun rôle persistant. |
| `Session` | Session serveur révocable | Hash unique du token de cookie, utilisateur, création et expiration ; aucun jeton OAuth Discord conservé. |

La création admin v0.5b résout `inverseCode` vers le type canonique en échangeant les UUID.
Pour un type symétrique, elle ordonne les UUID avant insertion ; une seule arête est stockée.
L'unicité SQL directionnelle reste inchangée. Elle protège les créations concurrentes qui
suivent cette normalisation, mais pas un outil tiers écrivant simultanément le sens opposé.
Une Entity `ARCHIVED` ne peut être ni départ ni cible d'une nouvelle Relation. La création
de Relation ne produit aucune `Revision` Entity.

`Entity.kind = PLACE` exige `placeKind` ; pour toute autre valeur de `kind`, `placeKind`
est null. Les valeurs initiales de `PlaceKind` sont `CITY`, `CONTINENT`, `REGION`, `SEA`,
`OCEAN` et `OTHER`. `SESSION` est une fiche décrivant une partie JDR ; son enregistrement
YouTube est une `Source`, éventuellement citée par une `Evidence` horodatée.

Une arête est stockée une seule fois dans son sens canonique. `parent_of` peut exposer
`child_of` et son libellé pour la lecture inverse sans créer une deuxième arête.
`allied_with` est symétrique et réutilise le même code dans les deux sens. Le seed
idempotent crée ces quatre types, sans contenu lore.

## Contraintes et index

Prisma définit les clés étrangères, index et contraintes d'unicité suivants :

- `Entity.slug`, `RelationType.code` et `RelationType.inverseCode` sont uniques ;
- `(Source.kind, Source.externalId)` est unique lorsque l'identifiant externe existe ;
- `(Relation.fromEntityId, Relation.toEntityId, Relation.relationTypeId)` évite les
  doublons exacts d'arêtes ;
- `(Revision.entityId, Revision.number)` ordonne les révisions sans doublon ;
- les deux extrémités de `Relation`, son type, les trois références d'`Evidence`,
  `Source.derivedFromSourceId`, ainsi que les filtres `kind/placeKind` et
  `status/visibility` disposent d'index utiles à la navigation et aux backlinks.
- `User.discordId` et `Session.tokenHash` sont uniques. `Session.userId` et
  `Session.expiresAt` sont indexés. Une suppression explicite de `User` révoquerait ses
  sessions, sans toucher aux données de lore.

Les contraintes SQL suivantes sont ajoutées à la migration, car le schéma Prisma ne les
exprime pas directement :

- `Entity_placeKind_matches_kind_check` : `placeKind` présent si et seulement si
  `kind = PLACE` ;
- `Entity_publishedAt_required_check` : une fiche `PUBLISHED` a un `publishedAt` non null.
  Le service métier fixe cet instant lors de la publication, le conserve pendant l'édition
  d'une fiche publiée et le remet à null lors du retrait de publication ;
- `Evidence_exactly_one_target_check` : `entityId` ou `relationId`, exclusivement ;
- `Evidence_time_start_nonnegative_check`, `Evidence_time_end_nonnegative_check` et
  `Evidence_time_order_check` : bornes positives et fin non antérieure au début ;
- `Evidence_confidence_range_check` : confiance entre 0 et 1 si renseignée ;
- `RelationType_symmetric_inverse_check` et `RelationType_distinct_codes_check` : un type
  symétrique n'a pas de code/libellé inverse, et un code inverse diffère du code direct ;
- `Revision_positive_number_check` : numérotation à partir de 1.

La base ne peut pas garantir qu'une fiche publiée possède au moins une `Evidence` sans
déclencheur supplémentaire. Le service éditorial v0.4b vérifie cette présence avant de
publier, puis écrit l'Entity et sa Revision dans une transaction. Il devra également
prévenir les collisions entre un `code` et l'`inverseCode` d'un autre type.

## Reporté

Permissions fines, création/suppression des relations/sources/preuves, connecteurs d'import, révisions des relations, dates structurées
du calendrier d'Hesta, recherche plein texte, extraction des `[[wikilinks]]` et calcul du
graphe affiché. Les UUID, index, alias, Markdown et relations orientées en préparent la base.

Référence : `Hesta-Hub/docs/HESTA-CODEX-ARCHITECTURE.md` dans le dépôt voisin.

L'import JSON contrôlé de v0.3 est décrit dans [IMPORT.md](IMPORT.md). Il crée uniquement
des propositions et une `Revision` initiale pour chaque nouvelle `Entity` ; les révisions
des `Source` et `Relation` restent reportées conformément au schéma actuel.

La migration `20260928120000_discord_auth_sessions` ajoute uniquement `User` et `Session`.
L'accès admin v0.4a repose sur la whitelist Discord externe au modèle ; voir [AUTH.md](AUTH.md).

Le workflow d'édition/publication v0.4b utilise les modèles et contraintes existants, sans
migration supplémentaire. Voir [EDITORIAL-WORKFLOW.md](EDITORIAL-WORKFLOW.md).

v0.4c ajoute `Evidence.updatedAt` pour la concurrence optimiste, avec une migration additive
qui initialise les preuves existantes à leur `createdAt`. `Relation` et `Source` disposaient
déjà de ce champ. Voir [PROVENANCE-WORKFLOW.md](PROVENANCE-WORKFLOW.md). `Revision` reste liée
uniquement à `Entity` ; les corrections des autres modèles n'ont pas encore d'audit détaillé.

v0.5a utilise le schéma existant sans migration. Une création manuelle admin lie
obligatoirement une nouvelle `Entity` à une `Source` existante ou nouvelle par une `Evidence`
et produit `Revision #1` dans la même transaction. La fiche commence en `PROPOSED`, avec
`publishedAt = null` et `visibility = GM` par défaut. Voir [MANUAL-CREATION.md](MANUAL-CREATION.md).
