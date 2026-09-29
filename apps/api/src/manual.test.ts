import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { Server } from 'node:http'
import { after, before, test } from 'node:test'
import type { AdminEntityDetail } from '@hesta-codex/shared'
import { Prisma, type PrismaClient } from './prisma-client/client.ts'
import { createPrismaManualService, type ManualService } from './admin/manual.js'
import { manualCreateSchema } from './admin/manual-validation.js'
import { createApp } from './app.js'
import { readAuthConfig } from './auth/config.js'
import { sessionHash } from './auth/session.js'
import { createPrismaStore } from './store.js'

const now = new Date('2026-09-29T12:00:00.000Z')
const sourceId = '11111111-1111-4111-8111-111111111111'
const input = {
  entity: { slug: 'nouvelle-fiche', kind: 'PERSON', placeKind: null, title: 'Nouvelle fiche', summary: null,
    bodyMarkdown: '## Notes', aliases: ['Alias'], tags: ['quête'], visibility: 'GM' },
  source: { mode: 'new', data: { kind: 'MANUAL', label: 'Notes de partie', externalId: 'notes-01',
    url: null, authorLabel: 'MJ', publishedAt: null, visibility: 'GM' } },
  evidence: { claimText: 'Fait vérifié', sourceExcerpt: null, locator: 'p. 1', timeStartSeconds: 0,
    timeEndSeconds: 30, confidence: 0.8, visibility: 'GM' },
} as const

type Row = Record<string, unknown>
type State = { sources: Row[]; entities: Row[]; evidence: Row[]; revisions: Row[] }
function memoryDatabase(existingSources: Row[] = []) {
  let state: State = { sources: structuredClone(existingSources), entities: [], evidence: [], revisions: [] }
  let failAt: 'source' | 'entity' | 'entityUnique' | 'evidence' | 'evidenceForeignKey' | 'revision' | null = null
  const operations: string[] = []
  const globalWrites: string[] = []
  const sourceQueries: unknown[] = []
  let id = 0
  const unique = () => new Prisma.PrismaClientKnownRequestError('sensitive database detail',
    { code: 'P2002', clientVersion: '7.10.0' })
  const foreignKey = () => new Prisma.PrismaClientKnownRequestError('sensitive database detail',
    { code: 'P2003', clientVersion: '7.10.0' })
  const outside = (model: string) => {
    globalWrites.push(model)
    throw new Error(`Write outside transaction: ${model}`)
  }
  const prisma = {
    source: {
      async create() { return outside('source') },
      async findMany(query: { where: { OR?: Array<Record<string, { contains: string }>> }; skip: number; take: number }) {
        sourceQueries.push(query)
        const term = query.where.OR?.[0]?.label?.contains.toLowerCase()
        return state.sources.filter((item) => !term || String(item.label).toLowerCase().includes(term))
          .sort((a, b) => String(a.label).localeCompare(String(b.label))).slice(query.skip, query.skip + query.take)
      },
      async count(query: { where: { OR?: Array<Record<string, { contains: string }>> } }) {
        const term = query.where.OR?.[0]?.label?.contains.toLowerCase()
        return state.sources.filter((item) => !term || String(item.label).toLowerCase().includes(term)).length
      },
    },
    entity: { async create() { return outside('entity') } },
    evidence: { async create() { return outside('evidence') } },
    revision: { async create() { return outside('revision') } },
    async $transaction<T>(work: (tx: unknown) => Promise<T>) {
      const pending = structuredClone(state)
      const tx = {
        source: {
          async findUnique(query: { where: { id: string } }) {
            return pending.sources.find((item) => item.id === query.where.id) ?? null
          },
          async create(query: { data: Row }) {
            operations.push('source')
            if (failAt === 'source') throw new Error('injected source failure')
            if (query.data.externalId !== null && pending.sources.some((item) =>
              item.kind === query.data.kind && item.externalId === query.data.externalId)) throw unique()
            const row = { ...query.data, id: `source-${++id}`, createdAt: now, updatedAt: now }
            pending.sources.push(row)
            return row
          },
        },
        entity: {
          async findUnique(query: { where: { slug: string }; select?: Row }) {
            const row = pending.entities.find((item) => item.slug === query.where.slug)
            if (!row) return null
            if (query.select?.id && Object.keys(query.select).length === 1) return { id: row.id }
            return { ...row, evidence: pending.evidence.filter((proof) => proof.entityId === row.id)
              .map((proof) => ({ ...proof, source: pending.sources.find((item) => item.id === proof.sourceId) })),
              revisions: pending.revisions.filter((revision) => revision.entityId === row.id),
              outgoingRelations: [], incomingRelations: [] }
          },
          async create(query: { data: Row }) {
            operations.push('entity')
            if (failAt === 'entity') throw new Error('injected entity failure')
            if (failAt === 'entityUnique') throw unique()
            if (pending.entities.some((item) => item.slug === query.data.slug)) throw unique()
            const row = { ...query.data, id: `entity-${++id}`, createdAt: now, updatedAt: now,
              metadata: null }
            pending.entities.push(row)
            return row
          },
        },
        evidence: { async create(query: { data: Row }) {
          operations.push('evidence')
          if (failAt === 'evidence') throw new Error('injected evidence failure')
          if (failAt === 'evidenceForeignKey') throw foreignKey()
          const row = { ...query.data, id: `evidence-${++id}`, createdAt: now, updatedAt: now }
          pending.evidence.push(row)
          return row
        } },
        revision: { async create(query: { data: Row }) {
          operations.push('revision')
          if (failAt === 'revision') throw new Error('injected revision failure')
          const row = { ...query.data, id: `revision-${++id}`, createdAt: now }
          pending.revisions.push(row)
          return row
        } },
      }
      const result = await work(tx)
      state = pending
      return result
    },
  } as unknown as PrismaClient
  return { service: createPrismaManualService(prisma), operations, globalWrites, sourceQueries,
    state: () => structuredClone(state), fail: (at: typeof failAt) => { failAt = at } }
}

test('manual creation commits Source, PROPOSED GM Entity, Evidence and Revision #1 together', async () => {
  const db = memoryDatabase()
  const detail = await db.service.create(manualCreateSchema.parse(input), 'Danny')
  assert.deepEqual(db.operations, ['source', 'entity', 'evidence', 'revision'])
  assert.deepEqual(db.globalWrites, [])
  assert.equal(detail.slug, 'nouvelle-fiche')
  assert.equal(detail.status, 'PROPOSED')
  assert.equal(detail.visibility, 'GM')
  assert.equal(detail.publishedAt, null)
  assert.equal(detail.evidence.length, 1)
  assert.equal(detail.evidence[0]?.source.label, 'Notes de partie')
  assert.equal(detail.revisions[0]?.number, 1)
  assert.equal(detail.revisions[0]?.editorLabel, 'Danny')
  assert.deepEqual(detail.revisions[0]?.snapshot, { version: 1, entity: {
    slug: 'nouvelle-fiche', kind: 'PERSON', placeKind: null, title: 'Nouvelle fiche', summary: null,
    bodyMarkdown: '## Notes', aliases: ['Alias'], tags: ['quête'], status: 'PROPOSED',
    visibility: 'GM', publishedAt: null,
  } })
  const state = db.state()
  assert.deepEqual([state.sources.length, state.entities.length, state.evidence.length, state.revisions.length],
    [1, 1, 1, 1])
  assert.equal(state.evidence[0]?.relationId, null)
  assert.equal(state.evidence[0]?.entityId, state.entities[0]?.id)
})

test('manual PROPOSED Entity stays absent from both public reads even with all visibilities PUBLIC', async () => {
  const db = memoryDatabase()
  const request = manualCreateSchema.parse({ ...input,
    entity: { ...input.entity, visibility: 'PUBLIC' },
    source: { ...input.source, data: { ...input.source.data, visibility: 'PUBLIC' } },
    evidence: { ...input.evidence, visibility: 'PUBLIC' },
  })
  await db.service.create(request, 'Danny')
  const state = db.state()
  assert.equal(state.entities[0]?.status, 'PROPOSED')
  const prisma = { entity: {
    async findMany(query: { where: { status: string; visibility: string } }) {
      return state.entities.filter((row) => row.status === query.where.status && row.visibility === query.where.visibility)
    },
    async findFirst(query: { where: { slug: string; status: string; visibility: string } }) {
      return state.entities.find((row) => row.slug === query.where.slug && row.status === query.where.status &&
        row.visibility === query.where.visibility) ?? null
    },
  } } as unknown as PrismaClient
  const publicStore = createPrismaStore(prisma)
  assert.deepEqual(await publicStore.listEntities({}), [])
  assert.equal(await publicStore.getEntityBySlug('nouvelle-fiche'), null)
})

test('existing Source is reused without modification and missing Source is rejected', async () => {
  const original = { id: sourceId, kind: 'MANUAL', label: 'Document partagé', externalId: null, url: null,
    authorLabel: null, publishedAt: null, visibility: 'GM', createdAt: now, updatedAt: now }
  const db = memoryDatabase([original])
  const request = manualCreateSchema.parse({ ...input, source: { mode: 'existing', sourceId } })
  await db.service.create(request, 'Danny')
  assert.deepEqual(db.operations, ['entity', 'evidence', 'revision'])
  assert.deepEqual(db.state().sources, [original])
  assert.equal(db.state().evidence[0]?.sourceId, sourceId)
  const missing = memoryDatabase()
  await assert.rejects(missing.service.create(request, 'Danny'), { code: 'SOURCE_NOT_FOUND', status: 404 })
  assert.deepEqual(missing.state(), { sources: [], entities: [], evidence: [], revisions: [] })
})

test('each failed write rolls back the complete lot, including a newly created Source', async () => {
  for (const at of ['source', 'entity', 'evidence', 'revision'] as const) {
    const db = memoryDatabase()
    db.fail(at)
    await assert.rejects(db.service.create(manualCreateSchema.parse(input), 'Danny'), /injected/)
    assert.deepEqual(db.state(), { sources: [], entities: [], evidence: [], revisions: [] }, at)
    assert.deepEqual(db.globalWrites, [], at)
    assert.deepEqual(db.operations, ['source', 'entity', 'evidence', 'revision'].slice(0,
      ['source', 'entity', 'evidence', 'revision'].indexOf(at) + 1))
    db.fail(null)
    await db.service.create(manualCreateSchema.parse(input), 'Danny')
    const retried = db.state()
    assert.deepEqual([retried.sources.length, retried.entities.length, retried.evidence.length, retried.revisions.length],
      [1, 1, 1, 1], at)
  }
})

test('an existing Source deleted before Evidence INSERT returns a safe 404 and rolls back', async () => {
  const existing = { id: sourceId, kind: 'MANUAL', label: 'Document', externalId: null, url: null,
    authorLabel: null, publishedAt: null, visibility: 'GM', createdAt: now, updatedAt: now }
  const db = memoryDatabase([existing])
  db.fail('evidenceForeignKey')
  const request = manualCreateSchema.parse({ ...input, source: { mode: 'existing', sourceId } })
  await assert.rejects(db.service.create(request, 'Danny'), { code: 'SOURCE_NOT_FOUND', status: 404 })
  assert.deepEqual(db.state(), { sources: [existing], entities: [], evidence: [], revisions: [] })
  assert.deepEqual(db.globalWrites, [])
})

test('slug and Source uniqueness conflicts are distinct and do not leave partial writes', async () => {
  const db = memoryDatabase()
  await db.service.create(manualCreateSchema.parse(input), 'Danny')
  const before = db.state()
  await assert.rejects(db.service.create(manualCreateSchema.parse(input), 'Danny'),
    { code: 'ENTITY_CONFLICT', status: 409 })
  assert.deepEqual(db.state(), before)
  const second = manualCreateSchema.parse({ ...input, entity: { ...input.entity, slug: 'autre-fiche' } })
  await assert.rejects(db.service.create(second, 'Danny'), { code: 'SOURCE_CONFLICT', status: 409 })
  assert.deepEqual(db.state(), before)
})

test('a slug collision during INSERT returns ENTITY_CONFLICT and rolls back a new Source', async () => {
  const db = memoryDatabase()
  db.fail('entityUnique')
  await assert.rejects(db.service.create(manualCreateSchema.parse(input), 'Danny'),
    { code: 'ENTITY_CONFLICT', status: 409 })
  assert.deepEqual(db.state(), { sources: [], entities: [], evidence: [], revisions: [] })
})

test('new Sources without externalId are not deduplicated by label', async () => {
  const db = memoryDatabase()
  const first = { ...input, source: { ...input.source, data: { ...input.source.data, externalId: null } } }
  await db.service.create(manualCreateSchema.parse(first), 'Danny')
  await db.service.create(manualCreateSchema.parse({ ...first,
    entity: { ...first.entity, slug: 'deuxieme-fiche' } }), 'Danny')
  const state = db.state()
  assert.equal(state.sources.length, 2)
  assert.equal(state.sources[0]?.label, state.sources[1]?.label)
  assert.notEqual(state.sources[0]?.id, state.sources[1]?.id)
})

test('validation rejects unknown fields, ambiguous Source, invalid Entity and invalid Evidence', () => {
  for (const candidate of [
    { ...input, entity: { ...input.entity, status: 'PUBLISHED' } },
    { ...input, entity: { ...input.entity, publishedAt: now.toISOString() } },
    { ...input, entity: { ...input.entity, metadata: {} } },
    { ...input, entity: { ...input.entity, id: sourceId } },
    { ...input, editorLabel: 'falsified' },
    { ...input, evidence: { ...input.evidence, sourceId } },
    { ...input, evidence: { ...input.evidence, relationId: sourceId } },
    { ...input, source: { mode: 'existing', sourceId, data: input.source.data } },
    { ...input, source: null },
    { entity: input.entity, evidence: input.evidence },
    { ...input, entity: { ...input.entity, slug: 'Majuscule' } },
    { ...input, entity: { ...input.entity, kind: 'UNKNOWN' } },
    { ...input, entity: { ...input.entity, visibility: 'UNKNOWN' } },
    { ...input, entity: { ...input.entity, kind: 'PLACE', placeKind: null } },
    { ...input, entity: { ...input.entity, kind: 'PERSON', placeKind: 'CITY' } },
    { ...input, entity: { ...input.entity, aliases: ['A', 'a'] } },
    { ...input, entity: { ...input.entity, tags: ['Quête', 'quête'] } },
    { ...input, entity: { ...input.entity, aliases: ['Épée', 'E\u0301pée'] } },
    { ...input, entity: { ...input.entity, aliases: Array.from({ length: 31 }, (_, index) => `Alias ${index}`) } },
    { ...input, evidence: { ...input.evidence, confidence: 0.1234 } },
    { ...input, evidence: { ...input.evidence, confidence: Number.NaN } },
    { ...input, evidence: { ...input.evidence, confidence: Number.POSITIVE_INFINITY } },
    { ...input, evidence: { ...input.evidence, timeStartSeconds: Number.POSITIVE_INFINITY } },
    { ...input, evidence: { ...input.evidence, timeStartSeconds: 31 } },
    { ...input, evidence: { ...input.evidence, claimText: ' ' } },
    { ...input, source: { ...input.source, data: { ...input.source.data, url: 'ftp://example.org' } } },
  ]) assert.equal(manualCreateSchema.safeParse(candidate).success, false, JSON.stringify(candidate))
  assert.equal(manualCreateSchema.safeParse({ ...input,
    entity: { ...input.entity, title: ' ', summary: 'x'.repeat(501), bodyMarkdown: 'x'.repeat(100_001) },
  }).success, false)
  const normalized = manualCreateSchema.parse({ ...input, entity: { ...input.entity,
    title: '  Épée d’Or  ', summary: '  Résumé  ', aliases: ['  Héros  '], tags: ['  Quête  '] },
    evidence: { ...input.evidence, claimText: '  Fait  ' } })
  assert.equal(normalized.entity.title, 'Épée d’Or')
  assert.equal(normalized.entity.summary, 'Résumé')
  assert.deepEqual(normalized.entity.aliases, ['Héros'])
  assert.deepEqual(normalized.entity.tags, ['Quête'])
  assert.equal(normalized.evidence.claimText, 'Fait')
})

test('omitted visibility and optional fields default to GM/null without publishing', () => {
  const parsed = manualCreateSchema.parse({ entity: { slug: 'fiche-minimale', kind: 'PERSON',
    title: 'Fiche minimale' }, source: { mode: 'new', data: { kind: 'MANUAL', label: 'Notes' } },
  evidence: { claimText: 'Fait' } })
  assert.equal(parsed.entity.visibility, 'GM')
  assert.equal(parsed.source.mode, 'new')
  if (parsed.source.mode === 'new') assert.equal(parsed.source.data.visibility, 'GM')
  assert.equal(parsed.evidence.visibility, 'GM')
  assert.equal(parsed.evidence.confidence, null)
})

test('Source lookup is bounded, sorted and never returns metadata', async () => {
  const sources = Array.from({ length: 25 }, (_, index) => ({ id: `source-${index}`, kind: 'MANUAL',
    label: `Document ${String(index).padStart(2, '0')}`, externalId: null, url: null, authorLabel: null,
    publishedAt: null, visibility: 'GM', createdAt: now, updatedAt: now,
    metadata: { secret: 'hidden' } }))
  const db = memoryDatabase(sources)
  const page = await db.service.listSources({ page: 1 })
  assert.equal(page.items.length, 20)
  assert.equal(page.total, 25)
  assert.equal(page.items[0]?.label, 'Document 00')
  assert.equal(JSON.stringify(page).includes('hidden'), false)
  const second = await db.service.listSources({ q: 'Document', page: 2 })
  assert.equal(second.items.length, 5)
  const query = db.sourceQueries[1] as { where: { OR: Array<Record<string, unknown>> }; skip: number; take: number }
  assert.equal(query.skip, 20)
  assert.equal(query.take, 20)
  assert.deepEqual(query.where.OR.map((part) => Object.keys(part)[0]), ['label', 'externalId', 'authorLabel'])
})

const config = readAuthConfig({ DISCORD_CLIENT_ID: '111111111111111111', DISCORD_CLIENT_SECRET: 'fake',
  DISCORD_REDIRECT_URI: 'http://localhost:5173/api/auth/discord/callback', DISCORD_ADMIN_IDS: '222222222222222222',
  SESSION_SECRET: 'a-test-secret-of-more-than-thirty-two-characters', SESSION_TTL_MS: '3600000' })
let server: Server
let baseUrl: string
let createdByRoute: { input: unknown; editorLabel: string } | null = null
const routedCreation = () => createdByRoute
const routeManual: ManualService = {
  async listSources() { return { items: [], total: 0, page: 1, pageSize: 20 } },
  async create(payload, editorLabel) {
    createdByRoute = { input: payload, editorLabel }
    return { id: 'entity-1', ...payload.entity, status: 'PROPOSED', createdAt: now.toISOString(),
      updatedAt: now.toISOString(), publishedAt: null, evidence: [], outgoingRelations: [],
      incomingRelations: [], revisions: [] } as AdminEntityDetail
  },
}
before(async () => {
  server = createApp({ async ping() {}, async listRelationTypes() { return [] },
    async listEntities() { return [] }, async getEntityBySlug() { return null } }, {
    auth: { config, store: { async findSession(hash) {
      const discordId = hash === sessionHash('a'.repeat(43)) ? '222222222222222222'
        : hash === sessionHash('b'.repeat(43)) ? '333333333333333333' : null
      return discordId ? { discordId, username: 'editor', displayName: 'Danny',
        expiresAt: new Date(Date.now() + 60_000) } : null
    }, async rotateSession() {}, async revokeSession() {} },
    discord: { authorizationUrl: () => '', exchangeCode: async () => { throw new Error('not called') } } },
    admin: { async listEntities() { return { items: [], total: 0, page: 1, pageSize: 50 } },
      async getEntity() { return null }, async getStats() { return { byStatus: { DRAFT: 0, PROPOSED: 0,
        PUBLISHED: 0, ARCHIVED: 0 }, byVisibility: { PUBLIC: 0, PLAYERS: 0, GM: 0, SECRET: 0 },
        sources: 0, relations: 0 } } },
    editorial: { async patch() { throw new Error('not called') }, async publish() { throw new Error('not called') },
      async unpublish() { throw new Error('not called') } }, manual: routeManual,
  }).listen(0)
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  baseUrl = `http://127.0.0.1:${address.port}`
})
after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())) })

function request(payload: unknown, cookie?: string, origin?: string) {
  return fetch(`${baseUrl}/api/admin/entities`, { method: 'POST', headers: {
    'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}),
    ...(origin ? { Origin: origin } : {}),
  }, body: JSON.stringify(payload) })
}
test('manual route enforces admin whitelist, exact Origin, strict payload and server editor identity', async () => {
  const admin = `hesta_codex_session=${'a'.repeat(43)}`
  const player = `hesta_codex_session=${'b'.repeat(43)}`
  assert.equal((await request(input, undefined, config.origin)).status, 401)
  assert.equal((await request(input, player, config.origin)).status, 403)
  for (const origin of [undefined, 'null', 'https://evil.example', 'https://localhost:5173',
    `${config.origin}.attacker.example`,
    'http://localhost:5174']) assert.equal((await request(input, admin, origin)).status, 403)
  for (const payload of [{ ...input, entity: { ...input.entity, status: 'PUBLISHED' } },
    { ...input, entity: { ...input.entity, metadata: {} } },
    { ...input, evidence: { ...input.evidence, entityId: sourceId } }]) {
    const response = await request(payload, admin, config.origin)
    assert.equal(response.status, 400)
    assert.equal((await response.json() as { error: { code: string } }).error.code, 'INVALID_REQUEST')
  }
  createdByRoute = null
  const response = await request(input, admin, config.origin)
  assert.equal(response.status, 201)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(routedCreation()?.editorLabel, 'Danny')
  assert.equal((await response.json() as AdminEntityDetail).status, 'PROPOSED')
})

test('manual route rejects malformed and oversized JSON without invoking creation', async () => {
  const admin = `hesta_codex_session=${'a'.repeat(43)}`
  createdByRoute = null
  for (const [body, expected] of [['{invalid', 400], [JSON.stringify({ long: 'x'.repeat(1_100_000) }), 413]] as const) {
    const response = await fetch(`${baseUrl}/api/admin/entities`, { method: 'POST', headers: {
      Cookie: admin, Origin: config.origin, 'Content-Type': 'application/json',
    }, body })
    assert.equal(response.status, expected)
    assert.equal(response.headers.get('cache-control'), 'no-store')
  }
  assert.equal(routedCreation(), null)
})

test('Source search is admin-only, bounded and rejects malformed queries', async () => {
  const admin = `hesta_codex_session=${'a'.repeat(43)}`
  assert.equal((await fetch(`${baseUrl}/api/admin/sources`)).status, 401)
  assert.equal((await fetch(`${baseUrl}/api/admin/sources`, { headers: {
    Cookie: `hesta_codex_session=${'b'.repeat(43)}` } })).status, 403)
  assert.equal((await fetch(`${baseUrl}/api/admin/sources?q=a`, { headers: { Cookie: admin } })).status, 400)
  for (const query of ['page=0', 'page=1001', 'q=ab&limit=1000', 'q=ab&q=cd']) {
    assert.equal((await fetch(`${baseUrl}/api/admin/sources?${query}`, { headers: { Cookie: admin } })).status, 400)
  }
  const response = await fetch(`${baseUrl}/api/admin/sources?page=1`, { headers: { Cookie: admin } })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
})
