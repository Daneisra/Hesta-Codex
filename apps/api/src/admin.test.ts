import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { PrismaClient } from './prisma-client/client.ts'
import { createPrismaAdminStore } from './admin/store.js'

test('admin Prisma reads include PROPOSED GM records, provenance, relations and revisions', async () => {
  const listQueries: Array<Record<string, unknown>> = []
  const detailQueries: Array<Record<string, unknown>> = []
  const date = new Date('2026-09-28T12:00:00.000Z')
  const listRow = {
    id: 'entity-1', slug: 'barolt', kind: 'PERSON', placeKind: null,
    title: 'Barolt', summary: 'Résumé', tags: ['lore'],
    status: 'PROPOSED', visibility: 'GM', updatedAt: date,
    metadata: { internalSecret: 'must stay private' },
  }
  const source = {
    id: 'source-1', kind: 'MANUAL', label: 'Notes de partie', externalId: 'notes-001',
    url: null, authorLabel: 'MJ', visibility: 'GM',
    metadata: { internalSecret: 'must stay private' },
  }
  const evidence = {
    id: 'evidence-1', claimText: 'Fait sourcé', sourceExcerpt: 'Extrait', locator: 'p. 2',
    timeStartSeconds: null, timeEndSeconds: null, confidence: { toString: () => '0.800' },
    visibility: 'GM', source,
  }
  const relationType = {
    id: 'type-1', code: 'member_of', label: 'membre de',
    inverseCode: 'has_member', inverseLabel: 'compte parmi ses membres', symmetric: false,
  }
  const neighbor = { ...listRow, id: 'entity-2', slug: 'organisation', title: 'Organisation' }
  const detailRow = {
    ...listRow, bodyMarkdown: '**Texte privé**', aliases: ['Alias'], createdAt: date, publishedAt: null,
    evidence: [evidence],
    outgoingRelations: [{ id: 'relation-1', description: null, status: 'PROPOSED', visibility: 'GM',
      relationType, evidence: [evidence], toEntity: neighbor }],
    incomingRelations: [],
    revisions: [{ id: 'revision-1', number: 1, snapshot: { entity: { title: 'Barolt' } },
      message: 'Import', editorLabel: 'Import CLI Hesta Codex', createdAt: date }],
  }
  const prisma = {
    entity: {
      async findMany(query: Record<string, unknown>) { listQueries.push(query); return [listRow] },
      async count(query: Record<string, unknown>) { listQueries.push(query); return 1 },
      async findUnique(query: Record<string, unknown>) { detailQueries.push(query); return detailRow },
      async groupBy(query: { by: string[] }) {
        return query.by[0] === 'status'
          ? [{ status: 'PROPOSED', _count: { _all: 8 } }]
          : [{ visibility: 'GM', _count: { _all: 8 } }]
      },
    },
    source: { async count() { return 1 } },
    relation: { async count() { return 6 } },
  } as unknown as PrismaClient
  const store = createPrismaAdminStore(prisma)

  const list = await store.listEntities({ status: 'PROPOSED', visibility: 'GM', kind: 'PERSON', q: 'bar', page: 2 })
  assert.equal(list.items[0]?.title, 'Barolt')
  assert.equal(list.items[0]?.status, 'PROPOSED')
  assert.equal(JSON.stringify(list).includes('internalSecret'), false)
  assert.equal(list.total, 1)
  assert.equal(list.pageSize, 50)
  const query = listQueries[0] as { where: Record<string, unknown>; skip: number; take: number }
  assert.equal(query.where.status, 'PROPOSED')
  assert.equal(query.where.visibility, 'GM')
  assert.equal(query.where.kind, 'PERSON')
  assert.equal(query.skip, 50)
  assert.equal(query.take, 50)
  assert.deepEqual((listQueries[1] as { where: unknown }).where, query.where)

  const detail = await store.getEntity('barolt')
  assert.equal(detail?.status, 'PROPOSED')
  assert.equal(detail?.visibility, 'GM')
  assert.equal(detail?.bodyMarkdown, '**Texte privé**')
  assert.equal(detail?.evidence[0]?.source.label, 'Notes de partie')
  assert.equal(detail?.evidence[0]?.confidence, '0.800')
  assert.equal(detail?.outgoingRelations[0]?.entity.slug, 'organisation')
  assert.equal(detail?.outgoingRelations[0]?.evidence[0]?.claimText, 'Fait sourcé')
  assert.equal(detail?.revisions[0]?.number, 1)
  assert.deepEqual(detail?.revisions[0]?.snapshot, { entity: { title: 'Barolt' } })
  assert.equal(JSON.stringify(detail).includes('internalSecret'), false)
  assert.deepEqual((detailQueries[0] as { where: unknown }).where, { slug: 'barolt' })
  assert.equal(JSON.stringify(detailQueries[0]).includes('metadata'), false)

  const stats = await store.getStats()
  assert.equal(stats.byStatus.PROPOSED, 8)
  assert.equal(stats.byStatus.DRAFT, 0)
  assert.equal(stats.byVisibility.GM, 8)
  assert.equal(stats.sources, 1)
  assert.equal(stats.relations, 6)
})
