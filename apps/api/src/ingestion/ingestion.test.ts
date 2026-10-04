import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'
import { Prisma, type PrismaClient } from '../prisma-client/client.ts'
import { contentHash, MAX_CONTENT_BYTES, MAX_INGEST_BYTES, parseIngestionText, type IngestionDocument, type IngestionInput } from './format.js'
import { createPrismaIngestionDatabase, type IngestionDatabase, type IngestionWriter } from './repository.js'
import { ingestDocument } from './service.js'
import { IngestionFileTooLargeError, runIngestionCommand } from './command.js'
import { InvalidEncodingError, MissingDatabaseUrlError } from '../import/command.js'

const sourceId = '11111111-1111-4111-8111-111111111111'
const source = { kind: 'OBSIDIAN', label: 'Origine fictive', externalId: 'test-vault' }
const input = (content = 'Texte fictif\r\nExact.', externalId: string | null = 'note.md') => ({ source, externalId, content, title: 'Test', metadata: { fictional: true } })
function document(items: unknown[] = [input()]): IngestionDocument {
  const parsed = parseIngestionText(JSON.stringify({ version: 1, batch: { label: 'Lot fictif' }, items }))
  assert.equal(parsed.success, true)
  if (!parsed.success) throw new Error('Invalid fixture')
  return parsed.document
}
function memoryDatabase(failure?: 'source' | 'batch' | 'item' | 'receipt') {
  type State = { sources: Array<{ id: string; kind: string; externalId: string | null; label: string; url: string | null; authorLabel: string | null }>;
    batches: string[]; snapshots: Array<{ id: string; sourceId: string; identityKey: string; version: number; contentHash: string; content: string }>;
    receipts: Array<{ itemId: string; batchId: string; ordinal: number; outcome: string; rawVariant: string | null; input: IngestionInput }> }
  let state: State = { sources: [], batches: [], snapshots: [], receipts: [] }
  let transactions = 0
  const writer = (value: State): IngestionWriter => ({
    async findSource(selection) { return value.sources.find(row => 'id' in selection ? row.id === selection.id : row.kind === selection.kind && row.externalId === selection.externalId) ?? null },
    async latest(id, key) { return value.snapshots.filter(row => row.sourceId === id && row.identityKey === key).sort((a, b) => b.version - a.version)[0] ?? null },
    async createSource(selection) { if (failure === 'source') throw new Error('private source failure'); const id = randomUUID(); value.sources.push({ ...selection, id }); return id },
    async createBatch() { if (failure === 'batch') throw new Error('private batch failure'); const id = randomUUID(); value.batches.push(id); return id },
    async createItem(batchId, sourceId, identityKey, version, contentHash, content) {
      void batchId
      if (failure === 'item') throw new Error('private item failure')
      const id = randomUUID(); value.snapshots.push({ id, sourceId, identityKey, version, contentHash, content }); return id
    },
    async createReceipt(batchId, itemId, ordinal, outcome, input, rawVariant) {
      if (failure === 'receipt' && ordinal === 1) throw new Error('private receipt failure')
      value.receipts.push({ batchId, itemId, ordinal, outcome, input, rawVariant })
    },
  })
  const database: IngestionDatabase = { get reader() { return writer(state) }, async transaction(work) {
    transactions++
    const draft = structuredClone(state), result = await work(writer(draft))
    state = draft; return result
  } }
  return { database, state: () => state, transactions: () => transactions, addExistingSource: () => state.sources.push({ id: sourceId, kind: 'MANUAL', externalId: null, label: 'Source existante fictive', url: null, authorLabel: null }) }
}

test('ingestion validates version, empty content, Source, URLs, dates, metadata and unknown fields with safe paths', () => {
  const valid = { version: 1, batch: { label: 'Fictif' }, items: [input()] }
  const invalids = [ { ...valid, version: 2 }, { ...valid, items: [{ ...input(), content: ' \r\n' }] },
    { ...valid, items: [{ ...input(), source: { ...source, kind: 'UNKNOWN' } }] },
    { ...valid, items: [{ ...input(), source: { ...source, url: 'javascript:alert(1)' } }] },
    { ...valid, items: [{ ...input(), source: { ...source, url: 'https://user:password@example.invalid' } }] },
    { ...valid, items: [{ ...input(), source: { ...source, url: 'bad-url' } }] },
    { ...valid, items: [{ ...input(), observedAt: '2026-02-30T00:00:00Z' }] },
    { ...valid, items: [{ ...input(), metadata: { payload: 'x'.repeat(17_000) } }] },
    { ...valid, items: [{ ...input(), published: true }] },
    { ...valid, items: [{ ...input(), source: { ...source, visibility: 'PUBLIC' } }] },
  ]
  for (const invalid of invalids) { const result = parseIngestionText(JSON.stringify(invalid)); assert.equal(result.success, false); if (!result.success) assert.ok(result.issues[0]?.path) }
  const empty = parseIngestionText(JSON.stringify({ ...valid, items: [{ ...input(), content: '' }] }))
  assert.ok(!empty.success && empty.issues.some(issue => issue.path === 'items[0].content'))
  assert.equal(parseIngestionText('{').success, false)
  assert.equal(parseIngestionText(JSON.stringify(valid)).success, true)
  const urlError = parseIngestionText(JSON.stringify({ ...valid, items: [{ ...input(), source: { ...source, url: 'bad-url' } }] }))
  assert.ok(!urlError.success && urlError.issues.some(issue => issue.path === 'items[0].source.url'))
  const unknown = parseIngestionText(JSON.stringify({ ...valid, items: [{ ...input(), status: 'PUBLISHED' }] }))
  assert.ok(!unknown.success && unknown.issues.some(issue => issue.path === 'items[0].status'))
  const credentialAsKey = 'ghp_' + 'a'.repeat(30) // Artificial credential pattern; never a real token.
  const sensitiveKey = parseIngestionText(JSON.stringify({ ...valid, [credentialAsKey]: true }))
  assert.ok(!sensitiveKey.success && sensitiveKey.issues.some(issue => issue.path === '[champ]'))
  assert.equal(JSON.stringify(sensitiveKey).includes(credentialAsKey), false)
  assert.equal(parseIngestionText(JSON.stringify({ ...valid, items: [{ ...input(), metadata: { [credentialAsKey]: true } }] })).success, false)
})

test('ingestion bounds UTF-8 bytes, item count, metadata depth and rejects null/lone surrogate text and credential payloads', () => {
  for (const item of [{ ...input(), content: 'é'.repeat(MAX_CONTENT_BYTES) }, { ...input(), content: '\0' },
    { ...input(), content: '\ud800' }, { ...input(), externalId: 'é'.repeat(600) },
    { ...input(), observedAt: '0000-01-01T00:00:00Z' }, { ...input(), metadata: { ['nul\0key']: 1 } },
    { ...input(), metadata: { nested: { access_token: 'fake-credential' } } },
    { ...input(), source: { ...source, url: 'https://example.invalid/?token=fake' } },
    { ...input(), content: '-----BEGIN PRIVATE KEY-----\nfixture-only' },
    { ...input(), contentType: `sk-${'a'.repeat(30)}/plain` }, // Artificial credential pattern.
    { ...input(), source: { kind: 'MANUAL', label: 'No identity' } }]) {
    assert.equal(parseIngestionText(JSON.stringify({ version: 1, batch: { label: 'Fictif' }, items: [item] })).success, false)
  }
  assert.equal(parseIngestionText(' '.repeat(MAX_INGEST_BYTES + 1)).success, false)
  assert.equal(parseIngestionText(JSON.stringify({ version: 1, batch: { label: 'Fictif' }, items: Array(501).fill(input()) })).success, false)
  let nested: unknown = {}
  for (let i = 0; i < 30; i++) nested = { child: nested }
  assert.equal(parseIngestionText(JSON.stringify({ version: 1, batch: { label: 'Fictif' }, items: [{ ...input(), metadata: nested }] })).success, false)
})

test('content hash normalizes only line endings and Unicode NFC, retaining meaningful whitespace', () => {
  assert.equal(contentHash('é\r\na\rb'), contentHash('e\u0301\na\nb'))
  assert.notEqual(contentHash('a '), contentHash('a'))
  assert.equal(contentHash('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})

test('first ingest creates staging only; repeat is unchanged; changed/reverted contents produce immutable versions', async () => {
  const memory = memoryDatabase(), first = document()
  const initial = await ingestDocument(first, memory.database, false)
  assert.equal(initial.summary.new, 1); assert.ok(initial.batchId)
  const original = structuredClone(memory.state().snapshots[0])
  const repeated = await ingestDocument(first, memory.database, false)
  assert.equal(repeated.summary.unchanged, 1); assert.equal(memory.state().snapshots.length, 1)
  const changed = await ingestDocument(document([input('Contenu différent.')]), memory.database, false)
  assert.equal(changed.summary.modified, 1)
  const reverted = await ingestDocument(first, memory.database, false)
  assert.equal(reverted.summary.modified, 1)
  assert.deepEqual(memory.state().snapshots[0], original)
  assert.deepEqual(memory.state().snapshots.map(row => row.version), [1, 2, 3])
  assert.equal(memory.state().batches.length, 4); assert.equal(memory.state().receipts.length, 4)
})

test('no external item ID deduplicates by Source/hash; different Sources remain separate', async () => {
  const memory = memoryDatabase(), data = document([input('Anonyme.', null), input('Anonyme.', null),
    { ...input('Anonyme.', null), source: { ...source, externalId: 'another-vault' } }])
  const report = await ingestDocument(data, memory.database, false)
  assert.equal(report.summary.new, 2); assert.equal(report.summary.unchanged, 1)
  assert.equal(memory.state().sources.length, 2); assert.equal(memory.state().snapshots.length, 2)
  assert.equal(memory.state().receipts[0]?.itemId, memory.state().receipts[1]?.itemId)
})

test('an unchanged normalized content retains the exact raw variant and per-observation metadata', async () => {
  const memory = memoryDatabase()
  await ingestDocument(document([input('é\r\nA')]), memory.database, false)
  const second = await ingestDocument(document([{ ...input('e\u0301\nA'), metadata: { fictional: true, sequence: 2 } }]), memory.database, false)
  assert.equal(second.summary.unchanged, 1); assert.equal(second.summary.warnings, 1)
  assert.equal(memory.state().snapshots[0]?.content, 'é\r\nA')
  assert.equal(memory.state().receipts[1]?.rawVariant, 'e\u0301\nA')
  assert.deepEqual(memory.state().receipts[1]?.input.metadata, { fictional: true, sequence: 2 })
})

test('dry-run resolves existing Sources, hashes and changes without transactions or writes', async () => {
  const memory = memoryDatabase(); memory.addExistingSource()
  const data = document([{ ...input(), source: { id: sourceId } }])
  const before = structuredClone(memory.state()), report = await ingestDocument(data, memory.database, true)
  assert.equal(report.summary.sourcesExisting, 1); assert.equal(report.summary.new, 1)
  assert.equal(report.applied, false); assert.equal(report.batchId, null); assert.equal(memory.transactions(), 0)
  assert.deepEqual(memory.state(), before)
  await ingestDocument(data, memory.database, false)
  assert.equal((await ingestDocument(data, memory.database, true)).summary.unchanged, 1)
})

test('conflicting same-identity contents in a batch and missing Sources prevent every write', async () => {
  const memory = memoryDatabase()
  const conflicted = await ingestDocument(document([input('A'), input('B')]), memory.database, false)
  assert.equal(conflicted.summary.errors, 1); assert.equal(conflicted.issues[0]?.path, 'items[1].externalId')
  assert.equal(memory.state().sources.length, 0); assert.equal(memory.state().batches.length, 0)
  const missing = await ingestDocument(document([{ ...input(), source: { id: sourceId } }]), memory.database, false)
  assert.equal(missing.summary.errors, 1); assert.equal(missing.issues[0]?.path, 'items[0].source.id')
  assert.equal(memory.state().sources.length, 0)
})

for (const failure of ['source', 'batch', 'item', 'receipt'] as const) test(`ingestion rolls back the whole lot on ${failure} failure`, async () => {
  const memory = memoryDatabase(failure), before = structuredClone(memory.state())
  await assert.rejects(ingestDocument(document([input(), input('Second', 'second.md')]), memory.database, false))
  assert.deepEqual(memory.state(), before)
})

test('service revalidates tampered inputs before any database access', async () => {
  const memory = memoryDatabase(), value = document()
  value.items[0]!.content = ''
  const report = await ingestDocument(value, memory.database, false)
  assert.equal(report.summary.errors, 1); assert.equal(memory.transactions(), 0)
  for (const invalid of [Infinity, NaN, 1n, new Date(), undefined]) {
    const value = document()
    value.items[0]!.metadata = { invalid }
    const rejected = await ingestDocument(value, memory.database, false)
    assert.equal(rejected.summary.errors, 1)
    assert.equal(rejected.issues[0]?.path, 'items[0].metadata.invalid')
    assert.equal(memory.transactions(), 0)
  }
})

test('a valid file at the 5 MiB boundary survives defaults and service revalidation in dry-run and application', async () => {
  const items = Array.from({ length: 20 }, (_, index) => ({ source, externalId: `large-${index}`, content: 'a'.repeat(MAX_CONTENT_BYTES) }))
  items[19]!.content = ''
  const value = { version: 1, batch: { label: 'Fictif' }, items }
  items[19]!.content = 'b'.repeat(MAX_INGEST_BYTES - Buffer.byteLength(JSON.stringify(value), 'utf8'))
  const file = JSON.stringify(value)
  assert.equal(Buffer.byteLength(file, 'utf8'), MAX_INGEST_BYTES)
  const parsed = parseIngestionText(file)
  assert.ok(parsed.success)
  assert.ok(Buffer.byteLength(JSON.stringify(parsed.document), 'utf8') > MAX_INGEST_BYTES)
  const memory = memoryDatabase()
  const dry = await ingestDocument(parsed.document, memory.database, true)
  assert.equal(dry.summary.new, 20); assert.equal(dry.summary.errors, 0); assert.equal(memory.transactions(), 0)
  const applied = await ingestDocument(parsed.document, memory.database, false)
  assert.equal(applied.summary.new, 20); assert.equal(applied.summary.errors, 0)
  assert.equal(memory.state().snapshots[19]?.content, items[19]!.content)
})

test('wide JSON containers are refused at a precise path before schema traversal', () => {
  for (const payload of [Array(100_000).fill(0), Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`k${i}`, i]))]) {
    const result = parseIngestionText(JSON.stringify({ version: 1, batch: { label: 'Fictif' }, items: [{ ...input(), metadata: { payload } }] }))
    assert.ok(!result.success)
    assert.equal(result.issues[0]?.path, 'items[0].metadata.payload')
  }
})

test('same external ID in distinct Sources stays separate; UUID and descriptor aliases deduplicate one existing Source', async () => {
  const memory = memoryDatabase()
  const result = await ingestDocument(document([input(), { ...input(), source: { ...source, externalId: 'other-origin' } }]), memory.database, false)
  assert.equal(result.summary.new, 2); assert.equal(memory.state().snapshots.length, 2)
  const origin = memory.state().sources[0]!, before = structuredClone(origin)
  const aliases = await ingestDocument(document([{ ...input(), source: { id: origin.id } }, { ...input(), source: { ...source, label: 'Different fictional description' } }]), memory.database, false)
  assert.equal(aliases.summary.sourcesExisting, 1); assert.equal(aliases.summary.unchanged, 2)
  assert.equal(aliases.summary.warnings, 1); assert.deepEqual(memory.state().sources[0], before)
  const invalid = await ingestDocument(document([input('Another', 'other.md'), { ...input(), source: { id: sourceId } }]), memory.database, false)
  assert.equal(invalid.summary.errors, 1); assert.equal(invalid.issues[0]?.path, 'items[1].source.id')
  assert.equal(memory.state().snapshots.length, 2)
})

test('Prisma staging uses only the transaction client and retries a serialization race from a fresh transaction', async () => {
  const calls: string[] = []; let attempts = 0
  const tx = {
    source: { async findUnique() { calls.push('source.read'); return null }, async create() { calls.push('source.create'); return { id: sourceId } } },
    ingestionBatch: { async create() { calls.push('batch.create'); return { id: randomUUID() } } },
    ingestionItem: { async create() { calls.push('item.create'); return { id: randomUUID() } } },
    ingestionReceipt: { async create() { calls.push('receipt.create') } },
  }
  const prisma = { async $transaction(work: (value: typeof tx) => Promise<unknown>, options: { isolationLevel: string }) {
    assert.equal(options.isolationLevel, 'Serializable')
    attempts++
    if (attempts === 1) throw new Prisma.PrismaClientKnownRequestError('internal SQL', { code: 'P2034', clientVersion: '7.10.0' })
    return work(tx)
  } } as unknown as PrismaClient
  const report = await ingestDocument(document(), createPrismaIngestionDatabase(prisma), false)
  assert.equal(report.applied, true); assert.equal(attempts, 2)
  assert.deepEqual(calls, ['source.read', 'source.create', 'batch.create', 'item.create', 'receipt.create'])
})

test('Prisma dry-run performs reads only, and unique races retry at most three complete transactions', async () => {
  let transactions = 0, reads = 0
  const prisma = { source: { async findUnique() { reads++; return { id: sourceId, label: source.label, url: null, authorLabel: null } } },
    ingestionItem: { async findFirst() { reads++; return null } },
    async $transaction() { transactions++; throw new Prisma.PrismaClientKnownRequestError('internal detail', { code: 'P2002', clientVersion: '7.10.0' }) },
  } as unknown as PrismaClient
  const database = createPrismaIngestionDatabase(prisma)
  const report = await ingestDocument(document(), database, true)
  assert.equal(report.summary.new, 1); assert.equal(reads, 2); assert.equal(transactions, 0)
  await assert.rejects(ingestDocument(document(), database, false))
  assert.equal(transactions, 3)
})

test('CLI reports staging counts without private raw content, connection values or internal errors', async () => {
  const memory = memoryDatabase(), lines: string[] = [], close: string[] = []
  const dependencies = { readText: async () => JSON.stringify(document()), openDatabase: async () => ({ database: memory.database, close: async () => { close.push('closed') } }), write: (line: string) => lines.push(line) }
  assert.equal(await runIngestionCommand(['fixture.json', '--dry-run'], dependencies), 0)
  assert.equal(memory.state().batches.length, 0)
  assert.equal(await runIngestionCommand(['fixture.json'], dependencies), 0)
  assert.equal(close.length, 2); assert.ok(lines.some(line => line.startsWith('Batch créé :')))
  assert.equal(lines.join('\n').includes('Texte fictif'), false)
  lines.length = 0
  assert.equal(await runIngestionCommand(['fixture.json'], { ...dependencies, openDatabase: async () => { throw new Error('postgresql://private/password') } }), 1)
  assert.equal(lines.join('\n').includes('postgresql'), false)
  assert.equal(lines.join('\n').includes('password'), false)
})

test('CLI rejects invalid arguments/files/encoding/format before opening a database and sanitizes close failures', async () => {
  let opened = 0; const lines: string[] = [], memory = memoryDatabase()
  const dependencies = { readText: async () => JSON.stringify(document()), openDatabase: async () => { opened++; return { database: memory.database, close: async () => {} } }, write: (line: string) => lines.push(line) }
  for (const args of [[], ['--help'], ['a', 'b'], ['a', '--dry-run', '--dry-run']]) assert.equal(await runIngestionCommand(args, dependencies), 1)
  for (const error of [new IngestionFileTooLargeError(), new InvalidEncodingError(), new Error('private path')]) {
    assert.equal(await runIngestionCommand(['fixture'], { ...dependencies, readText: async () => { throw error } }), 1)
  }
  assert.equal(await runIngestionCommand(['fixture'], { ...dependencies, readText: async () => '{}' }), 1)
  assert.equal(opened, 0)
  assert.equal(await runIngestionCommand(['fixture'], { ...dependencies, openDatabase: async () => { throw new MissingDatabaseUrlError('private') } }), 1)
  assert.equal(await runIngestionCommand(['fixture'], { ...dependencies, openDatabase: async () => ({ database: memory.database, close: async () => { throw new Error('private credentials') } }) }), 1)
  assert.equal(lines.join('\n').includes('private'), false)
})

test('real CLI rejects malformed UTF-8/oversized files and accepts a BOM without any configured database', async () => {
  const root = fileURLToPath(new URL('../../../../', import.meta.url))
  const directory = await mkdtemp(join(tmpdir(), 'hesta-ingestion-fictional-'))
  const file = join(directory, 'fictional-private-path.json')
  try {
    for (const [bytes, expected] of [
      [Buffer.from([0xff]), 'Encodage invalide'],
      [Buffer.from(''), 'JSON invalide'],
      [Buffer.alloc(MAX_INGEST_BYTES + 1, 32), 'Fichier trop volumineux'],
      [Buffer.from('\ufeff' + JSON.stringify(document())), 'Connexion locale non configurée'],
    ] as const) {
      await writeFile(file, bytes)
      for (const dry of [false, true]) {
        // Empty DATABASE_URL takes precedence over dotenv; no real database can be contacted.
        await assert.rejects(promisify(execFile)(process.execPath, ['--import', 'tsx', 'apps/api/src/ingestion/cli.ts', file, ...(dry ? ['--dry-run'] : [])],
          { cwd: root, env: { ...process.env, DATABASE_URL: '' }, encoding: 'utf8', timeout: 30_000 }), (error: unknown) => {
          const result = error as { code: number; stdout: string; stderr: string }
          assert.equal(result.code, 1); assert.ok(result.stdout.includes(expected))
          assert.equal(result.stderr, ''); assert.equal(result.stdout.includes('fictional-private-path'), false)
          return true
        })
      }
    }
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep), 'Unexpected temporary test path')
    await rm(directory, { recursive: true, force: true })
  }
})

test('ingestion template is fictitious and the migration only creates/alters staging structures', async () => {
  const fixture = await readFile(new URL('../../../../examples/lore-ingestion.template.json', import.meta.url), 'utf8')
  assert.equal(parseIngestionText(fixture).success, true)
  const sql = await readFile(new URL('../../../../prisma/migrations/20261004000000_ingestion_staging/migration.sql', import.meta.url), 'utf8')
  assert.doesNotMatch(sql, /\b(?:DROP|DELETE|TRUNCATE|UPDATE|INSERT)\s+(?:TABLE|FROM|INTO|"(?:Entity|Source|Relation|Evidence|Revision|User|Session)")/i)
  assert.doesNotMatch(sql, /ALTER TABLE "(?:Entity|Source|Relation|Evidence|Revision|User|Session)"/)
  assert.match(sql, /IngestionItem_sourceId_identityKey_version_key/)
  assert.match(sql, /IngestionBatch_counts_check/)
})
