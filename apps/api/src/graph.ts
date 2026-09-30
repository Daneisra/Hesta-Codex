import type { AdminGraphResponse, GraphResponse } from '@hesta-codex/shared'
import { EditorialStatus, Visibility, type Prisma, type PrismaClient } from './prisma-client/client.ts'

export interface GraphStore {
  publicGraph(): Promise<GraphResponse>
  adminGraph(): Promise<AdminGraphResponse>
}

const publicOnly = { status: EditorialStatus.PUBLISHED, visibility: Visibility.PUBLIC } as const
const nodeSelect = { id: true, slug: true, title: true, kind: true, placeKind: true } satisfies Prisma.EntitySelect
const edgeSelect = {
  id: true, fromEntityId: true, toEntityId: true,
  relationType: { select: { code: true, label: true, inverseLabel: true, symmetric: true } },
} satisfies Prisma.RelationSelect

export function createPrismaGraphStore(prisma: PrismaClient): GraphStore {
  return {
    async publicGraph() {
      const [nodes, relations] = await Promise.all([
        prisma.entity.findMany({ where: publicOnly, select: nodeSelect, orderBy: { id: 'asc' } }),
        prisma.relation.findMany({ where: {
          ...publicOnly, fromEntity: { is: publicOnly }, toEntity: { is: publicOnly },
        }, select: edgeSelect, orderBy: { id: 'asc' } }),
      ])
      // Even if a publication changes between the two queries, never return a dangling edge.
      const visible = new Set(nodes.map((node) => node.id))
      return { nodes, edges: relations.filter((relation) => visible.has(relation.fromEntityId) &&
        visible.has(relation.toEntityId)).map((relation) => ({
        id: relation.id, source: relation.fromEntityId, target: relation.toEntityId,
        type: relation.relationType.code, label: relation.relationType.label,
        inverseLabel: relation.relationType.inverseLabel, symmetric: relation.relationType.symmetric,
      })) }
    },
    async adminGraph() {
      const [nodes, relations] = await Promise.all([
        prisma.entity.findMany({ select: { ...nodeSelect, status: true, visibility: true }, orderBy: { id: 'asc' } }),
        prisma.relation.findMany({ select: { ...edgeSelect, status: true, visibility: true },
          orderBy: { id: 'asc' } }),
      ])
      const present = new Set(nodes.map((node) => node.id))
      return { nodes, edges: relations.filter((relation) => present.has(relation.fromEntityId) &&
        present.has(relation.toEntityId)).map((relation) => ({
        id: relation.id, source: relation.fromEntityId, target: relation.toEntityId,
        type: relation.relationType.code, label: relation.relationType.label,
        inverseLabel: relation.relationType.inverseLabel, symmetric: relation.relationType.symmetric,
        status: relation.status, visibility: relation.visibility,
      })) }
    },
  }
}
