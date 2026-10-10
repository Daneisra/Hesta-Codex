# Nettoyage ponctuel du staging technique avant la première création

Cette opération manuelle prépare la création groupée décrite dans
[STAGING-PROMOTION.md](STAGING-PROMOTION.md). Elle n'ajoute aucun mécanisme permanent,
commande npm ou migration. **Les scripts ne sont pas exécutés pendant le développement.**

État annoncé, à vérifier sur la base existante : **9 lots, 139 items, 148 réceptions,
0 Entity**. Le lot réel de la Source `OBSIDIAN / hesta-obsidian-principal` contient
130 notes et 130 réceptions. L'objectif est de supprimer les **8 lots fictifs**,
leurs **9 items**, leurs **18 réceptions** et leurs racines/décisions d'association,
puis uniquement les Sources fictives explicitement autorisées devenues inutilisées.
Résultat attendu : **1 lot réel, 130 items, 130 réceptions, 0 Entity**.

Les UUID réels ne sont pas disponibles dans le dépôt et aucun accès à la production
n'est utilisé pour les obtenir. Le modèle de suppression est donc **inexécutable en
l'état** : son premier garde-fou refuse les listes vides. Les huit UUID de lots,
les UUID de Sources fictives et les deux UUID protégés doivent être relevés puis
vérifiés humainement dans l'inventaire. Les libellés v0.7c/v0.7d/v0.7e servent à
orienter cette revue ; ils ne constituent jamais un critère de suppression.

## Fichiers et garanties

- [Inventaire en lecture seule](../scripts/one-off/inventory-technical-staging.sql) :
  transaction RepeatableRead READ ONLY, compteurs, UUID de lots/items/associations,
  rattachement des réceptions et dépendances des Sources.
- [Modèle de suppression](../scripts/one-off/cleanup-technical-staging.sql) :
  transaction unique, liste d'UUID explicites, inventaire avant DELETE,
  comparaisons intégrales avant/après, contrôles de compteurs et **ROLLBACK final
  par défaut**. Une copie privée avec COMMIT exige une approbation distincte.

Le modèle cible exclusivement le schéma PostgreSQL **public** existant. Il exige
exactement l'état annoncé et refuse aussi toute Relation, Evidence ou Revision.
Le nettoyage doit précéder la création des fiches : ne pas contourner ce refus
après promotion, ni l'adapter en supprimant des données éditoriales.

Le lot protégé doit être le seul lot des 130 identités/chemins distincts de la Source
protégée, sans mélange avec une Source fictive. Une réception UNCHANGED peut pointer
un item créé dans un autre lot : tout lien traversant la frontière entre réel et
fictif bloque l'opération. Des liens entre deux lots fictifs explicitement ciblés
sont permis. Une association touchant un item ou une Source non autorisé(e), ou une
identité conservée, bloque également la suppression.

Ordre des DELETE conforme aux clés étrangères RESTRICT du schéma actuel :

1. IngestionAssociationDecision des associations ciblées.
2. IngestionAssociation ciblées.
3. IngestionReceipt des huit lots ciblés.
4. IngestionItem des huit lots ciblés.
5. IngestionBatch ciblés.
6. Source explicitement autorisées **sans aucun item, association, Evidence ou
   Source dérivée restant**. Les feuilles sont supprimées avant leurs parents.

Une Source encore référencée, y compris par la Source réelle ou une dérivation
non ciblée, est conservée et signalée. Un cycle de dérivations est aussi conservé.
Aucune Source orpheline non listée n'est supprimée, même avec un libellé de test.
Les Sources conservées sont comparées intégralement, y compris les Sources
fictives listées mais toujours utilisées. Ne pas forcer leur suppression.

Les comparaisons couvrent toutes les colonnes de la Source réelle, du lot réel,
des 130 items et des 130 réceptions, ainsi que les associations conservées.
Les snapshots complets restent dans des tables temporaires de la session
PostgreSQL, supprimées à la fin de la transaction ; ils ne sont jamais imprimés.
Aucun UPDATE, TRUNCATE, CASCADE ou désactivation de contraintes n'est employé.
Entity, Relation, Evidence, Revision, RelationType, User et Session ne sont pas
supprimés. Toute erreur annule la transaction avec les commandes psql ci-dessous.

Les écritures concurrentes sont bloquées par SHARE ROW EXCLUSIVE pendant la
transaction, avec abandon après 5 secondes de contention et limite de 30 secondes
par instruction. Les lectures ordinaires restent possibles. Suspendre les
ingestions et les modifications éditoriales pendant toute la procédure, de la
sauvegarde jusqu'à la vérification finale. Ne pas lancer promotion en parallèle.

## Procédure manuelle sur le VPS

Après mise à disposition des fichiers par une procédure autorisée séparément,
vérifier le SHA déployé selon [l’ordre opérationnel complet](STAGING-PROMOTION.md#livraison-et-ordre-opérationnel-complet)
et se placer dans `/srv/hesta-codex/repo`. Utiliser `psql`, `pg_dump` et
`pg_restore` compatibles avec le serveur. Les commandes suivantes utilisent
**la même configuration libpq existante** : service PGSERVICE, ou PGHOST/PGPORT/
PGDATABASE/PGUSER et fichier de mots de passe privé. `psql` ne lit pas le `.env`
de l'application automatiquement. Vérifier que libpq et DATABASE_URL de la CLI
visent exactement la même base existante. Vérifier la configuration indépendamment ;
ne pas coller une URL avec mot de passe dans le terminal, un ticket ou Git.

Utiliser un terminal privé sans transcription/capture. Les inventaires ne
contiennent ni Markdown, titres de notes, chemins de notes ni auteurs ; ils
contiennent néanmoins des identifiants, libellés et informations de connexion
privés. Sauvegarde, script rempli et journaux restent **hors Git**, dans un
répertoire privé durable, réservé à l'opérateur. Aucun UUID de production ne
doit être ajouté aux modèles versionnés.

### 1. Sauvegarder et inventorier

Suspendre les écritures applicatives. Vérifier la base et le rôle réellement
visés avec la configuration libpq de l'opérateur, puis choisir un répertoire
privé existant, vide et hors checkout (droits 700) :

```bash
umask 077
read -r -p 'Répertoire privé existant pour cette opération : ' CLEANUP_WORKDIR
test -d "$CLEANUP_WORKDIR" || exit 1

psql -X --set=ON_ERROR_STOP=1 \
  --command='SELECT current_database(), current_user, inet_server_addr(), inet_server_port();' || exit 1

test ! -e "$CLEANUP_WORKDIR/before-cleanup.dump" || exit 1
pg_dump --format=custom --file="$CLEANUP_WORKDIR/before-cleanup.dump" || exit 1
pg_restore --list "$CLEANUP_WORKDIR/before-cleanup.dump" \
  > "$CLEANUP_WORKDIR/backup-contents.txt" || exit 1

psql -X --set=ON_ERROR_STOP=1 \
  --file=scripts/one-off/inventory-technical-staging.sql \
  > "$CLEANUP_WORKDIR/inventory-before.txt" || exit 1
```

`pg_restore --list` contrôle la lisibilité de l'archive, **pas sa restaurabilité
complète**. Avant toute suppression définitive, la sauvegarde doit être vérifiée
selon la procédure de restauration habituelle sur un environnement isolé ; ne
jamais tester sa restauration par écrasement de la base réelle. Ne pas supprimer
la sauvegarde à l'issue de cette opération.

Lire l'inventaire privé et vérifier :

- 9 / 139 / 148, Entity/Relation/Evidence/Revision toutes à zéro.
- Source exacte `kind = OBSIDIAN`, `externalId = hesta-obsidian-principal` : relever
  son UUID, celui de son unique lot, 130 items/identités/chemins, 130 réceptions.
- Les huit autres lots : vérifier **chacun de leurs UUID**, leurs Sources et
  l'origine fictive v0.7c/v0.7d/v0.7e. Ne pas présumer que « tout autre lot » est
  fictif. Attendu : neuf items et dix-huit réceptions au total.
- Réceptions croisées entre lots : aucune réception réelle ne peut référencer
  un item fictif, ni l'inverse.
- Sources fictives candidates : relever leurs UUID, examiner les références,
  inclure celles devenues orphelines si leur origine fictive est établie.
- Associations résiduelles : examiner UUID, Source, item d'ancrage et dépendances.

Toute surprise impose de s'arrêter et de réviser l'inventaire, sans élargir
automatiquement les listes ni affaiblir les contrôles de compteurs.

### 2. Remplir la liste privée et répéter avec annulation

```bash
test ! -e "$CLEANUP_WORKDIR/cleanup-rehearsal.sql" || exit 1
cp scripts/one-off/cleanup-technical-staging.sql "$CLEANUP_WORKDIR/cleanup-rehearsal.sql"
```

Éditer **seulement cette copie privée** : remplacer la zone commentée par trois
INSERT valides avec les UUID réellement inventoriés. Un couple UUID Source réelle /
UUID lot réel dans `pg_temp.cleanup_protected`, exactement huit UUID fictifs dans
`pg_temp.cleanup_batches`, tous les UUID de Sources fictives approuvées dans
`pg_temp.cleanup_sources`. Aucun placeholder ou `...` ne doit rester dans les
INSERT. Les clés primaires refusent les doublons. Garder la dernière instruction
**ROLLBACK;**, et ne modifier aucune garde ou requête de suppression.

Vérifier la liste exacte avec l'opérateur responsable, puis répéter :

```bash
psql -X --set=ON_ERROR_STOP=1 \
  --file="$CLEANUP_WORKDIR/cleanup-rehearsal.sql" \
  > "$CLEANUP_WORKDIR/rehearsal-result.txt" || exit 1

psql -X --set=ON_ERROR_STOP=1 \
  --file=scripts/one-off/inventory-technical-staging.sql \
  > "$CLEANUP_WORKDIR/inventory-after-rollback.txt" || exit 1
diff -u "$CLEANUP_WORKDIR/inventory-before.txt" "$CLEANUP_WORKDIR/inventory-after-rollback.txt"
```

La répétition **effectue les DELETE dans une transaction puis les annule** : ce
n'est pas un dry-run en lecture seule. L'inventaire séparé constitue la phase en
lecture seule. Lire le résultat, les UUID ciblés et les Sources supprimables ou
conservées. Attendu dans la transaction : 8 lots / 9 items / 18 réceptions ciblés,
comparaison intégrale réussie, état final simulé 1 / 130 / 130 et 0 Entity.
Attendu après ROLLBACK : inventaire identique à celui d'avant (9 / 139 / 148).
Si le diff est non vide, ne pas appliquer ; vérifier les écritures concurrentes.

Avec 0 Entity et les clés étrangères actives, aucune décision CONFIRMED/REJECTED
ne peut normalement subsister ; des racines d'association sans décision peuvent
exister. L'ordre de suppression prévoit néanmoins les dépendances de décisions.

### 3. Supprimer définitivement après approbation explicite

Cette étape est réservée à l'opérateur, **après sauvegarde vérifiée, revue des
UUID exacts et approbation explicite de la suppression définitive**.

```bash
test ! -e "$CLEANUP_WORKDIR/cleanup-apply.sql" || exit 1
cp "$CLEANUP_WORKDIR/cleanup-rehearsal.sql" "$CLEANUP_WORKDIR/cleanup-apply.sql"
```

Éditer la copie `cleanup-apply.sql` : remplacer **uniquement la dernière instruction**
`ROLLBACK;` par `COMMIT;`. Comparer les deux fichiers ; la seule différence
autorisée est cette instruction finale :

```bash
diff -u "$CLEANUP_WORKDIR/cleanup-rehearsal.sql" "$CLEANUP_WORKDIR/cleanup-apply.sql"

# Seulement après vérification et approbation de cette différence :
psql -X --set=ON_ERROR_STOP=1 \
  --file="$CLEANUP_WORKDIR/cleanup-apply.sql" \
  > "$CLEANUP_WORKDIR/apply-result.txt" || exit 1

psql -X --set=ON_ERROR_STOP=1 \
  --file=scripts/one-off/inventory-technical-staging.sql \
  > "$CLEANUP_WORKDIR/inventory-after-commit.txt" || exit 1
```

Vérifier dans l'inventaire final : l'unique UUID de lot réel, 130 items et 130
réceptions de la même Source réelle, 0 donnée éditoriale et aucun des huit UUID
de lots fictifs ni de leurs neuf items. Vérifier également l'absence de leurs
associations et des Sources orphelines autorisées. Si une Source fictive reste
signalée comme référencée, examiner la dépendance et conserver cette limite dans
le bilan ; ne pas supprimer la dépendance réelle pour obtenir un compteur.

Une perte de connexion pendant COMMIT laisse son résultat incertain : consulter
l'inventaire, sans rejouer aveuglément le script. Il refuse l'état déjà nettoyé.
Après confirmation de l'état final, reprendre le dry-run puis l'application
explicitement approuvée de [la création groupée](STAGING-PROMOTION.md).

## Validation et limites de cette livraison

Les requêtes et l'ordre des dépendances sont revus contre le schéma Prisma et les
migrations staging/associations existantes. Les scripts sont préparés et relus,
**sans exécution SQL**, même sur une base de test : la répétition/validation
PostgreSQL reste à réaliser manuellement avant COMMIT. Les UUID exacts et l'origine
fictive de chaque lot/Source doivent encore être établis par l'inventaire privé.
Les tests applicatifs de promotion ne constituent pas des tests de ce SQL.

Le travail de création groupée est conservé : dernière validation locale complète
**624 tests réussis = 384 API + 240 web**, lint, typecheck, build et Prisma réussis.
L'ajout de ces seuls scripts et documents ne modifie pas le comportement applicatif.
Aucun coffre, VPS ou PostgreSQL de production n'est consulté pendant cette préparation.
