import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { Prisma, type PrismaClient } from '../prisma-client/client.ts'
import { parseIngestionText, type IngestionSource } from './format.js'
import { createPrismaIngestionDatabase } from './repository.js'
import { ingestDocument } from './service.js'

type Source = Exclude<IngestionSource, { id: string }> & { id: string; visibility: string }
type Snapshot = { id: string; batchId: string; sourceId: string; identityKey: string; version: number; contentHash: string; content: string; externalId: string | null }
type State = { sources: Source[]; snapshots: Snapshot[]; batches: string[]; receipts: Array<{ itemId: string; batchId: string; rawVariant: string | null }> }
const origin = { kind: 'OBSIDIAN' as const, label: 'Concurrent fictitious origin', externalId: 'concurrency-fixture', url: null, authorLabel: null, publishedAt: null }
const existingId = '11111111-1111-4111-8111-111111111111'
function fixture(content: string, externalId: string | null, byId = false) {
  const parsed = parseIngestionText(JSON.stringify({ version: 1, batch: { label: 'Concurrent fictitious lot' },
    items: [{ source: byId ? { id: existingId } : origin, externalId, content }] }))
  assert.ok(parsed.success); return parsed.document
}

// An optimistic Serializable model: both first attempts read the same revision,
// only one can commit; retries must rerun the actual service against the new state.
// This exercises Prisma adapter/service interaction, not a live PostgreSQL engine.
function racingDatabase(existing = false, sourceChange?: 'label' | 'delete') {
  let state: State = { sources: existing ? [{ ...origin, id: existingId, visibility: 'GM' }] : [], snapshots: [], batches: [], receipts: [] }
  let revision = 0, attempts = 0, injected = false
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const prisma = {
    async $transaction<T>(work: (tx: unknown) => Promise<T>, options: { isolationLevel: string; timeout: number }) {
      assert.equal(options.isolationLevel, 'Serializable'); assert.equal(options.timeout, 120_000)
      const startedAt = revision, draft = structuredClone(state), attempt = ++attempts
      if (attempt === 2) release()
      if (attempt <= 2) await gate
      const tx = {
        source: {
          async findUnique({ where }: { where: { id?: string; kind_externalId?: { kind: string; externalId: string } } }) {
            return draft.sources.find(row => where.id ? row.id === where.id : row.kind === where.kind_externalId?.kind && row.externalId === where.kind_externalId.externalId) ?? null
          },
          async create({ data }: { data: Omit<Source, 'id'> }) {
            if (draft.sources.some(row => row.kind === data.kind && row.externalId === data.externalId)) throw new Prisma.PrismaClientKnownRequestError('fixture unique race', { code: 'P2002', clientVersion: '7.10.0' })
            const row = { ...data, id: randomUUID() }; draft.sources.push(row); return { id: row.id }
          },
        },
        ingestionBatch: { async create() { const id = randomUUID(); draft.batches.push(id); return { id } } },
        ingestionItem: {
          async findFirst({ where }: { where: { sourceId: string; identityKey: string } }) {
            return draft.snapshots.filter(row => row.sourceId === where.sourceId && row.identityKey === where.identityKey).sort((a, b) => b.version - a.version)[0] ?? null
          },
          async create({ data }: { data: Omit<Snapshot, 'id'> }) {
            if (draft.snapshots.some(row => row.sourceId === data.sourceId && row.identityKey === data.identityKey && row.version === data.version)) throw new Prisma.PrismaClientKnownRequestError('fixture unique race', { code: 'P2002', clientVersion: '7.10.0' })
            const row = { ...data, id: randomUUID() }; draft.snapshots.push(row); return { id: row.id }
          },
        },
        ingestionReceipt: { async create({ data }: { data: State['receipts'][number] }) { draft.receipts.push(data) } },
      }
      const result = await work(tx)
      if (sourceChange && !injected) {
        injected = true
        if (sourceChange === 'delete') state.sources = []
        else state.sources[0]!.label = 'Concurrent fictional correction'
        revision++
      }
      if (revision !== startedAt) throw new Prisma.PrismaClientKnownRequestError('fixture serialization race', { code: 'P2034', clientVersion: '7.10.0' })
      state = draft; revision++; return result
    },
  } as unknown as PrismaClient
  return { database: createPrismaIngestionDatabase(prisma), state: () => state, attempts: () => attempts }
}

for (const scenario of [
  { name: 'same external ID/content and concurrent Source creation', externalId: 'note.md', contents: ['A', 'A'], existing: false, versions: 1 },
  { name: 'same hash with no external ID', externalId: null, contents: ['A', 'A'], existing: true, versions: 1 },
  { name: 'normalized equal raw variants', externalId: 'note.md', contents: ['é\r\nA', 'e\u0301\nA'], existing: true, versions: 1 },
  { name: 'different contents at the same external ID', externalId: 'note.md', contents: ['A', 'B'], existing: true, versions: 2 },
]) test(`Serializable race: ${scenario.name}`, async () => {
  const memory = racingDatabase(scenario.existing)
  const reports = await Promise.all(scenario.contents.map(content => ingestDocument(fixture(content, scenario.externalId), memory.database, false)))
  assert.ok(reports.every(report => report.applied && !report.summary.errors))
  assert.equal(memory.attempts(), 3)
  assert.equal(memory.state().sources.length, 1); assert.equal(memory.state().sources[0]?.visibility, 'GM')
  assert.equal(memory.state().snapshots.length, scenario.versions)
  assert.deepEqual(memory.state().snapshots.map(row => row.version), scenario.versions === 1 ? [1] : [1, 2])
  assert.equal(memory.state().batches.length, 2); assert.equal(memory.state().receipts.length, 2)
  if (scenario.versions === 1) {
    assert.equal(reports.reduce((sum, report) => sum + report.summary.unchanged, 0), 1)
    assert.equal(new Set(memory.state().receipts.map(row => row.itemId)).size, 1)
  } else {
    assert.equal(reports.reduce((sum, report) => sum + report.summary.modified, 0), 1)
    assert.deepEqual(new Set(memory.state().snapshots.map(row => row.content)), new Set(scenario.contents))
  }
  if (scenario.name.includes('variants')) assert.ok(memory.state().receipts.some(row => row.rawVariant !== null))
})

test('concurrent Source correction is retained and fresh plans warn instead of overwriting it', async () => {
  const memory = racingDatabase(true, 'label')
  const reports = await Promise.all([0, 1].map(() => ingestDocument(fixture('A', 'note.md'), memory.database, false)))
  assert.ok(reports.every(report => report.applied && report.summary.warnings === 1))
  assert.equal(memory.state().sources[0]?.label, 'Concurrent fictional correction')
  assert.equal(memory.state().snapshots.length, 1); assert.equal(memory.state().receipts.length, 2)
  assert.equal(memory.attempts(), 5)
})

test('a concurrent Source deletion aborts UUID-based batches without partial writes', async () => {
  const memory = racingDatabase(true, 'delete')
  const reports = await Promise.all([0, 1].map(() => ingestDocument(fixture('A', 'note.md', true), memory.database, false)))
  assert.ok(reports.every(report => !report.applied && report.summary.errors === 1 && report.issues[0]?.path === 'items[0].source.id'))
  assert.equal(memory.state().batches.length, 0); assert.equal(memory.state().snapshots.length, 0); assert.equal(memory.state().receipts.length, 0)
})
