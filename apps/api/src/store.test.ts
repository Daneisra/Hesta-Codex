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
    metadata: { internalNote: 'must not appear in a public response' },
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
  assert.equal(Object.hasOwn(detail ?? {}, 'metadata'), false)
  assert.equal((entityQueries[1] as { select: Record<string, unknown> }).select.metadata, undefined)
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

test('eight PROPOSED GM Entities are never returned by either public Entity route', async () => {
  const privateEntities = Array.from({ length: 8 }, (_, index) => ({
    id: `private-${index + 1}`, slug: `private-entry-${index + 1}`, status: 'PROPOSED', visibility: 'GM',
  }))
  const prisma = {
    entity: {
      async findMany(query: { where: { status: string; visibility: string } }) {
        assert.equal(query.where.status, 'PUBLISHED')
        assert.equal(query.where.visibility, 'PUBLIC')
        return privateEntities.filter((entity) => entity.status === query.where.status &&
          entity.visibility === query.where.visibility)
      },
      async findFirst(query: { where: { slug: string; status: string; visibility: string } }) {
        assert.equal(query.where.status, 'PUBLISHED')
        assert.equal(query.where.visibility, 'PUBLIC')
        return privateEntities.find((entity) => entity.slug === query.where.slug &&
          entity.status === query.where.status && entity.visibility === query.where.visibility) ?? null
      },
    },
  } as unknown as PrismaClient
  const store = createPrismaStore(prisma)
  assert.deepEqual(await store.listEntities({}), [])
  for (const entity of privateEntities) assert.equal(await store.getEntityBySlug(entity.slug), null)
})

test('every non-public status or visibility is excluded, including direct slug access', async () => {
  for (const [status, visibility] of [
    ['PROPOSED', 'GM'], ['PROPOSED', 'PUBLIC'], ['DRAFT', 'PUBLIC'], ['ARCHIVED', 'PUBLIC'],
    ['PUBLISHED', 'GM'], ['PUBLISHED', 'SECRET'], ['PUBLISHED', 'PLAYERS'],
  ]) {
    const entity = { slug: 'private-entry', status, visibility }
    const prisma = {
      entity: {
        async findMany(query: { where: { status: string; visibility: string } }) {
          return entity.status === query.where.status && entity.visibility === query.where.visibility ? [entity] : []
        },
        async findFirst(query: { where: { status: string; visibility: string } }) {
          return entity.status === query.where.status && entity.visibility === query.where.visibility ? entity : null
        },
      },
    } as unknown as PrismaClient
    const store = createPrismaStore(prisma)
    assert.deepEqual(await store.listEntities({}), [], `${status}/${visibility} in public list`)
    assert.equal(await store.getEntityBySlug(entity.slug), null, `${status}/${visibility} by slug`)
  }
})

test('public detail excludes relations to private neighbors and returns no provenance', async () => {
  const now = new Date('2026-01-01T00:00:00.000Z')
  const entity = {
    id: 'public-1', slug: 'public-entry', kind: 'PERSON', placeKind: null,
    title: 'Public Entry', summary: null, tags: [], aliases: [], bodyMarkdown: 'Public text',
    createdAt: now, updatedAt: now, publishedAt: now,
  }
  const prisma = {
    entity: { async findFirst() { return entity } },
    relation: {
      async findMany(query: { where: Record<string, unknown> }) {
        assert.equal(query.where.status, 'PUBLISHED')
        assert.equal(query.where.visibility, 'PUBLIC')
        const neighbor = query.where.fromEntityId ? query.where.toEntity : query.where.fromEntity
        assert.deepEqual(neighbor, { is: { status: 'PUBLISHED', visibility: 'PUBLIC' } })
        return []
      },
    },
  } as unknown as PrismaClient
  const detail = await createPrismaStore(prisma).getEntityBySlug('public-entry')
  assert.deepEqual(detail?.outgoingRelations, [])
  assert.deepEqual(detail?.incomingRelations, [])
  assert.equal(Object.hasOwn(detail ?? {}, 'evidence'), false)
  assert.equal(Object.hasOwn(detail ?? {}, 'revisions'), false)
  assert.equal(Object.hasOwn(detail ?? {}, 'source'), false)
})

test('public backlinks require a published public relation and published public endpoints', async () => {
  const now = new Date('2026-09-28T12:00:00.000Z')
  const base = { kind: 'PERSON', placeKind: null, summary: null, tags: [], aliases: [],
    bodyMarkdown: 'Texte public', createdAt: now, updatedAt: now, publishedAt: now }
  const current = { ...base, id: 'barolt', slug: 'barolt', title: 'Barolt',
    status: 'PUBLISHED', visibility: 'PUBLIC' }
  const relationType = { id: 'located-in', code: 'located_in', label: 'situé dans',
    inverseCode: 'contains', inverseLabel: 'contient', symmetric: false }
  const cases = [
    ['PUBLISHED', 'PUBLIC', 'PUBLISHED', 'PUBLIC', true],
    ['PROPOSED', 'PUBLIC', 'PUBLISHED', 'PUBLIC', false],
    ['PUBLISHED', 'GM', 'PUBLISHED', 'PUBLIC', false],
    ['PUBLISHED', 'PLAYERS', 'PUBLISHED', 'PUBLIC', false],
    ['PUBLISHED', 'SECRET', 'PUBLISHED', 'PUBLIC', false],
    ['PUBLISHED', 'PUBLIC', 'PROPOSED', 'GM', false],
    ['PUBLISHED', 'PUBLIC', 'PROPOSED', 'PUBLIC', false],
    ['PUBLISHED', 'PUBLIC', 'PUBLISHED', 'GM', false],
    ['PUBLISHED', 'PUBLIC', 'PUBLISHED', 'PLAYERS', false],
    ['PUBLISHED', 'PUBLIC', 'PUBLISHED', 'SECRET', false],
  ] as const

  for (const [relationStatus, relationVisibility, neighborStatus, neighborVisibility, visible] of cases) {
    for (const direction of ['outgoing', 'incoming'] as const) {
      const neighbor = { ...base, id: 'archipel', slug: 'archipel', title: 'Archipel Trekrerith',
        status: neighborStatus, visibility: neighborVisibility }
      const edge = { id: 'edge-1', description: 'Description privée ou publique',
        status: relationStatus, visibility: relationVisibility,
        fromEntity: direction === 'outgoing' ? current : neighbor,
        toEntity: direction === 'outgoing' ? neighbor : current, relationType,
        evidence: [{ claimText: 'Preuve secrète' }], source: { label: 'Notes MJ' },
        metadata: { internalNote: 'Ne jamais montrer' } }
      const prisma = {
        entity: { async findFirst(query: { where: { slug: string; status: string; visibility: string } }) {
          return query.where.slug === current.slug && query.where.status === current.status &&
            query.where.visibility === current.visibility ? current : null
        } },
        relation: { async findMany(query: { where: {
          fromEntityId?: string; toEntityId?: string; status: string; visibility: string;
          fromEntity?: { is: { status: string; visibility: string } };
          toEntity?: { is: { status: string; visibility: string } };
        } }) {
          const { where } = query
          const endpoint = where.fromEntityId ? edge.toEntity : edge.fromEntity
          const endpointFilter = where.fromEntityId ? where.toEntity?.is : where.fromEntity?.is
          const matchesDirection = (where.fromEntityId === edge.fromEntity.id && where.toEntityId === undefined) ||
            (where.toEntityId === edge.toEntity.id && where.fromEntityId === undefined)
          return matchesDirection && where.status === edge.status && where.visibility === edge.visibility &&
            endpointFilter?.status === endpoint.status && endpointFilter.visibility === endpoint.visibility
            ? [{ id: edge.id, description: edge.description, relationType: edge.relationType,
                ...(where.fromEntityId ? { toEntity: edge.toEntity } : { fromEntity: edge.fromEntity }) }] : []
        } },
      } as unknown as PrismaClient
      const detail = await createPrismaStore(prisma).getEntityBySlug('barolt')
      assert.ok(detail)
      assert.equal(detail.outgoingRelations.length, direction === 'outgoing' && visible ? 1 : 0,
        `${direction} ${relationStatus}/${relationVisibility}, neighbor ${neighborStatus}/${neighborVisibility}`)
      assert.equal(detail.incomingRelations.length, direction === 'incoming' && visible ? 1 : 0)
      const payload = JSON.stringify(detail)
      for (const secret of ['Preuve secrète', 'Notes MJ', 'Ne jamais montrer']) {
        assert.equal(payload.includes(secret), false)
      }
      if (!visible) assert.equal(payload.includes(edge.description), false)
    }
  }
})
