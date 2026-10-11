import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { groupRelationTypes, originalRelationCodes, relationCatalog, relationKindWarning, relationTypeDefinitions } from '@hesta-codex/shared'
import type { PrismaClient } from './prisma-client/client.ts'

const migrations = new URL('../../../prisma/migrations/', import.meta.url)
const migrationName = '20261011120000_editorial_relation_catalog'
const migrationSql = await readFile(new URL(`${migrationName}/migration.sql`, migrations), 'utf8')
const additions = relationTypeDefinitions.filter(type => !originalRelationCodes.some(code => code === type.code))
const original = relationTypeDefinitions.filter(type => originalRelationCodes.some(code => code === type.code))
const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`

test('catalogue has 27 types, 7 symmetric types, unique direct/inverse codes and the unchanged four original definitions', () => {
  assert.equal(relationCatalog.length, 27); assert.equal(additions.length, 23)
  assert.equal(relationCatalog.filter(type => type.symmetric).length, 7)
  const codes = relationCatalog.flatMap(type => [type.code, ...(type.inverseCode ? [type.inverseCode] : [])])
  assert.equal(codes.length, 47); assert.equal(new Set(codes).size, codes.length)
  for (const type of relationCatalog) {
    assert.match(type.code, /^[a-z][a-z0-9_]*$/); assert.ok(type.code.length <= 64 && type.label.length <= 200)
    assert.equal(type.symmetric, type.inverseCode === null); assert.equal(type.symmetric, type.inverseLabel === null)
    if (!type.symmetric) { assert.ok(type.inverseLabel); assert.notEqual(type.inverseCode, type.code) }
  }
  assert.deepEqual(original, [
    { code: 'located_in', label: 'situé dans', inverseCode: 'contains', inverseLabel: 'contient', symmetric: false },
    { code: 'parent_of', label: 'parent de', inverseCode: 'child_of', inverseLabel: 'enfant de', symmetric: false },
    { code: 'member_of', label: 'membre de', inverseCode: 'has_member', inverseLabel: 'compte parmi ses membres', symmetric: false },
    { code: 'allied_with', label: 'allié à', inverseCode: null, inverseLabel: null, symmetric: true },
  ])
  const serialized = migrationSql.match(/new_types CONSTANT jsonb := '([\s\S]*?)'::jsonb/)![1]!.replaceAll("''", "'")
  const sqlTypes = JSON.parse(serialized) as Array<typeof additions[number] & { id: string }>
  assert.deepEqual(sqlTypes.map(type => ({ code: type.code, label: type.label, inverseCode: type.inverseCode,
    inverseLabel: type.inverseLabel, symmetric: type.symmetric })), additions)
  assert.equal(new Set(sqlTypes.map(type => type.id)).size, 23)
})

test('grouping is stable, uses actual database UUIDs/labels, preserves custom types and never offers absent types', () => {
  const types = relationTypeDefinitions.map((type, index) => ({ ...type, id: id(index) }))
  assert.deepEqual(groupRelationTypes([...types].reverse()), groupRelationTypes(types))
  const custom = { ...types[0]!, code: 'custom', id: id(99), label: 'Libellé personnalisé' }
  const grouped = groupRelationTypes([custom, { ...types[1]!, label: 'Capitale personnalisée' }])
  assert.deepEqual(grouped.map(group => group.label), ['Géographie et territoires', 'Autres relations'])
  assert.equal(grouped[0]!.types[0]!.label, 'Capitale personnalisée'); assert.equal(grouped[1]!.types[0], custom)
  assert.equal(grouped.flatMap(group => group.types).length, 2)
})

test('kind warnings respect inverse orientation, supernatural actors, symmetry and unknown kinds without imposing restrictions', () => {
  assert.equal(relationKindWarning('capital_of', 'PLACE', 'PLACE'), null)
  assert.match(relationKindWarning('capital_of', 'PERSON', 'PLACE')!, /choix reste autorisé/)
  assert.equal(relationKindWarning('worships', 'CREATURE', 'DEITY'), null)
  assert.equal(relationKindWarning('worshipped_by', 'DEITY', 'SPECIES'), null)
  assert.match(relationKindWarning('worshipped_by', 'SPECIES', 'DEITY')!, /est vénéré par/)
  assert.equal(relationKindWarning('parent_of', 'DEITY', 'CREATURE'), null)
  assert.equal(relationKindWarning('borders', 'PLACE', 'PLACE'), null)
  assert.equal(relationKindWarning('created', 'ORGANIZATION', 'ARTIFACT'), null)
  assert.equal(relationKindWarning('capital_of', 'OTHER', 'CONCEPT'), null)
  assert.equal(relationKindWarning('custom', 'CONCEPT', 'PLACE'), null)
})

async function database() {
  const db = new PGlite()
  try {
    for (const name of (await readdir(migrations)).filter(name => name < migrationName && /^\d/.test(name)).sort()) {
      await db.exec(await readFile(new URL(`${name}/migration.sql`, migrations), 'utf8'))
    }
    for (const [index, type] of original.entries()) await db.query(
      'INSERT INTO "RelationType" (id, code, label, "inverseCode", "inverseLabel", "symmetric", "updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [id(1000 + index), type.code, type.label, type.inverseCode, type.inverseLabel, type.symmetric, '2026-01-01T00:00:00Z'])
    return db
  } catch (error) { await db.close(); throw error }
}
async function snapshot(db: PGlite, tables: string[]) {
  return Promise.all(tables.map(async table => (await db.query(`SELECT * FROM "${table}" ORDER BY id`)).rows))
}
async function seedAdapter(db: PGlite) {
  const { installRelationCatalog } = await import(new URL('../../../prisma/relation-catalog.ts', import.meta.url).href) as {
    installRelationCatalog: (prisma: PrismaClient) => Promise<void>
  }
  const prisma = { $transaction: async (work: (tx: unknown) => Promise<void>) => db.transaction(async tx => work({
    $executeRawUnsafe: (sql: string) => tx.exec(sql),
    relationType: {
      findMany: async () => (await tx.query('SELECT * FROM "RelationType"')).rows,
      create: async ({ data }: { data: typeof additions[number] }) => (await tx.query(
        'INSERT INTO "RelationType" (id,code,label,"inverseCode","inverseLabel","symmetric","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,CURRENT_TIMESTAMP) RETURNING *',
        [randomUUID(), data.code, data.label, data.inverseCode, data.inverseLabel, data.symmetric])).rows[0],
    },
  })) } as unknown as PrismaClient
  await installRelationCatalog(prisma)
}

test('PostgreSQL installs only the 23 additions twice, preserving all 130 entities, proofs, revisions, associations and three existing relations', async () => {
  const db = await database()
  try {
    await db.exec(`
      INSERT INTO "Source" (id,kind,label,"externalId","updatedAt") VALUES ('${id(2000)}','OBSIDIAN','Coffre fictif','synthetic-vault',CURRENT_TIMESTAMP);
      INSERT INTO "IngestionBatch" (id,label,"receivedCount","newCount","unchangedCount","modifiedCount") VALUES ('${id(2001)}','Lot fictif',130,130,0,0);
      INSERT INTO "Entity" (id,slug,kind,title,"bodyMarkdown",status,visibility,"updatedAt")
        SELECT ('00000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,'note-' || n,'CONCEPT','Note fictive ' || n,'Texte fictif ' || n,'PROPOSED','GM',CURRENT_TIMESTAMP FROM generate_series(1,130) n;
      INSERT INTO "Evidence" (id,"sourceId","entityId","claimText","updatedAt") SELECT gen_random_uuid(),'${id(2000)}',id,'Origine fictive',CURRENT_TIMESTAMP FROM "Entity";
      INSERT INTO "Revision" (id,"entityId",number,snapshot) SELECT gen_random_uuid(),id,1,jsonb_build_object('title',title) FROM "Entity";
      INSERT INTO "IngestionItem" (id,"batchId","sourceId","identityKey","externalId",version,"contentHash",content)
        SELECT id,'${id(2001)}','${id(2000)}','e:' || lpad(row_number() OVER (ORDER BY id)::text,64,'0'),slug || '.md',1,repeat('a',64),"bodyMarkdown" FROM "Entity";
      INSERT INTO "IngestionReceipt" (id,"batchId","itemId",ordinal,outcome) SELECT id,'${id(2001)}',id,row_number() OVER (ORDER BY id),'NEW' FROM "Entity";
      INSERT INTO "IngestionAssociation" (id,"sourceId","identityKey","externalId","itemId",revision) SELECT id,"sourceId","identityKey","externalId",id,1 FROM "IngestionItem";
      INSERT INTO "IngestionAssociationDecision" (id,"associationId","entityId",decision,origin,"authorDiscordId","authorLabel") SELECT id,id,id,'CONFIRMED','MANUAL','111111111111111111','Auteur fictif' FROM "Entity";
      INSERT INTO "Relation" (id,"fromEntityId","toEntityId","relationTypeId",status,visibility,"updatedAt") VALUES
        ('${id(3000)}','${id(1)}','${id(2)}','${id(1000)}','PROPOSED','GM',CURRENT_TIMESTAMP),
        ('${id(3001)}','${id(2)}','${id(3)}','${id(1003)}','PROPOSED','GM',CURRENT_TIMESTAMP),
        ('${id(3002)}','${id(4)}','${id(5)}','${id(1000)}','PROPOSED','GM',CURRENT_TIMESTAMP);
    `)
    const tables = ['Entity', 'Relation', 'Source', 'Evidence', 'Revision', 'IngestionBatch', 'IngestionItem', 'IngestionReceipt', 'IngestionAssociation', 'IngestionAssociationDecision']
    const before = await snapshot(db, tables), originalTypes = (await db.query<{ id: string }>('SELECT * FROM "RelationType" ORDER BY id')).rows
    await db.exec(migrationSql)
    const installed = await snapshot(db, ['RelationType'])
    assert.equal(installed[0]!.length, 27)
    assert.deepEqual((await db.query('SELECT * FROM "RelationType" WHERE id = ANY($1::uuid[]) ORDER BY id', [originalTypes.map(row => row.id)])).rows, originalTypes)
    assert.deepEqual(await snapshot(db, tables), before)
    await db.exec(migrationSql); assert.deepEqual(await snapshot(db, ['RelationType']), installed)
    await seedAdapter(db); assert.deepEqual(await snapshot(db, ['RelationType']), installed)
    assert.deepEqual(await snapshot(db, tables), before)
  } finally { await db.close() }
})

test('PostgreSQL migration and seed are idempotent even when a new code already has a different UUID', async () => {
  const db = await database()
  try {
    await seedAdapter(db)
    // A compatible code already exists: its candidate migration UUID is irrelevant, even if occupied elsewhere.
    await db.query('INSERT INTO "RelationType" (id,code,label,"updatedAt") VALUES ($1,$2,$3,CURRENT_TIMESTAMP)',
      ['d706ed9d-0ccb-4df1-8a6e-000000000001', 'custom', 'Type fictif personnalisé'])
    const seeded = await snapshot(db, ['RelationType'])
    await db.exec(migrationSql); await seedAdapter(db)
    assert.deepEqual(await snapshot(db, ['RelationType']), seeded)
  } finally { await db.close() }
})

test('PostgreSQL aborts the complete additive migration and seed for direct/inverse namespace collisions or incompatible definitions', async () => {
  const db = await database()
  try {
    for (const [code, inverse, label] of [['has_capital', null, 'Collision fictive'], ['custom', 'capital_of', 'Collision fictive'],
      ['custom', 'has_capital', 'Collision fictive'], ['uses', 'used_by', 'Définition incompatible']] as const) {
      await db.query('INSERT INTO "RelationType" (id,code,label,"inverseCode","inverseLabel","symmetric","updatedAt") VALUES ($1,$2,$3,$4,$5,false,CURRENT_TIMESTAMP)',
        [id(4000), code, label, inverse, inverse ? 'Inverse fictif' : null])
      const before = await snapshot(db, ['RelationType'])
      await assert.rejects(db.exec(migrationSql), /Conflicting relation code|Existing relation definition differs/)
      assert.deepEqual(await snapshot(db, ['RelationType']), before)
      await assert.rejects(seedAdapter(db), /Conflicting relation code|Existing relation definition differs/)
      assert.deepEqual(await snapshot(db, ['RelationType']), before)
      await db.query('DELETE FROM "RelationType" WHERE id = $1', [id(4000)])
    }
  } finally { await db.close() }
})

test('PostgreSQL retains its code, inverse and symmetric type constraints for the new vocabulary', async () => {
  const db = await database()
  try {
    await db.exec(migrationSql)
    await assert.rejects(db.query('INSERT INTO "RelationType" (id,code,label,"updatedAt") VALUES ($1,$2,$3,CURRENT_TIMESTAMP)',
      [id(4000), 'capital_of', 'Doublon']), /duplicate key/)
    await assert.rejects(db.query('INSERT INTO "RelationType" (id,code,label,"inverseCode","updatedAt") VALUES ($1,$2,$3,$4,CURRENT_TIMESTAMP)',
      [id(4000), 'custom', 'Doublon', 'has_capital']), /duplicate key/)
    await assert.rejects(db.query('INSERT INTO "RelationType" (id,code,label,"inverseCode","symmetric","updatedAt") VALUES ($1,$2,$3,$4,true,CURRENT_TIMESTAMP)',
      [id(4000), 'custom', 'Symétrie incohérente', 'other']), /RelationType_symmetric_inverse_check/)
    await assert.rejects(db.query('INSERT INTO "RelationType" (id,code,label,"inverseCode","updatedAt") VALUES ($1,$2,$3,$4,CURRENT_TIMESTAMP)',
      [id(4000), 'custom', 'Inverse incohérent', 'custom']), /RelationType_distinct_codes_check/)
  } finally { await db.close() }
})
