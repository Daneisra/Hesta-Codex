import { createHash } from 'node:crypto'
import { frontmatterEnd, markdownTree, walkWikiProse, wikiKey, wikiOccurrences,
  type EditorialSuggestionDraft, type EditorialTermSuggestions, type EditorialVocabulary, type LinkSuggestion,
  type LinkSuggestionScan, type LinkSuggestionApply, type SuggestionEntity, type AdminEntityDetail } from '@hesta-codex/shared'
import { Prisma, type PrismaClient } from './prisma-client/client.ts'
import { buildReferenceCatalog, loadReferenceSnapshot, type ReferenceEntity, type ReferenceOrigin } from './obsidian-references.js'
import { EditorialError, editorialSelect, patchEditorialInTransaction } from './admin/editorial.js'
import { patchSchema } from './admin/validation.js'

export type SuggestionNote = ReferenceEntity & { tags: string[] }
interface Snapshot { entities: SuggestionNote[]; origins: ReferenceOrigin[]; relations: Array<{ fromEntityId: string; toEntityId: string }> }
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const tooLarge = () => new EditorialError(503, 'SUGGESTIONS_LIMIT', 'Catalogue trop volumineux pour ce scan. Aucune modification effectuée.')
const safeName = (value: string) => value.length >= 2 && value.length <= 200 &&
  !['\r', '\n', '[', ']', '|', '\\'].some(char => value.includes(char))
const safeTerm = (value: string, max: number) => safeName(value) && value.length <= max && !value.includes(',') && !value.includes('#')
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const view = (note: SuggestionNote): SuggestionEntity => ({ id: note.id, slug: note.slug, title: note.title,
  status: note.status as SuggestionEntity['status'], visibility: note.visibility as SuggestionEntity['visibility'] })

/** Raw source offsets only: no rewriting Markdown escapes, code, frontmatter, links or images. */
export function proseRanges(body: string): Array<{ start: number; text: string }> {
  const ranges: Array<{ start: number; text: string }> = [], frontmatter = frontmatterEnd(body)
  const blocked: Array<{ start: number; end: number }> = []
  for (const [opening, closing] of [['[[', ']]'], ['$$', '$$']]) {
    let at = 0
    while (at < body.length) {
      const start = body.indexOf(opening!, at)
      if (start < 0) break
      const end = body.indexOf(closing!, start + opening!.length)
      blocked.push({ start, end: end < 0 ? body.length : end + closing!.length })
      at = end < 0 ? body.length : end + closing!.length
    }
  }
  blocked.sort((a, b) => a.start - b.start)
  let blockedAt = 0
  walkWikiProse(markdownTree(body), node => {
    if (node.type !== 'text' || node.position?.start.offset === undefined || node.position.end.offset === undefined) return
    const start = node.position.start.offset, raw = body.slice(start, node.position.end.offset)
    // Also protect deliberately escaped wikilinks and unsupported inline math.
    const excluded = [...raw.matchAll(/\$[^$\r\n]*\$|&(?:#\d+|#x[a-f\d]+|[a-z][a-z\d]+);/gi)].map(item => ({ start: item.index, end: item.index + item[0].length }))
    while (blockedAt < blocked.length && blocked[blockedAt]!.end <= start) blockedAt++
    for (let i = blockedAt; i < blocked.length && blocked[i]!.start < start + raw.length; i++) {
      excluded.push({ start: Math.max(0, blocked[i]!.start - start), end: Math.min(raw.length, blocked[i]!.end - start) })
    }
    excluded.sort((a, b) => a.start - b.start)
    let at = 0
    for (const item of [...excluded, { start: raw.length, end: raw.length }]) {
      if (item.start > at && start + at >= frontmatter) ranges.push({ start: start + at, text: raw.slice(at, item.start) })
      at = Math.max(at, item.end)
    }
  })
  return ranges
}

function matcher(values: string[]) {
  const keys = [...new Set(values.filter(safeName).map(wikiKey))].sort((a, b) => b.length - a.length || compare(a, b))
  if (keys.length > 6000 || keys.join('').length > 120000) throw tooLarge()
  if (!keys.length) return null
  const patterns = keys.map(key => [...key].map(char => char === ' ' ? '[ \\t]+' : char.normalize('NFD') === char
    ? escape(char) : `(?:${escape(char)}|${escape(char.normalize('NFD'))})`).join(''))
  return new RegExp(`(?<![\\p{L}\\p{M}\\p{N}_])(?:${patterns.join('|')})(?![\\p{L}\\p{M}\\p{N}_])`, 'giu')
}

export function buildVocabulary(entities: Array<Pick<SuggestionNote, 'id' | 'slug' | 'title' | 'tags' | 'aliases'>>): EditorialVocabulary {
  const tags = new Map<string, { value: string; count: number }>(), aliases = new Map<string, EditorialVocabulary['aliases'][number]>()
  for (const entity of [...entities].sort((a, b) => compare(a.id, b.id))) {
    for (const tag of new Set(entity.tags)) {
      if (!safeTerm(tag, 100)) continue
      const key = wikiKey(tag), item = tags.get(key) ?? { value: tag, count: 0 }; item.count++; tags.set(key, item)
    }
    for (const alias of entity.aliases) {
      if (!safeTerm(alias, 200)) continue
      const key = wikiKey(alias), item = aliases.get(key) ?? { value: alias, owners: [] }
      if (!item.owners.some(owner => owner.id === entity.id)) item.owners.push({ id: entity.id, slug: entity.slug, title: entity.title })
      aliases.set(key, item)
    }
  }
  if (tags.size > 6000 || aliases.size > 6000) throw tooLarge()
  return { tags: [...tags.values()].sort((a, b) => b.count - a.count || compare(a.value, b.value)),
    aliases: [...aliases.values()].sort((a, b) => compare(a.value, b.value)) }
}

export function suggestTerms(entities: SuggestionNote[], draft: EditorialSuggestionDraft, origins: ReferenceOrigin[] = []): EditorialTermSuggestions {
  const result: EditorialTermSuggestions = { aliases: [], tags: [] }, vocabulary = buildVocabulary(entities)
  const existing = { aliases: new Set(draft.aliases.map(wikiKey)), tags: new Set(draft.tags.map(wikiKey)) }
  const add = (kind: 'aliases' | 'tags', raw: string, reason: string) => {
    const value = raw.trim(), key = wikiKey(value)
    if (!safeTerm(value, kind === 'aliases' ? 200 : 100) || existing[kind].has(key) || (kind === 'aliases' && key === wikiKey(draft.title))) return
    existing[kind].add(key)
    result[kind].push({ value, reason, conflicts: kind === 'aliases' ? entities.filter(note => note.id !== draft.entityId &&
      [note.title, ...note.aliases].some(name => wikiKey(name) === key)).map(note => note.title) : [] })
  }
  for (const item of draft.title.matchAll(/\(([^()]{2,200})\)/g)) add('aliases', item[1]!, 'Variante écrite entre parenthèses dans le titre ; à vérifier.')
  for (const range of proseRanges(draft.bodyMarkdown)) {
    for (const item of range.text.matchAll(/(?:appelé[e]?|nommé[e]?|surnommé[e]?|alias|dit[e]?)\s+[«"]([^»"\r\n]{2,200})[»"]/giu)) {
      add('aliases', item[1]!, 'Nom cité explicitement dans le contenu ; vérifiez qu’il désigne cette fiche.')
    }
    for (const item of range.text.matchAll(/(?<![\p{L}\p{N}_])#([\p{L}\p{N}][\p{L}\p{M}\p{N}_-]{1,99})/gu)) add('tags', item[1]!, 'Mot-clé écrit avec # dans le contenu.')
  }
  const pattern = matcher(vocabulary.tags.map(item => item.value))
  if (pattern) for (const range of proseRanges(draft.bodyMarkdown)) for (const item of range.text.matchAll(pattern)) {
    const tag = vocabulary.tags.find(tag => wikiKey(tag.value) === wikiKey(item[0]))!
    add('tags', tag.value, `Tag existant mentionné dans le contenu (${tag.count} fiche(s)).`)
  }
  if (draft.entityId) {
    const current = entities.find(entity => entity.id === draft.entityId), catalog = buildReferenceCatalog(entities, origins)
    if (current) for (const note of entities) {
      const links = new Map(catalog.navigation(note.id, note.updatedAt.toISOString(), false)?.links.map(link => [link.start, link]) ?? [])
      for (const link of wikiOccurrences(note.bodyMarkdown)) if (link.alias && links.get(link.start)?.href?.split('#')[0] === `/admin/fiches/${current.slug}`) {
        add('aliases', link.alias, 'Libellé d’un lien résolu vers cette fiche ; à vérifier.')
      }
    }
  }
  return { aliases: result.aliases.slice(0, 20), tags: result.tags.slice(0, 20) }
}

export function scanConnections(snapshot: Snapshot) {
  const { entities, origins, relations } = snapshot, byId = new Map(entities.map(note => [note.id, note]))
  const names = new Map<string, Set<string>>()
  for (const note of entities.filter(note => note.status !== 'ARCHIVED')) for (const raw of [note.title, ...note.aliases]) {
    if (!safeName(raw)) continue
    const key = wikiKey(raw), ids = names.get(key) ?? new Set<string>(); ids.add(note.id); names.set(key, ids)
  }
  const pattern = matcher([...names.keys()]), catalog = buildReferenceCatalog(entities, origins)
  const pair = (a: string, b: string) => JSON.stringify([a, b].sort())
  const connected = new Set([...catalog.graph().edges.map(edge => pair(edge.source, edge.target)), ...relations.map(row => pair(row.fromEntityId, row.toEntityId))])
  const fingerprint = hash({ entities: [...entities].sort((a, b) => compare(a.id, b.id)),
    origins: [...origins].sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b))),
    relations: [...relations].sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b))) })
  const groups = new Map<string, LinkSuggestion>(), ambiguities: LinkSuggestionScan['ambiguities'] = []
  let ambiguous = 0, existing = 0, occurrences = 0, matches = 0
  if (pattern) for (const note of entities.filter(note => note.status !== 'ARCHIVED').sort((a, b) => compare(a.id, b.id))) {
    for (const range of proseRanges(note.bodyMarkdown)) for (const match of range.text.matchAll(pattern)) {
      if (++matches > 100000) throw tooLarge()
      const ids = [...names.get(wikiKey(match[0]))!]
      if (ids.length !== 1) {
        ambiguous++
        if (ambiguities.length < 30) ambiguities.push({ from: view(note), text: match[0], candidates: ids.map(id => byId.get(id)!.title) })
        continue
      }
      const target = byId.get(ids[0]!)!
      if (target.id === note.id) continue
      if (connected.has(pair(note.id, target.id))) { existing++; continue }
      const id = hash([note.id, target.id]), group = groups.get(id) ?? { id, fingerprint, from: view(note), to: view(target), occurrences: [] }
      const start = range.start + match.index!, end = start + match[0].length
      let escapes = 0
      for (let at = start - 1; at >= 0 && note.bodyMarkdown[at] === '\\'; at--) escapes++
      if (escapes % 2) continue
      const wikilink = `[[/fiches/${target.slug}|${match[0]}]]`
      group.occurrences.push({ start, end, text: match[0], before: note.bodyMarkdown.slice(Math.max(0, start - 100), start),
        after: note.bodyMarkdown.slice(end, end + 100), wikilink })
      groups.set(id, group); occurrences++
      if (groups.size > 5000 || occurrences > 20000 || ambiguous > 20000 || existing > 100000) throw tooLarge()
    }
  }
  return { entities: entities.length, items: [...groups.values()].sort((a, b) => compare(wikiKey(a.from.title), wikiKey(b.from.title)) ||
    compare(wikiKey(a.to.title), wikiKey(b.to.title)) || compare(a.id, b.id)), occurrences, ambiguous, existing, ambiguities }
}

export interface EditorialSuggestionService {
  vocabulary(): Promise<EditorialVocabulary>
  terms(draft: EditorialSuggestionDraft): Promise<EditorialTermSuggestions>
  scan(page: number): Promise<LinkSuggestionScan>
  apply(input: LinkSuggestionApply, actor: { label: string; discordId: string }): Promise<AdminEntityDetail>
}
export function createPrismaEditorialSuggestionService(prisma: PrismaClient): EditorialSuggestionService {
  async function snapshot(tx: Prisma.TransactionClient): Promise<Snapshot> {
    const data = await loadReferenceSnapshot(tx)
    const relations = await tx.relation.findMany({ select: { fromEntityId: true, toEntityId: true }, orderBy: { id: 'asc' }, take: 20001 })
    if (relations.length > 20000) throw tooLarge()
    return { ...data, relations }
  }
  const read = <T>(run: (data: Snapshot) => T) => prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
    return run(await snapshot(tx))
  }, { isolationLevel: 'RepeatableRead', timeout: 20000 })
  return {
    vocabulary: () => prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
      const rows = await tx.entity.findMany({ select: { id: true, slug: true, title: true, aliases: true, tags: true }, orderBy: { id: 'asc' }, take: 2001 })
      if (rows.length > 2000) throw tooLarge()
      return buildVocabulary(rows)
    }, { isolationLevel: 'RepeatableRead', timeout: 20000 }),
    terms: draft => read(data => {
      if (draft.entityId && !data.entities.some(note => note.id === draft.entityId)) throw new EditorialError(404, 'NOT_FOUND', 'Fiche introuvable. Votre brouillon est conservé.')
      return suggestTerms(data.entities, draft, data.origins)
    }),
    scan: page => read(data => { const plan = scanConnections(data), pageSize = 30
      return { ...plan, connections: plan.items.length, scannedAt: new Date().toISOString(), page, pageSize,
        items: plan.items.slice((page - 1) * pageSize, page * pageSize) } }),
    async apply(input, actor) {
      if (input.confirm !== true) throw new EditorialError(400, 'CONFIRMATION_REQUIRED', 'Confirmation humaine requise.')
      try {
        return await prisma.$transaction(async tx => {
          const plan = scanConnections(await snapshot(tx)), group = plan.items.find(item => item.id === input.id)
          if (!group || group.fingerprint !== input.fingerprint) throw new EditorialError(409, 'SUGGESTION_MODIFIED', 'Le catalogue a changé. Relancez le scan et vérifiez le nouvel aperçu.')
          const current = await tx.entity.findUniqueOrThrow({ where: { id: group.from.id }, select: editorialSelect })
          let body = current.bodyMarkdown
          for (const item of [...group.occurrences].sort((a, b) => b.start - a.start)) body = body.slice(0, item.start) + item.wikilink + body.slice(item.end)
          // Use only editorial fields; strict validation rejects oversized bodies rather than truncating.
          const fields = { title: current.title, summary: current.summary, bodyMarkdown: body, kind: current.kind, placeKind: current.placeKind,
            aliases: current.aliases, tags: current.tags, visibility: current.visibility, expectedUpdatedAt: current.updatedAt.toISOString(),
            revisionMessage: `Ajout de ${group.occurrences.length} lien(s) vers /${group.to.slug} après revue du scan.` }
          const checked = patchSchema.safeParse(fields)
          if (!checked.success) throw new EditorialError(400, 'INVALID_LINK_UPDATE', 'Le contenu dépasserait les limites de la fiche ou ses champs doivent être corrigés.')
          return patchEditorialInTransaction(tx, current.slug, checked.data, actor.label, actor.discordId)
        }, { isolationLevel: 'Serializable', timeout: 20000 })
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') throw new EditorialError(409, 'SUGGESTION_MODIFIED', 'Modification concurrente. Relancez le scan.')
        throw error
      }
    },
  }
}
