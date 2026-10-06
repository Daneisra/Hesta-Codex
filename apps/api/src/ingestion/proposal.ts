import type { IngestionProposalCreated, IngestionProposalPreparation, Visibility } from '@hesta-codex/shared'
import { Prisma, type PrismaClient } from '../prisma-client/client.ts'
import { EditorialError, entitySnapshot } from '../admin/editorial.js'
import { createProposedEntity } from '../admin/manual.js'
import { createInitialEvidence, resolveCreationSource } from '../admin/creation-provenance.js'
import { manualCreateSchema } from '../admin/manual-validation.js'
import { advanceIngestionAssociation, associationActorFields, associationEntity, readIngestionAssociation,
  readIngestionIdentity, type AssociationActor } from './association.js'
import type { IngestionProposalInput } from './proposal-validation.js'

export interface IngestionProposalService {
  prepare(itemId: string, receiptId: string): Promise<IngestionProposalPreparation>
  create(itemId: string, input: IngestionProposalInput, actor: AssociationActor): Promise<IngestionProposalCreated>
}
const stale = () => new EditorialError(409, 'STALE_INGESTION_STATE', 'L’identité a changé. Revenez à l’item et vérifiez son association.')
const associated = () => new EditorialError(409, 'ASSOCIATION_CONFLICT', 'Cette identité possède déjà une fiche associée. Revenez à l’item.')
async function context(tx: Prisma.TransactionClient, itemId: string, receiptId: string) {
  let item
  try { item = await readIngestionIdentity(tx, itemId, receiptId) }
  catch (error) {
    if (error instanceof EditorialError && error.status === 404) throw new EditorialError(404, 'INGESTION_ITEM_NOT_FOUND', 'Item ou réception introuvable.')
    throw error
  }
  const root = await readIngestionAssociation(tx, item)
  if (root && await tx.ingestionAssociationDecision.findFirst({ where: { associationId: root.id, decision: 'CONFIRMED' }, select: { entityId: true } })) throw associated()
  const source = await tx.source.findUnique({ where: { id: item.sourceId }, select: { id: true, label: true, kind: true, visibility: true } })
  if (!source) throw new EditorialError(404, 'SOURCE_NOT_FOUND', 'Source introuvable.')
  return { item, root, source }
}
const visibilityRank: Visibility[] = ['PUBLIC', 'PLAYERS', 'GM', 'SECRET']
export function createPrismaIngestionProposalService(prisma: PrismaClient): IngestionProposalService {
  return {
    prepare: (itemId, receiptId) => prisma.$transaction(async tx => {
      const { root, source } = await context(tx, itemId, receiptId)
      const receipt = await tx.ingestionReceipt.findFirst({ where: { id: receiptId, itemId }, select: {
        title: true, contentType: true, metadata: true, rawVariant: true, locator: true, item: { select: { content: true } },
      } })
      if (!receipt) throw new EditorialError(404, 'INGESTION_ITEM_NOT_FOUND', 'Item ou réception introuvable.')
      const content = receipt.rawVariant ?? receipt.item.content, warnings: string[] = []
      const supported = ['text/plain', 'text/markdown'].includes(receipt.contentType.toLowerCase())
      if (!supported) warnings.push('Ce format n’est pas repris automatiquement : le contenu éditorial reste vide. Saisissez-le manuellement.')
      const metadata = receipt.metadata && typeof receipt.metadata === 'object' && !Array.isArray(receipt.metadata) ? receipt.metadata : {}
      const parsedTags = manualCreateSchema.shape.entity.shape.tags.safeParse(metadata.tags)
      if ('tags' in metadata && !parsedTags.success) warnings.push('Les tags de metadata sont invalides et n’ont pas été repris.')
      if ((receipt.title?.length ?? 0) > 200) warnings.push('Le titre dépasse 200 caractères : corrigez-le avant création.')
      if (supported && content.length > 100_000) warnings.push('Le contenu dépasse 100 000 caractères : adaptez-le sans modifier le staging.')
      if ((receipt.locator?.length ?? 0) > 250) warnings.push('Le repère dépasse 250 caractères : choisissez un repère court. Le repère original reste dans la Revision.')
      return { receiptId, expectedRevision: root?.revision ?? 0, source: { label: source.label, kind: source.kind, visibility: source.visibility },
        title: receipt.title ?? '', bodyMarkdown: supported ? content : '', tags: parsedTags.success ? parsedTags.data : [],
        sourceExcerpt: supported && content.length <= 100_000 ? content : '', locator: (receipt.locator?.length ?? 0) <= 250 ? receipt.locator : null, warnings }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }),
    async create(itemId, input, actor) {
      try {
        return await prisma.$transaction(async tx => {
          const { item, root, source } = await context(tx, itemId, input.receiptId)
          if ((root?.revision ?? 0) !== input.expectedRevision) throw stale()
          if (await tx.entity.findUnique({ where: { slug: input.entity.slug }, select: { id: true } })) {
            throw new EditorialError(409, 'ENTITY_CONFLICT', 'Ce slug est déjà utilisé par une fiche.')
          }
          await resolveCreationSource(tx, { mode: 'existing', sourceId: source.id })
          const reserved = await advanceIngestionAssociation(tx, item, root, input.expectedRevision)
          const entity = await createProposedEntity(tx, input.entity)
          const evidenceVisibility = visibilityRank[Math.max(visibilityRank.indexOf(input.entity.visibility), visibilityRank.indexOf(source.visibility))]!
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
              ingestion: { itemId, receiptId: receipt.id, sourceId: source.id, evidenceId, contentHash: item.contentHash,
                version: receipt.item.version, locator: receipt.locator, observedAt: receipt.observedAt?.toISOString() ?? null,
                ingestedAt: receipt.ingestedAt.toISOString() } } } })
          await tx.ingestionAssociationDecision.create({ data: { associationId: reserved.id, entityId: entity.id,
            decision: 'CONFIRMED', origin: 'MANUAL', ...attribution } })
          return { entity: associationEntity(entity) }
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
      } catch (error) {
        if (error instanceof EditorialError && error.code === 'ASSOCIATION_MODIFIED') throw stale()
        if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) throw stale()
        throw error
      }
    },
  }
}
