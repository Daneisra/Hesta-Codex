import { canonicalRelationEndpoints, type AdminEvidencePatch, type AdminRelationPatch, type AdminSourcePatch, type AdminWorkflowRequest } from '@hesta-codex/shared'
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
    async patchRelation(id, input) {
      try { return await prisma.$transaction(async (tx) => {
        const row = await tx.relation.findUnique({ where: { id }, select: {
          id: true, description: true, visibility: true, status: true, updatedAt: true,
          fromEntityId: true, toEntityId: true, relationTypeId: true,
          relationType: { select: { code: true } },
          fromEntity: { select: { status: true } }, toEntity: { select: { status: true } },
        } })
        if (!row) throw new EditorialError(404, 'NOT_FOUND', 'Relation introuvable')
        expectFresh(row.updatedAt, input.expectedUpdatedAt, 'relation')
        if (row.status === 'ARCHIVED') throw new EditorialError(409, 'INVALID_STATUS', 'Relation archivée en lecture seule.')
        let endpoints: ReturnType<typeof canonicalRelationEndpoints> | undefined
        if (input.relationCode !== undefined || input.reverse) {
          const code = input.relationCode ?? row.relationType.code
          const types = await tx.relationType.findMany({ where: { OR: [{ code }, { inverseCode: code }] },
            select: { id: true, code: true, inverseCode: true, symmetric: true } })
          if (!types.length) throw new EditorialError(404, 'RELATION_TYPE_NOT_FOUND', 'Type de relation introuvable.')
          if (types.length > 1) throw new EditorialError(409, 'RELATION_TYPE_AMBIGUOUS', 'Code de relation ambigu dans le catalogue.')
          const type = types[0]!
          const from = input.reverse ? row.toEntityId : row.fromEntityId, to = input.reverse ? row.fromEntityId : row.toEntityId
          const next = canonicalRelationEndpoints(type, code, from, to)
          const unchangedSymmetric = type.symmetric && type.id === row.relationTypeId
          if (!unchangedSymmetric && (next.fromEntityId !== row.fromEntityId || next.toEntityId !== row.toEntityId || next.relationTypeId !== row.relationTypeId)) {
            if (from === to) throw new EditorialError(400, 'RELATION_SELF_REFERENCE', 'Une fiche ne peut pas être liée à elle-même.')
            if (row.fromEntity.status === 'ARCHIVED' || row.toEntity.status === 'ARCHIVED') {
              throw new EditorialError(409, 'ENTITY_ARCHIVED', 'Une fiche archivée ne peut pas recevoir de correction de relation.')
            }
            const duplicate = await tx.relation.findFirst({ where: { id: { not: id }, relationTypeId: type.id,
              OR: type.symmetric ? [{ fromEntityId: next.fromEntityId, toEntityId: next.toEntityId },
                { fromEntityId: next.toEntityId, toEntityId: next.fromEntityId }]
                : [{ fromEntityId: next.fromEntityId, toEntityId: next.toEntityId }] }, select: { id: true } })
            if (duplicate) throw new EditorialError(409, 'RELATION_CONFLICT', 'Cette relation existe déjà. Aucune fusion automatique n’a été effectuée.')
            endpoints = next
          }
        }
        if (!endpoints && row.description === input.description && row.visibility === input.visibility) return result(id, row.updatedAt, row.status)
        const status = endpoints && row.status === 'PUBLISHED' ? 'PROPOSED' : row.status
        const updatedAt = nextUpdatedAt(row.updatedAt)
        const changed = await tx.relation.updateMany({
          where: { id, updatedAt: row.updatedAt, status: row.status },
          data: { description: input.description, visibility: input.visibility, updatedAt,
            ...(endpoints ? { ...endpoints, status } : {}) },
        })
        if (changed.count !== 1) throw modified.relation()
        return result(id, updatedAt, status)
      }) } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new EditorialError(409, 'RELATION_CONFLICT', 'Cette relation existe déjà. Aucune modification n’a été enregistrée.')
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
          throw new EditorialError(409, 'RELATION_REFERENCE_CHANGED', 'Une fiche ou un type de relation a changé. Rechargez la fiche.')
        }
        throw error
      }
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
          entity: { select: { status: true } },
          relation: { select: { status: true, fromEntity: { select: { status: true } },
            toEntity: { select: { status: true } } } },
        } })
        if (!row) throw new EditorialError(404, 'NOT_FOUND', 'Preuve introuvable')
        expectFresh(row.updatedAt, input.expectedUpdatedAt, 'evidence')
        if (row.entity?.status === 'ARCHIVED' || row.relation?.fromEntity.status === 'ARCHIVED' ||
          row.relation?.toEntity.status === 'ARCHIVED') {
          throw new EditorialError(409, 'ENTITY_ARCHIVED', 'Fiche archivée en lecture seule.')
        }
        if (row.relation?.status === 'ARCHIVED') {
          throw new EditorialError(409, 'RELATION_ARCHIVED', 'Relation archivée en lecture seule.')
        }
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
