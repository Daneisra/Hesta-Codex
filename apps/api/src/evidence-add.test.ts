import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { Server } from 'node:http'
import { after, before, test } from 'node:test'
import { Prisma, type PrismaClient } from './prisma-client/client.ts'
import { createPrismaEvidenceAddService, type EvidenceAddService } from './admin/evidence-add.js'
import { evidenceAddSchema } from './admin/evidence-add-validation.js'
import { createApp } from './app.js'
import { readAuthConfig } from './auth/config.js'
import { sessionHash } from './auth/session.js'

const entityId = '11111111-1111-4111-8111-111111111111'
const otherId = '22222222-2222-4222-8222-222222222222'
const relationId = '33333333-3333-4333-8333-333333333333'
const sourceId = '44444444-4444-4444-8444-444444444444'
const input = evidenceAddSchema.parse({
  source: { mode: 'existing', sourceId }, evidence: { claimText: '  Attesté dans la chronique  ',
    sourceExcerpt: '  Passage précis  ', locator: 'p. 4', timeStartSeconds: 0,
    timeEndSeconds: 12, confidence: 0.875 },
})
type Row = Record<string, unknown>
type State = { entities: Row[]; relations: Row[]; sources: Row[]; evidence: Row[]; revisions: Row[] }

function database() {
  let state: State = { entities: [{ id: entityId, slug: 'barolt', status: 'PROPOSED' },
    { id: otherId, slug: 'archipel', status: 'PROPOSED' }],
  relations: [{ id: relationId, status: 'PROPOSED', fromEntityId: entityId, toEntityId: otherId }],
  sources: [{ id: sourceId, kind: 'MANUAL', externalId: 'chronique-1', label: 'Chronique' }],
  evidence: [], revisions: [] }
  let sequence = 0
  let fail: 'source' | 'evidence' | null = null
  const globalWrites: string[] = []
  const steps: string[] = []
  let queue = Promise.resolve()
  const outside = (model: string) => { globalWrites.push(model); throw new Error(`outside transaction: ${model}`) }
  const prisma = {
    source: { create: () => outside('source') }, evidence: { create: () => outside('evidence') },
    entity: { update: () => outside('entity') }, relation: { update: () => outside('relation') },
    revision: { create: () => outside('revision') },
    async $transaction<T>(work: (tx: unknown) => Promise<T>) {
      let release!: () => void
      const previous = queue
      queue = new Promise<void>((resolve) => { release = resolve })
      await previous
      const pending = structuredClone(state)
      const tx = {
        async $queryRaw(strings: TemplateStringsArray, id: string) {
          assert.match(strings.join('?'), /FOR UPDATE/)
          steps.push('lock')
          return strings[0]!.includes('"Entity"')
            ? pending.entities.filter((row) => row.slug === id)
            : pending.relations.filter((row) => row.id === id)
        },
        relation: { async findUnique({ where }: { where: { id: string } }) {
          const row = pending.relations.find((item) => item.id === where.id)
          return row ? { fromEntity: pending.entities.find((item) => item.id === row.fromEntityId),
            toEntity: pending.entities.find((item) => item.id === row.toEntityId) } : null
        } },
        source: { async findUnique({ where }: { where: { id: string } }) {
          return pending.sources.find((row) => row.id === where.id) ?? null
        }, async create({ data }: { data: Row }) {
          steps.push('source')
          if (fail === 'source') throw new Error('source failure')
          if (data.externalId && pending.sources.some((row) => row.kind === data.kind && row.externalId === data.externalId)) {
            throw new Prisma.PrismaClientKnownRequestError('private SQL detail', { code: 'P2002', clientVersion: '7.10.0' })
          }
          const row = { ...data, id: `new-source-${++sequence}` }
          pending.sources.push(row)
          return row
        } },
        evidence: { async findFirst({ where }: { where: Row }) {
          steps.push('duplicate-check')
          return pending.evidence.find((row) => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null
        }, async create({ data }: { data: Row }) {
          steps.push('evidence')
          if (fail === 'evidence') throw new Error('evidence failure')
          const row = { ...data, id: `new-evidence-${++sequence}` }
          pending.evidence.push(row)
          return row
        } },
      }
      try {
        const result = await work(tx)
        state = pending
        return result
      } finally { release() }
    },
  } as unknown as PrismaClient
  return { service: createPrismaEvidenceAddService(prisma), state: () => structuredClone(state),
    fail: (step: typeof fail) => { fail = step }, globalWrites, steps,
    change: (edit: (current: State) => void) => edit(state) }
}

test('Entity addition uses existing Source, targets only Entity, leaves content/status/revisions alone', async () => {
  const db = database()
  const before = db.state()
  await db.service.toEntity('barolt', input)
  const state = db.state()
  assert.equal(state.evidence.length, 1)
  assert.equal(state.evidence[0]?.entityId, entityId)
  assert.equal(state.evidence[0]?.relationId, null)
  assert.equal(state.evidence[0]?.sourceId, sourceId)
  assert.equal(state.evidence[0]?.claimText, 'Attesté dans la chronique')
  assert.equal(state.evidence[0]?.visibility, 'GM')
  assert.equal(state.sources.length, 1)
  assert.deepEqual(state.entities, before.entities)
  assert.deepEqual(state.relations, before.relations)
  assert.deepEqual(state.revisions, before.revisions)
  assert.deepEqual(db.globalWrites, [])
  assert.deepEqual(db.steps, ['lock', 'duplicate-check', 'evidence'])
})

test('Relation addition creates or reuses Source and targets only Relation', async () => {
  const db = database()
  const before = db.state()
  const novel = evidenceAddSchema.parse({ ...input, source: { mode: 'new', data: {
    kind: 'MANUAL', label: 'Autre chronique', externalId: null,
  } } })
  await db.service.toRelation(relationId, novel)
  const state = db.state()
  assert.equal(state.sources.length, 2)
  assert.equal(state.evidence[0]?.entityId, null)
  assert.equal(state.evidence[0]?.relationId, relationId)
  assert.equal(state.evidence[0]?.sourceId, state.sources[1]?.id)
  assert.deepEqual(state.entities, before.entities)
  assert.deepEqual(state.relations, before.relations)
  assert.deepEqual(state.revisions, before.revisions)
  assert.deepEqual(db.globalWrites, [])
  assert.deepEqual(db.steps, ['lock', 'source', 'duplicate-check', 'evidence'])
})

test('certain duplicates conflict; different Source and different passage remain valid', async () => {
  const db = database()
  await db.service.toEntity('barolt', input)
  await assert.rejects(db.service.toEntity('barolt', input), { status: 409, code: 'EVIDENCE_CONFLICT' })
  await db.service.toEntity('barolt', { ...input, evidence: { ...input.evidence, locator: 'p. 5' } })
  await db.service.toEntity('barolt', { ...input, source: { mode: 'new', data: {
    kind: 'MANUAL', label: 'Seconde chronique', externalId: null, url: null, authorLabel: null,
    publishedAt: null, visibility: 'GM',
  } } })
  assert.equal(db.state().evidence.length, 3)
})

test('duplicate identity includes target, Source, claim, excerpt, locator and timestamps', async () => {
  const db = database()
  await db.service.toEntity('barolt', input)
  await db.service.toEntity('barolt', { ...input, evidence: { ...input.evidence, claimText: 'Une autre assertion' } })
  await db.service.toEntity('barolt', { ...input, evidence: { ...input.evidence, sourceExcerpt: 'Un autre passage' } })
  await db.service.toEntity('barolt', { ...input, evidence: { ...input.evidence, timeStartSeconds: 1 } })
  await db.service.toEntity('archipel', input)
  await db.service.toRelation(relationId, input)
  assert.equal(db.state().evidence.length, 6)
  assert.deepEqual(db.globalWrites, [])
})

test('concurrent identical additions lock the same target and only one commits', async () => {
  const db = database()
  const results = await Promise.allSettled([db.service.toEntity('barolt', input), db.service.toEntity('barolt', input)])
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(results.filter((result) => result.status === 'rejected' && result.reason.code === 'EVIDENCE_CONFLICT').length, 1)
  assert.equal(db.state().evidence.length, 1)
  assert.deepEqual(db.globalWrites, [])
})

test('concurrent new Sources with the same external ID cannot both commit', async () => {
  const db = database()
  const novel = evidenceAddSchema.parse({ ...input, source: { mode: 'new', data: {
    kind: 'YOUTUBE', label: 'Enregistrement', externalId: 'video-1',
  } } })
  const results = await Promise.allSettled([db.service.toEntity('barolt', novel),
    db.service.toEntity('archipel', novel)])
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(results.filter((result) => result.status === 'rejected' && result.reason.code === 'SOURCE_CONFLICT').length, 1)
  assert.equal(db.state().sources.length, 2)
  assert.equal(db.state().evidence.length, 1)
})

test('Source and Evidence failures roll back the whole addition, including a new Source', async () => {
  const db = database()
  const novel = evidenceAddSchema.parse({ ...input, source: { mode: 'new', data: {
    kind: 'MANUAL', label: 'Nouvelle', externalId: null,
  } } })
  db.fail('source')
  await assert.rejects(db.service.toEntity('barolt', novel), /source failure/)
  assert.equal(db.state().sources.length, 1)
  db.fail('evidence')
  await assert.rejects(db.service.toRelation(relationId, novel), /evidence failure/)
  assert.equal(db.state().sources.length, 1)
  assert.equal(db.state().evidence.length, 0)
  assert.deepEqual(db.globalWrites, [])
})

test('archived targets and archived relation endpoints reject enrichment', async () => {
  const db = database()
  db.change((state) => { state.entities[0]!.status = 'ARCHIVED' })
  await assert.rejects(db.service.toEntity('barolt', input), { code: 'ENTITY_ARCHIVED' })
  await assert.rejects(db.service.toRelation(relationId, input), { code: 'ENTITY_ARCHIVED' })
  db.change((state) => { state.entities[0]!.status = 'PROPOSED'; state.relations[0]!.status = 'ARCHIVED' })
  await assert.rejects(db.service.toRelation(relationId, input), { code: 'RELATION_ARCHIVED' })
  db.change((state) => { state.relations[0]!.status = 'PROPOSED'; state.entities[1]!.status = 'ARCHIVED' })
  await assert.rejects(db.service.toRelation(relationId, input), { code: 'ENTITY_ARCHIVED' })
})

test('Source identity conflict and missing references return stable errors', async () => {
  const db = database()
  const colliding = evidenceAddSchema.parse({ ...input, source: { mode: 'new', data: {
    kind: 'MANUAL', label: 'Different label', externalId: 'chronique-1',
  } } })
  await assert.rejects(db.service.toEntity('barolt', colliding), { status: 409, code: 'SOURCE_CONFLICT' })
  await assert.rejects(db.service.toEntity('barolt', { ...input, source: {
    mode: 'existing', sourceId: '99999999-9999-4999-8999-999999999999',
  } }), { code: 'SOURCE_NOT_FOUND' })
  await assert.rejects(db.service.toEntity('absente', input), { code: 'ENTITY_NOT_FOUND' })
  await assert.rejects(db.service.toRelation('99999999-9999-4999-8999-999999999999', input), { code: 'RELATION_NOT_FOUND' })
})

test('strict Zod schema rejects injected IDs, invalid Source and Evidence fields', () => {
  for (const body of [
    { ...input, status: 'PUBLISHED' },
    { ...input, evidence: { ...input.evidence, relationId } },
    { ...input, evidence: { ...input.evidence, sourceId } },
    { ...input, evidence: { ...input.evidence, entityId } },
    { ...input, evidence: { ...input.evidence, confidence: 1.001 } },
    { ...input, evidence: { ...input.evidence, timeEndSeconds: -1 } },
    { ...input, evidence: { ...input.evidence, timeEndSeconds: 0, timeStartSeconds: 1 } },
    { ...input, evidence: { ...input.evidence, timeStartSeconds: '5' } },
    { ...input, source: { mode: 'new', data: { kind: 'MANUAL', label: 'X', url: 'javascript:alert(1)' } } },
  ]) assert.equal(evidenceAddSchema.safeParse(body).success, false)
})

const config = readAuthConfig({ DISCORD_CLIENT_ID: '111111111111111111', DISCORD_CLIENT_SECRET: 'fake',
  DISCORD_REDIRECT_URI: 'http://localhost:5173/api/auth/discord/callback', DISCORD_ADMIN_IDS: '222222222222222222',
  SESSION_SECRET: 'a-test-secret-of-more-than-thirty-two-characters', SESSION_TTL_MS: '3600000' })
let server: Server
let url: string
let routed: unknown = null
const service: EvidenceAddService = {
  async toEntity(slug, body) { routed = { slug, body }; return { id: 'proof' } },
  async toRelation(id, body) { routed = { id, body }; return { id: 'proof' } },
}
before(async () => {
  server = createApp({ async ping() {}, async listRelationTypes() { return [] },
    async listEntities() { return [] }, async getEntityBySlug() { return null } }, {
    auth: { config, store: { async findSession(hash) {
      const discordId = hash === sessionHash('a'.repeat(43)) ? '222222222222222222'
        : hash === sessionHash('b'.repeat(43)) ? '333333333333333333' : null
      return discordId ? { discordId, username: 'editor', displayName: 'Admin',
        expiresAt: new Date(Date.now() + 60_000) } : null
    }, async rotateSession() {}, async revokeSession() {} },
    discord: { authorizationUrl: () => '', exchangeCode: async () => { throw new Error('not called') } } },
    admin: { async listEntities() { return { items: [], total: 0, page: 1, pageSize: 50 } },
      async getEntity() { return null }, async getStats() { return { byStatus: { DRAFT: 0, PROPOSED: 0,
        PUBLISHED: 0, ARCHIVED: 0 }, byVisibility: { PUBLIC: 0, PLAYERS: 0, GM: 0, SECRET: 0 },
        sources: 0, relations: 0 } } },
    editorial: { async patch() { throw new Error('not called') }, async publish() { throw new Error('not called') },
      async unpublish() { throw new Error('not called') } }, evidenceAdd: service,
  }).listen(0)
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  url = `http://127.0.0.1:${address.port}`
})
after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())) })

test('both routes require admin and exact Origin; unknown fields are rejected without calling service', async () => {
  const admin = `hesta_codex_session=${'a'.repeat(43)}`
  const other = `hesta_codex_session=${'b'.repeat(43)}`
  const paths = [`/api/admin/entities/barolt/evidence`, `/api/admin/relations/${relationId}/evidence`]
  for (const path of paths) {
    const send = (cookie?: string, origin?: string, body: unknown = input) => fetch(`${url}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}),
        ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body),
    })
    assert.equal((await send(undefined, config.origin)).status, 401)
    assert.equal((await send(other, config.origin)).status, 403)
    for (const origin of [undefined, 'null', 'https://evil.example', `${config.origin}.attacker.example`,
      'http://localhost:5174', 'https://localhost:5173']) assert.equal((await send(admin, origin)).status, 403)
    routed = null
    const bad = await send(admin, config.origin, { ...input, evidence: { ...input.evidence, entityId } })
    assert.equal(bad.status, 400)
    assert.equal(routed, null)
    const good = await send(admin, config.origin)
    assert.equal(good.status, 201)
    assert.equal(good.headers.get('cache-control'), 'no-store')
    assert.ok(routed)
  }
})
