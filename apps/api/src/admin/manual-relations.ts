import type { AdminEntityDetail, RelationTypeItem } from '@hesta-codex/shared'
import { Prisma, type PrismaClient } from '../prisma-client/client.ts'
import { createInitialEvidence, resolveCreationSource } from './creation-provenance.js'
import { EditorialError } from './editorial.js'
import type { ManualRelationInput } from './manual-relations-validation.js'
import { readAdminEntity } from './store.js'

export interface ManualRelationService {
  listTypes(): Promise<RelationTypeItem[]>
  create(input: ManualRelationInput): Promise<AdminEntityDetail>
}

export function createPrismaManualRelationService(prisma: PrismaClient): ManualRelationService {
  return {
    async listTypes() {
      return prisma.relationType.findMany({
        select: { id: true, code: true, label: true, inverseCode: true, inverseLabel: true, symmetric: true },
        orderBy: { code: 'asc' },
      })
    },
    create(input) {
      if (input.fromEntityId === input.toEntityId) {
        throw new EditorialError(400, 'RELATION_SELF_REFERENCE', 'Une fiche ne peut pas être liée à elle-même.')
      }
      return prisma.$transaction(async (tx) => {
        const matches = await tx.relationType.findMany({ where: {
          OR: [{ code: input.relationCode }, { inverseCode: input.relationCode }],
        }, select: { id: true, code: true, inverseCode: true, symmetric: true } })
        if (matches.length === 0) throw new EditorialError(404, 'RELATION_TYPE_NOT_FOUND', 'Type de relation introuvable.')
        if (matches.length > 1) throw new EditorialError(409, 'RELATION_TYPE_AMBIGUOUS', 'Code de relation ambigu dans le catalogue.')
        const type = matches[0]!
        const [selectedFrom, selectedTo] = await Promise.all([
          tx.entity.findUnique({ where: { id: input.fromEntityId }, select: { id: true, slug: true, status: true } }),
          tx.entity.findUnique({ where: { id: input.toEntityId }, select: { id: true, slug: true, status: true } }),
        ])
        if (!selectedFrom) throw new EditorialError(404, 'FROM_ENTITY_NOT_FOUND', 'Fiche de départ introuvable.')
        if (!selectedTo) throw new EditorialError(404, 'TO_ENTITY_NOT_FOUND', 'Fiche cible introuvable.')
        if (selectedFrom.id === selectedTo.id) {
          throw new EditorialError(400, 'RELATION_SELF_REFERENCE', 'Une fiche ne peut pas être liée à elle-même.')
        }
        if (selectedFrom.status === 'ARCHIVED' || selectedTo.status === 'ARCHIVED') {
          throw new EditorialError(409, 'ENTITY_ARCHIVED', 'Une fiche archivée ne peut pas recevoir de nouvelle relation.')
        }

        const inverse = !type.symmetric && input.relationCode === type.inverseCode
        let fromId = inverse ? selectedTo.id : selectedFrom.id
        let toId = inverse ? selectedFrom.id : selectedTo.id
        if (type.symmetric && fromId > toId) [fromId, toId] = [toId, fromId]
        const already = await tx.relation.findFirst({ where: { relationTypeId: type.id,
          OR: type.symmetric
            ? [{ fromEntityId: fromId, toEntityId: toId }, { fromEntityId: toId, toEntityId: fromId }]
            : [{ fromEntityId: fromId, toEntityId: toId }],
        }, select: { id: true } })
        if (already) throw new EditorialError(409, 'RELATION_CONFLICT', 'Cette relation existe déjà.')

        const sourceId = await resolveCreationSource(tx, input.source)
        let relation
        try {
          relation = await tx.relation.create({ data: {
            fromEntityId: fromId, toEntityId: toId, relationTypeId: type.id,
            description: input.description, visibility: input.visibility, status: 'PROPOSED',
          }, select: { id: true } })
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            throw new EditorialError(409, 'RELATION_CONFLICT', 'Cette relation existe déjà.')
          }
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
            throw new EditorialError(409, 'RELATION_REFERENCE_CHANGED', 'Une fiche ou un type de relation a changé. Rechargez le formulaire.')
          }
          throw error
        }
        await createInitialEvidence(tx, sourceId, { entityId: null, relationId: relation.id },
          input.evidence, input.source.mode === 'existing')
        const detail = await readAdminEntity(tx, selectedFrom.slug)
        if (!detail) throw new Error('Created relation could not be read')
        return detail
      })
    },
  }
}
