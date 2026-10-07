# Mise à jour humaine d’une fiche associée — v0.7e

Staging → matching informatif → association humaine CONFIRMED → préparation → comparaison
→ application explicite → revue éditoriale. L’ingestion et le matching ne modifient aucune fiche.
Sans confirmation, utiliser la [création v0.7d](STAGING-CREATION.md).

## Parcours humain et limites éditoriales

Sur `/admin/ingestion`, « Préparer une mise à jour » apparaît uniquement pour une association
confirmée valide vers une fiche non archivée. Les huit valeurs finales commencent exactement
avec les champs de la fiche actuelle : titre, type, sous-type de lieu, résumé, Markdown, alias,
tags, visibilité. Slug, statut et publication restent immuables dans ce parcours.
Le titre, le contenu et les tags du staging sont présentés séparément, avec chacun une action
« Utiliser … du staging ». Aucun remplacement n’a lieu à l’ouverture du formulaire.

DRAFT et PROPOSED peuvent recevoir une mise à jour et conservent leur statut. PUBLISHED
peut être comparée, mais tous les contrôles d’application sont désactivés et le serveur refuse
le POST : « Cette fiche est publiée. Retirez d’abord sa publication avant d’appliquer une mise
à jour issue du staging. » Une mise à jour de staging ne doit pas modifier le canon publié à
l’insu de la revue. Le retrait/publication reste une action du workflow éditorial existant.
ARCHIVED est refusée dès la préparation, sans action proposée sur l’association.

Le receipt exact affiché est épinglé : rawVariant si présente, sinon contenu du snapshot.
Seuls text/plain et text/markdown (MIME insensible à la casse) peuvent être repris via le
bouton de contenu et l’extrait prérempli. Un autre MIME reste consultable avec avertissement ;
le contenu actuel de la fiche est conservé et une rédaction manuelle reste possible.
Les tags de metadata sont disponibles uniquement s’ils respectent les règles éditoriales ;
une liste vide valide peut explicitement effacer les tags actuels. Aucune autre metadata n’est interprétée.

Limites existantes : titre 200, résumé 500, contenu/extrait 100 000 caractères, 30 alias/tags
de 200/100 caractères, locator Evidence 250. Les valeurs reçues trop longues sont affichées
intégralement avec avertissement, sans troncature ; elles doivent être adaptées manuellement.
Un extrait inadmissible et un locator trop long ne sont pas préremplis dans la preuve.
Le locator original complet reste dans la trace de Revision. Le Markdown et l’extrait/locator
de cette mise à jour préservent exactement Unicode, espaces de bord et fins de ligne. Le titre,
résumé, alias/tags et énoncé suivent les règles éditoriales existantes de trim/validation ; aucun
texte n’est normalisé ou traduit. PLACE exige un sous-type ; les autres types exigent null.

« Vérifier la mise à jour » ne fait aucune écriture. Le second écran montre cible, statut,
visibilité finale, Source, version et repère ; il distingue champs inchangés et modifiés, avec
Avant/Après pour chaque changement, notamment le Markdown. Aucun moteur de fusion ni
dépendance de diff supplémentaire. Les tableaux montrent leurs éléments et leur ordre en JSON ;
les valeurs nulles et les textes vides portent un indicateur distinct du contenu reçu.
« Corriger » conserve les valeurs. Seul « Appliquer la mise à jour » envoie le POST.
Si les huit champs éditoriaux sont identiques, le bouton est
désactivé et l’API refuse avec 422 NO_CHANGES : zéro écriture, même si la provenance change.

## Contrat admin

`GET /api/admin/ingestion/items/:id/update-proposal?receiptId=UUID` : lecture seulement,
transaction RepeatableRead. Retourne receiptId, version, contentHash, expectedAssociationRevision,
expectedEntityUpdatedAt, alreadyApplied, Entity actuelle (huit champs, id, slug, statut et publishedAt),
Source (id, label, kind, visibilité), staging exploitable et preuve proposée, avertissements.
Le receipt doit appartenir précisément à l’item ; aucun choix par titre, locator ou score.

`POST /api/admin/ingestion/items/:id/update-proposal` : requête stricte, sans query :

```json
{
  "receiptId": "UUID",
  "targetEntityId": "UUID",
  "expectedAssociationRevision": 7,
  "expectedEntityUpdatedAt": "2026-10-06T10:00:00.000Z",
  "entity": {
    "title": "Titre choisi", "kind": "PERSON", "placeKind": null,
    "summary": null, "bodyMarkdown": "Texte choisi", "aliases": [],
    "tags": [], "visibility": "GM"
  },
  "evidence": { "claimText": "Énoncé humain", "sourceExcerpt": "Extrait exact", "locator": "repère" }
}
```

Les marqueurs attendus proviennent du GET, sans incrément côté client. entity contient
exactement les huit champs ; evidence accepte seulement claimText et extrait/locator nullable.
Aucun editorLabel, Source, Evidence UUID, hash/version, statut, slug ou timestamp interne client.
Succès 200 : Entity minimale d’association, updatedAt et revisionNumber. Le staging est inchangé.

Session Discord et whitelist admin, Origin exacte obligatoire pour POST, no-store pour toutes
les réponses admin, JSON limité à 1 MiB et validation Zod stricte avant toute transaction.
400 INVALID_REQUEST : contexte/champs invalides. 401/403 : accès. 404 :
INGESTION_ITEM_NOT_FOUND, ENTITY_NOT_FOUND ou SOURCE_NOT_FOUND. 409 : ASSOCIATION_REQUIRED,
INCOMPATIBLE_IDENTITY, ASSOCIATION_MODIFIED, ASSOCIATION_TARGET_CHANGED, ENTITY_MODIFIED,
INVALID_STATUS, RECEIPT_ALREADY_APPLIED ou STALE_INGESTION_STATE. 422 NO_CHANGES.
413 : requête trop volumineuse. 500 : erreur générique ; journal serveur constant sans SQL ni récit.

400/422/413 gardent la saisie et exigent une nouvelle vérification après correction.
404/409 bloquent le formulaire ancien : revenir à l’item, recharger et comparer. 500/erreur
réseau sont traitées comme un résultat non confirmé : examiner fiche et historique avant toute
nouvelle tentative, sans retry automatique. 401/403 effacent la préparation et ses erreurs privées.
Une référence synchrone bloque immédiatement les doubles clics. Les requêtes sont annulées
sur navigation/changement d’item ; les réponses tardives ne réinstallent ni brouillon ni succès.

## Transaction, concurrence et idempotence

Un unique `$transaction` Serializable utilise exclusivement son client `tx` :

1. Relire le receipt/item exact et recalculer l’identité ; vérifier la compatibilité de la racine.
2. Exiger sa révision attendue et verrouiller cette racine **en lecture** via SELECT FOR SHARE
   paramétré par UUID/révision. Les mutations v0.7c de confirmation passent par le CAS de cette
   même racine : elles attendent la fin de l’application, ou provoquent un conflit de sérialisation.
   Ce verrou ne modifie aucune ligne et n’incrémente pas la révision d’association.
3. Relire CONFIRMED et son Entity ; comparer targetEntityId, statut et updatedAt attendu ;
   relire Source et contenu du receipt. Vérifier absence d’application antérieure et changement réel.
4. Mettre à jour uniquement les huit champs et updatedAt, avec CAS sur id + statut + updatedAt
   actuel. La date progresse même si deux écritures tombent dans la même milliseconde.
5. Créer une Evidence sur la Source existante, entityId cible, relationId null. Visibilité = le
   plus restrictif de Source actuelle et Entity finale (PUBLIC < PLAYERS < GM < SECRET).
   Énoncé/extrait/repère validés ; confiance et timestamps vidéo null, aucune date inventée.
6. Créer une Revision max(numéro existant) + 1, snapshot standard version 1 **après** modification,
   attribution admin résolue depuis la session, message « Mise à jour depuis l’ingestion ».

Le snapshot privé ajoute :

```text
ingestion: { action: "UPDATE", itemId, receiptId, sourceId, evidenceId,
             contentHash, version, locator, observedAt, ingestedAt }
```

Tous ces champs proviennent des lectures serveur, sauf l’action constante. Ils référencent
l’origine exacte, pas les corrections du locator Evidence ni une nouvelle version arrivée ensuite.
observedAt absent reste null. Source, anciennes preuves/révisions, staging, Relation/RelationType,
autres fiches, racine et décisions d’association (auteur/date/révision inclus) restent strictement intacts.
L’échec d’une preuve, révision, CAS ou commit annule toutes les écritures.
P2002/P2034 deviennent 409 STALE_INGESTION_STATE sans retry automatique ni last-write-wins.

Une paire **(Entity UUID, receipt UUID, action UPDATE)** ne peut être appliquée qu’une fois.
Une recherche dans les snapshots JSON de Revision détecte une application réussie. Un retry
ancien reçoit 409 ENTITY_MODIFIED ; une préparation fraîche indique alreadyApplied et son POST
reçoit 409 RECEIPT_ALREADY_APPLIED. Aucun doublon silencieux. La trace CREATE historique v0.7d,
sans action UPDATE, ne bloque pas une première mise à jour volontaire depuis le même receipt.
Une nouvelle réception UUID peut être appliquée après nouvelle revue ; réassocier humainement
l’identité à une autre Entity permet une application à cette autre cible.
Les transactions concurrentes sur une même Entity se départagent par CAS/sérialisation, même
avec des receipts différents : une seule ancienne préparation gagne. Le numéro unique existant
de Revision complète cette protection. Aucun nouveau schéma/index/table de brouillon ni migration.
La recherche JSON seule n’est pas une contrainte d’unicité SQL. La garantie exige ce protocole
transactionnel, une date Entity monotone pour chaque mutation et des Revision conservées.
Une écriture SQL tierce qui rétablit une ancienne date ou supprime les traces sort de cette
garantie ; les autres parcours applicatifs utilisent le même CAS et conservent l’historique.
La trace JSON est une référence documentaire, sans nouvelle clé étrangère vers les receipts ;
son analyse n’a pas d’index dédié et peut nécessiter optimisation pour un historique très volumineux.

## Confidentialité et validation locale

Aucune route publique nouvelle, aucun staging dans les projections publiques, aucune Source,
Evidence ou Revision publique. La fiche reste invisible sauf PUBLISHED + PUBLIC ; v0.7e ne publie pas.
Le texte est affiché comme texte React, sans exécution de HTML, chargement d’image ni interprétation
Markdown externe dans le comparatif. Le brouillon reste en mémoire et se perd à F5/navigation.
Après application, le détail admin rend le Markdown sans charger ses images : leur description
reste du texte, même si leur URL vise une ressource externe ou une route admin. Les liens restent
des actions explicites de l’administrateur ; le contenu publié conserve son rendu public existant.
URL admin : seulement UUID opaques item/receipt ; pas de titre/recherche/contenu privé dans URL,
storage, history.state, document.title ou logs. Aucun appel externe, IA, tracking ou connecteur.

Tests API et web sur doubles en mémoire : compteurs/objets avant-après, rollback, validation,
statuts, visibilité, stale preparations, retries et concurrence simulée, erreurs et cycle UI.
Le navigateur local utilise des fixtures fictives et l’application construite, sans base ni
OAuth réel. Contrôle clavier et absence de débordement global à 320, 390, 768, 1280 et 1800 px.
Ces contrôles ne prouvent pas les verrous/contraintes du moteur PostgreSQL : la procédure ci-dessous
reste à réaliser après un futur déploiement autorisé. Aucun accès réel effectué pendant ce développement.

Seconde revue adversariale locale du 7 octobre 2026 : **524 tests réussis = 284 API + 240 web**,
dont 50 API et 33 web ajoutés depuis v0.7d (441 tests). Douze tests API et deux tests web ont été
ajoutés pendant cette seconde revue : courses ordonnées avant CAS/verrou, pannes après écritures,
reconfirmation/cible autoritaire, receipts distincts, no-op exact, provenance vide/null,
projections publiques avant/après et contrat historique v0.7d ; comparaison non ambiguë et
images Markdown admin inertes. Les tests existants couvrent aussi le retrait des anciens succès
à la nouvelle préparation et le focus de son erreur. Lint, typecheck, build, Prisma validate/generate et
contrôle de whitespace passent. Edge headless : cinq largeurs contrôlées, comparaison/adoption,
parcours Tab de tous les contrôles et confirmation clavier, PUBLISHED/ARCHIVED,
erreurs 400/401/403/404/409/413/422/500, double clic, navigation/réponse tardive,
preuve/historique et F5 des créations/mises à jour sur serveur fictif. Le dernier parcours a
effectué 647 requêtes localhost : zéro exception JavaScript, zéro requête de page externe et
aucun chargement d’image Markdown admin. Scripts, captures et profils temporaires supprimés.
Aucun test de lecteur d’écran, Firefox/Safari ou PostgreSQL réel.

## Procédure PostgreSQL future — à ne pas exécuter ici

Recompter et capturer les objets avant de commencer sur la fixture technique existante : Entity
`fiche-fictive-v0-7d`, Source « Coffre fictif de test », externalId
`tests/v0.7d-creation-proposal.md`, confirmation MANUAL/CONFIRMED. Sa version staging 2 existe
déjà et hérite de l’association. Les compteurs fournis sont une référence attendue à vérifier,
pas des valeurs lues pendant le développement : Entity 11, Relation 7, Evidence 19, Revision 20,
Association 2, Decision 2. Capturer Source/staging et la confirmation complète, notamment sa révision,
son auteur/date ; vérifier que la dernière révision de cette fiche est #1 avant d’attendre #2.

A. Préparer précisément le receipt de version 2 : tous les compteurs et objets restent identiques.

B. Modifier volontairement résumé et/ou bodyMarkdown ; les autres champs restent ceux de la fiche.

C. Vérifier Avant/Après, Source, version, repère, statut et visibilité avant le clic final.

D. Appliquer : Entity 11, Relation 7, Evidence **20**, Revision **21**, Association 2, Decision 2.
Même slug `fiche-fictive-v0-7d`, PROPOSED, GM, publishedAt NULL. Revision **#2** contient le snapshot
après modification et ingestion.action UPDATE, version 2, receipt/hash/Source/Evidence exacts.
Nouvelle Evidence sur « Coffre fictif de test ». Anciennes preuves/révisions, Source, staging,
relations et association complète strictement inchangés. Si l’état initial a évolué, utiliser
ses nouveaux compteurs et max(révision)+1, sans tenter de rétablir artificiellement les chiffres.

E. F5 et relire la fiche, ses preuves et son historique : la modification persiste.

F. Retenter le même receipt (requête ancienne puis préparation fraîche) : conflit sûr ; aucun
nouvel enregistrement Evidence/Revision, déjà-appliqué visible dans la préparation fraîche.

G. Vérifier l’absence de la fiche dans bibliothèque/graphe et APIs publiques.

H. Ouvrir deux préparations fraîches d’un **receipt non encore appliqué** dans deux sessions.
Éditer la fiche dans la première (workflow éditorial ou application de ce nouveau receipt) ;
appliquer l’ancienne préparation de la seconde : 409 et aucun écrasement ni preuve/révision orpheline.

Compléter avec une confirmation retirée/remplacée pendant préparation, une publication concurrente,
deux applications simultanées du même receipt et de deux receipts distincts vers la même Entity,
et des échecs contrôlés Evidence/Revision/commit dans une base technique dédiée : une seule
application complète ou rollback, aucune mutation d’association. Vérifier réellement l’attente
FOR SHARE contre le CAS v0.7c et la traduction de P2034, puis les réponses no-store et la projection
publique. Ne pas injecter de panne dans la production ni appliquer une migration pour cette version.

## Hors périmètre

Pas d’édition staging, brouillon parallèle publié, mise à jour PUBLISHED, synchronisation,
fusion automatique, résolution automatique de conflit, batch update, extraction/édition de
relations, auto-acceptation du matching, IA/embeddings/recherche sémantique, connecteurs ou
journal exhaustif des décisions. Revue humaine et publication explicite restent indispensables.
