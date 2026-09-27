import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { PrismaClient } from './prisma-client/client.ts'
import { createPrismaStore } from './store.js'

test('Prisma reads restrict entities and backlinks to published public content', async () => {
  const entityQueries: unknown[] = []
  const relationQueries: unknown[] = []
  const relationTypeQueries: unknown[] = []

  const publicEntity = {
    id: 'entity-1',
    slug: 'example-city',
    kind: 'PLACE',
    placeKind: 'CITY',
    title: 'Example City',
    summary: null,
    tags: [],
    aliases: [],
    metadata: null,
    bodyMarkdown: 'Example body',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    publishedAt: new Date('2026-01-02T00:00:00.000Z'),
  }

  const prisma = {
    entity: {
      async findMany(query: unknown) {
        entityQueries.push(query)
        return []
      },
      async findFirst(query: unknown) {
        entityQueries.push(query)
        return publicEntity
      },
    },
    relationType: {
      async findMany(query: unknown) {
        relationTypeQueries.push(query)
        return []
      },
    },
    relation: {
      async findMany(query: unknown) {
        relationQueries.push(query)
        const where = (query as { where: Record<string, unknown> }).where
        const relationType = {
          id: 'type-1',
          code: 'located_in',
          label: 'situé dans',
          inverseCode: 'contains',
          inverseLabel: 'contient',
          symmetric: false,
        }
        const neighbor = {
          id: 'entity-2',
          slug: 'example-neighbor',
          kind: 'PLACE',
          placeKind: 'REGION',
          title: 'Example Neighbor',
          summary: null,
          tags: [],
        }
        return where.fromEntityId
          ? [{ id: 'relation-out', description: null, relationType, toEntity: neighbor }]
          : [{ id: 'relation-in', description: null, relationType, fromEntity: neighbor }]
      },
    },
  } as unknown as PrismaClient

  const store = createPrismaStore(prisma)
  assert.deepEqual(await store.listRelationTypes(), [])
  assert.deepEqual(relationTypeQueries[0], {
    select: {
      id: true,
      code: true,
      label: true,
      inverseCode: true,
      inverseLabel: true,
      symmetric: true,
    },
    orderBy: { code: 'asc' },
  })

  assert.deepEqual(await store.listEntities({ kind: 'PLACE', q: 'City' }), [])
  const listQuery = entityQueries[0] as { where: Record<string, unknown>; take: number }
  assert.equal(listQuery.where.status, 'PUBLISHED')
  assert.equal(listQuery.where.visibility, 'PUBLIC')
  assert.equal(listQuery.where.kind, 'PLACE')
  assert.equal(listQuery.take, 100)
  assert.deepEqual(listQuery.where.OR, [
    { title: { contains: 'City', mode: 'insensitive' } },
    { summary: { contains: 'City', mode: 'insensitive' } },
    { slug: { contains: 'City', mode: 'insensitive' } },
  ])

  const detail = await store.getEntityBySlug('example-city')
  assert.equal(detail?.slug, 'example-city')
  assert.equal(detail?.outgoingRelations[0]?.id, 'relation-out')
  assert.equal(detail?.outgoingRelations[0]?.entity.slug, 'example-neighbor')
  assert.equal(detail?.outgoingRelations[0]?.relationType.code, 'located_in')
  assert.equal(detail?.incomingRelations[0]?.id, 'relation-in')
  assert.equal(detail?.incomingRelations[0]?.entity.slug, 'example-neighbor')
  assert.equal(detail?.incomingRelations[0]?.relationType.inverseCode, 'contains')

  const detailQuery = entityQueries[1] as { where: Record<string, unknown> }
  assert.deepEqual(detailQuery.where, {
    slug: 'example-city',
    status: 'PUBLISHED',
    visibility: 'PUBLIC',
  })
  assert.equal(relationQueries.length, 2)
  const outgoing = relationQueries[0] as { where: Record<string, unknown> }
  const incoming = relationQueries[1] as { where: Record<string, unknown> }
  assert.deepEqual(outgoing.where, {
    fromEntityId: 'entity-1',
    status: 'PUBLISHED',
    visibility: 'PUBLIC',
    toEntity: { is: { status: 'PUBLISHED', visibility: 'PUBLIC' } },
  })
  assert.deepEqual(incoming.where, {
    toEntityId: 'entity-1',
    status: 'PUBLISHED',
    visibility: 'PUBLIC',
    fromEntity: { is: { status: 'PUBLISHED', visibility: 'PUBLIC' } },
  })
})
