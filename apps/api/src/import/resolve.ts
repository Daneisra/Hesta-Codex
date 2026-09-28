import type { ImportDocument, ImportRelation } from './format.js'
import type { EntityRef, ImportReader, RelationTypeRef, SourceRef } from './repository.js'
import type { ImportIssue } from './validation.js'

export interface ImportSummary {
  source: number
  entitiesNew: number
  entitiesExisting: number
  relationsNew: number
  relationsExisting: number
  errors: number
  warnings: number
}

export interface ImportReport {
  summary: ImportSummary
  issues: ImportIssue[]
  warnings: ImportIssue[]
  sourceAction: 'new' | 'reused' | null
  applied: boolean
}

export interface PlannedRelation {
  input: ImportRelation
  fromSlug: string
  toSlug: string
  type: RelationTypeRef
}

export interface ImportPlan {
  report: ImportReport
  source: SourceRef | null
  existingEntities: Map<string, EntityRef>
  relations: PlannedRelation[]
}

export function invalidReport(issues: ImportIssue[]): ImportReport {
  return {
    summary: {
      source: 0,
      entitiesNew: 0,
      entitiesExisting: 0,
      relationsNew: 0,
      relationsExisting: 0,
      errors: issues.length,
      warnings: 0,
    },
    issues,
    warnings: [],
    sourceAction: null,
    applied: false,
  }
}

export async function resolveImport(document: ImportDocument, reader: ImportReader): Promise<ImportPlan> {
  const issues: ImportIssue[] = []
  const warnings: ImportIssue[] = []
  const batchSlugs = new Set(document.entities.map((entity) => entity.slug))
  const requestedSlugs = [...new Set([
    ...batchSlugs,
    ...document.relations.flatMap((relation) => [relation.from, relation.to]),
  ])]
  const [entities, relationTypes, source] = await Promise.all([
    reader.findEntitiesBySlugs(requestedSlugs),
    reader.findRelationTypesByCodes([...new Set(document.relations.map((relation) => relation.type))]),
    document.source.externalId === null
      ? Promise.resolve(null)
      : reader.findSource(document.source.kind, document.source.externalId),
  ])
  const existingEntities = new Map(entities.map((entity) => [entity.slug, entity]))
  const typesByCode = new Map(relationTypes.map((type) => [type.code, type]))
  let entitiesExisting = 0
  for (const [index, entity] of document.entities.entries()) {
    if (existingEntities.has(entity.slug)) {
      entitiesExisting += 1
      issues.push({ path: `entities[${index}].slug`, message: 'Slug déjà présent dans la base ; mise à jour implicite refusée' })
    }
  }

  if (source && (
    source.label !== document.source.label ||
    source.url !== document.source.url ||
    source.authorLabel !== document.source.authorLabel
  )) {
    warnings.push({ path: 'source', message: 'Source existante réutilisée sans modifier ses champs descriptifs' })
  }

  const relations: PlannedRelation[] = []
  const seenEdges = new Set<string>()
  let relationsExisting = 0
  for (const [index, relation] of document.relations.entries()) {
    const base = `relations[${index}]`
    const type = typesByCode.get(relation.type)
    if (!type) issues.push({ path: `${base}.type`, message: 'RelationType inconnu ; utiliser son code direct' })
    if (!batchSlugs.has(relation.from) && !existingEntities.has(relation.from)) {
      issues.push({ path: `${base}.from`, message: 'Slug source introuvable dans le lot et dans la base' })
    }
    if (!batchSlugs.has(relation.to) && !existingEntities.has(relation.to)) {
      issues.push({ path: `${base}.to`, message: 'Slug cible introuvable dans le lot et dans la base' })
    }
    if (relation.from === relation.to) {
      issues.push({ path: `${base}.to`, message: 'Une relation vers la même fiche est interdite' })
    }

    const [fromSlug, toSlug] = type?.symmetric && relation.from > relation.to
      ? [relation.to, relation.from]
      : [relation.from, relation.to]
    const edgeKey = `${relation.type}|${fromSlug}|${toSlug}`
    if (seenEdges.has(edgeKey)) {
      issues.push({ path: base, message: 'Relation dupliquée dans ce fichier' })
      continue
    }
    seenEdges.add(edgeKey)
    if (!type || fromSlug === toSlug ||
      (!batchSlugs.has(fromSlug) && !existingEntities.has(fromSlug)) ||
      (!batchSlugs.has(toSlug) && !existingEntities.has(toSlug))) continue

    const fromId = existingEntities.get(fromSlug)?.id
    const toId = existingEntities.get(toSlug)?.id
    if (fromId && toId && await reader.findRelation(fromId, toId, type.id, type.symmetric)) {
      relationsExisting += 1
      issues.push({ path: base, message: 'Relation déjà présente dans la base ; mise à jour implicite refusée' })
      continue
    }
    relations.push({ input: relation, fromSlug, toSlug, type })
  }

  const report: ImportReport = {
    summary: {
      source: 1,
      entitiesNew: document.entities.length - entitiesExisting,
      entitiesExisting,
      relationsNew: relations.length,
      relationsExisting,
      errors: issues.length,
      warnings: warnings.length,
    },
    issues,
    warnings,
    sourceAction: source ? 'reused' : 'new',
    applied: false,
  }
  return { report, source, existingEntities, relations }
}
