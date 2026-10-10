import type { IngestionProposalCreated, IngestionProposalPreparation } from '@hesta-codex/shared'
import { Prisma, type PrismaClient } from '../prisma-client/client.ts'
import { EditorialError, entitySnapshot } from '../admin/editorial.js'
import { createProposedEntity } from '../admin/manual.js'
import { createInitialEvidence, resolveCreationSource } from '../admin/creation-provenance.js'
import { advanceIngestionAssociation, associationActorFields, associationEntity, readIngestionAssociation,
  type AssociationActor } from './association.js'
import type { IngestionProposalInput } from './proposal-validation.js'
import { proposalIdentity, proposalReceipt, receiptProposal, provenanceVisibility, ingestionTrace } from './proposal-common.js'

export interface IngestionProposalService {
  prepare(itemId: string, receiptId: string): Promise<IngestionProposalPreparation>
  create(itemId: string, input: IngestionProposalInput, actor: AssociationActor): Promise<IngestionProposalCreated>
}
const stale = () => new EditorialError(409, 'STALE_INGESTION_STATE', 'L’identité a changé. Revenez à l’item et vérifiez son association.')
const associated = () => new EditorialError(409, 'ASSOCIATION_CONFLICT', 'Cette identité possède déjà une fiche associée. Revenez à l’item.')
async function context(tx: Prisma.TransactionClient, itemId: string, receiptId: string) {
  const item = await proposalIdentity(tx, itemId, receiptId)
  const root = await readIngestionAssociation(tx, item)
  if (root && await tx.ingestionAssociationDecision.findFirst({ where: { associationId: root.id, decision: 'CONFIRMED' }, select: { entityId: true } })) throw associated()
  const source = await tx.source.findUnique({ where: { id: item.sourceId }, select: { id: true, label: true, kind: true, visibility: true } })
  if (!source) throw new EditorialError(404, 'SOURCE_NOT_FOUND', 'Source introuvable.')
  return { item, root, source }
}
export function createPrismaIngestionProposalService(prisma: PrismaClient): IngestionProposalService {
  return {
    prepare: (itemId, receiptId) => prisma.$transaction(async tx => {
      const { root, source } = await context(tx, itemId, receiptId)
      const receipt = await proposalReceipt(tx, itemId, receiptId)
      const proposed = receiptProposal(receipt)
      return { receiptId, expectedRevision: root?.revision ?? 0, source: { label: source.label, kind: source.kind, visibility: source.visibility },
        title: receipt.title ?? '', bodyMarkdown: proposed.contentSupported ? proposed.content : '', tags: proposed.tags,
        sourceExcerpt: proposed.sourceExcerpt, locator: proposed.locator, warnings: proposed.warnings }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }),
    async create(itemId, input, actor) {
      try {
        return await prisma.$transaction(tx => createIngestionProposalInTransaction(tx, itemId, input, actor),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
      } catch (error) {
        if (error instanceof EditorialError && error.code === 'ASSOCIATION_MODIFIED') throw stale()
        if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) throw stale()
        throw error
      }
    },
  }
}

// Shared by the human API and the approved batch CLI; the caller owns the transaction.
export async function createIngestionProposalInTransaction(tx: Prisma.TransactionClient, itemId: string,
  input: IngestionProposalInput, actor: AssociationActor): Promise<IngestionProposalCreated> {
  const { item, root, source } = await context(tx, itemId, input.receiptId)
  if ((root?.revision ?? 0) !== input.expectedRevision) throw stale()
  if (await tx.entity.findUnique({ where: { slug: input.entity.slug }, select: { id: true } })) {
    throw new EditorialError(409, 'ENTITY_CONFLICT', 'Ce slug est déjà utilisé par une fiche.')
  }
  await resolveCreationSource(tx, { mode: 'existing', sourceId: source.id })
  const reserved = await advanceIngestionAssociation(tx, item, root, input.expectedRevision)
  const entity = await createProposedEntity(tx, input.entity)
  const evidenceVisibility = provenanceVisibility(input.entity.visibility, source.visibility)
  const evidenceId = await createInitialEvidence(tx, source.id, { entityId: entity.id, relationId: null }, {
    ...input.evidence, sourceExcerpt: input.evidence.sourceExcerpt ?? null, locator: input.evidence.locator ?? null,
    confidence: null, timeStartSeconds: null, timeEndSeconds: null, visibility: evidenceVisibility,
  }, true)
  const receipt = await tx.ingestionReceipt.findFirst({ where: { id: input.receiptId, itemId },
    select: { id: true, locator: true, observedAt: true, ingestedAt: true, item: { select: { version: true } } } })
  if (!receipt) throw new EditorialError(404, 'INGESTION_ITEM_NOT_FOUND', 'Item ou réception introuvable.')
  const attribution = associationActorFields(actor)
  await tx.revision.create({ data: { entityId: entity.id, number: 1, editorLabel: attribution.authorLabel,
    message: 'Création depuis l’ingestion', snapshot: { ...entitySnapshot(entity) as Prisma.InputJsonObject,
      ingestion: ingestionTrace(item, receipt, source.id, evidenceId) } } })
  await tx.ingestionAssociationDecision.create({ data: { associationId: reserved.id, entityId: entity.id,
    decision: 'CONFIRMED', origin: 'MANUAL', ...attribution } })
  return { entity: associationEntity(entity) }
}
