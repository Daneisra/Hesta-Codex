# Ingestion générique, staging, détection et associations — v0.7a/v0.7b/v0.7c

Depuis v0.7e, un parcours admin distinct permet une [mise à jour humaine](STAGING-UPDATE.md)
d’une fiche DRAFT/PROPOSED ayant une association CONFIRMED. L’ingestion reste sans mutation
éditoriale ; la comparaison conserve les champs actuels et seuls les boutons explicites
reprennent le staging. Après récapitulatif, une application réelle ajoute Evidence/Revision
et modifie la fiche, sans toucher au staging, à la Source ou à l’association. Aucune publication.

Le staging conserve du contenu externe **privé admin**, avant toute interprétation éditoriale.
La commande ne détecte ni fiche ni relation et n'appelle aucune IA ou application externe.
Elle ne crée aucune Entity, Relation, Evidence ou Revision et ne publie rien.

| Commande | Entrée | Sortie |
| --- | --- | --- |
| `lore:import` | JSON déjà structuré avec provenance et références explicites | Entity/Relation PROPOSED, Evidence et Revision initiales ; workflow inchangé |
| `lore:ingest` | Texte externe brut et provenance | Sources et staging uniquement |

## Modèle et migration

`IngestionBatch` représente une exécution réussie : UUID, libellé, version de format,
comptes reçus/nouveaux/inchangés/modifiés, nombre d'avertissements et date de création.
Les lots invalides ou échoués ne sont pas conservés partiellement.

`IngestionItem` est un **snapshot immuable de contenu** : UUID, batch de création,
Source existante, identifiant externe facultatif, clé d'identité, version, SHA-256,
texte brut exact du snapshot et date d'ingestion. Aucune méthode d'édition/suppression
du staging n'est exposée ; l'immuabilité est un invariant du service.

`IngestionReceipt` associe chaque élément reçu au batch et au snapshot : UUID, ordinal,
résultat NEW/UNCHANGED/MODIFIED, titre, locator, format, date externe `observedAt`, metadata
et date de réception. Elle conserve une `rawVariant` seulement si le texte reçu diffère
du snapshot alors que son hash normalisé est identique. Ainsi, chaque réception retrouve
son texte exact et ses propres metadata, sans dupliquer le contenu strictement identique.
Les dates automatiques de réception/ingestion sont techniques ; `observedAt` provient du fichier.

La migration `20261004000000_ingestion_staging` ajoute uniquement ces trois tables et
l'enum `IngestionOutcome`. Elle ne modifie aucune donnée ni colonne métier existante.
Les liens vers Source, batch et snapshot utilisent DELETE/UPDATE RESTRICT. Index :
Source/identifiant externe, Source/hash, hash, batch, dates et résultat. L'unicité
`(sourceId, identityKey, version)` empêche deux versions concurrentes portant le même numéro ;
`(batchId, ordinal)` identifie chaque réception. Les CHECK bornent numéros, comptes,
formats de hash, taille du contenu/identifiant et ordinals.

Le SQL est produit hors ligne depuis les schémas Prisma avant/après, puis complété par ces
CHECK. Il reste **à appliquer par le workflow habituel, après revue humaine**. La validation
du schéma/génération du client ne remplace pas un essai de migration sur PostgreSQL de test.

## Format JSON v1

Voir [le template fictif](../examples/lore-ingestion.template.json), sans lore Hesta réel,
jamais chargé automatiquement par le seed, la CI ou un connecteur.

```json
{
  "version": 1,
  "batch": { "label": "Lot technique fictif" },
  "items": [{
    "source": { "kind": "OBSIDIAN", "label": "Coffre fictif", "externalId": "technical-vault" },
    "externalId": "notes/technical.md",
    "title": "Fragment fictif",
    "locator": "notes/technical.md#fragment-1",
    "content": "Texte artificiel reçu exactement comme écrit.",
    "contentType": "text/markdown",
    "observedAt": "2026-10-04T00:00:00Z",
    "metadata": { "fictional": true }
  }]
}
```

La Source peut être `{ "id": "UUID-existant" }`, y compris pour une Source sans externalId.
Sinon elle est une description stricte : `kind`, `label`, `externalId` obligatoires ; `url`,
`authorLabel`, `publishedAt` facultatifs. Les règles éditoriales de Source sont réutilisées.
Une nouvelle description doit avoir un externalId stable : les descriptions sans identité
ne sont pas rapprochées par leur seul libellé. Le couple SourceKind/externalId résout une
Source existante, sans modifier ses descriptions ; les différences de libellé, URL ou auteur
produisent un avertissement.
Les Sources nouvelles restent GM. Une Source existante ne change ni visibilité ni état éditorial.
Tous les SourceKind existants sont acceptés : MANUAL, OBSIDIAN, DISCORD, HESTA_MAP, YOUTUBE,
AI_DERIVED, OTHER. Ils n'activent aucun connecteur ou appel IA.

Pour un item, seuls `source` et `content` sont obligatoires. Les autres champs valent null,
sauf `contentType` qui vaut `text/plain`. Ce format est un indicateur de type MIME sans paramètres,
pas une instruction de parsing. Le locator est conservé comme texte et n'est jamais ouvert.

Bornes : fichier UTF-8 strict de 5 Mio, 1–500 items, contenu non blanc de 256 Kio par item,
externalId d'item de 1 024 octets maximum, titre de 250 caractères, locator de 1 024 caractères,
type MIME de 100 caractères, libellé de batch/Source de 250 caractères, externalId de Source
de 250 caractères et URL HTTP(S) de 2 048 caractères. Les identifiants gardent leurs caractères
et leur casse ; aucun espace périphérique/contrôle n'est accepté. Les titres/locators sont trimés.
Les timestamps ISO portent `Z` ou un décalage explicite et une année entre 0001 et 9999.

Les metadata sont un objet JSON de 16 Kio maximum, profondeur 8, au plus 1 024 valeurs parcourues,
clés de 100 caractères et chaînes de 4 000 caractères. NUL, Unicode mal formé, nombres non finis,
structures trop profondes et champs inconnus des enveloppes sont refusés. Une BOM UTF-8 initiale
est acceptée ; les octets mal encodés sont refusés avant parsing. Les erreurs donnent des chemins
comme `items[2].source.url`, jamais le texte brut fautif. Les noms de champs inhabituels sont masqués.

Le contrôle préalable borne aussi chaque conteneur à 1 024 entrées et l'ensemble des valeurs
parcourues avant Zod. Le service revalide directement les valeurs JSON, sans sérialisation qui
convertirait un nombre non fini en null. La borne de 5 Mio du fichier porte sur les octets reçus,
avant ajout des valeurs par défaut ; un fichier valide à cette borne reste utilisable en dry-run
et en application. Les objets non JSON et le texte cumulé au-delà de 5 Mio sont refusés dans le service.

Les clés de credentials des metadata, clés dangereuses de prototype, credentials dans les URL,
paramètres de tokens et formats de secrets connus sont refusés. Cette défense ne constitue pas
un détecteur universel de secrets dans un texte libre : préparer uniquement un export sans credentials.
Le lore privé, lui, reste autorisé dans le staging admin et n'est pas publié.

## Hash, déduplication et historique

Le hash est SHA-256 des octets UTF-8 du contenu après CRLF/CR → LF et Unicode NFC.
Aucun trim ni changement de casse n'est appliqué au contenu. Espaces, lignes finales et
contenu Markdown restent significatifs ; le texte reçu n'est jamais remplacé par la version normalisée.

La clé technique est `e:` + SHA-256 de l'externalId exact, ou `h:` + hash de contenu sans externalId.
La portée de comparaison est **la même Source UUID**. Deux Sources distinctes ne sont pas fusionnées.

| Situation | Résultat |
| --- | --- |
| Identité jamais ingérée | NEW, snapshot version 1 et réception |
| Même identité et même hash que la dernière version | UNCHANGED, nouveau batch/réception, snapshot réutilisé |
| Même externalId, contenu normalisé différent | MODIFIED, snapshot version précédente + 1 ; ancien contenu intact |
| Retour à un contenu plus ancien | MODIFIED avec une nouvelle version ; la transition reste visible |
| Sans externalId, même Source et même hash | UNCHANGED |
| Sans externalId, contenu différent | NEW : impossible d'identifier une modification sans identité stable |
| Doublons identiques au sein du lot | Première réception NEW/MODIFIED, suivantes UNCHANGED ; un snapshot |
| Même identité, contenus différents au sein du lot | Conflit du lot entier ; séparer en batches chronologiques |

Titre, locator, format, date externe et metadata appartiennent à la réception et ne changent
pas le hash. Une variante NFC/fins de ligne identique au sens du hash est conservée intégralement
dans `rawVariant`, avec un avertissement. Les collisions SHA-256 ne font pas l'objet d'une
gestion spécifique. La comparaison se fait dans l'ordre d'ingestion, pas dans l'ordre `observedAt`.
Les descriptions de Source restent éditables par le workflow existant ; son UUID est la référence
stable. Après changement de son couple kind/externalId, utiliser cet UUID pour continuer la même origine.

## CLI, dry-run et transaction

```bash
npm run lore:ingest -- chemin/vers/fichier.json --dry-run
npm run lore:ingest -- chemin/vers/fichier.json
```

Comme l'import existant, la CLI utilise la configuration locale `DATABASE_URL`. Un dry-run
nécessite une base de test joignable pour comparer les Sources/snapshots existants. Il valide
tout le fichier et calcule les hashes, sans transaction d'écriture ni création de Source/batch.
Le rapport distingue Sources nouvelles/existantes, items reçus/nouveaux/inchangés/modifiés,
ignorés (toujours zéro en v0.7a), erreurs et avertissements. L'application affiche le UUID du batch.
Les logs n'affichent aucun contenu, titre, locator, metadata, URL de connexion ou erreur Prisma brute.
Le code de sortie vaut 1 en cas d'erreur, conflit ou fermeture de connexion non confirmée.

Le service revalide l'entrée, puis résout à nouveau toutes les références **dans** une transaction
Serializable. Tous les accès réels passent par son client transactionnel : Sources, batch,
snapshots et réceptions sont commités ensemble ou intégralement annulés. Les collisions d'unicité
et conflits Serializable sont rejoués depuis une nouvelle transaction, au plus trois tentatives.
Un dry-run reste indicatif si un autre processus ingère entre sa lecture et l'application.
Une réexécution après interruption réseau reste sûre pour les snapshots, mais crée une réception/batch
supplémentaire ; il n'y a pas de clé d'idempotence de l'opération entière.

## API et interface admin

Toutes les routes suivantes utilisent la session Discord/whitelist et `Cache-Control: no-store`
existants ; 401 sans session, 403 hors whitelist. Les snapshots/réceptions restent immuables,
sans route publique. v0.7c ajoute des décisions séparées, sans éditer le contenu reçu.

| Route | Réponse |
| --- | --- |
| `GET /api/admin/ingestion/batches` | Batches paginés, 20/page, comptes et Sources (20 descriptions/batch maximum) |
| `GET /api/admin/ingestion/batches/:id` | Résumé du batch ; items obtenus séparément avec `batchId` |
| `GET /api/admin/ingestion/items` | Réceptions paginées, 20/page, sans contenu brut, variante ou metadata |
| `GET /api/admin/ingestion/items/:id` | Détail du snapshot avec sa réception la plus récente ; texte exact et metadata |
| `GET /api/admin/ingestion/items/:id/matches` | Détection informative à la demande, contexte `receiptId` facultatif, candidats minimaux bornés |

Filtres de liste : `sourceKind`, `sourceId` UUID, `outcome` NEW/UNCHANGED/MODIFIED, `after`/`before`
ISO inclusifs et `page` 1–1000. La recherche de 2 à 100 caractères (titre/externalId/locator
seulement) est envoyée dans l'en-tête `X-Hesta-Ingestion-Search`, via `encodeURIComponent`.
Cet en-tête est limité à 1 200 caractères encodés ; encodage invalide ou occurrences multiples : 400.
Le paramètre d'URL `q` est refusé : une recherche privée ne doit pas entrer dans un journal d'accès.
La liste d'items accepte aussi `batchId`. Les dates filtrent la création du batch ou la réception
de l'item, pas `observedAt`. La recherche de batches cherche leurs items, pas leur libellé.
Le détail accepte seulement `receiptId` UUID : la réception doit appartenir au snapshot demandé.
Sans ce paramètre, la dernière réception fournit titre, repère, date externe, metadata et texte.
Les 20 versions les plus récentes du même contenu identifié sont résumées, sans texte brut en liste.
UUID/filtres inconnus, répétés ou invalides : 400 ; référence absente : 404 ; panne interne : 500 générique.

`/admin/ingestion` est accessible depuis le tableau de bord. Il permet de filtrer/paginer,
ouvrir un batch, consulter un item et ses versions, sans action éditoriale. Les sélections et
filtres restent en mémoire, sans contenu privé dans l'URL de page, history.state, localStorage
ou sessionStorage. Le retour/avance navigateur restaure les vues et leur pagination/filtres
tant que la vue reste montée. history.state contient seulement un marqueur opaque aléatoire,
sans UUID métier, titre, recherche, contenu ou metadata. Après rechargement ou démontage,
la consultation reprend à la liste des batches et les entrées privées en mémoire sont effacées.
Seuls les filtres non textuels sont dans les URL de requête admin ; la recherche privée est dans
l'en-tête dédié, qui ne doit pas être journalisé par un proxy. Aucun texte brut n'est envoyé.
Le titre du document
reste « Administration · Hesta Codex ». Les blocs bruts sont du texte React, jamais du HTML/Markdown
exécutable ; ils sont défilables au clavier, les metadata sont repliables et les identifiants longs
peuvent revenir à la ligne.
Une expiration/refus de session démonte la vue privée. Les erreurs proposent de réessayer.
Les lectures devenues inactives effacent leur détail ; un retour vers un item attend une nouvelle
réponse admin et ne réaffiche pas brièvement l'ancien contenu brut.

### Détection v0.7b

Le détail présente « Correspondances dans le Codex » : correspondance forte, ambiguïté,
possibilités ou aucune fiche détectée. Il charge le matching pour la réception effectivement
affichée, y compris lors de la navigation entre versions. Une erreur propose une relance
indépendante sans perdre le détail. Les fiches archivées sont signalées par texte et bordure ;
les troncatures de recherche et d’affichage sont distinctes. Chaque candidat indique type,
slug, statut, visibilité, signal et raisons, avec un lien « Ouvrir la fiche » exclusivement
vers `/admin/fiches/:slug`, selon la navigation admin existante. Aucun contenu de réception
ni recherche ne rejoint cette URL. Le matching n’effectue aucune création ou publication.
La recherche exacte est ciblée et comptée avant toute limite ; le plafond de 200 s’applique
uniquement aux candidats approximatifs supplémentaires. Une troncature de cette réserve
ne transforme pas un match exact unique déjà prouvé en ambiguïté. Les résultats d’un item,
receipt ou chargement précédent sont masqués immédiatement lors du changement de contexte ;
les réponses annulées arrivant tard sont ignorées, y compris leurs erreurs d’accès.

Le calcul utilise uniquement l’identité Source/externalId, le titre/repère de réception et
les noms/slugs/alias/provenances existants, jamais le contenu narratif ou les metadata.
Il ne modifie aucun snapshot ni modèle éditorial et ne persiste aucun résultat : une nouvelle
lecture reflète les données du Codex à cet instant. Aucune migration v0.7b.
Algorithme exact, scores, normalisation, cas ambigus et plafonds : [MATCHING.md](MATCHING.md).

### Décisions humaines v0.7c

Le détail présente « Association au Codex » avant le matching. L’administrateur confirme une
suggestion ou choisit une autre fiche par titre/slug/alias, après confirmation explicite.
Il peut rejeter un candidat, changer ou retirer une confirmation. Un score 100 reste une
suggestion. Les fiches archivées ne peuvent recevoir de nouvelle décision ; une confirmation
devenue archivée est signalée comme invalide et peut être retirée ou remplacée.

La décision porte sur `(Source UUID, identityKey)` existant et conserve externalId strict :
les réceptions identiques et nouvelles versions du même identifiant retrouvent la décision.
Aucune propagation par titre, locator, slug ou matching. Sans identifiant externe, le snapshot
d’ancrage doit être exactement celui consulté ; un autre contenu n’hérite pas. Les incohérences
de clé/identifiant/snapshot sont refusées. Une réutilisation sémantique d’un externalId demeure
à vérifier humainement ; des suggestions fortes différentes ou ambiguës déclenchent un avertissement.

Les rejets sont conservés par identité et UUID Entity, jamais globalement. Les 20 plus récents
sont listés ; les dix candidats actuels sont contrôlés indépendamment, même pour un rejet ancien.
La recherche manuelle est bornée à 20 résultats, avec debounce et annulation ; son texte voyage
dans un corps POST privé, jamais dans l’URL. Les liens ouvrent uniquement les fiches admin.
La migration et les règles de concurrence sont détaillées dans [ASSOCIATION.md](ASSOCIATION.md).

## Limites et étapes suivantes

v0.7d propose une création humaine distincte depuis un item sans confirmation. Elle ouvre
une préparation privée, demande type et provenance, puis crée atomiquement une Entity PROPOSED,
une Evidence, une Revision #1 et l’association. Source réutilisée et staging immuable ; aucune
publication ou mise à jour automatique. Voir [STAGING-CREATION.md](STAGING-CREATION.md).

Pas de streaming, pièces jointes/binaires, extraction/génération de propositions, file de revue éditoriale,
connecteurs, synchronisation, suppression/rétention ou pagination de l'historique au-delà des 20 versions.
Les Sources/snapshots sont résolus séquentiellement pour borner la charge. Les recherches sont
relationnelles bornées, sans moteur plein texte ; la volumétrie de staging reste à mesurer.
Les tests simulent PostgreSQL et les erreurs de concurrence ; la migration et la concurrence réelle
devront être validées sur PostgreSQL de test avant usage. Le contrôle navigateur local utilise seulement
des données techniques fictives ; Firefox/Safari, tactile et lecteurs d'écran restent à vérifier.

- v0.7a : staging générique.
- v0.7b : matching/détection des fiches existantes.
- v0.7c : décisions humaines et associations persistantes.
- v0.7d : création humaine d’une fiche proposée depuis le staging.
- v0.7e : mise à jour humaine d’une fiche DRAFT/PROPOSED confirmée, après comparaison.

Les connecteurs réels Carte Hesta, Obsidian, Discord et YouTube/transcriptions viennent après ce socle.
La génération automatique de propositions et la file de revue restent reportées ; seule une
action explicite v0.7d peut transférer le contenu préparé vers une nouvelle fiche proposée,
ou v0.7e vers une fiche DRAFT/PROPOSED ayant une association confirmée.
