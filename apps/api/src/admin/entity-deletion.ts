import { createHash } from 'node:crypto'
import type { AdminEntityDeletionPlan, AdminEntityDeletionRequest } from '@hesta-codex/shared'
import { Prisma, type PrismaClient } from '../prisma-client/client.ts'
import { EditorialError } from './editorial.js'

export interface EntityDeletionService {
  preview(slug: string): Promise<AdminEntityDeletionPlan>
  remove(slug: string, input: AdminEntityDeletionRequest): Promise<void>
}
const conflict = () => new EditorialError(409, 'ENTITY_DELETION_MODIFIED', 'La fiche ou ses dépendances ont changé. Vérifiez un nouveau bilan avant de confirmer.')

async function plan(tx: Prisma.TransactionClient, slug: string) {
  const entity = await tx.entity.findUnique({ where: { slug }, select: {
    id: true, slug: true, title: true, status: true, updatedAt: true,
  } })
  if (!entity) throw new EditorialError(404, 'NOT_FOUND', 'Fiche introuvable.')
  const relations = await tx.relation.findMany({ where: { OR: [{ fromEntityId: entity.id }, { toEntityId: entity.id }] },
    select: { id: true, updatedAt: true }, orderBy: { id: 'asc' } })
  const relationIds = relations.map(row => row.id)
  const [evidence, revisions, decisions, ignores, images] = await Promise.all([
    tx.evidence.findMany({ where: { OR: [{ entityId: entity.id }, { relationId: { in: relationIds } }] },
      select: { id: true, entityId: true, updatedAt: true }, orderBy: { id: 'asc' } }),
    tx.revision.findMany({ where: { entityId: entity.id }, select: { id: true }, orderBy: { id: 'asc' } }),
    tx.ingestionAssociationDecision.findMany({ where: { entityId: entity.id },
      select: { id: true, association: { select: { id: true, revision: true } } }, orderBy: { id: 'asc' } }),
    tx.obsidianReferenceIgnore.findMany({ where: { OR: [{ fromEntityId: entity.id }, { toEntityId: entity.id }] },
      select: { fromEntityId: true, toEntityId: true, revision: true }, orderBy: [{ fromEntityId: 'asc' }, { toEntityId: 'asc' }] }),
    tx.entityImage.findMany({ where: { entityId: entity.id }, select: { id: true }, orderBy: { id: 'asc' } }),
  ])
  const associationIds = [...new Set(decisions.map(row => row.association.id))].sort()
  const directEvidence = evidence.filter(row => row.entityId === entity.id).length
  const fingerprint = createHash('sha256').update(JSON.stringify({ entity, relations, evidence, revisions, decisions, ignores, images })).digest('hex')
  const preview: AdminEntityDeletionPlan = { id: entity.id, slug: entity.slug, title: entity.title, status: entity.status,
    fingerprint, counts: { relations: relations.length, directEvidence, relationEvidence: evidence.length - directEvidence,
      revisions: revisions.length, associationDecisions: decisions.length, associations: associationIds.length, referenceIgnores: ignores.length, images: images.length } }
  return { preview, associationIds, relationIds }
}

export function createPrismaEntityDeletionService(prisma: PrismaClient): EntityDeletionService {
  return {
    preview: slug => prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
      return (await plan(tx, slug)).preview
    }, { isolationLevel: 'RepeatableRead', timeout: 20_000 }),
    async remove(slug, input) {
      if (input.confirm !== true) throw new EditorialError(400, 'INVALID_REQUEST', 'Confirmation explicite requise.')
      try {
        await prisma.$transaction(async tx => {
          // Stop new foreign-key dependencies on the target while checking the approved inventory.
          await tx.$queryRaw(Prisma.sql`SELECT id FROM "Entity" WHERE slug = ${slug} FOR UPDATE`)
          const { preview, associationIds, relationIds } = await plan(tx, slug)
          if (preview.id !== input.entityId || preview.fingerprint !== input.fingerprint) throw conflict()
          await tx.evidence.deleteMany({ where: { OR: [{ entityId: preview.id }, { relationId: { in: relationIds } }] } })
          await tx.relation.deleteMany({ where: { id: { in: relationIds } } })
          await tx.revision.deleteMany({ where: { entityId: preview.id } })
          // Preserve staging identities and other decisions; invalidate stale editorial requests.
          await tx.ingestionAssociation.updateMany({ where: { id: { in: associationIds } }, data: { revision: { increment: 1 } } })
          await tx.ingestionAssociationDecision.deleteMany({ where: { entityId: preview.id } })
          await tx.obsidianReferenceIgnore.deleteMany({ where: { OR: [{ fromEntityId: preview.id }, { toEntityId: preview.id }] } })
          await tx.entity.delete({ where: { id: preview.id } })
        }, { isolationLevel: 'Serializable', timeout: 20_000 })
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && ['P2034', 'P2003', 'P2025'].includes(String(error.code))) throw conflict()
        throw error
      }
    },
  }
}
