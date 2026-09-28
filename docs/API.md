# API de lecture v1

L’API Express lit PostgreSQL via un seul client Prisma par processus. Elle n’écrit aucune
donnée. `DATABASE_URL` est requis au démarrage ; copier `.env.example` en `.env` pour le
développement local. Le client est fermé lors de l’arrêt du serveur. Les tests utilisent des
doubles en mémoire et ne contactent pas PostgreSQL.

Sans authentification, seules les `Entity` et `Relation` dont le statut est `PUBLISHED` et la
visibilité `PUBLIC` sont renvoyées. Les deux extrémités d’une relation doivent également être
publiées et publiques. Les fiches non visibles répondent comme une fiche absente. Sources,
preuves et révisions attendent un futur contrôle d’accès.

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
