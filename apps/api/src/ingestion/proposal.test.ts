import assert from 'node:assert/strict'
import { once } from 'node:events'
import { test } from 'node:test'
import { Prisma, type PrismaClient } from '../prisma-client/client.ts'
import { EditorialError } from '../admin/editorial.js'
import { createPrismaIngestionAdminStore } from './admin.js'
import { createPrismaIngestionProposalService } from './proposal.js'
import { createPrismaIngestionAssociationService } from './association.js'
import { ingestionProposalSchema } from './proposal-validation.js'
import { itemIdentity } from './format.js'
import { createApp } from '../app.js'
import { readAuthConfig } from '../auth/config.js'
import { sessionHash } from '../auth/session.js'
import { createPrismaStore } from '../store.js'
import { createPrismaGraphStore } from '../graph.js'
import { entitySnapshot } from '../admin/editorial.js'

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const itemId = uuid(1), receiptId = uuid(2), sourceId = uuid(3), existingId = uuid(4)
const actor = { discordId: '222222222222222222', label: 'Admin technique' }
const now = new Date('2026-10-06T10:00:00Z')
const body = (slug = 'fiche-technique') => ({ receiptId, expectedRevision: 0,
  entity: { slug, title: 'Fiche technique', kind: 'PLACE', placeKind: 'CITY', summary: null, bodyMarkdown: 'Épreuve fictive', aliases: [], tags: [], visibility: 'GM' },
  evidence: { claimText: 'Énoncé humain fictif', sourceExcerpt: 'Extrait fictif', locator: 'fixture.md' } })
type Row = Record<string, unknown>
type State = { source: Row[]; entity: Row[]; relation: Row[]; evidence: Row[]; revision: Row[]; batch: Row[]; item: Row[]; receipt: Row[]; root: Row[]; decision: Row[] }
function database() {
  let state: State = { source: [{ id: sourceId, kind: 'OBSIDIAN', label: 'Source fictive', visibility: 'SECRET', updatedAt: now }],
    entity: [{ id: existingId, slug: 'existante', title: 'Existante privée', kind: 'OTHER', placeKind: null,
      summary: null, bodyMarkdown: 'Contenu préexistant fictif', aliases: [], tags: [], status: 'DRAFT', visibility: 'SECRET', publishedAt: null, updatedAt: now }],
    relation: [{ id: uuid(5), status: 'DRAFT', visibility: 'SECRET', updatedAt: now }], evidence: [], revision: [], batch: [{ id: uuid(6), label: 'Lot fictif' }],
    item: [{ id: itemId, sourceId, externalId: 'fixture.md', identityKey: itemIdentity('fixture.md', 'a'.repeat(64)), contentHash: 'a'.repeat(64), content: 'Texte fictif', version: 1 }],
    receipt: [{ id: receiptId, itemId, title: 'Station Épreuve', contentType: 'text/markdown', metadata: { tags: ['fictif', 'épreuve'] }, rawVariant: null,
      locator: 'fixture.md', observedAt: now, ingestedAt: now }], root: [], decision: [] }
  let nextId = 100, epoch = 0, failure: string | null = null, failureError: Error | null = null
  const operations: string[] = [], levels: string[] = []
  const fault = (stage: string) => { if (failure === stage) throw failureError ?? new Error('Fictitious private failure') }
  const unique = () => new Prisma.PrismaClientKnownRequestError('Fictitious unique constraint', { code: 'P2002', clientVersion: 'test' })
  const prisma = new Proxy({ async $transaction<T>(work: (tx: unknown) => Promise<T>, options: { isolationLevel: string }) {
    levels.push(options.isolationLevel)
    const start = epoch, pending = structuredClone(state)
    let dirty = false
    const write = (stage: string) => { operations.push(stage); dirty = true; fault(stage) }
    const selectedDecision = (row: Row) => ({ ...row, entity: pending.entity.find(entity => entity.id === row.entityId) })
    const tx = {
      source: { async findUnique(query: { where: { id: string } }) { return pending.source.find(row => row.id === query.where.id) ?? null } },
      entity: {
        async findUnique(query: { where: { slug?: string; id?: string } }) { return pending.entity.find(row => query.where.slug ? row.slug === query.where.slug : row.id === query.where.id) ?? null },
        async create(query: { data: Row }) {
          write('entity'); if (pending.entity.some(row => row.slug === query.data.slug)) throw unique()
          const row = { ...query.data, id: uuid(nextId++), metadata: null, createdAt: now, updatedAt: now }; pending.entity.push(row); return row
        },
      },
      ingestionReceipt: { async findFirst(query: { where: { itemId: string; id?: string } }) {
        const row = pending.receipt.find(row => row.itemId === query.where.itemId && (!query.where.id || row.id === query.where.id))
        return row ? { ...row, item: pending.item.find(item => item.id === row.itemId) } : null
      } },
      ingestionAssociation: {
        async findUnique(query: { where: { sourceId_identityKey: { sourceId: string; identityKey: string } } }) {
          const key = query.where.sourceId_identityKey; return pending.root.find(row => row.sourceId === key.sourceId && row.identityKey === key.identityKey) ?? null
        },
        async create(query: { data: Row }) {
          write('root'); if (pending.root.some(row => row.sourceId === query.data.sourceId && row.identityKey === query.data.identityKey)) throw unique()
          const row = { ...query.data, id: uuid(nextId++) }; pending.root.push(row); return row
        },
        async updateMany(query: { where: { id: string; revision: number } }) {
          const row = pending.root.find(row => row.id === query.where.id && row.revision === query.where.revision)
          if (!row) return { count: 0 }
          write('root'); row.revision = Number(row.revision) + 1; return { count: 1 }
        },
      },
      ingestionAssociationDecision: {
        async findFirst(query: { where: { associationId: string; decision: string } }) {
          const row = pending.decision.find(row => row.associationId === query.where.associationId && row.decision === query.where.decision)
          return row ? selectedDecision(row) : null
        },
        async findUnique(query: { where: { associationId_entityId: { associationId: string; entityId: string } } }) {
          const key = query.where.associationId_entityId; return pending.decision.find(row => row.associationId === key.associationId && row.entityId === key.entityId) ?? null
        },
        async findMany(query: { where: { associationId: string; decision: string; entityId?: { in: string[] } }; take: number }) {
          return pending.decision.filter(row => row.associationId === query.where.associationId && row.decision === query.where.decision &&
            (!query.where.entityId || query.where.entityId.in.includes(String(row.entityId)))).slice(0, query.take).map(selectedDecision)
        },
        async count(query: { where: { associationId: string; decision: string } }) { return pending.decision.filter(row => row.associationId === query.where.associationId && row.decision === query.where.decision).length },
        async deleteMany(query: { where: { associationId: string; decision: string } }) {
          write('decision'); pending.decision = pending.decision.filter(row => row.associationId !== query.where.associationId || row.decision !== query.where.decision); return { count: 0 }
        },
        async create(query: { data: Row }) {
          write('decision')
          if (pending.decision.some(row => row.associationId === query.data.associationId && (row.entityId === query.data.entityId || row.decision === 'CONFIRMED' && query.data.decision === 'CONFIRMED'))) throw unique()
          const row = { ...query.data, id: uuid(nextId++) }; pending.decision.push(row); return row
        },
        async upsert(query: { create: Row; update: Row }) {
          write('decision'); const row = pending.decision.find(row => row.associationId === query.create.associationId && row.entityId === query.create.entityId)
          if (row) Object.assign(row, query.update); else pending.decision.push({ ...query.create, id: uuid(nextId++) })
        },
      },
      evidence: { async create(query: { data: Row }) { write('evidence'); const row = { ...query.data, id: uuid(nextId++), createdAt: now, updatedAt: now }; pending.evidence.push(row); return row } },
      revision: { async create(query: { data: Row }) { write('revision'); const row = { ...query.data, id: uuid(nextId++), createdAt: now }; pending.revision.push(row); return row } },
    }
    const result = await work(new Proxy(tx, { get(target, key, receiver) { assert.ok(Reflect.has(target, key), `Forbidden transaction model ${String(key)}`); return Reflect.get(target, key, receiver) } }))
    if (dirty) {
      if (epoch !== start) throw new Prisma.PrismaClientKnownRequestError('Fictitious serialization conflict', { code: 'P2034', clientVersion: 'test' })
      fault('commit'); state = pending; epoch++
    }
    return result
  } }, { get(target, key, receiver) { assert.equal(key, '$transaction', 'No access outside the transaction'); return Reflect.get(target, key, receiver) } }) as unknown as PrismaClient
  return { prisma, service: createPrismaIngestionProposalService(prisma), associations: createPrismaIngestionAssociationService(prisma),
    operations, levels, state: () => structuredClone(state), change: (work: (state: State) => void) => { work(state); epoch++ },
    fail: (stage: string, error: Error | null = null) => { failure = stage; failureError = error } }
}
const expectBusiness = (code: string) => (error: unknown) => error instanceof EditorialError && error.code === code

test('proposal preparation is read-only, conservative about metadata/formats and never truncates long editorial content', async () => {
  const db = database(), before = db.state()
  const prepared = await db.service.prepare(itemId, receiptId)
  assert.equal(prepared.title, 'Station Épreuve'); assert.equal(prepared.bodyMarkdown, 'Texte fictif'); assert.deepEqual(prepared.tags, ['fictif', 'épreuve'])
  assert.equal(prepared.expectedRevision, 0); assert.deepEqual(db.state(), before); assert.deepEqual(db.operations, [])
  db.change(state => { state.receipt[0]!.title = 'x'.repeat(201); state.receipt[0]!.locator = 'x'.repeat(251); state.item[0]!.content = 'x'.repeat(100_001) })
  const long = await db.service.prepare(itemId, receiptId)
  assert.equal(long.title.length, 201); assert.equal(long.bodyMarkdown.length, 100_001); assert.equal(long.locator, null); assert.equal(long.sourceExcerpt, '')
  assert.equal(long.warnings.length, 3)
  db.change(state => { state.receipt[0]!.contentType = 'application/json'; state.receipt[0]!.metadata = { tags: ['duplicate', 'DUPLICATE'] } })
  const unsupported = await db.service.prepare(itemId, receiptId)
  assert.equal(unsupported.bodyMarkdown, ''); assert.deepEqual(unsupported.tags, [])
})
test('shared receipt helpers preserve the complete v0.7d preparation contract and legacy Evidence trimming', async () => {
  const formatWarning = 'Ce format n’est pas repris automatiquement : le contenu éditorial reste vide. Saisissez-le manuellement.'
  const cases = [
    { receipt: { title: null, contentType: 'TEXT/PLAIN', rawVariant: ' épreuve œ\r\n ', locator: ' repère ', metadata: { tags: [' épreuve ', 'test, intact'], ignored: 'fictif' } },
      expected: { title: '', bodyMarkdown: ' épreuve œ\r\n ', sourceExcerpt: ' épreuve œ\r\n ', locator: ' repère ', tags: ['épreuve', 'test, intact'], warnings: [] } },
    { receipt: { contentType: 'application/json', metadata: null }, expected: { title: 'Station Épreuve', bodyMarkdown: '', sourceExcerpt: '', locator: 'fixture.md', tags: [], warnings: [formatWarning] } },
    { receipt: { title: 'x'.repeat(201), locator: 'x'.repeat(251), rawVariant: 'œ'.repeat(100_001), metadata: { tags: ['a', 'A'] } },
      expected: { title: 'x'.repeat(201), bodyMarkdown: 'œ'.repeat(100_001), sourceExcerpt: '', locator: null, tags: [], warnings: [
        'Les tags de metadata sont invalides et n’ont pas été repris.', 'Le titre dépasse 200 caractères : corrigez-le avant création.',
        'Le contenu dépasse 100 000 caractères : adaptez-le sans modifier le staging.', 'Le repère dépasse 250 caractères : choisissez un repère court. Le repère original reste dans la Revision.' ] } },
    { receipt: { rawVariant: '', metadata: {} }, expected: { title: 'Station Épreuve', bodyMarkdown: '', sourceExcerpt: '', locator: 'fixture.md', tags: [], warnings: [] } },
  ]
  for (const fixture of cases) {
    const db = database(); db.change(state => { Object.assign(state.receipt[0]!, fixture.receipt) }); const before = db.state()
    assert.deepEqual(await db.service.prepare(itemId, receiptId), { receiptId, expectedRevision: 0,
      source: { label: 'Source fictive', kind: 'OBSIDIAN', visibility: 'SECRET' }, ...fixture.expected })
    assert.deepEqual(db.state(), before); assert.deepEqual(db.operations, [])
  }
  const legacy = ingestionProposalSchema.parse({ ...body(), evidence: { claimText: ' énoncé ', sourceExcerpt: ' extrait\r\n ', locator: ' repère ' } })
  assert.deepEqual(legacy.evidence, { claimText: 'énoncé', sourceExcerpt: 'extrait', locator: 'repère' })
})
test('explicit proposal atomically creates PROPOSED Entity/Evidence/Revision/CONFIRMED using the existing Source and session actor', async () => {
  const db = database(), before = db.state()
  const created = await db.service.create(itemId, ingestionProposalSchema.parse(body()), actor), state = db.state()
  assert.equal(created.entity.status, 'PROPOSED'); assert.equal(created.entity.visibility, 'GM'); assert.equal(state.entity[1]?.publishedAt, null)
  assert.deepEqual(state.source, before.source); assert.deepEqual(state.entity[0], before.entity[0]); assert.deepEqual(state.relation, before.relation)
  for (const key of ['item', 'receipt', 'batch'] as const) assert.deepEqual(state[key], before[key])
  assert.equal(state.evidence[0]?.sourceId, sourceId); assert.equal(state.evidence[0]?.entityId, created.entity.id); assert.equal(state.evidence[0]?.visibility, 'SECRET')
  assert.equal(state.revision[0]?.number, 1); assert.equal(state.revision[0]?.editorLabel, actor.label); assert.equal(state.revision[0]?.message, 'Création depuis l’ingestion')
  const snapshot = state.revision[0]!.snapshot as { version: number; entity: Row; ingestion: Row }
  assert.equal(snapshot.version, 1); assert.equal(snapshot.entity.publishedAt, null); assert.equal(snapshot.entity.status, 'PROPOSED')
  const manualSnapshot = entitySnapshot(state.entity[1] as unknown as Parameters<typeof entitySnapshot>[0]) as { version: number; entity: Row }
  assert.deepEqual({ version: snapshot.version, entity: snapshot.entity }, manualSnapshot)
  assert.doesNotMatch(JSON.stringify(snapshot.entity), /sourceId|receiptId|contentHash|locator|observedAt|metadata/)
  assert.equal(snapshot.ingestion.itemId, itemId); assert.equal(snapshot.ingestion.receiptId, receiptId); assert.equal(snapshot.ingestion.evidenceId, state.evidence[0]?.id)
  assert.equal(snapshot.ingestion.observedAt, now.toISOString())
  assert.equal(Object.hasOwn(snapshot.ingestion, 'action'), false)
  assert.equal(state.decision[0]?.entityId, created.entity.id); assert.equal(state.decision[0]?.decision, 'CONFIRMED'); assert.equal(state.decision[0]?.origin, 'MANUAL')
  assert.equal(state.decision[0]?.authorDiscordId, actor.discordId); assert.deepEqual(db.levels, ['Serializable'])
  assert.doesNotMatch(JSON.stringify(created), /sourceId|receiptId|bodyMarkdown|contentHash|metadata|authorDiscordId/)
})
for (const stage of ['root', 'entity', 'evidence', 'revision', 'decision', 'commit']) test(`proposal failure at ${stage} rolls back all writes, including the association revision`, async () => {
  const db = database(), before = db.state(); db.fail(stage)
  await assert.rejects(db.service.create(itemId, ingestionProposalSchema.parse(body()), actor))
  assert.deepEqual(db.state(), before)
})
for (const [stage, prismaCode, businessCode] of [
  ['root', 'P2002', 'STALE_INGESTION_STATE'], ['entity', 'P2002', 'ENTITY_CONFLICT'],
  ['decision', 'P2002', 'STALE_INGESTION_STATE'], ['commit', 'P2034', 'STALE_INGESTION_STATE'],
  ['evidence', 'P2003', 'SOURCE_NOT_FOUND'],
] as const) test(`${prismaCode} at ${stage} returns ${businessCode}, rolls back and never retries creation`, async () => {
  const db = database(), before = db.state()
  db.fail(stage, new Prisma.PrismaClientKnownRequestError('Fictitious driver error', { code: prismaCode, clientVersion: 'test' }))
  await assert.rejects(db.service.create(itemId, ingestionProposalSchema.parse(body()), actor), expectBusiness(businessCode))
  assert.deepEqual(db.state(), before); assert.deepEqual(db.levels, ['Serializable'])
})

test('a form opened before a rejection, confirmation withdrawal or replacement cannot overwrite the later decision', async () => {
  for (const action of ['reject', 'withdraw', 'replace']) {
    const db = database(), prepared = await db.service.prepare(itemId, receiptId)
    if (action === 'reject') await db.associations.reject(itemId, { receiptId, expectedRevision: 0, entityId: existingId, origin: 'MATCH' }, actor)
    else {
      await db.associations.confirm(itemId, { receiptId, expectedRevision: 0, entityId: existingId, origin: 'MANUAL' }, actor)
      if (action === 'withdraw') await db.associations.reset(itemId, { receiptId, expectedRevision: 1 })
      else {
        db.change(state => { state.entity.push({ ...state.entity[0], id: uuid(9), slug: 'remplacement' }) })
        await db.associations.confirm(itemId, { receiptId, expectedRevision: 1, entityId: uuid(9), origin: 'MANUAL' }, actor)
      }
    }
    const before = db.state()
    await assert.rejects(db.service.create(itemId, { ...ingestionProposalSchema.parse(body()), expectedRevision: prepared.expectedRevision }, actor),
      expectBusiness(action === 'replace' ? 'ASSOCIATION_CONFLICT' : 'STALE_INGESTION_STATE'))
    assert.deepEqual(db.state(), before)
  }
})

test('Source/item removal after preparation is revalidated on submission without a partial creation', async () => {
  for (const missing of ['source', 'item']) {
    const db = database(), prepared = await db.service.prepare(itemId, receiptId)
    db.change(state => { if (missing === 'source') state.source = []; else { state.item = []; state.receipt = [] } })
    const before = db.state()
    await assert.rejects(db.service.create(itemId, { ...ingestionProposalSchema.parse(body()), expectedRevision: prepared.expectedRevision }, actor),
      expectBusiness(missing === 'source' ? 'SOURCE_NOT_FOUND' : 'INGESTION_ITEM_NOT_FOUND'))
    assert.deepEqual(db.state(), before)
  }
})

test('a new immutable version during preparation preserves the pinned origin and inherits the subsequent human creation', async () => {
  const db = database(), prepared = await db.service.prepare(itemId, receiptId)
  db.change(state => {
    state.item.push({ ...state.item[0], id: uuid(20), version: 2, contentHash: 'b'.repeat(64), content: 'Nouvelle version fictive' })
    state.receipt.push({ ...state.receipt[0], id: uuid(21), itemId: uuid(20), ingestedAt: new Date(now.getTime() + 1000) })
  })
  const before = db.state()
  const result = await db.service.create(itemId, { ...ingestionProposalSchema.parse(body()), expectedRevision: prepared.expectedRevision }, actor)
  const created = db.state(), snapshot = created.revision[0]!.snapshot as { ingestion: Row }
  assert.equal(snapshot.ingestion.itemId, itemId); assert.equal(snapshot.ingestion.receiptId, receiptId)
  assert.equal(snapshot.ingestion.contentHash, 'a'.repeat(64)); assert.equal(snapshot.ingestion.version, 1)
  assert.deepEqual(created.item, before.item); assert.deepEqual(created.receipt, before.receipt)
  assert.equal((await db.associations.read(uuid(20), uuid(21))).confirmed?.entity.id, result.entity.id)
  await assert.rejects(db.service.create(uuid(20), { ...ingestionProposalSchema.parse(body('autre-slug')), receiptId: uuid(21) }, actor), expectBusiness('ASSOCIATION_CONFLICT'))
  assert.deepEqual(db.state(), created)
})

test('confirmation on a new version while an older form is open blocks that form through the shared identity', async () => {
  const db = database(), prepared = await db.service.prepare(itemId, receiptId)
  db.change(state => {
    state.item.push({ ...state.item[0], id: uuid(20), version: 2, contentHash: 'b'.repeat(64) })
    state.receipt.push({ ...state.receipt[0], id: uuid(21), itemId: uuid(20) })
  })
  await db.associations.confirm(uuid(20), { receiptId: uuid(21), expectedRevision: 0, entityId: existingId, origin: 'MANUAL' }, actor)
  const before = db.state()
  await assert.rejects(db.service.create(itemId, { ...ingestionProposalSchema.parse(body()), expectedRevision: prepared.expectedRevision }, actor), expectBusiness('ASSOCIATION_CONFLICT'))
  assert.deepEqual(db.state(), before)
})

test('Evidence visibility uses current Source restrictions and absent provenance fields are never invented', async () => {
  for (const [sourceVisibility, entityVisibility, evidenceVisibility] of [['PUBLIC', 'GM', 'GM'], ['GM', 'PUBLIC', 'GM'], ['PLAYERS', 'SECRET', 'SECRET']] as const) {
    const db = database(); await db.service.prepare(itemId, receiptId)
    db.change(state => { state.source[0]!.visibility = sourceVisibility; state.receipt[0]!.observedAt = null; state.receipt[0]!.locator = null })
    const input = ingestionProposalSchema.parse({ ...body(), entity: { ...body().entity, visibility: entityVisibility },
      evidence: { claimText: 'Énoncé humain fictif', sourceExcerpt: null, locator: null } })
    const before = db.state(); await db.service.create(itemId, input, actor)
    const state = db.state(), evidence = state.evidence[0]!, snapshot = state.revision[0]!.snapshot as { ingestion: Row }
    assert.equal(evidence.visibility, evidenceVisibility); assert.equal(evidence.sourceId, sourceId); assert.equal(evidence.relationId, null)
    for (const field of ['sourceExcerpt', 'locator', 'confidence', 'timeStartSeconds', 'timeEndSeconds']) assert.equal(evidence[field], null)
    assert.equal(snapshot.ingestion.observedAt, null); assert.equal(snapshot.ingestion.locator, null)
    assert.equal(snapshot.ingestion.ingestedAt, now.toISOString()); assert.deepEqual(state.source, before.source)
  }
})
test('slug conflict, stale revision and an already confirmed identity refuse creation without editorial writes', async () => {
  const db = database(), before = db.state()
  await assert.rejects(db.service.create(itemId, ingestionProposalSchema.parse(body('existante')), actor), expectBusiness('ENTITY_CONFLICT'))
  await assert.rejects(db.service.create(itemId, { ...ingestionProposalSchema.parse(body()), expectedRevision: 1 }, actor), expectBusiness('STALE_INGESTION_STATE'))
  assert.deepEqual(db.state(), before)
  await db.associations.confirm(itemId, { receiptId, expectedRevision: 0, entityId: existingId, origin: 'MANUAL' }, actor)
  const associated = db.state()
  await assert.rejects(db.service.prepare(itemId, receiptId), expectBusiness('ASSOCIATION_CONFLICT'))
  await assert.rejects(db.service.create(itemId, ingestionProposalSchema.parse(body()), actor), expectBusiness('ASSOCIATION_CONFLICT'))
  assert.deepEqual(db.state(), associated)
})
test('absent item, wrong receipt and absent Source refuse creation with explicit 404s and no partial writes', async () => {
  const db = database()
  await assert.rejects(db.service.create(uuid(90), ingestionProposalSchema.parse(body()), actor), expectBusiness('INGESTION_ITEM_NOT_FOUND'))
  await assert.rejects(db.service.create(itemId, { ...ingestionProposalSchema.parse(body()), receiptId: uuid(90) }, actor), expectBusiness('INGESTION_ITEM_NOT_FOUND'))
  db.change(state => { state.source = [] }); const before = db.state()
  await assert.rejects(db.service.create(itemId, ingestionProposalSchema.parse(body()), actor), expectBusiness('SOURCE_NOT_FOUND'))
  assert.deepEqual(db.state(), before)
})
test('existing rejection history survives creation and a failed proposal preserves the previously allocated revision', async () => {
  const db = database()
  await db.associations.reject(itemId, { receiptId, expectedRevision: 0, entityId: existingId, origin: 'MATCH' }, actor)
  const before = db.state(), rejected = before.decision[0]
  const input = { ...ingestionProposalSchema.parse(body()), expectedRevision: 1 }
  db.fail('revision'); await assert.rejects(db.service.create(itemId, input, actor)); assert.deepEqual(db.state(), before)
  db.fail('none'); await db.service.create(itemId, input, actor)
  assert.equal(db.state().root[0]?.revision, 2); assert.deepEqual(db.state().decision.find(row => row.decision === 'REJECTED'), rejected)
  assert.equal(db.state().decision.filter(row => row.decision === 'CONFIRMED').length, 1)
})
test('simultaneous different/same-slug proposals and competing v0.7c confirmation cannot leave orphan editorial records', async () => {
  for (const mode of ['same', 'different', 'association']) {
    const db = database()
    const results = await Promise.allSettled([db.service.create(itemId, ingestionProposalSchema.parse(body()), actor), mode === 'association' ?
      db.associations.confirm(itemId, { receiptId, expectedRevision: 0, entityId: existingId, origin: 'MANUAL' }, actor) :
      db.service.create(itemId, ingestionProposalSchema.parse(body(mode === 'same' ? 'fiche-technique' : 'autre-fiche')), { discordId: '444444444444444444', label: 'Second admin fictif' })])
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
    const failed = results.find(result => result.status === 'rejected'); assert.ok(failed?.status === 'rejected' && failed.reason instanceof EditorialError && failed.reason.status === 409)
    const state = db.state(); assert.equal(state.decision.filter(row => row.decision === 'CONFIRMED').length, 1)
    assert.equal(state.entity.length - 1, state.evidence.length); assert.equal(state.evidence.length, state.revision.length)
    assert.equal(state.root[0]?.revision, 1)
  }
})

test('two different staging identities competing for the same slug produce at most one complete editorial creation', async () => {
  const db = database()
  db.change(state => {
    state.item.push({ ...state.item[0], id: uuid(20), externalId: 'autre.md', identityKey: itemIdentity('autre.md', 'a'.repeat(64)) })
    state.receipt.push({ ...state.receipt[0], id: uuid(21), itemId: uuid(20) })
  })
  const results = await Promise.allSettled([db.service.create(itemId, ingestionProposalSchema.parse(body()), actor),
    db.service.create(uuid(20), { ...ingestionProposalSchema.parse(body()), receiptId: uuid(21) }, actor)])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  const failure = results.find(result => result.status === 'rejected')
  assert.ok(failure?.status === 'rejected' && failure.reason instanceof EditorialError && failure.reason.status === 409)
  const state = db.state()
  assert.equal(state.entity.length, 2); assert.equal(state.evidence.length, 1); assert.equal(state.revision.length, 1)
  assert.equal(state.root.length, 1); assert.equal(state.decision.length, 1)
})
test('later versions inherit the proposal association without another Entity; different identities never inherit', async () => {
  const db = database(), created = await db.service.create(itemId, ingestionProposalSchema.parse(body()), actor)
  db.change(state => {
    state.item.push({ ...state.item[0], id: uuid(20), version: 2, contentHash: 'b'.repeat(64), content: 'Version suivante fictive' })
    state.receipt.push({ ...state.receipt[0], id: uuid(21), itemId: uuid(20) })
    state.item.push({ ...state.item[0], id: uuid(30), externalId: 'autre.md', identityKey: itemIdentity('autre.md', 'a'.repeat(64)) })
    state.receipt.push({ ...state.receipt[0], id: uuid(31), itemId: uuid(30) })
  })
  assert.equal((await db.associations.read(uuid(20), uuid(21))).confirmed?.entity.id, created.entity.id)
  const before = db.state()
  await assert.rejects(db.service.create(uuid(20), { ...ingestionProposalSchema.parse(body('version-2')), receiptId: uuid(21) }, actor), expectBusiness('ASSOCIATION_CONFLICT'))
  assert.equal((await db.associations.read(uuid(30), uuid(31))).confirmed, null); assert.deepEqual(db.state(), before)
})
test('proposal schema reuses editorial rules and refuses spoofed Source/status/publication/actor, malformed Unicode and invalid PLACE', () => {
  for (const change of [{ sourceId }, { editorLabel: 'spoof' }, { origin: 'MATCH' }, { expectedRevision: -1 }, { receiptId: 'bad' }]) assert.equal(ingestionProposalSchema.safeParse({ ...body(), ...change }).success, false)
  for (const change of [{ status: 'PUBLISHED' }, { publishedAt: now.toISOString() }, { metadata: {} }, { slug: 'Invalid Slug' }, { placeKind: null },
    { title: '\uD800bad' }, { bodyMarkdown: 'a\0b' }, { tags: ['x', 'X'] }, { title: '' }, { title: ' ' }, { title: 'x'.repeat(201) },
    { slug: '' }, { kind: 'UNKNOWN' }, { kind: 'PERSON', placeKind: 'CITY' }, { aliases: [''] }, { aliases: ['é', 'e\u0301'] },
    { aliases: ['x'.repeat(201)] }, { tags: ['x'.repeat(101)] }, { tags: Array.from({ length: 31 }, (_, index) => String(index)) },
    { bodyMarkdown: 'x'.repeat(100_001) }]) assert.equal(ingestionProposalSchema.safeParse({ ...body(), entity: { ...body().entity, ...change } }).success, false)
  const accepted = ingestionProposalSchema.parse({ ...body(), entity: { ...body().entity, title: 'Épreuve œ fictive',
    aliases: ['Alias épreuve'], tags: ['Unicode œ'], bodyMarkdown: 'œ'.repeat(100_000) } })
  assert.equal(accepted.entity.bodyMarkdown.length, 100_000); assert.equal(accepted.entity.slug, body().entity.slug)
  const { visibility: _visibility, ...entity } = body().entity
  void _visibility
  assert.equal(ingestionProposalSchema.parse({ ...body(), entity }).entity.visibility, 'GM')
})

async function api(work: (base: string, headers: Record<string, string>, db: ReturnType<typeof database>) => Promise<void>) {
  const db = database(), config = readAuthConfig({ DISCORD_CLIENT_ID: '111111111111111111', DISCORD_CLIENT_SECRET: 'fake',
    DISCORD_REDIRECT_URI: 'http://localhost:5173/api/auth/discord/callback', DISCORD_ADMIN_IDS: actor.discordId,
    SESSION_SECRET: 'test-secret-more-than-thirty-two-characters', SESSION_TTL_MS: '3600000' })
  // Run the real public projections against a separate read-only relational double.
  // The creation double still rejects every call outside its transaction.
  const publicRead = (rows: Row[], query: { where: Row; select: Row }) => {
    assert.equal(query.where.status, 'PUBLISHED'); assert.equal(query.where.visibility, 'PUBLIC')
    return rows.filter(row => row.status === query.where.status && row.visibility === query.where.visibility &&
      (!query.where.slug || row.slug === query.where.slug)).map(row => Object.fromEntries(Object.entries(query.select).filter(([, selected]) => selected === true).map(([key]) => [key, row[key]])))
  }
  const publicPrisma = { entity: {
    async findMany(query: { where: Row; select: Row }) { return publicRead(db.state().entity, query) },
    async findFirst(query: { where: Row; select: Row }) { return publicRead(db.state().entity, query)[0] ?? null },
  }, relation: { async findMany(query: { where: Row; select: Row }) { return publicRead(db.state().relation, query) } } } as unknown as PrismaClient
  const server = createApp(createPrismaStore(publicPrisma), {
    auth: { config, store: { async findSession(hash) {
      const discordId = hash === sessionHash('a'.repeat(43)) ? actor.discordId : hash === sessionHash('b'.repeat(43)) ? '333333333333333333' : null
      return discordId ? { discordId, username: actor.label, displayName: null, expiresAt: new Date(Date.now() + 60_000) } : null
    }, async rotateSession() {}, async revokeSession() {} }, discord: { authorizationUrl: () => '', async exchangeCode() { throw new Error('unused') } } },
    admin: { async listEntities() { return { items: [], total: 0, page: 1, pageSize: 50 } }, async getEntity() { return null },
      async getStats() { return { byStatus: { DRAFT: 0, PROPOSED: 0, PUBLISHED: 0, ARCHIVED: 0 }, byVisibility: { PUBLIC: 0, PLAYERS: 0, GM: 0, SECRET: 0 }, sources: 0, relations: 0 } } },
    editorial: { async patch() { throw new Error('unused') }, async publish() { throw new Error('unused') }, async unpublish() { throw new Error('unused') } },
    ingestion: createPrismaIngestionAdminStore(db.prisma),
  }, createPrismaGraphStore(publicPrisma)).listen(0)
  await once(server, 'listening'); const address = server.address(); assert.ok(address && typeof address !== 'string')
  try { await work(`http://127.0.0.1:${address.port}`, { Cookie: `hesta_codex_session=${'a'.repeat(43)}`, Origin: config.origin, 'Content-Type': 'application/json' }, db) }
  finally { await new Promise<void>(resolve => server.close(() => resolve())) }
}
test('every proposal endpoint requires session/whitelist, writes require exact Origin, and all responses are no-store', async () => api(async (base, headers, db) => {
  const path = `${base}/api/admin/ingestion/items/${itemId}/proposal`
  for (const method of ['GET', 'POST']) for (const [badHeaders, status] of [[{}, 401], [{ Cookie: `hesta_codex_session=${'b'.repeat(43)}` }, 403]] as const) {
    const response = await fetch(path, { method, headers: badHeaders }); assert.equal(response.status, status); assert.equal(response.headers.get('cache-control'), 'no-store')
  }
  const { Origin: _origin, ...withoutOrigin } = headers; void _origin
  for (const requestHeaders of [withoutOrigin, { ...headers, Origin: '' }, { ...headers, Origin: 'https://example.invalid' }]) {
    const response = await fetch(path, { method: 'POST', headers: requestHeaders, body: JSON.stringify(body()) })
    assert.equal(response.status, 403); assert.equal(response.headers.get('cache-control'), 'no-store')
  }
  assert.equal(db.levels.length, 0)
}))
test('HTTP proposal creates private PROPOSED data, refuses repeats/spoofing and introduces no public staging endpoint', async () => api(async (base, headers, db) => {
  const path = `${base}/api/admin/ingestion/items/${itemId}/proposal`
  const prepare = await fetch(path + '?receiptId=' + receiptId, { headers }); assert.equal(prepare.status, 200); assert.equal(prepare.headers.get('cache-control'), 'no-store')
  assert.equal(db.state().entity.length, 1)
  for (const value of [{ ...body(), authorDiscordId: '999' }, { ...body(), entity: { ...body().entity, status: 'PUBLISHED' } }]) {
    const bad = await fetch(path, { method: 'POST', headers, body: JSON.stringify(value) }); assert.equal(bad.status, 400); assert.equal(bad.headers.get('cache-control'), 'no-store')
  }
  const requested = { ...body(), entity: { ...body().entity, visibility: 'PUBLIC' } }
  const created = await fetch(path, { method: 'POST', headers, body: JSON.stringify(requested) }); assert.equal(created.status, 201); assert.equal(created.headers.get('cache-control'), 'no-store')
  const payload = await created.json(); assert.equal(payload.entity.status, 'PROPOSED'); assert.equal(db.state().revision[0]?.editorLabel, actor.label)
  assert.equal(payload.entity.visibility, 'PUBLIC'); assert.equal(db.state().entity[1]?.publishedAt, null); assert.equal(db.state().evidence[0]?.visibility, 'SECRET')
  assert.equal((await fetch(path, { method: 'POST', headers, body: JSON.stringify(body()) })).status, 409)
  const publicList = await fetch(base + '/api/v1/entities'); assert.deepEqual(await publicList.json(), [])
  const publicDetail = await fetch(base + '/api/v1/entities/' + payload.entity.slug); assert.equal(publicDetail.status, 404)
  const publicGraph = await fetch(base + '/api/v1/graph'); assert.deepEqual(await publicGraph.json(), { nodes: [], edges: [] })
  const publicProposal = await fetch(path.replace('/api/admin/', '/api/v1/')); assert.equal(publicProposal.status, 404)
}))

test('HTTP rejects malformed, oversized and private unknown-field payloads before any transaction', async () => api(async (base, headers, db) => {
  const path = `${base}/api/admin/ingestion/items/${itemId}/proposal`
  const oversized = JSON.stringify({ ...body(), entity: { ...body().entity, bodyMarkdown: '\u0001'.repeat(100_000) },
    evidence: { ...body().evidence, sourceExcerpt: '\u0001'.repeat(100_000) } })
  assert.ok(Buffer.byteLength(oversized) > 1_048_576)
  for (const [payload, status] of [['{', 400], [oversized, 413], [JSON.stringify({ ...body(), PRIVATE_FIXTURE_KEY: 'Private fixture value' }), 400]] as const) {
    const response = await fetch(path, { method: 'POST', headers, body: payload })
    assert.equal(response.status, status); assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.doesNotMatch(await response.text(), /PRIVATE_FIXTURE_KEY|Private fixture value/)
  }
  assert.deepEqual(db.levels, []); assert.deepEqual(db.operations, [])
}))
test('HTTP failure returns generic 500/no-store without leaking narrative, and transaction state is unchanged', async context => api(async (base, headers, db) => {
  const logs: unknown[][] = []; context.mock.method(console, 'error', (...values: unknown[]) => { logs.push(values) })
  const before = db.state(); db.fail('revision')
  const response = await fetch(`${base}/api/admin/ingestion/items/${itemId}/proposal`, { method: 'POST', headers, body: JSON.stringify(body()) })
  assert.equal(response.status, 500); assert.equal(response.headers.get('cache-control'), 'no-store'); assert.doesNotMatch(await response.text(), /private|fictive|sourceId|receiptId/)
  assert.deepEqual(db.state(), before); assert.deepEqual(logs, [['Hesta Codex API request failed']])
}))
