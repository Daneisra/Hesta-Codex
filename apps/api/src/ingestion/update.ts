import type { IngestionUpdateApplied, IngestionUpdatePreparation } from '@hesta-codex/shared'
import { Prisma, type PrismaClient } from '../prisma-client/client.ts'
import { EditorialError, editorialSelect, sameFields, nextUpdatedAt, addRevision } from '../admin/editorial.js'
import { createInitialEvidence } from '../admin/creation-provenance.js'
import { readIngestionAssociation, associationActorFields, associationEntity, type AssociationActor } from './association.js'
import { proposalIdentity, proposalReceipt, receiptProposal, provenanceVisibility, ingestionTrace } from './proposal-common.js'
import type { IngestionUpdateInput } from './update-validation.js'

export interface IngestionUpdateService {
  prepare(itemId: string, receiptId: string): Promise<IngestionUpdatePreparation>
  apply(itemId: string, input: IngestionUpdateInput, actor: AssociationActor): Promise<IngestionUpdateApplied>
}
const modified = () => new EditorialError(409, 'ASSOCIATION_MODIFIED', 'L’association a changé. Rechargez et comparez à nouveau.')
const entityModified = () => new EditorialError(409, 'ENTITY_MODIFIED', 'La fiche a changé. Rechargez et comparez à nouveau.')
const publishedMessage = 'Cette fiche est publiée. Retirez d’abord sa publication avant d’appliquer une mise à jour issue du staging.'
async function context(tx: Prisma.TransactionClient, itemId: string, receiptId: string, expected?: IngestionUpdateInput) {
  const item = await proposalIdentity(tx, itemId, receiptId)
  const root = await readIngestionAssociation(tx, item)
  if (!root) throw new EditorialError(409, 'ASSOCIATION_REQUIRED', 'Une association confirmée est requise.')
  if (expected) {
    if (root.revision !== expected.expectedAssociationRevision) throw modified()
    // Read lock only: v0.7c changes must wait, without modifying its revision/author/date.
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM "IngestionAssociation"
      WHERE id = ${root.id}::uuid AND revision = ${expected.expectedAssociationRevision} FOR SHARE`)
    if (locked.length !== 1) throw modified()
  }
  const confirmed = await tx.ingestionAssociationDecision.findFirst({ where: { associationId: root.id, decision: 'CONFIRMED' }, select: { entityId: true } })
  if (!confirmed) throw new EditorialError(409, 'ASSOCIATION_REQUIRED', 'Une association confirmée est requise.')
  if (expected && confirmed.entityId !== expected.targetEntityId) throw new EditorialError(409, 'ASSOCIATION_TARGET_CHANGED', 'La fiche associée a changé. Rechargez et comparez à nouveau.')
  const entity = await tx.entity.findUnique({ where: { id: confirmed.entityId }, select: editorialSelect })
  if (!entity) throw new EditorialError(404, 'ENTITY_NOT_FOUND', 'Fiche introuvable.')
  if (entity.status === 'ARCHIVED') throw new EditorialError(409, 'INVALID_STATUS', 'Une fiche archivée est en lecture seule.')
  const source = await tx.source.findUnique({ where: { id: item.sourceId }, select: { id: true, label: true, kind: true, visibility: true } })
  if (!source) throw new EditorialError(404, 'SOURCE_NOT_FOUND', 'Source introuvable.')
  const receipt = await proposalReceipt(tx, itemId, receiptId)
  return { item, root, entity, source, receipt }
}
async function applied(tx: Prisma.TransactionClient, entityId: string, receiptId: string) {
  return !!await tx.revision.findFirst({ where: { entityId, AND: [
    { snapshot: { path: ['ingestion', 'action'], equals: 'UPDATE' } },
    { snapshot: { path: ['ingestion', 'receiptId'], equals: receiptId } },
  ] }, select: { id: true } })
}
export function createPrismaIngestionUpdateService(prisma: PrismaClient): IngestionUpdateService {
  return {
    prepare: (itemId, receiptId) => prisma.$transaction(async tx => {
      const { item, root, entity, source, receipt } = await context(tx, itemId, receiptId)
      const proposed = receiptProposal(receipt), warnings = proposed.warnings.map(value => value.replace('avant création', 'avant mise à jour')
        .replace('le contenu éditorial reste vide', 'le contenu actuel de la fiche est conservé'))
      if (entity.status === 'PUBLISHED') warnings.push(publishedMessage)
      const alreadyApplied = await applied(tx, entity.id, receipt.id)
      if (alreadyApplied) warnings.push('Cette réception a déjà été appliquée à cette fiche. Aucune seconde mise à jour depuis ce receipt.')
      return { receiptId: receipt.id, version: receipt.item.version, contentHash: item.contentHash,
        expectedAssociationRevision: root.revision, expectedEntityUpdatedAt: entity.updatedAt.toISOString(), alreadyApplied,
        entity: { ...associationEntity(entity), summary: entity.summary, bodyMarkdown: entity.bodyMarkdown,
          aliases: entity.aliases, tags: entity.tags, publishedAt: entity.publishedAt?.toISOString() ?? null }, source,
        staging: { title: receipt.title, content: proposed.content, contentType: receipt.contentType,
          contentSupported: proposed.contentSupported, tags: proposed.tags, tagsAvailable: proposed.tagsAvailable,
          locator: receipt.locator, observedAt: receipt.observedAt?.toISOString() ?? null },
        evidence: { claimText: `Mise à jour issue de l’item de staging « ${receipt.title ?? 'sans titre'} », provenant de la Source « ${source.label} ».`,
          sourceExcerpt: proposed.sourceExcerpt || null, locator: proposed.locator }, warnings }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }),
    async apply(itemId, input, actor) {
      try {
        return await prisma.$transaction(async tx => {
          const { item, entity, source, receipt } = await context(tx, itemId, input.receiptId, input)
          if (entity.status === 'PUBLISHED') throw new EditorialError(409, 'INVALID_STATUS', publishedMessage)
          if (entity.status !== 'DRAFT' && entity.status !== 'PROPOSED') throw new EditorialError(409, 'INVALID_STATUS', 'Cette fiche ne peut pas être mise à jour depuis le staging.')
          if (entity.updatedAt.getTime() !== new Date(input.expectedEntityUpdatedAt).getTime()) throw entityModified()
          if (await applied(tx, entity.id, receipt.id)) throw new EditorialError(409, 'RECEIPT_ALREADY_APPLIED', 'Cette réception a déjà été appliquée à cette fiche.')
          if (sameFields(entity, input.entity)) throw new EditorialError(422, 'NO_CHANGES', 'Aucun changement éditorial à appliquer.')
          const updatedAt = nextUpdatedAt(entity.updatedAt)
          const changed = await tx.entity.updateMany({ where: { id: entity.id, updatedAt: entity.updatedAt, status: entity.status }, data: { ...input.entity, updatedAt } })
          if (changed.count !== 1) throw entityModified()
          const evidenceId = await createInitialEvidence(tx, source.id, { entityId: entity.id, relationId: null }, {
            ...input.evidence, sourceExcerpt: input.evidence.sourceExcerpt ?? null, locator: input.evidence.locator ?? null,
            visibility: provenanceVisibility(input.entity.visibility, source.visibility), confidence: null, timeStartSeconds: null, timeEndSeconds: null,
          }, true)
          const number = await addRevision(tx, { ...entity, ...input.entity, updatedAt }, associationActorFields(actor).authorLabel,
            'Mise à jour depuis l’ingestion', { ...ingestionTrace(item, receipt, source.id, evidenceId), action: 'UPDATE' })
          return { entity: associationEntity({ ...entity, ...input.entity }), updatedAt: updatedAt.toISOString(), revisionNumber: number }
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) {
          throw new EditorialError(409, 'STALE_INGESTION_STATE', 'Conflit de modification. Rechargez et comparez à nouveau.')
        }
        throw error
      }
    },
  }
}
