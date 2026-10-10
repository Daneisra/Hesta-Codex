<div align="center">
  <strong>HESTA</strong><br>
  <em>Un univers, plusieurs outils.</em><br>
  <a href="https://hesta.dannytech.fr/">Portail Hesta</a> ·
  <a href="https://cartehesta.dannytech.fr/">Carte Hesta</a> ·
  <a href="https://pahesta.dannytech.fr/">Système PA</a>
</div>

# Hesta Codex

M3 commence avec un **convertisseur Obsidian local en lecture seule** :
`npm run --silent lore:obsidian:prepare -- --help`. Il prépare des lots staging v1
validés, sans connexion PostgreSQL, réseau ni création éditoriale. Inspection `--dry-run`,
coffre/identifiant explicites, sélection progressive et sortie privée hors Git.
Voir [docs/OBSIDIAN-IMPORT.md](docs/OBSIDIAN-IMPORT.md) pour les commandes et précautions.

La création éditoriale groupée depuis une Source Obsidian existante est disponible avec
`npm run --silent lore:staging:promote -- --help` : dry-run, plan approuvé par empreinte,
puis créations PROPOSED/GM transactionnelles avec association humaine, provenance et Revision.
Voir [docs/STAGING-PROMOTION.md](docs/STAGING-PROMOTION.md) pour les paramètres et commandes VPS.
Le [nettoyage ponctuel préalable](docs/STAGING-CLEANUP.md) fournit un inventaire et un
modèle SQL avec UUID explicites et ROLLBACK par défaut, à vérifier puis exécuter manuellement.

v0.7e ajoute la **mise à jour humaine depuis une association confirmée** : les valeurs finales
partent de la fiche actuelle ; le staging est repris champ par champ, puis un récapitulatif
Avant/Après précède l’application atomique (Entity + une Evidence + une Revision).
DRAFT/PROPOSED uniquement ; PUBLISHED reste comparable mais bloquée, ARCHIVED refusée.
Slug/publication et association restent inchangés, sans nouveau schéma ni migration.
Voir [docs/STAGING-UPDATE.md](docs/STAGING-UPDATE.md), notamment l’idempotence et la validation PostgreSQL future.

Base de connaissance structurée du Monde d’Hesta. À terme, le Codex sera la source de vérité
du lore durable et exposera des données sourcées aux autres applications. Le dépôt contient
le socle web/API et le premier modèle PostgreSQL ; aucune fiche lore n'est créée automatiquement.
L'interface publique permet de consulter les fiches publiées et leurs relations. L'espace
`/admin`, protégé par Discord, permet d'inspecter et de réviser les fiches, puis de publier
explicitement les propositions validées.

## Stack

- Monorepo npm workspaces, Node.js 22, TypeScript.
- Frontend React + Vite dans `apps/web`.
- API Express dans `apps/api`.
- Types partagés dans `packages/shared`.
- PostgreSQL et Prisma dans `prisma/`, avec une première migration métier et un seed du
  seul catalogue de types de relations.
- Authentification Discord `identify` et sessions révocables dans PostgreSQL pour `/admin`.

## Développement local

```bash
npm ci
npm run dev
```

Le site est accessible sur `http://localhost:5173` et l’API sur
`http://localhost:3000/api/v1/health`. En développement, Vite relaie `/api` vers Express.
L’API utilise `DATABASE_URL` pour lire PostgreSQL ; sa route de santé vérifie aussi la base.
La bibliothèque est accessible à `/` et chaque fiche à `/fiches/:slug`. Les liens de fiche
sont partageables ; le serveur web doit renvoyer `index.html` pour ces chemins frontend.
La recherche démarre à deux caractères. La liste affiche au plus 100 fiches par requête,
limite actuelle de l'API ; il n'y a pas encore de pagination ni de total global.
La vue `/graphe` montre les fiches et relations publiques ; `/admin/graphe` montre le réseau
éditorial aux administrateurs. Les règles de visibilité sont appliquées dans les requêtes API,
pas dans le Canvas. v0.6d conserve la recherche locale, les filtres, le voisinage à profondeur
1–3 et le survol temporaire, puis ajoute des liens publics partageant l'état d'exploration,
« Copier le lien », des labels prioritaires et la sauvegarde des positions déplacées dans
ce navigateur. « Réinitialiser la disposition » libère ces positions sans écriture en base.
Les liens admin partagent seulement filtres, catégories et profondeur, sans sélection ni recherche privée.
Voir [docs/GRAPH.md](docs/GRAPH.md).

Pour lancer l’API, utiliser les migrations ou le seed, copier `.env.example` en `.env` et remplacer les
valeurs fictives de `DATABASE_URL` par celles d'une base PostgreSQL. Le fichier `.env` est
ignoré par Git. `PORT` vaut 3000 par défaut ; garder cette valeur avec la configuration
Vite actuelle.

L'administration locale utilise l'URI de callback
`http://localhost:5173/api/auth/discord/callback`, relayée par Vite. Les variables Discord et
de session de `.env.example` doivent être remplacées dans `.env` avant de démarrer l'API ;
aucun secret n'est versionné. Voir [docs/AUTH.md](docs/AUTH.md) pour la configuration.

## Vérifications

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run prisma:validate
npm run prisma:generate
```

La validation et la génération Prisma ne demandent pas de base locale. Une URL non joignable
sert seulement à la validation hors ligne quand `DATABASE_URL` est absente. Le workflow
GitHub Actions contrôle le code, puis le workflow de déploiement applique les migrations
sur le VPS si la CI de `main` réussit. Les tests API utilisent une source de données simulée
et les tests web simulent les réponses HTTP ; ils n’accèdent pas au VPS.

Sur une base PostgreSQL configurée, appliquer la migration puis créer ou actualiser les
quatre types de relations initiaux :

```bash
npm run prisma:migrate
npm run prisma:seed
```

`prisma:migrate` utilise `prisma migrate dev` pour le développement local. Pour appliquer
des migrations déjà validées dans un environnement non interactif, utiliser
`npm run prisma:deploy` après avoir configuré `DATABASE_URL`. Le seed est idempotent et
ne crée aucune `Entity`. Ces commandes ne sont pas exécutées par le workflow CI.

## Import éditorial contrôlé

Un fichier JSON versionné permet de proposer des fiches et des relations depuis la ligne
de commande, sans route d'écriture publique. Examiner d'abord le lot sans écrire en base :

```bash
npm run lore:import -- examples/lore-import.template.json --dry-run
```

Après revue du fichier et du résultat, effectuer l'import réel avec :

```bash
npm run lore:import -- chemin/vers/fichier.json
```

L'import utilise `DATABASE_URL` localement, valide le lot et ses références, puis écrit
dans une transaction unique. Les nouvelles fiches et relations restent `PROPOSED`, avec
visibilité `GM` par défaut ; chaque fiche obtient une première `Revision` et chaque fiche
ou relation importée doit avoir au moins une `Evidence` liée à la `Source` du lot. Aucune
publication n'est automatique. Le fichier dans `examples/` est un **template technique
non canonique** et n'est jamais chargé par le seed ni par la CI. Le format, les conflits
et les garanties du pipeline sont détaillés dans [docs/IMPORT.md](docs/IMPORT.md).

## Administration éditoriale

v0.7a ajoute un staging privé de contenus externes et sa consultation en lecture seule à
`/admin/ingestion`. `npm run lore:ingest -- fichier.json --dry-run` compare le lot à une base
configurée sans écrire ; sans `--dry-run`, une transaction conserve Sources, batch, snapshots
immuables et réceptions. Aucun connecteur, appel IA, Entity/Relation/Evidence/Revision
ou publication automatique n'est ajouté. `lore:import` conserve son comportement éditorial.
Le [template fictif](examples/lore-ingestion.template.json) n'est jamais ingéré automatiquement.
Format, idempotence, confidentialité et roadmap v0.7 : [docs/INGESTION.md](docs/INGESTION.md).

v0.7b ajoute la détection déterministe des fiches existantes dans le détail d’ingestion :
provenance exacte, titre/alias, slug et similarité conservatrice. Les résultats sont calculés
à la demande, bornés et explicables, tous statuts/visibilités inclus ; les fiches archivées et
les recherches tronquées sont signalées. Aucun rattachement, écriture ou nouvelle migration.
Les cinq signaux exacts sont recherchés en base avant toute limite ; seuls les candidats
approximatifs supplémentaires sont plafonnés à 200. Les comptes d’identité forts restent complets.
Le calcul reste informatif. Règles et limites : [docs/MATCHING.md](docs/MATCHING.md).

v0.7c ajoute les associations humaines persistantes dans `/admin/ingestion` : confirmer une
suggestion, choisir une autre fiche, rejeter un candidat, remplacer ou retirer une confirmation.
Les décisions suivent Source + identité externe entre versions ; sans externalId elles restent
limitées au snapshot. Auteur/date serveur, révision optimiste, transaction et unicité SQL
protègent les décisions concurrentes. La migration additive `20261006000000_ingestion_associations`
crée uniquement les tables dédiées. Association ≠ import éditorial, preuve ou publication :
aucune Entity/Relation/Evidence/Revision n’est écrite. Voir [docs/ASSOCIATION.md](docs/ASSOCIATION.md).

v0.7d ajoute une action humaine distincte « Créer une fiche dans le Codex » pour un item sans
confirmation : préparation, correction et récapitulatif avant création atomique d’une Entity
PROPOSED, Evidence, Revision #1 et association MANUAL. La Source est réutilisée, le staging
reste immuable et aucune publication n’a lieu. Aucune migration supplémentaire.
Voir [docs/STAGING-CREATION.md](docs/STAGING-CREATION.md).

Depuis `/admin`, « Nouvelle fiche » ouvre la création manuelle v0.5a. Chaque création impose
une Source existante ou nouvelle et une Evidence initiale. L'Entity, l'Evidence, la Source
éventuelle et la `Revision #1` sont écrites dans une seule transaction. La fiche reste
`PROPOSED`, avec visibilité `GM` par défaut, jusqu'à une publication humaine explicite.
Voir [docs/MANUAL-CREATION.md](docs/MANUAL-CREATION.md) pour le formulaire, les validations
et les conflits. Depuis une fiche non archivée, « Ajouter une relation » crée une arête
`PROPOSED` avec Source et Evidence obligatoires, sans créer de `Revision` Entity. Les sens
inverses et symétriques sont normalisés côté API ; voir
[docs/MANUAL-RELATIONS.md](docs/MANUAL-RELATIONS.md).

Depuis v0.5c, « Ajouter une preuve » enrichit une fiche ou une relation existante avec
une Source existante ou nouvelle. L'ajout est transactionnel, refuse les doublons certains
et ne crée aucune Revision ni publication. Les preuves sont regroupées par Source dans
l'administration ; voir [docs/PROVENANCE-WORKFLOW.md](docs/PROVENANCE-WORKFLOW.md).

`/admin` est réservé aux Discord IDs inscrits dans `DISCORD_ADMIN_IDS`. Un administrateur y voit
les fiches de tout statut et toute visibilité, leurs sources, preuves, relations et révisions.
Il peut modifier les champs éditoriaux d'une fiche non archivée, publier une proposition ou
retirer une publication. Chaque changement réel d'Entity crée une Revision ; un `expectedUpdatedAt`
empêche l'écrasement silencieux des modifications d'un autre administrateur. Les actions de
publication sont distinctes de l'enregistrement et demandent confirmation. Seules les fiches
`PUBLISHED + PUBLIC` apparaissent dans l'API et la bibliothèque publiques ; les relations
importées restent privées tant qu'elles ne sont pas publiées séparément.

v0.4c permet aussi de corriger la description et la visibilité d'une relation, puis de la
publier ou la retirer ; ses deux fiches doivent être publiées et publiques pour qu'elle
apparaisse dans le Codex public. Les champs éditoriaux des sources et preuves peuvent être
corrigés. Leur identité et leurs cibles restent fixes. Ces corrections utilisent
`expectedUpdatedAt` et ne produisent pas encore de `Revision` dédiée.

Le premier lot `PROPOSED + GM` reste invisible publiquement jusqu'aux validations humaines.
Le workflow est détaillé dans [docs/EDITORIAL-WORKFLOW.md](docs/EDITORIAL-WORKFLOW.md), et la
configuration Discord dans [docs/AUTH.md](docs/AUTH.md). La correction des relations, sources
et preuves est détaillée dans [docs/PROVENANCE-WORKFLOW.md](docs/PROVENANCE-WORKFLOW.md).

## Structure

```text
apps/web/         Bibliothèque publique, fiches et tests d'interface
apps/api/         API Express, client Prisma, import/ingestion CLI et tests
packages/shared/  Contrats TypeScript communs
prisma/           Schéma PostgreSQL, migration initiale et seed RelationType
docs/             Décisions et contraintes du modèle de données
examples/         Modèles JSON techniques d'import/ingestion, jamais chargés automatiquement
scripts/          Scripts ponctuels d'exploitation, sans lancement automatique
```

Les modèles `Entity`, `RelationType`, `Relation`, `Source`, `Evidence`, `Revision`, `User` et `Session`, leurs
contraintes SQL et les fonctionnalités reportées sont décrits dans
[docs/DATA-MODEL.md](docs/DATA-MODEL.md).
Les routes de lecture et leurs limites sont décrites dans [docs/API.md](docs/API.md).

## Écosystème Hesta

| Application | Responsabilité |
| --- | --- |
| [Hesta Hub](https://hesta.dannytech.fr/) | Portail public |
| [Carte Hesta](https://cartehesta.dannytech.fr/) | Carte, affichage spatial, planning et expérience communautaire |
| [Système PA](https://pahesta.dannytech.fr/) | Règles, armures et calculs |
| Hesta Codex — ce projet | Connaissance durable, relations et provenance |
