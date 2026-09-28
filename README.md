<div align="center">
  <strong>HESTA</strong><br>
  <em>Un univers, plusieurs outils.</em><br>
  <a href="https://hesta.dannytech.fr/">Portail Hesta</a> ·
  <a href="https://cartehesta.dannytech.fr/">Carte Hesta</a> ·
  <a href="https://pahesta.dannytech.fr/">Système PA</a>
</div>

# Hesta Codex

Base de connaissance structurée du Monde d’Hesta. À terme, le Codex sera la source de vérité
du lore durable et exposera des données sourcées aux autres applications. Le dépôt contient
le socle web/API et le premier modèle PostgreSQL ; aucune fiche lore n'est créée.
L'interface publique permet de consulter les fiches publiées et leurs relations.

## Stack

- Monorepo npm workspaces, Node.js 22, TypeScript.
- Frontend React + Vite dans `apps/web`.
- API Express dans `apps/api`.
- Types partagés dans `packages/shared`.
- PostgreSQL et Prisma dans `prisma/`, avec une première migration métier et un seed du
  seul catalogue de types de relations.

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

Pour lancer l’API, utiliser les migrations ou le seed, copier `.env.example` en `.env` et remplacer les
valeurs fictives de `DATABASE_URL` par celles d'une base PostgreSQL. Le fichier `.env` est
ignoré par Git. `PORT` vaut 3000 par défaut ; garder cette valeur avec la configuration
Vite actuelle.

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

## Structure

```text
apps/web/         Bibliothèque publique, fiches et tests d'interface
apps/api/         API Express, client Prisma et tests de lecture
packages/shared/  Contrats TypeScript communs
prisma/           Schéma PostgreSQL, migration initiale et seed RelationType
docs/             Décisions et contraintes du modèle de données
scripts/          Emplacement pour les futurs scripts nécessaires
```

Les modèles `Entity`, `RelationType`, `Relation`, `Source`, `Evidence` et `Revision`, leurs
contraintes SQL et les fonctionnalités reportées sont décrits dans
[docs/DATA-MODEL.md](docs/DATA-MODEL.md). Aucun `User` n'est créé à ce stade.
Les routes de lecture et leurs limites sont décrites dans [docs/API.md](docs/API.md).

## Écosystème Hesta

| Application | Responsabilité |
| --- | --- |
| [Hesta Hub](https://hesta.dannytech.fr/) | Portail public |
| [Carte Hesta](https://cartehesta.dannytech.fr/) | Carte, affichage spatial, planning et expérience communautaire |
| [Système PA](https://pahesta.dannytech.fr/) | Règles, armures et calculs |
| Hesta Codex — ce projet | Connaissance durable, relations et provenance |
