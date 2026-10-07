# Création humaine d’une fiche depuis le staging — v0.7d

Le parcours v0.7d reste inchangé. Depuis v0.7e, une identité déjà CONFIRMED propose plutôt
« Préparer une mise à jour » pour sa fiche non archivée : champs actuels initiaux,
reprise explicite du staging, récapitulatif et application sur DRAFT/PROPOSED seulement.
Cette [mise à jour](STAGING-UPDATE.md) ne crée pas de nouvelle fiche ni décision d’association.

Staging → matching → décision humaine → création d’une Entity PROPOSED → revue éditoriale
→ publication humaine distincte. Aucun chargement, matching, rejet ou ingestion ne crée une fiche.

## Préparation

Sur le détail d’un item, « Créer une fiche dans le Codex » apparaît après lecture d’une
identité sans confirmation. Une confirmation existante, même devenue archivée, bloque ce
parcours et explique pourquoi ; il faut d’abord examiner/changer/retirer cette association.
L’action ouvre un formulaire en mémoire sur `/admin/ingestion`, sans navigation privée supplémentaire.
Le serveur relit précisément le receipt affiché et la révision de son identité.
La préparation reste attachée à cette réception immuable : l’arrivée d’une version suivante
ne remplace pas silencieusement son contenu et n’invalide pas à elle seule cette réception.
Une création explicite depuis l’ancienne version reste possible si l’identité n’a pas changé
de décision ; la nouvelle version hérite alors de la confirmation. Une confirmation prise
depuis n’importe quelle version bloque le formulaire ancien. Un rejet ou un retrait intervenu
depuis sa préparation rend sa révision obsolète, même si l’identité redevient sans confirmation.

Titre = titre du receipt (vide s’il manque). Résumé et alias vides ; tags repris uniquement
si metadata.tags respecte le validateur éditorial existant, sans doublons. Aucun autre champ
de metadata n’est interprété. Contenu = rawVariant si présent, sinon snapshot, exclusivement
pour text/plain ou text/markdown (comparaison de casse du MIME). Les autres formats donnent
un contenu vide avec avertissement. Pas d’extraction, IA, conversion ou interprétation sémantique.
GM par défaut, type obligatoire sans présélection et sous-type obligatoire uniquement pour PLACE.
Le slug suggéré côté interface est modifiable ; le serveur le valide sans réécriture.

Les limites éditoriales demeurent : titre 200, résumé 500, contenu/extrait 100 000 caractères,
30 alias/tags (200/100 caractères), locator Evidence 250. Un titre ou contenu reçu plus long
est conservé dans le formulaire avec avertissement et nécessite correction explicite, sans
troncature. Un locator reçu de plus de 250 caractères n’est pas prérempli dans le champ court ;
le repère original complet reste dans la trace de Revision. Aucun snapshot n’est modifié.

L’administrateur écrit un énoncé de provenance et vérifie extrait/repère. Le récapitulatif
montre les champs, contenu, provenance, statut et visibilité ; seul « Créer la fiche proposée »
déclenche l’écriture. Une visibilité PUBLIC choisie explicitement ne publie jamais la fiche.

## Transaction et traçabilité

Une seule transaction Prisma Serializable, utilisant exclusivement `tx` :

1. Résoudre item/receipt, recalculer identityKey et contrôler la compatibilité v0.7c.
2. Refuser une confirmation actuelle ; vérifier Source, slug libre et expectedRevision.
3. Réserver la révision d’association avec le même CAS que v0.7c, ou créer sa racine.
4. Réutiliser le créateur éditorial : Entity PROPOSED, publishedAt null, champs validés.
5. Réutiliser la Source existante sans création ni modification ; créer l’Evidence initiale.
   Sa visibilité est la plus restrictive entre Source et Entity : PUBLIC < PLAYERS < GM < SECRET.
   Aucun temps vidéo ou confidence n’est inventé ; ils restent null.
6. Créer Revision #1 avec entitySnapshot version 1, editorLabel serveur et message
   « Création depuis l’ingestion ». Son bloc `ingestion` conserve itemId, receiptId, sourceId,
   evidenceId, contentHash, version, locator original, observedAt et ingestedAt du receipt.
7. Créer la décision CONFIRMED, origine MANUAL, Discord ID/libellé/date serveur.

Toutes ces écritures sont annulées si Entity, Evidence, Revision, Association ou commit échoue.
Les rejets préexistants restent intacts. Source, snapshots, receipts, batches, Relations et
autres Entity ne sont jamais écrits. Aucun service éditorial n’est invoqué dans ingestion/matching.
La première Revision reste consultable même après des modifications éditoriales ultérieures.

**Aucune migration v0.7d** : la trace utilise le JSON de Revision #1 et l’association v0.7c.
Ce bloc n’est pas une nouvelle FK vers le receipt, ni une preuve automatique de véracité.
Evidence est une provenance préparée humainement ; aucun titre/texte reçu ne devient public
par ce parcours. Les API publiques et les règles de publication existantes restent identiques.

L’héritage v0.7c continue : même Source + externalId exact → fiche associée visible sur les
versions suivantes ; Source/externalId différent → aucun héritage ; sans externalId, snapshot
d’ancrage uniquement. Aucune Entity supplémentaire ni mise à jour automatique n’en résulte.
Après création, un retour au détail affiche « Fiche créée dans le Codex » et recharge association
et matching. Le bandeau de succès appartient à cette navigation ; après rechargement, la
confirmation persistante et la Revision conservent la trace.

## API et erreurs

GET `/api/admin/ingestion/items/:id/proposal?receiptId=UUID` prépare sans écrire.
POST `/api/admin/ingestion/items/:id/proposal` reçoit strictement
`{ receiptId, expectedRevision, entity, evidence: { claimText, sourceExcerpt, locator } }`.
Le validateur Entity est celui de la création manuelle ; le client ne peut fournir Source,
status, publishedAt, metadata, auteur, dates ou origine d’association. Unicode malformé/NUL refusés.
Succès 201 : seulement `{ entity: { id, slug, title, kind, placeKind, status, visibility } }`.

Session Discord/whitelist, Origin exacte sur POST, no-store sur succès et erreurs. Les lectures
suivent l’exemption Origin admin habituelle. Aucune route publique ajoutée. Erreurs :
400 INVALID_REQUEST avec champs, 401/403 accès, 404 INGESTION_ITEM_NOT_FOUND/SOURCE_NOT_FOUND,
409 ENTITY_CONFLICT/ASSOCIATION_CONFLICT/STALE_INGESTION_STATE (ou identité incompatible v0.7c),
500 générique sans détails SQL/narratifs. Les contraintes slug et association v0.7c restent la
dernière défense. P2034/P2002 d’association produisent un conflit ; aucun retry automatique
de création susceptible d’écraser une décision concurrente.

Un verrou synchrone empêche le double clic ; la même soumission répétée reçoit un conflit
si sa confirmation a déjà réussi, sans deuxième Entity ni enregistrements orphelins.
400, 413 ou conflit de slug conserve la saisie et exige un nouveau récapitulatif. Une réponse
413 vient de la limite JSON admin de 1 Mio, avant toute transaction : le formulaire permet
de réduire contenu/extrait. Cette limite porte sur les octets du JSON, notamment les
échappements, et peut être atteinte même si chaque champ respecte sa limite de caractères.
Un conflit
d’association bloque une nouvelle tentative jusqu’au retour à l’item ; une erreur réseau/500
exige aussi de vérifier cet état, car un résultat perdu peut suivre un commit réussi.
La révision est figée durant le formulaire. 401/403 effacent les données du formulaire et
transmettent l’erreur d’accès à l’administration. Lectures/écritures annulées et réponses tardives
ignorées après navigation. Une annulation HTTP ne garantit pas le rollback serveur.

Tout reste en mémoire : aucune saisie dans URL, query string, stockages, document.title ou
logs. L’historique contient uniquement les marqueurs opaques déjà employés par l’ingestion.
Retour arrière/avant ferme la préparation et relit l’item. La saisie ne survit pas à un
rechargement, à une sortie du formulaire ou à une reconnexion.

## Validation réelle future

Sur PostgreSQL **de test isolé**, avec schéma v0.7c et données techniques fictives :

1. Relever un état complet de Source, snapshots/receipts/batches, Relations et Entity existantes.
   Noter aussi les compteurs Entity/Relation/Evidence/Revision et les décisions/révisions d’identité.
   Créer depuis un item non associé : +1 Entity PROPOSED/non publiée, +1 Evidence de même Source,
   +1 Revision #1 correctement attribuée/tracée, +1 confirmation MANUAL vers exactement cette
   nouvelle Entity ; zéro nouvelle Relation. Contrôler publishedAt SQL NULL, la visibilité choisie,
   le numéro 1, le snapshot métier identique à la création manuelle et l’auteur serveur.
   Les objets relevés ne changent pas. Ouvrir la fiche et sa Revision ; faire F5, retrouver
   l’item depuis son batch et vérifier confirmation/historique persistants, sans deuxième création.
2. Vérifier la visibilité de l’Evidence avec Source SECRET/GM et choix Entity GM/PUBLIC. Aucune
   nouvelle Entity ni provenance staging dans `/api/v1`, tant qu’aucune publication humaine n’a lieu.
3. Injecter sur une copie jetable une faute à chacune des quatre écritures et avant commit :
   compteurs, contenu, décisions et révision de racine reviennent intégralement à l’état précédent.
4. Deux sessions proposent la même identité simultanément, même puis différents slugs ; inverser
   l’ordre. Une réussite au plus, conflit explicite, zéro Entity/Evidence/Revision orpheline.
   Rejouer avec une confirmation v0.7c concurrente, un rejet, un retrait/remplacement depuis
   l’ouverture du formulaire, et deux identités distinctes demandant le même slug.
5. Réingérer une version suivante avec même externalId : association héritée, zéro nouvelle
   Entity/Revision. Changer Source/externalId : aucun héritage. Tester le cas anonyme et le retrait.
   Rejouer aussi avec une nouvelle version reçue pendant la préparation de l’ancienne :
   origine toujours liée au receipt choisi, héritage correct ; une confirmation sur la nouvelle
   version avant soumission doit bloquer l’ancienne, sans nouvelle fiche.
6. Tester receipt étranger, Source absente, révision obsolète, 400/401/403/404/409/500 et Origin.
   Revoir les plans SQL, timeouts/serialization du vrai pilote et les index v0.7c inchangés.
7. Vérifier aux cinq largeurs le clavier, doubles clics, expiration, requêtes lentes, retour
   navigateur, saisie Unicode/longue, absence de fuite et publication humaine distincte.

Les tests locaux utilisent des doubles transactionnels et une API navigateur simulée : ils ne
remplacent pas PostgreSQL réel, ni Firefox/Safari, tactile ou lecteurs d’écran. Aucune base réelle
n’est contactée pendant le développement. Pas de connecteur, traitement massif ou mise à jour
d’une fiche existante dans v0.7d.
