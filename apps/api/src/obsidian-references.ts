import {
  markdownHeadings, markdownTree, obsidianLinkIndex, resolveObsidianPath, wikiKey, wikiOccurrences,
  type ObsidianGraphEdge, type ObsidianReferences, type ReferenceConnection, type ReferenceStats,
  type WikiNavigation, type WikiOccurrence, type WikiStatus,
} from '@hesta-codex/shared'
import { createHash } from 'node:crypto'
import type { EntityKind } from '@hesta-codex/shared'
import type { Prisma, PrismaClient } from './prisma-client/client.ts'
import { EditorialError } from './admin/editorial.js'

export interface ReferenceEntity {
  id: string; slug: string; title: string; aliases: string[]; bodyMarkdown: string
  status: string; visibility: string; updatedAt: Date
  kind?: EntityKind
}
export interface ReferenceOrigin { sourceId: string; path: string; entityId: string; metadata: unknown }
export interface ReferenceService {
  navigation(id: string, updatedAt: string): Promise<WikiNavigation | undefined>
  detail(id: string, updatedAt: string): Promise<ObsidianReferences | undefined>
  graph(): Promise<{ edges: ObsidianGraphEdge[]; stats: ReferenceStats }>
}
const emptyStats = (): ReferenceStats => ({ occurrences: 0, resolved: 0, ambiguous: 0, missing: 0, unassociated: 0, unsupported: 0 })
const visible = (entity: ReferenceEntity) => entity.status === 'PUBLISHED' && entity.visibility === 'PUBLIC'
const pathKey = (value: string) => value.normalize('NFC').toLowerCase()
const ambiguityKey = (value: string) => wikiKey(value.replace(/\\/g, '/').replace(/\.md$/i, ''))
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {}
function validPath(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 1024 && /\.md$/i.test(value) && !/^(?:\/|[a-z]:)/i.test(value) &&
    !value.split('/').some(part => !part || part === '.' || part === '..') &&
    ![...value].some(char => char === '\\' || char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
}
interface Resolved { occurrence: WikiOccurrence; status: WikiStatus; entity?: ReferenceEntity; anchorId?: string; anchorIssue?: string }

/** Pure, deterministic projection. Only confirmed identities identify Obsidian destinations. */
export function buildReferenceCatalog(entities: ReferenceEntity[], origins: ReferenceOrigin[]) {
  const byId = new Map(entities.map(entity => [entity.id, entity]))
  const bySlug = new Map(entities.map(entity => [entity.slug, entity]))
  const contexts = new Map<string, ReferenceOrigin[]>()
  const spaces = new Map<string, { index: ReturnType<typeof obsidianLinkIndex>; paths: Map<string, Set<string>>;
    originalPaths: Map<string, string[]>; names: Map<string, Set<string>>; ambiguousTargets: Set<string> }>()
  for (const origin of origins) {
    if (!byId.has(origin.entityId) || !validPath(origin.path)) continue
    const space = spaces.get(origin.sourceId) ?? { index: obsidianLinkIndex([]), paths: new Map(), originalPaths: new Map(), names: new Map(), ambiguousTargets: new Set() }
    spaces.set(origin.sourceId, space)
    const ids = space.paths.get(origin.path) ?? new Set<string>()
    ids.add(origin.entityId); space.paths.set(origin.path, ids)
    const context = contexts.get(origin.entityId) ?? []; context.push(origin); contexts.set(origin.entityId, context)
    const entity = byId.get(origin.entityId)!, metadata = record(origin.metadata)
    const aliases = Array.isArray(metadata.aliases) ? metadata.aliases.filter((value): value is string => typeof value === 'string' && value.length <= 250) : []
    for (const name of [entity.title, ...entity.aliases, ...aliases]) {
      const key = wikiKey(name), candidates = space.names.get(key) ?? new Set<string>()
      candidates.add(entity.id); space.names.set(key, candidates)
    }
    // FOUND in the converter includes non-promoted placeholders. Keep their paths in the index.
    const links = record(metadata.obsidian).wikilinks
    if (Array.isArray(links)) for (const raw of links) {
      const link = record(raw)
      if (link.status === 'FOUND' && validPath(link.path) && !space.paths.has(link.path)) space.paths.set(link.path, new Set())
      // An ambiguous original note may include a placeholder whose candidate path was not exported.
      if (link.status === 'AMBIGUOUS' && typeof link.target === 'string' && link.target.length <= 1024) {
        space.ambiguousTargets.add(ambiguityKey(link.target))
      }
    }
  }
  for (const space of spaces.values()) {
    for (const path of space.paths.keys()) {
      const key = pathKey(path), originals = space.originalPaths.get(key) ?? []
      originals.push(path); space.originalPaths.set(key, originals)
    }
    space.index = obsidianLinkIndex([...space.originalPaths.keys()].sort())
  }
  const trees = new Map(entities.map(entity => [entity.id, markdownTree(entity.bodyMarkdown)]))
  const headings = new Map([...trees].map(([id, tree]) => [id, markdownHeadings(byId.get(id)!.bodyMarkdown, tree)]))
  function explicitDestination(occurrence: WikiOccurrence): Resolved | undefined {
    if (occurrence.embed) return { occurrence, status: 'UNSUPPORTED' }
    const slug = /^\/fiches\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(occurrence.target)?.[1]
    if (!slug) return undefined
    const entity = bySlug.get(slug)
    return entity ? withAnchor(occurrence, entity) : { occurrence, status: 'MISSING' }
  }
  function withAnchor(occurrence: WikiOccurrence, entity: ReferenceEntity): Resolved {
    if (!occurrence.anchor) return { occurrence, status: 'RESOLVED', entity }
    const matching = headings.get(entity.id)!.filter(heading => heading.key === wikiKey(occurrence.anchor!))
    return { occurrence, status: 'RESOLVED', entity, ...(matching.length === 1 ? { anchorId: matching[0]!.id }
      : { anchorIssue: matching.length ? 'Section ambiguë : lien vers la fiche sans ancre.' : 'Section absente ou non prise en charge : lien vers la fiche sans ancre.' }) }
  }
  function resolve(occurrence: WikiOccurrence, origin: ReferenceOrigin): Resolved {
    const explicit = explicitDestination(occurrence)
    if (explicit) return explicit
    const space = spaces.get(origin.sourceId)!, path = resolveObsidianPath(pathKey(occurrence.target), pathKey(origin.path), space.index)
    if (path.status === 'UNSUPPORTED' || path.status === 'OUT_OF_SCOPE' || path.status === 'AMBIGUOUS') return { occurrence, status: path.status }
    if (space.ambiguousTargets.has(ambiguityKey(occurrence.target))) return { occurrence, status: 'AMBIGUOUS' }
    const originals = path.path ? space.originalPaths.get(path.path) ?? [] : []
    if (originals.length > 1) return { occurrence, status: 'AMBIGUOUS' }
    const pathCandidates = originals[0] ? space.paths.get(originals[0]) : undefined
    const candidates = new Set(pathCandidates)
    // Explicit paths resolve only by identity. Simple names also consider exact titles/aliases.
    const name = occurrence.target && !/[/\\]/.test(occurrence.target) ? wikiKey(occurrence.target.replace(/\.md$/i, '')) : null
    if (name) {
      for (const id of space.names.get(name) ?? []) candidates.add(id)
    }
    // A deliberate current editorial alias may replace a deleted/unpromoted note's simple name.
    // Historical metadata, a title alone or an explicit path must never redirect that identity.
    const explicitAlias = name && [...candidates].some(id => byId.get(id)!.aliases.some(alias => wikiKey(alias) === name))
    if (path.status === 'FOUND' && !pathCandidates?.size && !explicitAlias) return { occurrence, status: 'UNASSOCIATED' }
    if (candidates.size !== 1) return { occurrence, status: candidates.size > 1 ? 'AMBIGUOUS' : 'MISSING' }
    const entity = byId.get([...candidates][0]!)!
    return withAnchor(occurrence, entity)
  }
  const resolved = new Map<string, Resolved[]>(), statsById = new Map<string, ReferenceStats>(), totalStats = emptyStats()
  const edges = new Map<string, ObsidianGraphEdge>()
  let occurrences = 0
  for (const entity of entities) {
    const ownOrigins = contexts.get(entity.id)
    const results = wikiOccurrences(entity.bodyMarkdown, trees.get(entity.id)).map(occurrence => {
      const choices = ownOrigins ? ownOrigins.map(origin => resolve(occurrence, origin))
        : [explicitDestination(occurrence) ?? { occurrence, status: 'MISSING' as const }]
      const first = choices[0]!
      return choices.every(choice => choice.status === first.status && choice.entity?.id === first.entity?.id && choice.anchorId === first.anchorId)
        ? first : { occurrence, status: 'AMBIGUOUS' as const }
    })
    occurrences += results.length
    if (occurrences > 100_000) throw new EditorialError(503, 'REFERENCES_LIMIT', 'Trop de références pour cette vue.')
    resolved.set(entity.id, results)
    const stats = emptyStats(), seen = new Set<string>()
    stats.occurrences = results.length
    for (const result of results) {
      const { occurrence, status } = result
      const key = JSON.stringify([status, result.entity?.id ?? wikiKey(occurrence.target), wikiKey(occurrence.anchor ?? '')])
      if (!seen.has(key)) {
        seen.add(key)
        if (status === 'RESOLVED') stats.resolved++
        else if (status === 'AMBIGUOUS') stats.ambiguous++
        else if (status === 'MISSING') stats.missing++
        else if (status === 'UNASSOCIATED') stats.unassociated++
        else stats.unsupported++
      }
      if (result.entity) {
        const id = `obsidian:${entity.id}:${result.entity.id}`, edge = edges.get(id)
        if (edge) edge.occurrences = (edge.occurrences ?? 0) + 1
        else edges.set(id, { id, source: entity.id, target: result.entity.id, origin: 'OBSIDIAN', type: 'OBSIDIAN_REFERENCE',
          label: 'Référence Obsidian', inverseLabel: 'Mentionné par', symmetric: false, occurrences: 1 })
      }
    }
    statsById.set(entity.id, stats)
    for (const key of Object.keys(stats) as Array<keyof ReferenceStats>) totalStats[key] += stats[key]
  }
  function navigation(id: string, updatedAt: string, publicOnly: boolean): WikiNavigation | undefined {
    const entity = byId.get(id)
    if (!entity || entity.updatedAt.toISOString() !== updatedAt || (publicOnly && !visible(entity))) return undefined
    return { updatedAt, links: (resolved.get(id) ?? []).filter(result => !result.occurrence.embed).map(result => ({
      start: result.occurrence.start, end: result.occurrence.end, label: result.occurrence.label,
      href: result.entity && (!publicOnly || visible(result.entity))
        ? `${publicOnly ? '/fiches/' : '/admin/fiches/'}${result.entity.slug}${result.anchorId ? `#${encodeURIComponent(result.anchorId)}` : ''}` : null,
    })) }
  }
  function connections(id: string, direction: 'incoming' | 'outgoing'): ReferenceConnection[] {
    return [...edges.values()].filter(edge => (direction === 'incoming' ? edge.target : edge.source) === id).map(edge => {
      const other = byId.get(direction === 'incoming' ? edge.source : edge.target)!
      const owner = byId.get(edge.source)!
      const origins = new Map((contexts.get(owner.id) ?? []).map(origin => [JSON.stringify([origin.sourceId, origin.path]), origin]))
      const origin = origins.size === 1 ? [...origins.values()][0] : undefined
      const occurrence = resolved.get(owner.id)?.find(result => result.entity?.id === edge.target)?.occurrence
      // An exact fragment is context for human review, never proof of a semantic relation.
      const excerpt = occurrence && occurrence.end - occurrence.start <= 4000
        ? owner.bodyMarkdown.slice(Math.max(0, occurrence.start - 180), Math.min(owner.bodyMarkdown.length, occurrence.end + 180)).trim() : null
      return { id: other.id, slug: other.slug, title: other.title, occurrences: edge.occurrences!,
        ...(other.status === 'ARCHIVED' ? { archived: true } : {}),
        ...(origin ? { origin: { sourceId: origin.sourceId, path: origin.path, excerpt } } : {}) }
    }).sort((a, b) => a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0)
  }
  function diagnosticsFor(id: string): ObsidianReferences['diagnostics'] {
    const diagnostics = new Map<string, ObsidianReferences['diagnostics'][number]>()
    for (const result of resolved.get(id) ?? []) {
      if (result.status === 'RESOLVED' && !result.anchorIssue) continue
      const { target, anchor } = result.occurrence, key = JSON.stringify([target, anchor, result.status, result.anchorIssue])
      const existing = diagnostics.get(key)
      if (existing) existing.occurrences++
      else diagnostics.set(key, { target, anchor, status: result.status, occurrences: 1, message: result.anchorIssue ?? ({
        MISSING: 'Aucune destination correspondante dans les identités confirmées de cette Source.',
        AMBIGUOUS: 'Plusieurs destinations possibles : précisez le chemin Obsidian. Aucune fiche choisie.',
        UNASSOCIATED: 'Note connue de l’index d’origine, sans fiche associée (note vide ou non promue possible).',
        UNSUPPORTED: 'Inclusion ou type de lien non pris en charge.', OUT_OF_SCOPE: 'Chemin sortant du périmètre de la Source.', RESOLVED: '',
      })[result.status] })
    }
    return [...diagnostics.values()]
  }
  function detail(id: string, updatedAt: string): ObsidianReferences | undefined {
    const nav = navigation(id, updatedAt, false)
    if (!nav) return undefined
    return { ...nav, outgoing: connections(id, 'outgoing'), incoming: connections(id, 'incoming'),
      stats: statsById.get(id) ?? emptyStats(), diagnostics: diagnosticsFor(id) }
  }
  const bodyHashes = new Map(entities.map(entity => [entity.id, createHash('sha256').update(entity.bodyMarkdown).digest('hex')]))
  // Conservative invalidation: editing the mentioning note or either confirmed identity requires review again.
  const identities = new Map([...contexts].map(([id, origins]) => [id, [...new Set(origins.map(origin =>
    JSON.stringify([origin.sourceId, origin.path])))].sort()]))
  const fingerprintOccurrences = new Map<string, unknown[]>()
  for (const [id, results] of resolved) for (const item of results) {
    if (!item.entity) continue
    const key = `obsidian:${id}:${item.entity.id}`, occurrences = fingerprintOccurrences.get(key) ?? []
    occurrences.push([item.occurrence.start, item.occurrence.end, item.occurrence.target, item.occurrence.anchor, item.anchorId ?? null])
    fingerprintOccurrences.set(key, occurrences)
  }
  const fingerprints = new Map([...edges.values()].map(edge => [edge.id, createHash('sha256').update(JSON.stringify([
    edge.source, edge.target, bodyHashes.get(edge.source), identities.get(edge.source) ?? [], identities.get(edge.target) ?? [],
    fingerprintOccurrences.get(edge.id),
  ])).digest('hex')]))
  return { navigation, detail, diagnostics: diagnosticsFor, fingerprints, contexts, entities: byId,
    graph: () => ({ edges: [...edges.values()].sort((a, b) => a.id < b.id ? -1 : 1), stats: totalStats }) }
}

export async function loadReferenceSnapshot(tx: Prisma.TransactionClient) {
  const entities = await tx.entity.findMany({ select: { id: true, slug: true, title: true, aliases: true,
    bodyMarkdown: true, tags: true, kind: true, status: true, visibility: true, updatedAt: true }, orderBy: { id: 'asc' }, take: 2001 })
  const associations = await tx.ingestionAssociation.findMany({ where: { source: { kind: 'OBSIDIAN' },
    externalId: { not: null }, decisions: { some: { decision: 'CONFIRMED' } } }, select: {
    sourceId: true, externalId: true, decisions: { where: { decision: 'CONFIRMED' }, select: { entityId: true } },
    item: { select: { receipts: { select: { metadata: true }, orderBy: [{ ingestedAt: 'desc' }, { id: 'desc' }], take: 1 } } },
  }, orderBy: { id: 'asc' }, take: 4001 })
  if (entities.length > 2000 || associations.length > 4000 || entities.reduce((size, entity) => size + Buffer.byteLength(entity.bodyMarkdown), 0) > 32 * 1024 * 1024) {
    throw new EditorialError(503, 'REFERENCES_LIMIT', 'Catalogue trop volumineux pour calculer les références.')
  }
  return { entities, origins: associations.flatMap(association => association.decisions.map(decision => ({
    sourceId: association.sourceId, path: association.externalId!, entityId: decision.entityId,
    metadata: association.item.receipts[0]?.metadata,
  }))) }
}

export function createPrismaReferenceService(prisma: PrismaClient): ReferenceService {
  async function catalog() {
    const snapshot = await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
      return loadReferenceSnapshot(tx)
    }, { isolationLevel: 'RepeatableRead', timeout: 15_000 })
    return buildReferenceCatalog(snapshot.entities, snapshot.origins)
  }
  return {
    async navigation(id, updatedAt) { return (await catalog()).navigation(id, updatedAt, true) },
    async detail(id, updatedAt) { return (await catalog()).detail(id, updatedAt) },
    async graph() { return (await catalog()).graph() },
  }
}
