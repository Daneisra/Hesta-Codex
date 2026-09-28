import type { AdminEvidencePatch, AdminRelationPatch, AdminSourcePatch, AdminWorkflowRequest } from '@hesta-codex/shared'
import { Prisma, type PrismaClient } from '../prisma-client/client.ts'
import { EditorialError } from './editorial.js'

type Result = { id: string; updatedAt: string; status?: string }
export interface ProvenanceService {
  patchRelation(id: string, input: AdminRelationPatch): Promise<Result>
  publishRelation(id: string, input: AdminWorkflowRequest): Promise<Result>
  unpublishRelation(id: string, input: AdminWorkflowRequest): Promise<Result>
  patchSource(id: string, input: AdminSourcePatch): Promise<Result>
  patchEvidence(id: string, input: AdminEvidencePatch): Promise<Result>
}

const modified = {
  relation: () => new EditorialError(409, 'RELATION_MODIFIED', 'Cette relation a été modifiée depuis son ouverture.'),
  source: () => new EditorialError(409, 'SOURCE_MODIFIED', 'Cette source a été modifiée depuis son ouverture.'),
  evidence: () => new EditorialError(409, 'EVIDENCE_MODIFIED', 'Cette preuve a été modifiée depuis son ouverture.'),
}
function expectFresh(actual: Date, expected: string, kind: keyof typeof modified): void {
  if (actual.getTime() !== new Date(expected).getTime()) throw modified[kind]()
}
function nextUpdatedAt(previous: Date): Date {
  return new Date(Math.max(Date.now(), previous.getTime() + 1))
}
function result(id: string, updatedAt: Date, status?: string): Result {
  return { id, updatedAt: updatedAt.toISOString(), ...(status ? { status } : {}) }
}

export function createPrismaProvenanceService(prisma: PrismaClient): ProvenanceService {
  return {
    patchRelation(id, input) {
      return prisma.$transaction(async (tx) => {
        const row = await tx.relation.findUnique({ where: { id }, select: {
          id: true, description: true, visibility: true, status: true, updatedAt: true,
        } })
        if (!row) throw new EditorialError(404, 'NOT_FOUND', 'Relation introuvable')
        expectFresh(row.updatedAt, input.expectedUpdatedAt, 'relation')
        if (row.status === 'ARCHIVED') throw new EditorialError(409, 'INVALID_STATUS', 'Relation archivée en lecture seule.')
        if (row.description === input.description && row.visibility === input.visibility) return result(id, row.updatedAt, row.status)
        const updatedAt = nextUpdatedAt(row.updatedAt)
        const changed = await tx.relation.updateMany({
          where: { id, updatedAt: row.updatedAt, status: row.status },
          data: { description: input.description, visibility: input.visibility, updatedAt },
        })
        if (changed.count !== 1) throw modified.relation()
        return result(id, updatedAt, row.status)
      })
    },
    publishRelation(id, input) {
      return prisma.$transaction(async (tx) => {
        const row = await tx.relation.findUnique({ where: { id }, select: {
          id: true, status: true, updatedAt: true, fromEntityId: true, toEntityId: true,
        } })
        if (!row) throw new EditorialError(404, 'NOT_FOUND', 'Relation introuvable')
        expectFresh(row.updatedAt, input.expectedUpdatedAt, 'relation')
        if (row.status !== 'PROPOSED') throw new EditorialError(409, 'INVALID_STATUS', 'Seule une relation proposée peut être publiée.')
        if (row.fromEntityId === row.toEntityId) throw new EditorialError(422, 'INVALID_RELATION', 'Une relation réflexive ne peut pas être publiée.')
        const [evidenceCount, entitiesCount] = await Promise.all([
          tx.evidence.count({ where: { relationId: id } }),
          tx.entity.count({ where: { id: { in: [row.fromEntityId, row.toEntityId] } } }),
        ])
        if (!evidenceCount) throw new EditorialError(422, 'EVIDENCE_REQUIRED', 'Une preuve liée à la relation est requise.')
        if (entitiesCount !== 2) throw new EditorialError(422, 'INVALID_RELATION', 'Les deux fiches de la relation doivent exister.')
        const updatedAt = nextUpdatedAt(row.updatedAt)
        const changed = await tx.relation.updateMany({
          where: { id, updatedAt: row.updatedAt, status: 'PROPOSED' },
          data: { status: 'PUBLISHED', updatedAt },
        })
        if (changed.count !== 1) throw modified.relation()
        return result(id, updatedAt, 'PUBLISHED')
      })
    },
    unpublishRelation(id, input) {
      return prisma.$transaction(async (tx) => {
        const row = await tx.relation.findUnique({ where: { id }, select: { id: true, status: true, updatedAt: true } })
        if (!row) throw new EditorialError(404, 'NOT_FOUND', 'Relation introuvable')
        expectFresh(row.updatedAt, input.expectedUpdatedAt, 'relation')
        if (row.status !== 'PUBLISHED') throw new EditorialError(409, 'INVALID_STATUS', 'Seule une relation publiée peut être retirée.')
        const updatedAt = nextUpdatedAt(row.updatedAt)
        const changed = await tx.relation.updateMany({
          where: { id, updatedAt: row.updatedAt, status: 'PUBLISHED' },
          data: { status: 'PROPOSED', updatedAt },
        })
        if (changed.count !== 1) throw modified.relation()
        return result(id, updatedAt, 'PROPOSED')
      })
    },
    async patchSource(id, input) {
      try {
        return await prisma.$transaction(async (tx) => {
          const row = await tx.source.findUnique({ where: { id }, select: {
            id: true, kind: true, label: true, externalId: true, url: true, authorLabel: true,
            publishedAt: true, visibility: true, updatedAt: true,
          } })
          if (!row) throw new EditorialError(404, 'NOT_FOUND', 'Source introuvable')
          expectFresh(row.updatedAt, input.expectedUpdatedAt, 'source')
          if (row.kind === input.kind && row.label === input.label && row.externalId === input.externalId &&
            row.url === input.url && row.authorLabel === input.authorLabel && row.visibility === input.visibility &&
            (row.publishedAt?.getTime() ?? null) === (input.publishedAt ? new Date(input.publishedAt).getTime() : null)) {
            return result(id, row.updatedAt)
          }
          const updatedAt = nextUpdatedAt(row.updatedAt)
          const changed = await tx.source.updateMany({
            where: { id, updatedAt: row.updatedAt },
            data: { kind: input.kind, label: input.label, externalId: input.externalId, url: input.url,
              authorLabel: input.authorLabel, publishedAt: input.publishedAt ? new Date(input.publishedAt) : null,
              visibility: input.visibility, updatedAt },
          })
          if (changed.count !== 1) throw modified.source()
          return result(id, updatedAt)
        })
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new EditorialError(409, 'SOURCE_CONFLICT', 'Une source de ce type utilise déjà cet identifiant externe.')
        }
        throw error
      }
    },
    patchEvidence(id, input) {
      return prisma.$transaction(async (tx) => {
        const row = await tx.evidence.findUnique({ where: { id }, select: {
          id: true, claimText: true, sourceExcerpt: true, locator: true, timeStartSeconds: true,
          timeEndSeconds: true, confidence: true, visibility: true, updatedAt: true,
        } })
        if (!row) throw new EditorialError(404, 'NOT_FOUND', 'Preuve introuvable')
        expectFresh(row.updatedAt, input.expectedUpdatedAt, 'evidence')
        if (row.claimText === input.claimText && row.sourceExcerpt === input.sourceExcerpt && row.locator === input.locator &&
          row.timeStartSeconds === input.timeStartSeconds && row.timeEndSeconds === input.timeEndSeconds &&
          (row.confidence?.toNumber() ?? null) === input.confidence && row.visibility === input.visibility) {
          return result(id, row.updatedAt)
        }
        const updatedAt = nextUpdatedAt(row.updatedAt)
        const changed = await tx.evidence.updateMany({
          where: { id, updatedAt: row.updatedAt },
          data: { claimText: input.claimText, sourceExcerpt: input.sourceExcerpt, locator: input.locator,
            timeStartSeconds: input.timeStartSeconds, timeEndSeconds: input.timeEndSeconds,
            confidence: input.confidence, visibility: input.visibility, updatedAt },
        })
        if (changed.count !== 1) throw modified.evidence()
        return result(id, updatedAt)
      })
    },
  }
}
