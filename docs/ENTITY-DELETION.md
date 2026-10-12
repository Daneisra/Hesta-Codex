# Suppression individuelle des fiches éditoriales

Depuis le détail administrateur d’une fiche, « Supprimer la fiche » ouvre une confirmation native. Le bilan est lu au moment de l’ouverture, sans écriture, et indique le titre, le statut et les nombres exacts de relations, preuves directes et de relations, révisions, décisions d’association et décisions d’ignorance concernées. Une relation entrante/sortante ou une ancienne auto-relation est comptée une seule fois.

La case « Je confirme la suppression définitive de cette fiche et de ses données liées » puis le bouton « Supprimer définitivement » sont obligatoires. Aucune suppression au chargement, à l’ouverture ou à la fermeture du dialogue. « Annuler » et Échap ferment le dialogue et rendent le focus au bouton d’origine. Pendant l’envoi, la confirmation, l’annulation, Échap, la navigation interne et la déconnexion sont bloqués ; un départ complet du navigateur déclenche son avertissement habituel. Une réponse perdue n’est jamais assimilée à une suppression réussie.

La suppression est autorisée pour tous les statuts, y compris `PUBLISHED` et `ARCHIVED`. Le dialogue avertit pour une fiche publiée. Après succès confirmé par le serveur, retour à `/admin`, message de confirmation et nouvelle lecture de la liste et des compteurs. Les lectures suivantes du graphe et des fiches reflètent la suppression. Les autres onglets déjà ouverts doivent actualiser leurs données ; aucun système de synchronisation temps réel n’est ajouté.

## API et contrôle de concurrence

Les routes réutilisent la session Discord administrateur, la liste d’opérateurs autorisés, `Cache-Control: no-store` et le contrôle d’`Origin` exact pour la mutation. Aucune route publique de suppression.

- `GET /api/admin/entities/:slug/deletion` : bilan `{id,slug,title,status,fingerprint,counts}`. Aucun Markdown, extrait de preuve ou secret n’est transmis. Une transaction `REPEATABLE READ READ ONLY` assure une lecture cohérente.
- `DELETE /api/admin/entities/:slug` : JSON strict `{entityId,fingerprint,confirm:true}` ; réponse `204` sans contenu. Un slug unique valide, l’UUID cible, l’empreinte SHA-256 du bilan et la confirmation explicite sont requis. Aucun paramètre de suppression globale ou par lots.

Le serveur verrouille la fiche et relit ses dépendances dans une transaction Prisma `SERIALIZABLE`, avec un délai de 20 secondes. L’empreinte inclut l’identité et la date de modification de la fiche, les UUID et dates des relations et preuves, les UUID des révisions et décisions, les révisions des associations et des décisions d’ignorance. Un changement après présentation du bilan, même sans variation des compteurs, impose une nouvelle revue. Un slug réutilisé par un nouvel UUID n’est pas supprimé avec l’ancienne confirmation. Aucune empreinte ou donnée de confirmation n’est stockée dans l’URL, l’historique du navigateur ou un stockage persistant du navigateur.

Une fiche absente donne `404`, une requête invalide `400`, une session expirée `401`, un accès non autorisé ou une origine incorrecte `403`. Un changement de bilan, une dépendance concurrente ou un conflit transactionnel donne `409 ENTITY_DELETION_MODIFIED`. L’interface exige alors un nouveau bilan et une nouvelle confirmation. Une erreur inattendue donne une réponse générique, sans détails SQL ni données privées. Aucune reprise automatique d’un `DELETE`.

## Dépendances supprimées et données conservées

Dans **une seule transaction**, dans l’ordre des clés étrangères :

1. Preuves directement liées à la fiche et preuves des relations entrantes/sortantes concernées.
2. Ces relations éditoriales.
3. Révisions de la fiche.
4. Incrément des révisions des associations d’ingestion ayant une décision sur cette fiche, sans modifier leur identité, Source, item ou chemin.
5. Décisions d’association concernant uniquement la fiche ciblée, confirmées ou rejetées.
6. Décisions d’ignorance Obsidian dont cette fiche est une extrémité.
7. La fiche ciblée, par son UUID.

Les associations d’ingestion restent présentes. Leurs décisions concernant d’autres fiches sont préservées, y compris une confirmation indépendante lorsqu’une décision de rejet de la fiche supprimée est retirée. Les autres fiches, leurs Markdown, preuves et révisions indépendantes ne sont jamais modifiés. Une preuve attachée à une relation supprimée est une dépendance de cette relation, même si l’autre extrémité de la relation reste présente.

**Sources, RelationType, IngestionBatch, IngestionItem, IngestionReceipt, contenu et métadonnées originaux du staging sont conservés intégralement**, même lorsqu’une Source devient inutilisée. Aucun accès au coffre Obsidian ou au système de fichiers dans le service de suppression. Le schéma existant suffit ; aucune migration ni cascade supplémentaire n’est ajoutée.

Toute erreur annule aussi les nettoyages déjà effectués et les changements de révision d’association. Les contraintes `RESTRICT` restent actives et empêchent une suppression partielle en présence d’une dépendance concurrente. Les cascades existantes des décisions d’ignorance restent compatibles avec le nettoyage explicite.

## Références Obsidian et nouvelle décision éditoriale

Les wikilinks des autres fiches ne sont pas réécrits. Les références automatiques sont recalculées à partir des fiches et associations confirmées restantes : la destination supprimée ne produit plus d’arête ni de lien vers une fiche existante. Un chemin toujours connu par les métadonnées `FOUND` du staging devient « sans fiche associée » ; sinon la résolution peut devenir absente ou ambiguë selon le moteur existant. Une référence automatique ne crée jamais de fiche.

La suppression d’une décision d’association incrémente la révision de son association : les anciennes préparations de création ou de mise à jour sont refusées. Un ancien plan de promotion approuvé n’est plus valable si son état d’association a changé. L’identité originale demeure en staging, sans confirmation vers un UUID supprimé.

Une **nouvelle décision éditoriale humaine** peut ultérieurement recréer une fiche depuis le staging, avec un nouvel UUID, en utilisant les services et validations existants. La suppression ne met pas en place une interdiction permanente de réimport ni un nouveau mécanisme de tombstone. Aucun job, import, promotion ou traitement de lot n’est lancé par cette fonctionnalité.

## Tests et limites

Les tests API utilisent le vrai `PrismaClient` et `PrismaPg` avec PostgreSQL embarqué PGlite en mémoire, exposé uniquement sur `127.0.0.1` à un port éphémère. La connexion est construite par le test ; `DATABASE_URL` et toute base persistante sont ignorés. `pglite-socket` est une dépendance de développement explicite, déjà présente dans les dépendances transitives de Prisma.

Les migrations existantes créent le schéma du test. La fixture fictive comporte une fiche publiée, plusieurs fiches liées, une ancienne auto-relation, des preuves partagées par Source, des révisions, confirmations/rejets d’ingestion, décisions d’ignorance et originaux en staging. Les tests comparent toutes les lignes avant/après, vérifient le graphe, les compteurs et les références non associées, puis injectent une erreur PostgreSQL à la suppression finale de la fiche pour prouver le rollback des suppressions précédentes et des révisions d’association. Ils couvrent aussi les bilans obsolètes, UUID remplacés, rejouages, statuts, sessions, origine et confirmations invalides.

Les tests web vérifient le bilan à la demande, les nombres et les données protégées affichés, la confirmation explicite, Annuler/Échap, le double clic, les échecs réseau/HTTP, la nouvelle confirmation après conflit et le retour au tableau de bord avec actualisation des compteurs. Aucun contenu réel du lore ni fichier de coffre n’est utilisé.

PostgreSQL embarqué permet de vérifier les requêtes Prisma, contraintes et transactions réelles ; il ne reproduit pas le VPS, ses droits ou des transactions simultanées sur plusieurs connexions. La recette du déploiement reste à réaliser par l’opérateur. Il n’existe pas de restauration dans l’administration : la suppression est définitive dans l’application.

## Validation et fichiers

Validation locale du 12 octobre 2026 : **756 tests réussis (438 API + 318 web)**, dont 23 nouveaux tests. La suite complète `npm test` a utilisé la configuration temporaire Windows hors dépôt déjà employée pour les délais : quatre workers `forks`, attente DOM de 10 secondes et délais tests/hooks de 60 secondes, sans exclusion. La configuration permanente de tests reste inchangée. Le retour au tableau de bord vide immédiatement les anciens états de liste et de statistiques pour ne pas réafficher une fiche supprimée pendant leur nouvelle lecture ; le test bloque cette lecture pour vérifier ce comportement.

La recette Edge avec API locale simulée de 130 fiches, à 1920×1080 et 390×844, vérifie le vrai dialogue modal, Échap et le retour du focus, la case obligatoire, les données conservées annoncées et le retour aux compteurs actualisés. Aucun débordement horizontal ni erreur JavaScript. Les scripts, journaux et captures restent hors dépôt. Aucun coffre privé, VPS ou base réelle n’a été consulté ; seules les fixtures éphémères ont été supprimées.

Lint, typecheck, build, Prisma validate/generate et `git diff --check` réussis sur le travail final. Le build conserve un avertissement Vite non bloquant : bundle principal de 504,63 ko minifiés (144,17 ko gzip), légèrement au-dessus du seuil de 500 ko. Aucun changement de découpage de l’application n’a été ajouté à cette fonctionnalité.

14 fichiers concernés, sans changement de schéma, de migrations ou de workflow :

```text
README.md
apps/api/src/admin/entity-deletion.ts
apps/api/src/admin/routes.ts
apps/api/src/app.ts
apps/api/src/entity-deletion.test.ts
apps/api/src/server.ts
apps/web/src/Admin.css
apps/web/src/AdminApp.tsx
apps/web/src/AdminDeleteEntity.tsx
apps/web/src/AdminDeleteEntity.test.tsx
docs/ENTITY-DELETION.md
package.json
package-lock.json
packages/shared/src/index.ts
```
