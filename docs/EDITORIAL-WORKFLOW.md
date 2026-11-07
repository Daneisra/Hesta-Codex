# Workflow éditorial

La [mise à jour issue du staging v0.7e](STAGING-UPDATE.md) est un parcours humain distinct,
limité à DRAFT/PROPOSED et à une cible CONFIRMED. Elle bloque toujours PUBLISHED, même si
l’éditeur manuel historique permet son édition. Retirer d’abord sa publication via le workflow
existant, puis préparer à nouveau. Slug, statut et publishedAt restent inchangés pendant une
application de staging ; une modification réelle ajoute exactement une Evidence et une Revision
avec ingestion.action UPDATE. Aucun changement n’écrit rien. Une préparation obsolète ou un
receipt déjà appliqué est refusé. Perte d’accès : ce brouillon de staging et ses erreurs sont effacés.

L'administration `/admin` permet aux Discord IDs autorisés de modifier une `Entity`, de la
publier et de retirer sa publication. Le slug et `metadata` restent en lecture seule.
Les relations, sources et preuves suivent leur workflow dédié ; aucune suppression n'est proposée.

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
de provenance ; celle créée depuis le staging v0.7d conserve son bloc `ingestion` privé.
L'attribution textuelle prend le display name Discord, puis le username.

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

## Création manuelle

Depuis v0.7d, le staging dispose aussi d’un parcours explicite de préparation puis création
humaine. La Source existante est conservée ; Entity PROPOSED, Evidence, Revision #1 et
association CONFIRMED/MANUAL sont écrites dans une seule transaction Serializable, sans
Relation ni publication. La première révision trace le snapshot/receipt et leurs dates.
Les versions suivantes héritent de l’association sans modifier la fiche.
Voir [STAGING-CREATION.md](STAGING-CREATION.md).

Depuis v0.5a, un administrateur peut créer une fiche avec une Source et une Evidence initiale.
La fiche reçoit `PROPOSED`, `publishedAt = null` et `GM` par défaut. Une `Revision #1` est
créée avec le même format de snapshot Entity version 1 que les éditions ultérieures ; son
auteur est l'administrateur authentifié. Création, provenance et révision sont atomiques.
La création ne publie jamais la fiche. Voir [MANUAL-CREATION.md](MANUAL-CREATION.md).

Depuis v0.5b, une Relation peut également être créée depuis une fiche non archivée, avec une
Source et une Evidence initiales. Elle reste `PROPOSED` ; les fiches et leurs Revision ne sont
pas modifiées. Voir [MANUAL-RELATIONS.md](MANUAL-RELATIONS.md).

v0.5c permet d'ajouter une Evidence à une fiche ou relation existante. Cette opération enrichit
sa provenance sans modifier le contenu éditorial, le statut, la visibilité ou les Revision de
la cible. Aucune publication automatique ne résulte d'une nouvelle preuve. Une fiche archivée
et une relation archivée ou reliée à une fiche archivée restent en lecture seule pour cet ajout.

## Validation groupée depuis le tableau de bord

Le bouton **Validation groupée** ouvre `/admin/validation-groupee`, avec deux opérations
distinctes. Le mode **Valider en conservant les visibilités** permet de passer plusieurs
fiches de `PROPOSED` à `PUBLISHED` sans changer leur visibilité.
**Une fiche GM/MJ reste privée.** Dans ce mode, les éléments qui étaient déjà `PUBLIC` exigent une seconde confirmation
explicite : leur validation peut les rendre visibles dans la bibliothèque publique.

1. Choisir l’opération **Valider en conservant les visibilités**, puis sélectionner
   les fiches ou **Tout sélectionner parmi les fiches affichées**.
   Le filtre initial montre les propositions ; les choix restent sélectionnés quand
   les filtres changent. Le compteur indique la sélection complète, pas seulement
   les lignes visibles. **Effacer la sélection** repart de zéro.
2. Cocher éventuellement **Inclure les relations entrantes et sortantes admissibles**.
   Chaque relation est incluse une seule fois, même si ses deux fiches sont sélectionnées.
   Les deux fiches doivent être déjà publiées ou validables dans ce même lot : une
   fiche voisine hors sélection n’est jamais publiée implicitement. Sélectionner une
   fiche déjà publiée permet de valider uniquement ses relations.
3. Cliquer **Examiner le bilan**. Le bilan distingue les fiches et relations prêtes,
   bloquées et déjà publiées, avec titre, slug, visibilité conservée, nombre de preuves
   et motif. Une fiche sans preuve directe ou dont les champs sont invalides est bloquée.
   Une relation sans preuve, réflexive, non proposée ou dont une fiche n’est pas prête
   est bloquée. Les éléments déjà publiés sont ignorés sans révision supplémentaire.
4. Examiner les listes, cocher la confirmation humaine et, si nécessaire, celle des
   éléments déjà `PUBLIC`, puis **Confirmer la validation groupée**. Annuler ferme
   le bilan sans écriture. Toute modification de la sélection ou de l’option relations
   invalide le bilan et ses confirmations.

Seuls les éléments **prêts** du bilan approuvé sont écrits. Les éléments bloqués ou
déjà publiés restent inchangés. Les règles et fonctions de publication individuelle
sont réutilisées : chaque fiche nouvellement validée reçoit `publishedAt`, un nouveau
`updatedAt` et sa révision humaine habituelle. Comme dans le workflow individuel,
publier une relation ne crée pas de `Revision` Entity. Ni Markdown, alias, tags,
visibilités, preuves, Sources, associations ni données du staging ne sont modifiés.
Les wikilinks ne sont pas convertis en relations éditoriales.

### Changer la visibilité de la sélection

Dans le même écran, choisir **Changer la visibilité de la sélection**, puis choisir
explicitement une cible : **PUBLIC**, **Joueurs**, **MJ** ou **Secret**. Aucune cible
n’est présélectionnée. Sélectionner les fiches et inclure éventuellement leurs relations
entrantes et sortantes. Le filtre **Publiée** ou **Tous** permet d’inclure les fiches
déjà validées.

Le bilan montre les visibilités **avant → après**, les éléments bloqués et ceux déjà
à la visibilité choisie, ainsi que l’effet immédiat sur la bibliothèque publique :
fiches et relations nouvellement visibles ou masquées. Cet effet inclut les relations
déjà publiées `PUBLIC` dont la visibilité effective change parce qu’une fiche devient
publique ou privée, même quand l’option d’édition des relations est décochée.
Ces relations incidentes entrent aussi dans l’empreinte de contrôle du bilan.

Après examen, confirmer le changement. Le passage en **PUBLIC** requiert toujours une
confirmation supplémentaire, vérifiée aussi par l’API. Changer la cible, l’opération,
la sélection ou l’option relations annule l’aperçu et ses confirmations. Annuler n’écrit rien.

Cette opération conserve les statuts et les dates `publishedAt` : une proposition reste
proposée et un brouillon reste brouillon, même marqué `PUBLIC`. Les fiches déjà publiées
passant en `PUBLIC` deviennent visibles avec leur contenu et leurs images. Une relation
publique ne devient visible que si elle est publiée et que ses deux fiches sont publiques
et publiées. Les fiches voisines hors sélection, Sources, preuves et données d’ingestion
gardent leur visibilité ; aucune publication de preuve n’est déduite de celle d’une fiche.

Les fiches archivées ou invalides, et les relations archivées ou liées à une fiche archivée,
restent bloquées. Un élément déjà à la cible est ignoré sans révision. Une preuve n’est
pas requise pour changer une visibilité, comme dans l’édition habituelle ; elle reste
obligatoire pour la validation des statuts. Chaque fiche effectivement modifiée reçoit
un nouvel `updatedAt` et sa révision humaine, sans réécriture du Markdown. Les relations
conservent leur type, leur sens et leur statut. Toute erreur annule l’ensemble du lot.

La préparation s’effectue dans une transaction **RepeatableRead en lecture seule**.
L’application recalcule le bilan et son SHA-256 dans une transaction **Serializable**
avant toute écriture. Une modification de fiche, preuve, Source, extrémité ou relation
impliquée, ainsi qu’une nouvelle relation incidente, invalide l’empreinte et retourne
`409 PUBLICATION_MODIFIED`. Une erreur durant les écritures annule tout le lot, y
compris les statuts, dates et révisions. Aucun réessai automatique n’applique un bilan
ancien ; recalculer et confirmer à nouveau. Une relance après succès ignore les
éléments déjà validés ; une seconde soumission de l’ancien bilan est refusée.

API administrateur Discord, même contrôle de session/whitelist/Origin et `no-store` :

- `GET /api/admin/publication-batches/candidates` : catalogue léger de sélection,
  sans contenu Markdown ni preuve détaillée.
- `POST /api/admin/publication-batches/preview` : `{entityIds, includeRelations}` pour
  valider les statuts ; ajouter `targetVisibility` (`PUBLIC`, `PLAYERS`, `GM`, `SECRET`)
  pour changer uniquement les visibilités.
- `POST /api/admin/publication-batches/apply` : mêmes paramètres, `fingerprint`,
  `confirm: true`, `confirmPublic: boolean`. L’auteur vient exclusivement de la session.
  Réponse : `{entities, relations}`, nombres réellement validés.
  Avec `targetVisibility`, ces nombres désignent les éléments dont la visibilité a changé.
  L’opération et la cible sont incluses dans le SHA-256 : un bilan d’une autre opération
  ou d’une autre cible ne peut pas être réutilisé.

Les listes d’identifiants sont strictes, uniques et limitées à **500 fiches par
transaction**, ce qui inclut le corpus actuel de 144 fiches. Le catalogue de sélection
est limité à 2 000 fiches, et un bilan à 10 000 relations incidentes ; un dépassement
produit une erreur explicite sans résultats tronqués ni écriture. Ces garde-fous ne
constituent aucun plafond global de stockage ni limite à 200 relations.
Aucune migration ou nouvelle table n’est nécessaire.

Validation locale du 7 novembre 2026 : **952 tests réussis (535 API + 417 web)**,
dont 29 nouveaux tests. Lint, typecheck, build, Prisma validate/generate et
`git diff --check` passent. Les tests de base utilisent exclusivement PGlite en
mémoire et des données fictives ; le lot de 144 fiches et 200 relations est couvert.
Les tests de composants couvrent la sélection, les blocages, l’annulation, les deux
confirmations, les erreurs/session expirée, le double clic et l’actualisation du
tableau de bord. Les suites web sont exécutées avec deux workers et des délais
adaptés à Windows, sans exclusion de test.
Le navigateur de contrôle était indisponible : une recette visuelle interactive
reste à effectuer avant déploiement. Le build conserve son avertissement existant
sur le chunk principal supérieur à 500 kB. Aucun accès au VPS, à un coffre privé
ou à une base réelle n’a été effectué pendant ce développement.

Extension de visibilité, validation locale du 8 novembre 2026 : **969 tests réussis
(545 API + 424 web)**. Lint, typecheck, build, Prisma validate/generate et
`git diff --check` passent. Le lot fictif de 144 fiches et 200 relations est validé,
puis passé en PUBLIC dans deux transactions distinctes ; les dates de publication
restent identiques. Les tests couvrent aussi le retour vers une visibilité privée,
les relations déjà publiques non modifiées, les preuves/Sources conservées, les
archives, les bilans périmés, les confirmations côté API et le rollback intégral.
Un test existant de rechargement de relation attend maintenant la fin de la notification
asynchrone ; un cas supplémentaire vérifie le rechargement immédiat à version inchangée.
Le code de l’éditeur de relations n’a pas été modifié. Le navigateur de contrôle
reste indisponible ; la recette visuelle interactive est encore à effectuer.
