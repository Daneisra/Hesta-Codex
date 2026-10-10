# Création éditoriale groupée depuis le staging Obsidian

`lore:staging:promote` prépare puis, après approbation explicite d’un plan, crée les fiches
proposées depuis **une seule Source existante** : `kind = OBSIDIAN` et `externalId` exact
fourni par l’opérateur. Il ne relit aucun coffre Obsidian et ne lance aucune ingestion.
Il utilise la configuration PostgreSQL existante, sans nouvelle base ni migration.

Avant la première création des 130 fiches, préparer puis faire exécuter manuellement
le [nettoyage ponctuel des anciens lots techniques](STAGING-CLEANUP.md), après sauvegarde,
inventaire des UUID et approbation explicite. Cette opération distincte conserve le lot
Obsidian intégralement et ramène le staging annoncé de 9/139/148 à 1/130/130.
La CLI de promotion ne nettoie rien ; ses deux modes restent ceux décrits ci-dessous.

Le service v0.7d reste le cœur de création. Son corps transactionnel est partagé avec la CLI ;
le parcours HTTP, son contrat, sa préparation et ses règles de concurrence restent inchangés.
Les fonctions communes de préparation des réceptions et de validation sont réutilisées.

## Sélection et identité

La Source n’est jamais créée, renommée ou modifiée. La sélection ne lit que ses items,
prend la plus grande `version` de chaque `identityKey`, puis sa dernière réception par
`ingestedAt DESC`, `ordinal DESC`, `id DESC`. Une réception UNCHANGED peut donc fournir
un titre, des tags ou une variante Markdown brute plus récents que le snapshot initial.
Chaque identité et chaque chemin externe exact n’apparaissent qu’une fois dans le plan.
Une identité incompatible, anonyme, un chemin non Markdown, un autre format ou une réception
absente provoque un refus ; aucun rapprochement par titre ou hash ne remplace le chemin.

Pour la Source `hesta-obsidian-principal`, le nombre attendu fourni est **130 identités**,
pas 139 snapshots ni 148 réceptions. Les items techniques d’autres Sources ne sont pas
sélectionnés. Si une donnée technique est accidentellement dans cette même Source, les
contrôles de chemin/format et le nombre attendu peuvent bloquer le plan : aucune exclusion
heuristique fondée sur un titre « technique ». Ne jamais approuver un nombre inattendu.
Les 31 emplacements réservés exclus par le convertisseur n’entrent pas dans ce parcours.

Une association CONFIRMED existante est ignorée, quel que soit son auteur, son origine ou
le statut de la fiche, y compris ARCHIVED. Aucune fiche associée n’est mise à jour ou recréée.
Une version suivante hérite de cette association selon les règles existantes.
Les rejets humains préexistants sont conservés ; leur révision est vérifiée avant création.

## Classification proposée et exceptions

Seul le dossier est interprété, jamais le corps de la note. Les noms des dossiers sont
comparés sans distinction de casse/accents ; les identités et chemins restent exacts.

| Dossier | Proposition |
| --- | --- |
| Artefacts | ARTIFACT |
| Continents | PLACE / CONTINENT |
| Créatures et Peuples | OTHER provisoire : choisir SPECIES ou CREATURE par exception |
| Divinités | DEITY |
| Familles Nobles | FAMILY |
| Hesta | CONCEPT |
| Instances Autres / Impériales / Militaires | ORGANIZATION |
| Instances Religieuses | OTHER provisoire : choisir ORGANIZATION ou RELIGION par exception |
| Lieux | PLACE / OTHER |
| Notables, Notables Défunt, Notables/Notables Défunt | PERSON |
| Villes | PLACE / CITY |
| Dossier inconnu ou note à la racine | OTHER provisoire, à revoir |

`Instances/Autres`, `Instances/Impériales` et `Instances/Militaires` sont aussi reconnus.
Un classement par dossier reste une **proposition humaine à vérifier**. Toute note peut être
reclassée par une exception explicite, sans modifier le staging ni son Markdown.

`--classifications CHEMIN_ABSOLU` lit un fichier JSON UTF-8 privé, régulier, d’au plus 1 Mio,
sans lien symbolique/jonction dans ses parents ni chemin UNC. Le conserver **hors Git**,
avec accès réservé à l’opérateur. Exemple exclusivement fictif :

```json
{
  "version": 1,
  "items": [
    { "externalId": "Créatures et Peuples/Espèce fictive.md", "kind": "SPECIES" },
    { "externalId": "Instances Religieuses/Culte fictif.md", "kind": "RELIGION" },
    { "externalId": "Lieux/Cité fictive.md", "kind": "PLACE", "placeKind": "CITY" }
  ]
}
```

Chemins sensibles à la casse et à la représentation Unicode, extension comprise. PLACE
requiert un sous-type ; les autres types ne peuvent pas en avoir. Doublons, chemins hors
sélection, propriétés inconnues, type invalide ou JSON malformé bloquent le plan.
Le même fichier doit être fourni au dry-run et à l’application.

Sans exceptions suffisantes, le dry-run signale les classifications provisoires OTHER.
L’application les refuse par défaut. `--allow-provisional` constitue une acceptation explicite
de leur création en OTHER/PROPOSED, à revoir dans l’administration ; le fournir aux deux modes.
OTHER demeure visible dans la fiche et sa Revision, sans création automatique d’un autre type.
Le compteur OTHER porte sur les fiches encore **créables** ; les fiches déjà associées
sont ignorées et leur classification éditoriale actuelle doit être revue dans l’administration.

## Slugs, contenu et provenance

Le slug part du titre, en minuscules ASCII, accents retirés, ligatures œ/æ/ß converties,
groupes de séparateurs remplacés par un tiret. Il est généré dans la limite de 200 caractères.
Pour un titre non translittérable, il utilise `fiche-` et une empreinte du chemin.
Un titre distinct garde son slug simple. En cas d’homonymie ou de slug déjà occupé, le dossier
est ajouté ; si nécessaire, un suffixe déterministe de 12 caractères SHA-256 du chemin
désambiguïse encore. Une collision persistante bloque le plan, sans fusion ni remplacement.
Les identités déjà associées restent dans le calcul des groupes pour stabiliser les slugs
lors d’une relance après succès partiel sur un staging inchangé.

Le titre et le Markdown exact sont conservés : `rawVariant` de la réception si présent,
sinon contenu du snapshot. BOM, fins de ligne, wikilinks et frontmatter restent dans le corps.
Les tags respectent le validateur éditorial existant ; une liste invalide est refusée,
sans reprise partielle. Résumé null et alias vides : aucune synthèse ou information inventée.
Titre vide/trop long/nécessitant un trim, corps vide/trop long, NUL/Unicode invalide et locator
trop long sont refusés, sans troncature ni remplacement artificiel.
Les limites éditoriales restent titre 200, corps 100 000 caractères, 30 tags de 100 caractères,
locator Evidence 250. Le locator staging doit correspondre au chemin externe original.

Chaque création utilise **une transaction Prisma Serializable** qui :

1. Revérifie la Source, la dernière version, la dernière réception, les données approuvées
   et la révision d’association. Une confirmation humaine concurrente est ignorée proprement.
2. Réutilise la création v0.7d : Entity PROPOSED, GM, publishedAt null ; Source existante ;
   Evidence initiale ; Revision #1 ; association CONFIRMED/MANUAL avec l’auteur explicite.
3. Conserve le chemin dans l’association, l’Evidence et la trace de staging de la Revision.
   L’Evidence contient un énoncé technique de provenance, sans affirmation de lore inventée,
   sourceExcerpt null, temps vidéo et confidence null. Sa visibilité reste la plus restrictive
   de GM et de celle de la Source, conformément au service existant.
4. Annule toutes les écritures de cette fiche si une étape ou le commit échoue.

Revision #1 conserve itemId, receiptId, Source, Evidence, contentHash, version, locator,
observedAt et ingestedAt, avec le libellé de l’auteur. Aucune Source, snapshot, réception,
batch ou Relation n’est écrit. Aucun wikilink n’est transformé en relation. Aucune publication.

## Livraison et ordre opérationnel complet

Ordre à respecter : **commit local → push autorisé / CI / déploiement → vérification du
commit déployé → suspension des écritures → sauvegarde vérifiée → inventaire et revue des
UUID → répétition annulée du nettoyage → nettoyage approuvé → validation 1/130/130 et
0 Entity → dry-run des 130 fiches → revue du plan SHA-256 → création groupée approuvée →
contrôle de provenance et dry-run d’idempotence**. Aucune de ces actions sur le VPS ou Git
n’est exécutée pendant cette livraison locale.

Le dépôt est actuellement sur `main`, remote `origin` vers `Daneisra/Hesta-Codex`.
Commandes PowerShell à exécuter localement **après approbation du commit**, depuis le dépôt :

```powershell
$promotionCommitFiles = @(
  'README.md'
  'package.json'
  'apps/api/src/ingestion/proposal.ts'
  'apps/api/src/ingestion/proposal.test.ts'
  'apps/api/src/ingestion/promotion.ts'
  'apps/api/src/ingestion/promotion-repository.ts'
  'apps/api/src/ingestion/promotion-command.ts'
  'apps/api/src/ingestion/promotion-cli.ts'
  'apps/api/src/ingestion/promotion.test.ts'
  'docs/STAGING-PROMOTION.md'
  'docs/STAGING-CLEANUP.md'
  'scripts/one-off/inventory-technical-staging.sql'
  'scripts/one-off/cleanup-technical-staging.sql'
)
git status --short
git add -- $promotionCommitFiles
if ($LASTEXITCODE -ne 0) { throw 'Préparation du commit refusée' }
git diff --cached --check
if ($LASTEXITCODE -ne 0) { throw 'Diff indexé invalide' }
git diff --cached --name-only
git diff --cached
# Vérifier que seuls les 13 fichiers ci-dessus sont indexés, sans UUID réel ni donnée privée.
git commit -m 'feat(ingestion): préparer la promotion Obsidian et le nettoyage ponctuel'
if ($LASTEXITCODE -ne 0) { throw 'Commit refusé' }
git rev-parse HEAD
```

Noter le SHA complet du commit. Le **push suivant déclenche le déploiement automatique**
après réussite de CI : il nécessite donc aussi l’accord de déploiement, pas seulement
celui du commit. Ne pas le lancer tant que cet accord n’est pas donné :

```powershell
git push origin main
```

Suivre les workflows [CI et Deploy Hesta Codex](https://github.com/Daneisra/Hesta-Codex/actions)
du même SHA. Le [workflow existant](../.github/workflows/deploy.yml) utilise Node 24,
`/srv/hesta-codex/repo`, installe les dépendances, construit les applications, exécute
`prisma:deploy`, redémarre `hesta-codex-api` avec PM2 et vérifie la santé de l’API.
Cette livraison ne contient **aucune migration nouvelle** ; le workflow applique les
migrations déjà versionnées, sans nettoyage ni promotion automatiques. Ne pas ajouter
un second déploiement manuel si le déploiement automatique a déjà réussi.

Après réussite des deux workflows, l’opérateur vérifie sur le VPS, avant toute opération
de données, que le SHA correspond exactement à celui qu’il a approuvé :

```bash
cd /srv/hesta-codex/repo || exit 1
read -r -p 'SHA complet du commit approuvé : ' PROMOTION_DEPLOY_SHA
test "$(git rev-parse HEAD)" = "$PROMOTION_DEPLOY_SHA" || exit 1
npm run prisma:validate || exit 1
npm run --silent lore:staging:promote -- --help || exit 1
curl --fail --silent --show-error --max-time 10 --output /dev/null \
  http://127.0.0.1:3000/api/v1/health || exit 1
```

Suspendre ensuite les écritures et suivre intégralement [STAGING-CLEANUP.md](STAGING-CLEANUP.md),
avec configuration libpq visant **la même base que DATABASE_URL de la CLI**, sauvegarde,
UUID vérifiés et ROLLBACK de répétition. Ne pas passer à la promotion si l’inventaire
après COMMIT ne confirme pas 1 lot / 130 items / 130 réceptions, la Source protégée et
0 donnée éditoriale. Garder les écritures concurrentes suspendues pendant la promotion.
Les commandes ci-dessous ne demandent ni réingestion ni nouveau passage dans le coffre.

## Approbation et commandes à lancer manuellement sur le VPS

**Ces commandes ne sont pas exécutées pendant le développement.** Après mise à disposition
du correctif par un déploiement autorisé séparément, se placer dans le checkout existant
Hesta-Codex sur le VPS. Node.js 22+, dépendances et client Prisma généré doivent être disponibles.
La CLI charge le `.env` à la racine du dépôt (sans afficher ses valeurs), ou utilise
`DATABASE_URL` de l’environnement. Utiliser uniquement la base existante visée, jamais une
URL copiée dans le terminal, un ticket ou Git. Aucun `migrate`, `seed`, reset ou ingestion ici.

L’accès CLI repose sur les droits système/PostgreSQL de l’opérateur ; il ne crée pas de
session Discord et ne consulte pas Discord. L’auteur fourni doit être la personne qui
vérifie et approuve le plan : Discord ID 17–20 chiffres, libellé exact non vide ≤ 200 caractères,
sans retours à la ligne ni espaces périphériques. Aucun auteur par défaut ou codé en dur.

Prévisualisation avec acceptation explicite des éventuels OTHER provisoires :

```bash
read -r -p 'Votre identifiant Discord : ' PROMOTION_AUTHOR_DISCORD_ID
read -r -p 'Votre libellé d’auteur : ' PROMOTION_AUTHOR_LABEL

npm run --silent lore:staging:promote -- \
  --source-external-id hesta-obsidian-principal \
  --author-discord-id "$PROMOTION_AUTHOR_DISCORD_ID" \
  --author-label "$PROMOTION_AUTHOR_LABEL" \
  --expected-count 130 \
  --allow-provisional \
  --dry-run --details
```

Vérifier les 130 chemins, classifications et slugs affichés, ainsi que les compteurs.
Avant toute première création, attendu : 130 détectées, 130 créables, 0 ignorée, 0 rejet,
0 collision **non résolue**. Les collisions détectées mais résolues sont normales pour les
homonymes. Le nombre de classifications OTHER à revoir dépend des dossiers/exceptions.
Ces valeurs attendues ne constituent pas une vérification du staging réel pendant cette livraison.

Copier les 64 caractères de « Empreinte du plan » uniquement après cette revue, puis appliquer :

```bash
read -r -p 'SHA-256 du plan que vous avez vérifié et approuvé : ' PROMOTION_PLAN_SHA256

npm run --silent lore:staging:promote -- \
  --source-external-id hesta-obsidian-principal \
  --author-discord-id "$PROMOTION_AUTHOR_DISCORD_ID" \
  --author-label "$PROMOTION_AUTHOR_LABEL" \
  --expected-count 130 \
  --allow-provisional \
  --apply --confirm-plan "$PROMOTION_PLAN_SHA256"
```

Pour utiliser des exceptions, ajouter `--classifications "/chemin/prive/hors-git/classifications.json"`
aux **deux** commandes. Si toutes les classifications sont résolues explicitement, retirer
`--allow-provisional` des deux commandes. Toute modification impose un nouveau dry-run.
Ne pas automatiser la copie de l’empreinte vers apply sans revue humaine.

L’empreinte lie la Source, l’auteur, le nombre attendu, l’acceptation des OTHER, les réceptions,
contenus et associations, les slugs et les champs proposés. Apply recalcule le plan avant
sa première écriture et refuse une empreinte différente. Les changements intervenus ensuite
sont contrôlés dans chaque transaction, avec les contraintes SQL existantes comme dernière défense.

Par défaut, aucun titre, chemin, slug, corps, auteur ou détail SQL n’est journalisé : compteurs,
empreinte et codes constants uniquement. `--details` affiche volontairement des **données privées**
de plan (chemins/slugs/types/actions), jamais les corps. Utiliser un terminal privé et désactiver
les captures/transcriptions ; tout fichier d’exceptions ou copie du plan reste hors Git.
`npm run --silent` évite l’affichage des arguments par npm. Les arguments peuvent rester dans
l’historique ou la liste des processus ; les variables ci-dessus ne rendent pas le shell anonyme.

## Échec partiel, relance et limites

Toutes les erreurs de prévalidation bloquent l’ensemble **avant la première création**.
Chaque fiche est ensuite atomique ; le groupe entier n’est pas une transaction unique.
À la première erreur, la CLI s’arrête. Les créations déjà confirmées restent valides : refaire
le dry-run, examiner le nouveau nombre de fiches ignorées et approuver la nouvelle empreinte.
La relance ne crée que les identités encore sans confirmation, sans doublons ni mise à jour
des fiches déjà créées. Une fermeture de connexion incertaine exige la même vérification.
Ne pas rejouer aveuglément l’ancienne empreinte ni retirer les associations pour « recommencer ».

Code 0 : aide, dry-run valide ou application terminée ; code 1 : arguments, Source, plan,
concurrence, transaction ou fermeture refusés. Après un succès initial complet, une nouvelle
prévisualisation doit donner 130 ignorées et 0 créable. Vérifier dans l’administration
PROPOSED/GM, l’association et la provenance/historique, puis revoir les OTHER ; publication
humaine et transformation des wikilinks en relations restent des étapes ultérieures.
Le contrôle final attend 130 Entity PROPOSED/GM avec publishedAt null, 130 Evidence de
la Source protégée, 130 Revision #1 et 130 associations CONFIRMED/MANUAL attribuées à
l’auteur approuvé, sans Relation. Le staging conserve son lot, ses 130 items et ses
130 réceptions. Relancer exactement la commande de dry-run après application :
attendu 130 ignorées, 0 créable, sans écriture. Ne pas relancer le nettoyage après création.

Sélection limitée explicitement à 1 000 identités, plan à 64 Mio, catalogue à 20 000 slugs ;
les dépassements sont des refus, aucune troncature. Le snapshot de lecture est RepeatableRead
et `SET TRANSACTION READ ONLY` est imposé par PostgreSQL. Le groupe n’est pas un snapshot
atomique de toute l’application : éviter les ingestions/changements éditoriaux concurrents.
L’empreinte est une approbation de contenu, pas une authentification Discord ni une preuve
de véracité du lore. Les tests locaux fictifs ne remplacent pas une validation du pilote et
des contraintes sur PostgreSQL isolé. Aucun accès au VPS ou à PostgreSQL de production
n’est réalisé pendant l’implémentation ; aucune donnée réelle n’est enregistrée dans Git/tests.

Validation locale : **624 tests réussis = 384 API + 240 web**, soit 53 tests supplémentaires.
Ils couvrent les dossiers, exceptions, homonymes, champs et formats refusés, l’approbation
du plan, 130 notes fictives, l’idempotence et la reprise après interruption. Le double Prisma
transactionnel existant couvre la lecture seule, l’exclusion de neuf items d’une autre Source,
la dernière version/réception, la provenance complète, les six points de rollback et les
changements/concurrences entre revue et création. Les tests HTTP v0.7d restent réussis.
