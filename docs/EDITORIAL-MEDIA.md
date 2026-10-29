# Images, aide Markdown et personnages joueurs

## Utilisation

Dans « Nouvelle fiche » et « Modifier la fiche », « Importer une image » ajoute
une illustration à la fin du contenu Markdown. Sa description sert de texte
alternatif accessible. L'aperçu affiche l'image avant l'enregistrement de la fiche.
Le texte déjà saisi est conservé, y compris s'il change pendant l'envoi. Une erreur
d'import ne valide ni n'efface le formulaire. L'annulation, l'enregistrement et la
navigation sont protégés pendant l'envoi.

« Aide Markdown » est repliée par défaut et présente les syntaxes effectivement
prises en charge : titres, paragraphes, gras/italique/barré, listes et cases à cocher,
citations, liens directs ou par référence, notes de bas de page, wikilinks, images,
code, tableaux, séparateurs et échappements. Le HTML brut, les scripts, les formules
mathématiques et les diagrammes spécialisés ne sont pas exécutés ou interprétés.
Les images distantes restent masquées dans les aperçus administrateur.

Le nouveau type `PLAYER_CHARACTER` est affiché « PLAYER_CHARACTER (PJ) » dans les
formulaires et filtres admin. `PERSON` reste « PERSON (PNJ) ». Les deux catégories sont
distinctes dans les filtres et le graphe, au sein du groupe existant des personnes.
Les conseils de choix de relation acceptent un PJ là où un personnage est habituel.
Une catégorie PJ ne donne aucun droit d'accès et ne change pas la visibilité.
Aucune fiche existante n'est reclassée automatiquement.

## Stockage et confidentialité

Les images sont conservées dans la table PostgreSQL `EntityImage` (`BYTEA`) : aucun
répertoire d'upload public, nouveau service de stockage ou fichier de lore dans Git.
Les sauvegardes PostgreSQL incluent donc les images. Les lectures de listes, du
graphe, de provenance et du staging ne chargent pas les données binaires.

Limites : PNG, JPEG ou WebP **fixe**, 5 Mio par fichier, 6 000 pixels par côté,
20 millions de pixels et 20 images distinctes par fiche. Le type MIME et la
signature sont vérifiés avant décodage. Sharp réencode en WebP (qualité 90), remet
l'orientation correcte et retire EXIF, GPS, XMP et profils ; le nom du fichier
original n'est pas enregistré. Les SVG, animations, contenus invalides, requêtes
compressées et dépassements sont refusés. Deux décodages au plus sont simultanés
par processus API, avec une limite de temps de traitement.

Un import non enregistré appartient seulement à son administrateur authentifié.
Il expire après 24 heures ; le prochain import purge les imports expirés. Au plus
20 imports en attente sont autorisés par auteur. Leur UUID est aléatoire. Le
rattachement à la fiche et la suppression de l'identité du propriétaire temporaire
s'effectuent dans la transaction de création/modification et de révision. Une image
absente, expirée ou déjà rattachée à une autre fiche ne peut pas être récupérée.
Le Markdown, la provenance et les mécanismes de révision habituels sont conservés.

Une image rattachée est lisible par les administrateurs. Sans accès admin, elle exige
une fiche **PUBLISHED + PUBLIC** et une véritable référence image dans son Markdown
actuel (les exemples en code et simples liens ne comptent pas). Une image privée,
retirée du contenu courant ou absente répond uniformément `404`. Les accès suivants
recontrôlent les permissions : réponse `Cache-Control: no-store`, `Vary: Cookie`,
`Cross-Origin-Resource-Policy: same-origin` et `X-Content-Type-Options: nosniff`.
La publication reste une action humaine distincte. Sur une fiche déjà publique,
l'avertissement existant indique que l'enregistrement actualise sa version visible.

Retirer une image du Markdown ne supprime pas son binaire : les anciennes révisions
peuvent encore contenir son UUID. La suppression individuelle définitive de la fiche
présente le nombre d'images, les inclut dans l'empreinte de confirmation et supprime
uniquement ses images par clé étrangère `ON DELETE CASCADE`, dans la transaction
existante. Les autres fiches, Sources, staging et imports en attente sont préservés.

## API

- `POST /api/admin/images` : session Discord administrateur et Origin exacte ; corps
  binaire brut, `Content-Type: image/png|image/jpeg|image/webp`, sans nom ni chemin.
  Réponse `201 {id,url,width,height,byteSize}`. `400` image invalide ; `413` trop
  volumineuse ; `429` capacité de décodage ou quota en attente ; `409` concurrence.
- `GET /api/images/:id` : binaire WebP après contrôle de visibilité/association ou
  d'appartenance à un import privé en attente. Aucun endpoint de liste de fichiers.
- Les créations/modifications de fiches réutilisent leurs contrats existants : les
  références sont reconnues dans les nœuds Markdown image (y compris par référence).
  Les exemples dans les blocs de code ne rattachent pas d'image. Un refus d'image ou
  un échec de preuve/révision annule toute la transaction.

## Préparation opérationnelle

Migration additive : `20261029000000_entity_images_and_player_characters`.
Elle ajoute la valeur d'enum et la table avec ses contraintes/index ; elle ne modifie
aucune fiche, relation, preuve, révision, Source ou donnée de staging existante.
Elle est testée uniquement en mémoire pendant le développement. Une sauvegarde
PostgreSQL est à prévoir avant le futur déploiement autorisé. Le workflow existant
exécute `npm run prisma:deploy` avant le redémarrage PM2.

Pour autoriser réellement les envois de 5 Mio, ajouter **une fois**, dans le bloc
Nginx HTTPS existant du Codex, cette ligne au `location /api/` déjà présent :

```nginx
location /api/ {
    client_max_body_size 6m;
    # Conserver ici proxy_pass et tous les proxy_set_header existants.
}
```

Conserver la règle `location = /index.html { expires -1; }` déjà mise en place.
Ne pas ajouter de cache permanent sur `/api/images/` et ne pas publier les binaires
par un alias statique. Après édition de la configuration existante :

```sh
sudo nginx -t && sudo systemctl reload nginx
```

Le JSON des autres endpoints garde sa limite Express de 1 Mio. Aucun changement
Nginx, PostgreSQL réel, commit, push ou déploiement n'est exécuté pendant cette
préparation locale. La recette après livraison doit inclure création PJ, modification
PNJ/PJ, image visible en admin, publication publique explicite, retrait de publication
et suppression d'une fiche de test choisie par l'opérateur.

## Vérification locale du 29 octobre 2026

- Suite complète : **843 tests réussis**, dont **469 API et 374 web** ; 30 tests
  supplémentaires couvrent les images, leur confidentialité, le rollback et les PJ.
- `npm run lint`, `npm run typecheck`, `npm run build`, `npm run prisma:validate`,
  `npm run prisma:generate` et `git diff --check` réussis.
- Après le dernier ajustement du message de succès d'import : 37 tests ciblés web,
  lint et build relancés avec succès. Sous Windows, la suite web utilise un réglage
  Vitest temporaire hors dépôt (threads, deux workers, délais adaptés) ; la
  configuration versionnée reste inchangée.
- Recette navigateur locale à **1920 × 1080** et **390 × 844** avec API simulée et
  données fictives : création, modification, aperçu, aide, type PJ et rendu public
  vérifiés, sans débordement horizontal ni erreur JavaScript. Aucun appel vers une
  base réelle ; les écritures de cette recette sont uniquement simulées.
- La migration complète est testée dans PostgreSQL émulé en mémoire (PGlite),
  jamais appliquée à la base réelle.
- Le build conserve un avertissement de taille : bundle principal 516,15 ko
  (147,72 ko compressés). Aucun changement de découpage hors de ce périmètre.
- `npm audit` rapporte 16 alertes (2 critiques, 9 élevées, 5 modérées), sur des
  dépendances déjà présentes : leurs versions sont identiques à celles du commit
  précédent. Sharp n'est pas signalé. Leur correction demande une revue séparée ;
  aucune mise à niveau générale automatique n'a été effectuée.

Les binaires de recette et journaux restent dans le répertoire temporaire, hors
Git. Aucun secret, contenu réel de lore ou fichier personnel n'est ajouté. Aucun
commit, push, déploiement, accès VPS ou changement de données réelles effectué.
