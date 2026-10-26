# Relations et provenance

Les administrateurs autorisés inspectent et corrigent les données importées depuis une fiche
`/admin/fiches/:slug`. Depuis v0.5b, ils peuvent aussi créer une Relation avec Source et Evidence
initiales ; voir [MANUAL-RELATIONS.md](MANUAL-RELATIONS.md). Les relations existantes peuvent
changer de type ou être inversées, en conservant leur identifiant et leurs preuves.
La suppression individuelle d'une fiche est décrite dans [ENTITY-DELETION.md](ENTITY-DELETION.md).
Les identifiants des liens et l'identité/cible des preuves restent immuables.

## Corriger une relation existante

Depuis `/admin/fiches/:slug`, le bouton **Modifier la relation** est directement visible
sur chaque ligne des relations sortantes ou entrantes. Il ouvre le même éditeur, même si
les preuves différées ne peuvent pas être chargées. Les fiches archivées et les relations
archivées restent en lecture seule.

Le champ **Type et sens** reprend les formulations directes/inverses du catalogue réel.
**Inverser les fiches** permet de corriger qui agit sur qui. La phrase **Après** et les deux
slugs rendent le sens explicite, y compris pour des homonymes. Pour un type symétrique,
inverser les fiches est sans objet et le bouton est désactivé.

Un changement de type ou de sens demande **Vérifier la modification**, puis **Confirmer la
modification** après le récapitulatif avant/après. Annuler et revenir au formulaire restent
possibles. Une correction de description/visibilité seule garde l'action Enregistrer existante.
Le refus serveur conserve la saisie ; la confirmation est protégée contre les doubles clics.

L'API `PATCH /api/admin/relations/:id` conserve le corps obligatoire `description`, `visibility`,
`expectedUpdatedAt`, et accepte désormais `relationCode` et `reverse` facultatifs. `reverse`
échange les extrémités **du sens stocké**, indépendamment de la fiche depuis laquelle on édite.
Le code inverse est ensuite normalisé comme à la création ; deux inversions équivalentes
ne modifient pas la relation. Les types symétriques sont normalisés sans créer de seconde ligne.
Le client ne peut fournir ni nouveaux UUID d'extrémités, ni `relationTypeId`, ni `status`.

Une transaction met à jour la ligne existante sans recréer la relation. Son ID, ses preuves,
ses Sources, les révisions Entity, les associations et tout le staging sont conservés.
Les énoncés des preuves ne sont **pas réécrits automatiquement** : l'éditeur doit vérifier
leur cohérence et peut les corriger via Modifier la preuve. Aucun contenu de lore n'est fabriqué.
Une correction de type/sens sur une relation publiée la remet en `PROPOSED`, sans changer sa
visibilité, puis demande une nouvelle publication explicite. Les modifications de métadonnées
seules conservent le comportement précédent. Une lecture équivalente est sans écriture.

Le timestamp initial reste figé pendant l'édition : une version concurrente donne
`409 RELATION_MODIFIED`. Les doublons donnent `409 RELATION_CONFLICT`, y compris les anciennes
relations symétriques dans l'autre sens. Le contrôle applicatif est doublé de l'unicité SQL ;
aucune fusion n'est automatique et un échec annule aussi la description et la visibilité.
Type inconnu : `404 RELATION_TYPE_NOT_FOUND` ; code ambigu : `409 RELATION_TYPE_AMBIGUOUS`.
Les protections admin Discord, Origin exacte et `Cache-Control: no-store` restent inchangées.
Cette correction ne nécessite aucune migration et ne modifie pas les références Obsidian.

## Enrichissement v0.5c

Sur une fiche ou relation existante, « Ajouter une preuve » associe une Source existante ou
crée une Source puis une Evidence. La cible Entity ou Relation et l'ID de Source sont décidés
par l'API, jamais par le corps de requête. La Source existante n'est pas modifiée. Une nouvelle
Source avec `(kind, externalId)` déjà utilisé donne `409 SOURCE_CONFLICT` ; sans identifiant
externe, un label semblable ne provoque pas de fusion automatique. La Source et la preuve sont
écrites dans une transaction. Un échec de la preuve annule également la nouvelle Source.

La même cible, la même Source et les mêmes `claimText`, `sourceExcerpt`, `locator`,
`timeStartSeconds` et `timeEndSeconds` constituent un doublon certain : `409 EVIDENCE_CONFLICT`.
`confidence` et `visibility` ne distinguent pas un nouveau passage ; corriger la preuve
existante permet de les changer. Deux Sources distinctes peuvent soutenir le même énoncé.
L'interface signale un doublon probable quand une preuve de la même Source a le même énoncé
ou le même repère temporel, sans empêcher une preuve effectivement différente. L'API verrouille
la ligne cible avant la recherche du doublon et l'insertion, afin de sérialiser les ajouts
concurrents via ces routes. Les anciens outils d'écriture non coordonnés ne bénéficient pas de
ce verrouillage ; aucune contrainte d'unicité SQL n'existe encore sur les longs textes Evidence.

Une Entity `ARCHIVED` refuse l'ajout de provenance. Une Relation `ARCHIVED`, ou dont l'une des
deux fiches est `ARCHIVED`, le refuse aussi. L'ajout ne change ni Entity ni Relation et ne crée
aucune Revision. Il ne publie aucun objet. La section admin regroupe séparément les preuves
directement liées à la fiche et celles de chaque relation, par Source dans chaque bloc. Une
Source utilisée dans les deux blocs apparaît dans chacun pour conserver le contexte de la preuve.
La correction d'une Evidence déjà liée à une fiche ou relation archivée est également refusée.
La Source reste un document indépendant et peut être corrigée depuis une autre fiche où elle
est utilisée ; elle n'est jamais modifiée implicitement par l'ajout d'une preuve.

```text
Source → Evidence → Entity OU Relation

Relation PROPOSED → validation humaine → Relation PUBLISHED
Relation PUBLISHED + PUBLIC + deux Entity PUBLISHED + PUBLIC → relation visible publiquement
```

Une relation publiée ne change ni ses deux fiches, ni ses preuves ou ses sources. Une relation
`PUBLISHED + PUBLIC` reste invisible si l'une de ses fiches n'est pas elle-même `PUBLISHED + PUBLIC`.
Le retrait `PUBLISHED → PROPOSED` la masque immédiatement dans l'API publique. Publier requiert
au moins une `Evidence` directement liée à la relation et deux fiches existantes. Une relation
réflexive est refusée à la publication. Une relation `DRAFT` ou `ARCHIVED` n'est pas publiable ;
une relation archivée est consultable mais non modifiable.

## Champs et validation

| Objet | Champs éditables | Champs immuables dans ce jalon |
| --- | --- | --- |
| Relation | `description` (null ou texte élagué ≤ 10 000 caractères), `visibility`, `relationCode` (facultatif, ≤ 64), `reverse` (booléen facultatif) | ID, paire de fiches hors permutation, statut fourni par le client |
| Source | `kind`, `label` (1–250), `externalId` (null ou 1–250 sans espaces périphériques), `url` (null ou HTTP(S)), `authorLabel` (null ou ≤ 200), `publishedAt` (null ou ISO 8601 avec fuseau), `visibility` | ID, metadata, dérivation |
| Evidence | `claimText` (1–10 000), `sourceExcerpt` (null ou ≤ 100 000), `locator` (null ou ≤ 250), timestamps (null ou entiers ≥ 0), `confidence` (null ou 0–1, trois décimales au plus), `visibility` | ID, Source, cible Entity ou Relation |

La fin temporelle ne peut précéder le début. Les champs supplémentaires sont refusés. Une
`Source` dont `(kind, externalId)` existe déjà donne `409 SOURCE_CONFLICT` ; aucun champ de
l'autre source n'est écrasé. Les `Evidence` conservent la contrainte SQL Entity XOR Relation.
Les repères temporels restent stockés en secondes ; l'interface affiche aussi `HH:MM:SS`.

## Concurrence et sécurité

Chaque formulaire transmet `expectedUpdatedAt`. La mise à jour compare ce timestamp dans la
condition SQL de l'écriture ; une modification concurrente donne `409 *_MODIFIED`. Une
sauvegarde sans changement n'écrit rien. Chaque action est une transaction Prisma. L'interface
garde la saisie en cas de conflit et demande une confirmation avant de la jeter. Les mutations
requièrent la session admin Discord et l'`Origin` exacte de l'application ; une Origin absente
est refusée. Les réponses portent `Cache-Control: no-store`.

`Revision` reste réservé à `Entity`. Les modifications de Relation, Source et Evidence possèdent
`createdAt`/`updatedAt`, sans auteur ni historique de versions. Un audit détaillé de ces modèles
est reporté à un jalon ultérieur. Aucun contenu de ces trois modèles n'est exposé via l'API
publique, à l'exception d'une Relation qui remplit toutes les conditions de visibilité ci-dessus.

## Migration

`20260928130000_evidence_updated_at` ajoute seulement `Evidence.updatedAt TIMESTAMPTZ(3)`.
Les preuves existantes reçoivent initialement leur `createdAt`, puis la colonne devient non nulle.
La migration ne touche aucune autre table ni les autres champs des preuves. Elle sera appliquée
par `prisma migrate deploy` lors d'un déploiement ultérieur ; aucun développement local ne
l'applique au VPS.

## Validation initiale de la correction du type et du sens — 26 octobre 2026

Cet éditeur est également accessible directement depuis les relations existantes
de la [file « Relations à qualifier »](REFERENCE-QUALIFICATION.md#modifier-une-relation-déjà-qualifiée),
y compris lorsqu'une paire est déjà qualifiée.

Les suites complètes réussissent : **796 tests**, dont **453 API** et **343 web**
(19 tests ajoutés). Sous Windows, les workers Vitest ont été exécutés avec
`--pool threads --maxWorkers 2`, le démarrage du pool `forks` expirant sur cet hôte.
Lint, typecheck, build, Prisma validate/generate et `git diff --check` sont concluants.
Le build conserve un avertissement sur le chunk principal de 509,40 kB.

Un essai navigateur sur des données entièrement fictives, à 1920 × 1080 et
390 × 844, vérifie l'action visible sur la ligne compacte, l'inversion, l'aperçu,
l'absence d'écriture avant confirmation, puis le rafraîchissement du sens entrant.
Aucun débordement horizontal ni erreur JavaScript n'a été détecté.
Les tests transactionnels utilisent une base PGlite en mémoire ; aucune base réelle
n'est sollicitée. Cette correction n'ajoute aucune migration.
