# Graphe du Codex — v0.6a

`/graphe` visualise les fiches publiques ; `/admin/graphe` visualise le réseau éditorial
après la même authentification Discord et la même whitelist que les autres routes admin.
Les deux vues utilisent `react-force-graph-2d`, qui dessine sur Canvas et gère la disposition
par forces, le pan, le zoom et le déplacement manuel des nœuds. Le module est chargé seulement
quand une page Graphe est ouverte. Une liste déroulante permet aussi de sélectionner chaque
fiche au clavier ; le panneau affiche ses connexions et permet d'ouvrir sa fiche.

## Contrat

`GET /api/v1/graph` et `GET /api/admin/graph` retournent `{ nodes, edges }`.

- Nœud : `{ id, slug, title, kind, placeKind }` ; l'admin reçoit aussi `status` et `visibility`.
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

## Limites et suite

v0.6a charge le graphe entier dans une réponse. Canvas convient à plusieurs centaines de
nœuds ; avec plusieurs milliers, le calcul des forces et le transfert initial devront être
mesurés sur un jeu représentatif avant de définir un graphe local, des groupes ou une
pagination dédiée. Les labels sont réduits aux grands graphes et réapparaissent au zoom ou
sur la sélection. La position manuelle n'est pas persistée. Les couleurs regroupent les types
de fiches sans changer leur modèle. Aucun schéma Prisma ni règle de publication n'a changé.
