import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { PrismaPg } from '@prisma/adapter-pg'
import { originalRelationCodes, relationTypeDefinitions } from '@hesta-codex/shared'
import { PrismaClient } from './prisma-client/client.ts'
import { createPrismaProvenanceService } from './admin/provenance.js'
import { relationPatchSchema } from './admin/provenance-validation.js'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const stamp = new Date('2026-01-01T00:00:00Z'), expectedUpdatedAt = stamp.toISOString()
const db = new PGlite() // Synthetic, in-memory PostgreSQL only; never DATABASE_URL.
const socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0, maxConnections: 1 })
let prisma: PrismaClient
let service: ReturnType<typeof createPrismaProvenanceService>
const input = { description: 'Description fictive', visibility: 'GM' as const, expectedUpdatedAt }
const row = () => prisma.relation.findUniqueOrThrow({ where: { id: id(10) } })
const preservedTables = ['Entity', 'Evidence', 'Revision', 'Source', 'IngestionBatch', 'IngestionItem',
  'IngestionReceipt', 'IngestionAssociation', 'IngestionAssociationDecision', 'RelationType']
const preserved = () => Promise.all(preservedTables.map(table => db.query(`SELECT * FROM "${table}" ORDER BY 1`).then(result => result.rows)))

before(async () => {
  const migrations = new URL('../../../prisma/migrations/', import.meta.url)
  for (const name of (await readdir(migrations)).filter(name => /^\d/.test(name)).sort()) {
    await db.exec(await readFile(new URL(`${name}/migration.sql`, migrations), 'utf8'))
  }
  await socket.start()
  const port = Number(socket.getServerConn().split(':')[1]); assert.ok(port > 0)
  prisma = new PrismaClient({ adapter: new PrismaPg({ host: '127.0.0.1', port, database: 'postgres', user: 'postgres', max: 1 }) })
  service = createPrismaProvenanceService(prisma)
  await prisma.relationType.createMany({ data: relationTypeDefinitions.filter(type => originalRelationCodes.some(code => code === type.code)) })
})
after(async () => { await prisma?.$disconnect(); await socket.stop(); await db.close() })

beforeEach(async () => {
  await db.exec('DROP TRIGGER IF EXISTS edit_failure ON "Relation"; TRUNCATE "Entity", "Relation", "Evidence", "Revision", "Source", "IngestionBatch", "IngestionItem", "IngestionReceipt", "IngestionAssociation", "IngestionAssociationDecision", "ObsidianReferenceIgnore" CASCADE;')
  await prisma.entity.createMany({ data: [1, 2, 3].map(n => ({ id: id(n), slug: `fiche-${n}`, title: `Fiche fictive ${n}`,
    kind: 'PERSON', status: 'PUBLISHED', visibility: 'PUBLIC', publishedAt: stamp, bodyMarkdown: 'Markdown original fictif', updatedAt: stamp })) })
  const type = await prisma.relationType.findUniqueOrThrow({ where: { code: 'works_for' } })
  await prisma.relation.create({ data: { id: id(10), fromEntityId: id(1), toEntityId: id(2), relationTypeId: type.id,
    status: 'PROPOSED', visibility: 'GM', description: input.description, updatedAt: stamp } })
  await prisma.source.create({ data: { id: id(20), kind: 'OBSIDIAN', externalId: 'synthetic-vault', label: 'Source fictive' } })
  await prisma.evidence.create({ data: { id: id(21), sourceId: id(20), relationId: id(10), claimText: 'Énoncé original fictif',
    sourceExcerpt: 'Extrait original fictif', locator: 'Tests/Fiche.md', updatedAt: stamp } })
  await prisma.revision.create({ data: { id: id(22), entityId: id(1), number: 1, snapshot: { title: 'Fiche fictive 1' } } })
  await prisma.ingestionBatch.create({ data: { id: id(30), label: 'Lot fictif', receivedCount: 1, newCount: 1, unchangedCount: 0, modifiedCount: 0 } })
  await prisma.ingestionItem.create({ data: { id: id(31), sourceId: id(20), batchId: id(30), identityKey: `e:${'a'.repeat(64)}`,
    externalId: 'Tests/Fiche.md', version: 1, contentHash: 'b'.repeat(64), content: 'Markdown original fictif' } })
  await prisma.ingestionReceipt.create({ data: { id: id(32), batchId: id(30), itemId: id(31), ordinal: 1, outcome: 'NEW' } })
  await prisma.ingestionAssociation.create({ data: { id: id(33), sourceId: id(20), itemId: id(31), identityKey: `e:${'a'.repeat(64)}`,
    externalId: 'Tests/Fiche.md', revision: 1 } })
  await prisma.ingestionAssociationDecision.create({ data: { id: id(34), associationId: id(33), entityId: id(1), decision: 'CONFIRMED',
    origin: 'MANUAL', authorDiscordId: '111111111111111111', authorLabel: 'Auteur fictif' } })
})

test('correction reverses the existing relation atomically, retaining its ID, proofs, original Markdown and all provenance/staging', async () => {
  const before = await preserved(), original = await row()
  await service.patchRelation(id(10), { ...input, reverse: true })
  const corrected = await row()
  assert.equal(corrected.id, original.id); assert.equal(corrected.fromEntityId, id(2)); assert.equal(corrected.toEntityId, id(1))
  assert.equal(corrected.relationTypeId, original.relationTypeId); assert.equal(corrected.status, 'PROPOSED')
  assert.ok(corrected.updatedAt > original.updatedAt)
  assert.deepEqual(await preserved(), before)
  await assert.rejects(service.patchRelation(id(10), { ...input, reverse: true }), { code: 'RELATION_MODIFIED' })
  assert.deepEqual(await row(), corrected)
})

test('type replacements, inverse codes and symmetric normalization use the same orientation as creation', async () => {
  const original = await row()
  await service.patchRelation(id(10), { ...input, relationCode: 'employs' })
  assert.equal((await row()).fromEntityId, id(2)); assert.equal((await row()).relationTypeId, original.relationTypeId)
  const current = await row()
  await service.patchRelation(id(10), { ...input, expectedUpdatedAt: current.updatedAt.toISOString(), relationCode: 'allied_with', reverse: true })
  const allied = await row()
  assert.equal(allied.fromEntityId, id(1)); assert.equal(allied.toEntityId, id(2))
  assert.equal((await prisma.relationType.findUniqueOrThrow({ where: { id: allied.relationTypeId } })).code, 'allied_with')
  await service.patchRelation(id(10), { ...input, expectedUpdatedAt: allied.updatedAt.toISOString(), relationCode: 'allied_with', reverse: true })
  assert.deepEqual(await row(), allied)
})

test('equivalent readings are a no-op; real corrections withdraw a published relation without changing visibility', async () => {
  await prisma.relation.update({ where: { id: id(10) }, data: { status: 'PUBLISHED', visibility: 'PUBLIC', updatedAt: stamp } })
  const original = await row()
  await service.patchRelation(id(10), { ...input, visibility: 'PUBLIC', relationCode: 'employs', reverse: true })
  assert.deepEqual(await row(), original)
  const result = await service.patchRelation(id(10), { ...input, visibility: 'PUBLIC', relationCode: 'protects' })
  assert.equal(result.status, 'PROPOSED'); assert.equal((await row()).visibility, 'PUBLIC')
  assert.equal(await prisma.relation.count({ where: { status: 'PUBLISHED', visibility: 'PUBLIC' } }), 0)
  assert.equal(await prisma.evidence.count({ where: { relationId: id(10) } }), 1)
})

test('duplicate corrections, including the opposite orientation of a symmetric relation, leave every field unchanged', async () => {
  const type = await prisma.relationType.findUniqueOrThrow({ where: { code: 'works_for' } })
  await prisma.relation.create({ data: { id: id(11), fromEntityId: id(2), toEntityId: id(1), relationTypeId: type.id } })
  const original = await row()
  await assert.rejects(service.patchRelation(id(10), { ...input, description: 'Ne doit pas être enregistré', reverse: true }), { code: 'RELATION_CONFLICT' })
  assert.deepEqual(await row(), original)
  const allied = await prisma.relationType.findUniqueOrThrow({ where: { code: 'allied_with' } })
  await prisma.relation.update({ where: { id: id(11) }, data: { relationTypeId: allied.id } })
  await assert.rejects(service.patchRelation(id(10), { ...input, relationCode: 'allied_with' }), { code: 'RELATION_CONFLICT' })
  assert.deepEqual(await row(), original)
})

test('the SQL uniqueness constraint also rejects a race that passes the duplicate precheck, with full rollback', async () => {
  const original = await row()
  await prisma.relation.create({ data: { id: id(11), fromEntityId: id(2), toEntityId: id(1), relationTypeId: original.relationTypeId } })
  const racyClient = prisma.$extends({ query: { relation: { async findFirst() { return null } } } })
  const racyService = createPrismaProvenanceService(racyClient as unknown as PrismaClient)
  await assert.rejects(racyService.patchRelation(id(10), { ...input, description: 'Ne doit pas être enregistré', reverse: true }), { code: 'RELATION_CONFLICT' })
  assert.deepEqual(await row(), original)
})

test('unknown/ambiguous codes, archived endpoints or relations, missing IDs and legacy self-links are rejected', async () => {
  const original = await row()
  await assert.rejects(service.patchRelation(id(10), { ...input, relationCode: 'unknown' }), { code: 'RELATION_TYPE_NOT_FOUND' })
  await prisma.relationType.create({ data: { code: 'custom', label: 'Type fictif', inverseCode: 'works_for', inverseLabel: 'Inverse fictif' } })
  await assert.rejects(service.patchRelation(id(10), { ...input, relationCode: 'works_for' }), { code: 'RELATION_TYPE_AMBIGUOUS' })
  await prisma.relationType.delete({ where: { code: 'custom' } })
  await prisma.entity.update({ where: { id: id(2) }, data: { status: 'ARCHIVED' } })
  await assert.rejects(service.patchRelation(id(10), { ...input, reverse: true }), { code: 'ENTITY_ARCHIVED' })
  assert.deepEqual(await row(), original)
  await prisma.relation.update({ where: { id: id(10) }, data: { status: 'ARCHIVED', updatedAt: stamp } })
  await assert.rejects(service.patchRelation(id(10), { ...input, reverse: true }), { code: 'INVALID_STATUS' })
  await assert.rejects(service.patchRelation(id(999), { ...input, reverse: true }), { code: 'NOT_FOUND' })
  await prisma.relation.update({ where: { id: id(10) }, data: { status: 'PROPOSED', toEntityId: id(1), updatedAt: stamp } })
  await assert.rejects(service.patchRelation(id(10), { ...input, relationCode: 'protects' }), { code: 'RELATION_SELF_REFERENCE' })
})

test('competing edits using the same expected version cannot both succeed', async () => {
  const results = await Promise.allSettled([service.patchRelation(id(10), { ...input, reverse: true }),
    service.patchRelation(id(10), { ...input, relationCode: 'protects' })])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(results.filter(result => result.status === 'rejected' && result.reason.code === 'RELATION_MODIFIED').length, 1)
})

test('an injected PostgreSQL failure rolls the entire correction back, including proposed status and metadata', async () => {
  await prisma.relation.update({ where: { id: id(10) }, data: { status: 'PUBLISHED', updatedAt: stamp } })
  const original = await row(), before = await preserved()
  await db.exec(`CREATE OR REPLACE FUNCTION fail_relation_edit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic edit failure'; END; $$;
    CREATE TRIGGER edit_failure BEFORE UPDATE ON "Relation" FOR EACH ROW EXECUTE FUNCTION fail_relation_edit();`)
  await assert.rejects(service.patchRelation(id(10), { ...input, reverse: true, visibility: 'SECRET', description: 'Brouillon fictif' }))
  assert.deepEqual(await row(), original); assert.deepEqual(await preserved(), before)
})

test('patch validation accepts only explicit type/orientation fields and preserves identity/status restrictions', () => {
  assert.ok(relationPatchSchema.safeParse({ ...input, relationCode: 'works_for', reverse: true }).success)
  for (const extra of [{ reverse: 'true' }, { relationCode: '' }, { relationCode: 'BAD CODE' }, { relationCode: 'a'.repeat(65) },
    { relationTypeId: id(5) }, { fromEntityId: id(3) }, { toEntityId: id(3) }, { status: 'PUBLISHED' }]) {
    assert.equal(relationPatchSchema.safeParse({ ...input, ...extra }).success, false)
  }
})
