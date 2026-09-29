import type { AdminEntityDetail, AdminEntityPatch, AdminWorkflowRequest } from '@hesta-codex/shared'
import { Prisma, type PrismaClient } from '../prisma-client/client.ts'
import { readAdminEntity } from './store.js'
import { editorialFieldsSchema } from './validation.js'

export class EditorialError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message) }
}

export interface EditorialService {
  patch(slug: string, input: AdminEntityPatch, editorLabel: string): Promise<AdminEntityDetail>
  publish(slug: string, input: AdminWorkflowRequest, editorLabel: string): Promise<AdminEntityDetail>
  unpublish(slug: string, input: AdminWorkflowRequest, editorLabel: string): Promise<AdminEntityDetail>
}

const editorialSelect = {
  id: true, slug: true, kind: true, placeKind: true, title: true, summary: true,
  bodyMarkdown: true, aliases: true, tags: true, status: true, visibility: true,
  publishedAt: true, updatedAt: true,
} satisfies Prisma.EntitySelect

type EditorialRow = Prisma.EntityGetPayload<{ select: typeof editorialSelect }>

export function entitySnapshot(entity: EditorialRow): Prisma.InputJsonValue {
  return {
    version: 1,
    entity: {
      slug: entity.slug, kind: entity.kind, placeKind: entity.placeKind,
      title: entity.title, summary: entity.summary, bodyMarkdown: entity.bodyMarkdown,
      aliases: entity.aliases, tags: entity.tags, status: entity.status,
      visibility: entity.visibility, publishedAt: entity.publishedAt?.toISOString() ?? null,
    },
  }
}

function sameFields(entity: EditorialRow, input: AdminEntityPatch): boolean {
  return entity.title === input.title && entity.summary === input.summary &&
    entity.bodyMarkdown === input.bodyMarkdown && entity.kind === input.kind &&
    entity.placeKind === input.placeKind && entity.visibility === input.visibility &&
    JSON.stringify(entity.aliases) === JSON.stringify(input.aliases) &&
    JSON.stringify(entity.tags) === JSON.stringify(input.tags)
}

function checkExpected(entity: EditorialRow, expected: string): void {
  if (entity.updatedAt.getTime() !== new Date(expected).getTime()) {
    throw new EditorialError(409, 'ENTITY_MODIFIED', 'Cette fiche a été modifiée depuis son ouverture.')
  }
}

function nextUpdatedAt(previous: Date): Date {
  return new Date(Math.max(Date.now(), previous.getTime() + 1))
}

async function addRevision(
  tx: Prisma.TransactionClient, entity: EditorialRow, editorLabel: string, message: string | null,
): Promise<void> {
  const latest = await tx.revision.aggregate({ where: { entityId: entity.id }, _max: { number: true } })
  await tx.revision.create({ data: {
    entityId: entity.id, number: (latest._max.number ?? 0) + 1,
    snapshot: entitySnapshot(entity), editorLabel, message,
  } })
}

async function fullDetail(tx: Prisma.TransactionClient, slug: string): Promise<AdminEntityDetail> {
  const detail = await readAdminEntity(tx, slug)
  if (!detail) throw new EditorialError(404, 'NOT_FOUND', 'Fiche introuvable')
  return detail
}

export function createPrismaEditorialService(prisma: PrismaClient): EditorialService {
  return {
    async patch(slug, input, editorLabel) {
      return prisma.$transaction(async (tx) => {
        const current = await tx.entity.findUnique({ where: { slug }, select: editorialSelect })
        if (!current) throw new EditorialError(404, 'NOT_FOUND', 'Fiche introuvable')
        checkExpected(current, input.expectedUpdatedAt)
        if (current.status === 'ARCHIVED') throw new EditorialError(409, 'INVALID_STATUS', 'Une fiche archivée est en lecture seule.')
        if (sameFields(current, input)) return fullDetail(tx, slug)

        const updatedAt = nextUpdatedAt(current.updatedAt)
        const changed = await tx.entity.updateMany({
          where: { id: current.id, updatedAt: current.updatedAt, status: current.status },
          data: {
            title: input.title, summary: input.summary, bodyMarkdown: input.bodyMarkdown,
            kind: input.kind, placeKind: input.placeKind, aliases: input.aliases,
            tags: input.tags, visibility: input.visibility, updatedAt,
          },
        })
        if (changed.count !== 1) throw new EditorialError(409, 'ENTITY_MODIFIED', 'Cette fiche a été modifiée depuis son ouverture.')
        await addRevision(tx, { ...current, ...input, updatedAt }, editorLabel, input.revisionMessage ?? null)
        return fullDetail(tx, slug)
      })
    },
    async publish(slug, input, editorLabel) {
      return prisma.$transaction(async (tx) => {
        const current = await tx.entity.findUnique({ where: { slug }, select: editorialSelect })
        if (!current) throw new EditorialError(404, 'NOT_FOUND', 'Fiche introuvable')
        checkExpected(current, input.expectedUpdatedAt)
        if (current.status !== 'PROPOSED') throw new EditorialError(409, 'INVALID_STATUS', 'Seule une fiche proposée peut être publiée.')
        const validated = editorialFieldsSchema.safeParse({
          title: current.title, summary: current.summary, bodyMarkdown: current.bodyMarkdown,
          kind: current.kind, placeKind: current.placeKind, aliases: current.aliases,
          tags: current.tags, visibility: current.visibility,
        })
        if (!validated.success) throw new EditorialError(422, 'INVALID_ENTITY', 'La fiche doit être corrigée avant publication.')
        if (await tx.evidence.count({ where: { entityId: current.id } }) < 1) {
          throw new EditorialError(422, 'EVIDENCE_REQUIRED', 'Une preuve liée à la fiche est requise pour publier.')
        }

        const updatedAt = nextUpdatedAt(current.updatedAt)
        const changed = await tx.entity.updateMany({
          where: { id: current.id, updatedAt: current.updatedAt, status: 'PROPOSED' },
          data: { status: 'PUBLISHED', publishedAt: updatedAt, updatedAt },
        })
        if (changed.count !== 1) throw new EditorialError(409, 'ENTITY_MODIFIED', 'Cette fiche a été modifiée depuis son ouverture.')
        await addRevision(tx, { ...current, status: 'PUBLISHED', publishedAt: updatedAt, updatedAt },
          editorLabel, input.revisionMessage ?? 'Publication de la fiche')
        return fullDetail(tx, slug)
      })
    },
    async unpublish(slug, input, editorLabel) {
      return prisma.$transaction(async (tx) => {
        const current = await tx.entity.findUnique({ where: { slug }, select: editorialSelect })
        if (!current) throw new EditorialError(404, 'NOT_FOUND', 'Fiche introuvable')
        checkExpected(current, input.expectedUpdatedAt)
        if (current.status !== 'PUBLISHED') throw new EditorialError(409, 'INVALID_STATUS', 'Seule une fiche publiée peut être retirée.')

        const updatedAt = nextUpdatedAt(current.updatedAt)
        const changed = await tx.entity.updateMany({
          where: { id: current.id, updatedAt: current.updatedAt, status: 'PUBLISHED' },
          data: { status: 'PROPOSED', publishedAt: null, updatedAt },
        })
        if (changed.count !== 1) throw new EditorialError(409, 'ENTITY_MODIFIED', 'Cette fiche a été modifiée depuis son ouverture.')
        await addRevision(tx, { ...current, status: 'PROPOSED', publishedAt: null, updatedAt },
          editorLabel, input.revisionMessage ?? 'Retrait de publication')
        return fullDetail(tx, slug)
      })
    },
  }
}
