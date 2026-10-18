# Catalogue des relations éditoriales

Le catalogue comprend **32 types canoniques**, dont **7 symétriques**, avec **25 codes inverses** : le formulaire propose donc 57 formulations, plus le choix vide initial. Aucun type n’est choisi automatiquement. Les quatre types historiques (`located_in`, `member_of`, `parent_of`, `allied_with`) et les 23 ajouts du 11 octobre conservent leurs définitions, leurs UUID en base et leurs relations.

## Les 28 types ajoutés aux quatre types historiques

| Catégorie | Code | Libellé direct | Code inverse | Libellé inverse |
| --- | --- | --- | --- | --- |
| Géographie et territoires | `capital_of` | est la capitale de | `has_capital` | a pour capitale |
| Géographie et territoires | `borders` | est frontalier de | — | symétrique |
| Géographie et territoires | `inhabits` | habite dans | `inhabited_by` | est habité par |
| Géographie et territoires | `originates_from` | est originaire de | `origin_of` | est le lieu d’origine de |
| Personnages et familles | `sibling_of` | frère ou sœur de | — | symétrique |
| Personnages et familles | `spouse_of` | conjoint de | — | symétrique |
| Personnages et familles | `descendant_of` | descendant de | `ancestor_of` | ancêtre de |
| Personnages et familles | `mentor_of` | mentor de | `mentored_by` | a pour mentor |
| Organisations et institutions | `leads` | dirige | `led_by` | est dirigé par |
| Organisations et institutions | `founded` | a fondé | `founded_by` | a été fondé par |
| Organisations et institutions | `collaborates_with` | collabore avec | — | symétrique |
| Organisations et institutions | `works_for` | travaille pour | `employs` | emploie |
| Politique et conflits | `rules_over` | gouverne | `ruled_by` | est gouverné par |
| Politique et conflits | `vassal_of` | vassal de | `overlord_of` | suzerain de |
| Politique et conflits | `enemy_of` | ennemi de | — | symétrique |
| Politique et conflits | `rival_of` | rival de | — | symétrique |
| Politique et conflits | `protects` | protège | `protected_by` | est protégé par |
| Religion et divinités | `worships` | vénère | `worshipped_by` | est vénéré par |
| Religion et divinités | `patron_deity_of` | est la divinité protectrice de | `has_patron_deity` | a pour divinité protectrice |
| Histoire et événements | `participated_in` | a participé à | `had_participant` | a eu pour participant |
| Histoire et événements | `precedes` | précède | `follows` | suit chronologiquement |
| Histoire et événements | `caused` | a provoqué | `caused_by` | a été provoqué par |
| Histoire et événements | `can_become` | peut devenir | `possible_transformation_of` | est une transformation possible de |
| Artefacts et objets | `created` | a créé | `created_by` | a été créé par |
| Artefacts et objets | `owns` | possède | `owned_by` | appartient à |
| Artefacts et objets | `uses` | utilise | `used_by` | est utilisé par |
| Artefacts et objets | `previously_owned` | a possédé | `previously_owned_by` | a appartenu à |
| Artefacts et objets | `previously_used` | a utilisé | `previously_used_by` | a été utilisé par |

Les quatre types conservés sont regroupés ainsi : `located_in` en géographie, `parent_of` dans les liens familiaux, `member_of` dans les organisations, `allied_with` dans la politique.

## Sens et cohérence

`parent_of` décrit un lien direct ; `descendant_of` une filiation plus générale. Aucun lien de descendance n’est déduit automatiquement. `located_in` décrit une situation spatiale, `inhabits` un lieu de vie, `originates_from` une origine. `member_of` décrit l’appartenance à un collectif ; le sens inverse `owned_by` de `owns` décrit une possession. `founded` concerne la fondation d’une institution ou d’un établissement ; `created` sert à la création au sens général, notamment d’un artefact. `precedes` exprime un ordre chronologique, sans affirmer une causalité ; `caused` exprime une causalité vérifiée par l’éditeur. Le choix entre ces sens reste humain, sans automatisme ni faits de lore ajoutés.

Les cinq paires du 18 octobre complètent ces sens :

- `protects` décrit une protection générale, entre personnages, organisations ou vers un lieu ou un objet ; il n’implique pas le patronage divin de `patron_deity_of`.
- `works_for` décrit le travail pour une personne ou un collectif ; son inverse est « emploie ». Il ne crée pas de lien d’appartenance `member_of` ni d’allégeance `vassal_of`.
- `previously_owned_by` (« a appartenu à ») couvre aussi « était possédée par » pour un objet. Une seule paire est proposée pour ces deux formulations équivalentes. Elle décrit une possession passée, sans modifier les liens de possession actuelle `owns` / `owned_by`.
- `previously_used_by` (« a été utilisé par ») permet une utilisation passée, distincte d’une propriété passée et du type actuel `uses` / `used_by` (« utilise / est utilisé par »), conservé tel quel.
- `can_become` décrit une transformation **possible**, notamment d’un peuple ou d’une créature vers un état représenté par un concept. L’inverse « est une transformation possible de » conserve cette possibilité : il n’affirme aucune transformation réalisée. Le type est regroupé dans « Histoire et événements » ; il ne déclenche aucune modification des fiches.

Les répétitions et variantes de casse ne produisent pas de types supplémentaires. Les exemples fournis par l’opérateur ne sont pas enregistrés comme faits de lore, ni utilisés comme fixtures.

`packages/shared/src/relation-catalog.ts` définit les propriétés existantes, l’ordre des catégories et des catégories de fiches habituelles. Le formulaire regroupe **uniquement les types réellement renvoyés par l’API** dans des `<optgroup>` natifs ; les UUID et libellés proviennent toujours de PostgreSQL. Les types personnalisés restent accessibles dans « Autres relations ». Les options symétriques sont indiquées explicitement.

Les associations inhabituelles affichent un avertissement non bloquant, conservé dans le récapitulatif. Les attentes s’inversent avec le code inverse ou l’inversion des fiches. Créatures et divinités sont admises dans les catégories usuelles adaptées ; `OTHER` et les types personnalisés restent à l’appréciation humaine. Ces indications ne constituent ni une règle de canon ni une restriction API. Les catégories des fiches ne sont jamais modifiées par ce choix.

Le formulaire manuel, les références Obsidian et « Relations à qualifier » partagent le même sélecteur et la même confirmation. Le serveur conserve la normalisation inverse, l’ordre canonique des UUID symétriques, le refus des doublons, la transaction Source/Relation/Evidence et les permissions existantes. Les nouvelles relations restent `PROPOSED`, `GM` par défaut, avec une Source et une preuve obligatoires. Le graphe et les fiches utilisent déjà les libellés stockés ; aucune refonte ni conversion des références automatiques n’est ajoutée.

## Installation et conservation des données

La migration historique **`20261011120000_editorial_relation_catalog`** installe les 23 premiers ajouts et reste inchangée. La nouvelle migration **`20261018000000_additional_editorial_relations`**, fichier `prisma/migrations/20261018000000_additional_editorial_relations/migration.sql` à inclure dans le commit, installe uniquement les cinq nouvelles paires.

Les migrations insèrent uniquement le vocabulaire manquant dans la table existante `RelationType`. Aucun changement de schéma, aucune écriture dans `Entity`, `Relation`, `Evidence`, `Source`, `Revision` ou les tables de staging. Les UUID des 27 types précédents et les relations existantes ne sont pas concernés par la nouvelle migration.

Un bloc PostgreSQL `DO` rend l’installation atomique. Un verrou transactionnel sur `RelationType` sérialise les installateurs. Les UUID des nouveaux types sont fixes dans le SQL ; si le même code existe déjà avec une définition identique et un autre UUID, la ligne reste intégralement inchangée, dates comprises. Une exécution répétée n’ajoute ni ne modifie rien.

Les index uniques existants sur `code` et `inverseCode` restent inchangés. Ils ne suffisent pas à prévenir un code direct identique au code inverse d’un autre type : la migration vérifie donc aussi les collisions **entre les deux namespaces**. Une collision, un UUID déjà occupé ou une définition incompatible fait échouer toute l’installation, sans écrasement ni installation partielle. Les contraintes SQL sur les types symétriques et les codes distincts restent actives. Les erreurs nomment le code concerné, sans extraire de lore.

Le seed lit les mêmes définitions partagées via `prisma/relation-catalog.ts`, applique les mêmes contrôles et ajoute uniquement les types manquants dans une transaction. Il ne remplace pas les définitions existantes. Un test compare séparément les 23 puis les cinq définitions SQL aux définitions partagées pour prévenir une divergence. Les migrations historiques sont immuables.

Après validation et sauvegarde PostgreSQL vérifiée **avant le push déclenchant la livraison**, le workflow existant `.github/workflows/deploy.yml` exécute `npm ci`, le build, puis `npm run prisma:deploy` avant le redémarrage PM2. Il installe donc les nouveaux types automatiquement et s’arrête avant PM2 si la migration échoue. Aucun seed manuel supplémentaire ni modification du workflow n’est nécessaire pour le Codex existant.

L’initialisation d’une **base neuve** conserve la procédure du README : migrations puis seed. Les migrations additives n’insèrent pas les quatre types historiques à leur place ; le seed initialise l’ensemble des 32 types sans remplacer les lignes déjà installées. Ne pas relancer des imports ou des promotions pour installer ce vocabulaire.

Après livraison : ouvrir un formulaire depuis « Relations à qualifier », vérifier les sept groupes, choisir un nouveau type et son inverse puis inspecter le récapitulatif sans créer de relation non validée. Contrôler les relations historiques et les compteurs existants. Aucune des commandes de déploiement, migration ou seed n’a été lancée sur une base réelle pendant le développement.

## Vérifications et limites

Les tests PostgreSQL utilisent **PGlite 0.4.3 en mémoire**, déclaré comme dépendance de développement, sans connexion réseau ni `DATABASE_URL`. Ils exécutent les migrations historiques puis les deux migrations additives sur une fixture fictive : 130 fiches, 130 preuves, 130 révisions, 130 associations confirmées et trois relations historiques synthétiques. Les données et les 27 types précédents sont comparés avant/après ; une seconde installation et le seed ne modifient ni UUID ni dates. Les collisions de namespaces, de définitions et d’UUID vérifient l’annulation complète, y compris après plusieurs insertions dans le bloc. La symétrie, les codes distincts et l’unicité SQL restent contrôlés.

Les tests des services existants couvrent chaque nouveau type, les inverses, les doublons symétriques, la provenance et la transaction. Les tests web couvrent le regroupement, les 57 formulations, les avertissements non bloquants, la création d’une possession passée par son inverse depuis la file et les libellés du graphe dans les deux sens. Le catalogue ne change pas les endpoints ni la protection du graphe public.

PGlite exécute PostgreSQL embarqué ; il ne reproduit pas l’infrastructure VPS, les droits du rôle de déploiement ni une concurrence multiconnexion. La recette du déploiement reste à effectuer avec l’opérateur. Une définition personnalisée incompatible est volontairement refusée, jamais corrigée automatiquement. Les avertissements sont des repères éditoriaux, pas un modèle sémantique exhaustif.

Validation locale du 18 octobre 2026 : **758 tests réussis (440 API + 318 web)** avec la commande standard `npm test`, sans configuration temporaire, exclusion ni modification des délais. Lint, typecheck, build, Prisma validate/generate et `git diff --check` réussis. Deux nouveaux tests API et les tests existants étendus couvrent ces cinq paires. Le build signale toujours un chunk principal supérieur à 500 kB (505,15 kB minifiés), sans échec ; aucune refonte du découpage n’est incluse dans cet ajout de vocabulaire.

Le build a également été contrôlé dans Edge, avec une API locale simulée de 130 fiches et 296 références, à **1920×1080 et 390×844** : sept groupes, 57 formulations, aucun choix automatique, sélection du long libellé inverse « est une transformation possible de », avertissement non bloquant conservé dans le récapitulatif, confirmation humaine et retour à la file actualisée. Aucun débordement horizontal, erreur JavaScript ou accès extérieur observé. Les captures et scripts de recette restent hors dépôt. Aucun secret ni contenu réel du lore n’a été ajouté aux nouvelles fixtures ou à cette documentation. Aucun commit, push, déploiement ou accès à une base réelle n’a été effectué.

## Fichiers de cette livraison

Sept fichiers concernés par les cinq paires du 18 octobre ; aucun changement de schéma, de workflow, de permissions ou de résolution Obsidian :

```text
README.md
apps/api/src/relation-catalog.test.ts
apps/web/src/AdminReferenceRelation.test.tsx
apps/web/src/GraphPage.test.tsx
docs/RELATION-CATALOG.md
packages/shared/src/relation-catalog.ts
prisma/migrations/20261018000000_additional_editorial_relations/migration.sql
```
