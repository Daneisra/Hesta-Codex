# Import structuré du lore — format v1

Pour créer une seule fiche depuis l'administration avec sa provenance initiale, voir
[MANUAL-CREATION.md](MANUAL-CREATION.md). Ce parcours conserve l'import JSON pour les lots.

Ce pipeline CLI introduit des propositions éditoriales dans PostgreSQL. Il est séparé de
l'API publique, qui reste uniquement en lecture. Aucun connecteur externe, compte utilisateur
ou publication automatique n'est inclus.

## Utilisation

Préparer une copie du [template technique](../examples/lore-import.template.json) avec des
informations réelles et une provenance vérifiable. Le template n'est **pas du lore canonique**
et n'est importé ni par la CI ni par le seed. Configurer la base dans `.env` local, ignoré par
Git, puis lancer d'abord :

```bash
npm run lore:import -- chemin/vers/fichier.json --dry-run
```

Le dry-run vérifie le JSON, les références, le catalogue `RelationType` et les collisions dans
la base. Il n'écrit aucune ligne en base. Il affiche les comptes de Source, fiches et relations
nouvelles/existantes, puis les erreurs et avertissements avec un chemin tel que
`entities[0].placeKind`. Un dry-run réussi ne réserve aucun slug : l'import réel refait les
contrôles dans sa transaction.

Après examen du rapport, lancer explicitement :

```bash
npm run lore:import -- chemin/vers/fichier.json
```

Une erreur bloquante donne un code de sortie non nul. La commande ne journalise jamais la
chaîne de connexion, le contenu de `.env`, le JSON complet ou les erreurs brutes de Prisma.
Le script npm régénère le client Prisma local si nécessaire ; le dry-run ne modifie aucune
donnée PostgreSQL. Les fichiers sont limités à 5 Mio, 200 fiches, 500 relations et 100 preuves
par entrée pour garder les transactions bornées.

## Structure JSON

Le document est un objet JSON UTF-8 strict. Un BOM UTF-8 est accepté ; un encodage invalide
est refusé avant connexion à la base. Les champs inconnus, statuts éditoriaux fournis par le
fichier et versions autres que `1` sont refusés. Tous les champs facultatifs peuvent être
omis, sauf indication contraire. Un fichier vide ou un lot sans fiche et sans relation est
refusé. `entities` et `relations` peuvent être omis individuellement si l'autre tableau
contient au moins une entrée.

| Champ | Règle |
| --- | --- |
| `version` | Entier `1` obligatoire. |
| `source` | Objet obligatoire : `kind`, `label`, puis `externalId`, `url`, `authorLabel` facultatifs. |
| `entities` | Tableau de fiches ; vide ou absent seulement si `relations` contient des entrées. |
| `relations` | Tableau de relations ; vide ou absent si le lot contient des fiches. |

Un exemple complet mais totalement neutre est fourni dans
[`examples/lore-import.template.json`](../examples/lore-import.template.json). Il illustre deux
fiches techniques et une relation orientée ; remplacer son contenu avant tout import réel.

`source.kind` accepte les valeurs actuelles de `SourceKind` : `MANUAL`, `OBSIDIAN`, `DISCORD`,
`HESTA_MAP`, `YOUTUBE`, `AI_DERIVED`, `OTHER`. Ce champ décrit une provenance déclarée ; il
ne lance aucun connecteur. `label` est requis (250 caractères maximum). `externalId` est un
identifiant stable de la source externe (250 caractères maximum) ou `null`. Il est comparé
exactement : les espaces périphériques sont refusés, sans normalisation silencieuse. `url`, si fournie,
est une URL HTTP(S). `authorLabel` est un nom textuel (200 caractères maximum).

### Fiches

| Champ | Règle |
| --- | --- |
| `slug` | Requis, unique dans le fichier et la base, 200 caractères maximum ; minuscules ASCII, chiffres et tirets entre segments. |
| `kind` | Une valeur de `EntityKind` du schéma Prisma. |
| `placeKind` | Obligatoire uniquement pour `PLACE` ; interdit pour les autres types. Valeurs : `CITY`, `CONTINENT`, `REGION`, `SEA`, `OCEAN`, `OTHER`. |
| `title` | Requis, non vide, 200 caractères maximum. |
| `summary` | Texte ou `null`, 500 caractères maximum ; défaut `null`. |
| `bodyMarkdown` | Markdown ; défaut chaîne vide. |
| `aliases`, `tags` | Tableaux de textes ; défaut `[]`. |
| `visibility` | `PUBLIC`, `PLAYERS`, `GM` ou `SECRET` ; défaut `GM`. |
| `evidence` | Tableau obligatoire d'au moins une preuve. |

Les valeurs de `EntityKind` sont `PERSON`, `PLACE`, `ORGANIZATION`, `FAMILY`, `RELIGION`,
`DEITY`, `SPECIES`, `CREATURE`, `ARTIFACT`, `EVENT`, `QUEST`, `SESSION`, `CONCEPT` et `OTHER`.
Les chaînes d'`aliases` et de `tags` sont élaguées de leurs espaces périphériques ; les
valeurs vides ou dupliquées sans distinction de casse sont refusées, avec le chemin précis.

La commande impose `status = PROPOSED` et `publishedAt = null`, même si la visibilité fournie
est `PUBLIC`. Elle crée une `Revision` numéro 1 avec le contenu de la fiche, l'identifiant de
la Source et l'attribution `Import CLI Hesta Codex`. Le fichier ne peut pas définir un statut
`PUBLISHED`. Un slug déjà en base bloque tout le lot ; aucun écrasement ni fusion n'a lieu.

### Relations

Chaque relation a `from` et `to` (slugs), `type` (code direct existant dans `RelationType`),
`description` facultative, `visibility` facultative (`GM` par défaut) et au moins une
`evidence`. Les slugs peuvent désigner une fiche du lot ou une fiche déjà en base. Les codes
inverses comme `contains` servent à l'affichage, mais ne sont pas acceptés comme `type`
d'import : utiliser le code direct, par exemple `located_in`. Les espaces périphériques du
code sont refusés.

Une relation vers elle-même est interdite. Les doublons exacts du lot ou de la base sont des
conflits bloquants. Pour un type symétrique, `A → B` et `B → A` désignent la même arête :
l'import vérifie les deux sens existants et stocke les nouvelles arêtes dans l'ordre
alphabétique des slugs. Les relations nouvelles sont `PROPOSED`, jamais publiées par l'import.

### Preuves et provenance

Chaque `evidence` comporte un `claimText` non vide (10 000 caractères maximum). Les champs
`sourceExcerpt`, `locator` (250 caractères maximum), `timeStartSeconds`, `timeEndSeconds` et
`confidence` sont facultatifs ou `null`. Les timestamps sont des secondes entières positives
ou nulles, dans la plage de PostgreSQL `INTEGER` ; une fin ne peut précéder un début.
`confidence` est entre 0 et 1 avec au plus trois décimales, conformément au champ SQL
`DECIMAL(4,3)`. Toute preuve créée a exactement une cible — fiche ou relation — et référence
la Source du lot. Sa visibilité reste `GM` pour cette première version.

Si `(source.kind, source.externalId)` existe déjà avec un `externalId` non null, la Source est
réutilisée sans modification ; un écart de libellé, d'URL ou d'auteur produit un avertissement.
Avec `externalId = null`, une nouvelle Source est créée à chaque import appliqué : le label
seul ne constitue jamais une clé de déduplication.

## Atomicité et limites éditoriales

Le JSON est validé avant toute écriture. L'import réel résout ensuite les références et
collisions **dans une transaction Prisma sérialisable**, puis crée Source, fiches, preuves,
révisions et relations dans le même lot. Toute erreur d'écriture annule la transaction entière.
Un conflit concurrent fait échouer le lot ; refaire un dry-run avant de réessayer. Le dry-run
utilise uniquement des lectures et n'ouvre pas de transaction d'écriture.

Le schéma actuel rattache `Revision` uniquement à `Entity`. Cette version n'effectue aucune
mise à jour de Source ou Relation ; leurs créations sont horodatées et les relations ont des
`Evidence` liées à la Source. Une révision dédiée des autres modèles demanderait une évolution
du schéma. La publication et les permissions restent hors du CLI.

## Évolutions prévues

La revue, l'édition et la publication des fiches importées sont disponibles depuis v0.4b.
v0.4c ajoute la correction des relations, sources et preuves importées ; voir
[EDITORIAL-WORKFLOW.md](EDITORIAL-WORKFLOW.md) et [PROVENANCE-WORKFLOW.md](PROVENANCE-WORKFLOW.md).

- Mode update explicite avec politique de conflit et révisions correspondantes.
- Création et suppression contrôlées des relations, sources et preuves depuis le back-office.
- Import Obsidian, Discord et Carte Hesta.
- Ingestion de transcriptions YouTube et de parties JDR horodatées.
- Propositions générées par IA conservées en `PROPOSED` et revues humainement avant publication.
