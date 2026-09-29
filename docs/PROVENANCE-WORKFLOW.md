# Relations et provenance

Les administrateurs autorisés inspectent et corrigent les données importées depuis une fiche
`/admin/fiches/:slug`. Depuis v0.5b, ils peuvent aussi créer une Relation avec Source et Evidence
initiales ; voir [MANUAL-RELATIONS.md](MANUAL-RELATIONS.md). Aucune suppression n'est disponible.
Les champs d'identité des liens et des preuves restent immuables.

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
| Relation | `description` (null ou texte élagué ≤ 10 000 caractères), `visibility` | Extrémités, sens, type, statut hors actions de publication |
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
