import type { EntityKind, RelationTypeItem } from './index.js'

export const relationCategories = [
  { code: 'geography', label: 'Géographie et territoires' },
  { code: 'family', label: 'Personnages et familles' },
  { code: 'organization', label: 'Organisations et institutions' },
  { code: 'politics', label: 'Politique et conflits' },
  { code: 'religion', label: 'Religion et divinités' },
  { code: 'history', label: 'Histoire et événements' },
  { code: 'artifact', label: 'Artefacts et objets' },
] as const
type Category = typeof relationCategories[number]['code']
export interface RelationDefinition extends Omit<RelationTypeItem, 'id'> {
  category: Category
  usualFrom: readonly EntityKind[]
  usualTo: readonly EntityKind[]
}
const individuals = ['PERSON', 'CREATURE', 'DEITY'] as const
const actors = [...individuals, 'ORGANIZATION', 'FAMILY', 'SPECIES', 'RELIGION'] as const
const powers = [...actors, 'PLACE'] as const
const events = ['EVENT', 'QUEST', 'SESSION'] as const
const places = ['PLACE'] as const
const institutions = ['ORGANIZATION', 'FAMILY', 'RELIGION'] as const
const definition = (category: Category, code: string, label: string, inverseCode: string | null,
  inverseLabel: string | null, usualFrom: readonly EntityKind[], usualTo: readonly EntityKind[]): RelationDefinition =>
  ({ category, code, label, inverseCode, inverseLabel, symmetric: inverseCode === null, usualFrom, usualTo })

/** Editorial vocabulary only, never facts or EntityKind restrictions. Order is intentional. */
export const relationCatalog: readonly RelationDefinition[] = [
  definition('geography', 'located_in', 'situé dans', 'contains', 'contient', [], places),
  definition('geography', 'capital_of', 'est la capitale de', 'has_capital', 'a pour capitale', places, places),
  definition('geography', 'borders', 'est frontalier de', null, null, places, places),
  definition('geography', 'inhabits', 'habite dans', 'inhabited_by', 'est habité par', actors, places),
  definition('geography', 'originates_from', 'est originaire de', 'origin_of', "est le lieu d’origine de", [...actors, 'ARTIFACT', 'CONCEPT'], places),
  definition('family', 'parent_of', 'parent de', 'child_of', 'enfant de', individuals, individuals),
  definition('family', 'sibling_of', 'frère ou sœur de', null, null, individuals, individuals),
  definition('family', 'spouse_of', 'conjoint de', null, null, individuals, individuals),
  definition('family', 'descendant_of', 'descendant de', 'ancestor_of', 'ancêtre de', [...individuals, 'FAMILY'], [...individuals, 'FAMILY']),
  definition('family', 'mentor_of', 'mentor de', 'mentored_by', 'a pour mentor', individuals, individuals),
  definition('organization', 'member_of', 'membre de', 'has_member', 'compte parmi ses membres', actors, institutions),
  definition('organization', 'leads', 'dirige', 'led_by', 'est dirigé par', actors, institutions),
  definition('organization', 'founded', 'a fondé', 'founded_by', 'a été fondé par', actors, [...institutions, 'PLACE']),
  definition('organization', 'collaborates_with', 'collabore avec', null, null, actors, actors),
  definition('organization', 'works_for', 'travaille pour', 'employs', 'emploie', actors, actors),
  definition('politics', 'allied_with', 'allié à', null, null, powers, powers),
  definition('politics', 'rules_over', 'gouverne', 'ruled_by', 'est gouverné par', powers, [...institutions, 'PLACE']),
  definition('politics', 'vassal_of', 'vassal de', 'overlord_of', 'suzerain de', powers, powers),
  definition('politics', 'enemy_of', 'ennemi de', null, null, powers, powers),
  definition('politics', 'rival_of', 'rival de', null, null, powers, powers),
  definition('politics', 'protects', 'protège', 'protected_by', 'est protégé par', actors, [...powers, 'ARTIFACT']),
  definition('religion', 'worships', 'vénère', 'worshipped_by', 'est vénéré par', actors, ['DEITY']),
  definition('religion', 'patron_deity_of', 'est la divinité protectrice de', 'has_patron_deity', 'a pour divinité protectrice', ['DEITY'], powers),
  definition('history', 'participated_in', 'a participé à', 'had_participant', 'a eu pour participant', powers, events),
  definition('history', 'precedes', 'précède', 'follows', 'suit chronologiquement', events, events),
  definition('history', 'caused', 'a provoqué', 'caused_by', 'a été provoqué par', [], events),
  definition('history', 'can_become', 'peut devenir', 'possible_transformation_of', 'est une transformation possible de', actors, [...actors, 'CONCEPT']),
  definition('history', 'seeks', 'recherche', 'sought_by', 'est recherché par', actors, []),
  definition('artifact', 'created', 'a créé', 'created_by', 'a été créé par', actors, ['ARTIFACT', 'PLACE', 'ORGANIZATION', 'CREATURE', 'SPECIES', 'CONCEPT']),
  definition('artifact', 'covets', 'convoite', 'coveted_by', 'est convoité par', actors, ['ARTIFACT', 'PLACE', 'CONCEPT']),
  definition('artifact', 'owns', 'possède', 'owned_by', 'appartient à', actors, ['ARTIFACT', 'PLACE']),
  definition('artifact', 'holds', 'détient', 'held_by', 'est détenu par', actors, ['ARTIFACT']),
  definition('artifact', 'uses', 'utilise', 'used_by', 'est utilisé par', actors, ['ARTIFACT']),
  definition('artifact', 'previously_owned', 'a possédé', 'previously_owned_by', 'a appartenu à', actors, ['ARTIFACT', 'PLACE']),
  definition('artifact', 'previously_used', 'a utilisé', 'previously_used_by', 'a été utilisé par', actors, ['ARTIFACT']),
]

export const originalRelationCodes = ['located_in', 'member_of', 'parent_of', 'allied_with'] as const
/** The seed and migration tests use exactly the five existing RelationType properties. */
export const relationTypeDefinitions = relationCatalog.map(({ code, label, inverseCode, inverseLabel, symmetric }) =>
  ({ code, label, inverseCode, inverseLabel, symmetric }))

/** Group only types actually returned by the API. Preserve custom types and database labels/UUIDs. */
export function groupRelationTypes(types: readonly RelationTypeItem[]) {
  const byCode = new Map(relationCatalog.map((item, index) => [item.code, { item, index }]))
  const groups = [...relationCategories, { code: 'other', label: 'Autres relations' }]
  return groups.map(category => ({ ...category, types: types.filter(type =>
    (byCode.get(type.code)?.item.category ?? 'other') === category.code).sort((a, b) =>
      (byCode.get(a.code)?.index ?? Infinity) - (byCode.get(b.code)?.index ?? Infinity) ||
      (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)) })).filter(group => group.types.length > 0)
}

const kindLabels: Record<EntityKind, string> = { PERSON: 'personnage', PLACE: 'lieu', ORGANIZATION: 'organisation',
  FAMILY: 'famille', RELIGION: 'religion', DEITY: 'divinité', SPECIES: 'peuple ou espèce', CREATURE: 'créature',
  ARTIFACT: 'artefact', EVENT: 'événement', QUEST: 'quête', SESSION: 'session', CONCEPT: 'concept', OTHER: 'autre' }

/** Advisory only; inverse choices use inverse expectations. Unknown/OTHER kinds are left to the editor. */
export function relationKindWarning(code: string, from: EntityKind, to: EntityKind): string | null {
  const type = relationCatalog.find(item => item.code === code || item.inverseCode === code)
  if (!type || from === 'OTHER' || to === 'OTHER') return null
  const inverse = code === type.inverseCode
  const expectedFrom = inverse ? type.usualTo : type.usualFrom, expectedTo = inverse ? type.usualFrom : type.usualTo
  const accepts = (expected: readonly EntityKind[], actual: EntityKind) => !expected.length || expected.includes(actual)
  const normal = accepts(expectedFrom, from) && accepts(expectedTo, to)
  if (normal || (type.symmetric && accepts(expectedFrom, to) && accepts(expectedTo, from))) return null
  const label = inverse ? type.inverseLabel : type.label
  const kinds = (values: readonly EntityKind[]) => values.length ? values.map(kind => kindLabels[kind]).join(', ') : 'toute catégorie'
  return `Association inhabituelle : « ${label} » concerne habituellement ${kinds(expectedFrom)} → ${kinds(expectedTo)}. Vérifiez les catégories et le sens. Ce choix reste autorisé, notamment pour les situations surnaturelles.`
}
