# Qualification éditoriale des références Obsidian

La page `/admin/relations-a-qualifier`, accessible depuis le tableau de bord, suit les mentions textuelles résolues. Elle réutilise le moteur Obsidian, les associations confirmées et le formulaire de création de relations existants. Elle ne crée ni fiche ni relation automatiquement. Les Markdown, Sources, réceptions et associations d’origine restent inchangés.

## File centrale

Une ligne représente une paire **dirigée de UUID**, avec toutes ses occurrences, quels que soient les alias ou ancres employés. Des fiches homonymes restent distinctes ; les slugs et UUID sont consultables. Les relations symétriques conservent leur représentation canonique dans `Relation`.

Les états sont calculés dans cet ordre :

- **Qualifiée** : au moins une relation éditoriale existe entre les deux UUID, dans l’un ou l’autre sens. Tous les statuts, y compris ARCHIVED, sont pris en compte et affichables dans les détails. Ce suivi indique une qualification déjà effectuée ; il ne certifie ni publication ni validité sémantique. Un autre type peut toujours être ajouté ; le formulaire et l’API existants continuent de refuser les doublons du même type et sens.
- **Ignorée volontairement** : aucune relation éditoriale n’existe et une décision d’ignorance correspond à l’empreinte actuelle.
- **À qualifier** : aucun des deux cas précédents. Une ancienne décision invalidée est signalée comme à revoir et reste révocable.

« Examiner » expose les origines confirmées et les relations existantes ; les liens source/destination ouvrent les fiches. Si plusieurs origines sont possibles, le formulaire impose la vérification humaine habituelle de la Source. Les auto-références et fiches archivées n’autorisent pas la création assistée. Une auto-référence peut être ignorée éditorialement.

Recherche par titre, alias ou slug (insensible à la casse et aux accents), filtres d’état, type de fiche, Source et fiche de référence ; direction entrante/sortante relative à cette dernière ; tri par mentions décroissantes, nom ou état. Les égalités sont départagées par UUID, sans dépendre de l’ordre des résultats SQL. Pages de 50 lignes. Les compteurs **globaux** sont calculés avant filtrage ; le total de résultats et la pagination reflètent les filtres. Après création ou décision, un nouveau GET actualise les compteurs, sans rechargement du navigateur. Les filtres restent en mémoire pendant l’aller-retour au formulaire ; un rechargement complet retrouve les décisions en base et réinitialise les filtres.

L’onglet paginé **Diagnostics techniques** sépare les destinations absentes, ambiguës, sans fiche associée (notamment notes vides), les liens non pris en charge et les problèmes d’ancre. Aucun choix arbitraire de UUID ou bouton de création n’y figure. Un diagnostic d’ancre peut coexister avec une paire résolue. Les compteurs de diagnostics comptent les diagnostics uniques par note, pas les occurrences ni les paires. Le compteur « références uniques résolues » sur une fiche conserve sa définition existante incluant les ancres ; le compteur central compte les paires dirigées.

## Décisions persistantes et concurrence

La table dédiée `ObsidianReferenceIgnore` est nécessaire : aucune table actuelle ne représente une décision sur une paire de références calculées. Détourner `Entity.metadata`, `Relation` ou les décisions d’ingestion modifierait leur signification ou les données de lore. La migration ne contient que la création de cette table, de son index et de ses clés étrangères.

Clé primaire : `(fromEntityId, toEntityId)`. Données : empreinte SHA-256, révision UUID, identifiant Discord et libellé de l’opérateur authentifié, date. L’identité humaine provient exclusivement de la session ; elle ne peut pas être fournie dans la requête. Aucun extrait de lore n’est copié dans cette table.

L’empreinte inclut les UUID dirigés, le hash du Markdown **entier de la note qui mentionne**, les origines confirmées des deux fiches et les occurrences résolues (cible, ancre et offsets). C’est une invalidation prudente : même une modification ailleurs dans cette note demande une nouvelle revue. Modifier seulement une preuve, le statut ou la visibilité d’une fiche ne l’invalide pas. Revenir exactement au même contenu et aux mêmes identités peut rendre l’ancienne décision applicable à nouveau. Modifier les ancres de destination invalide aussi la décision si leur résolution change. L’ordre des associations n’influence pas l’empreinte.

Chaque décision transmet l’empreinte et la révision attendues. Le serveur relit une projection cohérente dans une transaction SERIALIZABLE avant d’enregistrer ou supprimer uniquement la décision. Une référence disparue, un changement de contenu ou une décision concurrente renvoient 409 ; l’interface actualise l’état avant toute nouvelle tentative. Une réponse perdue n’entraîne aucune confirmation optimiste. Les références automatiques, leur navigation et le graphe ne sont jamais supprimés par une ignorance. Les décisions d’une paire disparue restent inactives ; elles ne figurent plus dans la file. Supprimer une fiche supprime uniquement ses décisions liées par cascade. Aucun nettoyage permanent ajouté.

## API et performances

Les endpoints sont exclusivement administrateurs, derrière la session Discord autorisée, `Cache-Control: no-store` et le contrôle d’origine exact pour les mutations :

- `GET /api/admin/reference-qualifications` : `page` (1–9999), `q` (1–100 caractères), `state=PENDING|QUALIFIED|IGNORED`, `kind`, `sourceId`, `entityId`, `direction=all|incoming|outgoing`, `sort=mentions|name|state`, `view=references|diagnostics`. Une direction particulière exige `entityId`. Paramètres inconnus, UUID et enums invalides refusés. Page hors bornes ramenée à la dernière page disponible.
- `POST /api/admin/reference-qualifications/decision` : `{fromEntityId,toEntityId,fingerprint,expectedDecisionRevision,ignore}`. Révision `null` si aucune décision, `ignore=false` pour révocation ; réponse 204. Impossible d’ignorer une paire déjà qualifiée.
- `GET /api/admin/entities/:slug` avec l’en-tête `X-Hesta-Relation-Evidence: defer` : détails habituels mais preuves des relations différées, compteurs `evidenceCount` exacts et `evidenceDeferred=true`. L’ancienne projection complète reste disponible sans cet en-tête, notamment aux services transactionnels existants.
- `GET /api/admin/relations/:id/evidence` : preuves et Sources d’une seule relation, à l’ouverture de son détail. Aucune variante publique.

Le catalogue est résolu une fois par requête, jamais par ligne. Une lecture REPEATABLE READ READ ONLY récupère les fiches, associations, relations minimales, décisions et Sources avec un nombre constant de requêtes. Aucune preuve de relation ni extrait Markdown ne figure dans la file. Les décisions et relations sont indexées en mémoire par paire. Diagnostics et résultats sont paginés ; la liste légère des fiches et Sources est partagée pour les filtres. Aucun cache global de données privées, aucune recherche, UUID de préremplissage ou décision stockés dans l’URL du navigateur, `history.state` ou un stockage navigateur. L’API et le graphe publics restent inchangés.

Les limites existantes demeurent : 2 000 fiches, 4 000 associations, 32 Mio de Markdown et 100 000 occurrences. Limites supplémentaires explicites de 50 000 relations éditoriales et 100 000 décisions. Un dépassement renvoie 503, sans résultat partiel. Le calcul global reste proportionnel au catalogue ; la pagination borne le transfert et le rendu, mais ne transforme pas le moteur existant en index persistant. Plusieurs milliers de **connexions** sont couverts à l’intérieur de ces limites.

Sur les fiches : dix références par direction et par page, recherche locale, sections repliables et détails à la demande ; état et nombre d’occurrences visibles. Une référence qualifiée propose l’examen avant une création supplémentaire. Les relations éditoriales sont limitées à dix lignes par direction ; recherche et filtre de statut apparaissent au-delà de dix. Un seul détail est ouvert à la fois, avec les preuves chargées à la demande, les Sources, éditeurs, ajout de preuve et publication existants. Les filtres/pagination/fermeture sont bloqués pendant l’édition pour protéger la saisie. Les preuves directement sur la fiche et les révisions gardent leur chargement existant.

## Livraison et recette

Migration préparée : `prisma/migrations/20261011000000_obsidian_reference_ignores/migration.sql`. **Elle n’a pas été exécutée.** Après validation explicite, sauvegarde et déploiement contrôlé, exécuter les migrations existantes et cette migration avant de démarrer l’API qui consulte la nouvelle table :

```sh
npm ci
npm run prisma:validate
npm run prisma:generate
npm run prisma:deploy
npm run build
```

Ces commandes appartiennent à la procédure opérateur ; elles ne lancent aucun import, promotion ou seed. Utiliser les variables d’environnement du déploiement habituel et ne jamais copier de secrets dans Git. La migration nécessite une recette PostgreSQL après sauvegarde ; les validations locales utilisent des stores simulés et une URL de base volontairement invalide, sans coffre ni base réels.

Recette : ouvrir la file, relever ses trois compteurs, examiner deux homonymes, ignorer une paire puis recharger et révoquer ; modifier une note de test et constater la nouvelle revue ; créer manuellement une relation puis vérifier le retour aux compteurs et l’accès à un autre type. Vérifier les preuves différées et les actions sur une fiche de cent relations. Contrôler avec un visiteur non administrateur l’absence de données privées dans les nouveaux endpoints et le graphe public.

Les tests utilisent des données fictives : 130 fiches/296 paires, puis 1 000 fiches/6 000 paires. Les tests de transactions et de routes vérifient les seules écritures de décision, les empreintes et révisions concurrentes, les contrôles d’accès et la provenance. Aucun véritable contenu Hesta n’est ajouté aux fixtures.

Validation locale du 11 octobre 2026 : **720 tests réussis (422 API + 298 web)**, dont 24 nouveaux tests. Lint, typecheck, build, Prisma validate/generate et `git diff --check` réussis. La commande `npm test` standard a dépassé les délais web de cinq secondes sur cet environnement Windows, y compris dans des suites antérieures. La suite complète a ensuite réussi avec une configuration temporaire **hors dépôt** : attente DOM de 10 secondes, délais de test/hooks de 60 secondes, quatre workers `forks`, sans exclusion. Les tests existants des fiches ont été adaptés pour ouvrir les détails avant de vérifier les preuves ; leurs vérifications de provenance, édition et publication demeurent. La configuration permanente du projet n’a pas été modifiée.

Le build final a été contrôlé dans Edge avec une API locale simulée à 1920×1080, 3840×2160, 768×1024 et 390×844 : décisions conservées après actualisation, révocation, création et retour à la file, dix lignes sur une fiche de cent relations, une seule requête de preuves à l’ouverture, aucun débordement horizontal ni erreur JavaScript, graphe public sans fiches privées. Les captures et scripts restent hors dépôt.

La fixture de 1 000 fiches/6 000 connexions a également été ouverte dans le navigateur : cinquante lignes initiales et six références par direction pour la fiche sélectionnée. Mesure ponctuelle locale : environ **1,56 seconde** pour résoudre le catalogue et préparer sa première page, **178 373 octets** de réponse JSON (y compris la liste légère des fiches pour les filtres). Il s’agit d’une mesure sur données fictives en mémoire, sans requêtes PostgreSQL ni mesure réseau/VPS. La pagination limite les lignes rendues ; ces chiffres ne garantissent pas le temps de réponse de production.

## Fichiers de cette livraison

27 fichiers concernés, sans modification des dépendances ni de la configuration permanente des tests :

```text
README.md
apps/api/src/admin/routes.ts
apps/api/src/admin/store.ts
apps/api/src/app.ts
apps/api/src/obsidian-references.ts
apps/api/src/reference-qualification.ts
apps/api/src/reference-qualification.test.ts
apps/api/src/server.ts
apps/web/src/Admin.css
apps/web/src/AdminApp.tsx
apps/web/src/AdminCreateRelation.tsx
apps/web/src/AdminCreateRelation.test.tsx
apps/web/src/AdminProvenance.tsx
apps/web/src/AdminProvenance.test.tsx
apps/web/src/AdminReferenceQueue.tsx
apps/web/src/AdminReferenceQueue.test.tsx
apps/web/src/AdminReferenceRelation.test.tsx
apps/web/src/ObsidianReferences.tsx
apps/web/src/WikiMarkdown.test.tsx
apps/web/src/admin-http.ts
apps/web/src/reference-relation.ts
docs/REFERENCE-QUALIFICATION.md
packages/shared/src/index.ts
packages/shared/src/obsidian.ts
packages/shared/src/reference-qualification.ts
prisma/schema.prisma
prisma/migrations/20261011000000_obsidian_reference_ignores/migration.sql
```
