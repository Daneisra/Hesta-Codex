# API publique et administration en lecture seule

L’API Express utilise un seul client Prisma par processus. Les routes métier restent en
lecture seule ; l'authentification écrit uniquement `User` et `Session` pour les connexions.
`DATABASE_URL` est requis au démarrage ; copier `.env.example` en `.env` pour le
développement local. Le client est fermé lors de l’arrêt du serveur. Les tests utilisent des
doubles en mémoire et ne contactent pas PostgreSQL.

Sur `/api/v1`, seules les `Entity` et `Relation` dont le statut est `PUBLISHED` et la
visibilité `PUBLIC` sont renvoyées. Les deux extrémités d’une relation doivent également être
publiées et publiques. Les fiches non visibles répondent comme une fiche absente. Sources,
preuves et révisions restent exclues de l'API publique.

| Route | Réponse |
| --- | --- |
| `GET /api/v1/health` | `{ status, service, version, database }` ; `200` si PostgreSQL répond, `503` sinon, sans détail de connexion. |
| `GET /api/v1/relation-types` | Catalogue des types de relations trié par `code` croissant. |
| `GET /api/v1/entities` | Jusqu’à 100 fiches de navigation, triées par titre puis slug. Paramètres facultatifs : `kind` (valeur exacte de `EntityKind`) et `q` (2 à 100 caractères, recherche insensible à la casse dans titre, résumé et slug). |
| `GET /api/v1/entities/:slug` | Fiche avec Markdown, dates, alias et relations `outgoingRelations`/`incomingRelations`. Chaque relation contient son type et la fiche voisine. `404` si absente ou non publique. |

Les paramètres inconnus, répétés ou mal formés renvoient `400` avec
`{ "error": { "code": "INVALID_REQUEST", "message": "..." } }`. Les erreurs internes renvoient
un message générique avec `500`. Il n’y a pas encore de pagination ; la limite de 100 fiches
est provisoire. Les recherches avancées, backlinks calculés à partir du Markdown et accès aux
contenus réservés seront traités dans un jalon ultérieur.

Le JSON libre `Entity.metadata` n’est pas exposé : ses futures clés publiques devront être
définies explicitement avant d’entrer dans le contrat de l’API.

## Authentification et administration

`GET /api/auth/session` retourne `{ authenticated, isAdmin, user }` sans Discord ID ni token.
`GET /api/auth/discord/login` et `GET /api/auth/discord/callback` réalisent OAuth ;
`POST /api/auth/logout` révoque la session. Voir [AUTH.md](AUTH.md).

Toutes les routes `/api/admin/**` exigent une session active et un Discord ID présent dans
`DISCORD_ADMIN_IDS` : `401` sans session, `403` pour un utilisateur non admin. Les réponses
portent `Cache-Control: no-store`.

| Route admin | Réponse |
| --- | --- |
| `GET /api/admin/stats` | Comptes par statut et visibilité, nombre de sources et relations. |
| `GET /api/admin/entities` | `{ items, total, page, pageSize }` ; 50 fiches par page, tous statuts et visibilités. Filtres facultatifs `status`, `visibility`, `kind`, `q` (2 à 100 caractères), `page` (1 à 9999). |
| `GET /api/admin/entities/:slug` | Fiche éditoriale complète, preuves avec Source, relations entrantes/sortantes avec preuves, historique des Revision ; `404` si absente. |

Les filtres inconnus, répétés ou invalides donnent `400`. Les champs `metadata` restent exclus
pour éviter d'exposer un JSON dont le contenu n'a pas encore été classé. Aucun endpoint
d'écriture métier n'existe dans v0.4a.
