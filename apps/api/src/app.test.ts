import assert from 'node:assert/strict'
import { once } from 'node:events'
import { after, before, test } from 'node:test'
import type { Server } from 'node:http'
import type { EntityDetail, HealthResponse, RelationTypeItem } from '@hesta-codex/shared'
import { createApp } from './app.js'
import type { CodexStore, EntityFilters } from './store.js'

const relationType: RelationTypeItem = {
  id: 'type-1',
  code: 'located_in',
  label: 'situé dans',
  inverseCode: 'contains',
  inverseLabel: 'contient',
  symmetric: false,
}

const exampleEntity: EntityDetail = {
  id: 'entity-1',
  slug: 'example-city',
  kind: 'PLACE',
  placeKind: 'CITY',
  title: 'Example City',
  summary: 'Example summary',
  tags: [],
  aliases: [],
  metadata: null,
  bodyMarkdown: 'Example body',
  status: 'PUBLISHED',
  visibility: 'PUBLIC',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  publishedAt: '2026-01-02T00:00:00.000Z',
  outgoingRelations: [{
    id: 'relation-1',
    description: null,
    relationType,
    entity: {
      id: 'entity-2',
      slug: 'example-continent',
      kind: 'PLACE',
      placeKind: 'CONTINENT',
      title: 'Example Continent',
      summary: null,
      tags: [],
    },
  }],
  incomingRelations: [],
}

let databaseAvailable = true
let receivedFilters: EntityFilters | undefined
let server: Server
let baseUrl: string

const store: CodexStore = {
  async ping() {
    if (!databaseAvailable) throw new Error('Database unavailable')
  },
  async listRelationTypes() {
    return [relationType]
  },
  async listEntities(filters) {
    receivedFilters = filters
    return [exampleEntity]
  },
  async getEntityBySlug(slug) {
    return slug === exampleEntity.slug ? exampleEntity : null
  },
}

before(async () => {
  server = createApp(store).listen(0)
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  baseUrl = `http://127.0.0.1:${address.port}`
})

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
})

test('GET /api/v1/health reports database availability without details', async () => {
  const response = await fetch(`${baseUrl}/api/v1/health`)
  assert.equal(response.status, 200)
  assert.deepEqual((await response.json()) as HealthResponse, {
    status: 'ok',
    service: 'hesta-codex-api',
    version: 'v1',
    database: 'ok',
  })

  databaseAvailable = false
  try {
    const degraded = await fetch(`${baseUrl}/api/v1/health`)
    assert.equal(degraded.status, 503)
    assert.deepEqual((await degraded.json()) as HealthResponse, {
      status: 'degraded',
      service: 'hesta-codex-api',
      version: 'v1',
      database: 'unavailable',
    })
  } finally {
    databaseAvailable = true
  }
})

test('GET /api/v1/relation-types returns the catalog', async () => {
  const response = await fetch(`${baseUrl}/api/v1/relation-types`)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), [relationType])
})

test('GET /api/v1/entities validates filters and returns navigation items', async () => {
  const response = await fetch(`${baseUrl}/api/v1/entities?kind=PLACE&q=example`)
  assert.equal(response.status, 200)
  assert.deepEqual(receivedFilters, { kind: 'PLACE', q: 'example' })
  const body = await response.json() as Array<Record<string, unknown>>
  assert.equal(body[0]?.slug, 'example-city')

  for (const query of ['kind=INVALID', 'q=x', 'kind=PLACE&kind=PERSON', 'status=DRAFT']) {
    const invalid = await fetch(`${baseUrl}/api/v1/entities?${query}`)
    assert.equal(invalid.status, 400, query)
    assert.equal((await invalid.json() as { error: { code: string } }).error.code, 'INVALID_REQUEST')
  }
})

test('GET /api/v1/entities/:slug returns a detail with backlinks and a clean 404', async () => {
  const response = await fetch(`${baseUrl}/api/v1/entities/example-city`)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), exampleEntity)

  const missing = await fetch(`${baseUrl}/api/v1/entities/missing`)
  assert.equal(missing.status, 404)
  assert.deepEqual(await missing.json(), {
    error: { code: 'NOT_FOUND', message: 'Entity not found' },
  })

  const invalid = await fetch(`${baseUrl}/api/v1/entities/INVALID`)
  assert.equal(invalid.status, 400)
})
