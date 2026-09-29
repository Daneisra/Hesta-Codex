import type { AdminEntityDetail, AdminSourceListResponse } from '@hesta-codex/shared'
import { Prisma, type PrismaClient } from '../prisma-client/client.ts'
import { EditorialError, entitySnapshot } from './editorial.js'
import { createInitialEvidence, resolveCreationSource } from './creation-provenance.js'
import type { ManualCreateInput, SourceLookupInput } from './manual-validation.js'
import { readAdminEntity, sourceItem, sourceSelect } from './store.js'

const pageSize = 20

export interface ManualService {
  listSources(input: SourceLookupInput): Promise<AdminSourceListResponse>
  create(input: ManualCreateInput, editorLabel: string): Promise<AdminEntityDetail>
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

export function createPrismaManualService(prisma: PrismaClient): ManualService {
  return {
    async listSources({ q, page }) {
      const where: Prisma.SourceWhereInput = q ? { OR: [
        { label: { contains: q, mode: 'insensitive' } },
        { externalId: { contains: q, mode: 'insensitive' } },
        { authorLabel: { contains: q, mode: 'insensitive' } },
      ] } : {}
      const [rows, total] = await Promise.all([
        prisma.source.findMany({ where, select: sourceSelect, orderBy: [{ label: 'asc' }, { id: 'asc' }],
          skip: (page - 1) * pageSize, take: pageSize }),
        prisma.source.count({ where }),
      ])
      return { items: rows.map(sourceItem), total, page, pageSize }
    },

    create(input, editorLabel) {
      return prisma.$transaction(async (tx) => {
        const existing = await tx.entity.findUnique({ where: { slug: input.entity.slug }, select: { id: true } })
        if (existing) throw new EditorialError(409, 'ENTITY_CONFLICT', 'Ce slug est déjà utilisé par une fiche.')

        const sourceId = await resolveCreationSource(tx, input.source)

        const fields = input.entity
        let entity
        try {
          entity = await tx.entity.create({ data: {
            slug: fields.slug, kind: fields.kind, placeKind: fields.placeKind,
            title: fields.title, summary: fields.summary, bodyMarkdown: fields.bodyMarkdown,
            aliases: fields.aliases, tags: fields.tags, visibility: fields.visibility,
            status: 'PROPOSED', publishedAt: null,
          } })
        } catch (error) {
          if (isUniqueConflict(error)) throw new EditorialError(409, 'ENTITY_CONFLICT', 'Ce slug est déjà utilisé par une fiche.')
          throw error
        }

        await createInitialEvidence(tx, sourceId, { entityId: entity.id, relationId: null },
          input.evidence, input.source.mode === 'existing')
        await tx.revision.create({ data: {
          entityId: entity.id, number: 1, snapshot: entitySnapshot(entity),
          editorLabel, message: 'Création manuelle depuis l’administration',
        } })

        const detail = await readAdminEntity(tx, entity.slug)
        if (!detail) throw new Error('Created entity could not be read')
        return detail
      })
    },
  }
}
