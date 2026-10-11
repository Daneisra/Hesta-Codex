import assert from 'node:assert/strict'
import { test } from 'node:test'
import { once } from 'node:events'
import type { QualificationRow } from '@hesta-codex/shared'
import type { PrismaClient } from './prisma-client/client.ts'
import { buildReferenceCatalog, type ReferenceEntity, type ReferenceOrigin } from './obsidian-references.js'
import { createPrismaQualificationService, qualificationPage, qualificationRows, type IgnoreDecision } from './reference-qualification.js'
import { createApp } from './app.js'
import { readAuthConfig } from './auth/config.js'
import { sessionHash, sessionCookieName } from './auth/session.js'
import { createPrismaAdminStore } from './admin/store.js'

const stamp = new Date('2026-10-11T00:00:00Z')
const uuid = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
const source = { id: uuid(10000), label: 'Coffre entièrement fictif' }
function fixture(size = 130, degree = 2) {
  const entities: ReferenceEntity[] = Array.from({ length: size }, (_, index) => ({ id: uuid(index), slug: `note-${index}`,
    title: `Note ${index}`, aliases: [`Alias ${index}`], kind: index % 2 ? 'PLACE' : 'PERSON', visibility: 'GM', status: 'PROPOSED', updatedAt: stamp,
    bodyMarkdown: Array.from({ length: degree + (size === 130 && index < 36 ? 1 : 0) }, (_, offset) =>
      `[[Dossier/Note ${(index + offset + 1) % size}|Alias]]`).join(' ') }))
  const origins: ReferenceOrigin[] = entities.map(entity => ({ entityId: entity.id, sourceId: source.id,
    path: `Dossier/${entity.title}.md`, metadata: {} }))
  return { entities, origins, catalog: buildReferenceCatalog(entities, origins) }
}
const relationType = { id: uuid(9000), code: 'located_in', label: 'situé dans', inverseCode: 'contains', inverseLabel: 'contient', symmetric: false }
function relation(from: string, to: string, symmetric = false): QualificationRow['relations'][number] {
  return { id: uuid(9999), fromEntityId: from, toEntityId: to, status: 'PROPOSED', visibility: 'GM', relationType: { ...relationType, symmetric } }
}
function decision(row: QualificationRow): IgnoreDecision {
  return { fromEntityId: row.from.id, toEntityId: row.to.id, fingerprint: row.fingerprint, revision: uuid(8888),
    authorLabel: 'Opérateur fictif', decidedAt: stamp }
}

test('130 synthetic entities produce exactly 296 directed rows and real global counts independently of filters', () => {
  const { catalog } = fixture(), rows = qualificationRows(catalog, [], [], [source])
  assert.equal(rows.length, 296); assert.equal(new Set(rows.map(row => row.id)).size, 296)
  const ignored = decision(rows[0]!), rel = relation(rows[1]!.to.id, rows[1]!.from.id)
  const classified = qualificationRows(catalog, [rel], [ignored], [source])
  const page = qualificationPage(catalog, classified, { page: 1, state: 'PENDING' }, [source])
  assert.deepEqual(page.counts, { PENDING: 294, QUALIFIED: 1, IGNORED: 1, total: 296 })
  assert.equal(page.items.length, 50); assert.equal(page.total, 294)
  assert.equal(qualificationPage(catalog, classified, { page: 9999 }, [source]).page, 6)
  assert.equal(page.items.every(row => !('bodyMarkdown' in row.from) && !('excerpt' in row)), true)
})

test('direction, Source, kinds, accent insensitive alias search and stable sorting use actual UUIDs', () => {
  const data = fixture(5), rows = qualificationRows(data.catalog, [], [], [source])
  const out = qualificationPage(data.catalog, rows, { page: 1, entityId: uuid(0), direction: 'outgoing' }, [source])
  assert.equal(out.total, 2); assert.ok(out.items.every(row => row.from.id === uuid(0)))
  const incoming = qualificationPage(data.catalog, rows, { page: 1, entityId: uuid(0), direction: 'incoming' }, [source])
  assert.equal(incoming.total, 2); assert.ok(incoming.items.every(row => row.to.id === uuid(0)))
  assert.equal(qualificationPage(data.catalog, rows, { page: 1, sourceId: uuid(555) }, [source]).total, 0)
  assert.equal(qualificationPage(data.catalog, rows, { page: 1, q: 'Álias 0', kind: 'PERSON' }, [source]).total, 4)
  const sorted = qualificationPage(data.catalog, rows, { page: 1, sort: 'name' }, [source]).items
  assert.deepEqual(qualificationPage(data.catalog, [...rows].reverse(), { page: 1, sort: 'name' }, [source]).items, sorted)
})

test('homonyms resolve exclusively by path; repeated occurrences and self-references are grouped separately', () => {
  const data = fixture(3)
  data.entities[0]!.bodyMarkdown = '[[A/Homonyme]] [[A/Homonyme|Alias]] [[B/Homonyme]] [[Homonyme]] [[Note 0#Section]] [[Vide]] [[Absent]]'
  data.entities[1]!.title = data.entities[2]!.title = 'Homonyme'
  data.origins[1]!.path = 'A/Homonyme.md'; data.origins[2]!.path = 'B/Homonyme.md'
  data.origins[0]!.metadata = { obsidian: { wikilinks: [{ status: 'FOUND', path: 'Vide.md' }] } }
  const catalog = buildReferenceCatalog(data.entities, data.origins), rows = qualificationRows(catalog, [], [], [source])
  assert.equal(rows.find(row => row.from.id === uuid(0) && row.to.id === uuid(1))!.occurrences, 2)
  assert.equal(rows.filter(row => row.from.id === uuid(0)).length, 3)
  const page = qualificationPage(catalog, rows, { page: 1, view: 'diagnostics', entityId: uuid(0) }, [source])
  assert.deepEqual(page.diagnostics.map(item => item.status), ['AMBIGUOUS', 'RESOLVED', 'UNASSOCIATED', 'MISSING'])
  assert.equal(page.items.length, 0)
})

test('qualified includes directed inverse, symmetric and archived relations; any relation takes precedence over ignorance', () => {
  const { catalog } = fixture(3), rows = qualificationRows(catalog, [], [], [source]), row = rows[0]!
  for (const symmetric of [false, true]) {
    const rel = { ...relation(row.to.id, row.from.id, symmetric), status: 'ARCHIVED' as const }
    const updated = qualificationRows(catalog, [rel], [decision(row)], [source])
    assert.equal(updated.find(item => item.id === row.id)!.state, 'QUALIFIED')
    assert.equal(updated.find(item => item.id === row.id)!.relations[0]!.status, 'ARCHIVED')
  }
})

test('ignorance survives sessions without altering automatic edges, invalidates on Markdown or identity changes', () => {
  const data = fixture(3), before = data.catalog.graph(), row = qualificationRows(data.catalog, [], [], [source])[0]!
  const ignored = decision(row)
  const reload = buildReferenceCatalog([...data.entities].reverse(), [...data.origins].reverse())
  assert.equal(qualificationRows(reload, [], [ignored], [source]).find(item => item.id === row.id)!.state, 'IGNORED')
  assert.deepEqual(reload.graph(), before)
  data.entities.find(entity => entity.id === row.from.id)!.bodyMarkdown += ' Modification fictive.'
  const edited = qualificationRows(buildReferenceCatalog(data.entities, data.origins), [], [ignored], [source]).find(item => item.id === row.id)!
  assert.equal(edited.state, 'PENDING'); assert.equal(edited.stale, true)
  assert.equal(edited.decisionRevision, ignored.revision)
  const renamed = fixture(3); renamed.origins.find(origin => origin.entityId === row.to.id)!.path = 'Renommage.md'
  assert.notEqual(buildReferenceCatalog(renamed.entities, renamed.origins).fingerprints.get(row.id), row.fingerprint)
})

test('larger synthetic catalogue has 6000 unique directed pairs, bounded pages and no per-row resolution', () => {
  const { catalog } = fixture(1000, 6), rows = qualificationRows(catalog, [], [], [source])
  assert.equal(rows.length, 6000)
  const page = qualificationPage(catalog, rows, { page: 120 }, [source])
  assert.equal(page.total, 6000); assert.equal(page.items.length, 50); assert.equal(page.counts.PENDING, 6000)
})

function fakePrisma() {
  const data = fixture(3), decisions: IgnoreDecision[] = [], relations: QualificationRow['relations'] = [], statements: string[] = [], writes: string[] = [], options: unknown[] = []
  let mutationError: unknown = null
  const tx = {
    async $executeRawUnsafe(sql: string) { statements.push(sql) },
    entity: { async findMany() { return data.entities } },
    ingestionAssociation: { async findMany() { return data.origins.map(origin => ({ sourceId: origin.sourceId, externalId: origin.path,
      decisions: [{ entityId: origin.entityId }], item: { receipts: [{ metadata: origin.metadata }] } })) } },
    source: { async findMany() { return [source] } }, relation: { async findMany() { return relations } },
    obsidianReferenceIgnore: {
      async findMany() { return decisions },
      async upsert(input: { create: IgnoreDecision; update: IgnoreDecision }) {
        if (mutationError) throw mutationError
        writes.push('ignore'); decisions.splice(0, decisions.length, { ...input.create }); return input.create
      },
      async delete() { writes.push('revoke'); decisions.splice(0); return {} },
    },
  }
  const prisma = { async $transaction(callback: (tx: unknown) => Promise<unknown>, option: unknown) { options.push(option); return callback(tx) } } as unknown as PrismaClient
  return { data, decisions, relations, statements, writes, options, service: createPrismaQualificationService(prisma),
    failWith(error: unknown) { mutationError = error } }
}

test('consistent read-only aggregation and details perform zero writes; ignorance alone writes its dedicated table', async () => {
  const fake = fakePrisma(), page = await fake.service.list({ page: 1 }), row = page.items[0]!
  assert.deepEqual(fake.statements, ['SET TRANSACTION READ ONLY']); assert.deepEqual(fake.writes, [])
  const request = { fromEntityId: row.from.id, toEntityId: row.to.id, fingerprint: row.fingerprint, expectedDecisionRevision: null, ignore: true }
  await fake.service.decide(request, { discordId: '222222222222222222', label: 'Auteur fictif' })
  assert.deepEqual(fake.writes, ['ignore']); assert.deepEqual(fake.options[1], { isolationLevel: 'Serializable', timeout: 20000 })
  const after = await fake.service.list({ page: 1, state: 'IGNORED' })
  assert.equal(after.total, 1)
  const detail = await fake.service.detail(row.from.id, stamp.toISOString())
  assert.equal(detail!.outgoing.find(item => item.id === row.to.id)!.qualification!.state, 'IGNORED')
  const incoming = await fake.service.detail(row.to.id, stamp.toISOString())
  assert.equal(incoming!.incoming.find(item => item.id === row.from.id)!.qualification!.state, 'IGNORED')
  await assert.rejects(fake.service.decide(request, { discordId: '2', label: 'Stale' }), { status: 409, code: 'REFERENCE_MODIFIED' })
  await fake.service.decide({ ...request, ignore: false, expectedDecisionRevision: after.items[0]!.decisionRevision }, { discordId: '2', label: 'Revoke' })
  assert.deepEqual(fake.writes, ['ignore', 'revoke']); assert.equal((await fake.service.list({ page: 1 })).counts.IGNORED, 0)
  fake.relations.push(relation(row.to.id, row.from.id))
  await assert.rejects(fake.service.decide(request, { discordId: '2', label: 'Auteur' }), { status: 409, code: 'REFERENCE_QUALIFIED' })
  assert.deepEqual(fake.writes, ['ignore', 'revoke'])
})

test('stale fingerprint, missing reference and database concurrency errors return 409 without lore writes', async () => {
  const fake = fakePrisma(), row = (await fake.service.list({ page: 1 })).items[0]!
  const input = { fromEntityId: row.from.id, toEntityId: row.to.id, fingerprint: row.fingerprint, expectedDecisionRevision: null, ignore: true }
  for (const patch of [{ fingerprint: '0'.repeat(64) }, { toEntityId: uuid(4444) }]) {
    await assert.rejects(fake.service.decide({ ...input, ...patch }, { discordId: '2', label: 'Auteur' }), { status: 409 })
  }
  for (const code of ['P2002', 'P2003', 'P2034', 'P2025']) {
    fake.failWith({ code }); await assert.rejects(fake.service.decide(input, { discordId: '2', label: 'Auteur' }), { status: 409 })
  }
  assert.deepEqual(fake.writes, [])
})

test('admin-only queue and decisions enforce session, whitelist, exact origin, strict inputs and no-store', async () => {
  const config = readAuthConfig({ DISCORD_CLIENT_ID: '111111111111111111', DISCORD_CLIENT_SECRET: 'fake',
    DISCORD_REDIRECT_URI: 'http://localhost:5173/api/auth/discord/callback', DISCORD_ADMIN_IDS: '222222222222222222',
    SESSION_SECRET: 'a-test-secret-of-more-than-thirty-two-characters', SESSION_TTL_MS: '3600000' })
  const fake = fakePrisma(), actorCalls: unknown[] = []
  const server = createApp({ async ping() {}, async listEntities() { return [] }, async listRelationTypes() { return [] }, async getEntityBySlug() { return null } }, {
    auth: { config, store: { async findSession(hash) {
      const discordId = hash === sessionHash('a'.repeat(43)) ? '222222222222222222' : hash === sessionHash('b'.repeat(43)) ? '333333333333333333' : null
      return discordId ? { discordId, username: 'editor', displayName: null, expiresAt: new Date(Date.now() + 60000) } : null
    }, async rotateSession() {}, async revokeSession() {} }, discord: { authorizationUrl: () => '', async exchangeCode() { throw new Error('unused') } } },
    admin: { async getEntity() { return null }, async getRelationEvidence() { return [] },
      async listEntities() { return { items: [], total: 0, page: 1, pageSize: 50 } }, async getStats() { throw new Error('unused') } },
    editorial: { async patch() { throw new Error('unused') }, async publish() { throw new Error('unused') }, async unpublish() { throw new Error('unused') } },
    qualification: { ...fake.service, async decide(input, actor) { actorCalls.push(actor); await fake.service.decide(input, actor) } },
  }).listen(0, '127.0.0.1')
  try {
    await once(server, 'listening'); const address = server.address(); assert.ok(address && typeof address !== 'string')
    const base = `http://127.0.0.1:${address.port}`, path = `${base}/api/admin/reference-qualifications`
    const cookie = (token: string) => `${sessionCookieName(config)}=${token.repeat(43)}`
    assert.equal((await fetch(path)).status, 401)
    assert.equal((await fetch(`${base}/api/admin/relations/${uuid(1)}/evidence`)).status, 401)
    assert.equal((await fetch(`${base}/api/admin/relations/${uuid(1)}/evidence`, { headers: { Cookie: cookie('a') } })).status, 200)
    assert.equal((await fetch(`${base}/api/admin/relations/invalid/evidence`, { headers: { Cookie: cookie('a') } })).status, 400)
    assert.equal((await fetch(path, { headers: { Cookie: cookie('b') } })).status, 403)
    assert.equal((await fetch(`${base}/api/v1/reference-qualifications`)).status, 404)
    for (const query of ['direction=incoming', 'sourceId=invalid', 'page=0', 'q=x&unknown=x', 'state=MISSING', 'page=1&page=2']) {
      assert.equal((await fetch(`${path}?${query}`, { headers: { Cookie: cookie('a') } })).status, 400)
    }
    const page = await fetch(path, { headers: { Cookie: cookie('a') } }); assert.equal(page.status, 200)
    assert.equal(page.headers.get('cache-control'), 'no-store')
    const row = (await fake.service.list({ page: 1 })).items[0]!
    const body = { fromEntityId: row.from.id, toEntityId: row.to.id, fingerprint: row.fingerprint, expectedDecisionRevision: null, ignore: true }
    const post = (origin: string, payload = body) => fetch(`${path}/decision`, { method: 'POST',
      headers: { Cookie: cookie('a'), Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    assert.equal((await post('https://attacker.invalid')).status, 403)
    assert.equal((await post(config.origin, { ...body, fingerprint: 'not-a-hash' })).status, 400)
    assert.equal((await post(config.origin)).status, 204)
    assert.deepEqual(actorCalls, [{ discordId: '222222222222222222', label: 'editor' }])
    const revoke = await fetch(`${path}/decision`, { method: 'POST', headers: {
      Cookie: cookie('a'), Origin: config.origin, 'Content-Type': 'application/json',
    }, body: JSON.stringify({ ...body, ignore: false, expectedDecisionRevision: fake.decisions[0]!.revision.toUpperCase() }) })
    assert.equal(revoke.status, 204); assert.equal(fake.decisions.length, 0)
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})

test('compact admin detail counts relation evidence without fetching proof contents; old projection is preserved', async () => {
  const queries: unknown[] = [], related = { ...relation(uuid(0), uuid(1)), description: null, updatedAt: stamp,
    toEntity: { id: uuid(1), slug: 'target', title: 'Target', kind: 'OTHER', placeKind: null, summary: null,
      tags: [], status: 'PROPOSED', visibility: 'GM', updatedAt: stamp }, _count: { evidence: 123 } }
  const prisma = { entity: { async findUnique(query: unknown) {
    queries.push(query)
    return { id: uuid(0), slug: 'owner', title: 'Owner', kind: 'OTHER', placeKind: null, summary: null,
      tags: [], aliases: [], bodyMarkdown: '', status: 'PROPOSED', visibility: 'GM', createdAt: stamp, updatedAt: stamp,
      publishedAt: null, evidence: [], revisions: [], outgoingRelations: [related], incomingRelations: [] }
  } } } as unknown as PrismaClient
  const detail = await createPrismaAdminStore(prisma).getEntity('owner', true)
  assert.equal(detail!.outgoingRelations[0]!.evidenceCount, 123)
  assert.equal(detail!.outgoingRelations[0]!.evidenceDeferred, true)
  assert.deepEqual(detail!.outgoingRelations[0]!.evidence, [])
  const query = queries[0] as { select: { outgoingRelations: { select: { evidence: boolean; _count: unknown } } } }
  assert.equal(query.select.outgoingRelations.select.evidence, false)
  assert.deepEqual(query.select.outgoingRelations.select._count, { select: { evidence: true } })
})
