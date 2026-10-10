import { Prisma, type PrismaClient } from '../prisma-client/client.ts'
import { readIngestionAssociation, type AssociationActor } from './association.js'
import { createIngestionProposalInTransaction } from './proposal.js'
import { proposalReceipt } from './proposal-common.js'
import { ingestionProposalSchema, type IngestionProposalInput } from './proposal-validation.js'
import { canonicalPromotionJson, MAX_PROMOTION_NOTES, PromotionError, promotionNoteFingerprint,
  type PromotionNote, type PromotionRepository, type PromotionSource } from './promotion.js'

const MAX_PLAN_BYTES = 64 * 1024 * 1024
const MAX_OCCUPIED_SLUGS = 20_000
const sourceSelect = { id: true, kind: true, externalId: true, label: true, visibility: true, updatedAt: true } satisfies Prisma.SourceSelect
type Item = Pick<PromotionNote, 'id' | 'sourceId' | 'identityKey' | 'externalId' | 'version' | 'contentHash'>
async function readSource(tx: Prisma.TransactionClient, externalId: string): Promise<PromotionSource> {
  const source = await tx.source.findUnique({ where: { kind_externalId: { kind: 'OBSIDIAN', externalId } }, select: sourceSelect })
  if (!source || source.kind !== 'OBSIDIAN' || source.externalId !== externalId) throw new PromotionError('SOURCE_NOT_FOUND')
  return { ...source, kind: 'OBSIDIAN', externalId }
}
async function readNote(tx: Prisma.TransactionClient, item: Item): Promise<PromotionNote> {
  const receipt = await tx.ingestionReceipt.findFirst({ where: { itemId: item.id },
    orderBy: [{ ingestedAt: 'desc' }, { ordinal: 'desc' }, { id: 'desc' }], select: { id: true } })
  if (!receipt) throw new PromotionError('RECEIPT_NOT_FOUND')
  const association = await readIngestionAssociation(tx, item)
  const confirmed = association ? await tx.ingestionAssociationDecision.findFirst({ where: { associationId: association.id,
    decision: 'CONFIRMED' }, select: { entityId: true } }) : null
  return { ...item, receipt: await proposalReceipt(tx, item.id, receipt.id),
    associationRevision: association?.revision ?? 0, confirmedEntityId: confirmed?.entityId ?? null }
}
export function createPrismaPromotionRepository(prisma: PrismaClient): PromotionRepository {
  return {
    snapshot: externalId => prisma.$transaction(async tx => {
      // PostgreSQL enforces read-only mode; no Source, staging or editorial write is possible in dry-run.
      await tx.$executeRaw(Prisma.sql`SET TRANSACTION READ ONLY`)
      const source = await readSource(tx, externalId)
      const items = await tx.$queryRaw<Item[]>(Prisma.sql`SELECT DISTINCT ON ("identityKey")
        id, "sourceId", "identityKey", "externalId", version, "contentHash"
        FROM "IngestionItem" WHERE "sourceId" = ${source.id}::uuid
        ORDER BY "identityKey", version DESC LIMIT ${MAX_PROMOTION_NOTES + 1}`)
      if (items.length > MAX_PROMOTION_NOTES) throw new PromotionError('SELECTION_LIMIT')
      const notes: PromotionNote[] = []
      let bytes = 0
      for (const item of items) {
        const note = await readNote(tx, item)
        bytes += Buffer.byteLength(canonicalPromotionJson(note), 'utf8')
        if (bytes > MAX_PLAN_BYTES) throw new PromotionError('PLAN_SIZE_LIMIT')
        notes.push(note)
      }
      const occupiedSlugs = await tx.entity.findMany({ select: { id: true, slug: true }, orderBy: { slug: 'asc' }, take: MAX_OCCUPIED_SLUGS + 1 })
      if (occupiedSlugs.length > MAX_OCCUPIED_SLUGS) throw new PromotionError('SLUG_CATALOG_LIMIT')
      return { source, notes, occupiedSlugs }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 60_000 }),

    create: (source, planned, input: IngestionProposalInput, actor: AssociationActor) => prisma.$transaction(async tx => {
      const currentSource = await readSource(tx, source.externalId)
      if (canonicalPromotionJson(currentSource) !== canonicalPromotionJson(source)) throw new PromotionError('SOURCE_CHANGED')
      if (planned.sourceId !== source.id) throw new PromotionError('SELECTION_INCOMPATIBLE')
      const item = await tx.ingestionItem.findFirst({ where: { sourceId: source.id, identityKey: planned.identityKey },
        orderBy: { version: 'desc' }, select: { id: true, sourceId: true, identityKey: true, externalId: true, version: true, contentHash: true } })
      if (!item || item.id !== planned.id) throw new PromotionError('STAGING_CHANGED')
      const current = await readNote(tx, item)
      // A concurrent human confirmation always wins; never overwrite or create a duplicate.
      if (current.confirmedEntityId) return 'skipped'
      if (promotionNoteFingerprint(current) !== promotionNoteFingerprint(planned)) throw new PromotionError('STAGING_CHANGED')
      const parsed = ingestionProposalSchema.safeParse(input)
      if (!parsed.success || parsed.data.receiptId !== current.receipt.id || parsed.data.expectedRevision !== current.associationRevision) {
        throw new PromotionError('PLAN_INVALID')
      }
      await createIngestionProposalInTransaction(tx, current.id, parsed.data, actor)
      return 'created'
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
  }
}
