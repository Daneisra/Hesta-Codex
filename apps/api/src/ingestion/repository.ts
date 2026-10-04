import { Prisma, type PrismaClient } from '../prisma-client/client.ts'
import type { IngestionInput, IngestionSource } from './format.js'
import type { IngestionSummary } from './service.js'

export type Outcome = 'NEW' | 'UNCHANGED' | 'MODIFIED'
export interface SourceRef { id: string; label: string; url: string | null; authorLabel: string | null }
export interface SnapshotRef { id: string; version: number; contentHash: string; content: string }
export interface IngestionReader {
  findSource(source: IngestionSource): Promise<SourceRef | null>
  latest(sourceId: string, identityKey: string): Promise<SnapshotRef | null>
}
export interface IngestionWriter extends IngestionReader {
  createSource(source: Exclude<IngestionSource, { id: string }>): Promise<string>
  createBatch(label: string, summary: IngestionSummary): Promise<string>
  createItem(batchId: string, sourceId: string, identityKey: string, version: number, hash: string, content: string, externalId: string | null): Promise<string>
  createReceipt(batchId: string, itemId: string, ordinal: number, outcome: Outcome, input: IngestionInput, rawVariant: string | null): Promise<void>
}
export interface IngestionDatabase {
  reader: IngestionReader
  transaction<T>(work: (writer: IngestionWriter) => Promise<T>): Promise<T>
}
function writer(client: Prisma.TransactionClient): IngestionWriter {
  return {
    findSource(source) {
      return client.source.findUnique({ where: 'id' in source ? { id: source.id }
        : { kind_externalId: { kind: source.kind, externalId: source.externalId } },
      select: { id: true, label: true, url: true, authorLabel: true } })
    },
    latest(sourceId, identityKey) {
      return client.ingestionItem.findFirst({ where: { sourceId, identityKey }, orderBy: { version: 'desc' },
        select: { id: true, version: true, contentHash: true, content: true } })
    },
    async createSource(source) {
      const row = await client.source.create({ data: { ...source, publishedAt: source.publishedAt ? new Date(source.publishedAt) : null,
        visibility: 'GM' }, select: { id: true } })
      return row.id
    },
    async createBatch(label, summary) {
      const row = await client.ingestionBatch.create({ data: { label, formatVersion: 1, receivedCount: summary.received,
        newCount: summary.new, unchangedCount: summary.unchanged, modifiedCount: summary.modified, warningCount: summary.warnings }, select: { id: true } })
      return row.id
    },
    async createItem(batchId, sourceId, identityKey, version, contentHash, content, externalId) {
      const row = await client.ingestionItem.create({ data: { batchId, sourceId, identityKey, version, contentHash, content, externalId }, select: { id: true } })
      return row.id
    },
    async createReceipt(batchId, itemId, ordinal, outcome, input, rawVariant) {
      await client.ingestionReceipt.create({ data: { batchId, itemId, ordinal, outcome,
        title: input.title, locator: input.locator, contentType: input.contentType,
        observedAt: input.observedAt ? new Date(input.observedAt) : null,
        metadata: input.metadata === null ? Prisma.DbNull : input.metadata as Prisma.InputJsonObject, rawVariant } })
    },
  }
}

export function createPrismaIngestionDatabase(prisma: PrismaClient): IngestionDatabase {
  return {
    reader: writer(prisma),
    async transaction(work) {
      // Resolve again after a serialization/unique race; never continue in a failed PostgreSQL transaction.
      for (let attempt = 0; ; attempt++) {
        try {
          return await prisma.$transaction(tx => work(writer(tx)), {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 120_000,
          })
        } catch (error) {
          if (attempt >= 2 || !(error instanceof Prisma.PrismaClientKnownRequestError) || !['P2034', 'P2002'].includes(error.code)) throw error
        }
      }
    },
  }
}
