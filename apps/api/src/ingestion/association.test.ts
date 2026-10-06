import assert from 'node:assert/strict'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { Prisma, type PrismaClient } from '../prisma-client/client.ts'
import type { IngestionAssociationEntity, IngestionAssociationRequest } from '@hesta-codex/shared'
import { createPrismaIngestionAssociationService } from './association.js'
import { createPrismaIngestionAdminStore } from './admin.js'
import { EditorialError } from '../admin/editorial.js'
import { itemIdentity, parseIngestionText } from './format.js'
import { normalizeMatchName } from './matching-normalization.js'
import { scoreIngestionMatches } from './matching.js'
import { createApp } from '../app.js'
import { readAuthConfig } from '../auth/config.js'
import { sessionHash } from '../auth/session.js'

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const itemId = uuid(1), receiptId = uuid(2), sourceId = uuid(3), a = uuid(4), b = uuid(5), archived = uuid(6)
const actor = { discordId: '222222222222222222', label: 'Admin technique' }
const input = (entityId = a, expectedRevision = 0, origin: 'MATCH' | 'MANUAL' = 'MATCH'): IngestionAssociationRequest => ({ entityId, expectedRevision, origin, receiptId })
type Identity = { id: string; sourceId: string; identityKey: string; externalId: string | null; contentHash: string }
type Root = { id: string; sourceId: string; identityKey: string; externalId: string | null; itemId: string; revision: number }
type Decision = { id: string; associationId: string; entityId: string; decision: 'CONFIRMED' | 'REJECTED'; origin: 'MATCH' | 'MANUAL'; authorDiscordId: string; authorLabel: string; decidedAt: Date }
type DecisionWhere = { associationId?: string; decision?: string; entityId?: { in: string[] } }
const entity = (id: string, change: Partial<IngestionAssociationEntity> = {}): IngestionAssociationEntity => ({ id, title: 'Fiche technique ' + id.slice(-1), slug: 'technique-' + id.slice(-1),
  kind: 'PLACE', placeKind: 'CITY', status: 'DRAFT', visibility: 'SECRET', ...change })

// Relational transaction double with snapshot isolation + serializable conflict detection.
// It executes the production service and protects all eight existing models; it is not PostgreSQL.
function database() {
  const first: Identity = { id: itemId, sourceId, externalId: 'technique.md', contentHash: 'a'.repeat(64), identityKey: itemIdentity('technique.md', 'a'.repeat(64)) }
  const protectedTables = { Entity: [entity(a), entity(b, { status: 'PUBLISHED', visibility: 'PUBLIC' }), entity(archived, { status: 'ARCHIVED' })],
    Relation: [{ id: uuid(7), status: 'DRAFT', visibility: 'SECRET' }], Evidence: [{ id: uuid(8), claimText: 'Fictif' }], Revision: [{ id: uuid(9), snapshot: { fictional: true } }],
    Source: [{ id: sourceId, label: 'Source technique' }], IngestionBatch: [{ id: uuid(10), label: 'Lot technique' }],
    IngestionItem: [first], IngestionReceipt: [{ id: receiptId, itemId, metadata: { fictional: true }, content: 'Brut technique privé' }] }
  let roots: Root[] = [], decisions: Decision[] = [], epoch = 0, nextId = 100
  const faults: Array<{ point: 'upsert' | 'commit'; error: Error; beforeThrow?: () => Promise<void> }> = []
  const failAt = async (point: 'upsert' | 'commit') => {
    if (faults[0]?.point !== point) return
    const fault = faults.shift()!
    await fault.beforeThrow?.()
    throw fault.error
  }
  const calls: string[] = [], isolation: string[] = [], searchQueries: Prisma.Sql[] = []
  const prisma = { async $transaction(work: (tx: unknown) => Promise<unknown>, options: { isolationLevel: string }) {
    isolation.push(options.isolationLevel)
    const before = epoch
    const localRoots = structuredClone(roots), localDecisions = structuredClone(decisions)
    let dirty = false
    const selected = (row: Decision) => ({ origin: row.origin, authorLabel: row.authorLabel, decidedAt: row.decidedAt,
      entity: structuredClone(protectedTables.Entity.find(entity => entity.id === row.entityId)!) })
    const filtered = (where: DecisionWhere) => localDecisions.filter(value => (!where.associationId || value.associationId === where.associationId) &&
      (!where.decision || value.decision === where.decision) && (!where.entityId || where.entityId.in.includes(value.entityId)))
    const tx = {
      ingestionReceipt: { async findFirst(query: { where: { itemId: string; id?: string }; select: unknown }) {
        calls.push('receipt.read'); assert.doesNotMatch(JSON.stringify(query.select), /"(?:content|rawVariant|metadata|title|locator)"/)
        const receipt = protectedTables.IngestionReceipt.find(value => value.itemId === query.where.itemId && (!query.where.id || value.id === query.where.id))
        return receipt ? { item: structuredClone(protectedTables.IngestionItem.find(item => item.id === receipt.itemId)!) } : null
      } },
      entity: { async findUnique(query: { where: { id: string }; select: unknown }) {
        calls.push('entity.read'); assert.deepEqual(query.select, { id: true, status: true })
        const value = protectedTables.Entity.find(entity => entity.id === query.where.id)
        return value ? { id: value.id, status: value.status } : null
      } },
      ingestionAssociation: {
        async findUnique(query: { where: { sourceId_identityKey: { sourceId: string; identityKey: string } } }) {
          calls.push('association.read'); const key = query.where.sourceId_identityKey
          return structuredClone(localRoots.find(root => root.sourceId === key.sourceId && root.identityKey === key.identityKey) ?? null)
        },
        async create(query: { data: Omit<Root, 'id'> }) {
          calls.push('association.create'); dirty = true
          assert.ok(!localRoots.some(root => root.sourceId === query.data.sourceId && root.identityKey === query.data.identityKey))
          const value = { ...query.data, id: uuid(nextId++) }; localRoots.push(value); return structuredClone(value)
        },
        async updateMany(query: { where: { id: string; revision: number }; data: { revision: { increment: number } } }) {
          calls.push('association.update'); const value = localRoots.find(root => root.id === query.where.id && root.revision === query.where.revision)
          if (!value) return { count: 0 }
          dirty = true; value.revision += query.data.revision.increment; return { count: 1 }
        },
      },
      ingestionAssociationDecision: {
        async findFirst(query: { where: DecisionWhere; select: Record<string, unknown> }) {
          const value = filtered(query.where)[0]
          return value ? query.select.entityId ? { entityId: value.entityId } : selected(value) : null
        },
        async findUnique(query: { where: { associationId_entityId: { associationId: string; entityId: string } } }) {
          const key = query.where.associationId_entityId, value = localDecisions.find(row => row.associationId === key.associationId && row.entityId === key.entityId)
          return value ? { decision: value.decision } : null
        },
        async findMany(query: { where: DecisionWhere; select: Record<string, unknown>; take: number }) {
          calls.push('decision.read'); assert.ok(query.take <= 20)
          const rows = filtered(query.where).sort((a, b) => b.decidedAt.getTime() - a.decidedAt.getTime() || b.id.localeCompare(a.id)).slice(0, query.take)
          return rows.map(row => query.select.entityId ? { entityId: row.entityId } : selected(row))
        },
        async count(query: { where: DecisionWhere }) { return filtered(query.where).length },
        async deleteMany(query: { where: DecisionWhere }) {
          calls.push('decision.delete'); dirty = true; const values = filtered(query.where)
          for (const value of values) localDecisions.splice(localDecisions.indexOf(value), 1)
          return { count: values.length }
        },
        async upsert(query: { where: { associationId_entityId: { associationId: string; entityId: string } }; create: Omit<Decision, 'id'>; update: Partial<Decision> }) {
          calls.push('decision.upsert'); dirty = true; const key = query.where.associationId_entityId
          const value = localDecisions.find(row => row.associationId === key.associationId && row.entityId === key.entityId)
          if (value) Object.assign(value, query.update); else localDecisions.push({ ...query.create, id: uuid(nextId++) })
          assert.equal(localDecisions.filter(row => row.associationId === key.associationId && row.decision === 'CONFIRMED').length <= 1, true)
          await failAt('upsert')
        },
      },
    }
    const guarded = new Proxy(tx, { get(target, key, receiver) { assert.ok(Reflect.has(target, key), `Forbidden model ${String(key)}`); return Reflect.get(target, key, receiver) } })
    const result = await work(guarded)
    if (dirty) {
      await failAt('commit')
      if (epoch !== before) throw new Prisma.PrismaClientKnownRequestError('Fictitious serialization conflict', { code: 'P2034', clientVersion: 'test' })
      roots = localRoots; decisions = localDecisions; epoch++
    }
    return result
  }, async $queryRaw(query: Prisma.Sql) {
    searchQueries.push(query) // literal LIMIT 21, bound search only
    assert.match(query.sql, /LIMIT 21/); assert.doesNotMatch(query.sql, /bodyMarkdown|metadata|Evidence|Revision/)
    const q = String(query.values.at(-1))
    return protectedTables.Entity.filter(entity => entity.status !== 'ARCHIVED' && [entity.title, entity.slug].some(value => normalizeMatchName(value).includes(q))).slice(0, 21)
  } } as unknown as PrismaClient
  return { prisma, service: createPrismaIngestionAssociationService(prisma), protectedTables, calls, isolation, searchQueries,
    decisions: () => structuredClone(decisions), roots: () => structuredClone(roots),
    failNext(point: 'upsert' | 'commit', error: Error, beforeThrow?: () => Promise<void>) { faults.push({ point, error, beforeThrow }) },
    addItem(id: string, externalId: string | null, hash: string, source = sourceId) {
      const item = { id, sourceId: source, externalId, contentHash: hash, identityKey: itemIdentity(externalId, hash) }
      protectedTables.IngestionItem.push(item); protectedTables.IngestionReceipt.push({ id: uuid(Number(id.slice(-12)) + 1), itemId: id, metadata: { fictional: true }, content: 'Brut technique privé' })
      return item
    },
  }
}

test('confirm exact/possible suggestions and manual selection persist only dedicated decisions with server actor/date', async () => {
  for (const origin of ['MATCH', 'MANUAL'] as const) {
    const db = database()
    Object.assign(db.protectedTables.Entity[0]!, { bodyMarkdown: 'Narratif technique privé', metadata: { fictional: true }, aliases: ['Alias privé hors DTO'] })
    const before = structuredClone(db.protectedTables)
    const state = await db.service.confirm(itemId, input(a, 0, origin), actor)
    assert.equal(state.confirmed?.entity.id, a); assert.equal(state.confirmed?.origin, origin); assert.equal(state.revision, 1)
    assert.equal(state.confirmed?.authorLabel, actor.label); assert.ok(state.confirmed?.decidedAt)
    assert.equal(db.decisions()[0]?.authorDiscordId, actor.discordId)
    assert.deepEqual(db.protectedTables, before)
    assert.doesNotMatch(JSON.stringify(state), /bodyMarkdown|aliases|Narratif|authorDiscordId|identityKey|externalId|content|metadata|Evidence|Revision|discordId/)
    assert.equal(db.isolation[0], 'Serializable')
  }
})
test('read-only GET does not allocate an association and reset of an empty identity is a no-op', async () => {
  const db = database(), before = structuredClone(db.protectedTables)
  assert.equal((await db.service.read(itemId, receiptId)).revision, 0)
  await db.service.reset(itemId, { receiptId, expectedRevision: 0 })
  assert.deepEqual(db.roots(), []); assert.deepEqual(db.decisions(), []); assert.deepEqual(db.protectedTables, before)
})
test('rejections are identity/entity scoped, visible on matching candidates, and can be explicitly overridden', async () => {
  const db = database(), before = structuredClone(db.protectedTables)
  await db.service.reject(itemId, input(), actor)
  await db.service.reject(itemId, input(b, 1), actor)
  const state = await db.service.read(itemId, receiptId, [a, b])
  assert.equal(state.rejectedCount, 2); assert.deepEqual(new Set(state.rejectedCandidateIds), new Set([a, b]))
  assert.equal(state.confirmed, null)
  const confirmed = await db.service.confirm(itemId, input(a, 2), actor)
  assert.equal(confirmed.confirmed?.entity.id, a); assert.equal(confirmed.rejectedCount, 1)
  await assert.rejects(db.service.reject(itemId, input(a, 3), actor), (error: unknown) => error instanceof EditorialError && error.code === 'ALREADY_CONFIRMED')
  assert.deepEqual(db.protectedTables, before)
})
test('replacement A → B and reset are reversible without treating old confirmation as a rejection', async () => {
  const db = database(), before = structuredClone(db.protectedTables)
  await db.service.confirm(itemId, input(), actor)
  const changed = await db.service.confirm(itemId, input(b, 1, 'MANUAL'), { ...actor, label: 'Autre admin technique' })
  assert.equal(changed.confirmed?.entity.id, b); assert.equal(changed.revision, 2); assert.equal(changed.rejectedCount, 0)
  const cleared = await db.service.reset(itemId, { receiptId, expectedRevision: 2 })
  assert.equal(cleared.confirmed, null); assert.equal(cleared.revision, 3)
  assert.deepEqual(db.decisions(), []); assert.deepEqual(db.protectedTables, before)
})
test('identical repeats preserve revision, author, date and decision count', async () => {
  const db = database(), first = await db.service.confirm(itemId, input(), actor), saved = db.decisions()
  const repeated = await db.service.confirm(itemId, input(), { ...actor, label: 'Second admin' })
  assert.deepEqual(repeated, first); assert.deepEqual(db.decisions(), saved)
  await db.service.reject(itemId, input(b, 1), actor)
  const rejected = db.decisions(); await db.service.reject(itemId, input(b, 0), actor)
  assert.deepEqual(db.decisions(), rejected)
})
test('human confirmation and rejection never change global matching scores, candidate order or status', async () => {
  const db = database(), pool = db.protectedTables.Entity.map(entity => ({ ...entity, aliases: [], sameSourceAndLocator: false }))
  const context = { title: pool[0]!.title, sourceId, locator: null, externalId: 'technique.md' }
  const before = scoreIngestionMatches(context, pool)
  assert.equal(before.status, 'EXACT'); assert.equal((await db.service.read(itemId)).confirmed, null)
  await db.service.reject(itemId, input(), actor)
  assert.deepEqual(scoreIngestionMatches(context, pool), before)
  await db.service.confirm(itemId, input(a, 1), actor)
  assert.deepEqual(scoreIngestionMatches(context, pool), before)
})
test('different concurrent confirmations yield one success and one 409; same-target concurrency is idempotent', async () => {
  for (const same of [false, true]) for (const first of [a, b]) {
    const db = database(), before = structuredClone(db.protectedTables)
    const results = await Promise.allSettled([db.service.confirm(itemId, input(first), actor), db.service.confirm(itemId, input(same ? first : first === a ? b : a), actor)])
    assert.equal(results.filter(result => result.status === 'fulfilled').length, same ? 2 : 1)
    if (!same) assert.ok(results.some(result => result.status === 'rejected' && result.reason instanceof EditorialError && result.reason.status === 409))
    assert.equal(db.decisions().filter(value => value.decision === 'CONFIRMED').length, 1)
    assert.equal(db.roots()[0]?.revision, 1); assert.deepEqual(db.protectedTables, before)
  }
})

test('failures after revision/delete/upsert or at commit roll back every association change and preserve existing tables', async () => {
  for (const point of ['upsert', 'commit'] as const) {
    const db = database()
    await db.service.confirm(itemId, input(), actor)
    await db.service.reject(itemId, input(b, 1), actor)
    const roots = db.roots(), decisions = db.decisions(), before = structuredClone(db.protectedTables)
    const failure = new Error('Fictitious transaction failure')
    db.failNext(point, failure)
    await assert.rejects(db.service.confirm(itemId, input(b, 2), actor), error => error === failure)
    assert.deepEqual(db.roots(), roots); assert.deepEqual(db.decisions(), decisions); assert.deepEqual(db.protectedTables, before)
    assert.equal((await db.service.read(itemId)).confirmed?.entity.id, a)
    if (point === 'commit') {
      db.failNext(point, failure)
      await assert.rejects(db.service.reset(itemId, { receiptId, expectedRevision: 2 }), error => error === failure)
      assert.deepEqual(db.roots(), roots); assert.deepEqual(db.decisions(), decisions); assert.deepEqual(db.protectedTables, before)
    }
  }
})

test('P2002/P2034 retries reread a committed competitor, preserve expectedRevision and stop after one retry', async () => {
  for (const code of ['P2002', 'P2034']) {
    const failure = () => new Prisma.PrismaClientKnownRequestError('Fictitious database conflict', { code, clientVersion: 'test' })
    for (const competitor of [a, b]) {
      const db = database(), before = structuredClone(db.protectedTables)
      db.failNext('commit', failure(), async () => { await db.service.confirm(itemId, input(competitor), actor) })
      if (competitor === a) assert.equal((await db.service.confirm(itemId, input(), actor)).confirmed?.entity.id, a)
      else await assert.rejects(db.service.confirm(itemId, input(), actor), (error: unknown) => error instanceof EditorialError && error.status === 409)
      assert.equal(db.roots()[0]?.revision, 1); assert.equal(db.decisions().length, 1)
      assert.equal(db.decisions()[0]?.entityId, competitor); assert.deepEqual(db.protectedTables, before)
    }
    const db = database(), before = structuredClone(db.protectedTables)
    db.failNext('commit', failure()); db.failNext('commit', failure())
    await assert.rejects(db.service.confirm(itemId, input(), actor), (error: unknown) => error instanceof EditorialError && error.status === 409)
    assert.equal(db.isolation.filter(level => level === 'Serializable').length, 2)
    assert.deepEqual(db.roots(), []); assert.deepEqual(db.decisions(), []); assert.deepEqual(db.protectedTables, before)
  }
})

test('external identity preserves Unicode, internal spaces and case; disappearance/return never joins anonymous content', async () => {
  const db = database(), externalId = 'Épreuve interne.md'
  db.addItem(uuid(300), externalId, 'a'.repeat(64))
  await db.service.confirm(uuid(300), { ...input(), receiptId: uuid(301) }, actor)
  db.addItem(uuid(310), externalId, 'b'.repeat(64))
  assert.equal((await db.service.read(uuid(310))).confirmed?.entity.id, a)
  for (const [index, other] of [externalId.normalize('NFD'), externalId.toLowerCase(), 'Épreuve  interne.md', null].entries()) {
    const id = uuid(320 + index * 10); db.addItem(id, other, 'a'.repeat(64))
    assert.equal((await db.service.read(id)).confirmed, null)
  }
  db.addItem(uuid(360), externalId, 'c'.repeat(64))
  assert.equal((await db.service.read(uuid(360))).confirmed?.entity.id, a)
  for (const invalid of ['', ' ', ' Épreuve.md', 'Épreuve.md ', '\tÉpreuve.md']) {
    assert.equal(parseIngestionText(JSON.stringify({ version: 1, batch: { label: 'Lot technique' },
      items: [{ source: { id: sourceId }, externalId: invalid, content: 'Contenu fictif' }] })).success, false)
  }
})
test('stale replacement/reset/reject cannot overwrite newer human decisions or perform an ABA reset', async () => {
  const db = database(); await db.service.confirm(itemId, input(), actor)
  await db.service.confirm(itemId, input(b, 1), actor)
  const before = db.decisions()
  for (const operation of [() => db.service.confirm(itemId, input(a, 1), actor), () => db.service.reject(itemId, input(a, 1), actor), () => db.service.reset(itemId, { receiptId, expectedRevision: 1 })]) {
    await assert.rejects(operation(), (error: unknown) => error instanceof EditorialError && error.status === 409)
  }
  assert.deepEqual(db.decisions(), before)
  await db.service.reset(itemId, { receiptId, expectedRevision: 2 })
  await assert.rejects(db.service.confirm(itemId, input(), actor), (error: unknown) => error instanceof EditorialError && error.status === 409)
})
test('unchanged reception and version 2 of the same external identity inherit; changed Source/externalId do not', async () => {
  const db = database(); await db.service.confirm(itemId, input(), actor)
  db.protectedTables.IngestionReceipt.push({ ...db.protectedTables.IngestionReceipt[0]!, id: uuid(21) })
  assert.equal((await db.service.read(itemId, uuid(21))).confirmed?.entity.id, a)
  db.addItem(uuid(30), 'technique.md', 'b'.repeat(64))
  assert.equal((await db.service.read(uuid(30), uuid(31))).confirmed?.entity.id, a)
  db.addItem(uuid(40), 'autre-technique.md', 'a'.repeat(64)); db.addItem(uuid(50), 'technique.md', 'a'.repeat(64), uuid(53))
  assert.equal((await db.service.read(uuid(40), uuid(41))).confirmed, null)
  assert.equal((await db.service.read(uuid(50), uuid(51))).confirmed, null)
})
test('anonymous content is snapshot-scoped, and incompatible identities never inherit blindly', async () => {
  const db = database(); db.addItem(uuid(60), null, 'c'.repeat(64)); db.addItem(uuid(70), null, 'd'.repeat(64))
  const state = await db.service.confirm(uuid(60), { ...input(), receiptId: uuid(61) }, actor)
  assert.equal(state.scope, 'SNAPSHOT'); assert.equal((await db.service.read(uuid(70), uuid(71))).confirmed, null)
  db.addItem(uuid(80), null, 'c'.repeat(64))
  await assert.rejects(db.service.read(uuid(80), uuid(81)), (error: unknown) => error instanceof EditorialError && error.code === 'INCOMPATIBLE_IDENTITY')
  db.protectedTables.IngestionItem[0]!.identityKey = 'e:' + '0'.repeat(64)
  await assert.rejects(db.service.read(itemId), (error: unknown) => error instanceof EditorialError && error.code === 'INCOMPATIBLE_IDENTITY')
})
test('missing Entity/item/receipt and archived targets are rejected without writes; existing archived association can be removed', async () => {
  const db = database()
  for (const call of [() => db.service.confirm(itemId, input(uuid(90)), actor), () => db.service.confirm(itemId, { ...input(), receiptId: uuid(90) }, actor), () => db.service.read(uuid(90))])
    await assert.rejects(call(), (error: unknown) => error instanceof EditorialError && error.status === 404)
  for (const call of [() => db.service.confirm(itemId, input(archived), actor), () => db.service.reject(itemId, input(archived), actor)])
    await assert.rejects(call(), (error: unknown) => error instanceof EditorialError && error.status === 409)
  assert.deepEqual(db.roots(), [])
  await db.service.confirm(itemId, input(), actor)
  db.protectedTables.Entity.find(entity => entity.id === a)!.status = 'ARCHIVED'
  assert.equal((await db.service.read(itemId)).invalid, true)
  assert.equal((await db.service.reset(itemId, { receiptId, expectedRevision: 1 })).confirmed, null)
})
test('old rejected candidates remain annotated beyond the 20 recent decisions, with bounded projections', async () => {
  const db = database(); await db.service.reject(itemId, input(), actor)
  for (let n = 0; n < 25; n++) { const id = uuid(200 + n); db.protectedTables.Entity.push(entity(id)); await db.service.reject(itemId, input(id, n + 1), actor) }
  const state = await db.service.read(itemId, receiptId, [a])
  assert.equal(state.rejectedCount, 26); assert.equal(state.recentRejections.length, 20); assert.deepEqual(state.rejectedCandidateIds, [a])
})
test('migration has separate tables, restricted foreign keys, identity/pair uniqueness and a partial unique confirmation index', async () => {
  const sql = await readFile(new URL('../../../../prisma/migrations/20261006000000_ingestion_associations/migration.sql', import.meta.url), 'utf8')
  assert.match(sql, /UNIQUE INDEX "IngestionAssociation_sourceId_identityKey_key"/)
  assert.match(sql, /UNIQUE INDEX "IngestionAssociationDecision_associationId_entityId_key"/)
  assert.match(sql, /UNIQUE INDEX "IngestionAssociationDecision_one_confirmed_key"[\s\S]*WHERE "decision" = 'CONFIRMED'/)
  assert.match(sql, /"revision" >= 0/)
  const statements = sql.replace(/--[^\n]*/g, '').trim()
  assert.ok(statements.startsWith('BEGIN;') && statements.endsWith('COMMIT;'))
  for (const name of sql.matchAll(/(?:INDEX|CONSTRAINT) "([^"]+)"/g)) assert.ok(name[1]!.length <= 63)
  assert.doesNotMatch(sql, /ALTER TABLE "(?:Entity|Evidence|Relation|Revision|Source|IngestionItem|IngestionReceipt)"|DROP |CREATE EXTENSION/)
})

async function api(work: (base: string, headers: Record<string, string>, db: ReturnType<typeof database>) => Promise<void>) {
  const db = database()
  const config = readAuthConfig({ DISCORD_CLIENT_ID: '111111111111111111', DISCORD_CLIENT_SECRET: 'fake', DISCORD_REDIRECT_URI: 'http://localhost:5173/api/auth/discord/callback',
    DISCORD_ADMIN_IDS: actor.discordId, SESSION_SECRET: 'a-test-secret-of-more-than-thirty-two-characters', SESSION_TTL_MS: '3600000' })
  const server = createApp({ async ping() {}, async listRelationTypes() { return [] }, async listEntities() { return [] }, async getEntityBySlug() { return null } }, {
    auth: { config, store: { async findSession(hash) {
      const discordId = hash === sessionHash('a'.repeat(43)) ? actor.discordId : hash === sessionHash('b'.repeat(43)) ? '333333333333333333' : null
      return discordId ? { discordId, username: actor.label, displayName: null, expiresAt: new Date(Date.now() + 60_000) } : null
    }, async rotateSession() {}, async revokeSession() {} }, discord: { authorizationUrl: () => '', async exchangeCode() { throw new Error('unused') } } },
    admin: { async listEntities() { return { items: [], total: 0, page: 1, pageSize: 50 } }, async getEntity() { return null },
      async getStats() { return { byStatus: { DRAFT: 0, PROPOSED: 0, PUBLISHED: 0, ARCHIVED: 0 }, byVisibility: { PUBLIC: 0, PLAYERS: 0, GM: 0, SECRET: 0 }, sources: 0, relations: 0 } } },
    editorial: { async patch() { throw new Error('unused') }, async publish() { throw new Error('unused') }, async unpublish() { throw new Error('unused') } },
    ingestion: createPrismaIngestionAdminStore(db.prisma),
  }).listen(0)
  await once(server, 'listening'); const address = server.address(); assert.ok(address && typeof address !== 'string')
  try { await work(`http://127.0.0.1:${address.port}`, { Cookie: `hesta_codex_session=${'a'.repeat(43)}`, Origin: config.origin, 'Content-Type': 'application/json' }, db) }
  finally { await new Promise<void>(resolve => server.close(() => resolve())) }
}
test('association API gates every route with session/whitelist/Origin/no-store before any staging access', async () => api(async (base, headers, db) => {
  const before = db.calls.length
  const routes = [['GET', `/items/${itemId}/association`], ...['confirm', 'reject', 'reset'].map(action => ['POST', `/items/${itemId}/association/${action}`]), ['POST', '/entities/search']]
  for (const [method, path] of routes) {
    const url = base + '/api/admin/ingestion' + path
    for (const [badHeaders, status] of [[{}, 401], [{ Cookie: `hesta_codex_session=${'b'.repeat(43)}` }, 403]] as const) {
      const response: Response = await fetch(url, { method, headers: badHeaders }); assert.equal(response.status, status); assert.equal(response.headers.get('cache-control'), 'no-store')
    }
    if (method === 'POST') {
      for (const origin of ['', 'https://example.invalid']) {
        const response: Response = await fetch(url, { method, headers: { ...headers, Origin: origin } }); assert.equal(response.status, 403); assert.equal(response.headers.get('cache-control'), 'no-store')
      }
    }
  }
  assert.equal(db.calls.length, before); assert.equal(db.searchQueries.length, 0)
}))
test('strict admin decision bodies reject spoofed actor/time/Source/Entity fields and malformed receipt or revision', async () => api(async (base, headers, db) => {
  const url = `${base}/api/admin/ingestion/items/${itemId}/association/confirm`
  for (const change of [{ authorDiscordId: '999' }, { authorLabel: 'Spoof' }, { decidedAt: '2026-10-06T00:00:00Z' }, { sourceId }, { title: 'Spoof' },
    { expectedRevision: -1 }, { expectedRevision: 0.5 }, { receiptId: 'bad' }, { entityId: 'bad' }, { origin: 'AUTO' }]) {
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ ...input(), ...change }) })
    assert.equal(response.status, 400); assert.equal(response.headers.get('cache-control'), 'no-store')
  }
  assert.deepEqual(db.roots(), [])
  assert.equal((await fetch(url + '?sourceId=' + sourceId, { method: 'POST', headers, body: JSON.stringify(input()) })).status, 400)
  assert.equal((await fetch(`${base}/api/admin/ingestion/items/${itemId}/association?receiptId=bad`, { headers })).status, 400)
  assert.equal((await fetch(`${base}/api/admin/ingestion/items/${itemId}/association`, { headers: { ...headers, 'X-Hesta-Association-Candidates': 'bad' } })).status, 400)
}))
test('HTTP confirmation, rejection, replacement and reset are minimal, idempotent and preserve all existing tables', async () => api(async (base, headers, db) => {
  const before = structuredClone(db.protectedTables), path = `${base}/api/admin/ingestion/items/${itemId}/association`
  const post = (action: string, body: unknown) => fetch(path + '/' + action, { method: 'POST', headers, body: JSON.stringify(body) })
  const confirmed = await post('confirm', input()); assert.equal(confirmed.status, 200); assert.equal(confirmed.headers.get('cache-control'), 'no-store')
  const state = await confirmed.json(); assert.equal(state.confirmed.authorLabel, actor.label)
  assert.doesNotMatch(JSON.stringify(state), /authorDiscordId|sourceId|contentHash|rawVariant|metadata|identityKey|externalId|discordId/)
  assert.equal((await post('confirm', input())).status, 200)
  assert.equal((await post('confirm', input(b))).status, 409)
  assert.equal((await post('reject', input(b, 1))).status, 200)
  const read = await fetch(path + '?receiptId=' + receiptId, { headers: { ...headers, 'X-Hesta-Association-Candidates': JSON.stringify([a, b]) } })
  assert.deepEqual((await read.json()).rejectedCandidateIds, [b])
  assert.equal((await post('confirm', input(b, 2, 'MANUAL'))).status, 200)
  assert.equal((await post('reset', { receiptId, expectedRevision: 3 })).status, 200)
  assert.deepEqual(db.protectedTables, before)
  for (const url of [path.replace('/api/admin/', '/api/v1/'), `${base}/api/v1/ingestion/entities/search`, `${base}/api/v1/entities`]) {
    const response = await fetch(url); assert.equal(response.status, url.endsWith('/entities') ? 200 : 404); assert.doesNotMatch(await response.text(), /Admin technique|technique.md|Brut technique/)
  }
}))
test('manual search sends literal Unicode title/slug/alias criteria only in a POST body, with minimal bounded SQL', async () => api(async (base, headers, db) => {
  Object.assign(db.protectedTables.Entity[0]!, { bodyMarkdown: 'Narratif technique privé', metadata: { fictional: true } })
  const response = await fetch(`${base}/api/admin/ingestion/entities/search`, { method: 'POST', headers, body: JSON.stringify({ q: 'TECHNIQUE' }) })
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store')
  const state = await response.json(); assert.equal(state.items.length, 2); assert.equal(state.items.some((entity: IngestionAssociationEntity) => entity.status === 'ARCHIVED'), false)
  assert.doesNotMatch(JSON.stringify(state), /bodyMarkdown|Narratif|metadata/)
  const sql = db.searchQueries[0]!; assert.match(sql.sql, /unnest\(e.aliases\)/); assert.equal(sql.values.filter(value => value === 'technique').length, 3)
  for (const q of ['x', '\0abc', '\uD800abc', '\u0085\u0085']) assert.equal((await fetch(`${base}/api/admin/ingestion/entities/search`, { method: 'POST', headers, body: JSON.stringify({ q }) })).status, 400)
  assert.equal((await fetch(`${base}/api/admin/ingestion/entities/search?q=private`, { method: 'POST', headers, body: JSON.stringify({ q: 'technique' }) })).status, 400)
}))
test('simultaneous HTTP confirmations for different targets expose a 409 and exactly one active decision', async () => api(async (base, headers, db) => {
  const url = `${base}/api/admin/ingestion/items/${itemId}/association/confirm`
  const responses = await Promise.all([a, b].map(entityId => fetch(url, { method: 'POST', headers, body: JSON.stringify(input(entityId)) })))
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409])
  assert.ok(responses.every(response => response.headers.get('cache-control') === 'no-store'))
  assert.equal(db.decisions().filter(value => value.decision === 'CONFIRMED').length, 1)
}))
test('404 and 500 association failures keep no-store and never expose internal criteria in response or logs', async context => api(async (base, headers, db) => {
  const path = `${base}/api/admin/ingestion/items/${uuid(99)}/association`
  const missing = await fetch(path, { headers }); assert.equal(missing.status, 404); assert.equal(missing.headers.get('cache-control'), 'no-store')
  const logged: unknown[][] = []; context.mock.method(console, 'error', (...values: unknown[]) => { logged.push(values) })
  context.mock.method(db.prisma, '$transaction', async () => { throw new Error('private synthetic detail') })
  const failed = await fetch(`${base}/api/admin/ingestion/items/${itemId}/association`, { headers })
  assert.equal(failed.status, 500); assert.equal(failed.headers.get('cache-control'), 'no-store'); assert.doesNotMatch(await failed.text(), /synthetic|technique/)
  assert.deepEqual(logged, [['Hesta Codex API request failed']])
}))
