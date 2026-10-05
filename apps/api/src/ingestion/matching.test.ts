import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Prisma, PrismaClient } from '../prisma-client/client.ts'
import { compareMatchText, externalIdSlug, matchSimilarity, matchSlug, normalizeMatchName, similarityChunks } from './matching-normalization.js'
import { createPrismaIngestionMatcher, MATCH_SEARCH_LIMIT, scoreIngestionMatches, type MatchContext, type MatchEntity } from './matching.js'

const id = '11111111-1111-4111-8111-111111111111'
const context: MatchContext = { title: 'Station technique', sourceId: id, locator: 'notes/fixture.md', externalId: 'notes/fixture.md' }
const entity = (overrides: Partial<MatchEntity> = {}): MatchEntity => ({ id, title: 'Station technique', slug: 'station-technique',
  kind: 'PLACE', placeKind: 'CITY', aliases: [], status: 'DRAFT', visibility: 'SECRET', sameSourceAndLocator: false, ...overrides })
const match = (overrides: Partial<MatchEntity> = {}, input: Partial<MatchContext> = {}) => scoreIngestionMatches({ ...context, ...input }, [entity(overrides)])

test('exact normalization preserves accents/punctuation, collapses explicit Unicode spaces and handles NFC/case', () => {
  assert.equal(normalizeMatchName(' \tE\u0301COLE\u00a0\u202fTECHNIQUE\n'), 'école technique')
  assert.notEqual(normalizeMatchName('ecole'), normalizeMatchName('école'))
  assert.notEqual(normalizeMatchName('Jean-Luc'), normalizeMatchName('Jean Luc'))
  assert.equal(normalizeMatchName('\ud800bad'), '')
  assert.equal(normalizeMatchName('𐐀 🧪'), '𐐨 🧪')
  assert.equal(matchSlug('École technique !'), 'ecole-technique')
})
test('external basename handles Windows/POSIX text extensions without fetching URLs or guessing query strings', () => {
  assert.equal(externalIdSlug('dossier\\Station technique.MD'), 'station-technique')
  assert.equal(externalIdSlug('notes/station-technique.txt'), 'station-technique')
  for (const value of ['https://example.invalid/a.md', 'notes/a.md?secret=1', 'notes/']) assert.equal(externalIdSlug(value), '')
})
test('exact title and case differences give an informative EXACT at 90', () => {
  for (const title of ['Station technique', 'STATION TECHNIQUE', '  station\ttechnique ']) {
    const result = match({}, { title }); assert.equal(result.status, 'EXACT'); assert.equal(result.candidates[0]!.score, 90)
    assert.ok(result.candidates[0]!.reasons.includes('EXACT_TITLE'))
  }
})
test('normalized alias gives EXACT regardless of status/visibility, only useful aliases are projected', () => {
  const result = match({ title: 'Autre fiche', aliases: ['SECRET UNRELATED', 'station TECHNIQUE'], slug: 'autre-fiche', status: 'PROPOSED' })
  assert.equal(result.status, 'EXACT'); assert.deepEqual(result.candidates[0]!.reasons, ['EXACT_ALIAS'])
  assert.deepEqual(result.candidates[0]!.aliases, ['station TECHNIQUE'])
})
test('title to slug is possible at 80 with an explicit lossy slug normalization reason', () => {
  const result = match({ title: 'Autre fiche', slug: 'ecole-technique' }, { title: 'École technique' })
  assert.equal(result.status, 'POSSIBLE'); assert.equal(result.candidates[0]!.score, 80)
  assert.deepEqual(result.candidates[0]!.reasons, ['TITLE_TO_SLUG'])
})
test('external basename to slug is possible at 75 even without a receipt title', () => {
  const result = match({}, { title: null, externalId: 'fictif/station-technique.md' })
  assert.equal(result.status, 'POSSIBLE'); assert.equal(result.candidates[0]!.score, 75)
  assert.deepEqual(result.candidates[0]!.reasons, ['EXTERNAL_ID_TO_SLUG'])
})
test('exact Source and locator provenance has score 100 without narrative signals', () => {
  const result = match({ sameSourceAndLocator: true, title: 'Autre fiche', slug: 'autre' }, { title: null })
  assert.equal(result.status, 'EXACT'); assert.equal(result.candidates[0]!.score, 100)
  assert.deepEqual(result.candidates[0]!.reasons, ['SAME_SOURCE_AND_LOCATOR'])
})
test('conservative code point Levenshtein accepts ≥85% and rejects short, long and weak names', () => {
  assert.equal(matchSimilarity('abcde', 'abcdf'), 0)
  assert.ok(Math.abs(matchSimilarity('abcdefg', 'abcdefh') - 6 / 7) < 1e-12)
  assert.ok(Math.abs(matchSimilarity('🧪abcdef', '🧪abcdeg') - 6 / 7) < 1e-12)
  assert.equal(matchSimilarity('a'.repeat(251), 'a'.repeat(251)), 0)
  assert.equal(matchSimilarity('station technique', 'entièrement différent'), 0)
  assert.equal(match({ title: 'Station techniquf', slug: 'autre' }).status, 'POSSIBLE')
  assert.deepEqual(match({ title: 'Autre', aliases: ['Station techniquf'], slug: 'autre' }).candidates[0]!.reasons, ['SIMILAR_ALIAS'])
})
test('approximate retrieval chunks cover first/middle/final edits and insertions at the threshold', () => {
  for (const [title, nearby] of [['abcdefg', 'xbcdefg'], ['abcdefg', 'abcxefg'], ['abcdefg', 'abcdefx'], ['abcdef', 'xabcdef'], ['station technique', 'station techniqueX']]) {
    assert.ok(matchSimilarity(title!, nearby!) > 0)
    assert.ok(similarityChunks(title!).some(chunk => nearby!.includes(chunk)))
  }
})
test('NONE for unrelated candidates and empty title; neither metadata nor raw text participates', () => {
  assert.equal(match({ title: 'Sans rapport', slug: 'sans-rapport' }).status, 'NONE')
  assert.equal(match({}, { title: null }).status, 'NONE')
  const poisoned = entity() as MatchEntity & { content: string; bodyMarkdown: string; metadata: unknown }
  poisoned.content = 'private narrative'; poisoned.bodyMarkdown = 'private body'; poisoned.metadata = { private: true }
  const output = JSON.stringify(scoreIngestionMatches(context, [poisoned]))
  assert.doesNotMatch(output, /content|bodyMarkdown|metadata|sameSourceAndLocator|private/)
})
test('multiple strong titles/aliases/types stay AMBIGUOUS even when provenance outweighs the other', () => {
  for (const other of [entity({ id: '2', kind: 'PERSON', placeKind: null }), entity({ id: '2', title: 'Autre', aliases: [context.title!] })]) {
    const result = scoreIngestionMatches(context, [other, entity({ sameSourceAndLocator: true })])
    assert.equal(result.status, 'AMBIGUOUS'); assert.equal(result.candidates.length, 2)
  }
})
test('a strong archived entity is AMBIGUOUS, and an approximate archived entity remains visible', () => {
  const strong = match({ status: 'ARCHIVED' }); assert.equal(strong.status, 'AMBIGUOUS')
  assert.equal(strong.candidates[0]!.status, 'ARCHIVED')
  const approximate = match({ title: 'Station techniquf', slug: 'autre', status: 'ARCHIVED' })
  assert.equal(approximate.status, 'POSSIBLE'); assert.equal(approximate.candidates[0]!.status, 'ARCHIVED')
})
test('score is maximum signal (not additive), publication/visibility never increase it', () => {
  const draft = match().candidates[0]!, published = match({ status: 'PUBLISHED', visibility: 'PUBLIC' }).candidates[0]!
  assert.equal(draft.score, published.score); assert.equal(draft.score, 90)
  assert.deepEqual(draft.reasons, ['EXACT_TITLE', 'TITLE_TO_SLUG'])
})
test('ties sort by normalized title then UUID independent of retrieval order, using Unicode code points', () => {
  const rows = [entity({ title: 'Zeta', aliases: [context.title!], id: '3' }), entity({ title: 'Alpha', aliases: [context.title!], id: '2' }), entity({ title: 'ALPHA', aliases: [context.title!], id: '1' })]
  assert.deepEqual(scoreIngestionMatches(context, rows).candidates.map(row => row.id), ['1', '2', '3'])
  assert.deepEqual(scoreIngestionMatches(context, [...rows].reverse()), scoreIngestionMatches(context, rows))
  assert.ok(compareMatchText('\ue000', '🧪') < 0)
})
test('display cap is 10, exact scoring is not sliced at 200 and approximate truncation does not hide strong identities', () => {
  const rows = Array.from({ length: 12 }, (_, i) => entity({ id: String(i) }))
  const result = scoreIngestionMatches(context, rows)
  assert.equal(result.candidates.length, 10); assert.equal(result.candidatesTruncated, true); assert.equal(result.searchTruncated, false)
  const volume = scoreIngestionMatches(context, Array.from({ length: 201 }, (_, i) => entity({ id: String(i) })))
  assert.equal(volume.evaluatedCount, 201); assert.equal(volume.searchTruncated, false)
  assert.equal(scoreIngestionMatches(context, [entity()], { approximateTruncated: true }).status, 'EXACT')
  assert.equal(scoreIngestionMatches(context, [], { approximateTruncated: true }).status, 'NONE')
  assert.equal(scoreIngestionMatches(context, [entity()], { exactCount: 300, strongCount: 300 }).status, 'AMBIGUOUS')
})

function repositoryFixture(options: { absent?: boolean; strong?: MatchEntity[]; fuzzy?: MatchEntity[]; title?: string | null; externalId?: string | null; locator?: string | null } = {}) {
  const receiptQueries: unknown[] = [], queries: Prisma.Sql[] = [], transactions: unknown[] = []
  // Every mutation, or read of a forbidden model/field, is absent: accidental calls fail.
  const tx = {
    ingestionReceipt: { async findFirst(query: unknown) { receiptQueries.push(query); return options.absent ? null : {
      title: options.title === undefined ? context.title : options.title, locator: options.locator === undefined ? context.locator : options.locator,
      item: { sourceId: id, externalId: options.externalId === undefined ? context.externalId : options.externalId } } } },
    async $queryRaw(query: Prisma.Sql) { queries.push(query); return queries.length === 1 ? [{ candidates: options.strong ?? [],
      exactCount: options.strong?.length ?? 0, strongCount: options.strong?.length ?? 0 }] : options.fuzzy ?? [] },
  }
  const prisma = { async $transaction(work: (client: typeof tx) => Promise<unknown>, config: unknown) { transactions.push(config); return work(tx) } } as unknown as PrismaClient
  return { matcher: createPrismaIngestionMatcher(prisma), receiptQueries, queries, transactions }
}
test('Prisma matcher selects the exact requested receipt, only identity fields, in a consistent read transaction', async () => {
  const fixture = repositoryFixture({ strong: [entity()] })
  const result = await fixture.matcher(id, id); assert.equal(result!.status, 'EXACT')
  assert.deepEqual(fixture.receiptQueries[0], { where: { itemId: id, id }, orderBy: [{ ingestedAt: 'desc' }, { ordinal: 'desc' }, { id: 'desc' }],
    select: { title: true, locator: true, item: { select: { sourceId: true, externalId: true } } } })
  assert.deepEqual(fixture.transactions, [{ isolationLevel: 'RepeatableRead' }])
  assert.equal(fixture.queries.length, 2)
  for (const query of fixture.queries) {
    assert.doesNotMatch(query.sql, /bodyMarkdown|content|metadata|claimText|sourceExcerpt|Revision|"Relation"|INSERT|UPDATE|DELETE/)
    assert.ok(query.sql.includes('LIMIT ?')); assert.ok(query.sql.includes('ORDER BY'))
  }
})
test('absent or wrong-item receipt returns null without querying entities', async () => {
  const fixture = repositoryFixture({ absent: true }); assert.equal(await fixture.matcher(id, id), null); assert.equal(fixture.queries.length, 0)
})
test('default receipt order matches detail; blank identity skips Entity reads', async () => {
  const fixture = repositoryFixture({ title: null, locator: null, externalId: null })
  assert.equal((await fixture.matcher(id))!.status, 'NONE'); assert.equal(fixture.queries.length, 0)
  assert.deepEqual((fixture.receiptQueries[0] as { where: unknown }).where, { itemId: id })
})
test('Source UUID and exact locators use bound SQL parameters; no wildcard interpretation or relation evidence', async () => {
  const title = "Fictif' OR true -- %_", fixture = repositoryFixture({ title, strong: [entity({ sameSourceAndLocator: true })] })
  await fixture.matcher(id)
  const query = fixture.queries[0]!
  assert.doesNotMatch(query.sql, /Fictif|notes\/fixture\.md/); assert.ok(query.values.includes(normalizeMatchName(title)))
  assert.ok(query.values.includes(id)); assert.ok(query.sql.includes('ev."entityId" AS id')); assert.ok(query.sql.includes('ev.locator IN'))
  assert.ok(query.sql.includes('ev."relationId" IS NULL'))
  assert.ok(fixture.queries[1]!.sql.includes('strpos'))
})
test('oversized locators cannot match Evidence varchar(250), externalId still provides an exact locator fallback', async () => {
  const fixture = repositoryFixture({ locator: 'x'.repeat(251), externalId: 'fallback.md' }); await fixture.matcher(id)
  assert.equal(fixture.queries[0]!.values.includes('x'.repeat(251)), false); assert.ok(fixture.queries[0]!.values.includes('fallback.md'))
})
test('exact counts are complete before the output LIMIT; only approximate selection has a 200+1 probe', async () => {
  const strong = repositoryFixture({ strong: Array.from({ length: 10 }, (_, i) => entity({ id: String(i) })) })
  assert.equal((await strong.matcher(id))!.searchTruncated, false); assert.equal(strong.queries.length, 1)
  assert.equal(strong.queries[0]!.values.at(-1), 10)
  const fuzzy = repositoryFixture({ strong: [entity()], fuzzy: Array.from({ length: 201 }, (_, i) => entity({ id: String(i), title: 'Station techniquf', slug: 'autre' })) })
  const result = await fuzzy.matcher(id); assert.equal(result!.searchTruncated, true); assert.equal(result!.evaluatedCount, 201)
  assert.equal(result!.status, 'EXACT'); assert.equal(fuzzy.queries[1]!.values.at(-1), MATCH_SEARCH_LIMIT + 1)
})

test('normalization keeps typographic apostrophes, dashes and punctuation distinct from exact identities', () => {
  for (const [left, right] of [["L'école", 'L’école'], ['Jean-Luc', 'Jean–Luc'], ['Nom !', 'Nom'], ['æ', 'ae'], ['Ølf', 'Olf']])
    assert.notEqual(normalizeMatchName(left!), normalizeMatchName(right!))
  for (const name of ['', ' ', '\u00a0\t\n']) assert.equal(normalizeMatchName(name), '')
  assert.equal(matchSlug('L’école — fictive'), 'l-ecole-fictive')
  assert.equal(normalizeMatchName('École'), normalizeMatchName('E\u0301cole'))
  assert.equal(normalizeMatchName('東京'), '東京')
  assert.equal(matchSlug('東京'), '')
})

test('Levenshtein meets the exact 85% boundary at 5/250 points and agrees with an independent full matrix', () => {
  const reference = (left: string, right: string) => {
    const a = Array.from(left), b = Array.from(right), rows = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0))
    for (let i = 0; i <= a.length; i++) rows[i]![0] = i
    for (let j = 0; j <= b.length; j++) rows[0]![j] = j
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) rows[i]![j] = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + Number(a[i - 1] !== b[j - 1]))
    const length = Math.max(a.length, b.length), distance = rows[a.length]![b.length]!
    return Math.min(a.length, b.length) >= 5 && length <= 250 && distance * 100 <= length * 15 ? 1 - distance / length : 0
  }
  for (const size of [5, 7, 20, 40, 85, 100, 250]) {
    const name = 'a'.repeat(size), edits = Math.floor(size * 15 / 100)
    for (const distance of [0, edits, edits + 1]) {
      const nearby = 'b'.repeat(distance) + 'a'.repeat(size - distance)
      assert.equal(matchSimilarity(name, nearby), reference(name, nearby))
    }
    const inserted = name + '🧪'
    assert.equal(matchSimilarity(name, inserted), reference(name, inserted))
  }
  for (const [left, right] of [['abcde', 'abcde'], ['', ''], ['a', 'b'], ['𐐨🧪abcdef', '𐐨🧪abcdeg'], ['abcdefgh', 'cdefghab']])
    assert.equal(matchSimilarity(left!, right!), reference(left!, right!))
})

test('UUID deduplication precedes ambiguity and merges multiple compatible provenance observations', () => {
  const result = scoreIngestionMatches(context, [entity(), entity({ sameSourceAndLocator: true }), entity({ sameSourceAndLocator: true })])
  assert.equal(result.status, 'EXACT'); assert.equal(result.strongCandidateCount, 1); assert.equal(result.candidates.length, 1)
  assert.equal(result.candidates[0]!.score, 100)
})
