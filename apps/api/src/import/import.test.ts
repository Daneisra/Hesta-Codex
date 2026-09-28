import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { Prisma, type PrismaClient } from '../prisma-client/client.ts'
import { InvalidEncodingError, MissingDatabaseUrlError, runImportCommand } from './command.js'
import type { ImportDocument, ImportEntity, ImportEvidence, ImportRelation } from './format.js'
import type {
  EntityRef, ImportDatabase, ImportReader, ImportWriter, RelationRef, RelationTypeRef, SourceRef,
} from './repository.js'
import { createPrismaImportDatabase } from './repository.js'
import { importDocument } from './service.js'
import { parseImportText } from './validation.js'

const template = {
  version: 1,
  source: { kind: 'MANUAL', label: 'Document technique', externalId: null, url: null, authorLabel: 'Équipe éditoriale' },
  entities: [{
    slug: 'exemple-ville', kind: 'PLACE', placeKind: 'CITY', title: 'Exemple ville',
    summary: 'Fiche de test', bodyMarkdown: 'Texte de test', aliases: [], tags: [],
    evidence: [{ claimText: 'La fiche décrit une ville.' }],
  }],
  relations: [],
}

function rawTemplate(): typeof template { return structuredClone(template) }

function parsed(input: unknown = rawTemplate()): ImportDocument {
  const result = parseImportText(JSON.stringify(input))
  assert.equal(result.success, true, result.success ? '' : JSON.stringify(result.issues))
  return result.document
}

function expectIssue(input: unknown, path: string): void {
  const result = parseImportText(JSON.stringify(input))
  assert.equal(result.success, false)
  if (!result.success) assert.ok(result.issues.some((issue) => issue.path === path), JSON.stringify(result.issues))
}

function withRelation(): Record<string, unknown> {
  const input = rawTemplate() as Record<string, unknown>
  input.entities = [
    template.entities[0],
    { slug: 'exemple-region', kind: 'PLACE', placeKind: 'REGION', title: 'Exemple région', evidence: [{ claimText: 'La fiche décrit une région.' }] },
  ]
  input.relations = [{
    from: 'exemple-ville', to: 'exemple-region', type: 'located_in',
    evidence: [{ claimText: 'La ville est située dans la région.', locator: 'p. 2' }],
  }]
  return input
}

interface StoredEntity extends EntityRef {
  status: string
  visibility: string
  publishedAt: null
  placeKind: string | null
}
interface StoredRelation extends RelationRef {
  fromId: string
  toId: string
  typeId: string
  status: string
  visibility: string
}
interface StoredSource extends SourceRef { kind: string; externalId: string | null }
interface StoredEvidence { sourceId: string; entityId: string | null; relationId: string | null; claimText: string }
interface StoredRevision { entityId: string; number: number; snapshot: Prisma.InputJsonValue }
interface State {
  nextId: number
  entities: StoredEntity[]
  relations: StoredRelation[]
  sources: StoredSource[]
  evidence: StoredEvidence[]
  revisions: StoredRevision[]
}

class FakeDatabase implements ImportDatabase {
  state: State = { nextId: 1, entities: [], relations: [], sources: [], evidence: [], revisions: [] }
  transactionCalls = 0
  failOnRelationCreate = false
  types: RelationTypeRef[] = [
    { id: 'type-located', code: 'located_in', symmetric: false },
    { id: 'type-allied', code: 'allied_with', symmetric: true },
  ]

  get reader(): ImportReader { return this.makeReader(this.state) }

  private makeReader(state: State): ImportReader {
    return {
      async findEntitiesBySlugs(slugs) { return state.entities.filter((entity) => slugs.includes(entity.slug)) },
      findRelationTypesByCodes: async (codes) => this.types.filter((type) => codes.includes(type.code)),
      async findSource(kind, externalId) {
        return state.sources.find((source) => source.kind === kind && source.externalId === externalId) ?? null
      },
      async findRelation(fromId, toId, typeId, symmetric) {
        return state.relations.find((relation) => relation.typeId === typeId && (
          (relation.fromId === fromId && relation.toId === toId) ||
          (symmetric && relation.fromId === toId && relation.toId === fromId)
        )) ?? null
      },
    }
  }

  async transaction<T>(work: (writer: ImportWriter) => Promise<T>): Promise<T> {
    this.transactionCalls += 1
    const state = structuredClone(this.state)
    const id = (prefix: string) => `${prefix}-${state.nextId++}`
    const writer: ImportWriter = {
      ...this.makeReader(state),
      async createSource(source) {
        const created = { ...source, id: id('source'), visibility: undefined }
        state.sources.push(created)
        return { id: created.id }
      },
      async createEntity(entity: ImportEntity) {
        const created: StoredEntity = {
          id: id('entity'), slug: entity.slug, status: 'PROPOSED', visibility: entity.visibility,
          publishedAt: null, placeKind: entity.placeKind ?? null,
        }
        state.entities.push(created)
        return { id: created.id, slug: created.slug }
      },
      async createRevision(entityId, snapshot) {
        state.revisions.push({ entityId, number: 1, snapshot })
      },
      createRelation: async (relation: ImportRelation, fromId, toId, typeId) => {
        if (this.failOnRelationCreate) throw new Error('Injected write failure')
        const created: StoredRelation = {
          id: id('relation'), fromId, toId, typeId, status: 'PROPOSED', visibility: relation.visibility,
        }
        state.relations.push(created)
        return { id: created.id }
      },
      async createEvidence(sourceId, target, evidence: ImportEvidence[]) {
        for (const item of evidence) {
          state.evidence.push({
            sourceId,
            entityId: 'entityId' in target ? target.entityId : null,
            relationId: 'relationId' in target ? target.relationId : null,
            claimText: item.claimText,
          })
        }
      },
    }
    const result = await work(writer)
    this.state = state
    return result
  }
}

test('minimal import is PROPOSED, GM, sourced and revisioned', async () => {
  const database = new FakeDatabase()
  const report = await importDocument(parsed(), database, false)
  assert.equal(report.applied, true)
  assert.deepEqual(report.summary, { source: 1, entitiesNew: 1, entitiesExisting: 0, relationsNew: 0, relationsExisting: 0, errors: 0, warnings: 0 })
  assert.equal(database.state.entities[0]?.status, 'PROPOSED')
  assert.equal(database.state.entities[0]?.visibility, 'GM')
  assert.equal(database.state.entities[0]?.publishedAt, null)
  assert.equal(database.state.sources.length, 1)
  assert.equal(database.state.evidence[0]?.sourceId, database.state.sources[0]?.id)
  assert.equal(database.state.evidence[0]?.entityId, database.state.entities[0]?.id)
  assert.equal(database.state.evidence[0]?.relationId, null)
  assert.equal(database.state.revisions[0]?.entityId, database.state.entities[0]?.id)
  assert.equal(database.state.revisions[0]?.number, 1)
  assert.equal((database.state.revisions[0]?.snapshot as { import: { sourceId: string } }).import.sourceId, database.state.sources[0]?.id)
  assert.deepEqual((database.state.revisions[0]?.snapshot as { entity: Record<string, unknown> }).entity, {
    slug: 'exemple-ville', kind: 'PLACE', placeKind: 'CITY', title: 'Exemple ville',
    summary: 'Fiche de test', bodyMarkdown: 'Texte de test', aliases: [], tags: [],
    status: 'PROPOSED', visibility: 'GM', publishedAt: null,
  })
  assert.equal(JSON.stringify(database.state.revisions[0]?.snapshot).includes('La fiche décrit une ville.'), false)
})

test('PLACE requires placeKind and other kinds reject it', () => {
  const missing = rawTemplate()
  delete (missing.entities[0] as { placeKind?: string }).placeKind
  expectIssue(missing, 'entities[0].placeKind')
  const extra = rawTemplate()
  extra.entities[0].kind = 'PERSON'
  expectIssue(extra, 'entities[0].placeKind')
})

test('duplicate slug in a file is refused before database access', () => {
  const input = rawTemplate()
  input.entities.push({ ...input.entities[0] })
  expectIssue(input, 'entities[1].slug')
})

test('existing slug is a blocking conflict', async () => {
  const database = new FakeDatabase()
  database.state.entities.push({ id: 'existing', slug: 'exemple-ville', status: 'PUBLISHED', visibility: 'PUBLIC', publishedAt: null, placeKind: 'CITY' })
  const report = await importDocument(parsed(), database, false)
  assert.equal(report.applied, false)
  assert.equal(report.summary.entitiesExisting, 1)
  assert.equal(report.issues[0]?.path, 'entities[0].slug')
  assert.equal(database.state.sources.length, 0)
  assert.equal(database.state.revisions.length, 0)
})

test('unknown target slug and RelationType are reported with field paths', async () => {
  const input = withRelation()
  const relations = input.relations as Array<Record<string, unknown>>
  relations[0]!.to = 'absent'
  relations[0]!.type = 'unknown_type'
  const report = await importDocument(parsed(input), new FakeDatabase(), true)
  assert.ok(report.issues.some((issue) => issue.path === 'relations[0].to'))
  assert.ok(report.issues.some((issue) => issue.path === 'relations[0].type'))
})

test('exact duplicate relations and self-relations are refused', async () => {
  const input = withRelation()
  ;(input.relations as unknown[]).push(structuredClone((input.relations as unknown[])[0]))
  const report = await importDocument(parsed(input), new FakeDatabase(), true)
  assert.ok(report.issues.some((issue) => issue.path === 'relations[1]'))
  const self = withRelation()
  ;(self.relations as Array<Record<string, unknown>>)[0]!.to = 'exemple-ville'
  const selfReport = await importDocument(parsed(self), new FakeDatabase(), true)
  assert.ok(selfReport.issues.some((issue) => issue.path === 'relations[0].to'))
})

test('symmetric relations are canonicalized and reverse duplicates are refused', async () => {
  const input = withRelation()
  ;(input.relations as Array<Record<string, unknown>>)[0]!.type = 'allied_with'
  const database = new FakeDatabase()
  const result = await importDocument(parsed(input), database, false)
  assert.equal(result.summary.relationsNew, 1)
  const regionId = database.state.entities.find((entity) => entity.slug === 'exemple-region')?.id
  assert.equal(database.state.relations[0]?.fromId, regionId)

  const duplicate = withRelation()
  duplicate.relations = [
    { from: 'exemple-ville', to: 'exemple-region', type: 'allied_with', evidence: [{ claimText: 'Alliés.' }] },
    { from: 'exemple-region', to: 'exemple-ville', type: 'allied_with', evidence: [{ claimText: 'Alliés.' }] },
  ]
  const duplicateReport = await importDocument(parsed(duplicate), new FakeDatabase(), true)
  assert.ok(duplicateReport.issues.some((issue) => issue.path === 'relations[1]'))
})

test('existing reverse symmetric edge is a conflict', async () => {
  const database = new FakeDatabase()
  database.state.entities.push(
    { id: 'a', slug: 'exemple-ville', status: 'PROPOSED', visibility: 'GM', publishedAt: null, placeKind: 'CITY' },
    { id: 'b', slug: 'exemple-region', status: 'PROPOSED', visibility: 'GM', publishedAt: null, placeKind: 'REGION' },
  )
  database.state.relations.push({ id: 'edge', fromId: 'a', toId: 'b', typeId: 'type-allied', status: 'PROPOSED', visibility: 'GM' })
  const input = { version: 1, source: template.source, entities: [], relations: [{
    from: 'exemple-region', to: 'exemple-ville', type: 'allied_with', evidence: [{ claimText: 'Alliés.' }],
  }] }
  const report = await importDocument(parsed(input), database, false)
  assert.equal(report.summary.relationsExisting, 1)
  assert.equal(report.applied, false)
  assert.equal(database.state.sources.length, 0)
})

test('an existing directed relation is a blocking conflict', async () => {
  const database = new FakeDatabase()
  database.state.entities.push(
    { id: 'city', slug: 'exemple-ville', status: 'PROPOSED', visibility: 'GM', publishedAt: null, placeKind: 'CITY' },
    { id: 'region', slug: 'exemple-region', status: 'PROPOSED', visibility: 'GM', publishedAt: null, placeKind: 'REGION' },
  )
  database.state.relations.push({
    id: 'edge', fromId: 'city', toId: 'region', typeId: 'type-located', status: 'PROPOSED', visibility: 'GM',
  })
  const input = { version: 1, source: template.source, entities: [], relations: [{
    from: 'exemple-ville', to: 'exemple-region', type: 'located_in',
    evidence: [{ claimText: 'Ville dans la région.' }],
  }] }
  const report = await importDocument(parsed(input), database, false)
  assert.equal(report.summary.relationsExisting, 1)
  assert.equal(report.applied, false)
  assert.equal(database.state.relations.length, 1)
  assert.equal(database.state.sources.length, 0)
})

test('a relation can link an existing Entity to a new Entity without updating the existing one', async () => {
  const database = new FakeDatabase()
  database.state.entities.push({
    id: 'existing-region', slug: 'exemple-region', status: 'PROPOSED',
    visibility: 'GM', publishedAt: null, placeKind: 'REGION',
  })
  const input = rawTemplate() as Record<string, unknown>
  input.relations = [{
    from: 'exemple-ville', to: 'exemple-region', type: 'located_in',
    evidence: [{ claimText: 'La ville est située dans la région.' }],
  }]
  const report = await importDocument(parsed(input), database, false)
  assert.equal(report.applied, true)
  assert.equal(database.state.entities.length, 2)
  assert.equal(database.state.relations[0]?.toId, 'existing-region')
  assert.equal(database.state.revisions.length, 1)
  assert.equal(database.state.revisions[0]?.entityId, database.state.entities[1]?.id)
})

test('entity and relation Evidence point to one target and the lot Source', async () => {
  const database = new FakeDatabase()
  await importDocument(parsed(withRelation()), database, false)
  assert.equal(database.state.evidence.length, 3)
  assert.equal(database.state.evidence.filter((item) => item.entityId !== null).length, 2)
  assert.equal(database.state.evidence.filter((item) => item.relationId !== null).length, 1)
  assert.ok(database.state.evidence.every((item) => (item.entityId === null) !== (item.relationId === null)))
  assert.ok(database.state.evidence.every((item) => item.sourceId === database.state.sources[0]?.id))
  assert.equal(database.state.relations[0]?.status, 'PROPOSED')
  assert.equal(database.state.relations[0]?.visibility, 'GM')
})

test('confidence and timestamps are checked before writes', () => {
  for (const confidence of [-0.1, 1.1, 0.1234]) {
    const input = rawTemplate()
    Object.assign(input.entities[0].evidence[0], { confidence })
    expectIssue(input, 'entities[0].evidence[0].confidence')
  }
  const negative = rawTemplate()
  Object.assign(negative.entities[0].evidence[0], { timeStartSeconds: -1 })
  expectIssue(negative, 'entities[0].evidence[0].timeStartSeconds')
  const negativeEnd = rawTemplate()
  Object.assign(negativeEnd.entities[0].evidence[0], { timeEndSeconds: -1 })
  expectIssue(negativeEnd, 'entities[0].evidence[0].timeEndSeconds')
  const reversed = rawTemplate()
  Object.assign(reversed.entities[0].evidence[0], { timeStartSeconds: 10, timeEndSeconds: 9 })
  expectIssue(reversed, 'entities[0].evidence[0].timeEndSeconds')
})

test('evidence is required to keep each imported object traceable', () => {
  const entity = rawTemplate()
  entity.entities[0].evidence = []
  expectIssue(entity, 'entities[0].evidence')
  const relation = withRelation()
  ;(relation.relations as Array<Record<string, unknown>>)[0]!.evidence = []
  expectIssue(relation, 'relations[0].evidence')
})

test('aliases and tags reject empty, invalid and duplicate values without silent deduplication', () => {
  const input = rawTemplate()
  Object.assign(input.entities[0], { aliases: ['Nom', ' nom '], tags: ['archive', 'ARCHIVE'] })
  expectIssue(input, 'entities[0].aliases[1]')
  expectIssue(input, 'entities[0].tags[1]')
  const invalid = rawTemplate()
  Object.assign(invalid.entities[0], { aliases: ['  '], tags: [123] })
  expectIssue(invalid, 'entities[0].aliases[0]')
  expectIssue(invalid, 'entities[0].tags[0]')
})

test('dry-run reads the base and never writes or starts a transaction', async () => {
  const database = new FakeDatabase()
  const before = structuredClone(database.state)
  const report = await importDocument(parsed(withRelation()), database, true)
  assert.equal(report.applied, false)
  assert.equal(report.summary.entitiesNew, 2)
  assert.equal(report.summary.relationsNew, 1)
  assert.equal(database.transactionCalls, 0)
  assert.deepEqual(database.state, before)
})

test('write failure rolls back Source, entities, revisions, relations and Evidence', async () => {
  const database = new FakeDatabase()
  database.failOnRelationCreate = true
  const before = structuredClone(database.state)
  await assert.rejects(importDocument(parsed(withRelation()), database, false), /Injected write failure/)
  assert.deepEqual(database.state, before)
  assert.equal(database.transactionCalls, 1)
})

test('Source is reused only by kind and externalId', async () => {
  const database = new FakeDatabase()
  database.state.sources.push({ id: 'source-existing', kind: 'MANUAL', externalId: 'manual-001', label: 'Document technique', url: null, authorLabel: 'Équipe éditoriale' })
  const input = rawTemplate()
  Object.assign(input.source, { externalId: 'manual-001' })
  const report = await importDocument(parsed(input), database, false)
  assert.equal(report.sourceAction, 'reused')
  assert.equal(database.state.sources.length, 1)
  assert.equal(database.state.evidence[0]?.sourceId, 'source-existing')
  assert.equal((database.state.revisions[0]?.snapshot as { import: { sourceId: string } }).import.sourceId, 'source-existing')
  assert.equal(JSON.stringify(database.state.revisions[0]?.snapshot).includes('manual-001'), false)
})

test('existing Source with differing descriptive fields is reused with a warning and never overwritten', async () => {
  const database = new FakeDatabase()
  database.state.sources.push({
    id: 'source-existing', kind: 'MANUAL', externalId: 'manual-001',
    label: 'Libellé original', url: null, authorLabel: 'Auteur original',
  })
  const original = structuredClone(database.state.sources[0])
  const input = rawTemplate()
  Object.assign(input.source, { externalId: 'manual-001' })
  const dryRun = await importDocument(parsed(input), database, true)
  assert.equal(dryRun.sourceAction, 'reused')
  assert.equal(dryRun.summary.warnings, 1)
  assert.equal(dryRun.warnings[0]?.path, 'source')
  assert.deepEqual(database.state.sources[0], original)
  const applied = await importDocument(parsed(input), database, false)
  assert.equal(applied.summary.warnings, 1)
  assert.deepEqual(database.state.sources[0], original)
  assert.equal(database.state.evidence[0]?.sourceId, 'source-existing')
})

test('Source without externalId is never deduplicated on its label', async () => {
  const database = new FakeDatabase()
  database.state.sources.push({ id: 'source-existing', kind: 'MANUAL', externalId: null, label: 'Document technique', url: null, authorLabel: 'Équipe éditoriale' })
  const report = await importDocument(parsed(), database, false)
  assert.equal(report.sourceAction, 'new')
  assert.equal(database.state.sources.length, 2)
})

test('source externalId and relation code are never silently trimmed', () => {
  const source = rawTemplate()
  Object.assign(source.source, { externalId: ' manual-001 ' })
  expectIssue(source, 'source.externalId')
  const relation = withRelation()
  ;(relation.relations as Array<Record<string, unknown>>)[0]!.type = ' located_in '
  expectIssue(relation, 'relations[0].type')
})

test('unsupported version, unknown fields and publication status are refused', () => {
  const version = rawTemplate()
  version.version = 2
  expectIssue(version, 'version')
  const publication = rawTemplate()
  Object.assign(publication.entities[0], { status: 'PUBLISHED' })
  expectIssue(publication, 'entities[0].status')
  const unknown = rawTemplate()
  Object.assign(unknown, { extra: true })
  expectIssue(unknown, 'extra')
})

test('empty files, empty lots and non-finite JSON numbers are refused', () => {
  const empty = parseImportText('')
  assert.equal(empty.success, false)
  if (!empty.success) assert.equal(empty.issues[0]?.path, '$')
  const emptyLot = rawTemplate() as Record<string, unknown>
  emptyLot.entities = []
  delete emptyLot.relations
  expectIssue(emptyLot, 'entities')
  const hugeNumber = JSON.stringify(rawTemplate()).replace(
    '"claimText":"La fiche décrit une ville."',
    '"claimText":"La fiche décrit une ville.","confidence":1e999',
  )
  const result = parseImportText(hugeNumber)
  assert.equal(result.success, false)
  if (!result.success) assert.ok(result.issues.some((issue) => issue.path === 'entities[0].evidence[0].confidence'))
  const notJson = parseImportText('{"confidence":NaN}')
  assert.equal(notJson.success, false)
})

test('UTF-8 BOM from a Windows editor is accepted', () => {
  const result = parseImportText(`\uFEFF${JSON.stringify(rawTemplate())}`)
  assert.equal(result.success, true)
})

test('the documented technical template passes a dry-run without writes', async () => {
  const file = resolve(import.meta.dirname, '../../../../examples/lore-import.template.json')
  const parsedTemplate = parseImportText(readFileSync(file, 'utf8'))
  assert.equal(parsedTemplate.success, true, parsedTemplate.success ? '' : JSON.stringify(parsedTemplate.issues))
  const database = new FakeDatabase()
  const report = await importDocument(parsedTemplate.document, database, true)
  assert.equal(report.summary.errors, 0)
  assert.equal(report.summary.entitiesNew, 2)
  assert.equal(report.summary.relationsNew, 1)
  assert.equal(database.transactionCalls, 0)
  assert.equal(database.state.entities.length, 0)
  assert.equal(database.state.sources.length, 0)
})

test('CLI valid dry-run and invalid file use a fake base, without leaking connection data', async () => {
  const database = new FakeDatabase()
  const lines: string[] = []
  let opened = 0
  let closed = 0
  const dependencies = {
    readText: async () => JSON.stringify(rawTemplate()),
    openDatabase: async () => {
      opened += 1
      return { database, close: async () => { closed += 1 } }
    },
    write: (line: string) => { lines.push(line) },
  }
  assert.equal(await runImportCommand(['example.json', '--dry-run'], dependencies), 0)
  assert.equal(opened, 1)
  assert.equal(closed, 1)
  assert.equal(database.state.sources.length, 0)
  assert.ok(lines.some((line) => line === 'Fiches nouvelles : 1'))
  assert.equal(lines.join('\n').includes('DATABASE_URL'), false)

  lines.length = 0
  assert.equal(await runImportCommand(['invalid.json', '--dry-run'], {
    ...dependencies, readText: async () => '{invalid',
  }), 1)
  assert.equal(opened, 1)
  assert.ok(lines.some((line) => line.startsWith('ERREUR $ : JSON invalide')))
})

test('CLI returns safe nonzero errors for missing file, configuration and database failure', async () => {
  const lines: string[] = []
  const write = (line: string) => { lines.push(line) }
  let opened = 0
  assert.equal(await runImportCommand(['absent.json', '--dry-run'], {
    readText: async () => { throw new Error('ENOENT') },
    openDatabase: async () => { opened += 1; throw new Error('Unexpected open') },
    write,
  }), 1)
  assert.equal(opened, 0)
  assert.ok(lines.includes('Fichier introuvable ou illisible.'))

  lines.length = 0
  assert.equal(await runImportCommand(['invalid-encoding.json', '--dry-run'], {
    readText: async () => { throw new InvalidEncodingError() },
    openDatabase: async () => { opened += 1; throw new Error('Unexpected open') },
    write,
  }), 1)
  assert.equal(opened, 0)
  assert.ok(lines.includes('Encodage du fichier invalide : UTF-8 attendu.'))

  lines.length = 0
  const readText = async () => JSON.stringify(rawTemplate())
  assert.equal(await runImportCommand(['valid.json', '--dry-run'], {
    readText,
    openDatabase: async () => { throw new MissingDatabaseUrlError() },
    write,
  }), 1)
  assert.ok(lines.some((line) => line.startsWith('DATABASE_URL absente')))

  lines.length = 0
  const secret = 'postgresql://dummy:dummy@db.invalid/test'
  assert.equal(await runImportCommand(['valid.json', '--dry-run'], {
    readText,
    openDatabase: async () => { throw new Error(secret) },
    write,
  }), 1)
  assert.equal(lines.join('\n').includes(secret), false)
})

test('CLI applied import returns zero and closes its database connection', async () => {
  const database = new FakeDatabase()
  let closed = 0
  const result = await runImportCommand(['valid.json'], {
    readText: async () => JSON.stringify(rawTemplate()),
    openDatabase: async () => ({ database, close: async () => { closed += 1 } }),
    write: () => {},
  })
  assert.equal(result, 0)
  assert.equal(database.state.entities.length, 1)
  assert.equal(closed, 1)
})

test('CLI reports disconnect failure without leaking the database error', async () => {
  const database = new FakeDatabase()
  const lines: string[] = []
  const secret = 'postgresql://dummy:dummy@db.invalid/test'
  const result = await runImportCommand(['valid.json'], {
    readText: async () => JSON.stringify(rawTemplate()),
    openDatabase: async () => ({ database, close: async () => { throw new Error(secret) } }),
    write: (line) => { lines.push(line) },
  })
  assert.equal(result, 1)
  assert.equal(database.state.entities.length, 1)
  assert.ok(lines.some((line) => line.includes('fermeture de la connexion')))
  assert.ok(lines.some((line) => line.includes('Import appliqué')))
  assert.equal(lines.join('\n').includes(secret), false)
})

test('Prisma adapter runs every import read and write through its transaction client', async () => {
  const calls: string[] = []
  const transactionClient = {
    entity: {
      findMany: async () => { calls.push('entity.findMany'); return [] },
      create: async ({ data }: { data: { slug: string; status: string; visibility: string; publishedAt: null } }) => {
        assert.equal(data.status, 'PROPOSED')
        assert.equal(data.visibility, 'GM')
        assert.equal(data.publishedAt, null)
        calls.push('entity.create'); return { id: data.slug, slug: data.slug }
      },
    },
    relationType: {
      findMany: async () => { calls.push('relationType.findMany'); return [{ id: 'type-located', code: 'located_in', symmetric: false }] },
    },
    source: {
      create: async ({ data }: { data: { visibility: string } }) => {
        assert.equal(data.visibility, 'GM')
        calls.push('source.create'); return { id: 'source-1' }
      },
    },
    relation: {
      create: async ({ data }: { data: { status: string; visibility: string; fromEntityId: string; toEntityId: string } }) => {
        assert.equal(data.status, 'PROPOSED')
        assert.equal(data.visibility, 'GM')
        assert.equal(data.fromEntityId, 'exemple-ville')
        assert.equal(data.toEntityId, 'exemple-region')
        calls.push('relation.create'); return { id: 'relation-1' }
      },
    },
    evidence: {
      createMany: async ({ data }: { data: Array<{ sourceId: string; entityId: string | null; relationId: string | null }> }) => {
        assert.ok(data.every((item) => item.sourceId === 'source-1'))
        assert.ok(data.every((item) => (item.entityId === null) !== (item.relationId === null)))
        calls.push('evidence.createMany')
      },
    },
    revision: {
      create: async ({ data }: { data: { number: number; editorLabel: string; snapshot: Record<string, unknown> } }) => {
        assert.equal(data.number, 1)
        assert.equal(data.editorLabel, 'Import CLI Hesta Codex')
        assert.ok(data.snapshot.entity)
        calls.push('revision.create')
      },
    },
  }
  const prisma = {
    $transaction: async (
      work: (client: typeof transactionClient) => Promise<unknown>,
      options: { isolationLevel: string },
    ) => {
      assert.equal(options.isolationLevel, Prisma.TransactionIsolationLevel.Serializable)
      return work(transactionClient)
    },
  } as unknown as PrismaClient
  const report = await importDocument(parsed(withRelation()), createPrismaImportDatabase(prisma), false)
  assert.equal(report.applied, true)
  assert.deepEqual(calls, [
    'entity.findMany', 'relationType.findMany', 'source.create',
    'entity.create', 'evidence.createMany', 'revision.create',
    'entity.create', 'evidence.createMany', 'revision.create',
    'relation.create', 'evidence.createMany',
  ])
})

test('Prisma adapter dry-run uses only SELECT methods and never opens a transaction', async () => {
  const calls: string[] = []
  const prisma = {
    $transaction: async () => { throw new Error('Transaction forbidden in dry-run') },
    entity: {
      findMany: async () => { calls.push('entity.findMany'); return [] },
      create: async () => { throw new Error('Entity write forbidden') },
    },
    relationType: {
      findMany: async () => { calls.push('relationType.findMany'); return [] },
    },
    source: {
      create: async () => { throw new Error('Source write forbidden') },
    },
  } as unknown as PrismaClient
  const report = await importDocument(parsed(), createPrismaImportDatabase(prisma), true)
  assert.equal(report.summary.errors, 0)
  assert.equal(report.applied, false)
  assert.deepEqual(calls, ['entity.findMany'])
})
