import assert from 'node:assert/strict'
import { test } from 'node:test'
import { once } from 'node:events'
import { wikiOccurrences, obsidianLinkIndex, resolveObsidianPath } from '@hesta-codex/shared'
import { buildReferenceCatalog, createPrismaReferenceService, type ReferenceEntity, type ReferenceOrigin } from './obsidian-references.js'
import type { PrismaClient } from './prisma-client/client.ts'
import { createPrismaGraphStore } from './graph.js'
import { createApp } from './app.js'
import { readAuthConfig } from './auth/config.js'
import { sessionHash } from './auth/session.js'

const date = new Date('2026-10-01T00:00:00.000Z'), stamp = date.toISOString()
function entity(id: string, title: string, bodyMarkdown = '', extra: Partial<ReferenceEntity> = {}): ReferenceEntity {
  return { id, slug: id, title, bodyMarkdown, aliases: [], status: 'PROPOSED', visibility: 'GM', updatedAt: date, ...extra }
}
function origin(entityId: string, path: string, metadata: unknown = {}, sourceId = 'vault'): ReferenceOrigin {
  return { entityId, path, metadata, sourceId }
}

// Names supplied in the acceptance cases; only synthetic link strings, no actual lore or vault content.
for (const [title, targets] of [
  ['Goliath', ['Dipovia', 'Vruliwen']], ['Inquisition', ['Comosicus Thiri', 'Zemantis']],
  ['Académie des Mages', ['Valerius Primus', 'Vruliwen']],
] as const) test(`${title} navigates to both expected existing identities in a synthetic fixture`, () => {
  const entities = [entity('source', title, targets.map(target => `[[${target}]]`).join(' ')),
    ...targets.map((target, index) => entity(`target-${index}`, target))]
  const catalog = buildReferenceCatalog(entities, entities.map(item => origin(item.id, `Exemples/${item.title}.md`)))
  assert.deepEqual(catalog.detail('source', stamp)!.outgoing.map(item => item.title), [...targets])
  assert.equal(catalog.graph().edges.length, 2)
})

test('31 placeholder paths yield 31 readable references without creating any destination', () => {
  const paths = Array.from({ length: 31 }, (_, index) => `Vides/Réserve ${index + 1}.md`)
  const catalog = buildReferenceCatalog([entity('source', 'Source', paths.map(path => `[[${path.replace(/\.md$/, '')}]]`).join('\n'))], [
    origin('source', 'Source.md', { obsidian: { wikilinks: paths.map(path => ({ status: 'FOUND', path })) } }),
  ])
  const detail = catalog.detail('source', stamp)!
  assert.equal(detail.stats.unassociated, 31)
  assert.equal(detail.outgoing.length, 0)
  assert.equal(detail.links.every(link => link.href === null), true)
  assert.equal(catalog.graph().edges.length, 0)
})

test('Obsidian paths reuse converter semantics, relative traversal and homonym safeguards', () => {
  const index = obsidianLinkIndex(['A/Note.md', 'B/Note.md', 'Région/Été.md'])
  assert.equal(resolveObsidianPath('Note', 'A/Source.md', index).status, 'AMBIGUOUS')
  assert.equal(resolveObsidianPath('../Région/Été', 'A/Source.md', index).path, 'Région/Été.md')
  assert.equal(resolveObsidianPath('../../Note', 'A/Source.md', index).status, 'OUT_OF_SCOPE')
  assert.equal(resolveObsidianPath('https://example.test', 'A/Source.md', index).status, 'UNSUPPORTED')
  assert.equal(resolveObsidianPath('image.png', 'A/Source.md', index).status, 'UNSUPPORTED')
  assert.equal(resolveObsidianPath('', 'A/Note.md', index).path, 'A/Note.md')
  assert.equal(resolveObsidianPath('Dossier/', 'Source.md', obsidianLinkIndex(['Dossier.md'])).status, 'MISSING')
})

test('AST scanner excludes fenced/list/blockquote code, inline code, links, HTML, escapes and frontmatter', () => {
  const body = [
    '---', 'aliases: [[Metadata]]', '---', '[[Visible|Alias]]', '`[[Inline]]`',
    '```md', '[[Fence]]', '```', '> ~~~', '> [[QuoteCode]]', '> ~~~',
    '- item', '', '      [[IndentedCode]]', '', '[classique [[Nested]]](https://example.test)',
    '<!-- [[Comment]] -->', '\\[[Escaped]]', '\\\\[[AfterEscape]]', '![image](picture.png "[[Title]]")',
    '', '    [[Indented]]', '', '[[Visible#Époque, ancienne]]',
  ].join('\n')
  assert.deepEqual(wikiOccurrences(body).map(link => link.target), ['Visible', 'AfterEscape', 'Visible'])
  assert.equal(wikiOccurrences(body)[0]!.label, 'Alias')
  assert.equal(wikiOccurrences(body)[2]!.anchor, 'Époque, ancienne')
  assert.equal(body.slice(wikiOccurrences(body)[0]!.start, wikiOccurrences(body)[0]!.end), '[[Visible|Alias]]')
})

test('GFM escaped wikilink aliases resolve a unique basename outside the source folder', () => {
  const body = '| Référence |\n|---|\n|[[Cible\\|Alias]]|'
  const catalog = buildReferenceCatalog([entity('source', 'Source', body), entity('target', 'Autre titre')], [
    origin('source', 'Dossier/Source.md'), origin('target', 'Ailleurs/Cible.md'),
  ])
  assert.equal(catalog.detail('source', stamp)!.links[0]!.href, '/admin/fiches/target')
  assert.equal(catalog.detail('source', stamp)!.links[0]!.label, 'Alias')
})

test('confirmed paths resolve aliases, accents, punctuation, sections and aggregate occurrences without altering bodies', () => {
  const body = '[[Région/Été, ancien|Destination]] [[Été, ancien]] [[Alias pertinent#Histoire & époque]] [[Été, ancien#Inconnue]]'
  const entities = [entity('source', 'Source', body), entity('target', 'Titre éditorial', '## Histoire & époque\n\nTexte de test.')]
  const catalog = buildReferenceCatalog(entities, [origin('source', 'Source.md'), origin('target', 'Région/Été, ancien.md', { aliases: ['Alias pertinent'] })])
  const detail = catalog.detail('source', stamp)!
  assert.deepEqual(detail.links.map(link => link.href), ['/admin/fiches/target', '/admin/fiches/target', '/admin/fiches/target#obsidian-histoire-%C3%A9poque', '/admin/fiches/target'])
  assert.equal(detail.outgoing.length, 1)
  assert.equal(detail.outgoing[0]!.occurrences, 4)
  assert.equal(detail.stats.resolved, 3)
  assert.match(detail.diagnostics[0]!.message, /Section absente/)
  assert.equal(catalog.detail('target', stamp)!.incoming[0]!.id, 'source')
  assert.equal(catalog.graph().edges[0]!.occurrences, 4)
  assert.equal(entities[0]!.bodyMarkdown, body)
  assert.equal(catalog.detail('source', '2026-10-02T00:00:00.000Z'), undefined)
})

test('same titles in different folders remain ambiguous until an explicit path is used', () => {
  const catalog = buildReferenceCatalog([entity('source', 'Source', '[[Barolt]] [[Divinités/Barolt]] [[Villes/Barolt|La ville]]'),
    entity('barolt-divinite', 'Barolt'), entity('barolt-ville', 'Barolt')], [origin('source', 'Source.md'),
    origin('barolt-divinite', 'Divinités/Barolt.md'), origin('barolt-ville', 'Villes/Barolt.md')])
  const detail = catalog.detail('source', stamp)!
  assert.deepEqual(detail.links.map(link => link.href), [null, '/admin/fiches/barolt-divinite', '/admin/fiches/barolt-ville'])
  assert.equal(detail.stats.ambiguous, 1)
  assert.equal(detail.outgoing.length, 2)
})

test('known empty/non-promoted paths are retained and never redirected to a same-title Entity', () => {
  const catalog = buildReferenceCatalog([entity('source', 'Source', '[[Vide]] [[Autres/Vide]] [[Inconnue]]'), entity('other', 'Vide')], [
    origin('source', 'Source.md', { obsidian: { wikilinks: [{ status: 'FOUND', path: 'Autres/Vide.md' }] } }),
    origin('other', 'Lieux/Vide.md'),
  ])
  const detail = catalog.detail('source', stamp)!
  assert.deepEqual(detail.links.map(link => link.href), [null, null, null])
  assert.deepEqual(detail.stats, { occurrences: 3, resolved: 0, ambiguous: 1, missing: 1, unassociated: 1, unsupported: 0 })
  assert.equal(catalog.graph().edges.length, 0)
})

test('case and Unicode normalization cannot bypass absent identities or collapse distinct paths', () => {
  const entities = [entity('source', 'Source', '[[vide]] [[re\u0301gion/e\u0301te\u0301]] [[Doublon]]'),
    entity('target', 'Été'), entity('a', 'Doublon'), entity('b', 'Doublon')]
  const catalog = buildReferenceCatalog(entities, [origin('source', 'Source.md', { obsidian: { wikilinks: [{ status: 'FOUND', path: 'Vide.md' }] } }),
    origin('target', 'Région/Été.md'), origin('a', 'Doublon.md'), origin('b', 'doublon.md')])
  assert.deepEqual(catalog.detail('source', stamp)!.links.map(link => link.href), [null, '/admin/fiches/target', null])
  assert.equal(catalog.detail('source', stamp)!.stats.unassociated, 1)
  assert.equal(catalog.detail('source', stamp)!.stats.ambiguous, 1)
})

test('original ambiguities involving an unexported placeholder cannot become arbitrary links after promotion', () => {
  const catalog = buildReferenceCatalog([entity('source', 'Source', '[[Homonyme]] [[HOMONYME.md]] [[Villes/Homonyme]]'), entity('target', 'Homonyme')], [
    origin('source', 'Source.md', { obsidian: { wikilinks: [{ status: 'AMBIGUOUS', target: 'Homonyme', path: null }] } }),
    origin('target', 'Villes/Homonyme.md'),
  ])
  assert.deepEqual(catalog.detail('source', stamp)!.links.map(link => link.href), [null, null, '/admin/fiches/target'])
  assert.equal(catalog.graph().edges.length, 1)
})

test('no unconfirmed identity, unsafe path, fuzzy match or cross-Source name establishes a destination', () => {
  const catalog = buildReferenceCatalog([entity('source', 'Source', '[[Voisin]] [[Voisinn]] [[../Inconnue]]'), entity('target', 'Voisin')], [
    origin('source', 'Source.md'), origin('target', 'Voisin.md', {}, 'other-vault'), origin('target', '../Unsafe.md'),
  ])
  assert.deepEqual(catalog.detail('source', stamp)!.links.map(link => link.href), [null, null, null])
  assert.equal(catalog.graph().edges.length, 0)
})

test('multiple confirmed origins require the same reliable destination in every Source', () => {
  const entities = [entity('source', 'Source', '[[Cible]]'), entity('a', 'Cible'), entity('b', 'Cible')]
  const catalog = buildReferenceCatalog(entities, [origin('source', 'Source.md'), origin('a', 'Cible.md'),
    origin('source', 'Source.md', {}, 'second'), origin('b', 'Cible.md', {}, 'second')])
  assert.equal(catalog.detail('source', stamp)!.stats.ambiguous, 1)
  assert.equal(catalog.graph().edges.length, 0)
})

test('public projection reveals neither private links, diagnostics, paths nor private homonym candidates', () => {
  const catalog = buildReferenceCatalog([
    entity('source', 'Source', '[[Visible]] [[Privé]] [[Commun]]', { status: 'PUBLISHED', visibility: 'PUBLIC' }),
    entity('visible', 'Visible', '', { status: 'PUBLISHED', visibility: 'PUBLIC' }),
    entity('private-slug', 'Privé'), entity('public-homonym', 'Commun', '', { status: 'PUBLISHED', visibility: 'PUBLIC' }), entity('hidden-homonym', 'Commun'),
  ], [origin('source', 'Source.md'), origin('visible', 'Visible.md'), origin('private-slug', 'Privé.md'),
    origin('public-homonym', 'A/Commun.md'), origin('hidden-homonym', 'B/Commun.md')])
  const navigation = catalog.navigation('source', stamp, true)!
  assert.deepEqual(navigation.links.map(link => link.href), ['/fiches/visible', null, null])
  assert.deepEqual(Object.keys(navigation).sort(), ['links', 'updatedAt'])
  assert.equal(JSON.stringify(navigation).includes('private-slug'), false)
  assert.equal(JSON.stringify(navigation).includes('hidden-homonym'), false)
  assert.equal(catalog.navigation('private-slug', stamp, true), undefined)
})

test('every private visibility and non-published state stays unlinked publicly', () => {
  for (const [status, visibility] of [['PUBLISHED', 'GM'], ['PUBLISHED', 'PLAYERS'], ['PUBLISHED', 'SECRET'], ['PROPOSED', 'PUBLIC'], ['DRAFT', 'PUBLIC'], ['ARCHIVED', 'PUBLIC']]) {
    const catalog = buildReferenceCatalog([entity('source', 'Source', '[[Cible]]', { status: 'PUBLISHED', visibility: 'PUBLIC' }),
      entity('target', 'Cible', '', { status, visibility })], [origin('source', 'Source.md'), origin('target', 'Cible.md')])
    assert.equal(catalog.navigation('source', stamp, true)!.links[0]!.href, null)
  }
})

test('duplicate headings and block anchors fall back to the fiche; self-sections remain reliable', () => {
  const catalog = buildReferenceCatalog([entity('source', 'Source', '[[#Unique]] [[#Dup]] [[#^bloc]]\n\n## Unique\n## Dup\n## Dup')], [origin('source', 'Source.md')])
  const detail = catalog.detail('source', stamp)!
  assert.deepEqual(detail.links.map(link => link.href), ['/admin/fiches/source#obsidian-unique', '/admin/fiches/source', '/admin/fiches/source'])
  assert.equal(detail.diagnostics.length, 2)
})

test('inclusions are diagnosed without turning into links or editorial relations', () => {
  const catalog = buildReferenceCatalog([entity('source', 'Source', '![[Cible]] [[image.svg]]'), entity('target', 'Cible')], [origin('source', 'Source.md'), origin('target', 'Cible.md')])
  assert.equal(catalog.detail('source', stamp)!.stats.unsupported, 2)
  assert.equal(catalog.detail('source', stamp)!.links.length, 1)
  assert.equal(catalog.graph().edges.length, 0)
})

test('catalogue output is deterministic and unique references differ from occurrences and graph arcs', () => {
  const entities = [entity('source', 'Source', '[[Cible]] [[Cible|Alias]] [[Cible#Section]] [[Absent]] [[Absent|Alias]]'), entity('target', 'Cible', '## Section')]
  const origins = [origin('source', 'Source.md'), origin('target', 'Cible.md')]
  const first = buildReferenceCatalog(entities, origins).graph(), second = buildReferenceCatalog([...entities].reverse(), [...origins].reverse()).graph()
  assert.deepEqual(first, second)
  assert.deepEqual(first.stats, { occurrences: 5, resolved: 2, missing: 1, ambiguous: 0, unassociated: 0, unsupported: 0 })
  assert.equal(first.edges.length, 1)
  assert.equal(first.edges[0]!.occurrences, 3)
  assert.equal(first.edges[0]!.origin, 'OBSIDIAN')
  assert.equal(Object.hasOwn(first.edges[0]!, 'status'), false)
})

test('Prisma reference projection performs only bounded reads inside a read-only consistent transaction', async () => {
  const queries: unknown[] = [], statements: string[] = []
  const prisma = { async $transaction(callback: (tx: unknown) => Promise<unknown>, options: unknown) {
    queries.push(options)
    return callback({
      async $executeRawUnsafe(sql: string) { statements.push(sql) },
      entity: { async findMany(query: unknown) { queries.push(query); return [entity('source', 'Source', '[[Cible]]'), entity('target', 'Cible')] } },
      ingestionAssociation: { async findMany(query: unknown) { queries.push(query); return [
        { sourceId: 'vault', externalId: 'Source.md', decisions: [{ entityId: 'source' }], item: { receipts: [] } },
        { sourceId: 'vault', externalId: 'Cible.md', decisions: [{ entityId: 'target' }], item: { receipts: [] } },
      ] } },
    })
  } } as unknown as PrismaClient
  const service = createPrismaReferenceService(prisma)
  assert.equal((await service.detail('source', stamp))!.outgoing.length, 1)
  assert.deepEqual(statements, ['SET TRANSACTION READ ONLY'])
  assert.deepEqual(queries[0], { isolationLevel: 'RepeatableRead', timeout: 15000 })
  const query = queries[2] as { where: unknown; take: number }
  assert.deepEqual(query.where, { source: { kind: 'OBSIDIAN' }, externalId: { not: null }, decisions: { some: { decision: 'CONFIRMED' } } })
  assert.equal(query.take, 4001)
})

test('over-limit catalogues fail explicitly rather than returning partial references', async () => {
  const prisma = { async $transaction(callback: (tx: unknown) => Promise<unknown>) {
    return callback({ async $executeRawUnsafe() {}, entity: { async findMany() { return Array.from({ length: 2001 }, (_, i) => entity(`id-${i}`, 'Note')) } },
      ingestionAssociation: { async findMany() { return [] } } })
  } } as unknown as PrismaClient
  await assert.rejects(createPrismaReferenceService(prisma).graph(), { status: 503, code: 'REFERENCES_LIMIT' })
})

test('admin graph appends textual arcs, filters dangling endpoints and leaves the public graph unchanged', async () => {
  let referenceReads = 0
  const prisma = { entity: { async findMany() { return [{ id: 'source' }, { id: 'target' }] } }, relation: { async findMany() { return [] } } } as unknown as PrismaClient
  const service = { async navigation() { return undefined }, async detail() { return undefined }, async graph() {
    referenceReads++
    return { stats: { occurrences: 2, resolved: 2, ambiguous: 0, missing: 0, unassociated: 0, unsupported: 0 }, edges: [
      { id: 'ok', source: 'source', target: 'target', origin: 'OBSIDIAN' as const, type: 'OBSIDIAN_REFERENCE', label: 'Référence', inverseLabel: null, symmetric: false },
      { id: 'dangling', source: 'source', target: 'missing', origin: 'OBSIDIAN' as const, type: 'OBSIDIAN_REFERENCE', label: 'Référence', inverseLabel: null, symmetric: false },
    ] }
  } }
  const store = createPrismaGraphStore(prisma, service)
  assert.equal((await store.publicGraph()).edges.length, 0)
  assert.equal(referenceReads, 0)
  assert.deepEqual((await store.adminGraph()).edges.map(edge => edge.id), ['ok'])
  assert.equal(referenceReads, 1)
})

test('public detail API returns only the safe navigation projection and never resolves a missing fiche', async () => {
  let reads = 0
  const store = { async ping() {}, async listEntities() { return [] }, async listRelationTypes() { return [] }, async getEntityBySlug(slug: string) {
    return slug === 'source' ? { ...entity('source', 'Source', '[[Cible]]'), kind: 'OTHER' as const, placeKind: null, summary: null, tags: [],
      createdAt: stamp, updatedAt: stamp, publishedAt: stamp, status: 'PUBLISHED' as const, visibility: 'PUBLIC' as const, outgoingRelations: [], incomingRelations: [] } : null
  } }
  const server = createApp(store, undefined, undefined, { async navigation() { reads++; return { updatedAt: stamp, links: [{ start: 0, end: 9, label: 'Cible', href: null }] } },
    async detail() { throw new Error('Private projection called') }, async graph() { throw new Error('Private projection called') } }).listen(0, '127.0.0.1')
  try {
    await once(server, 'listening')
    const address = server.address(); assert.ok(address && typeof address !== 'string')
    const base = `http://127.0.0.1:${address.port}`
    const response = await fetch(`${base}/api/v1/entities/source`)
    assert.equal(response.status, 200)
    assert.equal((await response.json() as { wikiNavigation: { links: unknown[] } }).wikiNavigation.links.length, 1)
    assert.equal((await fetch(`${base}/api/v1/entities/missing`)).status, 404)
    assert.equal(reads, 1)
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})

test('administrator reference diagnostics require whitelisted authentication and no-store', async () => {
  const config = readAuthConfig({ DISCORD_CLIENT_ID: '111111111111111111', DISCORD_CLIENT_SECRET: 'fake',
    DISCORD_REDIRECT_URI: 'http://localhost:5173/api/auth/discord/callback', DISCORD_ADMIN_IDS: '222222222222222222',
    SESSION_SECRET: 'a-test-secret-of-more-than-thirty-two-characters', SESSION_TTL_MS: '3600000' })
  let reads = 0
  const adminEntity = { ...entity('source', 'Source', '[[Vide]]'), kind: 'OTHER' as const, placeKind: null, summary: null, tags: [],
    status: 'PROPOSED' as const, visibility: 'GM' as const, updatedAt: stamp, createdAt: stamp, publishedAt: null,
    evidence: [], outgoingRelations: [], incomingRelations: [], revisions: [] }
  const server = createApp({ async ping() {}, async listRelationTypes() { return [] }, async listEntities() { return [] }, async getEntityBySlug() { return null } }, {
    auth: { config, store: { async findSession(hash) {
      const discordId = hash === sessionHash('a'.repeat(43)) ? '222222222222222222' : hash === sessionHash('b'.repeat(43)) ? '333333333333333333' : null
      return discordId ? { discordId, username: 'editor', displayName: null, expiresAt: new Date(Date.now() + 60000) } : null
    }, async rotateSession() {}, async revokeSession() {} }, discord: { authorizationUrl: () => '', async exchangeCode() { throw new Error('unused') } } },
    admin: { async getEntity() { return adminEntity }, async listEntities() { return { items: [], total: 0, page: 1, pageSize: 50 } }, async getStats() { throw new Error('unused') } },
    editorial: { async patch() { throw new Error('unused') }, async publish() { throw new Error('unused') }, async unpublish() { throw new Error('unused') } },
    references: { async detail() { reads++; return buildReferenceCatalog([entity('source', 'Source', '[[Vide]]')], [origin('source', 'Source.md')]).detail('source', stamp) },
      async navigation() { throw new Error('unused') }, async graph() { throw new Error('unused') } },
  }).listen(0, '127.0.0.1')
  try {
    await once(server, 'listening')
    const address = server.address(); assert.ok(address && typeof address !== 'string')
    const url = `http://127.0.0.1:${address.port}/api/admin/entities/source`
    assert.equal((await fetch(url)).status, 401)
    assert.equal((await fetch(url, { headers: { Cookie: `hesta_codex_session=${'b'.repeat(43)}` } })).status, 403)
    assert.equal(reads, 0)
    const response = await fetch(url, { headers: { Cookie: `hesta_codex_session=${'a'.repeat(43)}` } })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal((await response.json() as { obsidianReferences: { diagnostics: unknown[] } }).obsidianReferences.diagnostics.length, 1)
    assert.equal(reads, 1)
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
