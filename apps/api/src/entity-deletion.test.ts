import assert from 'node:assert/strict'
import { before, beforeEach, after, test } from 'node:test'
import { readdir, readFile } from 'node:fs/promises'
import { once } from 'node:events'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { PrismaPg } from '@prisma/adapter-pg'
import { originalRelationCodes, relationTypeDefinitions } from '@hesta-codex/shared'
import { PrismaClient } from './prisma-client/client.ts'
import { createPrismaEntityDeletionService } from './admin/entity-deletion.js'
import { createPrismaAdminStore } from './admin/store.js'
import { createPrismaReferenceService } from './obsidian-references.js'
import { createPrismaGraphStore } from './graph.js'
import { createPrismaIngestionAssociationService } from './ingestion/association.js'
import { createPrismaIngestionProposalService } from './ingestion/proposal.js'
import { createApp } from './app.js'
import { readAuthConfig } from './auth/config.js'
import { sessionHash, sessionCookieName } from './auth/session.js'
import { itemIdentity, sha256 } from './ingestion/format.js'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const stamp = new Date('2026-01-01T00:00:00Z')
const db = new PGlite() // Always in memory, never DATABASE_URL or a persisted database.
const socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0, maxConnections: 1 })
let prisma: PrismaClient
let service: ReturnType<typeof createPrismaEntityDeletionService>
const tables = ['Entity', 'Relation', 'Evidence', 'Revision', 'Source', 'RelationType', 'IngestionBatch', 'IngestionItem',
  'IngestionReceipt', 'IngestionAssociation', 'IngestionAssociationDecision', 'ObsidianReferenceIgnore']
const snapshots = () => Promise.all(tables.map(table => db.query(`SELECT * FROM "${table}" ORDER BY 1,2`).then(result => result.rows)))

before(async () => {
  const migrations = new URL('../../../prisma/migrations/', import.meta.url)
  for (const name of (await readdir(migrations)).filter(name => /^\d/.test(name)).sort()) {
    await db.exec(await readFile(new URL(`${name}/migration.sql`, migrations), 'utf8'))
  }
  await socket.start()
  const port = Number(socket.getServerConn().split(':')[1])
  assert.ok(port > 0)
  prisma = new PrismaClient({ adapter: new PrismaPg({ host: '127.0.0.1', port, database: 'postgres', user: 'postgres', max: 1 }) })
  service = createPrismaEntityDeletionService(prisma)
  await prisma.relationType.createMany({ data: relationTypeDefinitions.filter(type => originalRelationCodes.some(code => code === type.code))
    .map((type, index) => ({ ...type, id: id(100 + index) })) })
})
after(async () => { await prisma?.$disconnect(); await socket.stop(); await db.close() })

beforeEach(async () => {
  // Synthetic fixture only; the socket is owned by the in-memory database above.
  await db.exec('DROP TRIGGER IF EXISTS deletion_failure ON "Entity"; TRUNCATE "Entity", "Relation", "Evidence", "Revision", "Source", "IngestionBatch", "IngestionItem", "IngestionReceipt", "IngestionAssociation", "IngestionAssociationDecision", "ObsidianReferenceIgnore" CASCADE;')
  await prisma.entity.createMany({ data: [
    { id: id(1), slug: 'cible', title: 'Cible fictive', kind: 'CONCEPT', status: 'PUBLISHED', visibility: 'PUBLIC',
      publishedAt: stamp, bodyMarkdown: '[[Tests/Autre]]', updatedAt: stamp },
    { id: id(2), slug: 'autre', title: 'Autre fictive', kind: 'CONCEPT', status: 'PROPOSED', visibility: 'GM', bodyMarkdown: '[[Tests/Cible]]', updatedAt: stamp },
    { id: id(3), slug: 'tiers', title: 'Tiers fictive', kind: 'CONCEPT', status: 'PROPOSED', visibility: 'GM', bodyMarkdown: '[[Tests/Autre]]', updatedAt: stamp },
  ] })
  const located = await prisma.relationType.findUniqueOrThrow({ where: { code: 'located_in' } })
  const allied = await prisma.relationType.findUniqueOrThrow({ where: { code: 'allied_with' } })
  await prisma.relation.createMany({ data: [
    { id: id(10), fromEntityId: id(1), toEntityId: id(2), relationTypeId: located.id },
    { id: id(11), fromEntityId: id(3), toEntityId: id(1), relationTypeId: located.id },
    { id: id(12), fromEntityId: id(2), toEntityId: id(3), relationTypeId: allied.id },
    { id: id(13), fromEntityId: id(1), toEntityId: id(1), relationTypeId: located.id }, // A legacy self-edge counts once.
  ] })
  await prisma.source.create({ data: { id: id(50), kind: 'OBSIDIAN', externalId: 'synthetic-vault', label: 'Source fictive', visibility: 'GM' } })
  await prisma.evidence.createMany({ data: [
    { id: id(40), sourceId: id(50), entityId: id(1), claimText: 'Origine fictive' },
    { id: id(41), sourceId: id(50), entityId: id(2), claimText: 'Preuve indépendante' },
    ...[10, 11, 12, 13].map((relation, index) => ({ id: id(42 + index), sourceId: id(50), relationId: id(relation), claimText: 'Lien fictif' })),
  ] })
  await prisma.revision.createMany({ data: [1, 2].map(n => ({ id: id(29 + n), entityId: id(n), number: 1, snapshot: { fixture: true } })) })
  await prisma.ingestionBatch.create({ data: { id: id(51), label: 'Lot fictif', receivedCount: 3, newCount: 3, unchangedCount: 0, modifiedCount: 0 } })
  for (const [index, path] of ['Cible', 'Autre', 'Tiers'].entries()) {
    const externalId = `Tests/${path}.md`, content = 'Markdown original fictif', contentHash = sha256(content)
    const identityKey = itemIdentity(externalId, contentHash)
    await prisma.ingestionItem.create({ data: { id: id(60 + index), batchId: id(51), sourceId: id(50),
      identityKey, externalId, version: 1, contentHash, content } })
    await prisma.ingestionReceipt.create({ data: { id: id(80 + index), batchId: id(51), itemId: id(60 + index), ordinal: index,
      outcome: 'NEW', title: `${path} fictive`, locator: externalId, contentType: 'text/markdown', metadata: {
        obsidian: { wikilinks: [{ status: 'FOUND', target: 'Tests/Cible', path: 'Tests/Cible.md' }] },
      } } })
    await prisma.ingestionAssociation.create({ data: { id: id(70 + index), itemId: id(60 + index), sourceId: id(50),
      identityKey, externalId, revision: 3 + 2 * index } })
  }
  await prisma.ingestionAssociationDecision.createMany({ data: [
    { id: id(90), associationId: id(70), entityId: id(1), decision: 'CONFIRMED' as const },
    { id: id(91), associationId: id(71), entityId: id(2), decision: 'CONFIRMED' as const },
    { id: id(92), associationId: id(71), entityId: id(1), decision: 'REJECTED' as const },
    { id: id(93), associationId: id(72), entityId: id(3), decision: 'CONFIRMED' as const },
  ].map(row => ({ ...row, origin: 'MANUAL', authorDiscordId: '111111111111111111', authorLabel: 'Auteur fictif' })) })
  await prisma.obsidianReferenceIgnore.createMany({ data: [[1, 2], [3, 1], [1, 1], [2, 3]].map(([from, to], index) => ({
    fromEntityId: id(from!), toEntityId: id(to!), revision: id(500 + index), fingerprint: 'a'.repeat(64),
    authorDiscordId: '111111111111111111', authorLabel: 'Auteur fictif',
  })) })
})
const request = async () => { const preview = await service.preview('cible'); return { entityId: preview.id, fingerprint: preview.fingerprint, confirm: true as const } }

test('Prisma preview is read-only and counts unique incoming/outgoing/self relations and all actual dependencies', async () => {
  const before = await snapshots(), preview = await service.preview('cible')
  assert.deepEqual(preview.counts, { relations: 3, directEvidence: 1, relationEvidence: 3, revisions: 1,
    associationDecisions: 2, associations: 2, referenceIgnores: 3 })
  assert.equal(preview.title, 'Cible fictive'); assert.match(preview.fingerprint, /^[0-9a-f]{64}$/)
  assert.equal((await service.preview('cible')).fingerprint, preview.fingerprint)
  assert.deepEqual(await snapshots(), before)
})

test('atomic Prisma deletion of a published fiche preserves other fiches, independent proofs, Sources and all staging originals', async () => {
  const before = await snapshots()
  await service.remove('cible', await request())
  const after = await snapshots()
  for (const name of ['Source', 'RelationType', 'IngestionBatch', 'IngestionItem', 'IngestionReceipt']) {
    assert.deepEqual(after[tables.indexOf(name)], before[tables.indexOf(name)], name)
  }
  assert.deepEqual(after[0], before[0]!.filter(row => (row as { id: string }).id !== id(1)))
  assert.deepEqual(after[1], before[1]!.filter(row => (row as { id: string }).id === id(12)))
  assert.deepEqual(after[2], before[2]!.filter(row => [id(41), id(44)].includes((row as { id: string }).id)))
  assert.deepEqual(after[3], before[3]!.filter(row => (row as { id: string }).id === id(31)))
  assert.equal(await prisma.ingestionAssociationDecision.count(), 2)
  assert.deepEqual((await prisma.ingestionAssociation.findMany({ orderBy: { id: 'asc' }, select: { revision: true } })).map(row => row.revision), [4, 6, 7])
  assert.equal(await prisma.obsidianReferenceIgnore.count(), 1)
  const references = createPrismaReferenceService(prisma), graph = createPrismaGraphStore(prisma, references)
  const admin = await graph.adminGraph(); assert.equal(admin.nodes.length, 2); assert.equal(admin.edges.length, 2)
  assert.ok(admin.edges.every(edge => edge.source !== id(1) && edge.target !== id(1)))
  assert.equal((await graph.publicGraph()).nodes.length, 0)
  const other = await prisma.entity.findUniqueOrThrow({ where: { slug: 'autre' } })
  assert.equal((await references.detail(other.id, other.updatedAt.toISOString()))!.diagnostics[0]!.status, 'UNASSOCIATED')
  const association = await createPrismaIngestionAssociationService(prisma).read(id(60))
  assert.equal(association.confirmed, null); assert.equal(association.revision, 4)
  const stats = await createPrismaAdminStore(prisma).getStats(); assert.equal(stats.relations, 1); assert.equal(stats.byStatus.PUBLISHED, 0)
})

test('a PostgreSQL failure after dependent deletes rolls back every row and association revision', async () => {
  const before = await snapshots()
  await db.exec(`CREATE OR REPLACE FUNCTION fail_deletion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected deletion failure'; END; $$;
    CREATE TRIGGER deletion_failure BEFORE DELETE ON "Entity" FOR EACH ROW EXECUTE FUNCTION fail_deletion();`)
  await assert.rejects(service.remove('cible', await request()), /Injected deletion failure/)
  assert.deepEqual(await snapshots(), before)
})

test('changed dependencies, replaced UUIDs and unconfirmed requests are rejected without any deletion', async () => {
  const input = await request()
  await prisma.evidence.create({ data: { sourceId: id(50), relationId: id(10), claimText: 'Nouvelle preuve fictive' } })
  const before = await snapshots()
  await assert.rejects(service.remove('cible', input), { status: 409, code: 'ENTITY_DELETION_MODIFIED' })
  await assert.rejects(service.remove('cible', { ...await request(), entityId: id(3) }), { status: 409 })
  await assert.rejects(service.remove('cible', { ...await request(), confirm: false as unknown as true }), { status: 400 })
  assert.deepEqual(await snapshots(), before)
})

test('a change to an existing fiche, relation, proof, association or ignore invalidates approval even when all counters stay unchanged', async () => {
  const changes = [
    () => prisma.entity.update({ where: { id: id(1) }, data: { title: 'Titre fictif modifié' } }),
    () => prisma.relation.update({ where: { id: id(10) }, data: { description: 'Relation fictive modifiée', updatedAt: new Date('2027-01-01') } }),
    () => prisma.evidence.update({ where: { id: id(42) }, data: { claimText: 'Preuve fictive modifiée', updatedAt: new Date('2027-01-01') } }),
    () => prisma.ingestionAssociation.update({ where: { id: id(70) }, data: { revision: { increment: 1 } } }),
    () => prisma.obsidianReferenceIgnore.update({ where: { fromEntityId_toEntityId: { fromEntityId: id(1), toEntityId: id(2) } }, data: { revision: id(550) } }),
  ]
  for (const change of changes) {
    const approved = await service.preview('cible')
    await change()
    const before = await snapshots()
    assert.deepEqual((await service.preview('cible')).counts, approved.counts)
    await assert.rejects(service.remove('cible', { entityId: approved.id, fingerprint: approved.fingerprint, confirm: true }), { status: 409 })
    assert.deepEqual(await snapshots(), before)
  }
})

test('replay/missing slug returns 404 and stale staging proposal cannot recreate the deleted fiche', async () => {
  const input = await request()
  await service.remove('cible', input)
  await assert.rejects(service.preview('cible'), { status: 404 })
  await assert.rejects(service.remove('cible', input), { status: 404 })
  const proposal = createPrismaIngestionProposalService(prisma)
  await assert.rejects(proposal.create(id(60), { receiptId: id(80), expectedRevision: 3,
    entity: { title: 'Cible fictive', slug: 'cible', kind: 'CONCEPT', placeKind: null, summary: null,
      bodyMarkdown: 'Texte fictif', aliases: [], tags: [], visibility: 'GM' }, evidence: { claimText: 'Confirmation fictive', sourceExcerpt: null, locator: 'Tests/Cible.md' } },
  { discordId: '111111111111111111', label: 'Auteur fictif' }), { status: 409 })
  assert.equal(await prisma.entity.count(), 2)
})

test('all fiche statuses, including archived, allow individual confirmed deletion', async () => {
  for (const status of ['DRAFT', 'PROPOSED', 'ARCHIVED'] as const) {
    const slug = `statut-${status.toLowerCase()}`
    await prisma.entity.create({ data: { slug, title: 'Fiche fictive', kind: 'OTHER', status } })
    const preview = await service.preview(slug)
    await service.remove(slug, { entityId: preview.id, fingerprint: preview.fingerprint, confirm: true })
    assert.equal(await prisma.entity.findUnique({ where: { slug } }), null)
  }
})

test('DELETE and preview enforce Discord admin, whitelist, exact Origin, strict confirmation and privacy', async () => {
  const config = readAuthConfig({ DISCORD_CLIENT_ID: '111111111111111111', DISCORD_CLIENT_SECRET: 'fake',
    DISCORD_REDIRECT_URI: 'http://localhost:5173/api/auth/discord/callback', DISCORD_ADMIN_IDS: '222222222222222222',
    SESSION_SECRET: 'a-test-secret-of-more-than-thirty-two-characters', SESSION_TTL_MS: '3600000' })
  const server = createApp({ async ping() {}, async listEntities() { return [] }, async listRelationTypes() { return [] }, async getEntityBySlug() { return null } }, {
    auth: { config, store: { async findSession(hash) {
      const discordId = hash === sessionHash('a'.repeat(43)) ? '222222222222222222' : hash === sessionHash('b'.repeat(43)) ? '333333333333333333' : null
      return discordId ? { discordId, username: 'editor', displayName: null, expiresAt: new Date(Date.now() + 60000) } : null
    }, async rotateSession() {}, async revokeSession() {} }, discord: { authorizationUrl: () => '', async exchangeCode() { throw new Error('unused') } } },
    admin: createPrismaAdminStore(prisma), editorial: { async patch() { throw new Error('unused') }, async publish() { throw new Error('unused') }, async unpublish() { throw new Error('unused') } },
    deletion: service,
  }).listen(0, '127.0.0.1')
  try {
    await once(server, 'listening'); const address = server.address(); assert.ok(address && typeof address !== 'string')
    const base = `http://127.0.0.1:${address.port}`, path = `${base}/api/admin/entities/cible`
    const cookie = (token: string) => `${sessionCookieName(config)}=${token.repeat(43)}`
    assert.equal((await fetch(`${path}/deletion`)).status, 401)
    assert.equal((await fetch(`${path}/deletion`, { headers: { Cookie: cookie('b') } })).status, 403)
    assert.equal((await fetch(`${base}/api/v1/entities/cible`, { method: 'DELETE' })).status, 404)
    const preview = await fetch(`${path}/deletion`, { headers: { Cookie: cookie('a') } })
    assert.equal(preview.headers.get('cache-control'), 'no-store'); assert.equal(preview.status, 200)
    const input = await request()
    const remove = (body: unknown, origin = config.origin, token = 'a', slug = 'cible') => fetch(`${base}/api/admin/entities/${slug}`, {
      method: 'DELETE', headers: { Cookie: cookie(token), Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    assert.equal((await remove(input, config.origin, 'c')).status, 401)
    assert.equal((await remove(input, config.origin, 'b')).status, 403)
    assert.equal((await remove(input, 'https://attacker.invalid')).status, 403)
    for (const body of [{}, { ...input, confirm: false }, { ...input, all: true }, { ...input, fingerprint: 'invalid' }]) {
      assert.equal((await remove(body)).status, 400)
    }
    assert.equal((await remove(input, config.origin, 'a', 'InvalidSlug')).status, 400)
    assert.equal(await prisma.entity.count(), 3)
    assert.equal((await remove(input)).status, 204); assert.equal(await prisma.entity.count(), 2)
    assert.equal((await remove(input)).status, 404)
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
