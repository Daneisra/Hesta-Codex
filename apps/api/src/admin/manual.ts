import type { AdminEntityDetail, AdminSourceListResponse } from '@hesta-codex/shared'
import { Prisma, type PrismaClient } from '../prisma-client/client.ts'
import { EditorialError, entitySnapshot } from './editorial.js'
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

function isForeignKeyConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003'
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

        let sourceId: string
        if (input.source.mode === 'existing') {
          const source = await tx.source.findUnique({ where: { id: input.source.sourceId }, select: { id: true } })
          if (!source) throw new EditorialError(404, 'SOURCE_NOT_FOUND', 'Source introuvable.')
          sourceId = source.id
        } else {
          const data = input.source.data
          try {
            const source = await tx.source.create({ data: {
              kind: data.kind, label: data.label, externalId: data.externalId,
              url: data.url, authorLabel: data.authorLabel,
              publishedAt: data.publishedAt ? new Date(data.publishedAt) : null,
              visibility: data.visibility,
            }, select: { id: true } })
            sourceId = source.id
          } catch (error) {
            if (isUniqueConflict(error)) {
              throw new EditorialError(409, 'SOURCE_CONFLICT', 'Une source de ce type utilise déjà cet identifiant externe.')
            }
            throw error
          }
        }

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

        const proof = input.evidence
        try {
          await tx.evidence.create({ data: {
            sourceId, entityId: entity.id, relationId: null,
            claimText: proof.claimText, sourceExcerpt: proof.sourceExcerpt, locator: proof.locator,
            timeStartSeconds: proof.timeStartSeconds, timeEndSeconds: proof.timeEndSeconds,
            confidence: proof.confidence, visibility: proof.visibility,
          } })
        } catch (error) {
          if (input.source.mode === 'existing' && isForeignKeyConflict(error)) {
            throw new EditorialError(404, 'SOURCE_NOT_FOUND', 'Source introuvable.')
          }
          throw error
        }
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
