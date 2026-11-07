import { createHash } from 'node:crypto'
import { publicationBatchLimit, type PublicationSelection, type PublicationApply, type PublicationCandidate,
  type PublicationEntity, type PublicationRelation, type PublicationPreview, type PublicationResult } from '@hesta-codex/shared'
import { Prisma, type PrismaClient } from '../prisma-client/client.ts'
import { editorialSelect, EditorialError, publishEditorialInTransaction, changeEditorialVisibilityInTransaction } from './editorial.js'
import { publishRelationInTransaction, changeRelationVisibilityInTransaction } from './provenance.js'
import { editorialFieldsSchema } from './validation.js'

export interface PublicationBatchService {
  candidates(): Promise<PublicationCandidate[]>
  preview(input: PublicationSelection): Promise<PublicationPreview>
  apply(input: PublicationApply, author: string): Promise<PublicationResult>
}
const candidateSelect = { id: true, slug: true, title: true, status: true, visibility: true } as const
const evidenceSelect = { select: { id: true, updatedAt: true, source: { select: { id: true, updatedAt: true } } }, orderBy: { id: 'asc' } } as const
const stale = () => new EditorialError(409, 'PUBLICATION_MODIFIED', 'Le bilan a changé. Recalculez-le et vérifiez-le avant de confirmer.')
const oversized = () => new EditorialError(503, 'PUBLICATION_LIMIT', 'Sélection trop volumineuse pour cette opération. Réduisez-la ; aucune modification effectuée.')

export function createPrismaPublicationBatchService(prisma: PrismaClient): PublicationBatchService {
  async function prepare(tx: Prisma.TransactionClient, input: PublicationSelection) {
    const targetVisibility = input.targetVisibility
    const ids = [...input.entityIds].map(id => id.toLowerCase()).sort()
    if (!ids.length || ids.length > publicationBatchLimit || new Set(ids).size !== ids.length) {
      throw new EditorialError(400, 'INVALID_SELECTION', `Sélection requise, ${publicationBatchLimit} fiches maximum, sans doublon.`)
    }
    const rows = await tx.entity.findMany({ where: { id: { in: ids } }, select: { ...editorialSelect, evidence: evidenceSelect }, orderBy: { id: 'asc' } })
    if (rows.length !== ids.length) throw stale()
    const entities: PublicationEntity[] = rows.map(row => {
      let outcome: PublicationEntity['outcome'] = 'READY', reason = 'Prête à valider.'
      if (targetVisibility !== undefined && row.status === 'ARCHIVED') { outcome = 'BLOCKED'; reason = 'Fiche archivée en lecture seule.' }
      else if (targetVisibility !== undefined && row.visibility === targetVisibility) { outcome = 'SKIPPED'; reason = 'Déjà à la visibilité choisie.' }
      else if (targetVisibility === undefined && row.status === 'PUBLISHED') { outcome = 'SKIPPED'; reason = 'Déjà publiée.' }
      else if (targetVisibility === undefined && row.status !== 'PROPOSED') { outcome = 'BLOCKED'; reason = 'Seule une fiche proposée peut être validée.' }
      else if (!editorialFieldsSchema.safeParse({ title: row.title, summary: row.summary, bodyMarkdown: row.bodyMarkdown,
        kind: row.kind, placeKind: row.placeKind, aliases: row.aliases, tags: row.tags, visibility: targetVisibility ?? row.visibility }).success) {
        outcome = 'BLOCKED'; reason = 'Champs invalides : corriger la fiche.'
      } else if (targetVisibility === undefined && !row.evidence.length) { outcome = 'BLOCKED'; reason = 'Aucune preuve directement liée à la fiche.' }
      if (outcome === 'READY' && targetVisibility !== undefined) reason = 'Visibilité modifiable ; statut conservé.'
      return { id: row.id, slug: row.slug, title: row.title, status: row.status, visibility: row.visibility, outcome, reason, evidence: row.evidence.length }
    })
    const available = new Set(entities.filter(row => row.outcome !== 'BLOCKED').map(row => row.id))
    // Visibility changes can expose/hide already PUBLIC incident relations, even when not edited.
    const relationRows = input.includeRelations || targetVisibility !== undefined ? await tx.relation.findMany({ where: { OR: [
      { fromEntityId: { in: ids } }, { toEntityId: { in: ids } },
    ] }, select: { id: true, status: true, visibility: true, updatedAt: true, fromEntityId: true, toEntityId: true,
      evidence: evidenceSelect, relationType: { select: { id: true, label: true, updatedAt: true } },
      fromEntity: { select: { ...candidateSelect, updatedAt: true } }, toEntity: { select: { ...candidateSelect, updatedAt: true } },
    }, orderBy: { id: 'asc' }, take: 10001 }) : []
    if (relationRows.length > 10000) throw oversized()
    const relations: PublicationRelation[] = (input.includeRelations ? relationRows : []).map(row => {
      let outcome: PublicationRelation['outcome'] = 'READY', reason = 'Prête à valider.'
      if (targetVisibility !== undefined) {
        reason = 'Visibilité modifiable ; statut conservé.'
        if (row.status === 'ARCHIVED' || row.fromEntity.status === 'ARCHIVED' || row.toEntity.status === 'ARCHIVED') {
          outcome = 'BLOCKED'; reason = 'Relation ou fiche archivée en lecture seule.'
        } else if (row.visibility === targetVisibility) { outcome = 'SKIPPED'; reason = 'Déjà à la visibilité choisie.' }
      } else if (row.status === 'PUBLISHED') { outcome = 'SKIPPED'; reason = 'Déjà publiée.' }
      else if (row.status !== 'PROPOSED') { outcome = 'BLOCKED'; reason = 'Seule une relation proposée peut être validée.' }
      else if (row.fromEntityId === row.toEntityId) { outcome = 'BLOCKED'; reason = 'Relation réflexive non admissible.' }
      else if (!row.evidence.length) { outcome = 'BLOCKED'; reason = 'Aucune preuve liée à la relation.' }
      else if (![row.fromEntity, row.toEntity].every(entity => entity.status === 'PUBLISHED' || available.has(entity.id))) {
        outcome = 'BLOCKED'; reason = 'Les deux fiches doivent être déjà publiées ou validables dans la sélection.'
      }
      const candidate = (entity: typeof row.fromEntity): PublicationCandidate => ({ id: entity.id, slug: entity.slug,
        title: entity.title, status: entity.status, visibility: entity.visibility })
      return { id: row.id, from: candidate(row.fromEntity), to: candidate(row.toEntity), label: row.relationType.label,
        status: row.status, visibility: row.visibility, outcome, reason, evidence: row.evidence.length }
    })
    const count = (items: Array<{ outcome: string }>, outcome: string) => items.filter(item => item.outcome === outcome).length
    const preview: PublicationPreview = {
      fingerprint: createHash('sha256').update(JSON.stringify({ algorithm: 2, ids, includeRelations: input.includeRelations, targetVisibility, rows, relationRows })).digest('hex'),
      ...(targetVisibility === undefined ? {} : { targetVisibility }),
      entities, relations, counts: {
        entitiesReady: count(entities, 'READY'), entitiesBlocked: count(entities, 'BLOCKED'), entitiesSkipped: count(entities, 'SKIPPED'),
        relationsReady: count(relations, 'READY'), relationsBlocked: count(relations, 'BLOCKED'), relationsSkipped: count(relations, 'SKIPPED'),
        publicElements: [...entities, ...relations].filter(item => item.outcome === 'READY' && (targetVisibility ?? item.visibility) === 'PUBLIC').length,
      },
    }
    if (targetVisibility !== undefined) {
      const next = new Map(entities.filter(row => row.outcome === 'READY').map(row => [row.id, targetVisibility]))
      const changedRelations = new Set(relations.filter(row => row.outcome === 'READY').map(row => row.id))
      const visible = (row: { status: string; visibility: string }) => row.status === 'PUBLISHED' && row.visibility === 'PUBLIC'
      const impact = { publicEntities: 0, hiddenEntities: 0, publicRelations: 0, hiddenRelations: 0 }
      for (const row of entities) {
        const before = visible(row), after = visible({ ...row, visibility: next.get(row.id) ?? row.visibility })
        if (!before && after) impact.publicEntities++
        if (before && !after) impact.hiddenEntities++
      }
      for (const row of relationRows) {
        const before = visible(row) && visible(row.fromEntity) && visible(row.toEntity)
        const after = visible({ ...row, visibility: changedRelations.has(row.id) ? targetVisibility : row.visibility }) &&
          [row.fromEntity, row.toEntity].every(entity => visible({ ...entity, visibility: next.get(entity.id) ?? entity.visibility }))
        if (!before && after) impact.publicRelations++
        if (before && !after) impact.hiddenRelations++
      }
      preview.visibilityImpact = impact
    }
    return { preview, rows, relationRows }
  }
  return {
    async candidates() {
      const rows = await prisma.entity.findMany({ select: candidateSelect, orderBy: [{ title: 'asc' }, { id: 'asc' }], take: 2001 })
      if (rows.length > 2000) throw oversized()
      return rows
    },
    preview: input => prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
      return (await prepare(tx, input)).preview
    }, { isolationLevel: 'RepeatableRead', timeout: 30000 }),
    async apply(input, author) {
      if (input.confirm !== true) throw new EditorialError(400, 'CONFIRMATION_REQUIRED', 'Confirmation humaine requise.')
      try {
        return await prisma.$transaction(async tx => {
          const { preview, rows, relationRows } = await prepare(tx, input)
          if (input.fingerprint !== preview.fingerprint) throw stale()
          if (preview.counts.publicElements && input.confirmPublic !== true) {
            throw new EditorialError(400, 'PUBLIC_CONFIRMATION_REQUIRED', input.targetVisibility === 'PUBLIC'
              ? 'Confirmez explicitement le passage en PUBLIC.' : 'Confirmez explicitement les éléments déjà marqués PUBLIC.')
          }
          if (!preview.counts.entitiesReady && !preview.counts.relationsReady) {
            throw new EditorialError(422, input.targetVisibility === undefined ? 'NOTHING_TO_PUBLISH' : 'NOTHING_TO_CHANGE', 'Aucun élément admissible à modifier.')
          }
          const readyEntities = new Set(preview.entities.filter(row => row.outcome === 'READY').map(row => row.id))
          const readyRelations = new Set(preview.relations.filter(row => row.outcome === 'READY').map(row => row.id))
          for (const row of rows) if (readyEntities.has(row.id)) {
            if (input.targetVisibility !== undefined) await changeEditorialVisibilityInTransaction(tx, row.id, row.updatedAt.toISOString(), input.targetVisibility, author)
            else await publishEditorialInTransaction(tx, row.slug, {
              expectedUpdatedAt: row.updatedAt.toISOString(), revisionMessage: 'Validation groupée des fiches ; visibilités conservées.',
            }, author)
          }
          for (const row of relationRows) if (readyRelations.has(row.id)) {
            if (input.targetVisibility !== undefined) await changeRelationVisibilityInTransaction(tx, row.id, row.updatedAt.toISOString(), input.targetVisibility)
            else await publishRelationInTransaction(tx, row.id, { expectedUpdatedAt: row.updatedAt.toISOString() })
          }
          return { entities: readyEntities.size, relations: readyRelations.size }
        }, { isolationLevel: 'Serializable', timeout: 60000 })
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002', 'P2003', 'P2025'].includes(error.code)) throw stale()
        throw error
      }
    },
  }
}
