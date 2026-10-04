# Graphe du Codex — v0.6d

`/graphe` visualise les fiches publiques ; `/admin/graphe` visualise le réseau éditorial
après la même authentification Discord et la même whitelist que les autres routes admin.
Les deux vues utilisent `react-force-graph-2d`, qui dessine sur Canvas et gère la disposition
par forces, le pan, le zoom et le déplacement manuel des nœuds. Le module est chargé seulement
quand une page Graphe est ouverte. La recherche, les filtres et une liste déroulante permettent
de sélectionner une fiche au clavier ; le panneau affiche ses connexions et permet d'ouvrir sa fiche.

## Contrat

`GET /api/v1/graph` et `GET /api/admin/graph` retournent `{ nodes, edges }`.

- Nœud : `{ id, slug, title, kind, placeKind, summary, aliases }` ; l'admin reçoit aussi `status` et `visibility`.
- Arête : `{ id, source, target, type, label, inverseLabel, symmetric }` ; l'admin reçoit aussi
  `status` et `visibility`. `source` et `target` sont les UUID des nœuds dans le sens stocké.
- Chaque Relation est renvoyée une fois. Une relation symétrique reste une seule arête ; les
  relations directionnelles portent une flèche. `inverseLabel` sert au panneau quand le nœud
  sélectionné est à l'extrémité entrante.
- Les tableaux sont triés par UUID pour une réponse stable. Les nœuds isolés sont conservés.

Le serveur sélectionne explicitement les seules colonnes ci-dessus. La route publique exige
`PUBLISHED + PUBLIC` pour chaque Entity, chaque Relation et les deux extrémités de chaque arête.
Elle ne retourne aucun identifiant, nœud, arête ou compteur privé. Les routes du graphe ne
renvoient jamais Source, Evidence, Revision, metadata, compte ou session Discord. La route
admin est protégée côté Express et porte `Cache-Control: no-store`.

## Exploration

La recherche sur titre, slug et alias est partielle, insensible à la casse et aux accents.
Elle porte sur les fiches visibles avec les filtres actifs, utilise le graphe déjà chargé
et ne déclenche pas de nouvelle requête par frappe.
Les correspondances sont surlignées dans titre, slug et premier alias correspondant ; un
cadre distingue aussi les nœuds correspondants dans le Canvas. Le texte reste rendu par React,
sans HTML provenant du lore. Une sélection depuis les résultats ou une connexion donne le focus
clavier au titre du panneau de détails et le rend visible, y compris sous le Canvas sur mobile.
Sélectionner un résultat ou une fiche dans la liste recentre la caméra progressivement (600 ms)
avec un zoom borné entre 1,2 et 2,2. Les commandes de caméra respectent la préférence de mouvement
réduit en supprimant leur transition ; un changement de filtres ou d'isolation ne rejoue pas
un recentrage déjà effectué.
Le graphe public partage son état d'exploration par URL ; les anciens liens `?fiche=slug`
restent compatibles. Un slug absent du graphe autorisé ou masqué par ses filtres n'affiche
aucune fiche : la sélection et l'isolation sont retirées de l'état et de l'URL.
Double clic sur un nœud ou bouton « Ouvrir la fiche » ouvre sa page.

Les filtres de type de fiche, sous-type de lieu, type de relation et catégories visuelles se
combinent. Le graphe admin ajoute statut et visibilité pour fiches et relations. Les arêtes
dont une extrémité est masquée disparaissent. Les compteurs distinguent les éléments affichés
de ceux chargés. « Réinitialiser les filtres » réactive toutes les catégories et efface la
recherche ; aucun filtre ne peut élargir la réponse fournie par le serveur. Sur petit écran,
les filtres sont repliés initialement pour garder le Canvas accessible sans long défilement.

Le sélecteur « Profondeur du voisinage » propose 1, 2 ou 3 relations à partir de la fiche
sélectionnée. Le parcours utilise un index d'adjacence mémorisé et un parcours en largeur
sur les données **après filtrage**. Il traverse les relations dans les deux sens pour
l'exploration, sans changer leur orientation ni créer une seconde arête symétrique.
Les composantes déconnectées restent hors voisinage. « Connexions directes » (profondeur 1)
ou « Isoler le voisinage » (profondeurs 2–3) masque temporairement le reste.
« Afficher tout le graphe » quitte cette isolation en conservant la sélection.
« Vue complète » efface sélection, isolation et `?fiche=`, tout en conservant les filtres.

La fiche sélectionnée porte un anneau plus large, les voisins directs un anneau fin et
les voisins éloignés un anneau pointillé. Les autres nœuds sont atténués. Cette distinction
ne repose donc pas uniquement sur les couleurs. Le survol d'un autre nœud met temporairement
en évidence ses relations directes ; sortir du nœud rétablit le voisinage sélectionné,
sans modifier le panneau ni l'URL.

Le panneau affiche résumé, sens des relations, comptes entrants/sortants, connexions
symétriques et navigation vers les voisins. Le total de relations porte uniquement sur
le graphe autorisé chargé ; les relations affichées avec les filtres sont comptées séparément.
Le rayon des nœuds varie légèrement avec ce total, de 4 à 9 unités Canvas au maximum.
Pour une arête directionnelle, le libellé inverse apparaît depuis sa cible ; une arête
symétrique utilise le même libellé aux deux extrémités. Le survol révèle un libellé textuel
sans utiliser les infobulles HTML de la bibliothèque. Le Canvas accepte pan, zoom, drag et
sélection à la souris. Un clic dans le Canvas sélectionne sans déplacer la caméra pour
garder la cible sous le pointeur. Deux activations du même nœud en moins de 350 ms ouvrent sa fiche.
Le déplacement, le pan, le zoom ou un clic intermédiaire sur une relation ou le fond annulent
cette détection et empêchent une ouverture accidentelle à leur issue.
« Recentrer sur cette fiche » tient compte de la position déplacée. Les positions fixées
sont sauvegardées à la fin du déplacement dans ce navigateur et restaurées au rechargement.
Les boutons Zoom +/−, Recentrer et Ajuster à l'écran restent disponibles.

Tabulation et Entrée permettent de rechercher, sélectionner, filtrer et ouvrir une fiche
sans utiliser le Canvas. La liste déroulante fournit aussi un parcours clavier des nœuds.
Sur mobile, les filtres sont repliables et le panneau passe sous le graphe.

## État partageable et historique

`URLSearchParams` encode uniquement les paramètres ci-dessous. Les valeurs par défaut sont
omises, l'ordre de sérialisation est stable et les paramètres inconnus ou fragments sont retirés.
Le format ne contient ni projection de fiche, ni preuve/source, ni identifiant de compte, session
ou token. Les textes libres sont limités à 200 caractères ; un slug conserve les règles métier
minuscules/chiffres/tirets, et un type de relation doit exister dans la réponse autorisée chargée.

| Paramètre | Valeur | Défaut / disponibilité |
| --- | --- | --- |
| `fiche` | slug sélectionné | aucune sélection ; public uniquement à la sérialisation |
| `profondeur` | `2` ou `3` (`1` accepté à la lecture) | `1` ; public et admin |
| `isoler` | `1` | désactivé ; public, avec sélection valide |
| `q` | recherche non vide | vide ; public uniquement |
| `type` | `EntityKind`, par exemple `PLACE` | tous ; public et admin |
| `lieu` | `PlaceKind`, par exemple `CITY` | tous ; public et admin |
| `relation` | code existant, par exemple `located_in` | toutes ; public et admin |
| `statut`, `statut-relation` | `DRAFT`, `PROPOSED`, `PUBLISHED`, `ARCHIVED` | tous ; admin uniquement |
| `visibilite`, `visibilite-relation` | `PUBLIC`, `PLAYERS`, `GM`, `SECRET` | toutes ; admin uniquement |
| `sans` | catégories désactivées, séparées par des virgules | toutes activées ; public et admin |

Les catégories sont `places`, `people`, `collectives`, `stories`, `ideas`. Une liste vide,
inconnue ou comportant des doublons revient aux catégories par défaut ; les cinq noms permettent
de désactiver toutes les catégories. Les paramètres répétés, enums invalides, contrôles dans les
textes, textes trop longs et types de relation absents reviennent à leur valeur par défaut.

Exemple public : `/graphe?fiche=ville&profondeur=2&isoler=1&q=CITE&type=PLACE&sans=ideas`.
Les actions discrètes créent une entrée d'historique. Une session de frappe crée une entrée,
puis actualise cette entrée jusqu'à la sortie du champ ou une autre action : précédent/suivant
retrouve une exploration complète sans traverser toutes les lettres tapées. Un rechargement
restaure filtres, catégories, profondeur, recherche, sélection et isolation publiques.
« Vue complète » retire sélection et isolation en conservant recherche, profondeur et filtres.
« Réinitialiser les filtres » réactive toutes les catégories, efface recherche et filtres,
et quitte l'isolation, tout en conservant une sélection encore autorisée.

**Confidentialité admin :** les liens `/admin/graphe` conservent seulement filtres, catégories
et profondeur. Recherche, sélection et isolation éditoriales restent dans la vue locale et ne
sont écrites ni dans l'URL ni dans `history.state`. Les anciens liens admin `?fiche=slug` sont
résolus sur les seules données autorisées, puis ce paramètre est retiré. Au rechargement, ces
liens ne restaurent donc pas la sélection/recherche/isolation locales. Précédent/suivant restaure
les filtres et la profondeur, conserve l'exploration locale et retire une sélection qu'un filtre masque.

« Copier le lien » copie l'URL réellement synchronisée, avec une confirmation discrète et le
focus conservé sur la commande. Si le presse-papiers est absent ou refusé, un champ de lien
sélectionnable apparaît et reçoit le focus ; aucune confirmation n'utilise `alert()`.

## Positions propres au navigateur

Seuls les couples identifiant de fiche / coordonnées finies sont sauvegardés dans `localStorage`,
sous `hesta-codex:graph-layout:v1:public` et `hesta-codex:graph-layout:v1:admin`. Le format versionné
est `{ "version": 1, "positions": [["id", x, y]] }` : pas de titre, slug, résumé, statut ou compte.
Une position enregistrée fixe `x/y` et `fx/fy` à la prochaine ouverture. Les fiches supprimées
sont ignorées, les fiches nouvelles restent libres, et les filtres/isolation ne suppriment pas
les positions des fiches momentanément masquées. Aucune écriture n'a lieu à chaque frame.

Un JSON corrompu, une version étrangère, des coordonnées non finies ou extrêmes et un stockage
indisponible n'empêchent pas l'exploration. Les positions sont bornées à ±1 000 000 unités, avec
10 000 entrées et une lecture de 2 Mo au maximum. Les échecs d'accès/quota affichent un message
indiquant que la disposition reste uniquement dans la vue courante.

« Réinitialiser la disposition » supprime la sauvegarde du périmètre courant, public ou admin,
libère aussi les nœuds masqués, réchauffe le moteur et ajuste le graphe à la fin du calcul.
La commande est désactivée sans position fixée ; après activation, le focus passe à « Ajuster
à l'écran ». Si l'effacement du stockage échoue, le message précise que seule la vue a été réinitialisée.
Les positions restent propres à l'origine et au navigateur : aucune synchronisation multi-appareil,
aucune persistance PostgreSQL et aucune nouvelle route API. Deux onglets peuvent remplacer leur
dernière sauvegarde mutuelle ; les utilisateurs d'un même profil navigateur partagent ce stockage.

## Labels et contrôle de charge

Les labels sont classés hors des frames de dessin : sélection, survol, voisins directs,
résultats de recherche, puis autres fiches, avec les fiches les plus connectées en premier à
priorité égale. Ils gardent une taille à l'écran de 10 à 13 px, indépendante du zoom ; les
titres Canvas sont tronqués à 42 caractères Unicode et restent complets dans le survol/panneau.
Un fond discret protège leur contraste. Une grille spatiale recherche quatre placements et
évite les collisions entre labels ; le nom d'une sélection présente à l'écran reste prioritaire.

Le budget est de 60, 120 ou 180 labels selon le zoom, avec 12 ou 32 labels ordinaires au faible
zoom pour conserver des repères. Les candidats hors écran sont ignorés. Les géométries mobiles
sont recalculées par frame peinte, les mesures de texte sont mises en cache ; les index de
recherche normalisée et d'adjacence ne sont pas reconstruits lors du dessin. `GraphCanvas` et
`GraphDetails` sont mémorisés ; recherche sans résultat et confirmation de copie ne relancent
pas le Canvas. Nœuds déplacés et objets de simulation sont conservés entre filtres/isolation,
tandis que les extrémités de liens mutées par la bibliothèque restent séparées de la réponse API.

`graph-synthetic.ts` est une fixture technique sans lore : 1 000 nœuds, 3 000 relations,
dix composantes distinctes, cycles, raccourcis, relations dirigées et symétriques. Les tests
vérifient les distances exactes 1/2/3, filtres combinés, isolation, orientation et singularité
des arêtes. Aucun seuil chronométrique n'est imposé en CI.

Mesure locale indicative du 4 octobre 2026 (Windows, Node 22.23.2) : après 20 passages de
chauffe, 200 passages sur cette fixture donnent une médiane de 3,46 ms et un percentile 95
de 5,77 ms pour un cycle comprenant index d'adjacence/recherche, filtrage, réindexation,
voisinages 1/2/3, isolation et recherche. Cette mesure concerne uniquement les helpers CPU,
sans réseau, rendu Canvas ni simulation des forces ; elle ne constitue pas un seuil CI ni
une garantie de fluidité sur d'autres machines.

## Limites et suite

v0.6d charge toujours le graphe entier dans une réponse. Les index des graphes chargé, filtré et
éventuellement isolé sont mémorisés ; le voisinage coûte au plus O(nœuds + arêtes), et
le dessin consulte des Map/Set sans reconstruire le réseau à chaque frame.
Avec plusieurs milliers de nœuds, le calcul des forces et le transfert initial devront être
mesurés sur un jeu représentatif avant de définir un graphe local, des groupes ou une
pagination dédiée. Le placement réduit les chevauchements des textes sans garantir une place
pour tous les labels d'une zone dense ni éviter tout recouvrement d'arête/nœud. Zoom, survol,
recherche et panneau complètent les labels masqués. L'URL ne partage pas les coordonnées.
Le Canvas lui-même n'offre pas de parcours clavier nœud par nœud ; ses
contrôles textuels assurent cette navigation. Les couleurs regroupent les types de fiches
sans changer leur modèle. Aucun contrat API, schéma Prisma ni règle de publication n'a changé.
