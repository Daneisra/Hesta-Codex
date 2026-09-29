import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { Server } from 'node:http'
import { after, before, test } from 'node:test'
import type { AdminEntityDetail } from '@hesta-codex/shared'
import { Prisma, type PrismaClient } from './prisma-client/client.ts'
import { createPrismaManualRelationService, type ManualRelationService } from './admin/manual-relations.js'
import { manualRelationSchema } from './admin/manual-relations-validation.js'
import { createApp } from './app.js'
import { readAuthConfig } from './auth/config.js'
import { sessionHash } from './auth/session.js'
import { createPrismaStore } from './store.js'

const now = new Date('2026-09-29T12:00:00.000Z')
const barolt = '11111111-1111-4111-8111-111111111111'
const archipel = '22222222-2222-4222-8222-222222222222'
const third = '33333333-3333-4333-8333-333333333333'
const sourceId = '44444444-4444-4444-8444-444444444444'
const typeId = '55555555-5555-4555-8555-555555555555'
const types = [
  { id: typeId, code: 'located_in', label: 'situé dans', inverseCode: 'contains', inverseLabel: 'contient', symmetric: false },
  { id: '77777777-7777-4777-8777-777777777777', code: 'member_of', label: 'membre de',
    inverseCode: 'has_member', inverseLabel: 'compte parmi ses membres', symmetric: false },
  { id: '88888888-8888-4888-8888-888888888888', code: 'parent_of', label: 'parent de',
    inverseCode: 'child_of', inverseLabel: 'enfant de', symmetric: false },
  { id: '66666666-6666-4666-8666-666666666666', code: 'allied_with', label: 'allié à', inverseCode: null,
    inverseLabel: null, symmetric: true },
]
const input = { fromEntityId: barolt, toEntityId: archipel, relationCode: 'located_in',
  description: '  Selon la chronique  ', source: { mode: 'new', data: { kind: 'MANUAL', label: 'Chronique',
    externalId: 'chronique-1', url: null, authorLabel: null, publishedAt: null } },
  evidence: { claimText: '  Situation attestée  ', sourceExcerpt: null, locator: 'p. 2',
    timeStartSeconds: 0, timeEndSeconds: 30, confidence: 0.8 }, } as const
type Row = Record<string, unknown>
type State = { entities: Row[]; sources: Row[]; relations: Row[]; evidence: Row[]; revisions: Row[] }
function entity(id: string, slug: string, title: string, status = 'PROPOSED', visibility = 'GM'): Row {
  return { id, slug, title, kind: 'PERSON', placeKind: null, summary: null, tags: [], aliases: [], bodyMarkdown: '',
    status, visibility, publishedAt: status === 'PUBLISHED' ? now : null, createdAt: now, updatedAt: now }
}
function memoryDatabase() {
  let state: State = { entities: [entity(barolt, 'barolt', 'Barolt'), entity(archipel, 'archipel', 'Archipel'),
    entity(third, 'troisieme', 'Troisième')], sources: [], relations: [], evidence: [], revisions: [] }
  const operations: string[] = []
  const globalWrites: string[] = []
  let failAt: 'source' | 'relation' | 'relationUnique' | 'evidence' | null = null
  let counter = 0
  const unique = () => new Prisma.PrismaClientKnownRequestError('private SQL detail',
    { code: 'P2002', clientVersion: '7.10.0' })
  const outside = (model: string) => { globalWrites.push(model); throw new Error(`Outside transaction: ${model}`) }
  const prisma = {
    source: { async create() { return outside('source') } },
    relation: { async create() { return outside('relation') } },
    evidence: { async create() { return outside('evidence') } },
    revision: { async create() { return outside('revision') } },
    relationType: { async findMany() { return types } },
    async $transaction<T>(work: (tx: unknown) => Promise<T>) {
      const pending = structuredClone(state)
      const detail = (row: Row) => {
        const linked = (relation: Row) => ({ ...relation,
          relationType: types.find((type) => type.id === relation.relationTypeId),
          evidence: pending.evidence.filter((proof) => proof.relationId === relation.id).map((proof) => ({
            ...proof, source: pending.sources.find((source) => source.id === proof.sourceId),
          })),
        })
        return { ...row, evidence: [], revisions: pending.revisions.filter((revision) => revision.entityId === row.id),
          outgoingRelations: pending.relations.filter((relation) => relation.fromEntityId === row.id)
            .map((relation) => ({ ...linked(relation), toEntity: pending.entities.find((item) => item.id === relation.toEntityId) })),
          incomingRelations: pending.relations.filter((relation) => relation.toEntityId === row.id)
            .map((relation) => ({ ...linked(relation), fromEntity: pending.entities.find((item) => item.id === relation.fromEntityId) })),
        }
      }
      const tx = {
        relationType: { async findMany(query: { where: { OR: Array<{ code?: string; inverseCode?: string }> } }) {
          const code = query.where.OR[0]?.code
          return types.filter((type) => type.code === code || type.inverseCode === code)
        } },
        entity: { async findUnique(query: { where: { id?: string; slug?: string } }) {
          const row = pending.entities.find((item) => (typeof query.where.id === 'string' &&
            String(item.id).toLowerCase() === query.where.id.toLowerCase()) || item.slug === query.where.slug)
          return row ? query.where.slug ? detail(row) : row : null
        } },
        relation: {
          async findFirst(query: { where: { relationTypeId: string; OR: Array<{ fromEntityId: string; toEntityId: string }> } }) {
            return pending.relations.find((relation) => relation.relationTypeId === query.where.relationTypeId &&
              query.where.OR.some((edge) => relation.fromEntityId === edge.fromEntityId &&
                relation.toEntityId === edge.toEntityId)) ?? null
          },
          async create(query: { data: Row }) {
            operations.push('relation')
            if (failAt === 'relation') throw new Error('injected relation failure')
            if (failAt === 'relationUnique' || pending.relations.some((relation) =>
              relation.fromEntityId === query.data.fromEntityId && relation.toEntityId === query.data.toEntityId &&
              relation.relationTypeId === query.data.relationTypeId)) throw unique()
            const row = { ...query.data, id: `relation-${++counter}`, createdAt: now, updatedAt: now }
            pending.relations.push(row)
            return row
          },
        },
        source: {
          async findUnique(query: { where: { id: string } }) {
            return pending.sources.find((source) => source.id === query.where.id) ?? null
          },
          async create(query: { data: Row }) {
            operations.push('source')
            if (failAt === 'source') throw new Error('injected source failure')
            if (query.data.externalId !== null && pending.sources.some((source) =>
              source.kind === query.data.kind && source.externalId === query.data.externalId)) throw unique()
            const row = { ...query.data, id: `source-${++counter}`, createdAt: now, updatedAt: now }
            pending.sources.push(row)
            return row
          },
        },
        evidence: { async create(query: { data: Row }) {
          operations.push('evidence')
          if (failAt === 'evidence') throw new Error('injected evidence failure')
          const row = { ...query.data, id: `evidence-${++counter}`, createdAt: now, updatedAt: now }
          pending.evidence.push(row)
          return row
        } },
      }
      const result = await work(tx)
      state = pending
      return result
    },
  } as unknown as PrismaClient
  return { service: createPrismaManualRelationService(prisma), state: () => structuredClone(state), operations,
    globalWrites, fail: (step: typeof failAt) => { failAt = step },
    change: (update: (state: State) => void) => update(state) }
}

test('direct creation is PROPOSED GM, sourced, oriented and creates no Entity Revision', async () => {
  const db = memoryDatabase()
  const detail = await db.service.create(manualRelationSchema.parse(input))
  assert.deepEqual(db.operations, ['source', 'relation', 'evidence'])
  assert.deepEqual(db.globalWrites, [])
  const state = db.state()
  assert.equal(state.relations.length, 1)
  assert.equal(state.relations[0]?.fromEntityId, barolt)
  assert.equal(state.relations[0]?.toEntityId, archipel)
  assert.equal(state.relations[0]?.status, 'PROPOSED')
  assert.equal(state.relations[0]?.visibility, 'GM')
  assert.equal(state.relations[0]?.description, 'Selon la chronique')
  assert.equal(state.evidence[0]?.entityId, null)
  assert.equal(state.evidence[0]?.relationId, state.relations[0]?.id)
  assert.equal(state.evidence[0]?.sourceId, state.sources[0]?.id)
  assert.deepEqual(state.revisions, [])
  assert.equal(detail.outgoingRelations[0]?.relationType.label, 'situé dans')
  assert.equal(detail.outgoingRelations[0]?.evidence.length, 1)
})

test('inverse code resolves to the same physical edge without an inverse row', async () => {
  for (const [direct, inverse] of [
    ['located_in', 'contains'], ['member_of', 'has_member'], ['parent_of', 'child_of'],
  ]) {
    const db = memoryDatabase()
    await db.service.create(manualRelationSchema.parse({ ...input, fromEntityId: archipel, toEntityId: barolt,
      relationCode: inverse }))
    const state = db.state()
    assert.deepEqual([state.relations[0]?.fromEntityId, state.relations[0]?.toEntityId,
      state.relations[0]?.relationTypeId], [barolt, archipel, types.find((type) => type.code === direct)?.id])
    assert.equal(state.relations.length, 1)
    await assert.rejects(db.service.create(manualRelationSchema.parse({ ...input, relationCode: direct })),
      { status: 409, code: 'RELATION_CONFLICT' })
  }
})

test('symmetric edges sort UUIDs and reject opposite order, including old reverse rows', async () => {
  const db = memoryDatabase()
  const alliance = { ...input, fromEntityId: archipel, toEntityId: barolt, relationCode: 'allied_with' }
  await db.service.create(manualRelationSchema.parse(alliance))
  assert.deepEqual([db.state().relations[0]?.fromEntityId, db.state().relations[0]?.toEntityId], [barolt, archipel])
  await assert.rejects(db.service.create(manualRelationSchema.parse({ ...alliance,
    fromEntityId: barolt, toEntityId: archipel })), { status: 409, code: 'RELATION_CONFLICT' })
  const legacy = memoryDatabase()
  legacy.change((state) => state.relations.push({ id: 'legacy', fromEntityId: archipel, toEntityId: barolt,
    relationTypeId: types.find((type) => type.code === 'allied_with')!.id,
    status: 'PROPOSED', visibility: 'GM', description: null,
    createdAt: now, updatedAt: now }))
  await assert.rejects(legacy.service.create(manualRelationSchema.parse({ ...alliance,
    fromEntityId: barolt, toEntityId: archipel })), { status: 409, code: 'RELATION_CONFLICT' })
})

test('two concurrent opposite symmetric requests reach the same SQL uniqueness key', async () => {
  const attempted: Row[] = []
  let release!: () => void
  const bothReady = new Promise<void>((resolve) => { release = resolve })
  const symmetricType = types.find((type) => type.code === 'allied_with')!
  const transaction = {
    relationType: { async findMany() { return [symmetricType] } },
    entity: { async findUnique(query: { where: { id: string } }) {
      return [entity(barolt, 'barolt', 'Barolt'), entity(archipel, 'archipel', 'Archipel')]
        .find((row) => row.id === query.where.id) ?? null
    } },
    relation: {
      async findFirst() { return null },
      async create(query: { data: Row }) {
        attempted.push(query.data)
        if (attempted.length === 2) release()
        await bothReady
        throw new Prisma.PrismaClientKnownRequestError('private SQL detail',
          { code: 'P2002', clientVersion: '7.10.0' })
      },
    },
    source: { async findUnique() { return { id: sourceId } } },
    evidence: { async create() { throw new Error('Evidence must not be reached after SQL conflict') } },
  }
  const prisma = { async $transaction<T>(work: (tx: typeof transaction) => Promise<T>) {
    return work(transaction)
  } } as unknown as PrismaClient
  const service = createPrismaManualRelationService(prisma)
  const first = manualRelationSchema.parse({ ...input, relationCode: 'allied_with',
    source: { mode: 'existing', sourceId } })
  const second = manualRelationSchema.parse({ ...first, fromEntityId: archipel, toEntityId: barolt })
  const results = await Promise.allSettled([service.create(first), service.create(second)])
  assert.deepEqual(attempted.map((row) => [row.fromEntityId, row.toEntityId, row.relationTypeId]), [
    [barolt, archipel, symmetricType.id], [barolt, archipel, symmetricType.id],
  ])
  for (const result of results) {
    assert.equal(result.status, 'rejected')
    if (result.status === 'rejected') assert.match(String(result.reason.code), /^RELATION_CONFLICT$/)
  }
})

test('unknown type, missing endpoints, self-reference and archived endpoints fail before writing', async () => {
  for (const [payload, code] of [
    [{ ...input, relationCode: 'unknown' }, 'RELATION_TYPE_NOT_FOUND'],
    [{ ...input, fromEntityId: '77777777-7777-4777-8777-777777777777' }, 'FROM_ENTITY_NOT_FOUND'],
    [{ ...input, toEntityId: '77777777-7777-4777-8777-777777777777' }, 'TO_ENTITY_NOT_FOUND'],
    [{ ...input, fromEntityId: barolt, toEntityId: barolt }, 'RELATION_SELF_REFERENCE'],
    [{ ...input, fromEntityId: barolt.toUpperCase(), toEntityId: barolt }, 'RELATION_SELF_REFERENCE'],
  ] as const) {
    const db = memoryDatabase()
    await assert.rejects(async () => db.service.create(manualRelationSchema.parse(payload)), { code })
    assert.deepEqual(db.operations, [])
  }
  const db = memoryDatabase()
  db.change((state) => { state.entities[1]!.status = 'ARCHIVED' })
  await assert.rejects(db.service.create(manualRelationSchema.parse(input)), { code: 'ENTITY_ARCHIVED' })
  assert.deepEqual(db.operations, [])
  const archivedFrom = memoryDatabase()
  archivedFrom.change((state) => { state.entities[0]!.status = 'ARCHIVED' })
  await assert.rejects(archivedFrom.service.create(manualRelationSchema.parse(input)), { code: 'ENTITY_ARCHIVED' })
  assert.deepEqual(archivedFrom.operations, [])
  await assert.rejects(archivedFrom.service.create(manualRelationSchema.parse({ ...input,
    fromEntityId: archipel, toEntityId: barolt, relationCode: 'contains' })), { code: 'ENTITY_ARCHIVED' })
  assert.deepEqual(archivedFrom.operations, [])
  const otherStatuses = memoryDatabase()
  otherStatuses.change((state) => {
    state.entities[0]!.status = 'DRAFT'
    state.entities[1]!.status = 'PUBLISHED'
  })
  await otherStatuses.service.create(manualRelationSchema.parse(input))
  assert.equal(otherStatuses.state().relations.length, 1)
})

test('existing Source stays unchanged; missing Source and Source uniqueness conflict are safe', async () => {
  const db = memoryDatabase()
  const original = { id: sourceId, kind: 'MANUAL', label: 'Source partagée', externalId: null,
    url: null, authorLabel: null, publishedAt: null, visibility: 'GM', createdAt: now, updatedAt: now }
  db.change((state) => state.sources.push(original))
  await db.service.create(manualRelationSchema.parse({ ...input, source: { mode: 'existing', sourceId } }))
  assert.deepEqual(db.state().sources, [original])
  assert.equal(db.state().evidence[0]?.sourceId, sourceId)
  const missing = memoryDatabase()
  await assert.rejects(missing.service.create(manualRelationSchema.parse({ ...input,
    source: { mode: 'existing', sourceId } })), { code: 'SOURCE_NOT_FOUND', status: 404 })
  assert.equal(missing.state().relations.length, 0)
  const conflict = memoryDatabase()
  conflict.change((state) => state.sources.push({ ...original, externalId: 'chronique-1' }))
  await assert.rejects(conflict.service.create(manualRelationSchema.parse(input)),
    { code: 'SOURCE_CONFLICT', status: 409 })
  assert.equal(conflict.state().relations.length, 0)
})

test('all write failures roll back Source, Relation and Evidence; global writes are forbidden', async () => {
  for (const step of ['source', 'relation', 'evidence'] as const) {
    const db = memoryDatabase()
    db.fail(step)
    await assert.rejects(db.service.create(manualRelationSchema.parse(input)), /injected/)
    assert.deepEqual(db.state().sources, [])
    assert.deepEqual(db.state().relations, [])
    assert.deepEqual(db.state().evidence, [])
    assert.deepEqual(db.globalWrites, [])
    db.fail(null)
    await db.service.create(manualRelationSchema.parse(input))
    assert.equal(db.state().relations.length, 1)
  }
  const conflict = memoryDatabase()
  conflict.fail('relationUnique')
  await assert.rejects(conflict.service.create(manualRelationSchema.parse(input)),
    { code: 'RELATION_CONFLICT', status: 409 })
  assert.equal(conflict.state().sources.length, 0)
})

test('strict relation validation reuses Source and Evidence rules', () => {
  for (const payload of [
    { ...input, status: 'PUBLISHED' }, { ...input, relationTypeId: typeId },
    { ...input, evidence: { ...input.evidence, relationId: 'x' } },
    { ...input, evidence: { ...input.evidence, entityId: 'x' } },
    { ...input, source: { mode: 'existing', sourceId, data: {} } },
    { ...input, source: null },
    { ...input, evidence: { ...input.evidence, confidence: 1.01 } },
    { ...input, evidence: { ...input.evidence, confidence: 0.1234 } },
    { ...input, evidence: { ...input.evidence, timeEndSeconds: -1 } },
    { ...input, evidence: { ...input.evidence, timeEndSeconds: 0, timeStartSeconds: 1 } },
  ]) assert.equal(manualRelationSchema.safeParse(payload).success, false)
  const parsed = manualRelationSchema.parse(input)
  assert.equal(parsed.visibility, 'GM')
  assert.equal(parsed.evidence.visibility, 'GM')
  assert.equal(parsed.source.mode, 'new')
  if (parsed.source.mode === 'new') assert.equal(parsed.source.data.visibility, 'GM')
})

test('a newly created PROPOSED PUBLIC relation is absent from both public directions', async () => {
  const db = memoryDatabase()
  db.change((state) => {
    state.entities[0]!.status = 'PUBLISHED'; state.entities[0]!.visibility = 'PUBLIC'; state.entities[0]!.publishedAt = now
    state.entities[1]!.status = 'PUBLISHED'; state.entities[1]!.visibility = 'PUBLIC'; state.entities[1]!.publishedAt = now
  })
  await db.service.create(manualRelationSchema.parse({ ...input, visibility: 'PUBLIC',
    source: { ...input.source, data: { ...input.source.data, visibility: 'PUBLIC' } },
    evidence: { ...input.evidence, visibility: 'PUBLIC' } }))
  const state = db.state()
  const prisma = { entity: { async findFirst(query: { where: { slug: string; status: string; visibility: string } }) {
    return state.entities.find((item) => item.slug === query.where.slug && item.status === query.where.status &&
      item.visibility === query.where.visibility) ?? null
  } }, relation: { async findMany(query: { where: { fromEntityId?: string; toEntityId?: string;
    status: string; visibility: string } }) {
    assert.equal(query.where.status, 'PUBLISHED')
    assert.equal(query.where.visibility, 'PUBLIC')
    return state.relations.filter((relation) => relation.status === query.where.status &&
      relation.visibility === query.where.visibility &&
      (query.where.fromEntityId ? relation.fromEntityId === query.where.fromEntityId :
        relation.toEntityId === query.where.toEntityId))
  } } } as unknown as PrismaClient
  const store = createPrismaStore(prisma)
  assert.equal((await store.getEntityBySlug('barolt'))?.outgoingRelations.length, 0)
  assert.equal((await store.getEntityBySlug('archipel'))?.incomingRelations.length, 0)
  assert.equal(state.relations[0]?.status, 'PROPOSED')
})

const config = readAuthConfig({ DISCORD_CLIENT_ID: '111111111111111111', DISCORD_CLIENT_SECRET: 'fake',
  DISCORD_REDIRECT_URI: 'http://localhost:5173/api/auth/discord/callback', DISCORD_ADMIN_IDS: '222222222222222222',
  SESSION_SECRET: 'a-test-secret-of-more-than-thirty-two-characters', SESSION_TTL_MS: '3600000' })
let server: Server
let baseUrl: string
let routed: unknown = null
const routeService: ManualRelationService = {
  async listTypes() { return types },
  async create(payload) {
    routed = payload
    return { id: barolt, slug: 'barolt', kind: 'PERSON', placeKind: null, title: 'Barolt', summary: null,
      tags: [], aliases: [], bodyMarkdown: '', status: 'PROPOSED', visibility: 'GM', createdAt: now.toISOString(),
      updatedAt: now.toISOString(), publishedAt: null, evidence: [], revisions: [], outgoingRelations: [],
      incomingRelations: [] } as AdminEntityDetail
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
      async unpublish() { throw new Error('not called') } }, manualRelations: routeService,
  }).listen(0)
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  baseUrl = `http://127.0.0.1:${address.port}`
})
after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())) })

test('relation route requires admin and exact Origin; strict payload rejects forbidden IDs/status', async () => {
  const admin = `hesta_codex_session=${'a'.repeat(43)}`
  const player = `hesta_codex_session=${'b'.repeat(43)}`
  const send = (payload: unknown, cookie?: string, origin?: string) => fetch(`${baseUrl}/api/admin/relations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}),
      ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(payload),
  })
  assert.equal((await send(input, undefined, config.origin)).status, 401)
  assert.equal((await send(input, player, config.origin)).status, 403)
  for (const origin of [undefined, 'null', 'https://evil.example', `${config.origin}.attacker.example`,
    'https://localhost:5173', 'http://localhost:5174']) assert.equal((await send(input, admin, origin)).status, 403)
  for (const payload of [{ ...input, status: 'PUBLISHED' }, { ...input, relationTypeId: typeId },
    { ...input, evidence: { ...input.evidence, sourceId } }, { ...input, metadata: {} }]) {
    const response = await send(payload, admin, config.origin)
    assert.equal(response.status, 400)
    assert.equal((await response.json() as { error: { code: string } }).error.code, 'INVALID_REQUEST')
  }
  routed = null
  const response = await send(input, admin, config.origin)
  assert.equal(response.status, 201)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal((routed as { visibility: string } | null)?.visibility, 'GM')
  assert.equal((await fetch(`${baseUrl}/api/admin/relation-types`)).status, 401)
  const catalog = await fetch(`${baseUrl}/api/admin/relation-types`, { headers: { Cookie: admin } })
  assert.equal(catalog.status, 200)
  assert.equal(catalog.headers.get('cache-control'), 'no-store')
  assert.equal((await catalog.json() as unknown[]).length, types.length)
})
