# Navigation et références Obsidian

Les fiches existantes associées à une identité `OBSIDIAN` confirmée deviennent navigables
depuis leur Markdown. Aucun import, création de fiche, modification de contenu, publication,
migration ou écriture dans `Relation` n'est nécessaire. Les preuves, révisions, associations
et réceptions existantes restent inchangées. Le coffre n'est jamais ouvert par cette fonction.

## Résolution

`[[Nom]]`, `[[Nom|Alias]]`, `[[Dossier/Nom]]`, les chemins relatifs restant dans la Source
et `[[Nom#Section]]` sont analysés dans les parties textuelles du Markdown CommonMark/GFM.
Le résolveur de chemins est partagé avec le convertisseur M3.1. La navigation utilise les
associations `CONFIRMED`, le chemin externe original, le titre éditorial, les alias éditoriaux
et les alias valides conservés dans la dernière réception du snapshot associé.

La résolution reste dans la même Source. Casse et Unicode NFC sont normalisés, sans supprimer
les accents ni faire de recherche floue. Des chemins distincts après cette normalisation sont
ambigus, même si leur nom est identique. Deux homonymes dans des dossiers différents nécessitent
un chemin explicite ; aucune priorité arbitraire n'est donnée au dossier local. Plusieurs origines
confirmées pour une même fiche doivent toutes désigner la même destination fiable.

Les chemins `FOUND` conservés dans les métadonnées du convertisseur restent dans l'index,
y compris quand aucune fiche n'y est associée. `FOUND` décrit une note du coffre à la conversion,
pas l'existence d'une Entity. Une référence vers une note vide/non promue reste du texte lisible,
avec le diagnostic « sans fiche associée ». Sans métadonnée d'origine suffisante, le diagnostic
est « absente ». L'interface ne prétend pas identifier avec certitude les 31 notes vides.
Une ambiguïté conservée par le convertisseur reste bloquante pour cette cible textuelle,
même si un seul homonyme a été promu : l'autre peut être une note vide dont aucun chemin
candidat n'a été exporté. Un chemin explicite différent peut lever cette ambiguïté lorsqu'il
identifie de manière fiable une association existante.

Une section correspond à un titre Markdown unique (casse/espaces/NFC normalisés). Les titres
rendus reçoivent un identifiant stable préfixé `obsidian-`. Une section absente, répétée ou une
ancre de bloc `^identifiant` donne un lien vers la fiche sans fragment, accompagné d'un diagnostic.
Le focus et le défilement suivent les sections reconnues. L'alias reste du texte, jamais du HTML.

Le Markdown stocké n'est pas réécrit : seule l'arborescence de rendu est enrichie. Code en bloc,
code en ligne, blocs de code dans listes/citations, commentaires HTML, liens/images Markdown
classiques et wikilinks échappés sont exclus. Les inclusions `![[...]]` et pièces jointes sont
diagnostiquées sans devenir des liens ou des fiches. Une syntaxe coupée par la grammaire GFM
(par exemple un séparateur de tableau non échappé) n'est pas reconstruite artificiellement.
Les citations/listes sur plusieurs lignes et les alias de tableau avec séparateur `\|` sont
pris en charge sans perdre les caractères ou préfixes environnants.

## Administration et graphe

Chaque fiche admin affiche les fiches mentionnées, les fiches qui la mentionnent, le nombre
d'occurrences et les diagnostics. Le slug accompagne les titres pour distinguer les homonymes.
Les mentions sont textuelles : elles ne signifient ni « appartient à », ni « dirige », ni une
autre relation sémantique.

Le graphe admin ajoute une arête dirigée par couple de fiches source/destination, avec
`origin: "OBSIDIAN"`, `type: "OBSIDIAN_REFERENCE"` et `occurrences`. Ces arêtes sont bleu gris,
fines et translucides en vue globale ; pointillés et flèches apparaissent sur les références
mises en évidence par survol ou sélection. Les relations éditoriales restent dorées et continues.
Les références suivent
une légère courbe pour distinguer deux types de lien entre les mêmes fiches. Recherche, voisinage,
isolation, zoom, déplacement, disposition et ouverture des fiches utilisent les index existants.
Le filtre « Type de connexion » permet de choisir les références Obsidian. Les filtres de statut
et de visibilité de relation masquent ces références, qui n'ont aucun statut éditorial propre.
Le graphe public conserve exclusivement les relations éditoriales publiées et publiques.

## Confidentialité et cohérence

La navigation publique expose seulement des offsets, libellés déjà présents dans le contenu
public et liens vers des fiches `PUBLISHED + PUBLIC`. Aucun slug privé, chemin d'origine,
diagnostic privé, association, compteur global ou candidat à une ambiguïté n'y est retourné.
Les homonymes privés empêchent aussi une résolution arbitraire vers un homonyme public.
Les routes admin conservent la whitelist Discord et `Cache-Control: no-store`.

Le catalogue est lu dans une transaction PostgreSQL `REPEATABLE READ`, `READ ONLY` ; l'analyse
Markdown s'effectue ensuite en mémoire. Aucun cache global de contenu privé n'est ajouté.
Les offsets ne sont appliqués que si `updatedAt` correspond à la fiche affichée. Une modification
concurrente laisse le rendu original utilisable ; recharger recalcule les références. Après une
modification admin d'une fiche ayant des références, la lecture détaillée est rafraîchie.

Les lectures sont bornées à 2 000 fiches, 4 000 associations et 32 Mio de Markdown ; le calcul
refuse plus de 100 000 occurrences. Un dépassement donne `503 REFERENCES_LIMIT`, jamais un
catalogue tronqué. Le catalogue est recalculé par requête ; ces limites ne constituent pas
une garantie de performance à grande échelle. Aucune base réelle n'est utilisée par les tests.

## Compteurs et vérification du véritable corpus

Dans `/admin/graphe`, les compteurs portent sur le catalogue complet avant filtrage :

- **Occurrences** : wikilinks analysés dans le texte rendu, répétitions comprises.
- **Références uniques résolues** : couple source/destination et section demandée ; les alias
  et répétitions d'une même mention ne doublent pas ce compteur.
- **Arcs** : couples dirigés de fiches, toutes les sections et occurrences regroupées.
- **Ambiguës / absentes / sans fiche associée / non prises en charge** : références distinctes
  par fiche source, cible textuelle normalisée et section, avec répétitions regroupées.

Les 866 `FOUND` annoncés par le convertisseur sont un compte historique d'occurrences de notes,
incluant des destinations sans Entity ; ils ne prédisent aucun de ces compteurs. L'analyse du
rendu exclut également les syntaxes Markdown que le scanner historique pourrait avoir comptées.
Les nombres réels résolus/ambiguës/absents restent à relever dans l'administration après revue
et déploiement explicitement autorisé. Ils ne sont pas inventés à partir des 866 occurrences.

Pour la vérification humaine : ouvrir Goliath, Inquisition et Académie des Mages ; vérifier
respectivement Dipovia/Vruliwen, Comosicus Thiri/Zemantis et Valerius Primus/Vruliwen. Vérifier
Barolt avec et sans dossier, les diagnostics vers les notes sans fiche, les alias et sections,
les références entrantes et la distinction des liens du graphe, notamment au survol. Comparer la vue complète et les
filtres. En session publique, aucune fiche `PROPOSED`, `GM`, `PLAYERS` ou `SECRET` ne doit être
accessible. Cette étape ne demande aucune réimportation ni nouvelle promotion du staging.

Les tests utilisent seulement des contenus synthétiques, y compris les noms fournis pour les
cas d'acceptation. Une fixture de compteurs contient 5 occurrences : 2 références uniques
résolues, 1 absente et 1 arc (3 occurrences), sans ambiguïté. Une autre fixture vérifie
31 chemins réservés sans destination créée. Les nombres de production restent inconnus localement.

## Validation locale

661 tests réussis : 408 API et 253 web. Lint, typecheck, build, Prisma validate/generate
et contrôle du diff passent. Les tests de base existants, notamment ceux du staging et du
convertisseur, sont conservés et passent également.

Contrôle Edge headless du 11 octobre 2026, avec le build web et une API fictive sur loopback,
en 1 440 × 1 000, 768 × 1 024 et 390 × 844 : liens admin, code conservé, focus sur les sections,
Canvas, commandes de zoom, ouverture depuis le graphe et fiche privée absente du public.
Aucun débordement horizontal ni erreur JavaScript observé ; aucune requête externe de page.
Scripts, profil navigateur et captures de contrôle restent dans le répertoire temporaire,
hors Git. Ce contrôle ne remplace pas la vérification humaine du véritable corpus.

La fixture de charge (130 notes synthétiques très courtes, 866 occurrences) produit 390
références uniques résolues et 390 arcs, 0 ambiguë et 0 absente. Après deux passages de chauffe,
dix calculs locaux donnent une médiane d'environ 65 ms et un maximum d'environ 72 ms
(Windows, Node 22.23.2). Il s'agit du calcul en mémoire, sans PostgreSQL, réseau, Canvas ou
contenu réel ; aucun seuil de performance n'est imposé en CI.

La dernière revue indépendante a corrigé les libellés du voisinage admin (« connexions »)
et précisé le tri des arêtes dérivées. Les 2 560 comparaisons avec l'ancien résolveur de
chemins n'ont montré aucune différence. Une fixture renforcée de 130 notes et 866 arcs
distincts donne environ 62 ms en médiane et 70 ms au maximum pour le calcul en mémoire.
Le build final a aussi été contrôlé dans Edge aux trois résolutions ci-dessus avec 130 fiches,
862 arcs Obsidian et une relation éditoriale fictive : navigation, ancres, zoom et libellés
vérifiés, sans erreur JavaScript ni débordement horizontal. Les vues denses nécessitent
toujours zoom, filtres et isolation pour lire les connexions ; le corpus réel reste à vérifier.

## Fichiers à relire avant commit

28 fichiers concernés (21 modifiés, 7 nouveaux) :

```text
README.md
apps/api/src/admin/routes.ts
apps/api/src/app.ts
apps/api/src/graph.ts
apps/api/src/ingestion/obsidian-markdown.ts
apps/api/src/server.ts
apps/api/src/obsidian-references.ts
apps/api/src/obsidian-references.test.ts
apps/web/src/Admin.css
apps/web/src/AdminApp.tsx
apps/web/src/App.tsx
apps/web/src/Graph.css
apps/web/src/GraphCanvas.tsx
apps/web/src/GraphDetails.tsx
apps/web/src/GraphFilters.tsx
apps/web/src/GraphPage.tsx
apps/web/src/GraphPage.test.tsx
apps/web/src/ObsidianReferences.tsx
apps/web/src/WikiMarkdown.tsx
apps/web/src/WikiMarkdown.test.tsx
docs/API.md
docs/GRAPH.md
docs/OBSIDIAN-IMPORT.md
docs/OBSIDIAN-REFERENCES.md
package-lock.json
packages/shared/package.json
packages/shared/src/index.ts
packages/shared/src/obsidian.ts
```
