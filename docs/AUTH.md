# Authentification Discord et administration

L'administration `/admin` permet l'édition contrôlée des fiches depuis v0.4b. L'API publique `/api/v1` conserve strictement
la condition `PUBLISHED + PUBLIC` pour fiches, relations et voisins. Une connexion Discord ne
change jamais les résultats publics.

## Application Discord

Créer une application dans le portail développeur Discord et relever son Client ID et son
Client Secret. Dans OAuth2, enregistrer exactement l'URI de redirection utilisée :

- Développement avec Vite : `http://localhost:5173/api/auth/discord/callback` ; Vite relaie `/api` à Express.
- Production : `https://codexhesta.dannytech.fr/api/auth/discord/callback`.

Le serveur demande seulement le scope `identify`, échange le code côté serveur, puis lit
`/users/@me`. Il ne demande ni email, ni guilde, ni permission de bot. Le jeton OAuth sert
uniquement à cette lecture et n'est pas enregistré.

## Variables d'environnement

Définir dans `.env` sur chaque environnement, jamais dans Git :

| Variable | Usage |
| --- | --- |
| `DISCORD_CLIENT_ID` | ID de l'application Discord. |
| `DISCORD_CLIENT_SECRET` | Secret OAuth de l'application. |
| `DISCORD_REDIRECT_URI` | URI enregistrée dans Discord, avec le chemin exact `/api/auth/discord/callback`. HTTPS obligatoire en production. |
| `DISCORD_ADMIN_IDS` | Liste de Discord user IDs autorisés, séparés par des virgules. Les espaces et éléments vides sont ignorés ; une liste sans ID valide est refusée. Aucun rôle d'application n'est persistant. |
| `SESSION_SECRET` | Secret aléatoire de 32 caractères minimum pour signer le state OAuth ; conserver stable entre redémarrages. |
| `SESSION_TTL_MS` | Durée serveur des sessions en millisecondes, de 60 000 à 2 592 000 000 ; exemple : `604800000` pour sept jours. |

L'absence ou l'invalidité d'une variable obligatoire empêche le démarrage de l'API. Aucun ID
réel ni secret ne doit être ajouté au dépôt. Après modification de `DISCORD_ADMIN_IDS`,
redémarrer l'API : la whitelist est vérifiée à chaque requête admin, sans rôle en base.

## Flux et sécurité

1. `GET /api/auth/discord/login` crée un nonce aléatoire et un cookie OAuth signé et limité
   à dix minutes, puis redirige vers Discord avec `state` et le seul scope `identify`.
2. `GET /api/auth/discord/callback` vérifie le state et efface son cookie avant l'échange du
   code. Un state absent, expiré ou modifié est refusé.
3. Le serveur obtient Discord ID, username et display name, crée ou actualise `User`, révoque
   l'ancienne session de ce navigateur et crée un nouveau token aléatoire. Seul son hash
   SHA-256 est conservé dans `Session` avec une date d'expiration.
4. Le cookie de session Codex est `HttpOnly`, `SameSite=Lax`, sans attribut `Domain`, et
   `Secure` en HTTPS. En production, son nom utilise le préfixe `__Host-`.
5. `GET /api/auth/session` expose uniquement l'état de connexion, le rôle calculé et les noms
   nécessaires à l'interface. `POST /api/auth/logout` vérifie l'Origin, supprime la session
   en base et efface le cookie. L'expiration est contrôlée côté serveur.

Le cookie OAuth est effacé dès le callback, y compris en cas de refus. Sa réutilisation n'est
donc pas possible dans le flux normal du navigateur ; le code OAuth est à usage unique côté
Discord. Les sessions de plusieurs navigateurs d'un même utilisateur restent indépendantes :
une déconnexion révoque uniquement le token présenté. Il n'existe pas de champ `revokedAt` ;
la révocation supprime la ligne `Session`. Les lignes expirées ne donnent plus accès aux routes
mais restent en base. Un nettoyage périodique sera à prévoir si leur volume le justifie.

Toutes les réponses `/api/auth` et `/api/admin` sont `Cache-Control: no-store`. Les requêtes
admin mutantes exigent un header `Origin` exactement égal à l'origine de
`DISCORD_REDIRECT_URI` ; une Origin absente ou différente est refusée côté serveur. Ce contrôle
est commun aux méthodes `PATCH`, `POST`, `PUT` et `DELETE` actuelles ou futures. Aucun CORS
n'est ouvert : le frontend et l'API utilisent la même origine via Nginx ou le proxy Vite.
Les données `GM` et `SECRET` ne sont accessibles que si le middleware serveur vérifie une
session active et la whitelist. Un utilisateur Discord non admin reçoit `403`.

## Routes admin

- `GET /api/admin/stats` : comptes éditoriaux et totaux de sources/relations.
- `GET /api/admin/entities` : liste paginée par 50, filtres `status`, `visibility`, `kind`,
  `q` et `page`.
- `GET /api/admin/entities/:slug` : contenu, preuves et sources, relations et preuves liées,
  révisions et snapshots.
- `PATCH /api/admin/entities/:slug` : édition contrôlée d'une fiche.
- `POST /api/admin/entities/:slug/publish` et `/unpublish` : actions éditoriales explicites.

L'API admin omet `metadata` tant que ses clés et leur confidentialité ne sont pas définies.
L'interface `/admin` permet l'inspection, l'édition et la publication des fiches. Les sources,
preuves et relations y restent en lecture seule. Voir [EDITORIAL-WORKFLOW.md](EDITORIAL-WORKFLOW.md).

## Test et mise en production

En local, ajouter les variables de `.env.example` dans `.env`, enregistrer l'URI locale dans
Discord, appliquer la migration sur **une base locale de test**, puis lancer `npm run dev`.
Ouvrir `/admin`, se connecter et vérifier qu'un ID absent de `DISCORD_ADMIN_IDS` obtient un
refus. Les tests automatisés utilisent un faux fournisseur Discord et une fausse base ; ils
n'appellent pas Discord ni PostgreSQL du VPS.

En production, les six variables sont conservées dans `/srv/hesta-codex/repo/.env` et l'URI
HTTPS est enregistrée dans Discord. Le workflow existant fait `npm ci`, le build,
`prisma migrate deploy`, puis redémarre PM2. v0.4b ne demande aucune migration nouvelle.
Après déploiement, vérifier `/api/v1/health`, l'accès `/admin`, puis les mutations avec un
compte autorisé et une fiche de test choisie explicitement. Ne jamais afficher `.env` dans
les logs.

Nginx doit déjà proxifier tout `/api/` vers Express et renvoyer `index.html` pour les chemins
frontend `/admin` et `/admin/fiches/:slug`. Si sa configuration actuelle ne couvre pas ces
chemins, étendre le fallback SPA et laisser `/api/` hors de ce fallback. Désactiver tout cache
proxy sur `/api/auth/` et `/api/admin/` si un cache est configuré. Vérifier aussi que les logs
d'accès Nginx ne conservent pas la query string du callback OAuth, qui contient un code
temporaire : utiliser un format sans `$request`, `$request_uri` ni `$args` pour cette route
(par exemple avec `$uri`), ou désactiver
son access log. Aucun changement PM2 n'est nécessaire au-delà du redémarrage prévu par le
workflow.
