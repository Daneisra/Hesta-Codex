# Modèle de données à définir

Ce document garde les décisions de domaine pour le prochain jalon. Le schéma Prisma v0.1
ne crée aucune table et `prisma/migrations/` ne contient aucune migration métier.

## Principes

- Les fiches et leurs relations auront des identifiants UUID stables. Le nom ne sera jamais un identifiant.
- Le texte narratif sera en Markdown ; les faits et relations interrogeables seront structurés.
- Une information importée ou produite par IA arrivera comme proposition, sans devenir canon automatiquement.
- Les informations externes garderont leur provenance. Les accès aux contenus non publics seront filtrés dans l’API.
- Le Codex gardera le lore durable. Les coordonnées et le rendu restent dans Carte Hesta ; les règles d’armure restent dans Système PA.

## Modèles prévus

| Modèle | Rôle prévu | Points à préciser avant migration |
| --- | --- | --- |
| `Entity` | Fiche de connaissance avec UUID, slug, type, statut, visibilité et contenu Markdown | Types, sous-types, unicité du slug, alias, tags, métadonnées, dates Hesta |
| `Relation` | Lien explicite entre deux entités | Catalogue des types, orientation, symétrie, dates, statut et visibilité |
| `Source` | Origine manuelle ou externe d’une information | Types de sources, identifiants externes, URL et métadonnées |
| `Evidence` | Justification d’une entité ou relation par une source | Cardinalités, citation, horodatage et niveau de confiance |
| `Revision` | Historique éditorial, en particulier pour le canon | Snapshot, numérotation, auteur et restauration |
| `User` | Identité et permissions futures | Rôles, lien éventuel avec Discord et politique de visibilité |

La structure détaillée de ces modèles sera arrêtée avant la première migration. Aucun accès
aux données métier, aucune authentification et aucun import ne sont présents en v0.1.

Référence : `Hesta-Hub/docs/HESTA-CODEX-ARCHITECTURE.md` dans le dépôt voisin.

