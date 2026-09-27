<div align="center">
  <strong>HESTA</strong><br>
  <em>Un univers, plusieurs outils.</em><br>
  <a href="https://hesta.dannytech.fr/">Portail Hesta</a> ·
  <a href="https://cartehesta.dannytech.fr/">Carte Hesta</a> ·
  <a href="https://pahesta.dannytech.fr/">Système PA</a>
</div>

# Hesta Codex

Base de connaissance structurée du Monde d’Hesta. À terme, le Codex sera la source de vérité
du lore durable et exposera des données sourcées aux autres applications. La v0.1 contient
uniquement le socle technique : une page web, une API de santé et la configuration des outils.

## Stack

- Monorepo npm workspaces, Node.js 22, TypeScript.
- Frontend React + Vite dans `apps/web`.
- API Express dans `apps/api`.
- Types partagés dans `packages/shared`.
- PostgreSQL et Prisma préparés dans `prisma/`, sans table ni migration métier à ce stade.

## Développement local

```bash
npm ci
npm run dev
```

Le site est accessible sur `http://localhost:5173` et l’API sur
`http://localhost:3000/api/v1/health`. En développement, Vite relaie `/api` vers Express.
Le endpoint de santé ne dépend pas de PostgreSQL.

Pour préparer une connexion PostgreSQL, copier `.env.example` en `.env` et remplacer les
valeurs fictives de `DATABASE_URL`. Le fichier `.env` est ignoré par Git. `PORT` vaut 3000
par défaut ; garder cette valeur avec la configuration Vite actuelle.

## Vérifications

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run prisma:validate
```

La validation Prisma ne demande pas de base locale. Une URL non joignable sert uniquement
à cette validation quand `DATABASE_URL` est absente. Aucune commande de migration n’est lancée.
Le workflow GitHub Actions effectue les mêmes contrôles ; il ne déploie rien.

## Structure

```text
apps/web/         Page publique minimale
apps/api/         API Express et test du endpoint de santé
packages/shared/  Contrats TypeScript communs
prisma/           Schéma PostgreSQL et emplacement des migrations futures
docs/             Décisions sur le futur modèle de données
scripts/          Emplacement pour les futurs scripts nécessaires
```

Les modèles `Entity`, `Relation`, `Source`, `Evidence`, `Revision` et `User` sont préparés
dans [docs/DATA-MODEL.md](docs/DATA-MODEL.md), puis seront précisés avant toute création
de tables.

## Écosystème Hesta

| Application | Responsabilité |
| --- | --- |
| [Hesta Hub](https://hesta.dannytech.fr/) | Portail public |
| [Carte Hesta](https://cartehesta.dannytech.fr/) | Carte, affichage spatial, planning et expérience communautaire |
| [Système PA](https://pahesta.dannytech.fr/) | Règles, armures et calculs |
| Hesta Codex — ce projet | Connaissance durable, relations et provenance |

