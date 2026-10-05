import type { IngestionMatchCandidate, IngestionMatchReason, IngestionMatches } from '@hesta-codex/shared'
import { Prisma, type PrismaClient } from '../prisma-client/client.ts'
import { compareMatchText, externalIdSlug, matchingWhitespace, matchSimilarity, matchSlug, normalizeMatchName, similarityChunks } from './matching-normalization.js'

export const MATCH_SEARCH_LIMIT = 200
export const MATCH_CANDIDATE_LIMIT = 10
export interface MatchContext { title: string | null; locator: string | null; sourceId: string; externalId: string | null }
export type MatchEntity = Omit<IngestionMatchCandidate, 'score' | 'reasons'> & { sameSourceAndLocator: boolean }
export interface ExactSelection { candidates: MatchEntity[]; exactCount: number; strongCount: number }
interface MatchSearchInfo { approximateTruncated?: boolean; approximateEvaluatedCount?: number; exactCount?: number; strongCount?: number }

export function scoreIngestionMatches(context: MatchContext, pool: MatchEntity[], search: MatchSearchInfo = {}): IngestionMatches {
  const title = normalizeMatchName(context.title), titleSlug = matchSlug(context.title), externalSlug = externalIdSlug(context.externalId)
  const candidates: IngestionMatchCandidate[] = []
  const unique = new Map<string, MatchEntity>()
  for (const entity of pool) {
    const previous = unique.get(entity.id)
    unique.set(entity.id, previous ? { ...previous, sameSourceAndLocator: previous.sameSourceAndLocator || entity.sameSourceAndLocator } : entity)
  }
  for (const entity of unique.values()) {
    const reasons: IngestionMatchReason[] = []
    let score = 0
    const signal = (reason: IngestionMatchReason, value: number) => { reasons.push(reason); score = Math.max(score, value) }
    const normalizedTitle = normalizeMatchName(entity.title), aliases = entity.aliases.map(normalizeMatchName)
    if (entity.sameSourceAndLocator) signal('SAME_SOURCE_AND_LOCATOR', 100)
    if (title && normalizedTitle === title) signal('EXACT_TITLE', 90)
    if (title && aliases.includes(title)) signal('EXACT_ALIAS', 90)
    if (titleSlug && titleSlug === entity.slug) signal('TITLE_TO_SLUG', 80)
    if (externalSlug && externalSlug === entity.slug) signal('EXTERNAL_ID_TO_SLUG', 75)
    const similarTitle = title && title !== normalizedTitle ? matchSimilarity(title, normalizedTitle) : 0
    const aliasSimilarities = aliases.map(alias => title && alias !== title ? matchSimilarity(title, alias) : 0)
    const similarAlias = aliasSimilarities.reduce((best, similarity) => Math.max(best, similarity), 0)
    if (similarTitle) signal('SIMILAR_TITLE', Math.min(79, 60 + Math.round(similarTitle * 20)))
    if (similarAlias) signal('SIMILAR_ALIAS', Math.min(79, 60 + Math.round(similarAlias * 20)))
    if (!score) continue
    // Explicit allow-list: a repository adapter can never accidentally expose full rows.
    candidates.push({ id: entity.id, slug: entity.slug, title: entity.title, kind: entity.kind,
      placeKind: entity.placeKind, aliases: entity.aliases.filter((_, i) => title && (aliases[i] === title || aliasSimilarities[i]! > 0)).slice(0, 5),
      status: entity.status, visibility: entity.visibility, score, reasons })
  }
  candidates.sort((a, b) => b.score - a.score || compareMatchText(normalizeMatchName(a.title), normalizeMatchName(b.title)) || compareMatchText(a.id, b.id))
  const strong = candidates.filter(candidate => candidate.score >= 90)
  const strongCount = Math.max(search.strongCount ?? strong.length, strong.length)
  const exactCount = search.exactCount ?? candidates.filter(candidate => candidate.reasons.some(reason => !reason.startsWith('SIMILAR_'))).length
  const status = strongCount > 1 || strong.some(candidate => candidate.status === 'ARCHIVED')
    ? 'AMBIGUOUS' : strong.length === 1 ? 'EXACT' : candidates.length ? 'POSSIBLE' : 'NONE'
  const approximateCount = candidates.filter(candidate => candidate.reasons.every(reason => reason.startsWith('SIMILAR_'))).length
  return { status, candidates: candidates.slice(0, MATCH_CANDIDATE_LIMIT), searchTruncated: search.approximateTruncated ?? false,
    candidatesTruncated: Math.max(candidates.length, exactCount + approximateCount) > MATCH_CANDIDATE_LIMIT, evaluatedCount: unique.size,
    exactCandidateCount: exactCount, strongCandidateCount: strongCount, approximateEvaluatedCount: search.approximateEvaluatedCount ?? approximateCount,
    searchLimit: MATCH_SEARCH_LIMIT, candidateLimit: MATCH_CANDIDATE_LIMIT }
}

// Built-in PostgreSQL NFC normalization; no extension, interpolation of identifiers or narrative search.
const normalizedSql = (column: Prisma.Sql) => Prisma.sql`btrim(regexp_replace(lower(normalize(${column}, NFC)), ${matchingWhitespace}, ' ', 'g'))`
const titleColumn = normalizedSql(Prisma.sql`e.title`)
const aliasColumn = normalizedSql(Prisma.sql`a.name`)
const projection = Prisma.sql`e.id, e.slug, e.title, e.kind, e."placeKind", e.aliases, e.status, e.visibility`

// Exact identities are evaluated over the full matching set in PostgreSQL, before any LIMIT.
// Only the globally first 10 and the (at most 2) unique slugs are transferred to the scorer.
function exactSelectionSql(context: MatchContext, title: string, slugs: string[], locators: string[]): Prisma.Sql {
  const sourceIds = locators.length ? Prisma.sql`SELECT DISTINCT ev."entityId" AS id FROM "Evidence" ev
    WHERE ev."sourceId" = ${context.sourceId}::uuid AND ev.locator IN (${Prisma.join(locators)})
    AND ev."entityId" IS NOT NULL AND ev."relationId" IS NULL` : Prisma.sql`SELECT NULL::uuid AS id WHERE FALSE`
  const names = title ? Prisma.sql`SELECT e.id FROM "Entity" e WHERE ${titleColumn} = ${title}
    OR EXISTS (SELECT 1 FROM unnest(e.aliases) a(name) WHERE ${aliasColumn} = ${title})` : Prisma.sql`SELECT NULL::uuid AS id WHERE FALSE`
  const slugIds = slugs.length ? Prisma.sql`SELECT e.id FROM "Entity" e WHERE e.slug IN (${Prisma.join(slugs)})` : Prisma.sql`SELECT NULL::uuid AS id WHERE FALSE`
  return Prisma.sql`WITH provenance_ids AS MATERIALIZED (${sourceIds}), name_ids AS MATERIALIZED (${names}),
    slug_ids AS MATERIALIZED (${slugIds}), exact_ids AS (
      SELECT id FROM provenance_ids UNION SELECT id FROM name_ids UNION SELECT id FROM slug_ids
    ), identities AS MATERIALIZED (
      SELECT e.id, ${titleColumn} AS "sortTitle", p.id IS NOT NULL AS "sameSourceAndLocator",
        CASE WHEN p.id IS NOT NULL THEN 100 WHEN n.id IS NOT NULL THEN 90
          WHEN e.slug = ${matchSlug(context.title)} THEN 80 ELSE 75 END AS rank
      FROM exact_ids x JOIN "Entity" e ON e.id = x.id
      LEFT JOIN provenance_ids p ON p.id = e.id LEFT JOIN name_ids n ON n.id = e.id
    ), totals AS (
      SELECT count(*)::int AS "exactCount", count(*) FILTER (WHERE rank >= 90)::int AS "strongCount" FROM identities
    ), exact_top AS (
      SELECT id FROM identities ORDER BY rank DESC, "sortTitle" COLLATE "C", id LIMIT ${MATCH_CANDIDATE_LIMIT}
    ), chosen AS (SELECT id FROM exact_top UNION SELECT id FROM slug_ids)
    SELECT totals.*, COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', e.id, 'slug', e.slug, 'title', e.title, 'kind', e.kind,
        'placeKind', e."placeKind", 'aliases', e.aliases, 'status', e.status, 'visibility', e.visibility,
        'sameSourceAndLocator', i."sameSourceAndLocator") ORDER BY i.rank DESC, i."sortTitle" COLLATE "C", e.id)
      FROM chosen c JOIN "Entity" e ON e.id = c.id JOIN identities i ON i.id = e.id
    ), '[]'::jsonb) AS candidates FROM totals`
}

export function createPrismaIngestionMatcher(prisma: PrismaClient) {
  return async (itemId: string, receiptId?: string): Promise<IngestionMatches | null> =>
    prisma.$transaction(async tx => {
      const receipt = await tx.ingestionReceipt.findFirst({ where: { itemId, ...(receiptId ? { id: receiptId } : {}) },
        orderBy: [{ ingestedAt: 'desc' }, { ordinal: 'desc' }, { id: 'desc' }],
        select: { title: true, locator: true, item: { select: { sourceId: true, externalId: true } } } })
      if (!receipt) return null
      const context: MatchContext = { title: receipt.title, locator: receipt.locator, ...receipt.item }
      const title = normalizeMatchName(context.title)
      const slugs = [...new Set([matchSlug(context.title), externalIdSlug(context.externalId)].filter(Boolean))]
      const locators = [...new Set([context.locator, context.externalId].filter((value): value is string => !!value && Array.from(value).length <= 250))]
      const provenance = locators.length ? Prisma.sql`EXISTS (SELECT 1 FROM "Evidence" ev WHERE ev."entityId" = e.id
        AND ev."relationId" IS NULL AND ev."sourceId" = ${context.sourceId}::uuid AND ev.locator IN (${Prisma.join(locators)}))` : Prisma.sql`FALSE`
      const exact = title ? Prisma.sql`(${titleColumn} = ${title} OR EXISTS (SELECT 1 FROM unnest(e.aliases) a(name) WHERE ${aliasColumn} = ${title}))` : Prisma.sql`FALSE`
      const slug = slugs.length ? Prisma.sql`e.slug IN (${Prisma.join(slugs)})` : Prisma.sql`FALSE`
      if (!title && !locators.length && !slugs.length) return scoreIngestionMatches(context, [])
      const [selection] = await tx.$queryRaw<ExactSelection[]>(exactSelectionSql(context, title, slugs, locators))
      if (!selection) throw new Error('Missing matching selection')
      const pool = [...selection.candidates]
      let truncated = false, approximateEvaluatedCount = 0
      const chunks = similarityChunks(title)
      if (selection.strongCount < MATCH_CANDIDATE_LIMIT && chunks.length) {
        const size = Array.from(title).length
        // OFFSET 0 is an optimization barrier: normalize each name once, rather than
        // re-running Unicode/regexp normalization for every similarity chunk.
        const nearby = (column: Prisma.Sql) => Prisma.sql`EXISTS (SELECT 1 FROM (SELECT ${column} AS value OFFSET 0) normalized
          WHERE char_length(normalized.value) BETWEEN ${Math.max(5, Math.ceil(size * 85 / 100))} AND ${Math.min(250, Math.floor(size * 100 / 85))}
            AND EXISTS (SELECT 1 FROM unnest(ARRAY[${Prisma.join(chunks)}]::text[]) chunk(value) WHERE strpos(normalized.value, chunk.value) > 0))`
        const fuzzy = await tx.$queryRaw<MatchEntity[]>(Prisma.sql`SELECT ${projection}, FALSE AS "sameSourceAndLocator" FROM "Entity" e
          WHERE (${nearby(titleColumn)} OR EXISTS (SELECT 1 FROM unnest(e.aliases) a(name) WHERE ${nearby(aliasColumn)}))
            AND NOT (${provenance} OR ${exact} OR ${slug})
          ORDER BY ${titleColumn} COLLATE "C", e.id LIMIT ${MATCH_SEARCH_LIMIT + 1}`)
        truncated = fuzzy.length > MATCH_SEARCH_LIMIT
        approximateEvaluatedCount = Math.min(fuzzy.length, MATCH_SEARCH_LIMIT)
        pool.push(...fuzzy.slice(0, MATCH_SEARCH_LIMIT))
      }
      return scoreIngestionMatches(context, pool, { approximateTruncated: truncated, approximateEvaluatedCount,
        exactCount: selection.exactCount, strongCount: selection.strongCount })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
}
