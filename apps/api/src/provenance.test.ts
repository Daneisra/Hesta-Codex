import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { Server } from 'node:http'
import { after, before, test } from 'node:test'
import type { AdminEntityDetail } from '@hesta-codex/shared'
import { Prisma, type PrismaClient } from './prisma-client/client.ts'
import { createApp } from './app.js'
import { createPrismaProvenanceService, type ProvenanceService } from './admin/provenance.js'
import { evidencePatchSchema, relationPatchSchema, sourcePatchSchema } from './admin/provenance-validation.js'
import type { AdminStore } from './admin/store.js'
import type { EditorialService } from './admin/editorial.js'
import { readAuthConfig } from './auth/config.js'
import { sessionHash } from './auth/session.js'
import type { AuthStore } from './auth/store.js'
import type { CodexStore } from './store.js'

const date = new Date('2026-09-28T12:00:00.000Z')
const expectedUpdatedAt = date.toISOString()
const relationId = '11111111-1111-4111-8111-111111111111'
const sourceId = '22222222-2222-4222-8222-222222222222'
const evidenceId = '33333333-3333-4333-8333-333333333333'
const relationPatch = { description: 'Description nouvelle', visibility: 'PUBLIC' as const, expectedUpdatedAt }
const sourcePatch = { kind: 'MANUAL' as const, label: 'Notes', externalId: null,
  url: null, authorLabel: null, publishedAt: null, visibility: 'GM' as const, expectedUpdatedAt }
const evidencePatch = { claimText: 'Énoncé', sourceExcerpt: null, locator: null, timeStartSeconds: null,
  timeEndSeconds: null, confidence: null, visibility: 'GM' as const, expectedUpdatedAt }

function fakeDatabase() {
  const relation = { id: relationId, description: null as string | null, visibility: 'GM', status: 'PROPOSED',
    updatedAt: date, fromEntityId: 'from', toEntityId: 'to' }
  const source = { id: sourceId, kind: 'MANUAL', label: 'Notes', externalId: null as string | null,
    url: null, authorLabel: null, publishedAt: null, visibility: 'GM', updatedAt: date }
  const evidence = { id: evidenceId, claimText: 'Énoncé', sourceExcerpt: null, locator: null,
    timeStartSeconds: null, timeEndSeconds: null, confidence: null, visibility: 'GM', updatedAt: date,
    entity: { status: 'PROPOSED' } as null | { status: string },
    relation: null as null | { status: string; fromEntity: { status: string };
      toEntity: { status: string } } }
  const writes: Array<{ table: string; where: Record<string, unknown>; data: Record<string, unknown> }> = []
  let collision = false
  let uniqueConflict = false
  let evidenceCount = 1
  let entityCount = 2
  const update = (table: string, row: Record<string, unknown>) => async (input: {
    where: Record<string, unknown>; data: Record<string, unknown>
  }) => {
    writes.push({ table, ...input })
    if (collision) row.updatedAt = new Date(date.getTime() + 1)
    if (row.updatedAt !== input.where.updatedAt || (input.where.status && input.where.status !== row.status)) {
      return { count: 0 }
    }
    if (uniqueConflict && table === 'source') throw new Prisma.PrismaClientKnownRequestError('unique',
      { code: 'P2002', clientVersion: '7.10.0' })
    Object.assign(row, input.data)
    return { count: 1 }
  }
  const tx = {
    relation: { findUnique: async () => relation, updateMany: update('relation', relation as unknown as Record<string, unknown>) },
    source: { findUnique: async () => source, updateMany: update('source', source as unknown as Record<string, unknown>) },
    evidence: { findUnique: async () => evidence, updateMany: update('evidence', evidence as unknown as Record<string, unknown>),
      count: async () => evidenceCount },
    entity: { count: async () => entityCount },
  }
  const prisma = { $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx) } as unknown as PrismaClient
  return { service: createPrismaProvenanceService(prisma), relation, source, evidence, writes,
    setCollision(value: boolean) { collision = value }, setUniqueConflict(value: boolean) { uniqueConflict = value },
    setEvidenceCount(value: number) { evidenceCount = value }, setEntityCount(value: number) { entityCount = value } }
}

test('Relation uses conditional update, no-op avoids a write, stale versions return RELATION_MODIFIED', async () => {
  const db = fakeDatabase()
  await db.service.patchRelation(relationId, { description: null, visibility: 'GM', expectedUpdatedAt })
  assert.equal(db.writes.length, 0)
  await db.service.patchRelation(relationId, relationPatch)
  assert.equal(db.relation.description, relationPatch.description)
  assert.equal(db.relation.status, 'PROPOSED')
  assert.equal(db.writes[0]?.where.updatedAt, date)
  await assert.rejects(db.service.patchRelation(relationId, relationPatch), { code: 'RELATION_MODIFIED' })
  const raced = fakeDatabase()
  raced.setCollision(true)
  await assert.rejects(raced.service.patchRelation(relationId, relationPatch), { code: 'RELATION_MODIFIED' })
})

test('Relation publication requires its own Evidence and both endpoints; unpublish leaves them alone', async () => {
  const db = fakeDatabase()
  db.setEvidenceCount(0)
  await assert.rejects(db.service.publishRelation(relationId, { expectedUpdatedAt }), { code: 'EVIDENCE_REQUIRED' })
  db.setEvidenceCount(1); db.setEntityCount(1)
  await assert.rejects(db.service.publishRelation(relationId, { expectedUpdatedAt }), { code: 'INVALID_RELATION' })
  db.setEntityCount(2)
  const raced = fakeDatabase()
  raced.setCollision(true)
  await assert.rejects(raced.service.publishRelation(relationId, { expectedUpdatedAt }),
    { code: 'RELATION_MODIFIED' })
  assert.equal(raced.relation.status, 'PROPOSED')
  const published = await db.service.publishRelation(relationId, { expectedUpdatedAt })
  assert.equal(published.status, 'PUBLISHED')
  assert.equal(db.relation.visibility, 'GM')
  assert.equal(db.relation.status, 'PUBLISHED')
  assert.deepEqual(db.writes.map((write) => write.table), ['relation'])
  assert.deepEqual(Object.keys(db.writes[0]!.data).sort(), ['status', 'updatedAt'])
  await assert.rejects(db.service.unpublishRelation(relationId, { expectedUpdatedAt }), { code: 'RELATION_MODIFIED' })
  const racedUnpublish = fakeDatabase()
  racedUnpublish.relation.status = 'PUBLISHED'
  racedUnpublish.setCollision(true)
  await assert.rejects(racedUnpublish.service.unpublishRelation(relationId, { expectedUpdatedAt }),
    { code: 'RELATION_MODIFIED' })
  assert.equal(racedUnpublish.relation.status, 'PUBLISHED')
  const unpublished = await db.service.unpublishRelation(relationId, { expectedUpdatedAt: published.updatedAt })
  assert.equal(unpublished.status, 'PROPOSED')
  assert.equal(db.relation.fromEntityId, 'from')
  assert.equal(db.relation.toEntityId, 'to')
  assert.equal(db.relation.visibility, 'GM')
  assert.deepEqual(Object.keys(db.writes[1]!.data).sort(), ['status', 'updatedAt'])
  assert.deepEqual(db.writes.map((write) => write.table), ['relation', 'relation'])
})

test('Source and Evidence use conditional updates, no-op, and safe unique conflict', async () => {
  const db = fakeDatabase()
  await db.service.patchSource(sourceId, sourcePatch)
  await db.service.patchEvidence(evidenceId, evidencePatch)
  assert.equal(db.writes.length, 0)
  await db.service.patchSource(sourceId, { ...sourcePatch, label: 'Notes corrigées' })
  assert.equal(db.writes[0]?.where.updatedAt, date)
  await assert.rejects(db.service.patchSource(sourceId, sourcePatch), { code: 'SOURCE_MODIFIED' })
  db.setUniqueConflict(true)
  const conflict = fakeDatabase(); conflict.setUniqueConflict(true)
  await assert.rejects(conflict.service.patchSource(sourceId, { ...sourcePatch, externalId: 'same' }),
    { code: 'SOURCE_CONFLICT' })
  await db.service.patchEvidence(evidenceId, { ...evidencePatch, claimText: 'Corrigé' })
  assert.equal(db.writes[1]?.table, 'evidence')
  assert.equal(db.writes[1]?.where.updatedAt, date)
  await assert.rejects(db.service.patchEvidence(evidenceId, evidencePatch), { code: 'EVIDENCE_MODIFIED' })
  const racedSource = fakeDatabase()
  racedSource.setCollision(true)
  await assert.rejects(racedSource.service.patchSource(sourceId, { ...sourcePatch, label: 'Concurrent' }),
    { code: 'SOURCE_MODIFIED' })
  const racedEvidence = fakeDatabase()
  racedEvidence.setCollision(true)
  await assert.rejects(racedEvidence.service.patchEvidence(evidenceId, { ...evidencePatch, claimText: 'Concurrent' }),
    { code: 'EVIDENCE_MODIFIED' })
})

test('Evidence of an archived Entity or Relation is read-only', async () => {
  const db = fakeDatabase()
  db.evidence.entity!.status = 'ARCHIVED'
  await assert.rejects(db.service.patchEvidence(evidenceId, evidencePatch), { code: 'ENTITY_ARCHIVED' })
  db.evidence.entity = null
  db.evidence.relation = { status: 'ARCHIVED', fromEntity: { status: 'PROPOSED' },
    toEntity: { status: 'PROPOSED' } }
  await assert.rejects(db.service.patchEvidence(evidenceId, evidencePatch), { code: 'RELATION_ARCHIVED' })
  db.evidence.relation.status = 'PROPOSED'
  db.evidence.relation.toEntity.status = 'ARCHIVED'
  await assert.rejects(db.service.patchEvidence(evidenceId, evidencePatch), { code: 'ENTITY_ARCHIVED' })
  assert.equal(db.writes.length, 0)
})

test('strict provenance validation rejects identity changes, bad URL, timestamps and confidence', () => {
  assert.equal(relationPatchSchema.safeParse({ ...relationPatch, status: 'PUBLISHED' }).success, false)
  assert.equal(relationPatchSchema.safeParse({ ...relationPatch, fromEntityId: 'other' }).success, false)
  assert.equal(sourcePatchSchema.safeParse({ ...sourcePatch, metadata: {} }).success, false)
  assert.equal(sourcePatchSchema.safeParse({ ...sourcePatch, externalId: ' id ' }).success, false)
  assert.equal(sourcePatchSchema.safeParse({ ...sourcePatch, url: 'ftp://example.org' }).success, false)
  assert.equal(evidencePatchSchema.safeParse({ ...evidencePatch, entityId: 'other' }).success, false)
  assert.equal(evidencePatchSchema.safeParse({ ...evidencePatch, sourceId: 'other' }).success, false)
  for (const invalid of [
    { claimText: ' ' }, { locator: 'x'.repeat(251) }, { timeStartSeconds: -1 },
    { timeStartSeconds: 20, timeEndSeconds: 19 }, { confidence: -0.1 },
    { confidence: 1.1 }, { confidence: 0.1234 },
  ]) assert.equal(evidencePatchSchema.safeParse({ ...evidencePatch, ...invalid }).success, false)
  assert.equal(evidencePatchSchema.safeParse({ ...evidencePatch, confidence: null,
    timeStartSeconds: 8072, timeEndSeconds: 8072 }).success, true)
  for (const field of ['id', 'fromEntityId', 'toEntityId', 'relationTypeId', 'status', 'createdAt', 'updatedAt']) {
    assert.equal(relationPatchSchema.safeParse({ ...relationPatch, [field]: 'forbidden' }).success, false, field)
  }
  for (const field of ['id', 'metadata', 'derivedFromSourceId', 'createdAt', 'updatedAt']) {
    assert.equal(sourcePatchSchema.safeParse({ ...sourcePatch, [field]: 'forbidden' }).success, false, field)
  }
  for (const field of ['id', 'sourceId', 'entityId', 'relationId', 'createdAt', 'updatedAt']) {
    assert.equal(evidencePatchSchema.safeParse({ ...evidencePatch, [field]: 'forbidden' }).success, false, field)
  }
  assert.equal(sourcePatchSchema.safeParse({ ...sourcePatch, label: ' '.repeat(10) }).success, false)
  assert.equal(sourcePatchSchema.safeParse({ ...sourcePatch, label: 'x'.repeat(251) }).success, false)
  assert.equal(sourcePatchSchema.safeParse({ ...sourcePatch, authorLabel: 'x'.repeat(201) }).success, false)
  assert.equal(sourcePatchSchema.safeParse({ ...sourcePatch, kind: 'INVALID' }).success, false)
  assert.equal(sourcePatchSchema.safeParse({ ...sourcePatch, publishedAt: '2026-09-28' }).success, false)
  assert.equal(evidencePatchSchema.safeParse({ ...evidencePatch, visibility: 'INVALID' }).success, false)
  assert.equal(evidencePatchSchema.safeParse({ ...evidencePatch, timeStartSeconds: 2_147_483_648 }).success, false)
  assert.equal(relationPatchSchema.safeParse({ ...relationPatch, expectedUpdatedAt: 'yesterday' }).success, false)
})

const config = readAuthConfig({ DISCORD_CLIENT_ID: '111111111111111111', DISCORD_CLIENT_SECRET: 'fake',
  DISCORD_REDIRECT_URI: 'http://localhost:5173/api/auth/discord/callback', DISCORD_ADMIN_IDS: '222222222222222222',
  SESSION_SECRET: 'a-test-secret-of-more-than-thirty-two-characters', SESSION_TTL_MS: '3600000' })
const authStore: AuthStore = {
  async findSession(hash) {
    const discordId = hash === sessionHash('a'.repeat(43)) ? '222222222222222222'
      : hash === sessionHash('b'.repeat(43)) ? '333333333333333333' : null
    return discordId ? { discordId, username: 'editor', displayName: 'Danny',
      expiresAt: new Date(Date.now() + 60_000) } : null
  },
  async rotateSession() {}, async revokeSession() {},
}
const publicStore: CodexStore = {
  async ping() {}, async listRelationTypes() { return [] }, async listEntities() { return [] },
  async getEntityBySlug() { return null },
}
const adminStore: AdminStore = {
  async listEntities() { return { items: [], total: 0, page: 1, pageSize: 50 } },
  async getEntity() { return null }, async getStats() { return { byStatus: { DRAFT: 0, PROPOSED: 0, PUBLISHED: 0, ARCHIVED: 0 },
    byVisibility: { PUBLIC: 0, PLAYERS: 0, GM: 0, SECRET: 0 }, sources: 0, relations: 0 } },
}
const editorial: EditorialService = {
  async patch() { return {} as AdminEntityDetail }, async publish() { return {} as AdminEntityDetail },
  async unpublish() { return {} as AdminEntityDetail },
}
const calls: string[] = []
const provenance: ProvenanceService = {
  async patchRelation() { calls.push('patchRelation'); return { id: relationId, updatedAt: expectedUpdatedAt } },
  async publishRelation() { calls.push('publishRelation'); return { id: relationId, updatedAt: expectedUpdatedAt } },
  async unpublishRelation() { calls.push('unpublishRelation'); return { id: relationId, updatedAt: expectedUpdatedAt } },
  async patchSource() { calls.push('patchSource'); return { id: sourceId, updatedAt: expectedUpdatedAt } },
  async patchEvidence() { calls.push('patchEvidence'); return { id: evidenceId, updatedAt: expectedUpdatedAt } },
}
let server: Server
let baseUrl: string
before(async () => {
  server = createApp(publicStore, { auth: { config, store: authStore,
    discord: { authorizationUrl: () => '', exchangeCode: async () => { throw new Error('not called') } } },
  admin: adminStore, editorial, provenance }).listen(0)
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  baseUrl = `http://127.0.0.1:${address.port}`
})
after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())) })
function request(path: string, body: unknown, cookie?: string, origin?: string, method = 'PATCH') {
  return fetch(`${baseUrl}${path}`, { method, headers: { 'Content-Type': 'application/json',
    ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) })
}
test('all provenance mutations enforce admin session, exact Origin, no-store, strict JSON', async () => {
  for (const [path, method, body] of [
    [`/api/admin/relations/${relationId}`, 'PATCH', relationPatch],
    [`/api/admin/relations/${relationId}/publish`, 'POST', { expectedUpdatedAt }],
    [`/api/admin/relations/${relationId}/unpublish`, 'POST', { expectedUpdatedAt }],
    [`/api/admin/sources/${sourceId}`, 'PATCH', sourcePatch],
    [`/api/admin/evidence/${evidenceId}`, 'PATCH', evidencePatch],
  ] as const) {
    const admin = `hesta_codex_session=${'a'.repeat(43)}`
    const player = `hesta_codex_session=${'b'.repeat(43)}`
    assert.equal((await request(path, body, undefined, config.origin, method)).status, 401)
    assert.equal((await request(path, body, player, config.origin, method)).status, 403)
    for (const origin of [undefined, 'null', 'https://evil.example', `${config.origin}.attacker.example`,
      'http://localhost:5174']) assert.equal((await request(path, body, admin, origin, method)).status, 403)
    const allowed = await request(path, body, admin, config.origin, method)
    assert.equal(allowed.status, 200)
    assert.equal(allowed.headers.get('cache-control'), 'no-store')
    const invalid = await request(path, { ...body, metadata: { secret: true } }, admin, config.origin, method)
    assert.equal(invalid.status, 400)
  }
  assert.deepEqual(calls.slice(-5), ['patchRelation', 'publishRelation', 'unpublishRelation', 'patchSource', 'patchEvidence'])
})
