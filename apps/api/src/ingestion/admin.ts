import { Router } from 'express'
import { z } from 'zod'
import type { AdminIngestionBatch, AdminIngestionItem, AdminIngestionItemDetail, IngestionPage, IngestionMatches } from '@hesta-codex/shared'
import { Prisma, type PrismaClient, SourceKind, IngestionOutcome } from '../prisma-client/client.ts'
import { createPrismaIngestionMatcher } from './matching.js'
import { createPrismaIngestionAssociationService, type IngestionAssociationService } from './association.js'
import { createIngestionAssociationRouter } from './association-routes.js'
import { createPrismaIngestionProposalService, type IngestionProposalService } from './proposal.js'
import { createIngestionProposalRouter } from './proposal-routes.js'
import { createPrismaIngestionUpdateService, type IngestionUpdateService } from './update.js'
import { createIngestionUpdateRouter } from './update-routes.js'

const timestamp = z.iso.datetime({ offset: true }).refine(value => Number(value.slice(0, 4)) >= 1)
const baseFilters = z.strictObject({
  sourceKind: z.enum(SourceKind).optional(), sourceId: z.uuid().optional(),
  after: timestamp.optional(), before: timestamp.optional(),
  outcome: z.enum(IngestionOutcome).optional(), q: z.string().trim().min(2).max(100)
    .refine(value => !value.includes('\0') && Buffer.from(value, 'utf8').toString('utf8') === value).optional(),
  page: z.string().regex(/^[1-9]\d{0,2}$|^1000$/).transform(Number).optional().default(1),
})
const validDateRange = (filters: { after?: string; before?: string }) => !filters.after || !filters.before || new Date(filters.after) <= new Date(filters.before)
export const ingestionBatchFilters = baseFilters.refine(validDateRange, 'Intervalle de dates invalide')
export const ingestionItemFilters = baseFilters.extend({ batchId: z.uuid().optional() }).refine(validDateRange, 'Intervalle de dates invalide')
export type BatchFilters = z.infer<typeof ingestionBatchFilters>
export type ItemFilters = z.infer<typeof ingestionItemFilters>
export interface IngestionAdminStore {
  associations?: IngestionAssociationService
  proposals?: IngestionProposalService
  updates?: IngestionUpdateService
  listBatches(filters: BatchFilters): Promise<IngestionPage<AdminIngestionBatch>>
  getBatch(id: string): Promise<AdminIngestionBatch | null>
  listItems(filters: ItemFilters): Promise<IngestionPage<AdminIngestionItem>>
  getItem(id: string, receiptId?: string): Promise<AdminIngestionItemDetail | null>
  getMatches(id: string, receiptId?: string): Promise<IngestionMatches | null>
}
const pageSize = 20
const sourceSelect = { id: true, kind: true, label: true } satisfies Prisma.SourceSelect
const batchSelect = { id: true, label: true, formatVersion: true, receivedCount: true, newCount: true,
  unchangedCount: true, modifiedCount: true, warningCount: true, createdAt: true } satisfies Prisma.IngestionBatchSelect
const itemSummary = { id: true, batchId: true, ordinal: true, outcome: true, title: true, locator: true,
  contentType: true, observedAt: true, ingestedAt: true,
  item: { select: { id: true, externalId: true, version: true, contentHash: true, source: { select: sourceSelect } } },
} satisfies Prisma.IngestionReceiptSelect
type SummaryRow = Prisma.IngestionReceiptGetPayload<{ select: typeof itemSummary }>
const mapItem = (row: SummaryRow): AdminIngestionItem => ({ id: row.id, itemId: row.item.id, batchId: row.batchId,
  ordinal: row.ordinal, outcome: row.outcome, title: row.title, locator: row.locator, contentType: row.contentType,
  observedAt: row.observedAt?.toISOString() ?? null, ingestedAt: row.ingestedAt.toISOString(),
  externalId: row.item.externalId, version: row.item.version, contentHash: row.item.contentHash, source: row.item.source })

function itemWhere(filters: ItemFilters): Prisma.IngestionReceiptWhereInput {
  return {
    ...(filters.batchId ? { batchId: filters.batchId } : {}), ...(filters.outcome ? { outcome: filters.outcome } : {}),
    ...(filters.after || filters.before ? { ingestedAt: { ...(filters.after ? { gte: new Date(filters.after) } : {}), ...(filters.before ? { lte: new Date(filters.before) } : {}) } } : {}),
    item: { ...(filters.sourceId ? { sourceId: filters.sourceId } : {}), ...(filters.sourceKind ? { source: { kind: filters.sourceKind } } : {}) },
    ...(filters.q ? { OR: [ { title: { contains: filters.q, mode: 'insensitive' } }, { locator: { contains: filters.q, mode: 'insensitive' } },
      { item: { externalId: { contains: filters.q, mode: 'insensitive' } } } ] } : {}),
  }
}
export function createPrismaIngestionAdminStore(prisma: PrismaClient): IngestionAdminStore {
  const batches = async (rows: Prisma.IngestionBatchGetPayload<{ select: typeof batchSelect }>[]): Promise<AdminIngestionBatch[]> => {
    if (!rows.length) return []
    const receipts = await prisma.ingestionReceipt.findMany({ where: { batchId: { in: rows.map(row => row.id) } },
      select: { batchId: true, item: { select: { source: { select: sourceSelect } } } }, orderBy: { ordinal: 'asc' } })
    return rows.map(row => {
      const sources = new Map(receipts.filter(receipt => receipt.batchId === row.id).map(receipt => [receipt.item.source.id, receipt.item.source]))
      return { ...row, createdAt: row.createdAt.toISOString(), sourceCount: sources.size,
        sourceKinds: [...new Set([...sources.values()].map(source => source.kind))], sources: [...sources.values()].slice(0, 20) }
    })
  }
  return {
    associations: createPrismaIngestionAssociationService(prisma),
    proposals: createPrismaIngestionProposalService(prisma),
    updates: createPrismaIngestionUpdateService(prisma),
    getMatches: createPrismaIngestionMatcher(prisma),
    async listBatches(filters) {
      const needsReceipts = filters.sourceKind || filters.sourceId || filters.q || filters.outcome
      const where: Prisma.IngestionBatchWhereInput = {
        ...(filters.after || filters.before ? { createdAt: { ...(filters.after ? { gte: new Date(filters.after) } : {}), ...(filters.before ? { lte: new Date(filters.before) } : {}) } } : {}),
        ...(needsReceipts ? { receipts: { some: itemWhere({ ...filters, after: undefined, before: undefined }) } } : {}),
      }
      const [rows, total] = await Promise.all([prisma.ingestionBatch.findMany({ where, select: batchSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (filters.page - 1) * pageSize, take: pageSize }), prisma.ingestionBatch.count({ where })])
      return { items: await batches(rows), total, page: filters.page, pageSize }
    },
    async getBatch(id) {
      const row = await prisma.ingestionBatch.findUnique({ where: { id }, select: batchSelect })
      return row ? (await batches([row]))[0]! : null
    },
    async listItems(filters) {
      const where = itemWhere(filters)
      const [rows, total] = await Promise.all([prisma.ingestionReceipt.findMany({ where, select: itemSummary,
        orderBy: filters.batchId ? [{ ordinal: 'asc' }] : [{ ingestedAt: 'desc' }, { id: 'desc' }],
        skip: (filters.page - 1) * pageSize, take: pageSize }), prisma.ingestionReceipt.count({ where })])
      return { items: rows.map(mapItem), total, page: filters.page, pageSize }
    },
    async getItem(id, receiptId) {
      const row = await prisma.ingestionReceipt.findFirst({ where: { itemId: id, ...(receiptId ? { id: receiptId } : {}) },
        orderBy: [{ ingestedAt: 'desc' }, { ordinal: 'desc' }, { id: 'desc' }], select: {
          ...itemSummary, metadata: true, rawVariant: true, item: { select: { ...itemSummary.item.select, content: true, batchId: true, ingestedAt: true, identityKey: true } },
        } })
      if (!row) return null
      const versions = await prisma.ingestionItem.findMany({ where: { sourceId: row.item.source.id, identityKey: row.item.identityKey },
        orderBy: { version: 'desc' }, take: 20, select: { id: true, version: true, contentHash: true, ingestedAt: true } })
      return { ...mapItem(row), content: row.rawVariant ?? row.item.content, metadata: row.metadata,
        originBatchId: row.item.batchId, snapshotIngestedAt: row.item.ingestedAt.toISOString(),
        versions: versions.map(version => ({ ...version, ingestedAt: version.ingestedAt.toISOString() })) }
    },
  }
}

export function createIngestionAdminRouter(store: IngestionAdminStore) {
  const router = Router()
  if (store.associations) router.use(createIngestionAssociationRouter(store.associations))
  if (store.proposals) router.use(createIngestionProposalRouter(store.proposals))
  if (store.updates) router.use(createIngestionUpdateRouter(store.updates))
  const bad = (response: import('express').Response) => response.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Paramètres d’ingestion invalides.' } })
  const missing = (response: import('express').Response) => response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Élément d’ingestion introuvable.' } })
  const listFilters = (request: import('express').Request) => {
    // Private free-text search must never travel in a URL/access-log query string.
    if (Object.hasOwn(request.query, 'q')) return null
    const values = request.headersDistinct['x-hesta-ingestion-search']
    if (!values) return request.query
    if (values.length !== 1 || values[0]!.length > 1200) return null
    try { return { ...request.query, q: decodeURIComponent(values[0]!) } } catch { return null }
  }
  router.get('/batches', async (request, response) => {
    const parsed = ingestionBatchFilters.safeParse(listFilters(request))
    if (!parsed.success) { bad(response); return }
    response.json(await store.listBatches(parsed.data))
  })
  router.get('/batches/:id', async (request, response) => {
    if (!z.uuid().safeParse(request.params.id).success || Object.keys(request.query).length) { bad(response); return }
    const batch = await store.getBatch(request.params.id)
    if (!batch) { missing(response); return }
    response.json(batch)
  })
  router.get('/items', async (request, response) => {
    const parsed = ingestionItemFilters.safeParse(listFilters(request))
    if (!parsed.success) { bad(response); return }
    response.json(await store.listItems(parsed.data))
  })
  router.get('/items/:id', async (request, response) => {
    const query = z.strictObject({ receiptId: z.uuid().optional() }).safeParse(request.query)
    if (!z.uuid().safeParse(request.params.id).success || !query.success) { bad(response); return }
    const item = await store.getItem(request.params.id, query.data.receiptId)
    if (!item) { missing(response); return }
    response.json(item)
  })
  router.get('/items/:id/matches', async (request, response) => {
    const query = z.strictObject({ receiptId: z.uuid().optional() }).safeParse(request.query)
    if (!z.uuid().safeParse(request.params.id).success || !query.success) { bad(response); return }
    const matches = await store.getMatches(request.params.id, query.data.receiptId)
    if (!matches) { missing(response); return }
    response.json(matches)
  })
  return router
}
