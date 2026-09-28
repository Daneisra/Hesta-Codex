# Workflow éditorial v0.4b

L'administration `/admin` permet aux Discord IDs autorisés de modifier une `Entity`, de la
publier et de retirer sa publication. Le slug, `metadata`, les relations, les sources et les
preuves restent en lecture seule. Aucune création ou suppression de fiche n'est proposée.

## Statuts et visibilité

| Statut | Comportement v0.4b |
| --- | --- |
| `DRAFT` | Fiche modifiable ; aucun passage vers `PROPOSED` dans ce jalon. |
| `PROPOSED` | Fiche modifiable et publiable après contrôle humain et présence d'au moins une Evidence liée à la fiche. |
| `PUBLISHED` | Fiche modifiable ou retirable de la publication. `publishedAt` reste conservé pendant une édition. |
| `ARCHIVED` | Consultation seule. |

Une fiche est accessible dans la bibliothèque et l'API publiques uniquement si **son statut est
`PUBLISHED` et sa visibilité est `PUBLIC`**. Une fiche `PUBLISHED + GM`, `PLAYERS` ou `SECRET`
reste invisible publiquement. Publier une fiche ne modifie ni son niveau de visibilité ni les
statuts/visibilités de ses relations : les relations importées `PROPOSED + GM` restent privées.

## Édition et révisions

`PATCH /api/admin/entities/:slug` édite `title`, `summary`, `bodyMarkdown`, `kind`,
`placeKind`, `aliases`, `tags` et `visibility`. Le body envoyé est complet, validé strictement
par Zod ; les propriétés inconnues sont refusées. Le titre est élagué et limité à 200 caractères, le résumé à 500,
le Markdown à 100 000, les alias à 30 valeurs de 200 caractères et les tags à 30 valeurs
de 100 caractères. Les valeurs vides ou dupliquées sans distinction de casse sont refusées.
`placeKind` est obligatoire seulement pour `PLACE` et doit être `null` autrement.

Le client transmet `expectedUpdatedAt`, obtenu lors de la lecture de la fiche. Si la fiche a
changé depuis cette lecture, l'API répond `409 ENTITY_MODIFIED` et l'interface propose de
recharger sans effacer la saisie tant que l'administrateur ne le confirme pas ; il n'y a pas de
fusion automatique. Si la session expire pendant la sauvegarde, l'API répond `401` : le
formulaire conserve localement la saisie affichée, bloque l'enregistrement et invite à la copier
avant une reconnexion. Elle ne survit pas à un rechargement confirmé ou à la reconnexion.
Chaque modification réelle, publication ou retrait écrit l'Entity et une Revision dans la même
transaction PostgreSQL. Une sauvegarde sans changement ne crée pas de Revision. Le numéro est le maximum existant + 1 ; le snapshot
`{ version: 1, entity: { ... } }` contient l'état complet **après** l'action, sans Source,
Evidence, Relation ou `metadata`. La première révision importée conserve son bloc `import`
de provenance. L'attribution textuelle prend le display name Discord, puis le username.

## Actions explicites

- `POST .../publish` accepte uniquement `PROPOSED`, vérifie les champs et au moins une Evidence
  de l'Entity, puis fixe `PUBLISHED` et `publishedAt`. Si la visibilité est `PUBLIC`, la fiche
  devient immédiatement publique. L'interface demande une confirmation distincte pour ce cas.
- `POST .../unpublish` accepte uniquement `PUBLISHED`, puis fixe `PROPOSED` et remet
  `publishedAt` à `null`. Une fiche auparavant publique disparaît immédiatement de l'API
  publique. Aucune donnée historique n'est supprimée.
- Une édition d'une fiche `PUBLISHED + PUBLIC` change immédiatement la version visible.
  L'interface le signale avant la sauvegarde.

Les trois mutations demandent une session admin valide et un `Origin` exactement égal à
l'origine configurée par `DISCORD_REDIRECT_URI`. Une Origin absente est refusée. Aucun CORS
permissif n'est ouvert. Les réponses admin portent `Cache-Control: no-store`.

Les modifications de slug, les brouillons séparés des fiches publiées, l'archivage, les diffs
et la restauration de révisions sont reportés. L'édition contrôlée des relations, sources et
preuves est décrite dans [PROVENANCE-WORKFLOW.md](PROVENANCE-WORKFLOW.md) ; elle ne crée pas de
`Revision` Entity.
