import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { test } from 'node:test'
import type { IngestionMatchReason } from '@hesta-codex/shared'
import type { Prisma, PrismaClient } from '../prisma-client/client.ts'
import { compareMatchText, externalIdSlug, matchSlug, normalizeMatchName, similarityChunks } from './matching-normalization.js'
import { createPrismaIngestionMatcher, scoreIngestionMatches, type ExactSelection, type MatchContext, type MatchEntity } from './matching.js'

const uuid = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
const sourceId = uuid(9000), itemId = uuid(9001), receiptId = uuid(9002)
const input: MatchContext = { sourceId, title: 'Station technique', locator: 'fictif/repere.md', externalId: null }
type EntityRow = Omit<MatchEntity, 'sameSourceAndLocator'> & { bodyMarkdown: string; metadata: unknown; updatedAt: string }
type EvidenceRow = { id: string; sourceId: string; entityId: string | null; relationId: string | null; locator: string | null; claimText: string; updatedAt: string }
const row = (index: number, overrides: Partial<EntityRow> = {}): EntityRow => ({ id: uuid(index), title: `Fiche fictive ${index}`, slug: `fiche-fictive-${index}`,
  kind: 'OTHER', placeKind: null, aliases: [], status: 'DRAFT', visibility: 'SECRET', bodyMarkdown: 'Texte narratif fictif exclu', metadata: { fictional: true }, updatedAt: '2026-10-05T00:00:00Z', ...overrides })
const evidence = (index: number, entityId: string | null, overrides: Partial<EvidenceRow> = {}): EvidenceRow => ({ id: uuid(8000 + index), sourceId,
  entityId, relationId: null, locator: input.locator, claimText: 'Preuve fictive exclue', updatedAt: '2026-10-05T00:00:00Z', ...overrides })

function freeze(value: unknown) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return
  Object.freeze(value); for (const child of Object.values(value)) freeze(child)
}

// An in-memory relational double, not a PostgreSQL integration test. It starts from whole
// fictitious tables and interprets the targeted plan, never pre-supplies 200 candidate rows.
function database(entities: EntityRow[], evidences: EvidenceRow[] = [], context: MatchContext = input) {
  const state = { Entity: entities, Evidence: evidences, Relation: [{ id: uuid(7000), description: 'Relation fictive' }],
    Revision: [{ id: uuid(7001), snapshot: { fictional: true } }], Source: [{ id: context.sourceId, label: 'Origine fictive' }],
    IngestionBatch: [{ id: uuid(7002), label: 'Batch fictif' }], IngestionItem: [{ id: itemId, sourceId: context.sourceId, externalId: context.externalId, content: 'Brut fictif exclu' }],
    IngestionReceipt: [{ id: receiptId, itemId, title: context.title, locator: context.locator, metadata: { fictional: true }, rawVariant: 'Variante fictive exclue' }] }
  const before = structuredClone(state); freeze(state)
  const queries: Prisma.Sql[] = [], selections: ExactSelection[] = []
  const measurements = { selectionMs: 0, transferredExact: 0, transferredApproximate: 0, writes: 0 }
  const projected = (entity: EntityRow, sameSourceAndLocator: boolean): MatchEntity => ({ id: entity.id, title: entity.title, slug: entity.slug,
    kind: entity.kind, placeKind: entity.placeKind, aliases: [...entity.aliases], status: entity.status, visibility: entity.visibility, sameSourceAndLocator })
  const provenance = (entity: EntityRow) => state.Evidence.some(ev => ev.sourceId === context.sourceId && ev.entityId === entity.id && ev.relationId === null
    && !!ev.locator && [context.locator, context.externalId].some(locator => locator === ev.locator && Array.from(locator!).length <= 250))
  const name = normalizeMatchName(context.title), titleSlug = matchSlug(context.title), externalSlug = externalIdSlug(context.externalId)
  const rank = (entity: EntityRow) => provenance(entity) ? 100 : name && (normalizeMatchName(entity.title) === name || entity.aliases.some(alias => normalizeMatchName(alias) === name))
    ? 90 : titleSlug && entity.slug === titleSlug ? 80 : externalSlug && entity.slug === externalSlug ? 75 : 0
  const tx = new Proxy({
    ingestionReceipt: { async findFirst(query: { where: { itemId: string; id?: string } }) {
      const receipt = state.IngestionReceipt.find(receipt => receipt.itemId === query.where.itemId && (!query.where.id || receipt.id === query.where.id))
      return receipt ? { title: receipt.title, locator: receipt.locator, item: { sourceId: context.sourceId, externalId: context.externalId } } : null
    } },
    async $queryRaw(query: Prisma.Sql) {
      const started = performance.now(); queries.push(query)
      assert.doesNotMatch(query.sql, /INSERT|UPDATE|DELETE|bodyMarkdown|claimText|sourceExcerpt|rawVariant|metadata|"Revision"|"Relation"/)
      let result: ExactSelection[] | MatchEntity[]
      if (query.sql.startsWith('WITH provenance_ids')) {
        // Verify the produced plan really filters/counts first and uses only the output limit.
        assert.match(query.sql, /WHERE ev\."sourceId" = \?::uuid AND ev\.locator IN/)
        assert.match(query.sql, /ev\."entityId" IS NOT NULL AND ev\."relationId" IS NULL/)
        assert.match(query.sql, /name_ids AS MATERIALIZED \(SELECT e\.id FROM "Entity" e WHERE|name_ids AS MATERIALIZED \(SELECT NULL/)
        assert.match(query.sql, /slug_ids AS MATERIALIZED \(SELECT e\.id FROM "Entity" e WHERE e\.slug IN|slug_ids AS MATERIALIZED \(SELECT NULL/)
        assert.equal(query.values.at(-1), 10); assert.equal(query.values.includes(200), false)
        assert.ok(query.sql.indexOf('count(*) FILTER') < query.sql.indexOf('LIMIT'))
        assert.match(query.sql, /chosen AS \(SELECT id FROM exact_top UNION SELECT id FROM slug_ids\)/)
        if (name) assert.ok(query.values.includes(name))
        const exact = state.Entity.filter(entity => rank(entity) > 0)
        exact.sort((a, b) => rank(b) - rank(a) || compareMatchText(normalizeMatchName(a.title), normalizeMatchName(b.title)) || compareMatchText(a.id, b.id))
        const selected = new Map(exact.slice(0, 10).map(entity => [entity.id, entity]))
        for (const entity of exact) if ((titleSlug && entity.slug === titleSlug) || (externalSlug && entity.slug === externalSlug)) selected.set(entity.id, entity)
        const selection = { exactCount: exact.length, strongCount: exact.filter(entity => rank(entity) >= 90).length,
          candidates: [...selected.values()].map(entity => projected(entity, provenance(entity))) }
        selections.push(selection); measurements.transferredExact += selection.candidates.length; result = [selection]
      } else {
        assert.match(query.sql, /AND NOT \(/); assert.match(query.sql, /ORDER BY[\s\S]*COLLATE "C", e.id LIMIT \?/)
        assert.equal(query.values.at(-1), 201)
        const size = Array.from(name).length, chunks = similarityChunks(name)
        const nearby = (candidate: string) => { const normalized = normalizeMatchName(candidate), length = Array.from(normalized).length
          return length >= Math.max(5, Math.ceil(size * 85 / 100)) && length <= Math.min(250, Math.floor(size * 100 / 85)) && chunks.some(chunk => normalized.includes(chunk)) }
        const pool = state.Entity.filter(entity => !rank(entity) && (nearby(entity.title) || entity.aliases.some(nearby)))
          .sort((a, b) => compareMatchText(normalizeMatchName(a.title), normalizeMatchName(b.title)) || compareMatchText(a.id, b.id)).slice(0, 201)
        measurements.transferredApproximate += pool.length; result = pool.map(entity => projected(entity, false))
      }
      measurements.selectionMs += performance.now() - started; return result
    },
  }, { get(target, property, receiver) {
    if (!Reflect.has(target, property)) { measurements.writes++; throw new Error('Forbidden model or mutation in matching') }
    return Reflect.get(target, property, receiver)
  } })
  const prisma = { async $transaction(work: (client: typeof tx) => Promise<unknown>, options: unknown) {
    assert.deepEqual(options, { isolationLevel: 'RepeatableRead' }); return work(tx)
  } } as unknown as PrismaClient
  return { matcher: createPrismaIngestionMatcher(prisma), state, before, queries, selections, measurements }
}

const exactCases: Array<[IngestionMatchReason, Partial<EntityRow>, MatchContext]> = [
  ['EXACT_TITLE', { title: input.title! }, input],
  ['EXACT_ALIAS', { aliases: [input.title!] }, input],
  ['TITLE_TO_SLUG', { slug: 'station-technique' }, input],
  ['EXTERNAL_ID_TO_SLUG', { slug: 'station-technique' }, { ...input, title: null, externalId: 'fictif/station-technique.md' }],
  ['SAME_SOURCE_AND_LOCATOR', {}, input],
]
for (const [signal, change, context] of exactCases) {
  test(`${signal} finds Entity 351 after 350 unrelated rows, independent of physical table order`, async () => {
    const target = row(351, change), ev = signal === 'SAME_SOURCE_AND_LOCATOR' ? [evidence(1, target.id)] : []
    const entities = [...Array.from({ length: 350 }, (_, i) => row(i + 1)), target]
    for (const rows of [entities, [...entities].reverse()]) {
      const db = database(rows, ev, context), result = await db.matcher(itemId, receiptId)
      assert.ok(result); assert.equal(result.candidates[0]!.id, target.id); assert.ok(result.candidates[0]!.reasons.includes(signal))
      assert.equal(result.exactCandidateCount, 1); assert.equal(result.searchTruncated, false)
      assert.equal(db.measurements.transferredExact, 1)
    }
  })
}

test('the two indexed slug identities survive 350 higher-scored exact titles; only final display hides lower scores', async () => {
  const titles = Array.from({ length: 350 }, (_, i) => row(i + 1, { title: input.title! }))
  const titleTarget = row(351, { slug: 'station-technique' }), externalTarget = row(352, { slug: 'external-technique' })
  const db = database([...titles, titleTarget, externalTarget], [], { ...input, externalId: 'external-technique.md' })
  const result = (await db.matcher(itemId))!
  assert.equal(result.status, 'AMBIGUOUS'); assert.equal(result.strongCandidateCount, 350); assert.equal(result.exactCandidateCount, 352)
  assert.equal(result.candidates.length, 10); assert.equal(result.candidatesTruncated, true); assert.equal(result.searchTruncated, false)
  assert.deepEqual(db.selections[0]!.candidates.slice(-2).map(entity => entity.id), [titleTarget.id, externalTarget.id])
  assert.equal(db.queries.length, 1); assert.equal(db.measurements.transferredExact, 12)
})

test('exact provenance rejects a different Source, a different locator, whitespace/case variants and relation evidence', async () => {
  const target = row(351)
  for (const override of [{ sourceId: uuid(9999) }, { locator: 'fictif/autre.md' }, { locator: input.locator!.toUpperCase() }, { locator: input.locator! + ' ' },
    { entityId: null, relationId: uuid(7000) }, { entityId: target.id, relationId: uuid(7000) }]) {
    const db = database([target], [evidence(1, target.id, override)])
    const result = (await db.matcher(itemId))!; assert.equal(result.status, 'NONE'); assert.equal(result.strongCandidateCount, 0)
  }
  const db = database([target], [evidence(1, target.id), evidence(2, target.id), evidence(3, target.id, { sourceId: uuid(9999) })])
  const result = (await db.matcher(itemId))!; assert.equal(result.status, 'EXACT'); assert.equal(result.candidates[0]!.score, 100)
  assert.equal(result.candidates.length, 1); assert.equal(result.strongCandidateCount, 1)
})

test('externalId is a strict provenance fallback; a merely similar or basenamed locator never gives 100', async () => {
  const target = row(351), context = { ...input, locator: null, externalId: 'fictif/repere.md' }
  assert.equal((await database([target], [evidence(1, target.id)], context).matcher(itemId))!.candidates[0]!.score, 100)
  assert.equal((await database([target], [evidence(1, target.id, { locator: 'repere.md' })], context).matcher(itemId))!.status, 'NONE')
})

test('ambiguity is decided on all distinct exact identities before display limits, never by maximum score alone', async () => {
  const target = row(351, { title: input.title! })
  for (const [other, ev] of [
    [row(352, { title: input.title! }), []],
    [row(352, { aliases: [input.title!] }), []],
    [row(352), [evidence(1, target.id), evidence(2, uuid(352))]],
    [row(352, { aliases: [input.title!] }), [evidence(1, target.id)]],
  ] as const) {
    const result = (await database([target, other], [...ev]).matcher(itemId))!
    assert.equal(result.status, 'AMBIGUOUS'); assert.equal(result.strongCandidateCount, 2)
  }
  const archived = (await database([row(351, { title: input.title!, status: 'ARCHIVED' })]).matcher(itemId))!
  assert.equal(archived.status, 'AMBIGUOUS'); assert.equal(archived.candidates[0]!.status, 'ARCHIVED')
})

test('350 approximate names do not turn a separately proven unique exact into AMBIGUOUS', async () => {
  const approximate = Array.from({ length: 350 }, (_, i) => row(i + 1, { title: 'Station techniquf' }))
  const db = database([...approximate, row(351, { title: input.title! })]), result = (await db.matcher(itemId))!
  assert.equal(result.status, 'EXACT'); assert.equal(result.strongCandidateCount, 1); assert.equal(result.searchTruncated, true)
  assert.equal(result.approximateEvaluatedCount, 200); assert.equal(result.evaluatedCount, 201)
  assert.equal(result.candidates[0]!.id, uuid(351)); assert.equal(result.candidatesTruncated, true)
  assert.equal(db.measurements.transferredApproximate, 201)
})

test('different title/external slug suggestions remain POSSIBLE without inventing strong identity from slugification', async () => {
  const db = database([row(351, { slug: 'station-technique' }), row(352, { slug: 'external-technique' })], [], { ...input, externalId: 'external-technique.md' })
  const result = (await db.matcher(itemId))!; assert.equal(result.status, 'POSSIBLE'); assert.equal(result.strongCandidateCount, 0)
  assert.deepEqual(result.candidates.map(candidate => candidate.score), [80, 75])
})

test('matching leaves all eight editorial/staging models unchanged, including absent/wrong receipt reads', async () => {
  const target = row(351, { title: input.title! }), db = database([target], [evidence(1, target.id)])
  for (let i = 0; i < 3; i++) assert.equal((await db.matcher(itemId, receiptId))!.status, 'EXACT')
  assert.equal(await db.matcher(itemId, uuid(9998)), null); assert.equal(await db.matcher(uuid(9999), receiptId), null)
  for (const model of Object.keys(db.state) as Array<keyof typeof db.state>) assert.deepEqual(db.state[model], db.before[model], model)
  assert.equal(db.measurements.writes, 0)
  const dto = JSON.stringify((await db.matcher(itemId))!)
  assert.doesNotMatch(dto, /bodyMarkdown|metadata|claimText|rawVariant|snapshot|Discord|sourceId|content|updatedAt/)
})

test('fictitious 600-Entity workload measures relational selection and scoring separately without a CI time threshold', async context => {
  const rows = Array.from({ length: 600 }, (_, i) => row(i + 1, { title: i < 350 ? 'Station techniquf' : `Autre fiche technique ${i}`, aliases: i < 350 ? ['Station techniqug', 'Station technixue'] : [] }))
  rows[599] = row(600, { title: input.title! })
  const db = database(rows); await db.matcher(itemId)
  const selection = db.selections[0]!, scorePool = [...selection.candidates, ...rows.slice(0, 200).map(entity => ({ ...entity, sameSourceAndLocator: false }))]
  const started = performance.now(); const result = scoreIngestionMatches(input, scorePool, { exactCount: selection.exactCount, strongCount: selection.strongCount, approximateTruncated: true, approximateEvaluatedCount: 200 })
  const scoringMs = performance.now() - started
  assert.equal(result.status, 'EXACT'); assert.equal(result.evaluatedCount, 201)
  context.diagnostic(`600 fictitious Entities: in-memory selection double ${db.measurements.selectionMs.toFixed(2)} ms; scoring 201 Entities ${scoringMs.toFixed(2)} ms. No PostgreSQL timings measured.`)
})
