# Détection des fiches existantes — v0.7b

Le service `apps/api/src/ingestion/matching.ts` prolonge le store et le routeur admin du staging.
Le calcul est strictement en lecture, à la demande, sans table, migration, liaison item→Entity,
résultat accepté/refusé, IA, réseau externe ou transformation des snapshots. Une transaction
`RepeatableRead` offre une vue cohérente de la réception et des candidats pour chaque calcul.
Le snapshot UUID et un `receiptId` facultatif identifient le contexte ; sans réception explicite,
ordre `ingestedAt DESC, ordinal DESC, id DESC`, identique au détail v0.7a.

## Normalisation et signaux

`matching-normalization.ts` centralise les règles. La forme exacte utilise Unicode NFC, casse
minuscule indépendante de la locale JavaScript, espaces consécutifs ramenés à un espace puis
espaces de bord retirés. La liste explicite d’espaces est : U+0009–000D, 0020, 0085, 00A0, 1680,
2000–200A, 2028–2029, 202F, 205F, 3000. Accents et ponctuation restent distincts ; aucun
accent-folding ne donne `EXACT_TITLE` ou `EXACT_ALIAS`. Une chaîne UTF-16 mal formée n’est pas
utilisée comme nom. Les distances et le tri utilisent les points de code Unicode.

La slugification part de cette forme, décompose en NFD, retire les marques combinées puis
remplace les groupes hors ASCII a–z/0–9 par `-`, en retirant les tirets de bord. C’est une
transformation avec perte, signalée par une raison de slug, jamais une identité certaine.
Pour externalId, seul le dernier segment `/` ou `\` est utilisé ; extensions textuelles connues
md/markdown/txt/json/yaml/yml/html/htm retirées. Les valeurs contenant `://`, `?` ou `#` sont
ignorées pour ce signal ; aucune URL n’est ouverte, décodée ou analysée via un connecteur.

| Code stable | Condition | Score |
| --- | --- | --- |
| `SAME_SOURCE_AND_LOCATOR` | Evidence directement liée à Entity, même Source UUID et locator strictement égal au locator **ou** externalId de la réception/item | 100 |
| `EXACT_TITLE` | Titre normalisé exact | 90 |
| `EXACT_ALIAS` | Au moins un alias normalisé exact | 90 |
| `TITLE_TO_SLUG` | Slugification du titre égale au slug existant | 80 |
| `EXTERNAL_ID_TO_SLUG` | Slugification du basename externe égale au slug | 75 |
| `SIMILAR_TITLE` | Titre différent mais similarité ≥ 85 % | min(79, 60 + arrondi(20 × similarité)) |
| `SIMILAR_ALIAS` | Alias différent mais similarité ≥ 85 % | Même formule |

Provenance : comparaison brute, sensible à la casse, sans trim, normalisation ni basename ;
repères vides ou de plus de 250 points de code ignorés, car Evidence.locator est varchar(250).
Les Evidence de Relation ne prouvent pas l’identité d’une Entity. Source.kind/externalId et
visibilité d’Evidence n’ajoutent aucun bonus ; seule l’identité UUID de Source intervient.

Similarité = `1 − distance de Levenshtein / max(longueurs)`, sans transposition spéciale.
Deux noms de 5 à 250 points de code, distance ≤ `floor(0,15 × max(longueurs))` ; noms plus courts,
plus longs ou sous le seuil rejetés. Casse/espaces/NFC exacts sont traités avant la distance.
Une différence d’accent peut être proche ; elle reste signalée comme similarité, jamais exact.
Le score final est le **maximum** des signaux, sans cumul ni pondération par statut/visibilité.
Il ne représente pas une probabilité. Les raisons suivent l’ordre fixe du tableau.

## Sélection exacte, réserve approximative et classement

1. Résoudre la réception en sélectionnant seulement titre, locator, Source UUID et externalId.
2. Une requête SQL paramétrée construit trois ensembles d’UUID ciblés, **sans limite de 200** :
   `provenance_ids` via Evidence (Source UUID + locator strict + Entity cible, relationId NULL),
   `name_ids` via titre/alias normalisé exact, et `slug_ids` via les deux slugs pertinents.
   `UNION` déduplique les UUID. Les index Source d’Evidence et slug unique d’Entity sont
   utilisables indépendamment de la position physique des fiches. Les noms normalisés exigent
   un scan SQL sélectif des titres/alias, sans transfert de toute la table.
3. Les CTE `identities` et `totals` comptent **tous** les candidats exacts et forts avant
   toute limite. Un titre/alias/provenance ne peut donc être masqué dans la décision d’unicité.
   `exact_top` retient les 10 premiers selon score exact (100/90/80/75), titre normalisé
   `COLLATE "C"`, UUID. `chosen` y ajoute séparément les UUID de slug, au plus deux grâce
   à l’unicité existante. Les slugs restent ainsi évalués même face à 350 homonymes forts.
   Seules ces **12 projections minimales au maximum** sont transférées, jamais les corps ou
   preuves complètes. Le plafond d’affichage de 10 reste distinct de la recherche exhaustive
   des identités exactes : un homonyme hors affichage reste compté comme ambiguïté.
4. Si moins de 10 candidats forts sont prouvés, une deuxième requête sélectionne jusqu’à
   **200 candidats supplémentaires de similarité**, plus une sonde. Elle exclut **tous** les
   critères exacts, y compris leurs UUID hors affichage. Longueur entre `max(5, ceil(0,85 × longueur reçue))` et
   `min(250, floor(longueur reçue / 0,85))`. Segmenter le titre reçu en `d+1` morceaux disjoints,
   où `d = floor(0,15 × floor(longueur reçue / 0,85))` ; au moins un morceau doit apparaître
   littéralement via `strpos` dans le nom. Cela garde les variantes à faute initiale, centrale
   ou finale sans un filtre sur la seule première lettre. Ordre titre normalisé puis UUID.
   Lire 201 lignes au maximum, conserver les 200 premières. La normalisation de chaque nom
   est calculée une fois dans une sous-requête avec `OFFSET 0` avant les tests de morceaux,
   au lieu de répéter NFC/minuscules/regexp pour chaque morceau. `%`, `_`, apostrophes restent
   des caractères littéraux. Les bornes sont calculées par ratios entiers 85/100 et 15/100.
   Avec au moins 10 candidats forts, aucun approximatif (<90) ne peut entrer dans l’affichage ;
   cette requête est omise. Aucun état d’acceptation ou effet éditorial n’en découle.
5. Dédupliquer par UUID puis scorer les **212 fiches au maximum** transférées (12 exactes +
   200 approximatives) ; rejeter les candidats sans signal. La similarité d’un alias n’est
   calculée qu’une fois et réutilisée pour le score et la projection de ses raisons/alias.
6. Tri final : score décroissant, titre normalisé par points de code croissant, UUID croissant.
   Retourner **10 candidats au maximum**, avec décision d’ambiguïté fondée sur les comptes exacts complets.

`searchTruncated` indique **uniquement** une sonde surnuméraire de la partie approximative.
`candidatesTruncated` indique plus de 10 candidats connus : candidats exacts complets comptés
en SQL + approximatifs scorés qui passent le seuil, après déduplication. `exactCandidateCount`
compte toutes les identités exactes/slug ; `strongCandidateCount` compte tous les UUID forts ;
`approximateEvaluatedCount` compte la réserve réellement scorée (≤200), et `evaluatedCount`
compte les projections réellement scorées (≤212). `searchLimit: 200` concerne uniquement
la similarité ; `candidateLimit: 10` concerne l’affichage. ExactCount peut dépasser 200 sans
troncature de recherche exacte, ni chargement de toute la table en mémoire JavaScript.
Aucun pg_trgm, unaccent, extension, index/migration ou dépendance ajoutée. Nombre constant de
lectures par calcul : réception, sélection exacte et éventuellement réserve approximative.

## Résultats conservateurs

- `EXACT` : un seul UUID fort (score ≥90) dans les comptes exacts complets, candidat effectivement
  scoré comme fort et non archivé. Une réserve approximative tronquée n’ajoute aucun candidat
  ≥90 caché : le résultat peut donc rester EXACT avec `searchTruncated: true`.
- `AMBIGUOUS` : plusieurs UUID forts dans la recherche exacte complète, ou candidat fort archivé.
  Même 100 face à 90 ne choisit pas artificiellement un vainqueur. La troncature approximative
  ne force jamais à elle seule AMBIGUOUS.
- `POSSIBLE` : candidats, mais aucun signal fort. Une fiche archivée approchée reste visible.
- `NONE` : aucun candidat ayant passé les seuils ; si recherche tronquée, absence non exhaustive.

Aucun de ces statuts n’entraîne une action éditoriale. L’administration inspecte les résultats.

## Confidentialité, limites et suite

Route uniquement admin, protections session/whitelist/Origin/no-store existantes et erreurs
génériques. HTTP : id, titre, slug, type/sous-type, au plus cinq alias effectivement rapprochés,
statut, visibilité, score, raisons. Pas de résumé nécessaire, corps, metadata, Source complète,
Evidence, Revision, contenu brut ou authentification. Pas de logs de critères/candidats.
La vue garde les résultats en mémoire et les efface lorsqu’ils deviennent inactifs ; pas de
titre HTML privé ni de localStorage/sessionStorage. Les liens sont admin et n’emportent que
le slug existant de la fiche, conformément au routage éditorial, jamais une URL publique.

Le matcher n’extrait aucune mention du texte narratif et ne devine aucun type/source depuis
les metadata. Les noms très courts, non ASCII pour le signal slug, homonymes et repères
incompatibles peuvent nécessiter une recherche humaine. La minuscule PostgreSQL dépend de
la collation Unicode du serveur ; certains cas linguistiques rares peuvent différer de
JavaScript. La requête utilise `normalize(..., NFC)`, donc PostgreSQL en encodage UTF8 requis.
La partie approximative reste non exhaustive lorsqu’elle est tronquée.
Mesures réelles, SQL sur PostgreSQL de test, Firefox/Safari et lecteurs d’écran restent à valider.

## Vérifications locales de la revue

Les tests utilisent des tables fictives en mémoire, avec contrôle du SQL émis et de ses
paramètres ; ils ne sont pas une exécution PostgreSQL. Chacun des cinq signaux exacts retrouve
une fiche en 351e position après 350 fiches sans rapport, puis avec ordre physique inversé.
Deux slugs restent sélectionnés après 350 titres exacts ; leurs scores inférieurs peuvent
être hors des 10 affichés, ce qui est une limite d’affichage, pas une identité perdue.
350 candidats approchés avec une seule identité forte donnent EXACT et troncature approximative.
Les huit modèles Entity/Relation/Evidence/Revision/Source/IngestionBatch/IngestionItem/
IngestionReceipt sont comparés intégralement avant/après les appels, y compris lectures absentes.

Mesure indicative locale, sans seuil de CI, sur 600 fiches fictives : sélection par double
relationnel **7,57 ms**, scoring séparé de 201 projections **14,84 ms**. Ces nombres varient
avec la machine et ne mesurent pas PostgreSQL, ses scans ni ses index. Le calcul Levenshtein
est vérifié face à une matrice indépendante, seuil inclusif à 85 %, bornes 5/250 et Unicode.

Roadmap actuelle : v0.7a staging ; v0.7b détection ; v0.7c associations humaines ; v0.7d file
de revue et validation humaine. La génération de propositions reste reportée. Le matcher
v0.7b ne persiste rien : v0.7c ajoute un service séparé de décisions, sans changer les scores,
le classement, les seuils ou la réserve. Voir [ASSOCIATION.md](ASSOCIATION.md).
Un rejet est annoté dans l’interface pour cette identité/Entity seulement ; il ne filtre pas
le matcher global. Une association confirmée est présentée au-dessus des suggestions,
qui restent secondaires. Des suggestions fortes différentes ou ambiguës exigent une vérification
humaine ; aucun score ne confirme, remplace ou retire la décision enregistrée.

Après futur déploiement, sur une **base de test** et avec des données techniques fictives :
ingérer un titre et créer séparément une fiche technique via le workflow admin existant.
Vérifier EXACT pour titre/casse/alias ; POSSIBLE pour faute/slug/basename ; EXACT à 100 après
ajout séparé d’une Evidence de même Source UUID et repère strict ; AMBIGUOUS pour deux alias
identiques ou une fiche forte archivée ; NONE pour un titre distinct. Tester receiptId valide,
incohérent, absent ; 401/403 ; erreur/retry ; liens clavier aux cinq largeurs. Comparer les
états Entity/Relation/Evidence/Revision/Source/IngestionBatch/IngestionItem/IngestionReceipt
et leurs timestamps avant/après les GET : aucune mutation.
Vérifier les comptes exacts complets avec plus de 200 homonymes, les slugs conservés face à
ces homonymes et EXACT + troncature approximative avec 350 fautes voisines et une identité
exacte unique. Vérifier la réponse limitée à 10, l’absence de corps
et de staging public, ainsi que URL/stockages/logs vides de données privées. Exécuter EXPLAIN
sur plusieurs milliers de fiches fictives avant de décider d’un éventuel index futur.
