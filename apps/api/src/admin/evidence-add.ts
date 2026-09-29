import type { PrismaClient } from '../prisma-client/client.ts'
import { createInitialEvidence, resolveCreationSource } from './creation-provenance.js'
import { EditorialError } from './editorial.js'
import type { EvidenceAddInput } from './evidence-add-validation.js'

export interface EvidenceAddService {
  toEntity(slug: string, input: EvidenceAddInput): Promise<{ id: string }>
  toRelation(id: string, input: EvidenceAddInput): Promise<{ id: string }>
}

type Target = { entityId: string; relationId: null } | { entityId: null; relationId: string }

export function createPrismaEvidenceAddService(prisma: PrismaClient): EvidenceAddService {
  async function add(target: { slug: string } | { relationId: string }, input: EvidenceAddInput): Promise<{ id: string }> {
    return prisma.$transaction(async (tx) => {
      let ids: Target
      if ('slug' in target) {
        // Row lock serializes additions to one target, including concurrent requests using different Sources.
        const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>`SELECT "id", "status" FROM "Entity" WHERE "slug" = ${target.slug} FOR UPDATE`
        const entity = rows[0]
        if (!entity) throw new EditorialError(404, 'ENTITY_NOT_FOUND', 'Fiche introuvable.')
        if (entity.status === 'ARCHIVED') throw new EditorialError(409, 'ENTITY_ARCHIVED', 'Fiche archivée en lecture seule.')
        ids = { entityId: entity.id, relationId: null }
      } else {
        const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>`SELECT "id", "status" FROM "Relation" WHERE "id" = ${target.relationId}::uuid FOR UPDATE`
        const relation = rows[0]
        if (!relation) throw new EditorialError(404, 'RELATION_NOT_FOUND', 'Relation introuvable.')
        if (relation.status === 'ARCHIVED') throw new EditorialError(409, 'RELATION_ARCHIVED', 'Relation archivée en lecture seule.')
        const linked = await tx.relation.findUnique({ where: { id: relation.id }, select: {
          fromEntity: { select: { status: true } }, toEntity: { select: { status: true } },
        } })
        if (!linked) throw new EditorialError(404, 'RELATION_NOT_FOUND', 'Relation introuvable.')
        if (linked.fromEntity.status === 'ARCHIVED' || linked.toEntity.status === 'ARCHIVED') {
          throw new EditorialError(409, 'ENTITY_ARCHIVED', 'Une fiche liée est archivée en lecture seule.')
        }
        ids = { entityId: null, relationId: relation.id }
      }

      const sourceId = await resolveCreationSource(tx, input.source)
      const proof = input.evidence
      const duplicate = await tx.evidence.findFirst({ where: {
        ...ids, sourceId, claimText: proof.claimText, sourceExcerpt: proof.sourceExcerpt,
        locator: proof.locator, timeStartSeconds: proof.timeStartSeconds,
        timeEndSeconds: proof.timeEndSeconds,
      }, select: { id: true } })
      if (duplicate) throw new EditorialError(409, 'EVIDENCE_CONFLICT', 'Cette preuve existe déjà pour cette cible et cette Source.')

      return { id: await createInitialEvidence(tx, sourceId, ids, proof, input.source.mode === 'existing') }
    })
  }

  return {
    toEntity: (slug, input) => add({ slug }, input),
    toRelation: (relationId, input) => add({ relationId }, input),
  }
}
