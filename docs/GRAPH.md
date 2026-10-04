# Graphe du Codex — v0.6c

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
La sélection est partageable par `/graphe?fiche=slug` ou `/admin/graphe?fiche=slug` ; un slug
absent du graphe autorisé n'affiche aucune fiche. Précédent/suivant du navigateur retrouve la
sélection. Double clic sur un nœud ou bouton « Ouvrir la fiche » ouvre sa page.
Une fiche masquée par un filtre est désélectionnée et `?fiche=` est retiré. La navigation
dans l'historique conserve les filtres actifs ; elle ne peut pas restaurer une fiche qu'ils masquent.

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
« Recentrer sur cette fiche » tient compte de la position déplacée. Les positions restent
en mémoire pendant les changements de filtres et de voisinage tant que le Canvas reste
monté ; elles sont perdues à sa fermeture ou au rechargement, sans persistance PostgreSQL.
Les boutons Zoom +/−, Recentrer et Ajuster à l'écran restent disponibles.

Tabulation et Entrée permettent de rechercher, sélectionner, filtrer et ouvrir une fiche
sans utiliser le Canvas. La liste déroulante fournit aussi un parcours clavier des nœuds.
Sur mobile, les filtres sont repliables et le panneau passe sous le graphe.

## Limites et suite

v0.6c charge toujours le graphe entier dans une réponse. Les index des graphes chargé, filtré et
éventuellement isolé sont mémorisés ; le voisinage coûte au plus O(nœuds + arêtes), et
le dessin consulte des Map/Set sans reconstruire le réseau à chaque frame.
Avec plusieurs milliers de nœuds, le calcul des forces et le transfert initial devront être
mesurés sur un jeu représentatif avant de définir un graphe local, des groupes ou une
pagination dédiée. Les labels sont réduits aux grands graphes et réapparaissent au zoom ou
sur la sélection/recherche. Les titres longs sont abrégés dans le Canvas ; survol, recherche
et panneau conservent le titre complet. L'URL partage la sélection, pas les filtres, la profondeur ni
les coordonnées. Le Canvas lui-même n'offre pas de parcours clavier nœud par nœud ; ses
contrôles textuels assurent cette navigation. Les couleurs regroupent les types de fiches
sans changer leur modèle. Aucun contrat API, schéma Prisma ni règle de publication n'a changé.
