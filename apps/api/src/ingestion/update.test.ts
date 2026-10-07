import assert from 'node:assert/strict'
import { once } from 'node:events'
import { test } from 'node:test'
import { Prisma, type PrismaClient } from '../prisma-client/client.ts'
import { EditorialError, entitySnapshot } from '../admin/editorial.js'
import { createPrismaIngestionUpdateService } from './update.js'
import { ingestionUpdateSchema } from './update-validation.js'
import { itemIdentity } from './format.js'
import { createPrismaIngestionAdminStore } from './admin.js'
import { createApp } from '../app.js'
import { readAuthConfig } from '../auth/config.js'
import { sessionHash } from '../auth/session.js'
import { createPrismaStore } from '../store.js'
import { createPrismaGraphStore } from '../graph.js'

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const itemId = uuid(1), receiptId = uuid(2), sourceId = uuid(3), entityId = uuid(4), rootId = uuid(5)
const now = new Date('2026-10-06T10:00:00Z'), actor = { discordId: '222222222222222222', label: 'Admin technique' }
const fields = { title: 'Fiche actuelle', kind: 'PERSON' as const, placeKind: null, summary: 'Résumé actuel',
  bodyMarkdown: 'Contenu actuel fictif', aliases: ['Alias actuel'], tags: ['actuel'], visibility: 'GM' as const }
const body = () => ({ receiptId, targetEntityId: entityId, expectedAssociationRevision: 7, expectedEntityUpdatedAt: now.toISOString(),
  entity: { ...fields, title: 'Titre humain modifié' }, evidence: { claimText: 'Énoncé humain', sourceExcerpt: 'Épreuve œ\r\n', locator: 'repère choisi.md' } })
type Row = Record<string, unknown>
type State = Record<'source' | 'entity' | 'relation' | 'relationType' | 'evidence' | 'revision' | 'batch' | 'item' | 'receipt' | 'root' | 'decision', Row[]>
// Copy-on-write test double; it never constructs a Prisma client or opens PostgreSQL.
function database() {
  let state: State = { source: [{ id: sourceId, kind: 'OBSIDIAN', label: 'Coffre fictif', visibility: 'SECRET' }],
    entity: [{ ...fields, id: entityId, slug: 'fiche-technique', status: 'PROPOSED', publishedAt: null, createdAt: now, updatedAt: now },
      { ...fields, id: uuid(90), slug: 'autre-fiche', status: 'DRAFT', publishedAt: null, createdAt: now, updatedAt: now }],
    relation: [{ id: uuid(91), status: 'DRAFT', visibility: 'GM' }], relationType: [{ id: uuid(92), label: 'Type fictif' }],
    evidence: [{ id: uuid(93), entityId, sourceId, claimText: 'Ancienne preuve intacte' }],
    revision: [{ id: uuid(94), entityId, number: 4, snapshot: { ingestion: { receiptId, version: 1 } } }],
    batch: [{ id: uuid(95), label: 'Lot fictif' }], item: [{ id: itemId, sourceId, externalId: 'fixture.md',
      identityKey: itemIdentity('fixture.md', 'a'.repeat(64)), contentHash: 'a'.repeat(64), content: 'Texte du staging fictif', version: 2 }],
    receipt: [{ id: receiptId, itemId, title: 'Titre staging', contentType: 'text/markdown', metadata: { tags: ['staging'], private: 'Texte privé fictif' },
      rawVariant: 'Épreuve œ\r\n', locator: 'fixture.md', observedAt: now, ingestedAt: now }],
    root: [{ id: rootId, sourceId, identityKey: itemIdentity('fixture.md', 'a'.repeat(64)), externalId: 'fixture.md', itemId, revision: 7 }],
    decision: [{ id: uuid(96), associationId: rootId, entityId, decision: 'CONFIRMED', origin: 'MANUAL', authorLabel: 'Auteur initial', authorDiscordId: '333333333333333333', decidedAt: now }] }
  let epoch = 0, nextId = 100, failure: string | null = null, failureError: Error | null = null
  const operations: string[] = [], levels: string[] = [], locks: unknown[][] = []
  const checkpoints = new Map<string, () => void | Promise<void>>()
  const checkpoint = async (stage: string) => { const work = checkpoints.get(stage); checkpoints.delete(stage); await work?.() }
  const fault = (stage: string) => { if (failure === stage) throw failureError ?? new Error('Private fictitious SQL failure') }
  const prisma = new Proxy({ async $transaction<T>(work: (tx: unknown) => Promise<T>, options: { isolationLevel: string }) {
    levels.push(options.isolationLevel)
    const start = epoch, pending = structuredClone(state)
    let dirty = false
    const write = (stage: string) => { operations.push(stage); dirty = true; fault(stage) }
    const tx = {
      async $queryRaw(sql: Prisma.Sql) {
        assert.match(sql.sql, /^SELECT id FROM "IngestionAssociation"/); assert.match(sql.sql, /FOR SHARE$/)
        locks.push(sql.values); fault('lock')
        await checkpoint('beforeRootLock')
        if (state.root.find(row => row.id === sql.values[0])?.revision !== pending.root.find(row => row.id === sql.values[0])?.revision) {
          throw new Prisma.PrismaClientKnownRequestError('Fictitious changed locked row', { code: 'P2034', clientVersion: 'test' })
        }
        return pending.root.filter(row => row.id === sql.values[0] && row.revision === sql.values[1]).map(row => ({ id: row.id }))
      },
      source: { async findUnique(query: { where: { id: string } }) { return pending.source.find(row => row.id === query.where.id) ?? null } },
      entity: {
        async findUnique(query: { where: { id: string } }) { return pending.entity.find(row => row.id === query.where.id) ?? null },
        async updateMany(query: { where: { id: string; status: string; updatedAt: Date }; data: Row }) {
          assert.deepEqual(Object.keys(query.data).sort(), [...Object.keys(fields), 'updatedAt'].sort())
          await checkpoint('beforeCAS')
          const live = state.entity.find(row => row.id === query.where.id)
          if (live?.status !== query.where.status || (live.updatedAt as Date).getTime() !== query.where.updatedAt.getTime()) {
            throw new Prisma.PrismaClientKnownRequestError('Fictitious changed update row', { code: 'P2034', clientVersion: 'test' })
          }
          const row = pending.entity.find(row => row.id === query.where.id && row.status === query.where.status && (row.updatedAt as Date).getTime() === query.where.updatedAt.getTime())
          if (!row || failure === 'cas') return { count: 0 }
          write('entity'); Object.assign(row, query.data); await checkpoint('afterEntity'); return { count: 1 }
        },
      },
      ingestionReceipt: { async findFirst(query: { where: { itemId: string; id: string } }) {
        const row = pending.receipt.find(row => row.id === query.where.id && row.itemId === query.where.itemId)
        const item = row && pending.item.find(item => item.id === row.itemId)
        return item && row ? { ...row, item } : null
      } },
      ingestionAssociation: { async findUnique(query: { where: { sourceId_identityKey: { sourceId: string; identityKey: string } } }) {
        const key = query.where.sourceId_identityKey
        return pending.root.find(row => row.sourceId === key.sourceId && row.identityKey === key.identityKey) ?? null
      } },
      ingestionAssociationDecision: { async findFirst(query: { where: { associationId: string; decision: string } }) {
        return pending.decision.find(row => row.associationId === query.where.associationId && row.decision === query.where.decision) ?? null
      } },
      evidence: { async create(query: { data: Row }) { write('evidence'); const row = { ...query.data, id: uuid(nextId++) }; pending.evidence.push(row); await checkpoint('afterEvidence'); return row } },
      revision: {
        async findFirst(query: { where: { entityId: string; AND: Array<{ snapshot: { path: string[]; equals: string } }> } }) {
          return pending.revision.find(row => row.entityId === query.where.entityId && query.where.AND.every(check => {
            let value: unknown = row.snapshot
            for (const key of check.snapshot.path) value = value && typeof value === 'object' ? (value as Row)[key] : undefined
            return value === check.snapshot.equals
          })) ?? null
        },
        async aggregate(query: { where: { entityId: string } }) { return { _max: { number: Math.max(0, ...pending.revision.filter(row => row.entityId === query.where.entityId).map(row => Number(row.number))) } } },
        async create(query: { data: Row }) { write('revision'); const row = { ...query.data, id: uuid(nextId++) }; pending.revision.push(row); await checkpoint('afterRevision'); return row },
      },
    }
    const result = await work(new Proxy(tx, { get(target, key, receiver) { assert.ok(Reflect.has(target, key), `Forbidden transaction model ${String(key)}`); return Reflect.get(target, key, receiver) } }))
    if (dirty) {
      if (epoch !== start) throw new Prisma.PrismaClientKnownRequestError('Fictitious concurrent change', { code: 'P2034', clientVersion: 'test' })
      fault('commit'); state = pending; epoch++
    }
    return result
  } }, { get(target, key, receiver) { assert.equal(key, '$transaction', 'No access outside transaction'); return Reflect.get(target, key, receiver) } }) as unknown as PrismaClient
  return { prisma, service: createPrismaIngestionUpdateService(prisma), operations, levels, locks, state: () => structuredClone(state),
    at: (stage: string, work: () => void | Promise<void>) => { checkpoints.set(stage, work) },
    change: (work: (value: State) => void) => { work(state); epoch++ }, fail: (stage: string, error: Error | null = null) => { failure = stage; failureError = error } }
}
const business = (code: string, status?: number) => (error: unknown) => error instanceof EditorialError && error.code === code && (!status || error.status === status)
const apply = (db: ReturnType<typeof database>, input: unknown = body()) => db.service.apply(itemId, ingestionUpdateSchema.parse(input), actor)

test('update preparation is strictly read-only, pinned and exposes current fields separately from exact receipt data', async () => {
  const db = database(), before = db.state(), result = await db.service.prepare(itemId, receiptId)
  assert.equal(result.entity.title, fields.title); assert.equal(result.entity.bodyMarkdown, fields.bodyMarkdown)
  assert.equal(result.staging.title, 'Titre staging'); assert.equal(result.staging.content, 'Épreuve œ\r\n')
  assert.equal(result.version, 2); assert.equal(result.expectedAssociationRevision, 7); assert.equal(result.expectedEntityUpdatedAt, now.toISOString())
  assert.equal(result.contentHash, 'a'.repeat(64)); assert.equal(result.alreadyApplied, false)
  assert.equal(result.staging.tagsAvailable, true); assert.equal(result.source.id, sourceId)
  assert.doesNotMatch(JSON.stringify(result), /authorDiscordId|Texte privé fictif|metadata/)
  assert.deepEqual(db.state(), before); assert.deepEqual(db.operations, []); assert.deepEqual(db.locks, []); assert.deepEqual(db.levels, ['RepeatableRead'])
})
test('oversized/unsupported staging remains intact and cannot silently truncate or replace editorial content', async () => {
  const db = database()
  db.change(state => { Object.assign(state.receipt[0]!, { title: 'x'.repeat(201), rawVariant: 'œ'.repeat(100_001), locator: 'x'.repeat(251), metadata: { tags: ['a', 'A'] } }) })
  const prepared = await db.service.prepare(itemId, receiptId)
  assert.equal(prepared.staging.content.length, 100_001); assert.equal(prepared.staging.title?.length, 201); assert.equal(prepared.staging.locator?.length, 251)
  assert.equal(prepared.evidence.locator, null); assert.equal(prepared.evidence.sourceExcerpt, null); assert.equal(prepared.staging.tagsAvailable, false); assert.equal(prepared.warnings.length, 4)
  db.change(state => { state.receipt[0]!.contentType = 'application/json' })
  const unsupported = await db.service.prepare(itemId, receiptId)
  assert.equal(unsupported.staging.contentSupported, false); assert.equal(unsupported.staging.content.length, 100_001); assert.equal(unsupported.entity.bodyMarkdown, fields.bodyMarkdown)
})
for (const [label, mutate, code] of [
  ['no association', (s: State) => { s.root = [] }, 'ASSOCIATION_REQUIRED'],
  ['withdrawn confirmation', (s: State) => { s.decision = [] }, 'ASSOCIATION_REQUIRED'],
  ['missing Entity', (s: State) => { s.entity = [] }, 'ENTITY_NOT_FOUND'],
  ['archived Entity', (s: State) => { s.entity[0]!.status = 'ARCHIVED' }, 'INVALID_STATUS'],
  ['missing Source', (s: State) => { s.source = [] }, 'SOURCE_NOT_FOUND'],
  ['missing item', (s: State) => { s.item = [] }, 'INGESTION_ITEM_NOT_FOUND'],
  ['foreign receipt', (s: State) => { s.receipt[0]!.itemId = uuid(99) }, 'INGESTION_ITEM_NOT_FOUND'],
  ['incompatible identity', (s: State) => { s.item[0]!.identityKey = 'invalid' }, 'INCOMPATIBLE_IDENTITY'],
] as const) test(`preparation and application refuse ${label} without writes`, async () => {
  const db = database(); db.change(mutate); const before = db.state()
  await assert.rejects(db.service.prepare(itemId, receiptId), business(code)); await assert.rejects(apply(db), business(code))
  assert.deepEqual(db.state(), before); assert.deepEqual(db.operations, [])
})
test('PUBLISHED can only be compared; application and a concurrent publication are rejected without touching publication', async () => {
  const db = database(); await db.service.prepare(itemId, receiptId)
  db.change(state => { state.entity[0]!.status = 'PUBLISHED'; state.entity[0]!.publishedAt = now })
  const before = db.state(), result = await db.service.prepare(itemId, receiptId)
  assert.match(result.warnings.join(' '), /Cette fiche est publiée/)
  await assert.rejects(apply(db), business('INVALID_STATUS', 409)); assert.deepEqual(db.state(), before); assert.deepEqual(db.operations, [])
})
for (const [label, change] of [
  ['title', { title: 'Titre choisi' }], ['body', { bodyMarkdown: 'Texte humain exact œ\r\n' }], ['tags', { tags: ['œ', 'test, intact'] }],
  ['multiple fields', { title: 'Titre choisi', kind: 'PLACE', placeKind: 'CITY', summary: null, bodyMarkdown: 'Nouvelle édition', aliases: [], tags: [], visibility: 'PLAYERS' }],
] as const) test(`updating ${label} changes only eight editorial fields and appends one Evidence and Revision`, async () => {
  const db = database(), before = db.state(), result = await apply(db, { ...body(), entity: { ...fields, ...change } }), after = db.state()
  for (const key of ['source', 'relation', 'relationType', 'item', 'receipt', 'batch', 'root', 'decision'] as const) assert.deepEqual(after[key], before[key])
  assert.deepEqual(after.entity[1], before.entity[1]); assert.deepEqual(after.evidence[0], before.evidence[0]); assert.deepEqual(after.revision[0], before.revision[0])
  for (const key of ['id', 'slug', 'status', 'publishedAt', 'createdAt']) assert.deepEqual(after.entity[0]![key], before.entity[0]![key])
  assert.equal(after.entity.length, before.entity.length); assert.equal(after.evidence.length, 2); assert.equal(after.revision.length, 2)
  assert.deepEqual(db.operations, ['entity', 'evidence', 'revision']); assert.deepEqual(db.levels, ['Serializable']); assert.deepEqual(db.locks, [[rootId, 7]])
  assert.ok((after.entity[0]!.updatedAt as Date) > now); assert.equal(result.revisionNumber, 5)
  const evidence = after.evidence[1]!, revision = after.revision[1]!, snapshot = revision.snapshot as { version: number; entity: Row; ingestion: Row }
  assert.equal(evidence.entityId, entityId); assert.equal(evidence.sourceId, sourceId); assert.equal(evidence.relationId, null); assert.equal(evidence.visibility, 'SECRET')
  for (const key of ['confidence', 'timeStartSeconds', 'timeEndSeconds']) assert.equal(evidence[key], null)
  assert.equal(evidence.claimText, body().evidence.claimText); assert.equal(evidence.sourceExcerpt, body().evidence.sourceExcerpt)
  assert.equal(revision.number, 5); assert.equal(revision.editorLabel, actor.label); assert.equal(revision.message, 'Mise à jour depuis l’ingestion')
  assert.deepEqual({ version: snapshot.version, entity: snapshot.entity }, entitySnapshot(after.entity[0] as unknown as Parameters<typeof entitySnapshot>[0]))
  assert.deepEqual(snapshot.ingestion, { action: 'UPDATE', itemId, receiptId, sourceId, evidenceId: evidence.id, contentHash: 'a'.repeat(64), version: 2,
    locator: 'fixture.md', observedAt: now.toISOString(), ingestedAt: now.toISOString() })
  assert.doesNotMatch(JSON.stringify(result), /receiptId|sourceId|bodyMarkdown|contentHash|metadata|authorDiscordId/)
})
test('DRAFT stays DRAFT and all visibility pairs use the most restrictive current Source/final Entity visibility', async () => {
  const visibility = ['PUBLIC', 'PLAYERS', 'GM', 'SECRET'] as const
  for (const [a, source] of visibility.entries()) for (const [b, entity] of visibility.entries()) {
    const db = database(); db.change(state => { state.source[0]!.visibility = source; state.entity[0]!.status = 'DRAFT' })
    await apply(db, { ...body(), entity: { ...body().entity, visibility: entity } })
    assert.equal(db.state().evidence[1]!.visibility, visibility[Math.max(a, b)]); assert.equal(db.state().entity[0]!.status, 'DRAFT')
  }
})
test('unchanged editorial values, including a provenance-only change, produce NO_CHANGES/422 and zero writes', async () => {
  const db = database(), before = db.state()
  await assert.rejects(apply(db, { ...body(), entity: fields }), business('NO_CHANGES', 422))
  assert.deepEqual(db.state(), before); assert.deepEqual(db.operations, [])
})
for (const [label, mutate, code] of [
  ['Entity timestamp', (s: State) => { s.entity[0]!.updatedAt = new Date(now.getTime() + 1) }, 'ENTITY_MODIFIED'],
  ['association revision', (s: State) => { s.root[0]!.revision = 8 }, 'ASSOCIATION_MODIFIED'],
  ['target replacement', (s: State) => { s.decision[0]!.entityId = uuid(90) }, 'ASSOCIATION_TARGET_CHANGED'],
] as const) test(`stale ${label} cannot overwrite later state`, async () => {
  const db = database(); await db.service.prepare(itemId, receiptId); db.change(mutate); const before = db.state()
  await assert.rejects(apply(db), business(code, 409)); assert.deepEqual(db.state(), before); assert.deepEqual(db.operations, [])
})
test('a failed Entity CAS creates no orphan Evidence/Revision', async () => {
  const db = database(), before = db.state(); db.fail('cas')
  await assert.rejects(apply(db), business('ENTITY_MODIFIED')); assert.deepEqual(db.state(), before); assert.deepEqual(db.operations, [])
})
for (const stage of ['lock', 'entity', 'evidence', 'revision', 'commit']) test(`failure at ${stage} rolls back every object`, async () => {
  const db = database(), before = db.state(); db.fail(stage)
  await assert.rejects(apply(db)); assert.deepEqual(db.state(), before); assert.deepEqual(db.levels, ['Serializable'])
})
for (const [stage, code, expected] of [['revision', 'P2002', 'STALE_INGESTION_STATE'], ['commit', 'P2034', 'STALE_INGESTION_STATE'], ['evidence', 'P2003', 'SOURCE_NOT_FOUND']] as const) test(`${code} at ${stage} is safe, atomic and never retried`, async () => {
  const db = database(), before = db.state(); db.fail(stage, new Prisma.PrismaClientKnownRequestError('Private driver error', { code, clientVersion: 'test' }))
  await assert.rejects(apply(db), business(expected)); assert.deepEqual(db.state(), before); assert.deepEqual(db.levels, ['Serializable'])
})
test('retries and fresh preparation of an already applied receipt cannot duplicate provenance', async () => {
  const db = database(); await apply(db); const after = db.state()
  await assert.rejects(apply(db), business('ENTITY_MODIFIED'))
  const prepared = await db.service.prepare(itemId, receiptId); assert.equal(prepared.alreadyApplied, true)
  await assert.rejects(apply(db, { ...body(), expectedEntityUpdatedAt: prepared.expectedEntityUpdatedAt, entity: { ...body().entity, title: 'Autre titre' } }), business('RECEIPT_ALREADY_APPLIED'))
  assert.deepEqual(db.state(), after); assert.deepEqual(db.operations, ['entity', 'evidence', 'revision'])
})
test('two concurrent receipts targeting one Entity yield one complete success and one explicit conflict', async () => {
  for (const sameReceipt of [true, false]) {
    const db = database()
    if (!sameReceipt) db.change(state => { state.receipt.push({ ...state.receipt[0], id: uuid(20) }) })
    const results = await Promise.allSettled([apply(db), apply(db, { ...body(), receiptId: sameReceipt ? receiptId : uuid(20), entity: { ...body().entity, title: 'Second titre' } })])
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
    const failure = results.find(result => result.status === 'rejected'); assert.ok(failure?.status === 'rejected' && failure.reason instanceof EditorialError && failure.reason.status === 409)
    assert.equal(db.state().evidence.length, 2); assert.equal(db.state().revision.length, 2); assert.equal(db.state().root[0]!.revision, 7)
  }
})
test('a concurrent commit after all prechecks is rejected at the actual Entity CAS', async () => {
  for (const sameReceipt of [true, false]) {
    const db = database()
    if (!sameReceipt) db.change(state => { state.receipt.push({ ...state.receipt[0], id: uuid(20) }) })
    let reached!: () => void, resume!: () => void
    const ready = new Promise<void>(resolve => { reached = resolve }), pause = new Promise<void>(resolve => { resume = resolve })
    db.at('beforeCAS', async () => { reached(); await pause })
    const older = apply(db); await ready
    await apply(db, { ...body(), receiptId: sameReceipt ? receiptId : uuid(20), entity: { ...fields, title: 'Gagnant concurrent' } })
    const committed = db.state(); resume()
    await assert.rejects(older, business('STALE_INGESTION_STATE', 409))
    assert.deepEqual(db.state(), committed); assert.deepEqual(db.operations, ['entity', 'evidence', 'revision'])
    assert.equal(committed.evidence.length, 2); assert.equal(committed.revision.length, 2)
  }
})
test('association replacement between root read and shared lock aborts without any editorial write', async () => {
  const db = database()
  db.at('beforeRootLock', () => db.change(state => { state.root[0]!.revision = 8; state.decision[0]!.entityId = uuid(90) }))
  await assert.rejects(apply(db), business('STALE_INGESTION_STATE', 409))
  assert.equal(db.state().entity[0]!.title, fields.title); assert.equal(db.state().evidence.length, 1); assert.equal(db.state().revision.length, 1)
  assert.equal(db.state().decision[0]!.entityId, uuid(90)); assert.equal(db.state().root[0]!.revision, 8); assert.deepEqual(db.operations, [])
})
for (const stage of ['afterEntity', 'afterEvidence', 'afterRevision']) test(`a fault ${stage} rolls back even records already written by the transaction`, async () => {
  const db = database(), before = db.state()
  db.at(stage, () => { throw new Error('Fictitious private failure after insertion') })
  await assert.rejects(apply(db)); assert.deepEqual(db.state(), before)
})
test('withdrawal and reconfirmation of the same target invalidates an old preparation', async () => {
  const db = database(); await db.service.prepare(itemId, receiptId)
  db.change(state => { state.root[0]!.revision = 9; state.decision[0]!.authorLabel = 'Nouvel auteur'; state.decision[0]!.decidedAt = new Date(now.getTime() + 1) })
  const before = db.state(); await assert.rejects(apply(db), business('ASSOCIATION_MODIFIED', 409))
  assert.deepEqual(db.state(), before); assert.deepEqual(db.operations, [])
})
test('only the confirmed target is authoritative and historical application to another Entity never returns silent success', async () => {
  const db = database(); db.change(state => { state.decision[0]!.entityId = uuid(90)
    state.revision.push({ id: uuid(20), entityId, number: 5, snapshot: { ingestion: { action: 'UPDATE', receiptId } } }) })
  const prepared = await db.service.prepare(itemId, receiptId), before = db.state()
  assert.equal(prepared.entity.id, uuid(90)); assert.equal(prepared.alreadyApplied, false)
  await assert.rejects(apply(db), business('ASSOCIATION_TARGET_CHANGED', 409)); assert.deepEqual(db.state(), before)
  await apply(db, { ...body(), targetEntityId: prepared.entity.id })
  const after = db.state(); assert.deepEqual(after.entity[0], before.entity[0]); assert.equal(after.entity[1]!.title, body().entity.title)
  assert.equal(after.evidence[1]!.entityId, uuid(90)); assert.equal(after.revision[2]!.entityId, uuid(90)); assert.equal(after.revision[2]!.number, 1)
  assert.deepEqual(after.root, before.root); assert.deepEqual(after.decision, before.decision)
})
test('distinct receipts with the same hash and a later version require a fresh review and append separate origins', async () => {
  for (const laterVersion of [false, true]) {
    const db = database(); await apply(db)
    const nextItem = laterVersion ? uuid(20) : itemId, nextReceipt = uuid(21)
    db.change(state => {
      if (laterVersion) state.item.push({ ...state.item[0], id: nextItem, version: 3, contentHash: 'b'.repeat(64) })
      state.receipt.push({ ...state.receipt[0], id: nextReceipt, itemId: nextItem })
    })
    const prepared = await db.service.prepare(nextItem, nextReceipt); assert.equal(prepared.alreadyApplied, false)
    const result = await db.service.apply(nextItem, ingestionUpdateSchema.parse({ ...body(), receiptId: nextReceipt,
      expectedEntityUpdatedAt: prepared.expectedEntityUpdatedAt, entity: { ...body().entity, title: 'Nouvelle revue volontaire' } }), actor)
    const after = db.state(), trace = (after.revision[2]!.snapshot as { ingestion: Row }).ingestion
    assert.equal(result.revisionNumber, 6); assert.equal(after.evidence.length, 3); assert.equal(after.revision.length, 3)
    assert.equal(trace.receiptId, nextReceipt); assert.equal(trace.itemId, nextItem); assert.equal(trace.version, laterVersion ? 3 : 2)
    assert.equal(trace.contentHash, (laterVersion ? 'b' : 'a').repeat(64)); assert.equal(after.root[0]!.revision, 7)
  }
})
test('normalized equivalent values are a no-op; array order and exact body whitespace remain meaningful', async () => {
  const db = database(), before = db.state()
  await assert.rejects(apply(db, { ...body(), entity: { ...fields, title: ` ${fields.title} `, summary: ` ${fields.summary} `,
    aliases: fields.aliases.map(value => ` ${value} `), tags: fields.tags.map(value => ` ${value} `) } }), business('NO_CHANGES', 422))
  assert.deepEqual(db.state(), before)
  for (const change of [{ bodyMarkdown: fields.bodyMarkdown + ' ' }, { bodyMarkdown: fields.bodyMarkdown + '\r\n' }, { aliases: ['b', 'a'] }, { tags: ['b', 'a'] }]) {
    const separate = database(); separate.change(state => { state.entity[0]!.aliases = ['a', 'b']; state.entity[0]!.tags = ['a', 'b'] })
    await apply(separate, { ...body(), entity: { ...fields, aliases: ['a', 'b'], tags: ['a', 'b'], ...change } })
    assert.equal(separate.state().evidence.length, 2); assert.equal(separate.state().revision.length, 2)
  }
})
test('empty/null provenance and Unicode dates preserve the receipt while tracing its exact origin', async () => {
  for (const empty of [null, '']) {
    const db = database(); db.change(state => { Object.assign(state.receipt[0]!, { locator: empty, observedAt: null, rawVariant: ' e\u0301 œ\r\n ' }) })
    const before = db.state(); await apply(db, { ...body(), evidence: { claimText: ' énoncé œ ', sourceExcerpt: empty, locator: empty } })
    const after = db.state(), trace = (after.revision[1]!.snapshot as { ingestion: Row }).ingestion
    assert.equal(after.evidence[1]!.sourceExcerpt, empty); assert.equal(after.evidence[1]!.locator, empty); assert.equal(after.evidence[1]!.claimText, 'énoncé œ')
    assert.equal(trace.locator, empty); assert.equal(trace.observedAt, null); assert.equal(trace.ingestedAt, now.toISOString())
    assert.deepEqual(after.receipt, before.receipt); assert.deepEqual(after.item, before.item)
  }
})
test('a newer staging version does not silently switch the pinned receipt or original provenance', async () => {
  const db = database(); await db.service.prepare(itemId, receiptId)
  db.change(state => { state.item.push({ ...state.item[0], id: uuid(20), version: 3, contentHash: 'b'.repeat(64) }); state.receipt.push({ ...state.receipt[0], id: uuid(21), itemId: uuid(20) }) })
  const before = db.state(); await apply(db)
  assert.deepEqual(db.state().item, before.item); assert.deepEqual(db.state().receipt, before.receipt)
  assert.equal((db.state().revision[1]!.snapshot as { ingestion: Row }).ingestion.version, 2)
})
test('strict schema refuses client-controlled identities/publication/trace, invalid editorial values and malformed Unicode', () => {
  for (const change of [{ sourceId }, { evidenceId: uuid(99) }, { editorLabel: 'spoof' }, { contentHash: 'spoof' }, { version: 3 }, { ingestion: {} },
    { expectedAssociationRevision: -1 }, { targetEntityId: 'bad' }, { receiptId: 'bad' }, { expectedEntityUpdatedAt: 'bad' }]) assert.equal(ingestionUpdateSchema.safeParse({ ...body(), ...change }).success, false)
  for (const change of [{ slug: 'other' }, { status: 'PUBLISHED' }, { publishedAt: now.toISOString() }, { createdAt: now.toISOString() }, { metadata: {} },
    { kind: 'PLACE', placeKind: null }, { kind: 'PERSON', placeKind: 'CITY' }, { kind: 'BAD' }, { title: '' }, { title: 'x'.repeat(201) }, { title: '\uD800' },
    { summary: 'x'.repeat(501) }, { bodyMarkdown: 'x'.repeat(100_001) }, { bodyMarkdown: 'a\0b' }, { tags: ['x', 'X'] }, { aliases: ['é', 'e\u0301'] },
    { aliases: [''] }, { aliases: ['x'.repeat(201)] }, { tags: ['x'.repeat(101)] }, { tags: Array.from({ length: 31 }, (_, i) => String(i)) }])
    assert.equal(ingestionUpdateSchema.safeParse({ ...body(), entity: { ...body().entity, ...change } }).success, false)
  for (const change of [{ sourceId }, { visibility: 'PUBLIC' }, { confidence: 1 }, { locator: 'x'.repeat(251) }, { claimText: '' }])
    assert.equal(ingestionUpdateSchema.safeParse({ ...body(), evidence: { ...body().evidence, ...change } }).success, false)
  const parsed = ingestionUpdateSchema.parse({ ...body(), entity: { ...body().entity, title: 'Épreuve œ', bodyMarkdown: 'œ'.repeat(100_000), summary: 'x'.repeat(500), aliases: ['x'.repeat(200)], tags: ['x'.repeat(100)] } })
  assert.equal(parsed.entity.bodyMarkdown.length, 100_000); assert.equal(parsed.evidence.sourceExcerpt, 'Épreuve œ\r\n')
})

async function api(work: (base: string, headers: Record<string, string>, db: ReturnType<typeof database>) => Promise<void>) {
  const db = database(), config = readAuthConfig({ DISCORD_CLIENT_ID: '111111111111111111', DISCORD_CLIENT_SECRET: 'fake',
    DISCORD_REDIRECT_URI: 'http://localhost:5173/api/auth/discord/callback', DISCORD_ADMIN_IDS: actor.discordId,
    SESSION_SECRET: 'test-secret-more-than-thirty-two-characters', SESSION_TTL_MS: '3600000' })
  const read = (rows: Row[], query: { where: Row; select: Row }) => {
    assert.equal(query.where.status, 'PUBLISHED'); assert.equal(query.where.visibility, 'PUBLIC')
    return rows.filter(row => row.status === 'PUBLISHED' && row.visibility === 'PUBLIC' && (!query.where.slug || row.slug === query.where.slug))
      .map(row => Object.fromEntries(Object.entries(query.select).filter(([, selected]) => selected === true).map(([key]) => [key, row[key]])))
  }
  const publicPrisma = { entity: { async findMany(q: { where: Row; select: Row }) { return read(db.state().entity, q) }, async findFirst(q: { where: Row; select: Row }) { return read(db.state().entity, q)[0] ?? null } },
    relation: { async findMany(q: { where: Row; select: Row }) { return read(db.state().relation, q) } } } as unknown as PrismaClient
  const server = createApp(createPrismaStore(publicPrisma), {
    auth: { config, store: { async findSession(hash) { const discordId = hash === sessionHash('a'.repeat(43)) ? actor.discordId : hash === sessionHash('b'.repeat(43)) ? '333333333333333333' : null
      return discordId ? { discordId, username: actor.label, displayName: null, expiresAt: new Date(Date.now() + 60_000) } : null }, async rotateSession() {}, async revokeSession() {} },
      discord: { authorizationUrl: () => '', async exchangeCode() { throw new Error('unused') } } },
    admin: { async listEntities() { return { items: [], total: 0, page: 1, pageSize: 50 } }, async getEntity() { return null }, async getStats() { return { byStatus: { DRAFT: 0, PROPOSED: 0, PUBLISHED: 0, ARCHIVED: 0 }, byVisibility: { PUBLIC: 0, PLAYERS: 0, GM: 0, SECRET: 0 }, sources: 0, relations: 0 } } },
    editorial: { async patch() { throw new Error('unused') }, async publish() { throw new Error('unused') }, async unpublish() { throw new Error('unused') } }, ingestion: createPrismaIngestionAdminStore(db.prisma),
  }, createPrismaGraphStore(publicPrisma)).listen(0)
  await once(server, 'listening'); const address = server.address(); assert.ok(address && typeof address !== 'string')
  try { await work(`http://127.0.0.1:${address.port}`, { Cookie: `hesta_codex_session=${'a'.repeat(43)}`, Origin: config.origin, 'Content-Type': 'application/json' }, db) }
  finally { await new Promise<void>(resolve => server.close(() => resolve())) }
}
test('HTTP update protection enforces session, whitelist, exact write Origin and no-store before transaction', async () => api(async (base, headers, db) => {
  const path = `${base}/api/admin/ingestion/items/${itemId}/update-proposal`
  for (const method of ['GET', 'POST']) for (const [badHeaders, status] of [[{}, 401], [{ Cookie: `hesta_codex_session=${'b'.repeat(43)}` }, 403]] as const) {
    const response = await fetch(path, { method, headers: badHeaders }); assert.equal(response.status, status); assert.equal(response.headers.get('cache-control'), 'no-store')
  }
  const { Origin: _origin, ...withoutOrigin } = headers; void _origin
  for (const h of [withoutOrigin, { ...headers, Origin: 'https://example.invalid' }]) {
    const response = await fetch(path, { method: 'POST', headers: h, body: JSON.stringify(body()) }); assert.equal(response.status, 403); assert.equal(response.headers.get('cache-control'), 'no-store')
  }
  assert.deepEqual(db.levels, [])
}))
test('HTTP strict context, malformed and oversized input reject before writes without echoing private keys', async () => api(async (base, headers, db) => {
  const path = `${base}/api/admin/ingestion/items/${itemId}/update-proposal`
  for (const suffix of ['', '?receiptId=bad', `?receiptId=${receiptId}&private=secret`]) {
    const response = await fetch(path + suffix, { headers }); assert.equal(response.status, 400); assert.equal(response.headers.get('cache-control'), 'no-store')
  }
  const oversized = JSON.stringify({ ...body(), entity: { ...body().entity, bodyMarkdown: '\u0001'.repeat(100_000) }, evidence: { ...body().evidence, sourceExcerpt: '\u0001'.repeat(100_000) } })
  for (const [payload, status] of [['{', 400], [oversized, 413], [JSON.stringify({ ...body(), PRIVATE_FIXTURE_KEY: 'Private fixture value' }), 400]] as const) {
    const response = await fetch(path, { method: 'POST', headers, body: payload }); assert.equal(response.status, status); assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.doesNotMatch(await response.text(), /PRIVATE_FIXTURE_KEY|Private fixture value/)
  }
  assert.deepEqual(db.levels, []); assert.deepEqual(db.operations, [])
}))
test('HTTP update uses server actor, remains PROPOSED even if PUBLIC and exposes no staging/provenance through public APIs', async () => api(async (base, headers, db) => {
  const path = `${base}/api/admin/ingestion/items/${itemId}/update-proposal`
  assert.deepEqual(await (await fetch(base + '/api/v1/entities')).json(), [])
  assert.deepEqual(await (await fetch(base + '/api/v1/graph')).json(), { nodes: [], edges: [] })
  assert.equal((await fetch(base + '/api/v1/entities/fiche-technique')).status, 404)
  const get = await fetch(`${path}?receiptId=${receiptId}`, { headers }); assert.equal(get.status, 200); assert.equal(get.headers.get('cache-control'), 'no-store')
  const post = await fetch(path, { method: 'POST', headers, body: JSON.stringify({ ...body(), entity: { ...body().entity, visibility: 'PUBLIC' } }) })
  assert.equal(post.status, 200); assert.equal(post.headers.get('cache-control'), 'no-store'); assert.equal((await post.json()).entity.status, 'PROPOSED')
  assert.equal(db.state().revision[1]!.editorLabel, actor.label); assert.equal(db.state().evidence[1]!.visibility, 'SECRET')
  assert.equal((await fetch(path, { method: 'POST', headers, body: JSON.stringify(body()) })).status, 409)
  assert.deepEqual(await (await fetch(base + '/api/v1/entities')).json(), []); assert.deepEqual(await (await fetch(base + '/api/v1/graph')).json(), { nodes: [], edges: [] })
  assert.equal((await fetch(base + '/api/v1/entities/fiche-technique')).status, 404); assert.equal((await fetch(path.replace('/api/admin/', '/api/v1/'))).status, 404)
}))
test('HTTP refusal of a PUBLISHED target leaves every public projection and all private records unchanged', async () => api(async (base, headers, db) => {
  db.change(state => { Object.assign(state.entity[0]!, { status: 'PUBLISHED', visibility: 'PUBLIC', publishedAt: now }) })
  const paths = ['/api/v1/entities', '/api/v1/entities/fiche-technique', '/api/v1/graph']
  const before = db.state(), publicBefore = await Promise.all(paths.map(async path => {
    const response = await fetch(base + path); assert.equal(response.status, 200); return response.json()
  }))
  const response = await fetch(`${base}/api/admin/ingestion/items/${itemId}/update-proposal`, { method: 'POST', headers, body: JSON.stringify(body()) })
  assert.equal(response.status, 409); assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(db.state(), before); assert.deepEqual(db.operations, [])
  assert.deepEqual(await Promise.all(paths.map(async path => (await fetch(base + path)).json())), publicBefore)
}))
test('HTTP missing/unchanged/stale requests retain safe business statuses and no-store', async () => api(async (base, headers) => {
  const path = `${base}/api/admin/ingestion/items/${itemId}/update-proposal`
  for (const [input, status, code] of [[{ ...body(), receiptId: uuid(99) }, 404, 'INGESTION_ITEM_NOT_FOUND'], [{ ...body(), entity: fields }, 422, 'NO_CHANGES'],
    [{ ...body(), expectedAssociationRevision: 6 }, 409, 'ASSOCIATION_MODIFIED']] as const) {
    const response = await fetch(path, { method: 'POST', headers, body: JSON.stringify(input) }); assert.equal(response.status, status); assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal((await response.json()).error.code, code)
  }
}))
test('HTTP unexpected SQL failure returns generic 500 and a constant log with full rollback', async context => api(async (base, headers, db) => {
  const logs: unknown[][] = []; context.mock.method(console, 'error', (...values: unknown[]) => { logs.push(values) })
  const before = db.state(); db.fail('revision')
  const response = await fetch(`${base}/api/admin/ingestion/items/${itemId}/update-proposal`, { method: 'POST', headers, body: JSON.stringify(body()) })
  assert.equal(response.status, 500); assert.equal(response.headers.get('cache-control'), 'no-store'); assert.doesNotMatch(await response.text(), /Private|SQL|receiptId|sourceId|fictif/)
  assert.deepEqual(db.state(), before); assert.deepEqual(logs, [['Hesta Codex API request failed']])
}))
