import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { watch } from 'node:fs'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'
import { contentHash, itemIdentity, MAX_CONTENT_BYTES, MAX_INGEST_BYTES, parseIngestionText } from './format.js'
import { parseObsidianArgs, runObsidianCommand } from './obsidian-command.js'
import { extractMarkdown, linkIndex } from './obsidian-markdown.js'
import { prepareObsidian, type ObsidianOptions } from './obsidian.js'

async function fixture(work: (root: string, vault: string, options: ObsidianOptions) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'hesta-obsidian-fictional-')), vault = join(root, 'vault')
  try {
    await mkdir(vault)
    await work(root, vault, { vault, vaultId: 'tests-fictional-vault', sourceLabel: 'Coffre fictif', dryRun: true })
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep))
    await rm(root, { recursive: true, force: true })
  }
}
async function batches(output: string) {
  const result = []
  for (const name of (await readdir(output)).sort()) {
    assert.match(name, /^obsidian-\d{6}\.json$/)
    const text = await readFile(join(output, name), 'utf8'), parsed = parseIngestionText(text)
    assert.ok(parsed.success); assert.ok(Buffer.byteLength(text) <= MAX_INGEST_BYTES)
    result.push(parsed.document)
  }
  return result
}

test('Obsidian empty vault has a complete zero report and creates no output', async () => fixture(async (root, _vault, options) => {
  const output = join(root, 'empty')
  const report = await prepareObsidian({ ...options, dryRun: false, output })
  assert.equal(report.markdownDetected, 0); assert.equal(report.errors, 0); assert.equal(report.writtenBatches, 0)
  assert.deepEqual(report.wikilinks, { FOUND: 0, MISSING: 0, AMBIGUOUS: 0, UNSUPPORTED: 0, OUT_OF_SCOPE: 0 })
  await assert.rejects(stat(output))
}))

test('Obsidian exports nested Unicode notes, exact BOM/CRLF and allowlisted metadata without source writes', async () => fixture(async (root, vault, options) => {
  await mkdir(join(vault, 'Lieux'))
  const text = '\ufeff---\r\ntitle: Cité fictive\r\naliases: [Ville imaginaire]\r\ntags:\r\n  - fiction\r\ncustom: conservé dans le Markdown\r\n---\r\n# Autre titre\r\nÉléments fictifs. [[Personne|Une amie]] [[#Place]]\r\n'
  const first = join(vault, 'Lieux', 'Cité.md'), second = join(vault, 'Personne.md')
  await writeFile(first, text); await writeFile(second, '# Personne\nFictif.')
  const before = await stat(first), output = join(root, 'export')
  const report = await prepareObsidian({ ...options, dryRun: false, output })
  assert.equal(report.errors, 0); assert.equal(report.admissible, 2); assert.equal(report.wikilinks.FOUND, 2)
  assert.equal(report.warnings, 1)
  const items = (await batches(output)).flatMap(batch => batch.items)
  assert.equal(items[0]!.externalId, 'Lieux/Cité.md'); assert.equal(items[0]!.locator, 'Lieux/Cité.md')
  assert.equal(items[0]!.content, text); assert.equal(items[0]!.title, 'Cité fictive'); assert.equal(items[0]!.contentType, 'text/markdown')
  assert.equal(items[0]!.observedAt, before.mtime.toISOString())
  assert.deepEqual(items[0]!.metadata!.aliases, ['Ville imaginaire']); assert.deepEqual(items[0]!.metadata!.tags, ['fiction'])
  assert.ok(!Object.hasOwn(items[0]!.metadata!, 'custom'))
  assert.ok(items.every(item => JSON.stringify(item.source) === JSON.stringify(items[0]!.source)))
  assert.equal(await readFile(first, 'utf8'), text); assert.equal((await stat(first)).mtimeMs, before.mtimeMs)
  assert.deepEqual((await readdir(vault)).sort(), ['Lieux', 'Personne.md'])
}))

test('Obsidian source/path identities and byte-identical exports remain stable, edits change only content hash', async () => fixture(async (root, vault, options) => {
  const note = join(vault, 'Fable.md'); await writeFile(note, '# Fable\nVersion une.')
  for (const name of ['first', 'second']) await prepareObsidian({ ...options, dryRun: false, output: join(root, name) })
  assert.equal(await readFile(join(root, 'first', 'obsidian-000001.json'), 'utf8'), await readFile(join(root, 'second', 'obsidian-000001.json'), 'utf8'))
  const old = (await batches(join(root, 'first')))[0]!.items[0]!
  await writeFile(note, '# Fable\nVersion deux.')
  await prepareObsidian({ ...options, dryRun: false, output: join(root, 'third') })
  const changed = (await batches(join(root, 'third')))[0]!.items[0]!
  assert.deepEqual(old.source, changed.source); assert.equal(old.externalId, changed.externalId)
  assert.notEqual(contentHash(old.content), contentHash(changed.content))
  assert.equal(itemIdentity(old.externalId, contentHash(old.content)), itemIdentity(changed.externalId, contentHash(changed.content)))
  assert.notEqual(itemIdentity('Renamed.md', contentHash(old.content)), itemIdentity(old.externalId, contentHash(old.content)))
}))

test('Obsidian dry-run reads only, and subfolder/limit keep vault-relative identity and deterministic selection', async () => fixture(async (root, vault, options) => {
  await mkdir(join(vault, 'Notes')); await writeFile(join(vault, 'Notes', 'B.md'), 'B [[A]]')
  await writeFile(join(vault, 'Notes', 'A.md'), 'A [[B]]'); await writeFile(join(vault, 'Outside.md'), 'Outside')
  const output = join(root, 'later')
  const report = await prepareObsidian({ ...options, subdir: 'Notes', limit: 1, output })
  assert.equal(report.markdownDetected, 2); assert.equal(report.selected, 1); assert.equal(report.deferred, 1)
  assert.equal(report.admissible, 1); assert.equal(report.wikilinks.FOUND, 1); assert.equal(report.writtenBatches, 0)
  await assert.rejects(stat(output))
  await prepareObsidian({ ...options, subdir: 'Notes', limit: 1, output, dryRun: false })
  assert.equal((await batches(output))[0]!.items[0]!.externalId, 'Notes/A.md')
}))

test('Obsidian hidden/technical directories, hidden notes and non-Markdown files are ignored', async () => fixture(async (_root, vault, options) => {
  for (const name of ['.obsidian', '.git', '.trash', '.hidden']) { await mkdir(join(vault, name)); await writeFile(join(vault, name, 'Secret.md'), 'Never read') }
  await writeFile(join(vault, '.private.md'), 'Never read'); await writeFile(join(vault, 'Drawing.canvas'), '{}')
  await writeFile(join(vault, 'Visible.MD'), 'Visible')
  const report = await prepareObsidian(options)
  assert.equal(report.markdownDetected, 1); assert.equal(report.admissible, 1); assert.equal(report.ignoredEntries, 6)
}))

for (const subdir of ['../outside', '..\\outside', '/outside', 'C:\\outside', '.obsidian', 'nested/../elsewhere', 'nested//elsewhere']) {
  test(`Obsidian refuses unsafe subfolder ${subdir}`, async () => fixture(async (_root, _vault, options) => {
    await assert.rejects(prepareObsidian({ ...options, subdir }))
  }))
}

test('Obsidian refuses output in vault, any Git repository, an existing directory, or a symlink parent', async () => fixture(async (root, vault, options) => {
  await writeFile(join(vault, 'Note.md'), 'Fictif')
  await assert.rejects(prepareObsidian({ ...options, output: join(vault, 'export') }), /OUTPUT_INSIDE_VAULT/)
  const repo = join(root, 'repo'); await mkdir(repo); await writeFile(join(repo, '.git'), 'gitdir: fictif')
  await assert.rejects(prepareObsidian({ ...options, output: join(repo, 'export') }), /OUTPUT_INSIDE_GIT/)
  await assert.rejects(prepareObsidian({ ...options, output: repo }), /OUTPUT_ALREADY_EXISTS/)
  const linked = join(root, 'linked'); await symlink(vault, linked, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(prepareObsidian({ ...options, output: join(linked, 'export') }), /UNSAFE_DIRECTORY/)
  await assert.rejects(prepareObsidian({ ...options, vault: linked }), /UNSAFE_DIRECTORY/)
}))

test('Obsidian ignores directory and file symlinks and refuses a symlink-selected scope', async () => fixture(async (root, vault, options) => {
  const elsewhere = join(root, 'elsewhere'); await mkdir(elsewhere); await writeFile(join(elsewhere, 'Outside.md'), 'Outside fictif')
  await symlink(elsewhere, join(vault, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  await symlink(join(elsewhere, 'Outside.md'), join(vault, 'Linked.md'), 'file')
  await writeFile(join(vault, 'Real.md'), 'Real fictif')
  const report = await prepareObsidian(options)
  assert.equal(report.markdownDetected, 1); assert.equal(report.admissible, 1)
  assert.equal(report.ignoredEntries, 2)
  await assert.rejects(prepareObsidian({ ...options, subdir: 'linked' }), /UNSAFE_DIRECTORY/)
}))

for (const [name, content, code] of [
  ['oversize', Buffer.alloc(MAX_CONTENT_BYTES + 1, 65), 'CONTENT_TOO_LARGE'],
  ['utf8', Buffer.from([0xc3, 0x28]), 'INVALID_UTF8'],
  ['empty', '', 'NOTE_CONTENT_INVALID'],
  ['nul', 'Fictif\0', 'NOTE_CONTENT_INVALID'],
  ['title', '# ' + 'a'.repeat(251), 'NOTE_TITLE_INVALID'],
  ['unclosed', '---\ntitle: Fictif\n', 'FRONTMATTER_UNCLOSED'],
  ['malformed', '---\ntitle: [broken\n---\nFictif', 'FRONTMATTER_INVALID'],
  ['duplicate', '---\ntitle: A\ntitle: B\n---\nFictif', 'FRONTMATTER_INVALID'],
  ['secret-key', '---\npassword: fictif\n---\nFictif', 'FRONTMATTER_FORBIDDEN_OR_EXCESSIVE'],
  ['nested-secret', '---\ncustom:\n  api_key: fictif\n---\nFictif', 'FRONTMATTER_FORBIDDEN_OR_EXCESSIVE'],
  ['proto', '---\n__proto__: fictif\n---\nFictif', 'FRONTMATTER_FORBIDDEN_OR_EXCESSIVE'],
  ['secret-text', 'postgresql://fictional:fictional@example.invalid/db', 'NOTE_CONTENT_INVALID'],
  ['alias-yaml', '---\na: &a [fiction]\naliases: *a\n---\nFictif', 'FRONTMATTER_UNSUPPORTED_YAML'],
  ['tag-yaml', '---\ntitle: !execute fiction\n---\nFictif', 'FRONTMATTER_INVALID'],
  ['metadata', '---\ncustom: ' + 'x'.repeat(4001) + '\n---\nFictif', 'FRONTMATTER_FORBIDDEN_OR_EXCESSIVE'],
  ['links', Array(101).fill('[[Absent]]').join(' '), 'WIKILINK_LIMIT'],
] as const) {
  test(`Obsidian ${name} is diagnosed without writing any partial export`, async () => fixture(async (root, vault, options) => {
    await writeFile(join(vault, 'A-valid.md'), 'Fictif'); await writeFile(join(vault, 'B-invalid.md'), content)
    const output = join(root, 'export'), report = await prepareObsidian({ ...options, output, dryRun: false })
    assert.equal(report.errors, 1); assert.equal(report.admissible, 1); assert.equal(report.writtenBatches, 0)
    assert.ok(report.issues.some(issue => issue.code === code)); await assert.rejects(stat(output))
  }))
}

test('Obsidian defensive YAML permits multiline scalars/lists but warns and preserves unusable/unsupported properties', () => {
  const text = '---\ntitle: >-\n  Fable\n  fictive\naliases: Alias fictif\ntags: [fiction, essai]\nunknown: true\n---\nBody'
  const result = extractMarkdown(text, 'Note.md', linkIndex(['Note.md']))
  assert.equal(result.title, 'Fable fictive'); assert.deepEqual(result.metadata.aliases, ['Alias fictif'])
  assert.deepEqual(result.metadata.tags, ['fiction', 'essai']); assert.equal(result.warnings.length, 1)
  const invalid = extractMarkdown('---\ntitle: 42\naliases: [A, a]\ntags: [false]\n---\n# Repli', 'Note.md', linkIndex([]))
  assert.equal(invalid.title, 'Repli'); assert.equal(invalid.warnings.length, 3)
})

test('Obsidian wikilinks retain aliases, heading/block anchors, unresolved/ambiguous targets and embeds without opening them', () => {
  const result = extractMarkdown('# Note\n[[Other|Alias]] [[Other#Heading]] [[#^block]] [[Missing]] [[Same]] ![[photo.png|Image]] [[../../../outside]]\n```md\n[[Code]]\n```\n`[[Inline]]` <!-- [[Comment]] --> \\[[Escaped]]',
    'Folder/Note.md', linkIndex(['Folder/Note.md', 'Other.md', 'A/Same.md', 'B/Same.md']))
  const links = result.wikilinks
  assert.equal(links.length, 7); assert.equal(links[0]!.alias, 'Alias'); assert.equal(links[0]!.path, 'Other.md')
  assert.equal(links[1]!.anchor, 'Heading'); assert.equal(links[2]!.anchor, '^block'); assert.equal(links[2]!.path, 'Folder/Note.md')
  assert.equal(links[3]!.status, 'MISSING'); assert.equal(links[4]!.status, 'AMBIGUOUS')
  assert.equal(links[5]!.embed, true); assert.equal(links[5]!.status, 'UNSUPPORTED'); assert.equal(links[6]!.status, 'OUT_OF_SCOPE')
})

test('Obsidian splits at 500 items with deterministic order and validates every serialized batch', async () => fixture(async (root, vault, options) => {
  for (let i = 500; i >= 0; i--) await writeFile(join(vault, `${String(i).padStart(4, '0')}.md`), `Fiction ${i}`)
  const output = join(root, 'export'), report = await prepareObsidian({ ...options, output, dryRun: false })
  assert.equal(report.errors, 0); assert.equal(report.writtenBatches, 2)
  const documents = await batches(output)
  assert.deepEqual(documents.map(document => document.items.length), [500, 1])
  assert.equal(documents[0]!.items[0]!.externalId, '0000.md'); assert.equal(documents[1]!.items[0]!.externalId, '0500.md')
}))

test('Obsidian recognizes prose consistently with LF, CRLF and CR line endings while preserving raw Markdown', async () => fixture(async (root, vault, options) => {
  const contents = ['```', '~~~'].flatMap(fence => ['\n', '\r\n', '\r'].map(ending =>
    [`${fence}md`, '# Code title', '[[Code]]', fence, '# Fiction', '[[Other]] [[Missing]]'].join(ending)))
  await writeFile(join(vault, 'Other.md'), '# Other')
  for (const [index, content] of contents.entries()) await writeFile(join(vault, `Note-${index}.md`), content)
  const output = join(root, 'export'), report = await prepareObsidian({ ...options, output, dryRun: false })
  assert.equal(report.errors, 0); assert.equal(report.wikilinks.FOUND, 6); assert.equal(report.wikilinks.MISSING, 6)
  const items = (await batches(output)).flatMap(batch => batch.items)
  for (const [index, content] of contents.entries()) {
    const item = items.find(item => item.externalId === `Note-${index}.md`)!
    assert.equal(item.title, 'Fiction'); assert.equal(item.content, content)
    assert.equal(await readFile(join(vault, `Note-${index}.md`), 'utf8'), content)
  }
}))

test('Obsidian splits on escaped JSON bytes before 500 items and admits the content size boundary', async () => fixture(async (root, vault, options) => {
  const content = '\\'.repeat(MAX_CONTENT_BYTES)
  for (let i = 0; i < 11; i++) await writeFile(join(vault, `${i}.md`), content)
  const output = join(root, 'export'), report = await prepareObsidian({ ...options, output, dryRun: false })
  assert.equal(report.errors, 0); assert.equal(report.writtenBatches, 2)
  const documents = await batches(output)
  assert.deepEqual(documents.map(document => document.items.length), [9, 2])
  assert.ok(documents.flatMap(document => document.items).every(item => item.content === content))
}))

test('Obsidian detects source changes between passes and removes already written batches', async () => fixture(async (root, vault, options) => {
  for (let i = 0; i <= 500; i++) await writeFile(join(vault, `${String(i).padStart(4, '0')}.md`), `Fiction ${i}`)
  const output = join(root, 'export')
  let change: Promise<void> | undefined
  const watcher = watch(root, (_event, name) => {
    if (String(name) === 'export' && !change) change = writeFile(join(vault, '0500.md'), 'Fiction changed during export')
  })
  try {
    await assert.rejects(prepareObsidian({ ...options, output, dryRun: false }), /VAULT_CHANGED_DURING_EXPORT/)
    await change; assert.ok(change); await assert.rejects(stat(output))
  } finally { watcher.close() }
}))

test('Obsidian rejects external IDs over 1024 UTF-8 bytes without truncating their vault-relative path', async () => fixture(async (root, vault, options) => {
  let folder = vault
  for (let i = 0; i < 9; i++) { folder = join(folder, '界'.repeat(40)); await mkdir(folder) }
  await writeFile(join(folder, 'Fiction.md'), 'Fiction')
  const report = await prepareObsidian({ ...options, output: join(root, 'export'), dryRun: false })
  assert.equal(report.errors, 1); assert.ok(report.issues.some(issue => issue.code === 'NOTE_EXTERNALID_INVALID'))
  await assert.rejects(stat(join(root, 'export')))
}))

test('Obsidian bounded frontmatter refuses excessive depth and serialized metadata size', () => {
  const properties = Array.from({ length: 90 }, (_, index) => `field${index}: ${'x'.repeat(200)}`).join('\n')
  assert.throws(() => extractMarkdown(`---\n${properties}\n---\nFiction`, 'Fiction.md', linkIndex([])), /FRONTMATTER_FORBIDDEN_OR_EXCESSIVE/)
  const nested = Array.from({ length: 10 }, (_, index) => `${'  '.repeat(index)}child:`).join('\n') + '\n' + '  '.repeat(10) + 'leaf: fiction'
  assert.throws(() => extractMarkdown(`---\n${nested}\n---\nFiction`, 'Fiction.md', linkIndex([])), /FRONTMATTER_COMPLEXITY/)
  assert.equal(extractMarkdown('# Fiction C#', 'Note.md', linkIndex([])).title, 'Fiction C#')
})

test('Obsidian CLI accepts only explicit options and emits no private paths, labels, titles, content or native errors', async () => fixture(async (root, vault, options) => {
  const lines: string[] = [], args = ['--vault', vault, '--vault-id', options.vaultId, '--source-label', 'Private fictional label']
  await writeFile(join(vault, 'Private-fictional-title.md'), '# Private fictional title\nBody fictif [[private-unresolved]]')
  assert.equal(await runObsidianCommand([...args, '--dry-run'], line => lines.push(line)), 0)
  assert.equal(await runObsidianCommand([...args, '--output', join(root, 'export')], line => lines.push(line)), 0)
  assert.equal(await runObsidianCommand([...args, '--subdir', 'Private-missing'], line => lines.push(line)), 1)
  assert.equal(await runObsidianCommand(['--help'], line => lines.push(line)), 0)
  for (const invalid of [[], [...args, '--limit', '0'], [...args, '--limit', '1.5'], [...args, '--limit', '9007199254740992'],
    [...args, '--unknown', 'private'], [...args, '--vault-id', 'again'], [...args, '--dry-run', '--dry-run'], [...args, '--subdir']]) {
    assert.throws(() => parseObsidianArgs(invalid))
  }
  const logs = lines.join('\n')
  for (const value of [vault, 'Private', 'Body fictif', 'private-unresolved', 'ENOENT', 'NEW', 'MODIFIED', 'UNCHANGED']) assert.ok(!logs.includes(value))
}))

test('Obsidian rejects relative/network paths, invalid Source identity and non-explicit output before conversion', async () => fixture(async (_root, _vault, options) => {
  for (const override of [{ vault: 'relative' }, { vault: '\\\\server\\share' }, { vault: '//server/share' },
    { vaultId: ' surrounded ' }, { vaultId: '\ud800' }, { sourceLabel: 'a'.repeat(251) }, { dryRun: false }, { limit: 0 }]) {
    await assert.rejects(prepareObsidian({ ...options, ...override }))
  }
}))

test('Obsidian real CLI succeeds with database/network access forbidden and no configured environment', async () => fixture(async (root, vault) => {
  await writeFile(join(vault, 'Fictif.md'), 'Texte fictif [[Absent]]')
  const cwd = fileURLToPath(new URL('../../../../', import.meta.url))
  const module = new URL('./obsidian-command.ts', import.meta.url).href
  const guard = `import net from 'node:net'; import http from 'node:http'; import https from 'node:https';
    const denied = () => { throw new Error('NETWORK_OR_DATABASE_FORBIDDEN') };
    net.Socket.prototype.connect = denied; http.request = denied; http.get = denied; https.request = denied; https.get = denied; globalThis.fetch = denied;
    const {runObsidianCommand} = await import(${JSON.stringify(module)});
    process.exitCode = await runObsidianCommand(process.argv.slice(1), line => console.log(line));`
  const result = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', guard,
    '--', '--vault', vault, '--vault-id', 'fiction', '--source-label', 'Fiction', '--output', join(root, 'export')],
  { cwd, env: { ...process.env, DATABASE_URL: 'postgresql://forbidden:forbidden@127.0.0.1:1/forbidden' }, encoding: 'utf8', timeout: 30_000 })
  assert.equal(result.stderr, ''); assert.match(result.stdout, /lots écrits : 1/)
  assert.equal((await batches(join(root, 'export'))).length, 1)
}))
