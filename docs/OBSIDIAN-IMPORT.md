# M3 — préparation locale d’un coffre Obsidian

Cette première étape prolonge le pipeline v0.7a–v0.7e. Elle convertit des notes locales en
lots JSON staging v1. Elle lit uniquement le coffre explicitement fourni et ne déclenche ni ingestion
en base, matching, association, création/mise à jour de fiche, relation, événement ou publication.
Le document d’architecture Hesta Hub décrit une cible ultérieure : ses correspondances
dossiers→types et relations automatiques ne sont pas appliquées ici.

## Architecture

- `obsidian-cli.ts` lance seulement `obsidian-command.ts`, sans dotenv, pilote PostgreSQL,
  factory Prisma, service d’ingestion ou client réseau.
- `obsidian-files.ts` contrôle les chemins, explore les fichiers et lit chaque note en UTF-8
  strict avec une allocation bornée à 256 Kio + 1 octet. Le BOM et les fins de ligne sont conservés.
- `obsidian-markdown.ts` analyse défensivement le frontmatter avec `yaml`, extrait les seuls
  champs autorisés et inventorie les wikilinks. Aucun contenu YAML/Markdown/HTML n’est exécuté.
- `obsidian.ts` réutilise `validateIngestionDocument` et `parseIngestionText` de `format.ts`.
  Première passe : contrôler les notes, compter séparément les emplacements réservés,
  constituer et valider les lots des notes admissibles, garder seulement leurs
  listes de fichiers et empreintes. Deuxième passe : relire, vérifier les empreintes et écrire.
  Les corps de tout le coffre ne sont pas conservés ensemble en mémoire.

La seule correction commune au staging concerne le contrôle des metadata **avant** la
projection Zod, pour refuser notamment une clé `__proto__` au lieu de la perdre silencieusement.
Le schéma Prisma, les migrations et les workflows éditoriaux restent inchangés. Un test web
historique de préparation en erreur attend désormais l’effet React de focus avant son assertion,
pour supprimer une course observée durant la validation, sans affaiblir le contrôle d’accessibilité.

## Commande et options

Depuis la racine du dépôt, après `npm ci` et `npm run prisma:generate` (génération locale des
types/enums, sans connexion SQL). Node.js 22 minimum.

```powershell
npm run --silent lore:obsidian:prepare -- --help
```

| Option | Contrat |
| --- | --- |
| `--vault CHEMIN` | Obligatoire, chemin absolu vers un coffre sur disque local. |
| `--vault-id ID` | Obligatoire, identifiant explicite et stable de la Source du coffre. |
| `--source-label LIBELLE` | Obligatoire, libellé de la Source, règles staging existantes. |
| `--subdir RELATIF` | Facultatif, sous-dossier relatif au coffre ; `/` ou `\`. Aucun segment `..`, masqué, vide ou avec `:`. |
| `--limit N` | Facultatif, entier strictement positif et sûr ; sélectionner les N premières notes dans l’ordre déterministe. |
| `--dry-run` | Inspection sans créer de dossier/fichier ni contacter de base. |
| `--output CHEMIN` | Obligatoire pour écrire ; facultatif en dry-run, alors sa sûreté est aussi vérifiée. Chemin absolu d’un **nouveau** répertoire ; parent déjà existant. |

Options inconnues, doublons et valeurs manquantes sont refusés. Code de sortie 0 pour
réussite/aide/coffre vide ; 1 pour refus ou erreur. La génération est explicitement demandée
en fournissant `--output` sans `--dry-run`. Aucune option ne lance `lore:ingest`.

Utiliser `npm run --silent` : npm ordinaire affiche sa commande et les arguments, qui peuvent
contenir des chemins/libellés privés. Le convertisseur lui-même journalise seulement des
compteurs, codes constants et numéros de notes, sans chemins, titres, contenu, clés YAML,
identifiant du coffre, liens ou exceptions natives. L’historique du shell, les transcriptions
et la liste des processus peuvent néanmoins conserver les arguments : utiliser une session
locale privée et ne pas partager ces traces. Les JSON restent des données privées en clair.

## Identité, provenance et dates

Toutes les notes ont la même Source `{ kind: "OBSIDIAN", externalId: ID, label: LIBELLE }`.
Son URL, auteur et date canonique restent null. Ne pas changer l’identifiant du coffre entre
exports : le staging résout la Source par `(kind, externalId)`, et ne renomme pas automatiquement
sa description existante.

`item.externalId` et `locator` contiennent le chemin **relatif au coffre entier**, extension
incluse, séparateurs `/`, même avec `--subdir`. Casse et représentation Unicode du nom restent
exactes ; aucune normalisation de l’identité ne rapproche deux chemins différents.
`contentType` vaut `text/markdown`. Le contenu est le Markdown exact, frontmatter compris.
`observedAt` est le **mtime technique du fichier** en ISO UTC, relevé au moment de la lecture.
Il ne représente ni une date du monde fictif, ni une publication, ni une date d’ingestion SQL.

Deux exports du même état produisent les mêmes lots, dans le même ordre ; un changement de
mtime peut changer observedAt sans changer le hash de contenu. Le hash du staging garde sa
normalisation historique NFC/fins de ligne. Même Source + même chemin = même identité ; une
modification du Markdown pourra produire une version suivante lors d’une ingestion distincte.
Un renommage/déplacement crée une autre identité : **résolution humaine future**, aucun
rapprochement par titre ou hash, aucune suppression de l’ancienne identité. Sans historique
local, ce convertisseur ne peut pas reconnaître automatiquement les renommages/suppressions.

## Notes vides : emplacements réservés

Un fichier Markdown vide ou composé uniquement de caractères d’espacement est un
**emplacement réservé**, distinct d’une note admissible et d’une erreur. Cela comprend
espaces, tabulations, fins de ligne, espaces Unicode et BOM seul. La classification intervient
après la lecture sécurisée : chemin, fichier régulier, stabilité pendant la lecture, limite de
256 Kio et UTF-8 strict restent contrôlés. Un fichier trop volumineux, illisible, mal encodé ou
contenant un NUL reste une erreur réelle ; il n’est pas assimilé à un emplacement réservé.

Ces fichiers ne sont ni modifiés, ni remplis de Markdown artificiel, ni convertis en items
staging. Aucun lot vide, Source en base ou Entity n’est créé pour eux. Un coffre composé
uniquement d’emplacements réservés réussit avec zéro erreur, zéro lot et aucun dossier de
sortie créé. Un frontmatter seul ou tout autre Markdown non vide suit les règles existantes ;
le convertisseur ne décide pas si la description est suffisamment rédigée.

Tous les chemins Markdown découverts restent dans l’index des wikilinks, y compris les
emplacements réservés. **Un lien `FOUND` vers une note vide signifie seulement que le
fichier existe dans le périmètre découvert : aucune Entity correspondante n’est garantie
dans le Codex, et cette note n’est pas exportée au staging.** Le format staging v1 reste
inchangé et continue de refuser un item dont le contenu est vide ou uniquement blanc.

Le compteur concerne uniquement les notes sélectionnées et lues. `--limit N` sélectionne
toujours N chemins, emplacements réservés compris ; il ne recherche pas N notes admissibles.
Les fichiers différés restent dans l’index mais ne sont pas lus ni classés.

## Frontmatter et wikilinks

Un frontmatter doit commencer à la première ligne, après le BOM éventuel, par `---` seul
(espaces finaux permis) et se terminer par `---` ou `...`. YAML 1.2 core, mapping racine,
clés chaînes uniques, aucun tag explicite/personnalisé, alias YAML `*`, merge `<<` ou exécution.
Une ancre YAML sans alias ne développe rien. Profondeur ≤ 8 et ≤ 1 024 nœuds avant conversion.
Les erreurs et avertissements du parseur sont traités comme un refus, sans afficher leur texte.
Frontmatter absent autorisé ; malformé, non fermé ou trop complexe : note inadmissible.

Le frontmatter complet est contrôlé avec le validateur metadata du staging, y compris les
propriétés non exportées, pour ne pas contourner le refus de secrets/clés dangereuses.
Des propriétés volumineuses ou interdites peuvent donc rendre une note inadmissible même
si elles ne feraient pas partie de la liste exportée. Aucun champ n’est tronqué.

Seuls `title`, `aliases`, `tags` sont interprétés. Titre utilisable : règles staging, maximum
250 caractères ; sinon avertissement et repli sur le premier titre Markdown `#`, puis basename
sans `.md`. Le repérage des titres est élémentaire, hors blocs de code/commentaires, sans
rendu HTML. Les alias/tags acceptent une chaîne unique ou une liste, validée intégralement
avec les règles éditoriales existantes : 30 valeurs maximum, 200/100 caractères, sans doublons.
Liste inutilisable : avertissement, aucun sous-ensemble inventé. Propriétés inconnues :
avertissement, uniquement conservées dans le Markdown. Aucune visibilité, catégorie/type,
date narrative ou instruction YAML n’est appliquée. Les metadata finales ont la forme :

```json
{
  "aliases": ["Alias fictif"],
  "tags": ["fiction"],
  "obsidian": {
    "wikilinks": [{
      "target": "Autre note", "anchor": "Titre interne", "alias": "Libellé",
      "embed": false, "status": "MISSING", "path": null
    }]
  }
}
```

Les wikilinks `[[Note]]`, `[[Note|Alias]]`, `[[Note#Titre|Alias]]`, `[[#^bloc]]` et `![[Note]]`
sont inventoriés hors blocs de code, spans de code simples, commentaires HTML et liens échappés.
100 occurrences maximum par note ; davantage ou metadata finales excessives : refus explicite,
aucune troncature. Ce reconnaisseur ne remplace pas tout le parseur Markdown/Obsidian.

`FOUND` signifie qu’un chemin Markdown découvert dans le périmètre autorisé correspond,
pas qu’une Entity/association existe ou que l’ancre interne a été vérifiée. Les correspondances
sont sensibles à la casse, sans décodage URL/NFC, par chemins relatifs/racine et basename ;
plusieurs candidats donnent `AMBIGUOUS`, sans choix arbitraire. Le catalogue comprend les
notes vides et notes différées par `--limit`, sans lire le contenu de ces dernières : FOUND
ne garantit ni leur admissibilité, ni leur export, ni une Entity correspondante.
Un sous-dossier limite aussi le catalogue. `MISSING`, `AMBIGUOUS`, `UNSUPPORTED` et
`OUT_OF_SCOPE` sont conservés avec cible/alias/ancre dans le JSON et comptés en avertissements.
La résolution ne fait aucun accès filesystem au chemin du lien.

Pièces jointes et Canvas ne sont pas exportés ; leurs fichiers comptent comme entrées ignorées.
Les embeds restent des références, sans inclusion de contenu. Les URI et extensions de pièces
jointes courantes sont UNSUPPORTED ; les autres cibles sans correspondant restent MISSING.
Les liens Markdown ordinaires ne sont pas inventoriés. Aucun fichier référencé ni URL n’est ouvert.
Le workflow éditorial v0.7d/e sait reprendre les tags ; les alias exportés restent inspectables,
sans nouvelle reprise automatique dans les formulaires historiques.

## Limites, sécurité et rapport

Le validateur existant reste l’autorité : JSON ≤ 5 Mio, ≤ 500 items, Markdown ≤ 256 Kio,
externalId ≤ 1 024 octets UTF-8, titre ≤ 250 caractères, locator ≤ 1 024 caractères,
metadata ≤ 16 Kio et ses limites de profondeur/nombre de valeurs/chaînes. Unicode invalide,
NUL et secrets reconnus sont refusés. Le détecteur de secrets couvre des formats connus ;
il ne garantit pas l’identification de tout secret écrit en prose. Revue locale indispensable.

Les fichiers visibles `.md`/`.MD` sont triés par chemin relatif, ordre lexical JavaScript,
indépendant de la locale. Lots nommés `obsidian-000001.json`, etc., remplis sans dépasser les
limites d’items ou d’**octets JSON réellement échappés**, defaults et newline compris.
L’exploration s’arrête explicitement en erreur au-delà de 100 000 entrées ou 64 niveaux.
Un problème de lecture d’un dossier interrompt l’inspection ; aucun export partiel n’en découle.

Fichiers/dossiers masqués, notamment `.obsidian`, `.git`, `.trash`, et liens symboliques sont
ignorés. Un coffre, sous-dossier choisi ou parent de sortie comprenant un lien symbolique ou
une jonction est refusé. Aucune écriture dans le coffre, sortie dedans interdite. Sortie refusée
dans tout arbre possédant un `.git` ancêtre, y compris `.git` fichier pour un worktree.
Les chemins UNC sont refusés ; choisir un disque réellement local, sans lecteur réseau monté
ni dossier synchronisé susceptible d’envoyer le lore. Les montages système/synchronisations
ne sont pas détectables de façon portable par ce contrôle de chemins.

La sortie doit être neuve : aucun écrasement ni suppression d’un export précédent. Création
du dossier après validation complète, permissions 0700/0600 lorsque le système les applique ;
sous Windows, vérifier les ACL du parent. Écriture dans `.part`, sync, publication par hardlink
atomique sans remplacement, puis retrait du `.part` : filesystem supportant les hardlinks
requis (NTFS notamment). Les `.json` publiés sont toujours des lots complets validés.

Modification d’une note retenue pour l’export entre les deux passes, y compris si elle devient
vide : refus et retrait des fichiers créés par cette
exécution après contrôle du dossier. Erreur d’écriture : même nettoyage. Si le nettoyage échoue
ou que le dossier est substitué, `EXPORT_FAILED_CLEANUP_REQUIRED` exige une inspection locale ;
aucun nettoyage récursif aveugle. Une interruption brutale peut laisser un répertoire incomplet
ou un `.part` : code 0 et nombre de lots écrits doivent être obtenus avant d’utiliser la sortie.

Travailler sur un coffre immobile ou une copie locale, fermer l’éditeur/synchronisation pendant
la génération. Les contrôles stat/lstat/realpath/open et les empreintes ne constituent pas un
snapshot atomique de tout le coffre ; des créations/suppressions hors sélection après le scan
ou une substitution malveillante concurrente de parents/montages ne sont pas couvertes comme
par une sandbox OS. Le contenu de chaque note relue est toutefois comparé avant publication.
Les emplacements réservés sont classés à la première passe et ne sont pas relus pour l’export :
leur remplissage ultérieur nécessite une nouvelle exécution sur un coffre immobile.

Rapport : Markdown détectés dans le périmètre visible ; notes sélectionnées/admissibles ;
**emplacements réservés (notes vides), exclus de l’export**, sans erreur ni avertissement ;
entrées ignorées (un dossier ignoré compte une entrée, son contenu n’est pas exploré) ; notes
différées par limite ; nombres d’erreurs/avertissements ; lots estimés/validés/écrits ; comptes
de wikilinks par statut. Les statistiques de wikilinks concernent les notes admissibles.
Les notes sélectionnées se répartissent entre admissibles, emplacements réservés et erreurs
réelles (un diagnostic d’erreur par note refusée). Une note peut avoir
plusieurs avertissements. Diagnostics limités à 100 lignes, total des suivants indiqué.
« Note N » désigne la position 1-based dans la liste triée des notes sélectionnées, sans exposer
son chemin. Tous les lots estimés sont vérifiés par le validateur existant. **Toute erreur de note
bloque l’export entier**, même si d’autres notes sont admissibles ou réservées.
Coffre vide ou composé uniquement d’emplacements réservés : zéro lot/dossier.
Aucun compteur NEW/MODIFIED/UNCHANGED ni simulation de comparaison avec PostgreSQL.

## Essai fictif et validation locale

Exemple PowerShell : tous les chemins créés sont dans le répertoire temporaire local, hors Git.
Ne pas remplacer ces valeurs par le vrai coffre avant revue et communication explicite de son chemin.

```powershell
$trial = Join-Path $env:TEMP ('hesta-obsidian-demo-' + [guid]::NewGuid())
$vault = Join-Path $trial 'vault'
$output = Join-Path $trial 'export'
New-Item -ItemType Directory -Path (Join-Path $vault 'Lieux') -Force | Out-Null
$utf8 = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText((Join-Path $vault 'Lieux/Cite.md'), "---`ntitle: Cité fictive`ntags: [fiction]`n---`n# Cité`n[[Personne|Amie]] [[Absent#Titre]]`n", $utf8)
[IO.File]::WriteAllText((Join-Path $vault 'Personne.md'), "# Personne fictive`nTexte fictif.`n", $utf8)

npm run --silent lore:obsidian:prepare -- --vault "$vault" --vault-id "demo-fiction-v1" --source-label "Coffre fictif" --limit 2 --dry-run
npm run --silent lore:obsidian:prepare -- --vault "$vault" --vault-id "demo-fiction-v1" --source-label "Coffre fictif" --limit 2 --output "$output"
```

Attendu : 2 notes admissibles, 1 FOUND, 1 MISSING, 1 avertissement, 1 lot validé ; zéro lot
écrit en dry-run, puis 1 écrit. Ouvrir localement le lot, contrôler chemins relatifs, Source
unique, Markdown original, mtime et metadata. Comparer les notes avant/après ; elles sont intactes.
Relancer dans **une nouvelle sortie** : même identité/hash/JSON si les notes et mtimes sont inchangés.
Modifier une note fictive, régénérer : identité stable, hash de contenu différent.

Validation de tous les lots avec le validateur partagé, sans base et sans afficher de lore :

```powershell
@'
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseIngestionText } from './apps/api/src/ingestion/format.ts';
try {
  const directory = process.argv[2];
  const files = (await readdir(directory)).filter(name => name.endsWith('.json')).sort();
  let valid = files.length > 0;
  for (const file of files) valid = parseIngestionText(await readFile(join(directory, file), 'utf8')).success && valid;
  console.log(valid ? 'Tous les lots sont valides.' : 'Validation refusée.');
  process.exitCode = valid ? 0 : 1;
} catch { console.log('Lecture ou validation refusée.'); process.exitCode = 1; }
'@ | node --import tsx --input-type=module - "$output"
```

Tests reproductibles du dépôt (fixtures exclusivement fictives et temporaires). Sous Windows,
les tests de liens symboliques de fichiers nécessitent le droit de les créer (mode Développeur
ou privilège système correspondant) ; ils ont été exécutés avec ce droit sur la machine locale.

```powershell
npm exec -- tsx --test apps/api/src/ingestion/obsidian.test.ts apps/api/src/ingestion/ingestion.test.ts
npm run lint
npm run typecheck
npm test
npm run build
npm run prisma:validate
npm run prisma:generate
git diff --check
```

Validation locale finale M3.1 : **566 tests réussis = 326 API + 240 web**.
Par rapport au socle v0.7e (524 tests), 41 tests du convertisseur et un test de régression
du validateur metadata ont été ajoutés. Lint, typecheck, build, Prisma validate/generate et
contrôles de whitespace passent. Symlinks de fichiers et jonctions de dossiers Windows,
modification pendant les deux passes avec retrait des lots déjà écrits, lots de 501 notes
et frontière des octets JSON échappés sont testés. Un processus CLI avec sockets/HTTP/fetch
interdits et une DATABASE_URL volontairement inutilisable réussit son export fictif.
La commande npm réelle a aussi préparé les deux notes fictives ci-dessus : zéro écriture en
dry-run, puis un lot, 1 FOUND et 1 MISSING. Les fixtures et exports temporaires sont supprimés.
Aucun vrai coffre, PostgreSQL, VPS, migration, commit, push ou déploiement utilisé.

La revue finale a corrigé le découpage des lignes lors de l’analyse de la prose : les blocs
de code à tildes avec fins de ligne CR seules pouvaient fournir un faux titre/wikilink.
Le test de régression couvre LF, CRLF et CR, délimiteurs backticks et tildes, avec conservation
exacte du Markdown exporté et des notes sources. Aucun autre défaut bloquant identifié,
aucune fonctionnalité supplémentaire ni changement du format staging v1.

Validation du correctif M3.2 (notes vides) : **571 tests réussis = 331 API + 240 web**,
dont 46 tests du convertisseur. Une fixture exclusivement fictive de 161 Markdown reproduit
31 emplacements réservés, 130 notes admissibles et zéro erreur en dry-run puis à l’export ;
seuls les 130 items admissibles apparaissent dans le lot staging v1. Cela ne constitue pas
une nouvelle inspection du véritable coffre : son résultat reste à confirmer localement par
son propriétaire, sous réserve d’absence d’autre erreur réelle.

Les régressions couvrent fichiers zéro octet, espaces/tabulations/fins de ligne/Unicode/BOM,
limite de taille conservée même pour des espaces, coffre entièrement réservé sans sortie,
liens FOUND vers des notes vides, sélection par limite, exports identiques octet pour octet
et SHA-256 identiques, erreurs réelles bloquant tous les lots malgré les emplacements réservés,
ainsi qu’une note devenue vide entre les deux passes avec nettoyage des lots déjà écrits.
Les sorties CLI restent dépourvues de données privées ; le test avec réseau/base interdits
inclut un emplacement réservé. Le validateur staging v1 continue de refuser les items vides.
Ce correctif ne modifie ni version du paquet, dépendance, schéma Prisma, migration ou workflow
éditorial, ni règles de création d’Entity.

## Étape distincte : inspection du staging en base

**Ne pas exécuter pendant cette livraison.** Après revue des JSON, configurer séparément une
base PostgreSQL **locale/de test isolée** avec le schéma existant. `lore:ingest --dry-run` lit
la base pour comparer les identités/hashes ; ce n’est pas le dry-run du convertisseur.

```powershell
npm run --silent lore:ingest -- "$output/obsidian-000001.json" --dry-run
```

Ce sont alors les vrais compteurs de comparaison NEW/MODIFIED/UNCHANGED. Pour plusieurs lots,
les dry-runs indépendants ne simulent pas la persistance des lots précédents ; les éventuelles
ingestions effectives se feront dans l’ordre, après autorisation distincte. La création/mise à
jour éditoriale, association et publication restent des étapes humaines du pipeline existant.

Pour un coffre réel futur : fournir explicitement son chemin, choisir un identifiant durable,
une copie locale immobile et une sortie privée neuve hors dépôt/synchronisation. Commencer par
un sous-dossier et `--limit 5 --dry-run`, traiter tous les diagnostics, exporter, inspecter les
lots et valider localement ; augmenter ensuite progressivement. Revoir les propriétés YAML,
les secrets non reconnus, homonymes, liens manquants et renommages avant tout accès à la base.
