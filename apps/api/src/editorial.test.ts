import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { Server } from 'node:http'
import { after, before, test } from 'node:test'
import type { AdminEntityDetail, AdminEntityPatch } from '@hesta-codex/shared'
import type { PrismaClient } from './prisma-client/client.ts'
import { createApp } from './app.js'
import { createPrismaEditorialService, type EditorialService } from './admin/editorial.js'
import type { AdminStore } from './admin/store.js'
import { readAuthConfig } from './auth/config.js'
import { sessionHash } from './auth/session.js'
import type { AuthStore } from './auth/store.js'
import { createPrismaStore, type CodexStore } from './store.js'

const updatedAt = '2026-09-28T12:00:00.000Z'
const patch: AdminEntityPatch = {
  title: 'Barolt', summary: 'Résumé modifié', bodyMarkdown: 'Texte', kind: 'PERSON',
  placeKind: null, aliases: [], tags: [], visibility: 'GM', expectedUpdatedAt: updatedAt,
  revisionMessage: 'Modification du résumé',
}
const detail = {
  id: 'entity-1', slug: 'barolt', kind: 'PERSON', placeKind: null, title: 'Barolt',
  summary: 'Résumé initial', bodyMarkdown: 'Texte', aliases: [], tags: [],
  status: 'PROPOSED', visibility: 'GM', createdAt: updatedAt, updatedAt, publishedAt: null,
  evidence: [], outgoingRelations: [], incomingRelations: [], revisions: [],
} as AdminEntityDetail
const config = readAuthConfig({
  DISCORD_CLIENT_ID: '111111111111111111', DISCORD_CLIENT_SECRET: 'fake',
  DISCORD_REDIRECT_URI: 'http://localhost:5173/api/auth/discord/callback',
  DISCORD_ADMIN_IDS: '222222222222222222', SESSION_SECRET: 'a-test-secret-of-more-than-thirty-two-characters',
  SESSION_TTL_MS: '3600000',
})
const adminCookie = `hesta_codex_session=${'a'.repeat(43)}`
const playerCookie = `hesta_codex_session=${'b'.repeat(43)}`
const authStore: AuthStore = {
  async findSession(hash) {
    const discordId = hash === sessionHash('a'.repeat(43)) ? '222222222222222222'
      : hash === sessionHash('b'.repeat(43)) ? '333333333333333333' : null
    return discordId ? { discordId, username: 'editor', displayName: 'Danny',
      expiresAt: new Date(Date.now() + 60_000) } : null
  },
  async rotateSession() {}, async revokeSession() {},
}
const publicStore: CodexStore = {
  async ping() {}, async listRelationTypes() { return [] },
  async listEntities() { return [] }, async getEntityBySlug() { return null },
}
const adminStore: AdminStore = {
  async listEntities() { return { items: [], total: 0, page: 1, pageSize: 50 } },
  async getEntity() { return detail },
  async getStats() { return { byStatus: { DRAFT: 0, PROPOSED: 1, PUBLISHED: 0, ARCHIVED: 0 },
    byVisibility: { PUBLIC: 0, PLAYERS: 0, GM: 1, SECRET: 0 }, sources: 1, relations: 0 } },
}
const calls: Array<{ action: string; label: string }> = []
let lastPatchInput: AdminEntityPatch | null = null
const editorial: EditorialService = {
  async patch(_slug, input, label) { lastPatchInput = input; calls.push({ action: 'patch', label }); return detail },
  async publish(_slug, _input, label) { calls.push({ action: 'publish', label }); return detail },
  async unpublish(_slug, _input, label) { calls.push({ action: 'unpublish', label }); return detail },
}

let server: Server
let baseUrl: string
before(async () => {
  server = createApp(publicStore, { auth: { config, store: authStore,
    discord: { authorizationUrl: () => '', exchangeCode: async () => { throw new Error('not called') } } },
  admin: adminStore, editorial }).listen(0)
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  baseUrl = `http://127.0.0.1:${address.port}`
})
after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
})

async function request(path: string, method: 'PATCH' | 'POST', body: unknown, cookie?: string, origin?: string) {
  return fetch(`${baseUrl}${path}`, { method, headers: {
    'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}),
    ...(origin ? { Origin: origin } : {}),
  }, body: JSON.stringify(body) })
}

test('all mutations enforce session, admin whitelist and exact Origin', async () => {
  for (const [path, method, body] of [
    ['/api/admin/entities/barolt', 'PATCH', patch],
    ['/api/admin/entities/barolt/publish', 'POST', { expectedUpdatedAt: updatedAt }],
    ['/api/admin/entities/barolt/unpublish', 'POST', { expectedUpdatedAt: updatedAt }],
  ] as const) {
    assert.equal((await request(path, method, body, undefined, config.origin)).status, 401)
    assert.equal((await request(path, method, body, playerCookie, config.origin)).status, 403)
    assert.equal((await request(path, method, body, adminCookie, 'https://evil.example')).status, 403)
    assert.equal((await request(path, method, body, adminCookie)).status, 403)
    const allowed = await request(path, method, body, adminCookie, config.origin)
    assert.equal(allowed.status, 200)
    assert.equal(allowed.headers.get('cache-control'), 'no-store')
  }
  assert.deepEqual(calls.slice(-3), [
    { action: 'patch', label: 'Danny' }, { action: 'publish', label: 'Danny' },
    { action: 'unpublish', label: 'Danny' },
  ])
})

test('Origin comparison rejects null, lookalike hosts and ports without restricting GET', async () => {
  for (const origin of [
    'null', 'http://localhost:5174', 'http://localhost:5173.attacker.example',
    'https://codexhesta.dannytech.fr.attacker.example',
  ]) {
    assert.equal((await request('/api/admin/entities/barolt', 'PATCH', patch, adminCookie, origin)).status, 403)
  }
  const get = await fetch(`${baseUrl}/api/admin/entities/barolt`, { headers: { Cookie: adminCookie } })
  assert.equal(get.status, 200)
})

test('production mutations accept only the configured HTTPS origin', async () => {
  const productionOrigin = 'https://codexhesta.dannytech.fr'
  const productionServer = createApp(publicStore, { auth: { config: { ...config, origin: productionOrigin },
    store: authStore, discord: { authorizationUrl: () => '', exchangeCode: async () => { throw new Error('not called') } } },
  admin: adminStore, editorial }).listen(0)
  await once(productionServer, 'listening')
  try {
    const address = productionServer.address()
    assert.ok(address && typeof address !== 'string')
    const url = `http://127.0.0.1:${address.port}/api/admin/entities/barolt`
    for (const origin of [undefined, 'null', 'http://codexhesta.dannytech.fr',
      'https://codexhesta.dannytech.fr:8443', 'https://codexhesta.dannytech.fr.attacker.example']) {
      const response = await fetch(url, { method: 'PATCH', headers: {
        Cookie: adminCookie, 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}),
      }, body: JSON.stringify(patch) })
      assert.equal(response.status, 403, `Origin ${origin ?? '(absent)'}`)
    }
    const allowed = await fetch(url, { method: 'PATCH', headers: {
      Cookie: adminCookie, Origin: productionOrigin, 'Content-Type': 'application/json',
    }, body: JSON.stringify(patch) })
    assert.equal(allowed.status, 200)
  } finally {
    await new Promise<void>((resolve, reject) => productionServer.close((error) => error ? reject(error) : resolve()))
  }
})

test('PATCH rejects unknown properties, invalid placeKind, duplicate tags and malformed JSON', async () => {
  const patchCallsBefore = calls.filter((call) => call.action === 'patch').length
  const invalid = [
    { ...patch, id: 'fake-id' }, { ...patch, slug: 'different' }, { ...patch, status: 'PUBLISHED' },
    { ...patch, metadata: { private: true } }, { ...patch, publishedAt: updatedAt },
    { ...patch, createdAt: updatedAt }, { ...patch, updatedAt },
    { ...patch, evidence: [] }, { ...patch, relations: [] }, { ...patch, revisions: [] },
    { ...patch, kind: 'PLACE', placeKind: null },
    { ...patch, placeKind: 'CITY' }, { ...patch, tags: ['Hesta', 'hesta'] },
    { ...patch, aliases: ['Alias', 'alias'] }, { ...patch, visibility: 'EVERYONE' },
    { ...patch, title: '   ' }, { ...patch, expectedUpdatedAt: 'yesterday' },
    { ...patch, bodyMarkdown: 'x'.repeat(100_001) }, { ...patch, revisionMessage: 'x'.repeat(501) },
    { ...patch, aliases: ['  '] }, { ...patch, tags: ['  '] },
  ]
  for (const body of invalid) {
    const response = await request('/api/admin/entities/barolt', 'PATCH', body, adminCookie, config.origin)
    assert.equal(response.status, 400)
  }
  const malformed = await fetch(`${baseUrl}/api/admin/entities/barolt`, {
    method: 'PATCH', headers: { Cookie: adminCookie, Origin: config.origin, 'Content-Type': 'application/json' },
    body: '{bad-json',
  })
  assert.equal(malformed.status, 400)
  assert.equal((await request('/api/admin/entities/barolt/publish', 'POST',
    { expectedUpdatedAt: 'not-a-date' }, adminCookie, config.origin)).status, 400)
  assert.equal(calls.filter((call) => call.action === 'patch').length, patchCallsBefore)
})

test('PATCH accepts French Unicode and multiline Markdown without changing the slug', async () => {
  const before = calls.length
  const response = await request('/api/admin/entities/barolt', 'PATCH', {
    ...patch, title: 'Éléonore d’Arcy — l’érudite',
    summary: 'L’érudite de la région', bodyMarkdown: '## Événement\n\nPremière ligne.\n\n- Côte\n- Forêt',
    aliases: ['Éléonore', 'D’Arcy'], tags: ['géographie', 'histoire'],
    revisionMessage: 'Correction d’une entrée — édition',
  }, adminCookie, config.origin)
  assert.equal(response.status, 200)
  assert.equal(calls.length, before + 1)
  assert.equal(lastPatchInput?.title, 'Éléonore d’Arcy — l’érudite')
  assert.equal(lastPatchInput?.bodyMarkdown, '## Événement\n\nPremière ligne.\n\n- Côte\n- Forêt')
  assert.deepEqual(lastPatchInput?.aliases, ['Éléonore', 'D’Arcy'])
})

interface MemoryEntity {
  id: string; slug: string; kind: 'PERSON'; placeKind: null; title: string; summary: string | null
  bodyMarkdown: string; aliases: string[]; tags: string[]; status: 'DRAFT' | 'PROPOSED' | 'PUBLISHED' | 'ARCHIVED'
  visibility: 'GM' | 'PUBLIC'; createdAt: Date; updatedAt: Date; publishedAt: Date | null
}

function memoryDatabase() {
  let transactionTail = Promise.resolve()
  let entity: MemoryEntity = {
    id: 'entity-1', slug: 'barolt', kind: 'PERSON', placeKind: null, title: 'Barolt',
    summary: 'Résumé initial', bodyMarkdown: 'Texte', aliases: [], tags: [],
    status: 'PROPOSED', visibility: 'GM', createdAt: new Date(updatedAt),
    updatedAt: new Date(updatedAt), publishedAt: null,
  }
  let revisions: Array<Record<string, unknown>> = [{ id: 'revision-1', entityId: entity.id, number: 1,
    snapshot: { version: 1, entity: { slug: 'barolt', status: 'PROPOSED' } },
    message: null, editorLabel: 'Import CLI Hesta Codex', createdAt: new Date(updatedAt) }]
  let evidenceCount = 1
  const relationEvidenceCount = 1
  const relation = { status: 'PROPOSED', visibility: 'GM' }
  let failRevision = false
  let failUpdate = false
  let writes = 0
  const prisma = {
    async $transaction<T>(work: (tx: unknown) => Promise<T>) {
      let release: () => void = () => {}
      const currentTurn = new Promise<void>((resolve) => { release = resolve })
      const previousTurn = transactionTail
      transactionTail = currentTurn
      await previousTurn
      try {
        const pending = structuredClone(entity)
        const pendingRevisions = structuredClone(revisions)
        const tx = {
          entity: {
            async findUnique() { return { ...pending, evidence: Array.from({ length: evidenceCount }, (_, index) => ({
              id: `evidence-${index}`, claimText: 'Source', sourceExcerpt: null, locator: null,
              timeStartSeconds: null, timeEndSeconds: null, confidence: null, visibility: 'GM',
              source: { id: 'source-1', kind: 'MANUAL', label: 'Notes', externalId: null,
                url: null, authorLabel: null, visibility: 'GM' },
            })), outgoingRelations: [], incomingRelations: [], revisions: [...pendingRevisions].reverse() } },
            async updateMany(query: { where: { id: string; updatedAt: Date; status: string }; data: Partial<MemoryEntity> }) {
              if (failUpdate) throw new Error('update failed')
              if (query.where.id !== pending.id || query.where.updatedAt.getTime() !== pending.updatedAt.getTime() ||
                query.where.status !== pending.status) return { count: 0 }
              Object.assign(pending, query.data)
              writes++
              return { count: 1 }
            },
          },
          evidence: { async count(query: { where: { entityId: string } }) {
            assert.deepEqual(query.where, { entityId: entity.id })
            return evidenceCount
          } },
          revision: {
            async aggregate() { return { _max: { number: Math.max(...pendingRevisions.map((row) => row.number as number)) } } },
            async create(query: { data: Record<string, unknown> }) {
              if (failRevision) throw new Error('revision failed')
              pendingRevisions.push({ id: `revision-${pendingRevisions.length + 1}`,
                createdAt: new Date(), ...query.data })
            },
          },
        }
        const result = await work(tx)
        entity = pending
        revisions = pendingRevisions
        return result
      } finally { release() }
    },
    entity: {
      async findMany(query: { where: { status: string; visibility: string } }) {
        return entity.status === query.where.status && entity.visibility === query.where.visibility ? [entity] : []
      },
      async findFirst(query: { where: { status: string; visibility: string } }) {
        return entity.status === query.where.status && entity.visibility === query.where.visibility ? entity : null
      },
    },
    relation: { async findMany() { return [] }, async updateMany() { throw new Error('Relation must remain read-only') } },
  } as unknown as PrismaClient
  return { prisma, state: () => ({ entity, revisions, writes, relation, relationEvidenceCount }),
    setEvidenceCount(value: number) { evidenceCount = value },
    failRevision(value: boolean) { failRevision = value },
    failUpdate(value: boolean) { failUpdate = value },
    setStatus(value: MemoryEntity['status']) { entity.status = value },
  }
}

test('Barolt edit, visibility, publish and unpublish create consecutive snapshots and control public access', async () => {
  const database = memoryDatabase()
  const service = createPrismaEditorialService(database.prisma)
  const publicReads = createPrismaStore(database.prisma)
  const edited = await service.patch('barolt', patch, 'Danny')
  assert.equal(edited.status, 'PROPOSED')
  assert.equal(edited.visibility, 'GM')
  assert.equal(edited.revisions[0]?.number, 2)
  assert.equal(edited.revisions[0]?.message, 'Modification du résumé')
  assert.equal(edited.revisions[0]?.editorLabel, 'Danny')
  assert.deepEqual(edited.revisions[0]?.snapshot, { version: 1, entity: {
    slug: 'barolt', kind: 'PERSON', placeKind: null, title: 'Barolt', summary: 'Résumé modifié',
    bodyMarkdown: 'Texte', aliases: [], tags: [], status: 'PROPOSED', visibility: 'GM', publishedAt: null,
  } })
  assert.equal(await publicReads.getEntityBySlug('barolt'), null)
  const publicEdit = await service.patch('barolt', { ...patch, visibility: 'PUBLIC',
    expectedUpdatedAt: edited.updatedAt }, 'Danny')
  assert.equal(publicEdit.revisions[0]?.number, 3)
  assert.equal(await publicReads.getEntityBySlug('barolt'), null)
  const published = await service.publish('barolt', { expectedUpdatedAt: publicEdit.updatedAt }, 'Danny')
  assert.equal(published.status, 'PUBLISHED')
  assert.ok(published.publishedAt)
  assert.equal(published.revisions[0]?.number, 4)
  assert.equal((published.revisions[0]?.snapshot as { entity: { publishedAt: string } }).entity.publishedAt,
    published.publishedAt)
  assert.equal((await publicReads.getEntityBySlug('barolt'))?.status, 'PUBLISHED')
  await assert.rejects(service.unpublish('barolt', { expectedUpdatedAt: publicEdit.updatedAt }, 'Danny'),
    { code: 'ENTITY_MODIFIED', status: 409 })
  const unpublished = await service.unpublish('barolt', { expectedUpdatedAt: published.updatedAt }, 'Danny')
  assert.equal(unpublished.status, 'PROPOSED')
  assert.equal(unpublished.publishedAt, null)
  assert.equal(unpublished.revisions[0]?.number, 5)
  assert.equal(await publicReads.getEntityBySlug('barolt'), null)
  assert.equal(database.state().revisions.length, 5)
})

test('two admins editing the same timestamp cannot both commit', async () => {
  const database = memoryDatabase()
  const service = createPrismaEditorialService(database.prisma)
  const results = await Promise.allSettled([
    service.patch('barolt', { ...patch, summary: 'Modification de A' }, 'Admin A'),
    service.patch('barolt', { ...patch, summary: 'Modification de B' }, 'Admin B'),
  ])
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  const rejected = results.find((result) => result.status === 'rejected')
  assert.equal(rejected?.status, 'rejected')
  if (rejected?.status === 'rejected') assert.equal(rejected.reason.code, 'ENTITY_MODIFIED')
  assert.equal(database.state().revisions.length, 2)
})

test('no-op, stale timestamp, missing Evidence, invalid status and rollback are enforced', async () => {
  const database = memoryDatabase()
  const service = createPrismaEditorialService(database.prisma)
  const initial = database.state()
  const noOp = await service.patch('barolt', { ...patch, summary: 'Résumé initial', revisionMessage: null }, 'Danny')
  assert.equal(noOp.revisions.length, 1)
  assert.equal(database.state().writes, initial.writes)
  const edited = await service.patch('barolt', patch, 'Danny')
  await assert.rejects(service.patch('barolt', patch, 'Danny'), { code: 'ENTITY_MODIFIED', status: 409 })
  await assert.rejects(service.publish('barolt', { expectedUpdatedAt: updatedAt }, 'Danny'),
    { code: 'ENTITY_MODIFIED', status: 409 })
  database.setEvidenceCount(0)
  await assert.rejects(service.publish('barolt', { expectedUpdatedAt: edited.updatedAt }, 'Danny'),
    { code: 'EVIDENCE_REQUIRED', status: 422 })
  database.setEvidenceCount(1)
  database.failRevision(true)
  await assert.rejects(service.publish('barolt', { expectedUpdatedAt: edited.updatedAt }, 'Danny'))
  assert.equal(database.state().entity.status, 'PROPOSED')
  assert.equal(database.state().revisions.length, 2)
  database.failRevision(false)
  database.failUpdate(true)
  await assert.rejects(service.publish('barolt', { expectedUpdatedAt: edited.updatedAt }, 'Danny'))
  assert.equal(database.state().revisions.length, 2)
  database.failUpdate(false)
  database.setStatus('ARCHIVED')
  await assert.rejects(service.patch('barolt', { ...patch, expectedUpdatedAt: edited.updatedAt }, 'Danny'),
    { code: 'INVALID_STATUS', status: 409 })
  await assert.rejects(service.publish('barolt', { expectedUpdatedAt: edited.updatedAt }, 'Danny'),
    { code: 'INVALID_STATUS', status: 409 })
  await assert.rejects(service.unpublish('barolt', { expectedUpdatedAt: edited.updatedAt }, 'Danny'),
    { code: 'INVALID_STATUS', status: 409 })
})

test('publishing a GM Entity preserves privacy and does not change Relation rows', async () => {
  const database = memoryDatabase()
  const service = createPrismaEditorialService(database.prisma)
  assert.deepEqual(database.state().relation, { status: 'PROPOSED', visibility: 'GM' })
  const published = await service.publish('barolt', { expectedUpdatedAt: updatedAt }, 'Danny')
  assert.equal(published.visibility, 'GM')
  assert.equal((await createPrismaStore(database.prisma).listEntities({})).length, 0)
  assert.equal(await createPrismaStore(database.prisma).getEntityBySlug('barolt'), null)
  assert.equal(published.outgoingRelations.length, 0)
  assert.deepEqual(database.state().relation, { status: 'PROPOSED', visibility: 'GM' })
})

test('Evidence attached only to a Relation cannot authorize Entity publication', async () => {
  const database = memoryDatabase()
  database.setEvidenceCount(0)
  assert.equal(database.state().relationEvidenceCount, 1)
  await assert.rejects(createPrismaEditorialService(database.prisma).publish(
    'barolt', { expectedUpdatedAt: updatedAt }, 'Danny',
  ), { code: 'EVIDENCE_REQUIRED', status: 422 })
  assert.equal(database.state().entity.status, 'PROPOSED')
  assert.equal(database.state().revisions.length, 1)
})

test('editing an already public Entity keeps PUBLISHED and its original publishedAt', async () => {
  const database = memoryDatabase()
  const service = createPrismaEditorialService(database.prisma)
  const publicEdit = await service.patch('barolt', { ...patch, visibility: 'PUBLIC' }, 'Danny')
  const published = await service.publish('barolt', { expectedUpdatedAt: publicEdit.updatedAt }, 'Danny')
  const edited = await service.patch('barolt', { ...patch, summary: 'Résumé public corrigé',
    visibility: 'PUBLIC', expectedUpdatedAt: published.updatedAt }, 'Danny')
  assert.equal(edited.status, 'PUBLISHED')
  assert.equal(edited.publishedAt, published.publishedAt)
  assert.equal(edited.revisions[0]?.number, 4)
  assert.equal((await createPrismaStore(database.prisma).getEntityBySlug('barolt'))?.summary,
    'Résumé public corrigé')
})

test('DRAFT can be edited but cannot be published or unpublished', async () => {
  const database = memoryDatabase()
  database.setStatus('DRAFT')
  const service = createPrismaEditorialService(database.prisma)
  const edited = await service.patch('barolt', patch, 'Danny')
  assert.equal(edited.status, 'DRAFT')
  assert.equal(edited.revisions[0]?.number, 2)
  await assert.rejects(service.publish('barolt', { expectedUpdatedAt: edited.updatedAt }, 'Danny'),
    { code: 'INVALID_STATUS', status: 409 })
  await assert.rejects(service.unpublish('barolt', { expectedUpdatedAt: edited.updatedAt }, 'Danny'),
    { code: 'INVALID_STATUS', status: 409 })
})
