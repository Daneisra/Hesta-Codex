import type {
  AdminEntityDetail, AdminEntityListItem, AdminEntityListResponse, AdminEvidence,
  AdminRelation, AdminSource, AdminStats, EditorialStatus, EntityKind, RelationTypeItem, Visibility,
} from '@hesta-codex/shared'
import { Prisma, type PrismaClient } from '../prisma-client/client.ts'

export interface AdminFilters {
  status?: EditorialStatus
  visibility?: Visibility
  kind?: EntityKind
  q?: string
  page: number
}

export interface AdminStore {
  listEntities(filters: AdminFilters): Promise<AdminEntityListResponse>
  getEntity(slug: string): Promise<AdminEntityDetail | null>
  getStats(): Promise<AdminStats>
}

const pageSize = 50
const listSelect = {
  id: true, slug: true, kind: true, placeKind: true, title: true,
  summary: true, tags: true, status: true, visibility: true, updatedAt: true,
} satisfies Prisma.EntitySelect
const sourceSelect = {
  id: true, kind: true, label: true, externalId: true, url: true,
  authorLabel: true, publishedAt: true, visibility: true, updatedAt: true,
} satisfies Prisma.SourceSelect
const evidenceSelect = {
  id: true, claimText: true, sourceExcerpt: true, locator: true,
  timeStartSeconds: true, timeEndSeconds: true, confidence: true,
  visibility: true, updatedAt: true, source: { select: sourceSelect },
} satisfies Prisma.EvidenceSelect
const relationTypeSelect = {
  id: true, code: true, label: true, inverseCode: true, inverseLabel: true, symmetric: true,
} satisfies Prisma.RelationTypeSelect
const relationSelect = {
  id: true, description: true, status: true, visibility: true, updatedAt: true,
  relationType: { select: relationTypeSelect },
  evidence: { select: evidenceSelect, orderBy: { id: 'asc' as const } },
} satisfies Prisma.RelationSelect
const detailSelect = {
  ...listSelect,
  bodyMarkdown: true, aliases: true, createdAt: true, publishedAt: true,
  evidence: { select: evidenceSelect, orderBy: { id: 'asc' as const } },
  outgoingRelations: {
    select: { ...relationSelect, toEntity: { select: listSelect } },
    orderBy: { id: 'asc' as const },
  },
  incomingRelations: {
    select: { ...relationSelect, fromEntity: { select: listSelect } },
    orderBy: { id: 'asc' as const },
  },
  revisions: {
    select: { id: true, number: true, snapshot: true, message: true, editorLabel: true, createdAt: true },
    orderBy: { number: 'desc' as const },
  },
} satisfies Prisma.EntitySelect

type ListRow = Prisma.EntityGetPayload<{ select: typeof listSelect }>
type EvidenceRow = Prisma.EvidenceGetPayload<{ select: typeof evidenceSelect }>
type DetailRow = Prisma.EntityGetPayload<{ select: typeof detailSelect }>

function listItem(row: ListRow): AdminEntityListItem {
  return {
    id: row.id, slug: row.slug, kind: row.kind, placeKind: row.placeKind,
    title: row.title, summary: row.summary, tags: row.tags,
    status: row.status, visibility: row.visibility, updatedAt: row.updatedAt.toISOString(),
  }
}

function sourceItem(row: EvidenceRow['source']): AdminSource {
  return {
    id: row.id, kind: row.kind, label: row.label, externalId: row.externalId,
    url: row.url, authorLabel: row.authorLabel, publishedAt: row.publishedAt?.toISOString() ?? null,
    visibility: row.visibility, updatedAt: row.updatedAt.toISOString(),
  }
}

function evidenceItem(row: EvidenceRow): AdminEvidence {
  return {
    id: row.id,
    claimText: row.claimText,
    sourceExcerpt: row.sourceExcerpt,
    locator: row.locator,
    timeStartSeconds: row.timeStartSeconds,
    timeEndSeconds: row.timeEndSeconds,
    confidence: row.confidence?.toString() ?? null,
    visibility: row.visibility, updatedAt: row.updatedAt.toISOString(),
    source: sourceItem(row.source),
  }
}

function detailItem(row: DetailRow): AdminEntityDetail {
  const relationItem = (
    relation: DetailRow['outgoingRelations'][number] | DetailRow['incomingRelations'][number],
    neighbor: ListRow,
  ): AdminRelation => ({
    id: relation.id,
    description: relation.description,
    status: relation.status,
    visibility: relation.visibility,
    updatedAt: relation.updatedAt.toISOString(),
    relationType: {
      id: relation.relationType.id, code: relation.relationType.code,
      label: relation.relationType.label, inverseCode: relation.relationType.inverseCode,
      inverseLabel: relation.relationType.inverseLabel, symmetric: relation.relationType.symmetric,
    } satisfies RelationTypeItem,
    entity: listItem(neighbor),
    evidence: relation.evidence.map(evidenceItem),
  })
  return {
    ...listItem(row),
    bodyMarkdown: row.bodyMarkdown,
    aliases: row.aliases,
    createdAt: row.createdAt.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
    evidence: row.evidence.map(evidenceItem),
    outgoingRelations: row.outgoingRelations.map((relation) => relationItem(relation, relation.toEntity)),
    incomingRelations: row.incomingRelations.map((relation) => relationItem(relation, relation.fromEntity)),
    revisions: row.revisions.map((revision) => ({
      id: revision.id, number: revision.number, snapshot: revision.snapshot,
      message: revision.message, editorLabel: revision.editorLabel,
      createdAt: revision.createdAt.toISOString(),
    })),
  }
}

export async function readAdminEntity(database: Pick<PrismaClient, 'entity'>, slug: string): Promise<AdminEntityDetail | null> {
  const row = await database.entity.findUnique({ where: { slug }, select: detailSelect })
  return row ? detailItem(row) : null
}

export function createPrismaAdminStore(prisma: PrismaClient): AdminStore {
  return {
    async listEntities({ status, visibility, kind, q, page }) {
      const where: Prisma.EntityWhereInput = {
        ...(status ? { status } : {}),
        ...(visibility ? { visibility } : {}),
        ...(kind ? { kind } : {}),
        ...(q ? { OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { summary: { contains: q, mode: 'insensitive' } },
          { slug: { contains: q, mode: 'insensitive' } },
        ] } : {}),
      }
      const [rows, total] = await Promise.all([
        prisma.entity.findMany({
          where, select: listSelect,
          orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
          skip: (page - 1) * pageSize, take: pageSize,
        }),
        prisma.entity.count({ where }),
      ])
      return { items: rows.map(listItem), total, page, pageSize }
    },
    async getEntity(slug) {
      return readAdminEntity(prisma, slug)
    },
    async getStats() {
      const [statuses, visibilities, sources, relations] = await Promise.all([
        prisma.entity.groupBy({ by: ['status'], _count: { _all: true } }),
        prisma.entity.groupBy({ by: ['visibility'], _count: { _all: true } }),
        prisma.source.count(),
        prisma.relation.count(),
      ])
      const byStatus: AdminStats['byStatus'] = { DRAFT: 0, PROPOSED: 0, PUBLISHED: 0, ARCHIVED: 0 }
      const byVisibility: AdminStats['byVisibility'] = { PUBLIC: 0, PLAYERS: 0, GM: 0, SECRET: 0 }
      for (const row of statuses) byStatus[row.status] = row._count._all
      for (const row of visibilities) byVisibility[row.visibility] = row._count._all
      return { byStatus, byVisibility, sources, relations }
    },
  }
}
