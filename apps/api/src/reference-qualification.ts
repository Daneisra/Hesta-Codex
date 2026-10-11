import { randomUUID } from 'node:crypto'
import type { ObsidianReferences, QualificationEntity, QualificationFilters, QualificationResponse,
  QualificationRow, ReferenceIgnoreRequest, ReferenceQualification } from '@hesta-codex/shared'
import type { Prisma, PrismaClient } from './prisma-client/client.ts'
import { EditorialError } from './admin/editorial.js'
import { buildReferenceCatalog, loadReferenceSnapshot } from './obsidian-references.js'

export interface IgnoreDecision {
  fromEntityId: string; toEntityId: string; fingerprint: string; revision: string
  authorLabel: string; decidedAt: Date
}
type PairRelation = QualificationRow['relations'][number]
type Catalog = ReturnType<typeof buildReferenceCatalog>
const pair = (from: string, to: string) => JSON.stringify([from, to])
const unorderedPair = (from: string, to: string) => pair(...[from, to].sort() as [string, string])
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const searchKey = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** A single directed row per resolved UUID pair; semantics remain exclusively in Relation. */
export function qualificationRows(catalog: Catalog, relations: PairRelation[], decisions: IgnoreDecision[],
  sources: Array<{ id: string; label: string }>): QualificationRow[] {
  const sourceById = new Map(sources.map(source => [source.id, source.label]))
  const decisionByPair = new Map(decisions.map(decision => [pair(decision.fromEntityId, decision.toEntityId), decision]))
  const relationByPair = new Map<string, PairRelation[]>()
  for (const relation of relations) {
    const key = unorderedPair(relation.fromEntityId, relation.toEntityId), list = relationByPair.get(key) ?? []
    list.push(relation); relationByPair.set(key, list)
  }
  const entity = (id: string): QualificationEntity => {
    const row = catalog.entities.get(id)!
    return { id, slug: row.slug, title: row.title, kind: row.kind ?? 'OTHER',
      status: row.status as QualificationEntity['status'], visibility: row.visibility as QualificationEntity['visibility'] }
  }
  return catalog.graph().edges.map(edge => {
    const fingerprint = catalog.fingerprints.get(edge.id)!, decision = decisionByPair.get(pair(edge.source, edge.target))
    const existing = relationByPair.get(unorderedPair(edge.source, edge.target)) ?? []
    const origins = [...new Map((catalog.contexts.get(edge.source) ?? []).map(origin => [pair(origin.sourceId, origin.path),
      { sourceId: origin.sourceId, sourceLabel: sourceById.get(origin.sourceId) ?? 'Source indisponible', path: origin.path }])).values()]
      .sort((a, b) => compare(pair(a.sourceId, a.path), pair(b.sourceId, b.path)))
    return { id: edge.id, from: entity(edge.source), to: entity(edge.target), occurrences: edge.occurrences!, origins,
      relations: existing, fingerprint, decisionRevision: decision?.revision ?? null,
      state: existing.length ? 'QUALIFIED' : decision?.fingerprint === fingerprint ? 'IGNORED' : 'PENDING',
      stale: !!decision && decision.fingerprint !== fingerprint,
      ignoredAt: decision?.decidedAt.toISOString() ?? null, ignoredBy: decision?.authorLabel ?? null }
  })
}

export function qualificationPage(catalog: Catalog, rows: QualificationRow[], filters: QualificationFilters,
  sources: Array<{ id: string; label: string }>): QualificationResponse {
  const counts = { PENDING: 0, QUALIFIED: 0, IGNORED: 0, total: rows.length }
  for (const row of rows) counts[row.state]++
  const entities = [...catalog.entities.values()].map(row => ({ id: row.id, slug: row.slug, title: row.title,
    kind: row.kind ?? 'OTHER', status: row.status as QualificationEntity['status'], visibility: row.visibility as QualificationEntity['visibility'] }))
    .sort((a, b) => compare(a.slug, b.slug))
  const q = searchKey(filters.q ?? '')
  const matchesEntity = (id: string) => {
    const entity = catalog.entities.get(id)!
    return [entity.title, entity.slug, ...entity.aliases].some(value => searchKey(value).includes(q))
  }
  const selected = rows.filter(row => (!filters.state || row.state === filters.state) &&
    (!q || matchesEntity(row.from.id) || matchesEntity(row.to.id)) &&
    (!filters.kind || row.from.kind === filters.kind || row.to.kind === filters.kind) &&
    (!filters.sourceId || row.origins.some(origin => origin.sourceId === filters.sourceId)) &&
    (!filters.entityId || (filters.direction === 'incoming' ? row.to.id === filters.entityId :
      filters.direction === 'outgoing' ? row.from.id === filters.entityId : row.from.id === filters.entityId || row.to.id === filters.entityId)))
  const stateOrder = { PENDING: 0, QUALIFIED: 1, IGNORED: 2 }
  selected.sort((a, b) => (filters.sort === 'name' ? compare(searchKey(a.from.title), searchKey(b.from.title)) ||
    compare(searchKey(a.to.title), searchKey(b.to.title)) : filters.sort === 'state' ? stateOrder[a.state] - stateOrder[b.state] :
    b.occurrences - a.occurrences) || compare(a.id, b.id))
  const diagnostics: QualificationResponse['diagnostics'] = [], diagnosticCounts: Record<string, number> = {}
  for (const entity of entities) {
    for (const diagnostic of catalog.diagnostics(entity.id)) {
      diagnosticCounts[diagnostic.status] = (diagnosticCounts[diagnostic.status] ?? 0) + 1
      if ((!q || matchesEntity(entity.id) || searchKey(diagnostic.target).includes(q)) &&
        (!filters.kind || entity.kind === filters.kind) && (!filters.entityId || entity.id === filters.entityId) &&
        (!filters.sourceId || catalog.contexts.get(entity.id)?.some(origin => origin.sourceId === filters.sourceId))) {
        diagnostics.push({ ...diagnostic, entity })
      }
    }
  }
  const pageSize = 50, total = filters.view === 'diagnostics' ? diagnostics.length : selected.length
  const page = Math.min(filters.page, Math.max(1, Math.ceil(total / pageSize))), offset = (page - 1) * pageSize
  return { items: filters.view === 'diagnostics' ? [] : selected.slice(offset, offset + pageSize),
    diagnostics: filters.view === 'diagnostics' ? diagnostics.slice(offset, offset + pageSize) : [],
    total, page, pageSize, counts, sources, entities, diagnosticCounts, diagnosticTotal: diagnostics.length }
}

export interface QualificationService {
  list(filters: QualificationFilters): Promise<QualificationResponse>
  detail(id: string, updatedAt: string): Promise<ObsidianReferences | undefined>
  decide(input: ReferenceIgnoreRequest, actor: { discordId: string; label: string }): Promise<void>
}

export function createPrismaQualificationService(prisma: PrismaClient): QualificationService {
  async function snapshot(tx: Prisma.TransactionClient) {
    const raw = await loadReferenceSnapshot(tx), catalog = buildReferenceCatalog(raw.entities, raw.origins)
    const sourceIds = [...new Set(raw.origins.map(origin => origin.sourceId))]
    const [relations, decisions, sources] = await Promise.all([
      tx.relation.findMany({ select: { id: true, fromEntityId: true, toEntityId: true, status: true, visibility: true,
        relationType: { select: { id: true, code: true, label: true, inverseCode: true, inverseLabel: true, symmetric: true } } },
        orderBy: { id: 'asc' }, take: 50_001 }),
      tx.obsidianReferenceIgnore.findMany({ orderBy: [{ fromEntityId: 'asc' }, { toEntityId: 'asc' }], take: 100_001 }),
      tx.source.findMany({ where: { id: { in: sourceIds } }, select: { id: true, label: true }, orderBy: { id: 'asc' } }),
    ])
    if (relations.length > 50_000 || decisions.length > 100_000) {
      throw new EditorialError(503, 'REFERENCES_LIMIT', 'Catalogue éditorial trop volumineux pour cette vue.')
    }
    return { catalog, rows: qualificationRows(catalog, relations, decisions, sources), sources }
  }
  const read = <T>(project: (data: Awaited<ReturnType<typeof snapshot>>) => T) => prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
    return project(await snapshot(tx))
  }, { isolationLevel: 'RepeatableRead', timeout: 20_000 })
  return {
    list: filters => read(({ catalog, rows, sources }) => qualificationPage(catalog, rows, filters, sources)),
    detail: (id, updatedAt) => read(({ catalog, rows }) => {
      const detail = catalog.detail(id, updatedAt)
      if (!detail) return undefined
      const byPair = new Map(rows.map(row => [pair(row.from.id, row.to.id), row]))
      const qualify = (from: string, to: string): ReferenceQualification | undefined => {
        const row = byPair.get(pair(from, to))
        return row && { state: row.state, fingerprint: row.fingerprint, decisionRevision: row.decisionRevision,
          stale: row.stale, ignoredAt: row.ignoredAt, ignoredBy: row.ignoredBy }
      }
      return { ...detail, outgoing: detail.outgoing.map(item => ({ ...item, qualification: qualify(id, item.id) })),
        incoming: detail.incoming.map(item => ({ ...item, qualification: qualify(item.id, id) })) }
    }),
    async decide(input, actor) {
      try {
        await prisma.$transaction(async tx => {
          const { rows } = await snapshot(tx)
          const row = rows.find(row => row.from.id === input.fromEntityId && row.to.id === input.toEntityId)
          if (!row || row.fingerprint !== input.fingerprint || row.decisionRevision !== input.expectedDecisionRevision) {
            throw new EditorialError(409, 'REFERENCE_MODIFIED', 'Référence ou décision modifiée. Actualisez avant de réessayer.')
          }
          const where = { fromEntityId_toEntityId: { fromEntityId: input.fromEntityId, toEntityId: input.toEntityId } }
          if (input.ignore) {
            if (row.state === 'QUALIFIED') throw new EditorialError(409, 'REFERENCE_QUALIFIED', 'Une relation éditoriale existe déjà.')
            const data = { fingerprint: input.fingerprint, revision: randomUUID(), authorDiscordId: actor.discordId,
              authorLabel: actor.label, decidedAt: new Date() }
            await tx.obsidianReferenceIgnore.upsert({ where, create: { ...where.fromEntityId_toEntityId, ...data }, update: data })
          } else if (row.decisionRevision) await tx.obsidianReferenceIgnore.delete({ where })
        }, { isolationLevel: 'Serializable', timeout: 20_000 })
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && ['P2034', 'P2002', 'P2003', 'P2025'].includes(String(error.code))) {
          throw new EditorialError(409, 'REFERENCE_MODIFIED', 'Décision concurrente. Actualisez avant de réessayer.')
        }
        throw error
      }
    },
  }
}
