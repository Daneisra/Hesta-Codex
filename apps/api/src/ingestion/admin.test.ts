import assert from 'node:assert/strict'
import { once } from 'node:events'
import { after, before, test } from 'node:test'
import { get as httpGet, type Server } from 'node:http'
import type { AdminIngestionBatch, AdminIngestionItem, AdminIngestionItemDetail } from '@hesta-codex/shared'
import { createApp } from '../app.js'
import { readAuthConfig } from '../auth/config.js'
import { sessionHash } from '../auth/session.js'
import type { PrismaClient } from '../prisma-client/client.ts'
import { createPrismaIngestionAdminStore, type IngestionAdminStore } from './admin.js'

const id = '11111111-1111-4111-8111-111111111111'
const batch: AdminIngestionBatch = { id, label: 'Lot fictif', createdAt: '2026-10-04T00:00:00Z', formatVersion: 1,
  receivedCount: 1, newCount: 1, unchangedCount: 0, modifiedCount: 0, warningCount: 0, sourceCount: 1,
  sourceKinds: ['MANUAL'], sources: [{ id, label: 'Origine fictive', kind: 'MANUAL' }] }
const item: AdminIngestionItem = { id, itemId: id, batchId: id, ordinal: 0, outcome: 'NEW', title: 'Fragment privé fictif',
  externalId: 'private-note', locator: 'fixture.md', version: 1, contentHash: 'a'.repeat(64), contentType: 'text/plain', observedAt: null,
  ingestedAt: batch.createdAt, source: batch.sources[0]! }
const detail: AdminIngestionItemDetail = { ...item, content: 'Contenu privé artificiel', metadata: { fictional: true },
  originBatchId: id, snapshotIngestedAt: batch.createdAt, versions: [{ id, version: 1, contentHash: item.contentHash, ingestedAt: batch.createdAt }] }
const filtersReceived: unknown[] = []
let reads = 0
const ingestion: IngestionAdminStore = {
  async listBatches(filters) { reads++; filtersReceived.push(filters); return { items: [batch], total: 1, page: filters.page, pageSize: 20 } },
  async getBatch(requested) { reads++; return requested === id ? batch : null },
  async listItems(filters) { reads++; filtersReceived.push(filters); return { items: [item], total: 1, page: filters.page, pageSize: 20 } },
  async getItem(requested) { reads++; return requested === id ? detail : null },
  async getMatches(requested, receiptId) { reads++; filtersReceived.push({ requested, receiptId });
    return requested === id && (!receiptId || receiptId === id) ? { status: 'NONE', candidates: [], searchTruncated: false, candidatesTruncated: false, evaluatedCount: 0, searchLimit: 200, candidateLimit: 10, exactCandidateCount: 0, strongCandidateCount: 0, approximateEvaluatedCount: 0 } : null },
}
const config = readAuthConfig({ DISCORD_CLIENT_ID: '111111111111111111', DISCORD_CLIENT_SECRET: 'fake',
  DISCORD_REDIRECT_URI: 'http://localhost:5173/api/auth/discord/callback', DISCORD_ADMIN_IDS: '222222222222222222',
  SESSION_SECRET: 'a-test-secret-of-more-than-thirty-two-characters', SESSION_TTL_MS: '3600000' })
let server: Server, base: string
const adminHeaders = { Cookie: `hesta_codex_session=${'a'.repeat(43)}` }
before(async () => {
  server = createApp({ async ping() {}, async listRelationTypes() { return [] }, async listEntities() { return [] }, async getEntityBySlug() { return null } }, {
    auth: { config, store: { async findSession(hash) {
      const discordId = hash === sessionHash('a'.repeat(43)) ? '222222222222222222' : hash === sessionHash('b'.repeat(43)) ? '333333333333333333' : null
      return discordId ? { discordId, username: 'test', displayName: null, expiresAt: new Date(Date.now() + 60_000) } : null
    }, async rotateSession() {}, async revokeSession() {} }, discord: { authorizationUrl: () => '', async exchangeCode() { throw new Error('unused') } } },
    admin: { async listEntities() { return { items: [], total: 0, page: 1, pageSize: 50 } }, async getEntity() { return null },
      async getStats() { return { byStatus: { DRAFT: 0, PROPOSED: 0, PUBLISHED: 0, ARCHIVED: 0 }, byVisibility: { PUBLIC: 0, PLAYERS: 0, GM: 0, SECRET: 0 }, sources: 0, relations: 0 } } },
    editorial: { async patch() { throw new Error('unused') }, async publish() { throw new Error('unused') }, async unpublish() { throw new Error('unused') } }, ingestion,
  }, { async publicGraph() { return { nodes: [], edges: [] } }, async adminGraph() { return { nodes: [], edges: [] } } }).listen(0)
  await once(server, 'listening'); const address = server.address(); assert.ok(address && typeof address !== 'string'); base = `http://127.0.0.1:${address.port}`
})
after(async () => { await new Promise<void>(resolve => server.close(() => resolve())) })

test('all ingestion reads enforce session/whitelist/no-store before consulting staging', async () => {
  for (const path of ['/batches', `/batches/${id}`, '/items', `/items/${id}`, `/items/${id}/matches`]) {
    const initialReads = reads
    const anonymous = await fetch(`${base}/api/admin/ingestion${path}`)
    assert.equal(anonymous.status, 401); assert.equal(anonymous.headers.get('cache-control'), 'no-store')
    const denied = await fetch(`${base}/api/admin/ingestion${path}`, { headers: { Cookie: `hesta_codex_session=${'b'.repeat(43)}` } })
    assert.equal(denied.status, 403); assert.equal(reads, initialReads)
    const allowed = await fetch(`${base}/api/admin/ingestion${path}`, { headers: adminHeaders })
    assert.equal(allowed.status, 200); assert.equal(allowed.headers.get('cache-control'), 'no-store')
  }
})

test('public routes have no staging counterpart, and public entities/search/graph remain untouched', async () => {
  for (const path of ['/api/v1/ingestion/batches', `/api/v1/ingestion/items/${id}`, `/api/v1/ingestion/items/${id}/matches`, '/api/v1/ingestion/items']) {
    const response = await fetch(`${base}${path}`); assert.equal(response.status, 404)
    assert.equal((await response.text()).includes(detail.content), false)
  }
  for (const path of ['/api/v1/entities?q=private', '/api/v1/graph']) {
    const response = await fetch(`${base}${path}`); assert.equal(response.status, 200)
    assert.equal((await response.text()).includes('private-note'), false)
  }
})

test('matching receipt parameters are strict; missing items or receipts belonging elsewhere return 404', async () => {
  const path = `${base}/api/admin/ingestion/items/${id}/matches`
  const valid = await fetch(`${path}?receiptId=${id}`, { headers: adminHeaders })
  assert.equal(valid.status, 200); assert.deepEqual(filtersReceived.at(-1), { requested: id, receiptId: id })
  assert.doesNotMatch(JSON.stringify(await valid.json()), /content|metadata|source|Evidence|Revision|auth/)
  for (const query of ['receiptId=bad', `receiptId=${id}&receiptId=${id}`, 'q=private', 'page=1'])
    assert.equal((await fetch(`${path}?${query}`, { headers: adminHeaders })).status, 400)
  for (const url of [`${path}?receiptId=22222222-2222-4222-8222-222222222222`, `${base}/api/admin/ingestion/items/22222222-2222-4222-8222-222222222222/matches`])
    assert.equal((await fetch(url, { headers: adminHeaders })).status, 404)
  assert.equal((await fetch(`${base}/api/admin/ingestion/items/invalid/matches`, { headers: adminHeaders })).status, 400)
  const crossOrigin = await fetch(path, { method: 'POST', headers: { ...adminHeaders, Origin: 'https://example.invalid' } })
  assert.equal(crossOrigin.status, 403)
})

test('admin ingestion filters are strict, paginated, range checked and never search raw text', async () => {
  const valid = await fetch(`${base}/api/admin/ingestion/items?batchId=${id}&sourceId=${id}&sourceKind=MANUAL&outcome=MODIFIED&page=2&after=2026-10-01T00:00:00Z&before=2026-10-04T00:00:00Z`, { headers: { ...adminHeaders, 'X-Hesta-Ingestion-Search': 'fixture' } })
  assert.equal(valid.status, 200)
  assert.equal((filtersReceived.at(-1) as { page: number }).page, 2)
  for (const query of ['page=1001', 'page=0', 'page=1&page=2', 'sourceId=not-uuid', 'sourceKind=UNKNOWN', 'outcome=PUBLISHED', 'content=private', 'q=x', 'after=bad', 'after=2026-10-04T00:00:00Z&before=2026-10-01T00:00:00Z']) {
    assert.equal((await fetch(`${base}/api/admin/ingestion/items?${query}`, { headers: adminHeaders })).status, 400)
  }
  assert.equal((await fetch(`${base}/api/admin/ingestion/batches/invalid`, { headers: adminHeaders })).status, 400)
  assert.equal((await fetch(`${base}/api/admin/ingestion/items/${id}?receiptId=invalid`, { headers: adminHeaders })).status, 400)
  assert.equal((await fetch(`${base}/api/admin/ingestion/items/22222222-2222-4222-8222-222222222222`, { headers: adminHeaders })).status, 404)
})

test('private search uses a bounded encoded header, rejecting query strings and malformed/repeated headers', async () => {
  const query = 'Origine fictive œ é / #'
  const response = await fetch(`${base}/api/admin/ingestion/batches`, { headers: { ...adminHeaders, 'X-Hesta-Ingestion-Search': encodeURIComponent(query) } })
  assert.equal(response.status, 200); assert.equal((filtersReceived.at(-1) as { q: string }).q, query)
  assert.equal((await fetch(`${base}/api/admin/ingestion/batches?q=fixture`, { headers: adminHeaders })).status, 400)
  for (const header of ['%', 'x', '%00abc', '%ED%A0%80', 'a'.repeat(101), 'a'.repeat(1201)]) {
    assert.equal((await fetch(`${base}/api/admin/ingestion/items`, { headers: { ...adminHeaders, 'X-Hesta-Ingestion-Search': header } })).status, 400)
  }
  const repeatedStatus = await new Promise<number | undefined>((resolve, reject) => {
    httpGet(`${base}/api/admin/ingestion/items`, { headers: { ...adminHeaders, 'X-Hesta-Ingestion-Search': ['fixture', 'again'] } }, response => {
      response.resume(); response.on('end', () => resolve(response.statusCode))
    }).on('error', reject)
  })
  assert.equal(repeatedStatus, 400)
})

test('staging mutations do not exist and the existing Origin protection still rejects bad origins', async () => {
  const path = `${base}/api/admin/ingestion/items`
  assert.equal((await fetch(path, { method: 'POST', headers: adminHeaders })).status, 403)
  assert.equal((await fetch(path, { method: 'POST', headers: { ...adminHeaders, Origin: 'https://example.invalid' } })).status, 403)
  assert.equal((await fetch(path, { method: 'POST', headers: { ...adminHeaders, Origin: config.origin } })).status, 404)
})

test('admin staging failures preserve no-store and hide private database details in responses and logs', async context => {
  const original = ingestion.listBatches, originalMatches = ingestion.getMatches, logged: unknown[][] = []
  context.mock.method(console, 'error', (...values: unknown[]) => { logged.push(values) })
  ingestion.listBatches = async () => { throw new Error('fictional private database detail') }
  ingestion.getMatches = async () => { throw new Error('fictional private matching locator') }
  try {
    for (const path of ['/batches', `/items/${id}/matches`]) {
      logged.length = 0
      const response = await fetch(`${base}/api/admin/ingestion${path}`, { headers: adminHeaders })
      assert.equal(response.status, 500); assert.equal(response.headers.get('cache-control'), 'no-store')
      assert.equal((await response.text()).includes('fictional private'), false)
      assert.deepEqual(logged, [['Hesta Codex API request failed']])
    }
  } finally { ingestion.listBatches = original; ingestion.getMatches = originalMatches }
})

test('Prisma list projections are bounded and exclude raw content, variants and metadata', async () => {
  const calls: Array<{ table: string; query: Record<string, unknown> }> = []
  const summaryRow = { ...item, observedAt: null, ingestedAt: new Date(item.ingestedAt),
    item: { id, externalId: item.externalId, version: 1, contentHash: item.contentHash, source: item.source } }
  const prisma = { ingestionReceipt: { async findMany(query: Record<string, unknown>) { calls.push({ table: 'receipts', query }); return [summaryRow] }, async count() { return 1 } } } as unknown as PrismaClient
  const store = createPrismaIngestionAdminStore(prisma)
  const result = await store.listItems({ page: 2, sourceKind: 'MANUAL', q: 'fixture' })
  assert.equal(result.pageSize, 20)
  assert.equal(calls[0]?.query.take, 20); assert.equal(calls[0]?.query.skip, 20)
  const selected = JSON.stringify(calls[0]?.query.select)
  for (const field of ['"content"', 'rawVariant', 'metadata']) assert.equal(selected.includes(field), false)
  assert.equal(JSON.stringify(calls[0]?.query.where).includes('content'), false)
  for (const field of ['content', 'rawVariant', 'metadata']) assert.equal(Object.hasOwn(result.items[0]!, field), false)
})

test('Prisma detail reconstructs the exact observation, requires a receipt belonging to the item and bounds version history', async () => {
  const queries: unknown[] = []
  const prisma = { ingestionReceipt: { async findFirst(query: unknown) { queries.push(query); return {
    ...item, observedAt: null, ingestedAt: new Date(item.ingestedAt), metadata: { fictional: true }, rawVariant: 'e\u0301\nExact.',
    item: { id, batchId: id, externalId: item.externalId, version: 1, contentHash: item.contentHash, source: item.source,
      content: 'é\r\nExact.', identityKey: 'e:' + 'a'.repeat(64), ingestedAt: new Date(item.ingestedAt) },
  } } }, ingestionItem: { async findMany(query: unknown) { queries.push(query); return [] } } } as unknown as PrismaClient
  const result = await createPrismaIngestionAdminStore(prisma).getItem(id, id)
  assert.equal(result?.content, 'e\u0301\nExact.')
  assert.deepEqual((queries[0] as { where: unknown }).where, { itemId: id, id })
  assert.equal((queries[1] as { take: number }).take, 20)
})

test('Prisma batch lists filter receipts, paginate stably and aggregate Sources without loading content or metadata', async () => {
  const queries: Array<Record<string, unknown>> = []
  const sources = Array.from({ length: 22 }, (_, i) => ({ ...item.source, id: `fictional-source-${i}`, kind: i % 2 ? 'OBSIDIAN' : 'MANUAL' }))
  const prisma = {
    ingestionBatch: { async findMany(query: Record<string, unknown>) { queries.push(query); return [{ ...batch, createdAt: new Date(batch.createdAt) }] }, async count() { return 21 } },
    ingestionReceipt: { async findMany(query: Record<string, unknown>) { queries.push(query); return [...sources, sources[0]!].map(source => ({ batchId: id, item: { source } })) } },
  } as unknown as PrismaClient
  const result = await createPrismaIngestionAdminStore(prisma).listBatches({ page: 2, sourceId: id, sourceKind: 'MANUAL', outcome: 'MODIFIED', q: 'fixture', after: '2026-10-01T00:00:00Z' })
  assert.equal(queries[0]?.take, 20); assert.equal(queries[0]?.skip, 20)
  assert.deepEqual(queries[0]?.orderBy, [{ createdAt: 'desc' }, { id: 'desc' }])
  const where = queries[0]?.where as { createdAt: unknown; receipts: { some: { outcome: string; item: unknown } } }
  assert.deepEqual(where.createdAt, { gte: new Date('2026-10-01T00:00:00Z') })
  assert.equal(where.receipts.some.outcome, 'MODIFIED')
  assert.deepEqual(where.receipts.some.item, { sourceId: id, source: { kind: 'MANUAL' } })
  assert.equal(result.items[0]?.sourceCount, 22); assert.equal(result.items[0]?.sources.length, 20)
  assert.deepEqual(result.items[0]?.sourceKinds, ['MANUAL', 'OBSIDIAN'])
  for (const query of queries) assert.doesNotMatch(JSON.stringify(query), /"(?:content|rawVariant|metadata)"/)
})
