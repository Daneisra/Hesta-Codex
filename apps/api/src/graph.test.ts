import assert from 'node:assert/strict'
import { once } from 'node:events'
import { after, before, test } from 'node:test'
import type { Server } from 'node:http'
import type { PrismaClient } from './prisma-client/client.ts'
import { createPrismaGraphStore, type GraphStore } from './graph.js'
import { createApp } from './app.js'
import { readAuthConfig } from './auth/config.js'
import { sessionHash } from './auth/session.js'

const nodes = [
  { id: 'a', slug: 'ville', title: 'Ville', kind: 'PLACE', placeKind: 'CITY', summary: 'Ville publique',
    aliases: ['Cité'], status: 'PUBLISHED', visibility: 'PUBLIC' },
  { id: 'b', slug: 'continent', title: 'Continent', kind: 'PLACE', placeKind: 'CONTINENT', summary: null,
    aliases: [], status: 'PUBLISHED', visibility: 'PUBLIC' },
  { id: 'c', slug: 'secret', title: 'Secret', kind: 'PERSON', placeKind: null, summary: 'Résumé privé',
    aliases: ['Alias privé'], status: 'PROPOSED', visibility: 'GM' },
  { id: 'd', slug: 'joueurs', title: 'Joueurs', kind: 'PERSON', placeKind: null, summary: null,
    aliases: [], status: 'PUBLISHED', visibility: 'PLAYERS' },
  { id: 'e', slug: 'archive', title: 'Archive', kind: 'OTHER', placeKind: null, summary: null,
    aliases: [], status: 'ARCHIVED', visibility: 'SECRET' },
  { id: 'f', slug: 'brouillon', title: 'Brouillon', kind: 'OTHER', placeKind: null, summary: null,
    aliases: [], status: 'DRAFT', visibility: 'PUBLIC' },
  { id: 'g', slug: 'confidentiel', title: 'Confidentiel', kind: 'OTHER', placeKind: null, summary: null,
    aliases: [], status: 'PUBLISHED', visibility: 'SECRET' },
]
const relationType = { code: 'located_in', label: 'situé dans', inverseLabel: 'contient', symmetric: false }
const edges = [
  { id: 'ab', fromEntityId: 'a', toEntityId: 'b', status: 'PUBLISHED', visibility: 'PUBLIC', relationType },
  { id: 'ac', fromEntityId: 'a', toEntityId: 'c', status: 'PUBLISHED', visibility: 'PUBLIC', relationType },
  { id: 'ad', fromEntityId: 'a', toEntityId: 'd', status: 'PUBLISHED', visibility: 'PUBLIC', relationType },
  { id: 'ae', fromEntityId: 'a', toEntityId: 'e', status: 'PUBLISHED', visibility: 'PUBLIC', relationType },
  { id: 'af', fromEntityId: 'a', toEntityId: 'f', status: 'PUBLISHED', visibility: 'PUBLIC', relationType },
  { id: 'ag', fromEntityId: 'a', toEntityId: 'g', status: 'PUBLISHED', visibility: 'PUBLIC', relationType },
  { id: 'private-status', fromEntityId: 'a', toEntityId: 'b', status: 'PROPOSED', visibility: 'PUBLIC', relationType },
  { id: 'private-visibility', fromEntityId: 'a', toEntityId: 'b', status: 'PUBLISHED', visibility: 'GM', relationType },
  { id: 'ally', fromEntityId: 'b', toEntityId: 'a', status: 'PUBLISHED', visibility: 'PUBLIC',
    relationType: { code: 'allied_with', label: 'allié à', inverseLabel: null, symmetric: true } },
]

test('public graph filters both endpoints and edge state, with an explicit minimal projection', async () => {
  const queries: unknown[] = []
  const prisma = {
    entity: { async findMany(query: { where?: { status: string; visibility: string }; select: Record<string, unknown> }) {
      queries.push(query)
      return nodes.filter((node) => !query.where || (node.status === query.where.status &&
        node.visibility === query.where.visibility)).map((node) => Object.fromEntries(
        Object.keys(query.select).map((key) => [key, node[key as keyof typeof node]])))
    } },
    relation: { async findMany(query: { where?: { status: string; visibility: string;
      fromEntity: { is: { status: string; visibility: string } }; toEntity: { is: { status: string; visibility: string } } };
      select: Record<string, unknown> }) {
      queries.push(query)
      return edges.filter((edge) => !query.where || (edge.status === query.where.status &&
        edge.visibility === query.where.visibility && [edge.fromEntityId, edge.toEntityId].every((id) =>
          nodes.find((node) => node.id === id)?.status === 'PUBLISHED' &&
          nodes.find((node) => node.id === id)?.visibility === 'PUBLIC')))
        .map((edge) => Object.fromEntries(Object.keys(query.select).map((key) => [key, edge[key as keyof typeof edge]])))
    } },
  } as unknown as PrismaClient
  const store = createPrismaGraphStore(prisma)
  const publicGraph = await store.publicGraph()
  assert.deepEqual(publicGraph.nodes.map((node) => node.id), ['a', 'b'])
  assert.deepEqual(publicGraph.edges.map((edge) => edge.id), ['ab', 'ally'])
  assert.deepEqual(publicGraph.edges[0], { id: 'ab', source: 'a', target: 'b', type: 'located_in',
    label: 'situé dans', inverseLabel: 'contient', symmetric: false })
  assert.equal(JSON.stringify(publicGraph).includes('secret'), false)
  assert.equal(publicGraph.nodes[0]?.summary, 'Ville publique')
  assert.deepEqual(publicGraph.nodes[0]?.aliases, ['Cité'])
  assert.equal(JSON.stringify(publicGraph).includes('Alias privé'), false)
  assert.equal(JSON.stringify(publicGraph).includes('sourceExcerpt'), false)
  const entityQuery = queries[0] as { where: unknown; select: Record<string, unknown> }
  const relationQuery = queries[1] as { where: Record<string, unknown>; select: Record<string, unknown> }
  assert.deepEqual(entityQuery.where, { status: 'PUBLISHED', visibility: 'PUBLIC' })
  assert.deepEqual(relationQuery.where.fromEntity, { is: entityQuery.where })
  assert.deepEqual(relationQuery.where.toEntity, { is: entityQuery.where })
  for (const select of [entityQuery.select, relationQuery.select]) {
    for (const forbidden of ['metadata', 'source', 'evidence', 'revisions', 'user', 'sessions']) {
      assert.equal(Object.hasOwn(select, forbidden), false)
    }
  }
  const adminGraph = await store.adminGraph()
  assert.equal(adminGraph.nodes.length, 7)
  assert.equal(adminGraph.edges.length, 9)
  assert.equal(adminGraph.nodes[2]?.status, 'PROPOSED')
  assert.equal(adminGraph.edges[0]?.visibility, 'PUBLIC')
})

const config = readAuthConfig({ DISCORD_CLIENT_ID: '111111111111111111', DISCORD_CLIENT_SECRET: 'fake',
  DISCORD_REDIRECT_URI: 'http://localhost:5173/api/auth/discord/callback', DISCORD_ADMIN_IDS: '222222222222222222',
  SESSION_SECRET: 'a-test-secret-of-more-than-thirty-two-characters', SESSION_TTL_MS: '3600000' })
let server: Server
let base: string
let adminReads = 0
const graph: GraphStore = { async publicGraph() { return { nodes: [{ id: 'a', slug: 'ville', title: 'Ville',
  kind: 'PLACE', placeKind: 'CITY', summary: 'Ville publique', aliases: ['Cité'] }], edges: [] } }, async adminGraph() { adminReads++
  return { nodes: [{ id: 'c', slug: 'secret', title: 'Secret', kind: 'PERSON', placeKind: null,
    summary: 'Résumé privé', aliases: ['Alias privé'], status: 'PROPOSED', visibility: 'GM' }], edges: [] } } }
before(async () => {
  server = createApp({ async ping() {}, async listRelationTypes() { return [] },
    async listEntities() { return [] }, async getEntityBySlug() { return null } }, {
    auth: { config, store: { async findSession(hash) {
      const discordId = hash === sessionHash('a'.repeat(43)) ? '222222222222222222'
        : hash === sessionHash('b'.repeat(43)) ? '333333333333333333' : null
      return discordId ? { discordId, username: 'editor', displayName: 'Admin',
        expiresAt: new Date(Date.now() + 60_000) } : null
    }, async rotateSession() {}, async revokeSession() {} },
    discord: { authorizationUrl: () => '', exchangeCode: async () => { throw new Error('unused') } } },
    admin: { async listEntities() { return { items: [], total: 0, page: 1, pageSize: 50 } },
      async getEntity() { return null }, async getStats() { return { byStatus: { DRAFT: 0, PROPOSED: 0,
        PUBLISHED: 0, ARCHIVED: 0 }, byVisibility: { PUBLIC: 0, PLAYERS: 0, GM: 0, SECRET: 0 },
        sources: 0, relations: 0 } } },
    editorial: { async patch() { throw new Error('unused') }, async publish() { throw new Error('unused') },
      async unpublish() { throw new Error('unused') } }, graph,
  }, graph).listen(0)
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  base = `http://127.0.0.1:${address.port}`
})
after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())) })

test('public graph is open; admin graph requires a whitelisted session and no-store', async () => {
  const publicResponse = await fetch(`${base}/api/v1/graph`)
  assert.equal(publicResponse.status, 200)
  assert.deepEqual((await publicResponse.json() as { nodes: Array<{ slug: string }> }).nodes.map((node) => node.slug), ['ville'])
  assert.equal((await fetch(`${base}/api/admin/graph`)).status, 401)
  assert.equal((await fetch(`${base}/api/admin/graph`, { headers: {
    Cookie: `hesta_codex_session=${'b'.repeat(43)}` } })).status, 403)
  assert.equal(adminReads, 0)
  const allowed = await fetch(`${base}/api/admin/graph`, { headers: { Cookie: `hesta_codex_session=${'a'.repeat(43)}` } })
  assert.equal(allowed.status, 200)
  assert.equal(allowed.headers.get('cache-control'), 'no-store')
  assert.equal((await allowed.json() as { nodes: Array<{ status: string }> }).nodes[0]?.status, 'PROPOSED')
  assert.equal(adminReads, 1)
})
