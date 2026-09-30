# Graphe du Codex — v0.6b

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
Sélectionner un résultat ou une fiche dans la liste recentre la caméra avec un zoom lisible.
La sélection est partageable par `/graphe?fiche=slug` ou `/admin/graphe?fiche=slug` ; un slug
absent du graphe autorisé n'affiche aucune fiche. Précédent/suivant du navigateur retrouve la
sélection. Double clic sur un nœud ou bouton « Ouvrir la fiche » ouvre sa page.

Les filtres de type de fiche, sous-type de lieu, type de relation et catégories visuelles se
combinent. Le graphe admin ajoute statut et visibilité pour fiches et relations. Les arêtes
dont une extrémité est masquée disparaissent. Les compteurs distinguent les éléments affichés
de ceux chargés. « Réinitialiser les filtres » réactive toutes les catégories et efface la
recherche ; aucun filtre ne peut élargir la réponse fournie par le serveur. Sur petit écran,
les filtres sont repliés initialement pour garder le Canvas accessible sans long défilement.

Un nœud sélectionné met en évidence ses voisins et atténue le reste. « Connexions directes »
isole le nœud et ses voisins immédiats ; « Vue complète » revient au réseau entier. Le panneau
affiche résumé, sens des relations, comptes entrants/sortants et navigation vers les voisins.
Pour une arête directionnelle, le libellé inverse apparaît depuis sa cible ; une arête
symétrique utilise le même libellé aux deux extrémités. Le survol révèle un libellé textuel
sans utiliser les infobulles HTML de la bibliothèque. Le Canvas accepte pan, zoom, drag et
sélection à la souris ; recherche, filtres, sélection et ouverture sont accessibles au clavier.

## Limites et suite

v0.6b charge toujours le graphe entier dans une réponse. Canvas convient à plusieurs centaines de
nœuds ; avec plusieurs milliers, le calcul des forces et le transfert initial devront être
mesurés sur un jeu représentatif avant de définir un graphe local, des groupes ou une
pagination dédiée. Les labels sont réduits aux grands graphes et réapparaissent au zoom ou
sur la sélection. La position manuelle n'est pas persistée. Les couleurs regroupent les types
de fiches sans changer leur modèle. Aucun schéma Prisma ni règle de publication n'a changé.
