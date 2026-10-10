import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { itemIdentity, sha256 } from './format.js'
import { parsePromotionArgs, runPromotionCommand } from './promotion-command.js'
import { actorSchema, buildPromotionPlan, classifyNote, parseClassificationExceptions, PromotionError,
  type PromotionNote, type PromotionPlanOptions, type PromotionRepository, type PromotionSnapshot } from './promotion.js'

const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`
const actor = { discordId: '222222222222222222', label: 'Opérateur fictif' }
const now = new Date('2026-10-10T10:00:00Z')
const source = { id: uuid(1), kind: 'OBSIDIAN' as const, externalId: 'fictional-vault', label: 'Source fictive', visibility: 'GM' as const, updatedAt: now }
const options = (count: number): PromotionPlanOptions => ({ actor, expectedCount: count, allowProvisional: false, exceptions: [] })
function note(path: string, title: string, index = 2): PromotionNote {
  const content = `\uFEFF# ${title}\r\nTexte entièrement fictif. [[Lien fictif]]\r\n`
  return { id: uuid(index), sourceId: source.id, externalId: path, identityKey: itemIdentity(path, sha256(content)),
    contentHash: sha256(content), version: 1, associationRevision: 0, confirmedEntityId: null,
    receipt: { id: uuid(index + 100), title, locator: path, contentType: 'text/markdown', metadata: { tags: ['fiction'] },
      rawVariant: null, observedAt: now, ingestedAt: now, item: { content, version: 1 } } }
}
const snapshot = (notes: PromotionNote[]): PromotionSnapshot => ({ source, notes, occupiedSlugs: [] })
const args = (count = 1) => ['--source-external-id', source.externalId, '--author-discord-id', actor.discordId,
  '--author-label', actor.label, '--expected-count', String(count)]
function commandFixture(initial: PromotionSnapshot) {
  const state = structuredClone(initial), lines: string[] = [], writes: PromotionNote[] = []
  let opened = 0, closed = 0, failAt = -1, closeFailure = false
  const repository: PromotionRepository = {
    async snapshot(externalId) { assert.equal(externalId, source.externalId); return structuredClone(state) },
    async create(_source, current, input, author) {
      assert.deepEqual(author, actor)
      if (writes.length === failAt) throw new Error('PRIVATE fictional failure')
      const entityId = uuid(500 + writes.length)
      writes.push(current); state.notes.find(entry => entry.id === current.id)!.confirmedEntityId = entityId
      state.notes.find(entry => entry.id === current.id)!.associationRevision++
      state.occupiedSlugs.push({ id: entityId, slug: input.entity.slug })
      return 'created'
    },
  }
  const dependencies = { write: (line: string) => lines.push(line), async readClassifications() { return '{}' },
    async openDatabase() { opened++; return { repository, async close() { closed++; if (closeFailure) throw new Error('PRIVATE') } } } }
  return { state, lines, writes, repository, dependencies, opened: () => opened, closed: () => closed,
    failAt: (at: number) => { failAt = at }, closeFailure: () => { closeFailure = true } }
}

for (const [path, kind, placeKind, review] of [
  ['Artefacts/Fiction.md', 'ARTIFACT', null, false], ['Continents/Fiction.md', 'PLACE', 'CONTINENT', false],
  ['Créatures et Peuples/Fiction.md', 'OTHER', null, true], ['Divinités/Fiction.md', 'DEITY', null, false],
  ['Familles Nobles/Fiction.md', 'FAMILY', null, false], ['Hesta/Fiction.md', 'CONCEPT', null, false],
  ['Instances Autres/Fiction.md', 'ORGANIZATION', null, false], ['Instances Impériales/Fiction.md', 'ORGANIZATION', null, false],
  ['Instances/Militaires/Fiction.md', 'ORGANIZATION', null, false], ['Instances Religieuses/Fiction.md', 'OTHER', null, true],
  ['Lieux/Fiction.md', 'PLACE', 'OTHER', false], ['Notables/Notables Défunt/Fiction.md', 'PERSON', null, false],
  ['Villes/Fiction.md', 'PLACE', 'CITY', false], ['Non classé/Fiction.md', 'OTHER', null, true],
] as const) test(`promotion classifies fictional folder ${path.split('/')[0]}`, () => {
  assert.deepEqual(classifyNote(path, []), { kind, placeKind, review })
})

test('promotion exceptions use exact paths and reject duplicates, malformed JSON, dangerous paths and incompatible subtypes', () => {
  const parsed = parseClassificationExceptions(JSON.stringify({ version: 1, items: [
    { externalId: 'Créatures et Peuples/Fiction.md', kind: 'SPECIES' }, { externalId: 'Instances Religieuses/Fiction.md', kind: 'RELIGION' },
  ] }))
  assert.equal(classifyNote('Créatures et Peuples/Fiction.md', parsed).kind, 'SPECIES')
  assert.equal(classifyNote('Instances Religieuses/Fiction.md', parsed).kind, 'RELIGION')
  for (const value of ['invalid', JSON.stringify({ version: 2, items: [] }), JSON.stringify({ version: 1, items: [parsed[0], parsed[0]] }),
    ...['../Outside.md', '.hidden/Note.md', '/Absolute.md', 'C:\\Note.md'].map(externalId => JSON.stringify({ version: 1, items: [{ externalId, kind: 'OTHER' }] })),
    JSON.stringify({ version: 1, items: [{ externalId: 'N.md', kind: 'PERSON', placeKind: 'CITY' }] }),
    JSON.stringify({ version: 1, items: [{ externalId: 'N.md', kind: 'PLACE' }] }),
    JSON.stringify({ version: 1, items: [], unknown: true })]) assert.throws(() => parseClassificationExceptions(value), PromotionError)
  assert.throws(() => buildPromotionPlan(snapshot([note('Villes/Fiction.md', 'Fiction')]), { ...options(1), exceptions: parsed }), /CLASSIFICATION_PATH_NOT_SELECTED/)
})

test('promotion preserves homonymous titles as distinct identities, with deterministic readable folder slugs', () => {
  const first = note('Divinités/Double fictif.md', 'Double fictif'), second = note('Villes/Double fictif.md', 'Double fictif', 3)
  const plan = buildPromotionPlan(snapshot([second, first]), options(2))
  assert.equal(plan.summary.creatable, 2); assert.equal(plan.summary.collisions, 2); assert.equal(plan.summary.unresolvedCollisions, 0)
  assert.deepEqual(plan.entries.map(entry => entry.slug), ['double-fictif-divinites', 'double-fictif-villes'])
  assert.ok(plan.entries.every(entry => entry.input?.entity.title === 'Double fictif'))
  assert.notEqual(first.identityKey, second.identityKey)
  assert.equal(plan.fingerprint, buildPromotionPlan(snapshot([first, second]), options(2)).fingerprint)
})

test('promotion uses the directory only on collisions, then a stable path suffix for collisions within the same folder', () => {
  const a = note('Villes/A.md', 'Cité fictive'), b = note('Villes/B.md', 'Cité fictive', 3)
  assert.equal(buildPromotionPlan(snapshot([a]), options(1)).entries[0]!.slug, 'cite-fictive')
  const occupied = snapshot([a]); occupied.occupiedSlugs.push({ id: uuid(99), slug: 'cite-fictive' })
  assert.equal(buildPromotionPlan(occupied, options(1)).entries[0]!.slug, 'cite-fictive-villes')
  const plan = buildPromotionPlan(snapshot([a, b]), options(2))
  assert.notEqual(plan.entries[0]!.slug, plan.entries[1]!.slug)
  assert.match(plan.entries[0]!.slug, /^cite-fictive-villes-[a-f0-9]{12}$/)
  for (const entry of plan.entries) occupied.occupiedSlugs.push({ id: uuid(98), slug: entry.slug })
  occupied.occupiedSlugs.push({ id: uuid(97), slug: 'cite-fictive-villes' })
  const blocked = buildPromotionPlan(occupied, options(1))
  assert.equal(blocked.summary.unresolvedCollisions, 1); assert.equal(blocked.summary.creatable, 0)
})

test('promotion prepares exact raw Markdown and valid tags, private proposed fields and original provenance path without lore inventions', () => {
  const current = note('Lieux/Fiction.md', 'Lieu fictif'); current.receipt.rawVariant = '# Lieu fictif\r\nOriginal [[Lien]].\r\n '
  const entry = buildPromotionPlan(snapshot([current]), options(1)).entries[0]!
  assert.equal(entry.input!.entity.bodyMarkdown, current.receipt.rawVariant); assert.equal(entry.input!.entity.summary, null)
  assert.deepEqual(entry.input!.entity.tags, ['fiction']); assert.deepEqual(entry.input!.entity.aliases, [])
  assert.equal(entry.input!.entity.visibility, 'GM'); assert.equal(entry.input!.evidence.locator, current.externalId)
  assert.equal(entry.input!.evidence.sourceExcerpt, null); assert.equal(Object.hasOwn(entry.input!.entity, 'publishedAt'), false)
})

for (const [name, mutate, code] of [
  ['empty', (current: PromotionNote) => { current.receipt.rawVariant = ' \t\n' }, 'NOTE_CONTENT_EMPTY'],
  ['title-too-long', (current: PromotionNote) => { current.receipt.title = 't'.repeat(201) }, 'EDITORIAL_FIELDS_INVALID'],
  ['title-trim', (current: PromotionNote) => { current.receipt.title = ' Fiction ' }, 'EDITORIAL_FIELDS_INVALID'],
  ['body-too-long', (current: PromotionNote) => { current.receipt.rawVariant = 't'.repeat(100_001) }, 'EDITORIAL_FIELDS_INVALID'],
  ['nul', (current: PromotionNote) => { current.receipt.rawVariant = 'Fiction\0' }, 'EDITORIAL_FIELDS_INVALID'],
  ['invalid-unicode', (current: PromotionNote) => { current.receipt.rawVariant = 'Fiction\ud800' }, 'EDITORIAL_FIELDS_INVALID'],
  ['technical-format', (current: PromotionNote) => { current.receipt.contentType = 'application/json' }, 'NOTE_FORMAT_UNSUPPORTED'],
  ['invalid-tags', (current: PromotionNote) => { current.receipt.metadata = { tags: ['A', 'a'] } }, 'NOTE_TAGS_INVALID'],
  ['different-locator', (current: PromotionNote) => { current.receipt.locator = 'other.md' }, 'LOCATOR_MISMATCH'],
  ['anonymous', (current: PromotionNote) => { current.externalId = null; current.identityKey = itemIdentity(null, current.contentHash) }, 'NOTE_PATH_INVALID'],
  ['path-too-long', (current: PromotionNote) => { current.externalId = 'Lieux/' + 'x'.repeat(251) + '.md'; current.identityKey = itemIdentity(current.externalId, current.contentHash); current.receipt.locator = current.externalId }, 'EDITORIAL_FIELDS_INVALID'],
] as const) test(`promotion rejects ${name} without truncation or invented replacements`, () => {
  const current = note('Lieux/Fiction.md', 'Fiction'); mutate(current)
  const plan = buildPromotionPlan(snapshot([current]), options(1))
  assert.equal(plan.summary.rejected, 1); assert.equal(plan.entries[0]!.code, code); assert.equal(plan.entries[0]!.input, null)
})

test('promotion rejects another Source, duplicate identities and incompatible identity keys', () => {
  const current = note('Lieux/Fiction.md', 'Fiction')
  assert.throws(() => buildPromotionPlan(snapshot([current, current]), options(2)), /SELECTION_INCOMPATIBLE/)
  assert.throws(() => buildPromotionPlan(snapshot([{ ...current, sourceId: uuid(999) }]), options(1)), /SELECTION_INCOMPATIBLE/)
  assert.throws(() => buildPromotionPlan(snapshot([{ ...current, identityKey: 'e:' + 'a'.repeat(64) }]), options(1)), /SELECTION_INCOMPATIBLE/)
})

test('promotion dry-run is read-only, reports counts and keeps all private paths, slugs, authors and content out of default logs', async () => {
  const fixture = commandFixture(snapshot([note('Villes/PRIVATE.md', 'PRIVATE title')]))
  const before = structuredClone(fixture.state)
  assert.equal(await runPromotionCommand([...args(), '--dry-run'], fixture.dependencies), 0)
  assert.deepEqual(fixture.state, before); assert.equal(fixture.writes.length, 0); assert.equal(fixture.closed(), 1)
  const logs = fixture.lines.join('\n')
  assert.match(logs, /Notes détectées : 1 ; fiches créables : 1/)
  for (const secret of ['PRIVATE', actor.label, actor.discordId, 'Texte', source.externalId, 'private-title']) assert.ok(!logs.includes(secret))
})

test('promotion apply requires the current plan hash and exact expected count, with no writes on rejection', async () => {
  const state = snapshot([note('Villes/Fiction.md', 'Fiction')]), plan = buildPromotionPlan(state, options(1))
  const fixture = commandFixture(state)
  assert.equal(await runPromotionCommand([...args(), '--apply', '--confirm-plan', 'a'.repeat(64)], fixture.dependencies), 1)
  assert.equal(fixture.writes.length, 0)
  fixture.state.notes[0]!.receipt.rawVariant = 'Texte fictif modifié après revue.'
  assert.equal(await runPromotionCommand([...args(), '--apply', '--confirm-plan', plan.fingerprint], fixture.dependencies), 1)
  assert.equal(fixture.writes.length, 0)
  assert.equal(await runPromotionCommand([...args(130), '--dry-run'], fixture.dependencies), 1)
  assert.match(fixture.lines.join('\n'), /EXPECTED_COUNT_MISMATCH/)
})

test('promotion applies once, skips persistent confirmations on rerun, and preserves deterministic homonym slugs', async () => {
  const state = snapshot([note('Divinités/Double.md', 'Double'), note('Villes/Double.md', 'Double', 3)])
  const fixture = commandFixture(state), first = buildPromotionPlan(state, options(2))
  assert.equal(await runPromotionCommand([...args(2), '--apply', '--confirm-plan', first.fingerprint], fixture.dependencies), 0)
  const next = buildPromotionPlan(fixture.state, options(2))
  assert.equal(next.summary.skipped, 2); assert.equal(next.summary.creatable, 0)
  assert.deepEqual(next.entries.map(entry => entry.slug), first.entries.map(entry => entry.slug))
  assert.equal(await runPromotionCommand([...args(2), '--apply', '--confirm-plan', next.fingerprint], fixture.dependencies), 0)
  assert.equal(fixture.writes.length, 2)
})

test('promotion partial failure stops immediately and allows a newly approved retry without duplicates', async () => {
  const state = snapshot([note('Villes/A.md', 'Double'), note('Villes/B.md', 'Double', 3), note('Villes/C.md', 'Troisième', 4)])
  const fixture = commandFixture(state), plan = buildPromotionPlan(state, options(3)); fixture.failAt(1)
  assert.equal(await runPromotionCommand([...args(3), '--apply', '--confirm-plan', plan.fingerprint], fixture.dependencies), 1)
  assert.equal(fixture.writes.length, 1); assert.ok(!fixture.lines.join('\n').includes('PRIVATE'))
  const resumed = buildPromotionPlan(fixture.state, options(3)); assert.equal(resumed.summary.skipped, 1)
  assert.deepEqual(resumed.entries.map(entry => entry.slug), plan.entries.map(entry => entry.slug))
  fixture.failAt(-1)
  assert.equal(await runPromotionCommand([...args(3), '--apply', '--confirm-plan', resumed.fingerprint], fixture.dependencies), 0)
  assert.equal(fixture.writes.length, 3); assert.equal(new Set(fixture.writes.map(entry => entry.id)).size, 3)
})

test('promotion plans and applies 130 fictitious notes and then ignores all 130 on a new preview', async () => {
  const state = snapshot(Array.from({ length: 130 }, (_unused, index) => note(`Villes/Fiction-${index}.md`, `Fiction ${index}`, index + 2)))
  const fixture = commandFixture(state), plan = buildPromotionPlan(state, options(130))
  assert.equal(plan.summary.detected, 130); assert.equal(plan.summary.creatable, 130); assert.equal(plan.summary.skipped, 0)
  assert.equal(await runPromotionCommand([...args(130), '--apply', '--confirm-plan', plan.fingerprint], fixture.dependencies), 0)
  assert.equal(fixture.writes.length, 130)
  assert.equal(await runPromotionCommand([...args(130), '--dry-run'], fixture.dependencies), 0)
  assert.match(fixture.lines.join('\n'), /fiches créables : 0 ; fiches ignorées \(associées\) : 130/)
})

test('promotion provisional OTHER requires explicit acceptance, while classification exceptions remove the review', async () => {
  const state = snapshot([note('Créatures et Peuples/Fiction.md', 'Fiction')]), fixture = commandFixture(state)
  const plan = buildPromotionPlan(state, options(1)); assert.equal(plan.summary.review, 1)
  assert.equal(await runPromotionCommand([...args(), '--apply', '--confirm-plan', plan.fingerprint], fixture.dependencies), 1)
  assert.equal(fixture.writes.length, 0)
  const allowed = buildPromotionPlan(state, { ...options(1), allowProvisional: true })
  assert.equal(await runPromotionCommand([...args(), '--allow-provisional', '--apply', '--confirm-plan', allowed.fingerprint], fixture.dependencies), 0)
  assert.equal(buildPromotionPlan(state, { ...options(1), exceptions: [{ externalId: state.notes[0]!.externalId!, kind: 'CREATURE', placeKind: null }] }).summary.review, 0)
})

test('promotion arguments never invent an author and reject malformed options before connecting', async () => {
  const fixture = commandFixture(snapshot([]))
  for (const bad of [[], [...args(), '--dry-run', '--apply'], [...args(), '--dry-run', '--dry-run'], [...args(), '--unknown'],
    [...args(), '--apply'], [...args(), '--dry-run', '--confirm-plan', 'a'.repeat(64)], [...args(), '--dry-run', '--expected-count', '1'],
    ['--source-external-id', source.externalId, '--dry-run'], [...args(), '--dry-run', '--classifications']]) {
    assert.throws(() => parsePromotionArgs(bad)); assert.equal(await runPromotionCommand(bad, fixture.dependencies), 1)
  }
  assert.equal(fixture.opened(), 0)
  for (const invalid of [{ ...actor, discordId: 'fake' }, { ...actor, label: 'x'.repeat(201) }, { ...actor, label: 'line\nbreak' },
    { ...actor, label: ' surrounded ' }, { ...actor, label: '\ud800' }]) assert.equal(actorSchema.safeParse(invalid).success, false)
})

test('promotion closes failed connections and reports uncertain close without leaking native errors', async () => {
  const fixture = commandFixture(snapshot([note('Villes/Fiction.md', 'Fiction')]))
  fixture.closeFailure()
  assert.equal(await runPromotionCommand([...args(), '--dry-run'], fixture.dependencies), 1)
  assert.equal(fixture.closed(), 1); assert.ok(!fixture.lines.join('\n').includes('PRIVATE'))
})

test('promotion real CLI help never opens a database or network connection', async () => {
  const module = new URL('./promotion-cli.ts', import.meta.url).href
  const guard = `import net from 'node:net'; const denied = () => { throw new Error('CONNECTION_FORBIDDEN') };
    net.Socket.prototype.connect = denied; globalThis.fetch = denied; process.argv = ['node', 'promotion-cli.ts', '--help'];
    await import(${JSON.stringify(module)});`
  const result = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', guard],
    { cwd: fileURLToPath(new URL('../../../../', import.meta.url)), env: { ...process.env, DATABASE_URL: 'postgresql://forbidden:forbidden@127.0.0.1:1/forbidden' }, timeout: 30_000 })
  assert.equal(result.stderr, ''); assert.match(result.stdout, /Usage : lore:staging:promote/)
})
