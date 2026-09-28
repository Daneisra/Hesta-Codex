import { Prisma, type PrismaClient } from '../prisma-client/client.ts'
import type { ImportDocument, ImportEntity, ImportEvidence, ImportRelation } from './format.js'

type ImportSource = ImportDocument['source']

export interface EntityRef { id: string; slug: string }
export interface RelationTypeRef { id: string; code: string; symmetric: boolean }
export interface SourceRef { id: string; label: string; url: string | null; authorLabel: string | null }
export interface RelationRef { id: string }

export interface ImportReader {
  findEntitiesBySlugs(slugs: string[]): Promise<EntityRef[]>
  findRelationTypesByCodes(codes: string[]): Promise<RelationTypeRef[]>
  findSource(kind: ImportSource['kind'], externalId: string): Promise<SourceRef | null>
  findRelation(fromId: string, toId: string, typeId: string, symmetric: boolean): Promise<RelationRef | null>
}

export interface ImportWriter extends ImportReader {
  createSource(source: ImportSource): Promise<{ id: string }>
  createEntity(entity: ImportEntity): Promise<EntityRef>
  createRevision(entityId: string, snapshot: Prisma.InputJsonValue): Promise<void>
  createRelation(relation: ImportRelation, fromId: string, toId: string, typeId: string): Promise<RelationRef>
  createEvidence(sourceId: string, target: { entityId: string } | { relationId: string }, evidence: ImportEvidence[]): Promise<void>
}

export interface ImportDatabase {
  reader: ImportReader
  transaction<T>(work: (writer: ImportWriter) => Promise<T>): Promise<T>
}

function prismaWriter(client: Prisma.TransactionClient): ImportWriter {
  return {
    async findEntitiesBySlugs(slugs) {
      if (slugs.length === 0) return []
      return client.entity.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true } })
    },
    async findRelationTypesByCodes(codes) {
      if (codes.length === 0) return []
      return client.relationType.findMany({ where: { code: { in: codes } }, select: { id: true, code: true, symmetric: true } })
    },
    async findSource(kind, externalId) {
      return client.source.findUnique({
        where: { kind_externalId: { kind, externalId } },
        select: { id: true, label: true, url: true, authorLabel: true },
      })
    },
    async findRelation(fromId, toId, typeId, symmetric) {
      return client.relation.findFirst({
        where: {
          relationTypeId: typeId,
          OR: symmetric
            ? [{ fromEntityId: fromId, toEntityId: toId }, { fromEntityId: toId, toEntityId: fromId }]
            : [{ fromEntityId: fromId, toEntityId: toId }],
        },
        select: { id: true },
      })
    },
    async createSource(source) {
      return client.source.create({
        data: {
          kind: source.kind,
          label: source.label,
          externalId: source.externalId,
          url: source.url,
          authorLabel: source.authorLabel,
          visibility: 'GM',
        },
        select: { id: true },
      })
    },
    async createEntity(entity) {
      return client.entity.create({
        data: {
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
        select: { id: true, slug: true },
      })
    },
    async createRevision(entityId, snapshot) {
      await client.revision.create({
        data: {
          entityId,
          number: 1,
          snapshot,
          message: 'Création par import structuré v1',
          editorLabel: 'Import CLI Hesta Codex',
        },
      })
    },
    async createRelation(relation, fromId, toId, typeId) {
      return client.relation.create({
        data: {
          fromEntityId: fromId,
          toEntityId: toId,
          relationTypeId: typeId,
          description: relation.description,
          status: 'PROPOSED',
          visibility: relation.visibility,
        },
        select: { id: true },
      })
    },
    async createEvidence(sourceId, target, evidence) {
      await client.evidence.createMany({
        data: evidence.map((item) => ({
          sourceId,
          entityId: 'entityId' in target ? target.entityId : null,
          relationId: 'relationId' in target ? target.relationId : null,
          claimText: item.claimText,
          sourceExcerpt: item.sourceExcerpt,
          locator: item.locator,
          timeStartSeconds: item.timeStartSeconds,
          timeEndSeconds: item.timeEndSeconds,
          confidence: item.confidence,
          visibility: 'GM',
        })),
      })
    },
  }
}

export function createPrismaImportDatabase(prisma: PrismaClient): ImportDatabase {
  return {
    reader: prismaWriter(prisma),
    transaction(work) {
      return prisma.$transaction((transaction) => work(prismaWriter(transaction)), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 120_000,
      })
    },
  }
}
