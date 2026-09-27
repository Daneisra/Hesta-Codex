import type {
  EntityDetail,
  EntityListItem,
  EntityRelationItem,
  RelationTypeItem,
} from '@hesta-codex/shared'
import {
  EditorialStatus,
  Visibility,
  type EntityKind,
  type Prisma,
  type PrismaClient,
} from './prisma-client/client.ts'

export interface EntityFilters {
  kind?: EntityKind
  q?: string
}

export interface CodexStore {
  ping(): Promise<void>
  listRelationTypes(): Promise<RelationTypeItem[]>
  listEntities(filters: EntityFilters): Promise<EntityListItem[]>
  getEntityBySlug(slug: string): Promise<EntityDetail | null>
}

const publicEntity = {
  status: EditorialStatus.PUBLISHED,
  visibility: Visibility.PUBLIC,
} as const

const entityListSelect = {
  id: true,
  slug: true,
  kind: true,
  placeKind: true,
  title: true,
  summary: true,
  tags: true,
} satisfies Prisma.EntitySelect

const relationTypeSelect = {
  id: true,
  code: true,
  label: true,
  inverseCode: true,
  inverseLabel: true,
  symmetric: true,
} satisfies Prisma.RelationTypeSelect

type SelectedEntity = Prisma.EntityGetPayload<{ select: typeof entityListSelect }>
type SelectedRelationType = Prisma.RelationTypeGetPayload<{ select: typeof relationTypeSelect }>

function toEntityItem(entity: SelectedEntity): EntityListItem {
  return entity
}

function toRelationTypeItem(relationType: SelectedRelationType): RelationTypeItem {
  return relationType
}

export function createPrismaStore(prisma: PrismaClient): CodexStore {
  return {
    async ping() {
      await prisma.$queryRaw`SELECT 1`
    },

    async listRelationTypes() {
      const relationTypes = await prisma.relationType.findMany({
        select: relationTypeSelect,
        orderBy: { code: 'asc' },
      })
      return relationTypes.map(toRelationTypeItem)
    },

    async listEntities({ kind, q }) {
      const entities = await prisma.entity.findMany({
        where: {
          ...publicEntity,
          ...(kind ? { kind } : {}),
          ...(q
            ? {
                OR: [
                  { title: { contains: q, mode: 'insensitive' } },
                  { summary: { contains: q, mode: 'insensitive' } },
                  { slug: { contains: q, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        select: entityListSelect,
        orderBy: [{ title: 'asc' }, { slug: 'asc' }],
        take: 100,
      })
      return entities.map(toEntityItem)
    },

    async getEntityBySlug(slug) {
      const entity = await prisma.entity.findFirst({
        where: { slug, ...publicEntity },
        select: {
          ...entityListSelect,
          bodyMarkdown: true,
          aliases: true,
          metadata: true,
          createdAt: true,
          updatedAt: true,
          publishedAt: true,
        },
      })

      if (!entity) return null
      if (!entity.publishedAt) throw new Error('Published entity is missing publishedAt')

      const [outgoing, incoming] = await Promise.all([
        prisma.relation.findMany({
          where: {
            fromEntityId: entity.id,
            ...publicEntity,
            toEntity: { is: publicEntity },
          },
          select: {
            id: true,
            description: true,
            relationType: { select: relationTypeSelect },
            toEntity: { select: entityListSelect },
          },
          orderBy: { id: 'asc' },
        }),
        prisma.relation.findMany({
          where: {
            toEntityId: entity.id,
            ...publicEntity,
            fromEntity: { is: publicEntity },
          },
          select: {
            id: true,
            description: true,
            relationType: { select: relationTypeSelect },
            fromEntity: { select: entityListSelect },
          },
          orderBy: { id: 'asc' },
        }),
      ])

      const outgoingRelations: EntityRelationItem[] = outgoing.map((relation) => ({
        id: relation.id,
        description: relation.description,
        relationType: toRelationTypeItem(relation.relationType),
        entity: toEntityItem(relation.toEntity),
      }))
      const incomingRelations: EntityRelationItem[] = incoming.map((relation) => ({
        id: relation.id,
        description: relation.description,
        relationType: toRelationTypeItem(relation.relationType),
        entity: toEntityItem(relation.fromEntity),
      }))

      return {
        ...toEntityItem(entity),
        bodyMarkdown: entity.bodyMarkdown,
        aliases: entity.aliases,
        metadata: entity.metadata,
        status: 'PUBLISHED',
        visibility: 'PUBLIC',
        createdAt: entity.createdAt.toISOString(),
        updatedAt: entity.updatedAt.toISOString(),
        publishedAt: entity.publishedAt.toISOString(),
        outgoingRelations,
        incomingRelations,
      }
    },
  }
}
