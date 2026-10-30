# Suggestions éditoriales et recherche de connexions

## Alias et tags

Dans « Nouvelle fiche » et « Modifier la fiche », ouvrir **Suggestions d’alias et
de tags**. Les champs habituels restent utilisables sans ouvrir le panneau.

- Le vocabulaire des tags existants est chargé à l’ouverture seulement. La saisie
  après la dernière virgule filtre les propositions ; un clic complète cette valeur.
- Les alias existants sont proposés pendant la saisie avec les fiches qui les
  utilisent. Réutiliser un alias peut rendre les liens ambigus : ce n’est pas une fusion.
- **Analyser le contenu pour des alias et tags** examine le brouillon actuel.
  Les propositions d’alias viennent de variantes entre parenthèses dans le titre,
  de noms cités après « appelé », « surnommé », « alias », etc., ou de libellés de
  liens résolus vers cette fiche. Vérifier qu’ils désignent réellement cette fiche.
  Les tags viennent de hashtags écrits dans le contenu ou de tags existants cités
  dans le texte courant. Aucune information de lore ni catégorie n’est inventée.
- Chaque proposition indique son origine et les collisions d’alias détectées.
  Au plus 20 propositions par catégorie sont présentées. Un clic remplit le
  formulaire, puis **Enregistrer** conserve les choix avec la révision habituelle.

Le code, les liens/images existants et le frontmatter ne servent pas à extraire des
mentions ordinaires. L’analyse repose sur des règles locales explicables, sans IA
externe, transmission de lore à un tiers ni nouvelle dépendance. Les délais réseau
et la fermeture des panneaux n’écrasent jamais le brouillon. Une analyse calculée
pour un ancien texte n’est pas appliquée au nouveau.

## Scanner les fiches

Le bouton **Scanner les fiches** du tableau de bord ouvre
`/admin/connexions-suggerees` et lance une analyse **en lecture seule**.

Le scan cherche des titres et alias exacts dans les parties textuelles du Markdown,
avec limites de mots, casse, espaces et Unicode normalisés. Les noms les plus longs
sont examinés d’abord. Il n’y a ni recherche floue, ni inférence de relation sémantique.
Code, HTML, liens Markdown, images, wikilinks déjà résolus ou échappés, frontmatter,
entités de caractères et fragments mathématiques en ligne sont conservés.

Les propositions excluent les auto-liens et les fiches archivées. Une connexion
éditoriale ou une référence résolue déjà présente dans **l’un ou l’autre sens** exclut
la paire pour les nouvelles mentions ordinaires : ce scan ne lie pas tous les mots
encore sans crochets. Plusieurs occurrences vers une même fiche sont regroupées. Un titre/alias
partagé par plusieurs fiches donne un diagnostic ; aucune destination n’est choisie.

Les wikilinks simples déjà écrits mais **absents ou sans association Obsidian** sont
aussi proposés à la réparation lorsqu’un titre/alias actuel désigne une seule fiche
existante. Cela fonctionne pour une fiche créée manuellement, même si la connexion
inverse ou une relation éditoriale existe déjà. Les chemins explicites, inclusions,
ambiguïtés d’origine et destinations absentes/archivées ne sont pas réaffectés.
Une note historique peut rester « sans fiche associée » après une création manuelle :
la fiche existe, mais aucune association d’identité Obsidian n’a été décidée. Le scan
permet alors de corriger précisément les liens, après revue, sans inventer cette association.

Les compteurs distinguent fiches analysées, connexions proposées, occurrences à lier,
wikilinks à réparer, mentions ambiguës et mentions déjà connectées. Une paire déjà
connectée peut donc figurer parmi les propositions si un de ses wikilinks reste à
réparer. Les propositions sont paginées par 30,
avec jusqu’à 30 exemples de mentions ambiguës. Les aperçus longs s’ouvrent progressivement.
« Masquer pour ce scan » est temporaire : ce choix n’écrit aucune décision persistante.

## Validation et historique

1. **Examiner et lier** montre les extraits avant/après pour chaque occurrence.
2. Vérifier les mentions et la destination ; pour les aperçus longs, afficher toutes
   les mentions avant de pouvoir cocher la confirmation.
3. Cocher la confirmation, puis **Ajouter les liens validés**.
4. Les seules modifications sont l’insertion ou la correction des wikilinks dans la fiche source et
   une nouvelle Revision attribuée à l’administrateur connecté. Le scan est recalculé.

Le format ciblé `[[/fiches/slug|Texte d’origine]]` désigne précisément une fiche Codex
existante, y compris une fiche manuelle sans identité Obsidian ou une fiche homonyme.
Il réutilise le rendu, les références entrantes/sortantes et le graphe existants.
Les règles des chemins Obsidian et des alias simples restent inchangées. Un chemin
Codex invalide ou disparu reste non navigable ; aucune fiche n’est créée.
Une réparation conserve le libellé et l’ancre du lien existant. Les séparateurs
sont échappés dans les tableaux GFM pour conserver leurs lignes et cellules. Les
diagnostics techniques disparaissent après réparation des occurrences concernées ;
actualiser la file recalcule aussi les références entrantes/sortantes et les compteurs.

L’empreinte SHA-256 de l’aperçu est vérifiée sur un nouveau snapshot cohérent dans la
transaction d’application. Un changement de texte, titre, alias, visibilité, statut,
origine ou connexion invalide l’aperçu (`409`) et demande un nouveau scan. La mise à
jour réutilise la validation, la gestion des images, le verrou de version et les
révisions de l’édition habituelle. Une erreur annule toute la transaction. Une double
application ne crée pas deux révisions. Aucun texte n’est tronqué pour respecter une limite.
La version de l’algorithme fait partie de l’empreinte : un aperçu issu de l’ancien
scan, qui ne proposait pas les réparations, doit être recalculé avant application.

Les Sources, preuves, associations, réceptions, items et contenus de staging ne sont
jamais modifiés. Aucune ligne `Relation`, nouvelle fiche ou publication automatique
n’est créée. Une fiche déjà publiée/publique est signalée : son enregistrement
modifiera immédiatement le texte visible, comme l’édition habituelle.

## Confidentialité et limites

Toutes les routes sont sous `/api/admin`, whitelist Discord, contrôle Origin pour les
POST et `Cache-Control: no-store`. Aucun texte privé n’est stocké dans les URL, le
localStorage ou un cache global. Les résultats vivent seulement dans la page courante.

Un lien ciblé vers une fiche privée reste non navigable publiquement. La projection
publique retire aussi sa cible `/fiches/slug` du Markdown retourné, en gardant le libellé
lisible et en recalant les autres liens ; le Markdown enregistré reste intact. Sans
navigation vérifiée, les cibles Codex sont masquées par défaut. Le graphe public garde
exclusivement ses relations éditoriales publiées/publiques.

Les limites de lecture existantes restent 2 000 fiches, 4 000 associations et 32 Mio
de Markdown. Le scan borne aussi les relations à 20 000, les noms à 6 000/120 000
caractères cumulés, les propositions à 5 000 connexions et 20 000 occurrences. Un
dépassement donne `503 REFERENCES_LIMIT` pour les limites du catalogue existant ou
`503 SUGGESTIONS_LIMIT` pour celles du scan, jamais une application partielle. Il n’y a
pas de traitement permanent en arrière-plan ni de sauvegarde des scans. Les propositions
peuvent être grammaticalement inadaptées : leur validation humaine est indispensable.

API :

- `GET /api/admin/editorial-suggestions/vocabulary`
- `POST /api/admin/editorial-suggestions/terms` : brouillon, sans écriture.
- `POST /api/admin/link-suggestions/scan` : `{page: 1}`, sans écriture.
- `POST /api/admin/link-suggestions/apply` : `{id, fingerprint, confirm: true}`.

Aucune migration ni configuration de stockage supplémentaire. Aucun accès au coffre
Obsidian, VPS ou PostgreSQL de production n’est nécessaire au développement.

L’inspiration fonctionnelle est [Obsidian Note Linker](https://github.com/AlexW00/obsidian-note-linker) :
détecter les mentions de noms/alias puis laisser l’opérateur choisir les liens.
Son code et ses dépendances ne sont pas intégrés au Codex.

## Vérifications locales

### Correctif du 30 octobre 2026 : wikilinks déjà écrits sans association

**889 tests réussis : 502 API et 387 web**, dont cinq nouveaux tests de régression.
Lint, typecheck, build, Prisma validate/generate et contrôle du diff réussis. Aucun
changement de schéma, dépendance ou migration.

Le défaut est reproduit avant correction avec une note associée à l’index Obsidian,
une destination créée manuellement, deux wikilinks non résolus et une connexion déjà
présente dans l’autre sens. La réparation validée supprime le diagnostic technique,
ajoute la référence entrante, conserve le lien inverse et crée une seule révision.
Les Sources, preuves, staging et décisions d’association sont identiques avant/après.
Les tests vérifient aussi les alias, ancres, tableaux GFM, cas ambigus et exclusions.

Recette Edge à 1920 × 1080 et 390 × 844 avec données fictives : deux wikilinks à
réparer proposés malgré le lien inverse ; aperçu, confirmation, liens navigables,
diagnostic retiré et destination privée masquée publiquement. Aucun débordement ni
erreur JavaScript ; les deux écritures de recette sont simulées. Les fichiers de
recette restent dans le répertoire temporaire, hors Git. Aucun accès ou changement
de données de production, commit, push ou déploiement pendant cette correction.

### Validation initiale du 29 octobre 2026

**884 tests réussis : 498 API et 386 web**, dont 36 nouveaux tests. La suite web
complète utilise sous Windows un réglage Vitest temporaire hors dépôt (threads,
deux workers et délais adaptés), sans modifier la configuration versionnée.
Lint, typecheck, build, Prisma validate/generate et contrôle du diff sont vérifiés.

Les tests couvrent les limites de mots/Unicode, les titres ponctués, les homonymes,
le code/Markdown à préserver, les liens ciblés de fiches manuelles, les compteurs,
la confidentialité publique (y compris l’absence de slug privé), l’authentification,
la confirmation, les aperçus périmés, les doubles applications, la révision humaine,
la conservation du statut/provenance et le rollback après erreur PostgreSQL simulée.
Les tests de base utilisent exclusivement PGlite en mémoire et un socket loopback
explicitement créé par les tests, jamais `DATABASE_URL` ou une base réelle.

Recette Edge à **1920 × 1080** et **390 × 844**, avec build réel et API fictive
utilisant le moteur de scan réel : entrée depuis le tableau de bord, aperçu,
confirmation, lien navigable après application, suggestions d’alias/tags puis
enregistrement, destination privée masquée publiquement. Aucun débordement horizontal,
erreur JavaScript ou appel externe de page. Les quatre écritures de cette recette
sont uniquement simulées (deux ajouts de liens et deux éditions).

Mesure du calcul en mémoire après chauffe, cinq passages, sans PostgreSQL ni réseau :

| Fixture fictive | Connexions/occurrences proposées | Médiane | Maximum |
| --- | --- | --- | --- |
| 130 fiches, cinq mentions chacune | 650 / 650 | 87 ms | 95 ms |
| 500 fiches, cinq mentions chacune | 2 500 / 2 500 | 373 ms | 395 ms |

Ces notes très courtes ne représentent pas le corpus réel ; ce n’est pas une garantie
de temps de réponse. Le bundle principal conserve l’avertissement existant au-delà
de 500 ko ; le panneau du scan est chargé séparément. Les noms d’un seul caractère,
les noms contenant des délimiteurs de wikilink ou une barre oblique inverse ne sont
pas proposés automatiquement. Des noms séparés par une mise en forme Markdown ne
sont pas réunis artificiellement.

Scripts, journaux, profils et captures restent dans le répertoire temporaire hors Git.
Aucun secret, contenu réel du lore, accès VPS, coffre privé, commit, push, déploiement
ou modification de données de production pendant ce développement.
