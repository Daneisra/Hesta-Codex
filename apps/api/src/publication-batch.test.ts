import assert from 'node:assert/strict'
import { test, before, beforeEach, after } from 'node:test'
import { readdir, readFile } from 'node:fs/promises'
import { once } from 'node:events'
import type { Server } from 'node:http'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from './prisma-client/client.ts'
import { createPrismaPublicationBatchService } from './admin/publication-batch.js'
import { createPrismaEditorialService } from './admin/editorial.js'
import { createPrismaAdminStore } from './admin/store.js'
import { createPrismaStore } from './store.js'
import { createPrismaGraphStore } from './graph.js'
import { createApp } from './app.js'
import { readAuthConfig } from './auth/config.js'
import { sessionHash, sessionCookieName } from './auth/session.js'
import type { PublicationSelection } from '@hesta-codex/shared'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, stamp = new Date('2026-01-01T00:00:00Z')
const db = new PGlite(), socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0, maxConnections: 1 })
let prisma: PrismaClient, service: ReturnType<typeof createPrismaPublicationBatchService>, server: Server, base: string
const actor = '222222222222222222', author = 'Auteur fictif', config = readAuthConfig({ DISCORD_CLIENT_ID: '111111111111111111',
  DISCORD_CLIENT_SECRET: 'fictif', DISCORD_REDIRECT_URI: 'http://localhost:5173/api/auth/discord/callback', DISCORD_ADMIN_IDS: actor,
  SESSION_SECRET: 'a-fictional-session-secret-with-more-than-32-characters', SESSION_TTL_MS: '3600000' })
const cookie = (char = 'a') => `${sessionCookieName(config)}=${char.repeat(43)}`
const selection = { entityIds: [id(1), id(2)], includeRelations: true }
const snapshot = () => Promise.all(['Entity', 'Relation', 'Revision', 'Evidence', 'Source', 'IngestionBatch', 'IngestionItem', 'IngestionReceipt', 'IngestionAssociation']
  .map(table => db.query(`SELECT * FROM "${table}" ORDER BY id`).then(result => result.rows)))
const approved = async (input: PublicationSelection = selection) => ({ ...input, fingerprint: (await service.preview(input)).fingerprint, confirm: true as const, confirmPublic: false })
const post = (action: string, body: unknown, token = 'a', origin = 'http://localhost:5173') => fetch(`${base}/api/admin/publication-batches/${action}`, {
  method: 'POST', headers: { Cookie: cookie(token), Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})
async function relation(n: number, from: number, to: number, status: 'PROPOSED' | 'PUBLISHED' | 'DRAFT' = 'PROPOSED', evidence = true) {
  await prisma.relationType.upsert({ where: { id: id(900 + n) }, update: {}, create: { id: id(900 + n), code: `fictive_${n}`, label: 'mention fictive' } })
  await prisma.relation.create({ data: { id: id(n), fromEntityId: id(from), toEntityId: id(to), relationTypeId: id(900 + n), status, visibility: 'GM', updatedAt: stamp } })
  if (evidence) await prisma.evidence.create({ data: { relationId: id(n), sourceId: id(50), claimText: 'Preuve fictive', updatedAt: stamp } })
}
before(async () => {
  const migrations = new URL('../../../prisma/migrations/', import.meta.url)
  for (const name of (await readdir(migrations)).filter(name => /^\d/.test(name)).sort()) await db.exec(await readFile(new URL(`${name}/migration.sql`, migrations), 'utf8'))
  await socket.start()
  prisma = new PrismaClient({ adapter: new PrismaPg({ host: '127.0.0.1', port: Number(socket.getServerConn().split(':')[1]), database: 'postgres', user: 'postgres', max: 1 }) })
  service = createPrismaPublicationBatchService(prisma)
  const graph = createPrismaGraphStore(prisma)
  server = createApp(createPrismaStore(prisma), { admin: createPrismaAdminStore(prisma), editorial: createPrismaEditorialService(prisma), publication: service,
    graph, auth: { config, store: {
      async findSession(hash) { const discordId = hash === sessionHash('a'.repeat(43)) ? actor : hash === sessionHash('b'.repeat(43)) ? '333333333333333333' : null
        return discordId ? { discordId, username: author, displayName: null, expiresAt: new Date(Date.now() + 60000) } : null },
      async rotateSession() {}, async revokeSession() {},
    }, discord: { authorizationUrl: () => '', async exchangeCode() { throw new Error('unused') } } },
  }, graph).listen(0, '127.0.0.1')
  await once(server, 'listening'); const address = server.address(); assert.ok(address && typeof address !== 'string'); base = `http://127.0.0.1:${address.port}`
})
beforeEach(async () => {
  await db.exec('DROP TRIGGER IF EXISTS publication_failure ON "Relation"; DROP TRIGGER IF EXISTS publication_failure ON "Revision"; TRUNCATE "Entity", "Source", "IngestionBatch" CASCADE;')
  await prisma.entity.createMany({ data: Array.from({ length: 7 }, (_, index) => ({ id: id(index + 1), slug: `fictive-${index + 1}`,
    title: index === 6 ? '' : `Fiche fictive ${index + 1}`, kind: 'CONCEPT' as const, bodyMarkdown: 'Texte **fictif** original.',
    aliases: ['Alias fictif'], tags: ['Fictif'], visibility: 'GM' as const, status: index === 3 ? 'PUBLISHED' as const
      : index === 4 ? 'DRAFT' as const : index === 5 ? 'ARCHIVED' as const : 'PROPOSED' as const,
    publishedAt: index === 3 ? stamp : null, updatedAt: stamp })) })
  await prisma.source.create({ data: { id: id(50), kind: 'MANUAL', label: 'Source fictive', updatedAt: stamp } })
  await prisma.evidence.createMany({ data: [1, 2, 4, 5, 6, 7].map(n => ({ entityId: id(n), sourceId: id(50), claimText: 'Preuve fictive', updatedAt: stamp })) })
  await prisma.revision.createMany({ data: [1, 2].map(n => ({ entityId: id(n), number: 1, editorLabel: author, snapshot: { fictive: true } })) })
  await relation(101, 1, 2); await relation(102, 2, 4); await relation(103, 1, 3)
})
after(async () => { server?.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await prisma?.$disconnect(); await socket.stop(); await db.close() })

test('preview is read-only, deduplicates incident relations and reports blocked, skipped and invalid elements', async () => {
  await relation(104, 1, 4, 'PROPOSED', false); await relation(105, 1, 1); await relation(106, 1, 4, 'DRAFT'); await relation(107, 1, 4, 'PUBLISHED')
  const before = await snapshot(), plan = await service.preview({ entityIds: [1, 2, 3, 4, 5, 6, 7].map(id), includeRelations: true })
  assert.deepEqual(plan.counts, { entitiesReady: 2, entitiesBlocked: 4, entitiesSkipped: 1, relationsReady: 2, relationsBlocked: 4, relationsSkipped: 1, publicElements: 0 })
  assert.equal(plan.relations.filter(row => row.id === id(101)).length, 1)
  assert.equal(JSON.stringify(plan).includes('Texte **fictif**'), false)
  assert.deepEqual(await snapshot(), before)
  assert.deepEqual(await service.preview({ entityIds: [id(2), id(1)], includeRelations: false }), await service.preview({ entityIds: [id(1), id(2)], includeRelations: false }))
})
test('approved GM batch preserves content, visibility, provenance and outside entities with one human revision per new publication', async () => {
  const before = await snapshot(), input = await approved()
  assert.deepEqual(await service.apply(input, author), { entities: 2, relations: 2 })
  const after = await snapshot()
  for (let i = 3; i < before.length; i++) assert.deepEqual(after[i], before[i])
  for (const n of [1, 2]) {
    const entity = await prisma.entity.findUniqueOrThrow({ where: { id: id(n) } })
    assert.equal(entity.status, 'PUBLISHED'); assert.equal(entity.visibility, 'GM'); assert.ok(entity.publishedAt)
    assert.equal(entity.bodyMarkdown, 'Texte **fictif** original.'); assert.deepEqual(entity.aliases, ['Alias fictif']); assert.deepEqual(entity.tags, ['Fictif'])
    const revisions = await prisma.revision.findMany({ where: { entityId: id(n) }, orderBy: { number: 'asc' } })
    assert.equal(revisions.length, 2); assert.equal(revisions[1]!.editorLabel, author); assert.equal(revisions[1]!.snapshot && typeof revisions[1]!.snapshot, 'object')
  }
  assert.deepEqual((after[0] as Array<{ id: string }>).filter(row => !selection.entityIds.includes(row.id)), (before[0] as Array<{ id: string }>).filter(row => !selection.entityIds.includes(row.id)))
  assert.equal((await prisma.relation.findUniqueOrThrow({ where: { id: id(103) } })).status, 'PROPOSED')
  assert.equal((await createPrismaGraphStore(prisma).publicGraph()).nodes.length, 0)
  const saved = await snapshot(); await assert.rejects(service.apply(input, author), { status: 409 }); assert.deepEqual(await snapshot(), saved)
  const retry = await service.preview(selection); assert.equal(retry.counts.entitiesReady + retry.counts.relationsReady, 0)
})
test('relation inclusion is optional and never publishes a neighboring unselected fiche', async () => {
  assert.deepEqual(await service.apply(await approved({ ...selection, includeRelations: false }), author), { entities: 2, relations: 0 })
  assert.equal(await prisma.relation.count({ where: { status: 'PROPOSED' } }), 3)
  assert.equal((await prisma.entity.findUniqueOrThrow({ where: { id: id(3) } })).status, 'PROPOSED')
})
test('a fully blocked selection and missing human approval cannot produce any writes', async () => {
  const input = await approved({ entityIds: [id(3), id(5), id(6), id(7)], includeRelations: false }), before = await snapshot()
  await assert.rejects(service.apply(input, author), { code: 'NOTHING_TO_PUBLISH' })
  await assert.rejects(service.apply({ ...await approved(), confirm: false as true }, author), { code: 'CONFIRMATION_REQUIRED' })
  assert.deepEqual(await snapshot(), before)
})
test('already published selected fiches can validate their eligible relations without duplicate entity revisions', async () => {
  await prisma.entity.update({ where: { id: id(2) }, data: { status: 'PUBLISHED', publishedAt: stamp } })
  const input = await approved({ entityIds: [id(4)], includeRelations: true })
  assert.deepEqual(await service.apply(input, author), { entities: 0, relations: 1 })
  assert.equal(await prisma.revision.count(), 2)
})
test('PUBLIC elements require a separate explicit confirmation and GM visibilities never change', async () => {
  await prisma.entity.updateMany({ where: { id: { in: selection.entityIds } }, data: { visibility: 'PUBLIC' } })
  await prisma.relation.update({ where: { id: id(101) }, data: { visibility: 'PUBLIC' } })
  const input = await approved(), before = await snapshot()
  assert.equal((await service.preview(selection)).counts.publicElements, 3)
  await assert.rejects(service.apply(input, author), { code: 'PUBLIC_CONFIRMATION_REQUIRED' }); assert.deepEqual(await snapshot(), before)
  await service.apply({ ...input, confirmPublic: true }, author)
  const graph = await createPrismaGraphStore(prisma).publicGraph()
  assert.equal(graph.nodes.length, 2); assert.equal(graph.edges.length, 1)
  assert.equal((await prisma.entity.findUniqueOrThrow({ where: { id: id(4) } })).visibility, 'GM')
})
for (const change of ['content', 'evidence', 'source', 'relation', 'endpoint', 'deletion'] as const) test(`${change} changes invalidate approval without partial writes`, async () => {
  const input = await approved()
  if (change === 'content') await prisma.entity.update({ where: { id: id(1) }, data: { bodyMarkdown: 'Contenu fictif corrigé' } })
  if (change === 'evidence') await prisma.evidence.updateMany({ where: { entityId: id(1) }, data: { claimText: 'Preuve fictive corrigée', updatedAt: new Date() } })
  if (change === 'source') await prisma.source.update({ where: { id: id(50) }, data: { label: 'Source fictive corrigée' } })
  if (change === 'relation') await relation(110, 1, 4)
  if (change === 'endpoint') await prisma.entity.update({ where: { id: id(4) }, data: { visibility: 'PUBLIC' } })
  if (change === 'deletion') await prisma.evidence.deleteMany({ where: { relationId: id(101) } })
  const before = await snapshot(); await assert.rejects(service.apply(input, author), { status: 409 }); assert.deepEqual(await snapshot(), before)
})
for (const table of ['Revision', 'Relation']) test(`${table} failure rolls back all entity statuses, dates, revisions and relations`, async () => {
  const input = await approved(), before = await snapshot()
  await db.exec(`CREATE OR REPLACE FUNCTION fail_publication() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Fictive failure'; END; $$;
    CREATE TRIGGER publication_failure BEFORE ${table === 'Revision' ? 'INSERT' : 'UPDATE'} ON "${table}" FOR EACH ROW EXECUTE FUNCTION fail_publication();`)
  await assert.rejects(service.apply(input, author)); assert.deepEqual(await snapshot(), before)
})
test('concurrent double confirmation applies exactly once', async () => {
  const input = await approved(), results = await Promise.allSettled([service.apply(input, author), service.apply(input, author)])
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1); assert.equal(await prisma.revision.count(), 4)
})
test('144 fictitious fiches and 200 relations can be validated and then made PUBLIC in separate transactions', async () => {
  const entities = Array.from({ length: 144 }, (_, n) => ({ id: id(2000 + n), slug: `grande-fictive-${n}`, title: `Grande fiche fictive ${n}`,
    kind: 'CONCEPT' as const, status: 'PROPOSED' as const, visibility: 'GM' as const }))
  await prisma.entity.createMany({ data: entities })
  await prisma.relationType.upsert({ where: { id: id(8000) }, update: {}, create: { id: id(8000), code: 'fictive_large', label: 'lien fictif' } })
  const relations = Array.from({ length: 200 }, (_, n) => ({ id: id(4000 + n), fromEntityId: entities[n % 144]!.id,
    toEntityId: entities[(n + 1 + Math.floor(n / 144)) % 144]!.id, relationTypeId: id(8000), status: 'PROPOSED' as const, visibility: 'GM' as const }))
  await prisma.relation.createMany({ data: relations })
  await prisma.evidence.createMany({ data: [...entities.map(row => ({ entityId: row.id, sourceId: id(50), claimText: 'Preuve fictive' })),
    ...relations.map(row => ({ relationId: row.id, sourceId: id(50), claimText: 'Preuve fictive' }))] })
  const input = await approved({ entityIds: entities.map(row => row.id), includeRelations: true })
  assert.deepEqual(await service.apply(input, author), { entities: 144, relations: 200 })
  assert.equal(await prisma.revision.count(), 146)
  const published = await prisma.entity.findMany({ where: { id: { in: entities.map(row => row.id) } }, orderBy: { id: 'asc' } })
  const visibility = { entityIds: entities.map(row => row.id), includeRelations: true, targetVisibility: 'PUBLIC' as const }
  assert.deepEqual((await service.preview(visibility)).visibilityImpact, { publicEntities: 144, publicRelations: 200, hiddenEntities: 0, hiddenRelations: 0 })
  assert.deepEqual(await service.apply({ ...await approved(visibility), confirmPublic: true }, author), { entities: 144, relations: 200 })
  assert.equal(await prisma.revision.count(), 290)
  const updated = await prisma.entity.findMany({ where: { id: { in: entities.map(row => row.id) } }, orderBy: { id: 'asc' } })
  assert.deepEqual(updated.map(row => row.publishedAt), published.map(row => row.publishedAt))
  const graph = await createPrismaGraphStore(prisma).publicGraph(); assert.equal(graph.nodes.length, 144); assert.equal(graph.edges.length, 200)
})

test('visibility changes preserve PROPOSED statuses and content, require PUBLIC consent and are idempotent', async () => {
  const request: PublicationSelection = { ...selection, targetVisibility: 'PUBLIC' }, before = await snapshot()
  const preview = await service.preview(request)
  assert.equal(preview.targetVisibility, 'PUBLIC'); assert.equal(preview.counts.publicElements, 5)
  assert.deepEqual(preview.visibilityImpact, { publicEntities: 0, publicRelations: 0, hiddenEntities: 0, hiddenRelations: 0 })
  assert.deepEqual(await snapshot(), before)
  const input = await approved(request)
  await assert.rejects(service.apply(input, author), { code: 'PUBLIC_CONFIRMATION_REQUIRED' }); assert.deepEqual(await snapshot(), before)
  assert.deepEqual(await service.apply({ ...input, confirmPublic: true }, author), { entities: 2, relations: 3 })
  const after = await snapshot()
  for (let i = 3; i < after.length; i++) assert.deepEqual(after[i], before[i])
  for (const n of [1, 2]) {
    const entity = await prisma.entity.findUniqueOrThrow({ where: { id: id(n) } })
    assert.equal(entity.visibility, 'PUBLIC'); assert.equal(entity.status, 'PROPOSED'); assert.equal(entity.publishedAt, null)
    assert.equal(entity.bodyMarkdown, 'Texte **fictif** original.'); assert.deepEqual(entity.aliases, ['Alias fictif']); assert.deepEqual(entity.tags, ['Fictif'])
    const revision = await prisma.revision.findUniqueOrThrow({ where: { entityId_number: { entityId: id(n), number: 2 } } })
    assert.equal(revision.editorLabel, author); assert.match(revision.message!, /GM → PUBLIC/)
  }
  assert.equal((await prisma.entity.findUniqueOrThrow({ where: { id: id(3) } })).visibility, 'GM')
  assert.equal((await prisma.relation.findUniqueOrThrow({ where: { id: id(101) } })).status, 'PROPOSED')
  assert.equal((await createPrismaGraphStore(prisma).publicGraph()).nodes.length, 0)
  const saved = await snapshot(); await assert.rejects(service.apply({ ...input, confirmPublic: true }, author), { status: 409 }); assert.deepEqual(await snapshot(), saved)
  const again = await service.preview(request); assert.equal(again.counts.entitiesReady + again.counts.relationsReady, 0)
})
test('published visibility changes expose only selected public endpoints and retain publication dates', async () => {
  await prisma.entity.updateMany({ where: { id: { in: selection.entityIds } }, data: { status: 'PUBLISHED', publishedAt: stamp } })
  await prisma.relation.updateMany({ data: { status: 'PUBLISHED' } })
  const request: PublicationSelection = { ...selection, targetVisibility: 'PUBLIC' }
  assert.deepEqual((await service.preview(request)).visibilityImpact, { publicEntities: 2, publicRelations: 1, hiddenEntities: 0, hiddenRelations: 0 })
  await service.apply({ ...await approved(request), confirmPublic: true }, author)
  const graph = await createPrismaGraphStore(prisma).publicGraph(); assert.equal(graph.nodes.length, 2); assert.equal(graph.edges.length, 1)
  assert.equal((await prisma.entity.findUniqueOrThrow({ where: { id: id(1) } })).publishedAt!.toISOString(), stamp.toISOString())
  assert.equal((await prisma.entity.findUniqueOrThrow({ where: { id: id(4) } })).visibility, 'GM')
  assert.equal(await prisma.evidence.count({ where: { visibility: 'PUBLIC' } }), 0)
  assert.equal((await prisma.source.findUniqueOrThrow({ where: { id: id(50) } })).visibility, 'GM')
})
test('visibility impact counts already PUBLIC relations when relation editing is off, including hiding them again', async () => {
  await prisma.entity.updateMany({ where: { id: { in: selection.entityIds } }, data: { status: 'PUBLISHED', publishedAt: stamp } })
  await prisma.entity.update({ where: { id: id(2) }, data: { visibility: 'PUBLIC' } })
  const relation = await prisma.relation.update({ where: { id: id(101) }, data: { visibility: 'PUBLIC', status: 'PUBLISHED' } })
  const request: PublicationSelection = { entityIds: [id(1)], includeRelations: false, targetVisibility: 'PUBLIC' }
  const preview = await service.preview(request); assert.equal(preview.relations.length, 0)
  assert.deepEqual(preview.visibilityImpact, { publicEntities: 1, publicRelations: 1, hiddenEntities: 0, hiddenRelations: 0 })
  await service.apply({ ...await approved(request), confirmPublic: true }, author)
  assert.deepEqual(await prisma.relation.findUniqueOrThrow({ where: { id: id(101) } }), relation)
  const restricted = { ...request, targetVisibility: 'GM' as const }
  assert.deepEqual((await service.preview(restricted)).visibilityImpact, { publicEntities: 0, publicRelations: 0, hiddenEntities: 1, hiddenRelations: 1 })
  assert.deepEqual(await service.apply(await approved(restricted), author), { entities: 1, relations: 0 })
  assert.equal((await createPrismaGraphStore(prisma).publicGraph()).edges.length, 0)
  assert.equal((await prisma.entity.findUniqueOrThrow({ where: { id: id(2) } })).visibility, 'PUBLIC')
})
test('visibility previews block archives and invalid fields and skip already matching visibilities', async () => {
  await prisma.entity.update({ where: { id: id(1) }, data: { visibility: 'PUBLIC' } })
  await relation(111, 2, 6)
  const request: PublicationSelection = { entityIds: [1, 2, 6, 7].map(id), includeRelations: true, targetVisibility: 'PUBLIC' }
  const preview = await service.preview(request)
  assert.equal(preview.counts.entitiesSkipped, 1); assert.equal(preview.counts.entitiesBlocked, 2)
  assert.equal(preview.relations.find(row => row.id === id(111))!.outcome, 'BLOCKED')
  await service.apply({ ...await approved(request), confirmPublic: true }, author)
  assert.equal((await prisma.entity.findUniqueOrThrow({ where: { id: id(6) } })).visibility, 'GM')
  assert.equal((await prisma.entity.findUniqueOrThrow({ where: { id: id(7) } })).visibility, 'GM')
})
test('changing visibility does not substitute for validation or its proof requirement', async () => {
  const request: PublicationSelection = { entityIds: [id(3), id(5)], includeRelations: false, targetVisibility: 'PLAYERS' }
  assert.deepEqual(await service.apply(await approved(request), author), { entities: 2, relations: 0 })
  assert.equal((await prisma.entity.findUniqueOrThrow({ where: { id: id(3) } })).status, 'PROPOSED')
  assert.equal((await prisma.entity.findUniqueOrThrow({ where: { id: id(5) } })).status, 'DRAFT')
  assert.equal((await service.preview({ entityIds: [id(3)], includeRelations: false })).counts.entitiesBlocked, 1)
})
test('changing the target visibility or operation cannot reuse an approval fingerprint', async () => {
  const request: PublicationSelection = { ...selection, targetVisibility: 'PUBLIC' }, input = await approved(request), before = await snapshot()
  await assert.rejects(service.apply({ ...input, targetVisibility: 'SECRET', confirmPublic: true }, author), { status: 409 })
  await assert.rejects(service.apply({ ...input, targetVisibility: undefined, confirmPublic: true }, author), { status: 409 })
  assert.deepEqual(await snapshot(), before)
})
test('an incident relation added after visibility preview invalidates approval even if relations are not edited', async () => {
  const input = await approved({ entityIds: [id(1)], includeRelations: false, targetVisibility: 'PUBLIC' })
  await relation(111, 1, 4, 'PUBLISHED')
  const before = await snapshot(); await assert.rejects(service.apply({ ...input, confirmPublic: true }, author), { status: 409 }); assert.deepEqual(await snapshot(), before)
})
for (const table of ['Revision', 'Relation']) test(`visibility batch ${table} failure rolls back the complete change`, async () => {
  const input = await approved({ ...selection, targetVisibility: 'PUBLIC' }), before = await snapshot()
  await db.exec(`CREATE OR REPLACE FUNCTION fail_publication() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Fictive failure'; END; $$;
    CREATE TRIGGER publication_failure BEFORE ${table === 'Revision' ? 'INSERT' : 'UPDATE'} ON "${table}" FOR EACH ROW EXECUTE FUNCTION fail_publication();`)
  await assert.rejects(service.apply({ ...input, confirmPublic: true }, author)); assert.deepEqual(await snapshot(), before)
})
test('visibility API validates the target enum and enforces explicit PUBLIC approval server-side', async () => {
  for (const targetVisibility of ['invalid', 'public', null]) assert.equal((await post('preview', { ...selection, targetVisibility })).status, 400)
  const request = { ...selection, targetVisibility: 'PUBLIC' }
  const preview = await post('preview', request); assert.equal(preview.status, 200)
  const input = { ...request, fingerprint: (await preview.json()).fingerprint, confirm: true, confirmPublic: false }, before = await snapshot()
  assert.equal((await post('apply', input)).status, 400); assert.deepEqual(await snapshot(), before)
  const result = await post('apply', { ...input, confirmPublic: true }); assert.equal(result.status, 200)
  assert.deepEqual(await result.json(), { entities: 2, relations: 3 })
})
test('admin API requires session, whitelist, Origin, strict selection and explicit confirmation', async () => {
  assert.equal((await fetch(base + '/api/admin/publication-batches/candidates')).status, 401)
  const candidates = await fetch(base + '/api/admin/publication-batches/candidates', { headers: { Cookie: cookie() } })
  assert.equal(candidates.status, 200); assert.equal(candidates.headers.get('cache-control'), 'no-store'); assert.equal((await candidates.json()).length, 7)
  for (const action of ['preview', 'apply']) {
    assert.equal((await post(action, {}, 'x')).status, 401); assert.equal((await post(action, {}, 'b')).status, 403)
    assert.equal((await post(action, {}, 'a', 'https://example.test')).status, 403)
    assert.equal((await post(action, { ...selection, visibility: 'PUBLIC' })).status, 400)
  }
  for (const entityIds of [[], [id(1), id(1)], Array.from({ length: 501 }, (_, n) => id(n + 1)), ['invalid']]) {
    assert.equal((await post('preview', { entityIds, includeRelations: false })).status, 400)
  }
  assert.equal((await post('apply', { ...await approved(), confirm: false })).status, 400)
  const plan = await post('preview', selection); assert.equal(plan.status, 200); assert.equal(plan.headers.get('cache-control'), 'no-store')
  const response = await post('apply', { ...selection, fingerprint: (await plan.json()).fingerprint, confirm: true, confirmPublic: false })
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { entities: 2, relations: 2 })
  const revision = await prisma.revision.findFirstOrThrow({ where: { entityId: id(1), number: 2 } }); assert.equal(revision.editorLabel, author)
})
