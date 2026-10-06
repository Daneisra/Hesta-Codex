# Associations humaines du staging — v0.7c

Source externe → ingestion → snapshot/version → matching déterministe → suggestion
→ décision humaine → association persistante.

**Association ≠ import éditorial. Association ≠ preuve. Association ≠ publication.**
Un score, même 100, n’effectue aucune décision. Seul un administrateur authentifié peut confirmer,
rejeter, changer ou retirer une association. Aucun texte reçu n’est injecté dans une fiche.
Le service ne crée ni ne modifie Entity, Relation, Evidence ou Revision ; il ne change aucun
statut, visibilité ou timestamp éditorial. Le matcher et l’ingestion historiques restent inchangés.

## Identité et versions

Le staging v0.7a possède déjà `(sourceId, identityKey, version)`. `identityKey` vaut
`e:SHA256(externalId strict)` quand externalId existe, sinon `h:contentHash normalisé`.
Une association dédiée utilise le couple `(Source UUID, identityKey)` sans introduire de nouvelle
identité logique. Elle conserve l’externalId exact et le snapshot d’ancrage, résolus côté serveur.
La clé est recalculée depuis les champs immuables avant toute lecture/écriture de décision.

- Même réception, réception inchangée ou version suivante de la même Source + externalId :
  même association, sans duplication et sans nouvelle confirmation automatique.
- Source ou identifiant externe différent, même titre/hash/locator : aucune association héritée.
- Sans externalId : la décision est limitée au snapshot d’ancrage. Une observation identique
  qui réutilise ce snapshot retrouve la décision ; un autre snapshot n’hérite pas.
- Incompatibilité de clé, externalId exact ou snapshot anonyme : 409, sans propagation/écriture.

L’ingestion refuse un externalId vide, seulement composé d’espaces, entouré d’espaces ou
contenant des contrôles. Les espaces internes sont conservés. Casse et représentation Unicode
(NFC/NFD) ne sont pas normalisées pour cette identité : deux chaînes différentes restent deux
identités, même si leurs noms sont équivalents pour le matching. Si l’identifiant disparaît,
le snapshot anonyme n’hérite pas ; si l’identifiant exact revient pour la même Source, sa
décision antérieure reste visible. Aucun rapprochement sémantique ne complète cette règle.

Le système ne peut pas détecter qu’un fournisseur a recyclé sémantiquement un identifiant
stable. Les suggestions actuelles restent visibles pour comparer ; des signaux forts vers
d’autres fiches ou une ambiguïté déclenchent un avertissement. Ils n’annulent pas une décision
humaine. Il faut changer ou retirer l’association si l’identité externe ne représente plus la fiche.

## Modèle, contraintes et migration

`IngestionAssociation` : UUID, Source UUID, identityKey, externalId facultatif, itemId d’ancrage,
révision entière monotone et createdAt. Unicité Source/identityKey ; les retraits laissent cette
ligne et sa révision pour empêcher un client obsolète de recréer une association depuis zéro.

`IngestionAssociationDecision` : UUID, associationId, Entity UUID, décision CONFIRMED/REJECTED,
origine MATCH/MANUAL, auteur Discord serveur + libellé et date serveur. L’origine décrit le
parcours déclaré par le client admin ; ce n’est ni un score vérifié ni une preuve automatique.
Le Discord ID est conservé pour l’attribution mais jamais projeté dans le DTO HTTP.
Les noms sont conservés à la date de la décision, même si le compte change ensuite.

La migration `20261006000000_ingestion_associations` est additive : seulement deux nouvelles
tables et deux enums, sans altération de colonne existante, backfill, extension ou dépendance.
Contraintes : couple association/Entity unique, index unique partiel `WHERE decision = 'CONFIRMED'`
garantissant **au plus une confirmation active**, FK RESTRICT vers Source/snapshot/Entity,
CHECK sur révision/forme d’identité/identifiant/attribution et index des rejets récents.
L’index partiel et les CHECK sont du SQL complémentaire : les préserver dans toute migration future.
La génération/validation Prisma est hors ligne. La migration n’est pas appliquée durant ce travail.

### Exécution et retour arrière à vérifier sur PostgreSQL

La migration contient explicitement `BEGIN`/`COMMIT` : tables, enums, index ordinaires et FK
sont créés dans une seule transaction PostgreSQL. Aucun `CREATE INDEX CONCURRENTLY`, commande
interdite dans ce bloc, ni extension n’est utilisé. Une erreur avant COMMIT doit laisser le
schéma initial intact ; la ligne d’échec du moteur de migration est gérée séparément.
La syntaxe du prédicat partiel est `WHERE "decision" = 'CONFIRMED'`, compatible avec l’enum.
Les FK RESTRICT interdisent la suppression physique des Sources, snapshots et Entity liés,
y compris pour un rejet. Archiver une Entity change son statut et reste possible ; la décision
est alors signalée invalide. Aucun retrait d’association n’efface un objet référencé.

Prisma Client n’a pas besoin d’un champ supplémentaire pour l’index partiel ou les CHECK :
ce sont des garanties PostgreSQL. Le schéma Prisma décrit les colonnes, relations, uniques et
index ordinaires ; ces contraintes complémentaires restent dans le SQL. `migrate deploy`
exécute une migration non appliquée puis enregistre son succès dans `_prisma_migrations` ;
une deuxième exécution doit l’ignorer. Le script SQL seul n’est pas idempotent et ne doit pas
être exécuté deux fois manuellement. Ne jamais modifier ce fichier après son application.
`migrate deploy` ne remplace pas un contrôle de dérive : revoir tout SQL généré ultérieurement
pour préserver les contraintes complémentaires.

Pour un retour applicatif à v0.7b, conserver les deux tables additives et leurs données est
la solution la plus simple. Pour annuler aussi le schéma sur une base de test jetable, restaurer
la sauvegarde prise avant migration, incluant `_prisma_migrations`, puis redémarrer v0.7b.
Une suppression manuelle des objets est possible dans une transaction, dans cet ordre :
table IngestionAssociationDecision, table IngestionAssociation, enum IngestionDecisionOrigin,
enum IngestionDecision. Sans CASCADE, seuls les nouveaux objets et leurs index/FK sont retirés ;
les décisions seraient perdues. Cette suppression seule ne remet pas l’historique Prisma en
cohérence : elle n’est pas une procédure de rollback déployable. Ne pas modifier cet historique
à la main ni déclarer « rolled-back » une migration appliquée avec succès.

Sur la base de test isolée, avant ouverture de l’interface v0.7c :

1. Sauvegarder données/schéma/historique Prisma et relever version PostgreSQL, UTF8 et collation.
2. Lancer le vrai `npm run prisma:deploy`, puis le relancer : un seul succès pour cette migration.
   Comparer `pg_get_indexdef`/`pg_get_constraintdef` et les colonnes aux définitions SQL ; vérifier
   les quatre FK RESTRICT, les deux uniques ordinaires, l’unique partiel et les CHECK.
   Tester aussi la recherche Unicode NFC et le plan des lectures/rejets récents.
3. Sur un second clone jetable, provoquer une erreur contrôlée avant COMMIT dans une copie du
   SQL, vérifier l’absence des deux tables/enums après rollback, puis restaurer ce clone.
   Si un deploy réel échoue, examiner `_prisma_migrations` et le schéma avant toute résolution ;
   `migrate resolve --rolled-back` ne concerne que cet échec confirmé, après vérification du rollback.
4. Tester le retour applicatif et la restauration complète de la sauvegarde sur ce clone,
   puis effectuer les scénarios métier/concurrence ci-dessous avec le vrai Prisma Client.

L’analyse présente est statique : aucune connexion, application de migration ou tentative
de rollback n’a été effectuée. L’acceptation du DDL et les erreurs du pilote restent à confirmer
par ces essais, pas par les doubles locaux.

## Transactions, idempotence et réversibilité

Chaque modification utilise une transaction Serializable et `expectedRevision` obligatoire.
Après résolution du contexte et validation de la cible non archivée, la révision est comparée
puis incrémentée conditionnellement. Une confirmation remplace atomiquement l’ancienne décision
CONFIRMED et peut remplacer un rejet de la même paire, après confirmation explicite dans l’UI.
L’ancienne association n’est pas transformée artificiellement en rejet.
Rejeter la fiche actuellement confirmée est refusé : retirer ou remplacer d’abord la confirmation.
Retirer supprime seulement CONFIRMED ; tous les rejets restent.

Répéter une confirmation identique, un rejet déjà présent ou un retrait déjà effectué est
un no-op : auteur, date, compteur de révision et lignes restent inchangés. En conflit Prisma
P2002/P2034, une seule nouvelle transaction relit l’état avec la même révision attendue : même
cible déjà confirmée → succès idempotent ; cible différente → 409, sans écrasement silencieux.
Les contraintes SQL protègent aussi contre une double confirmation concurrente.

Le modèle conserve **l’état courant**, pas un journal complet d’audit : remplacement/retrait
suppriment l’ancienne confirmation, et confirmer une fiche rejetée remplace ce rejet. Un historique
exhaustif des décisions/remplacements/retraits reste à concevoir séparément. Réversible signifie
ici pouvoir retirer ou changer la liaison sans effet sur le Codex, pas rejouer un audit.

## API, confidentialité et UX

Les routes sont décrites dans [API.md](API.md). Auth session Discord, whitelist, Origin exacte
pour toutes les écritures et la recherche POST, no-store sur succès et erreurs. GET garde les
conventions admin existantes. Les body Zod sont stricts ; auteur/date/Source/champs internes ne
peuvent être imposés par le client. 409 explicite pour concurrence, cible archivée ou identité
incompatible ; erreurs internes génériques, sans critères ni détails SQL dans les logs.

« Association au Codex » apparaît au-dessus du matching : confirmation, fiche, auteur/date,
changement/retrait, ou absence/erreur/invalidité. Une fiche devenue ARCHIVED reste identifiable
et peut être retirée ou remplacée. Le matching reste informatif et secondaire, avec rejets
annotés pour cette identité. Les actions attendent la lecture des décisions antérieures.
Les 20 rejets les plus récents sont listés, avec compte total ; tous les candidats actuels
(au plus dix UUID dans un en-tête borné) sont vérifiés séparément, même si leur rejet est ancien.
Pas de N+1 : lectures de décision groupées avec select minimal.

Le choix manuel recherche titre/slug/alias, à partir de deux caractères, debounce 320 ms,
AbortController, vingt résultats plus sonde de troncature. Recherche dans un corps POST privé,
pas d’URL avec titre/recherche. Unicode NFC, casse et espaces normalisés ; critères littéraux
paramétrés. Les fiches ARCHIVED sont exclues. La recherche relationnelle peut scanner les noms ;
la performance PostgreSQL réelle reste à mesurer, sans nouvel index plein texte ni extension.

Toutes les décisions ont une étape de confirmation explicite, avec clavier, annulation et
focus. La révision attendue est figée au moment du choix humain, même si une lecture ultérieure
observe une décision concurrente. L’arrivée des annotations de matching conserve la recherche
manuelle en cours, avec actions de suggestion désactivées tant que ces annotations sont incomplètes.
Les doubles clics sont bloqués immédiatement par un verrou en mémoire, et les boutons
restent indisponibles pendant une écriture. Un 409 exige de recharger l’association ; une erreur
réseau exige de vérifier son état avant de réessayer. Les lectures/écritures devenues inactives
sont annulées côté client ; les réponses tardives, y compris 401, sont ignorées. Une annulation
HTTP ne garantit pas l’annulation d’une transaction serveur déjà acceptée : relire l’identité
pour connaître sa décision actuelle. Changer de réception/item remonte un panneau neuf.

URL de page, history.state métier, localStorage/sessionStorage, document.title et logs ne
reçoivent aucune nouvelle donnée privée. Les liens ouvrent uniquement les fiches admin ;
aucun lien public n’est ajouté, quel que soit statut/visibilité. Aucun service externe ou IA.

## Vérification réelle après futur déploiement

Sur une **base de test isolée**, appliquer la migration après revue, puis utiliser exclusivement
des données techniques fictives : Source S, identifiant `fixture-a.md`, version 1 et deux fiches
A/B non archivées. Conserver un état complet des huit modèles existants et de leurs timestamps.

1. Confirmer A via une suggestion, répéter : même décision/date/auteur/révision, zéro mutation
   des huit modèles existants. Rejeter B et vérifier son annotation, puis changer explicitement
   vers B et retirer : aucune nouvelle Evidence/Revision, aucun changement de publication.
2. Réingérer le même contenu : même snapshot, nouveau receipt, association visible. Ajouter une
   version modifiée avec le même externalId : association visible. Changer Source/externalId :
   aucune association héritée. Sans externalId, modifier le contenu : aucun héritage du snapshot.
3. Deux sessions admin lisent la même révision, confirment A/B simultanément : une confirmation
   active, un 409. Même cible simultanée : une seule décision et succès idempotent. Vérifier
   directement l’index unique partiel et les erreurs SQL lors d’une tentative contradictoire.
   Répéter en inversant l’ordre, à identité vierge puis avec une confirmation déjà présente.
   Une insertion SQL directe contradictoire doit produire 23505 (unicité) ; le pilote Prisma
   doit exposer P2002 ou P2034 pour les courses concernées. Vérifier les transactions réelles,
   le retry unique et l’absence de changements après faute injectée avant commit/remplacement.
4. Archiver séparément A : association signalée invalide, nouvelle confirmation refusée,
   retrait/remplacement autorisés. Tester UUID absent, receipt appartenant ailleurs, 400/401/403,
   Origin absente/invalide, 409 et 500 générique avec no-store. Aucun endpoint public d’association.
5. Contrôler les cinq largeurs, clavier, doubles clics, réponses lentes, expiration, contenu long
   et Unicode ; URL/stockages/historique/titre/logs sans contenu privé. Exécuter EXPLAIN pour
   la recherche manuelle et les décisions sur une volumétrie fictive représentative.

Les tests locaux utilisent un double relationnel transactionnel et une API navigateur simulée.
Ils ne remplacent pas l’essai de migration/concurrence sur PostgreSQL, ni Firefox/Safari et
lecteurs d’écran. Aucune connexion à PostgreSQL ni migration réelle n’est nécessaire aux tests.
