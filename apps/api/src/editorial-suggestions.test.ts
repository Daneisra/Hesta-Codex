import assert from 'node:assert/strict'
import { test, before, beforeEach, after } from 'node:test'
import { readdir, readFile } from 'node:fs/promises'
import { once } from 'node:events'
import type { Server } from 'node:http'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { PrismaPg } from '@prisma/adapter-pg'
import { buildVocabulary, proseRanges, scanConnections, suggestTerms, createPrismaEditorialSuggestionService, type SuggestionNote } from './editorial-suggestions.js'
import { buildReferenceCatalog, createPrismaReferenceService } from './obsidian-references.js'
import { PrismaClient } from './prisma-client/client.ts'
import { createPrismaEditorialService } from './admin/editorial.js'
import { createPrismaAdminStore } from './admin/store.js'
import { createPrismaStore } from './store.js'
import { createApp } from './app.js'
import { readAuthConfig } from './auth/config.js'
import { sessionHash, sessionCookieName } from './auth/session.js'
import { publicWikiView } from './public-wiki.js'
import { markdownTree, wikiOccurrences } from '@hesta-codex/shared'
import { sha256, itemIdentity } from './ingestion/format.js'
import { createPrismaQualificationService } from './reference-qualification.js'

const stamp = new Date('2026-10-01T00:00:00Z'), id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const note = (n: number, title: string, bodyMarkdown = '', extra: Partial<SuggestionNote> = {}): SuggestionNote => ({ id: id(n), slug: `fiche-${n}`, title,
  bodyMarkdown, aliases: [], tags: [], status: 'PROPOSED', visibility: 'GM', updatedAt: stamp, kind: 'CONCEPT', ...extra })
const scan = (entities: SuggestionNote[], relations: Array<{ fromEntityId: string; toEntityId: string }> = []) => scanConnections({ entities, relations, origins: [] })

test('scan finds bounded Unicode names, aliases, longest matches and exact source offsets without fuzzy matching', () => {
  const body = '🦊 Étoile du Nord, E\u0301toile du Nord et la Vigie. Pas SuperVigie ni Étoiles.'
  const plan = scan([note(1, 'Départ', body), note(2, 'Étoile'), note(3, 'Étoile du Nord', '', { aliases: ['Vigie'] })])
  assert.equal(plan.items.length, 1); assert.equal(plan.occurrences, 3)
  assert.equal(plan.items[0]!.to.id, id(3))
  for (const item of plan.items[0]!.occurrences) assert.equal(body.slice(item.start, item.end), item.text)
  assert.deepEqual(plan.items[0]!.occurrences.map(item => item.wikilink), ['[[/fiches/fiche-3|Étoile du Nord]]', '[[/fiches/fiche-3|E\u0301toile du Nord]]', '[[/fiches/fiche-3|Vigie]]'])
})

test('scan separates unresolved wikilinks from prose while excluding escaped links, code, HTML, images and frontmatter', () => {
  const body = ['---', 'title: Cible', '---', 'Cible', '`Cible`', '```md', 'Cible', '```', '', '    Cible', '',
    '[[Cible]] \\[[Cible]] ![[Cible]]', '[Cible](https://example.test)', '![Cible](image.png)', '<!-- Cible -->', '$Cible$'].join('\n')
  assert.equal(proseRanges(body).map(range => range.text).join(' ').match(/Cible/g)?.length, 1)
  const plan = scan([note(1, 'Départ', body), note(2, 'Cible')])
  assert.equal(plan.occurrences, 2); assert.equal(plan.repairs, 1)
})

test('existing editorial or textual connections in either direction suppress duplicate proposals and preserve self exclusions', () => {
  const entities = [note(1, 'Départ', 'Départ Cible Cible'), note(2, 'Cible', 'Départ')]
  assert.equal(scan(entities).items.length, 2)
  assert.equal(scan(entities, [{ fromEntityId: id(2), toEntityId: id(1) }]).items.length, 0)
  assert.equal(scan([{ ...entities[0]!, bodyMarkdown: '[[/fiches/fiche-2|Cible]] Cible' }, entities[1]!]).items.length, 0)
})

test('scan proposes repairing unassociated wikilinks to a new manual fiche despite an existing reverse connection', () => {
  const entities = [note(1, 'Port fictif', '[[Maison Ardoise]] et [[Maison Ardoise|La maison]].'),
    note(2, 'Maison Ardoise', '[[/fiches/fiche-1|Port fictif]]')]
  const origins = [{ entityId: id(1), sourceId: 'fictive', path: 'Villes/Port.md', metadata: {
    obsidian: { wikilinks: [{ status: 'FOUND', path: 'Familles/Maison Ardoise.md' }] },
  } }]
  const before = buildReferenceCatalog(entities, origins)
  assert.equal(before.detail(id(1), stamp.toISOString())!.stats.unassociated, 1)
  assert.equal(before.graph().edges.length, 1)
  const plan = scanConnections({ entities, origins, relations: [] })
  assert.equal(plan.items.length, 1)
  assert.equal(plan.items[0]!.from.id, id(1)); assert.equal(plan.items[0]!.to.id, id(2))
  assert.deepEqual(plan.items[0]!.occurrences.map(item => item.wikilink), ['[[/fiches/fiche-2|Maison Ardoise]]', '[[/fiches/fiche-2|La maison]]'])
  assert.equal(plan.repairs, 2)
  assert.equal(plan.items[0]!.occurrences.every(item => item.repair), true)
})

test('repairs preserve aliases, anchors and GFM table structure, including newly linked prose in a table', () => {
  const body = '[[Cible#Section|Alias]]\n\n| Nom |\n|---|\n|[[Cible\\|Alias tableau]]|\n|Cible|'
  const plan = scan([note(1, 'Départ', body), note(2, 'Cible', '## Section')])
  assert.equal(plan.repairs, 2); assert.equal(plan.occurrences, 3)
  let updated = body
  for (const item of [...plan.items[0]!.occurrences].reverse()) updated = updated.slice(0, item.start) + item.wikilink + updated.slice(item.end)
  assert.ok(updated.includes('[[/fiches/fiche-2#Section|Alias]]'))
  assert.ok(updated.includes('[[/fiches/fiche-2\\|Alias tableau]]'))
  assert.ok(updated.includes('[[/fiches/fiche-2\\|Cible]]'))
  assert.deepEqual(wikiOccurrences(updated).map(link => link.label), ['Alias', 'Alias tableau', 'Cible'])
  const table = markdownTree(updated).children.find(node => node.type === 'table')!
  assert.equal(table.children.length, 3)
  assert.equal(table.children.every(row => row.children.length === 1), true)
})

test('repairs leave original ambiguities, absent targets, explicit paths and archived destinations unresolved', () => {
  const entities = [note(1, 'Départ', '[[Commun]] [[Absent]] [[Dossier/Cible]] [[Archive]]\n\n$$ [[Cible]] $$\n\n$[[Cible]]$'), note(2, 'Commun'), note(3, 'Cible'), note(4, 'Archive', '', { status: 'ARCHIVED' })]
  const origins = [{ entityId: id(1), sourceId: 'fictive', path: 'Départ.md', metadata: { obsidian: { wikilinks: [{ status: 'AMBIGUOUS', target: 'Commun' }] } } },
    { entityId: id(2), sourceId: 'fictive', path: 'Commun.md', metadata: {} }]
  assert.equal(scanConnections({ entities, origins, relations: [] }).items.length, 0)
})

test('current title/alias homonyms are diagnostic only, even when one candidate is the mentioning fiche', () => {
  const plan = scan([note(1, 'Départ', 'Cible'), note(2, 'Cible'), note(3, 'Autre', '', { aliases: ['Cible'] })])
  assert.equal(plan.items.length, 0); assert.equal(plan.ambiguous, 1)
  assert.deepEqual(plan.ambiguities[0]!.candidates, ['Cible', 'Autre'])
})

test('archived notes are excluded, deleted notes are not recreated, scan ordering/fingerprints are deterministic', () => {
  const entities = [note(1, 'Départ', 'Cible Disparue Archive'), note(2, 'Cible'), note(3, 'Archive', 'Cible', { status: 'ARCHIVED' })]
  assert.deepEqual(scan(entities), scan([...entities].reverse()))
  assert.equal(scan(entities).items.length, 1)
  assert.equal(scan(entities.slice(0, 1)).items.length, 0)
  assert.notEqual(scan(entities).items[0]!.fingerprint, scan([{ ...entities[0]!, aliases: ['Nouveau'] }, ...entities.slice(1)]).items[0]!.fingerprint)
})

test('regex metacharacters and Markdown delimiters do not execute or corrupt generated links', () => {
  const plan = scan([note(1, 'Départ', 'A+B (Nord) Cible[brisée] .*'), note(2, 'A+B (Nord)'), note(3, 'Cible[brisée]'), note(4, '.*')])
  assert.equal(plan.items.some(item => item.to.id === id(2)), true)
  assert.equal(plan.items.some(item => item.to.id === id(3)), false)
})

test('punctuated titles remain eligible without turning comma-separated form suggestions into invalid values', () => {
  const plan = scan([note(1, 'Départ', 'Été, ancien se trouve près de La Côte #2.'), note(2, 'Été, ancien'), note(3, 'La Côte #2')])
  assert.equal(plan.items.length, 2)
  assert.deepEqual(plan.items.flatMap(item => item.occurrences.map(occurrence => occurrence.text)).sort(), ['La Côte #2', 'Été, ancien'])
})

test('vocabulary reuses valid tags and shows ownership of aliases without mutating notes', () => {
  const entities = [note(1, 'Un', '', { tags: ['Magie'], aliases: ['La Vigie'] }), note(2, 'Deux', '', { tags: ['magie'], aliases: ['La Vigie'] })]
  const saved = JSON.stringify(entities), vocabulary = buildVocabulary(entities)
  assert.equal(vocabulary.tags[0]!.count, 2); assert.equal(vocabulary.aliases[0]!.owners.length, 2)
  assert.equal(JSON.stringify(entities), saved)
})

test('content suggestions use written aliases, hashtags and existing tag mentions, explaining collisions and avoiding code', () => {
  const entities = [note(1, 'Autre', '', { tags: ['Magie', 'Combat'], aliases: ['La Vigie'] })]
  const draft = { entityId: null, title: 'Tour (La Vigie)', bodyMarkdown: 'Surnommée « Tour bleue ». Magie et #Rituel. `Combat`', aliases: [], tags: [] }
  const result = suggestTerms(entities, draft)
  assert.deepEqual(result.aliases.map(item => item.value), ['La Vigie', 'Tour bleue'])
  assert.deepEqual(result.aliases[0]!.conflicts, ['Autre'])
  assert.deepEqual(result.tags.map(item => item.value), ['Rituel', 'Magie'])
  assert.equal(suggestTerms(entities, { ...draft, aliases: ['la vigie'], tags: ['magie', 'rituel'] }).tags.length, 0)
})

test('alias suggestions include resolved incoming Obsidian labels, excluding ambiguous links and self claims', () => {
  const entities = [note(1, 'Cible'), note(2, 'Départ', '[[Cible|La Vigie]] [[Absente|Autre nom]]')]
  const origins = entities.map(entity => ({ entityId: entity.id, sourceId: 'fictive', path: `${entity.title}.md`, metadata: {} }))
  const result = suggestTerms(entities, { entityId: id(1), title: 'Cible', bodyMarkdown: '', aliases: [], tags: [] }, origins)
  assert.deepEqual(result.aliases.map(item => item.value), ['La Vigie'])
})

for (const size of [130, 500]) test(`scan handles ${size} synthetic notes without partial groups or occurrence duplication`, () => {
  const entities = Array.from({ length: size }, (_, index) => note(index + 1, `Note fictive ${index + 1}`,
    Array.from({ length: 5 }, (_, next) => `Note fictive ${(index + next + 1) % size + 1}`).join('. ') + '.'))
  const plan = scan(entities)
  assert.equal(plan.entities, size); assert.equal(plan.items.length, size * 5); assert.equal(plan.occurrences, size * 5)
  assert.equal(plan.ambiguous, 0)
})

test('explicit Codex wikilinks navigate manual notes and anchors while private destinations remain unlinked publicly', () => {
  const source = note(1, 'Départ', '[[/fiches/fiche-2#Histoire|Un nom]]', { status: 'PUBLISHED', visibility: 'PUBLIC' })
  const target = note(2, 'Cible', '## Histoire')
  const catalog = buildReferenceCatalog([source, target], [])
  assert.equal(catalog.detail(id(1), stamp.toISOString())!.links[0]!.href, '/admin/fiches/fiche-2#obsidian-histoire')
  assert.equal(catalog.detail(id(2), stamp.toISOString())!.incoming.length, 1)
  assert.equal(catalog.navigation(id(1), stamp.toISOString(), true)!.links[0]!.href, null)
  assert.equal(catalog.graph().edges.length, 1)
  assert.equal(buildReferenceCatalog([source], []).graph().edges.length, 0)
})

test('public projection removes private targeted slugs and remaps later visible links without modifying the original Markdown', () => {
  const body = '[[/fiches/private-secret|A+B]] puis [[/fiches/public|Public]] et [[/fiches/missing|Absente]].'
  const entities = [note(1, 'Départ', body, { status: 'PUBLISHED', visibility: 'PUBLIC' }), note(2, 'Privée', '', { slug: 'private-secret' }),
    note(3, 'Public', '', { slug: 'public', status: 'PUBLISHED', visibility: 'PUBLIC' })]
  const navigation = buildReferenceCatalog(entities, []).navigation(id(1), stamp.toISOString(), true)!
  const result = publicWikiView(body, navigation)
  assert.equal(JSON.stringify(result).includes('private-secret'), false); assert.equal(JSON.stringify(result).includes('/fiches/missing'), false)
  assert.equal(result.bodyMarkdown, 'A\\+B puis [[/fiches/public|Public]] et Absente.')
  const link = result.wikiNavigation!.links[0]!
  assert.equal(result.bodyMarkdown.slice(link.start, link.end), '[[/fiches/public|Public]]')
  assert.equal(link.href, '/fiches/public')
  assert.equal(publicWikiView(body).bodyMarkdown.includes('/fiches/'), false)
  assert.equal(entities[0]!.bodyMarkdown, body)
})

test('scan leaves Markdown character entities and a backslash preceding a name intact', () => {
  const plan = scan([note(1, 'Départ', '&amp; \\Cible Cible'), note(2, 'amp'), note(3, 'Cible')])
  assert.equal(plan.items.length, 1); assert.equal(plan.occurrences, 1)
  assert.equal(plan.items[0]!.occurrences[0]!.start, 13)
})

test('scan never nests links in formatted or unfinished wikilinks or multiline math blocks', () => {
  const body = '[[**Cible**]]\n\n$$\nCible\n$$\n\nCible puis [[Cible inachevée'
  const plan = scan([note(1, 'Départ', body), note(2, 'Cible')])
  assert.equal(plan.occurrences, 1)
  assert.equal(plan.items[0]!.occurrences[0]!.start, body.indexOf('Cible puis'))
})

const db = new PGlite(), socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0, maxConnections: 1 })
let prisma: PrismaClient, service: ReturnType<typeof createPrismaEditorialSuggestionService>, server: Server, base: string
const actor = '222222222222222222', config = readAuthConfig({ DISCORD_CLIENT_ID: '111111111111111111', DISCORD_CLIENT_SECRET: 'fictif',
  DISCORD_REDIRECT_URI: 'http://localhost:5173/api/auth/discord/callback', DISCORD_ADMIN_IDS: actor,
  SESSION_SECRET: 'a-fictional-session-secret-with-more-than-32-characters', SESSION_TTL_MS: '3600000' })
const cookie = (char = 'a') => `${sessionCookieName(config)}=${char.repeat(43)}`
const tables = ['Entity', 'Revision', 'Relation', 'Evidence', 'Source', 'IngestionBatch', 'IngestionItem', 'IngestionReceipt', 'IngestionAssociation', 'EntityImage']
const snapshots = () => Promise.all(tables.map(table => db.query(`SELECT * FROM "${table}" ORDER BY 1`).then(result => result.rows)))
before(async () => {
  const migrations = new URL('../../../prisma/migrations/', import.meta.url)
  for (const name of (await readdir(migrations)).filter(name => /^\d/.test(name)).sort()) await db.exec(await readFile(new URL(`${name}/migration.sql`, migrations), 'utf8'))
  await socket.start()
  prisma = new PrismaClient({ adapter: new PrismaPg({ host: '127.0.0.1', port: Number(socket.getServerConn().split(':')[1]), database: 'postgres', user: 'postgres', max: 1 }) })
  service = createPrismaEditorialSuggestionService(prisma)
  server = createApp(createPrismaStore(prisma), { suggestions: service, editorial: createPrismaEditorialService(prisma), admin: createPrismaAdminStore(prisma),
    references: createPrismaReferenceService(prisma), auth: { config, store: {
      async findSession(hash) { const discordId = hash === sessionHash('a'.repeat(43)) ? actor : hash === sessionHash('b'.repeat(43)) ? '333333333333333333' : null
        return discordId ? { discordId, username: 'Auteur fictif', displayName: null, expiresAt: new Date(Date.now() + 60000) } : null },
      async rotateSession() {}, async revokeSession() {},
    }, discord: { authorizationUrl: () => '', async exchangeCode() { throw new Error('unused') } } },
  }, undefined, createPrismaReferenceService(prisma)).listen(0, '127.0.0.1')
  await once(server, 'listening'); const address = server.address(); assert.ok(address && typeof address !== 'string'); base = `http://127.0.0.1:${address.port}`
})
beforeEach(async () => {
  await db.exec('DROP TRIGGER IF EXISTS suggestion_failure ON "Revision"; TRUNCATE "Entity", "Source", "IngestionBatch" CASCADE;')
  await prisma.entity.createMany({ data: [
    { id: id(1), slug: 'depart', title: 'Départ', bodyMarkdown: 'Cible et Cible.', aliases: [], tags: [], kind: 'CONCEPT', status: 'PROPOSED', visibility: 'GM', updatedAt: stamp },
    { id: id(2), slug: 'cible', title: 'Cible', bodyMarkdown: '## Histoire', aliases: ['Destination'], tags: ['Magie'], kind: 'PLACE', placeKind: 'CITY', status: 'PROPOSED', visibility: 'GM', updatedAt: stamp },
  ] })
  await prisma.source.create({ data: { id: id(50), kind: 'MANUAL', label: 'Source fictive' } })
  await prisma.evidence.create({ data: { sourceId: id(50), entityId: id(1), claimText: 'Origine fictive' } })
  await prisma.revision.create({ data: { entityId: id(1), number: 1, snapshot: { fictif: true }, editorLabel: 'Auteur fictif' } })
})
after(async () => { server?.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await prisma?.$disconnect(); await socket.stop(); await db.close() })
const approved = async () => { const item = (await service.scan(1)).items[0]!; return { id: item.id, fingerprint: item.fingerprint, confirm: true as const } }
const author = { label: 'Auteur humain fictif', discordId: actor }
const post = (path: string, body: unknown, token = 'a', origin = 'http://localhost:5173') => fetch(base + path, { method: 'POST', headers: {
  Cookie: cookie(token), Origin: origin, 'Content-Type': 'application/json',
}, body: JSON.stringify(body) })

test('scan/vocabulary/content analysis are read-only with bounded responses and explicit counts', async () => {
  const before = await snapshots(), plan = await service.scan(1)
  assert.equal(plan.entities, 2); assert.equal(plan.connections, 1); assert.equal(plan.occurrences, 2)
  assert.equal(plan.pageSize, 30); assert.equal((await service.vocabulary()).tags[0]!.value, 'Magie')
  assert.equal((await service.terms({ entityId: id(1), title: 'Départ', bodyMarkdown: 'Magie', aliases: [], tags: [] })).tags.length, 1)
  assert.deepEqual(await snapshots(), before)
})

test('validated application preserves text and provenance, records a human revision and is idempotent', async () => {
  const input = await approved(), before = await snapshots(), updated = await service.apply(input, author)
  assert.equal(updated.bodyMarkdown, '[[/fiches/cible|Cible]] et [[/fiches/cible|Cible]].')
  assert.equal(updated.status, 'PROPOSED'); assert.equal(updated.visibility, 'GM'); assert.equal(updated.publishedAt, null)
  const revisions = await prisma.revision.findMany({ where: { entityId: id(1) }, orderBy: { number: 'asc' } })
  assert.equal(revisions.length, 2); assert.equal(revisions[1]!.editorLabel, author.label)
  assert.match(revisions[1]!.message!, /après revue du scan/)
  const after = await snapshots()
  for (let i = 2; i < tables.length; i++) assert.deepEqual(after[i], before[i], tables[i])
  assert.equal((await service.scan(1)).connections, 0)
  await assert.rejects(service.apply(input, author), { status: 409 })
  assert.equal(await prisma.revision.count(), 2)
})

test('reviewed repair clears technical diagnostics for a manual destination while preserving staging and the reverse link', async () => {
  const original = '[[Cible]] et [[Cible|La ville]].', path = 'Notes/Depart.md', contentHash = sha256(original), identityKey = itemIdentity(path, contentHash)
  await prisma.entity.update({ where: { id: id(1) }, data: { bodyMarkdown: original } })
  const reverse = '[[/fiches/depart|Départ]]'
  await prisma.entity.update({ where: { id: id(2) }, data: { bodyMarkdown: reverse } })
  await prisma.source.create({ data: { id: id(51), kind: 'OBSIDIAN', label: 'Coffre fictif', externalId: 'coffre-fictif' } })
  await prisma.ingestionBatch.create({ data: { id: id(52), label: 'Lot fictif', receivedCount: 1, newCount: 1, unchangedCount: 0, modifiedCount: 0 } })
  await prisma.ingestionItem.create({ data: { id: id(53), sourceId: id(51), batchId: id(52), identityKey, externalId: path, version: 1, contentHash, content: original } })
  await prisma.ingestionReceipt.create({ data: { id: id(54), batchId: id(52), itemId: id(53), ordinal: 0, outcome: 'NEW', title: 'Départ', locator: path,
    contentType: 'text/markdown', metadata: { obsidian: { wikilinks: [{ status: 'FOUND', path: 'Lieux/Cible.md' }] } } } })
  await prisma.ingestionAssociation.create({ data: { id: id(55), itemId: id(53), sourceId: id(51), identityKey, externalId: path } })
  await prisma.ingestionAssociationDecision.create({ data: { id: id(56), associationId: id(55), entityId: id(1), decision: 'CONFIRMED',
    origin: 'MANUAL', authorDiscordId: actor, authorLabel: 'Auteur fictif' } })
  const qualification = createPrismaQualificationService(prisma), references = createPrismaReferenceService(prisma)
  const diagnostics = await qualification.list({ page: 1, view: 'diagnostics' })
  assert.equal(diagnostics.diagnosticTotal, 1)
  assert.equal(diagnostics.diagnostics[0]!.target, 'Cible'); assert.equal(diagnostics.diagnostics[0]!.occurrences, 2)
  const before = await snapshots(), decisions = await prisma.ingestionAssociationDecision.findMany()
  const plan = await service.scan(1), group = plan.items[0]!
  assert.equal(plan.connections, 1); assert.equal(plan.repairs, 2)
  assert.deepEqual(await snapshots(), before)
  const input = { id: group.id, fingerprint: group.fingerprint, confirm: true as const }
  const updated = await service.apply(input, author)
  assert.equal(updated.bodyMarkdown, '[[/fiches/cible|Cible]] et [[/fiches/cible|La ville]].')
  assert.equal((await qualification.list({ page: 1, view: 'diagnostics' })).diagnosticTotal, 0)
  assert.equal((await qualification.detail(id(1), updated.updatedAt))!.outgoing[0]!.occurrences, 2)
  const target = await prisma.entity.findUniqueOrThrow({ where: { id: id(2) } })
  assert.equal(target.bodyMarkdown, reverse)
  assert.equal((await references.detail(id(2), target.updatedAt.toISOString()))!.incoming[0]!.id, id(1))
  assert.equal((await references.graph()).edges.length, 2)
  assert.equal((await fetch(base + '/api/v1/entities/depart')).status, 404)
  const after = await snapshots()
  for (let i = 2; i < tables.length; i++) assert.deepEqual(after[i], before[i], tables[i])
  assert.deepEqual(await prisma.ingestionAssociationDecision.findMany(), decisions)
  assert.equal(await prisma.revision.count(), 2)
  assert.equal((await service.scan(1)).connections, 0)
  await assert.rejects(service.apply(input, author), { status: 409 })
})

test('a failure creating the revision rolls back all Markdown changes', async () => {
  const input = await approved(), before = await snapshots()
  await db.exec(`CREATE OR REPLACE FUNCTION fail_suggestion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected revision failure'; END; $$;
    CREATE TRIGGER suggestion_failure BEFORE INSERT ON "Revision" FOR EACH ROW EXECUTE FUNCTION fail_suggestion();`)
  await assert.rejects(service.apply(input, author), /Injected revision failure/)
  assert.deepEqual(await snapshots(), before)
})

test('source edits, target identity changes and deletion invalidate the reviewed scan without writing', async () => {
  for (const change of [
    () => prisma.entity.update({ where: { id: id(1) }, data: { bodyMarkdown: 'Cible change.' } }),
    () => prisma.entity.update({ where: { id: id(2) }, data: { aliases: ['Nouveau nom'] } }),
    () => prisma.entity.delete({ where: { id: id(2) } }),
  ]) {
    const input = await approved(); await change(); const before = await snapshots()
    await assert.rejects(service.apply(input, author), { status: 409 }); assert.deepEqual(await snapshots(), before)
  }
})

test('concurrent double application creates one revision only', async () => {
  const input = await approved(), results = await Promise.allSettled([service.apply(input, author), service.apply(input, author)])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(await prisma.revision.count(), 2)
})

test('oversized insertion and missing confirmation fail rather than truncating or partially writing', async () => {
  await prisma.entity.update({ where: { id: id(1) }, data: { bodyMarkdown: 'x'.repeat(99990) + ' Cible' } })
  const input = await approved(), before = await snapshots()
  await assert.rejects(service.apply({ ...input, confirm: false as true }, author), { status: 400 })
  await assert.rejects(service.apply(input, author), { status: 400 })
  assert.deepEqual(await snapshots(), before)
})

test('published/public edits retain status and publication date and private targets do not leak publicly', async () => {
  await prisma.entity.update({ where: { id: id(1) }, data: { status: 'PUBLISHED', visibility: 'PUBLIC', publishedAt: stamp } })
  const updated = await service.apply(await approved(), author)
  assert.equal(updated.publishedAt, stamp.toISOString()); assert.equal(updated.status, 'PUBLISHED')
  const publicView = await fetch(base + '/api/v1/entities/depart'), data = await publicView.json() as { bodyMarkdown: string; wikiNavigation: { links: Array<{ href: string | null }> } }
  assert.equal(publicView.status, 200); assert.equal(data.wikiNavigation.links.every(link => link.href === null), true)
  assert.equal(JSON.stringify(data).includes('/fiches/cible'), false)
  assert.equal(data.bodyMarkdown, 'Cible et Cible.')
})

test('admin endpoints enforce authentication, whitelist, Origin, strict payloads and no-store', async () => {
  for (const path of ['/api/admin/link-suggestions/scan', '/api/admin/link-suggestions/apply', '/api/admin/editorial-suggestions/terms']) {
    assert.equal((await fetch(base + path, { method: 'POST' })).status, 401)
    assert.equal((await post(path, {}, 'b')).status, 403)
    assert.equal((await post(path, {}, 'a', 'https://example.test')).status, 403)
  }
  const response = await post('/api/admin/link-suggestions/scan', { page: 1 })
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal((await post('/api/admin/link-suggestions/scan', { page: 0 })).status, 400)
  assert.equal((await post('/api/admin/link-suggestions/apply', { ...await approved(), confirm: false })).status, 400)
  assert.equal((await post('/api/admin/editorial-suggestions/terms', { entityId: null, title: '', bodyMarkdown: '', aliases: [], tags: [], extra: true })).status, 400)
  assert.equal((await fetch(base + '/api/admin/editorial-suggestions/vocabulary')).status, 401)
  assert.equal((await fetch(base + '/api/admin/editorial-suggestions/vocabulary', { headers: { Cookie: cookie() } })).headers.get('cache-control'), 'no-store')
})
