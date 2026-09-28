import type { Prisma } from '../prisma-client/client.ts'
import type { ImportDocument, ImportEntity } from './format.js'
import type { ImportDatabase, ImportWriter } from './repository.js'
import { resolveImport, type ImportPlan, type ImportReport } from './resolve.js'

function entitySnapshot(entity: ImportEntity, sourceId: string): Prisma.InputJsonValue {
  return {
    version: 1,
    entity: {
      slug: entity.slug,
      kind: entity.kind,
      placeKind: entity.placeKind ?? null,
      title: entity.title,
      summary: entity.summary,
      bodyMarkdown: entity.bodyMarkdown,
      aliases: entity.aliases,
      tags: entity.tags,
      status: 'PROPOSED',
      visibility: entity.visibility,
      publishedAt: null,
    },
    import: {
      sourceId,
      evidenceCount: entity.evidence.length,
    },
  }
}

async function writeImport(document: ImportDocument, writer: ImportWriter, plan: ImportPlan): Promise<void> {
  const sourceId = plan.source?.id ?? (await writer.createSource(document.source)).id
  const entityIds = new Map([...plan.existingEntities].map(([slug, entity]) => [slug, entity.id]))

  for (const entity of document.entities) {
    const created = await writer.createEntity(entity)
    entityIds.set(entity.slug, created.id)
    await writer.createEvidence(sourceId, { entityId: created.id }, entity.evidence)
    await writer.createRevision(created.id, entitySnapshot(entity, sourceId))
  }

  for (const relation of plan.relations) {
    const fromId = entityIds.get(relation.fromSlug)
    const toId = entityIds.get(relation.toSlug)
    if (!fromId || !toId) throw new Error('Unresolved relation reference')
    const created = await writer.createRelation(relation.input, fromId, toId, relation.type.id)
    await writer.createEvidence(sourceId, { relationId: created.id }, relation.input.evidence)
  }
}

export async function importDocument(document: ImportDocument, database: ImportDatabase, dryRun: boolean): Promise<ImportReport> {
  if (dryRun) return (await resolveImport(document, database.reader)).report

  return database.transaction(async (writer) => {
    const plan = await resolveImport(document, writer)
    if (plan.report.issues.length > 0) return plan.report
    await writeImport(document, writer, plan)
    return { ...plan.report, applied: true }
  })
}
