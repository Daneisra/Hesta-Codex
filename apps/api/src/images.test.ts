import assert from 'node:assert/strict'
import { before, beforeEach, after, test } from 'node:test'
import { once } from 'node:events'
import { readdir, readFile } from 'node:fs/promises'
import type { Server } from 'node:http'
import sharp from 'sharp'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { PrismaPg } from '@prisma/adapter-pg'
import { maxImageBytes, referencedImageIds, relationKindWarning } from '@hesta-codex/shared'
import { PrismaClient } from './prisma-client/client.ts'
import { createPrismaImageService, sanitizeImage, bindEntityImages } from './images.js'
import { createPrismaManualService } from './admin/manual.js'
import { createPrismaEditorialService } from './admin/editorial.js'
import { createPrismaEntityDeletionService } from './admin/entity-deletion.js'
import { createPrismaAdminStore } from './admin/store.js'
import { createPrismaStore } from './store.js'
import { createApp } from './app.js'
import { readAuthConfig } from './auth/config.js'
import { sessionCookieName, sessionHash } from './auth/session.js'
import { manualCreateSchema } from './admin/manual-validation.js'
import { patchSchema } from './admin/validation.js'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const actor = '222222222222222222', other = '444444444444444444'
const db = new PGlite() // Owned in-memory DB only; never read DATABASE_URL.
const socket = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0, maxConnections: 1 })
let prisma: PrismaClient, images: ReturnType<typeof createPrismaImageService>, server: Server, base: string, png: Buffer
const config = readAuthConfig({ DISCORD_CLIENT_ID: '111111111111111111', DISCORD_CLIENT_SECRET: 'fictif',
  DISCORD_REDIRECT_URI: 'http://localhost:5173/api/auth/discord/callback', DISCORD_ADMIN_IDS: `${actor},${other}`,
  SESSION_SECRET: 'a-fictional-session-secret-more-than-32-characters', SESSION_TTL_MS: '3600000' })
const cookie = (token = 'a') => `${sessionCookieName(config)}=${token.repeat(43)}`
const markdown = (image: { id: string }) => `![Illustration fictive](/api/images/${image.id})`
const upload = () => images.upload(png, 'image/png', actor)
const attach = (body: string, entityId = id(1), author = actor) => prisma.$transaction(async tx => {
  await bindEntityImages(tx, body, entityId, author)
  await tx.entity.update({ where: { id: entityId }, data: { bodyMarkdown: body } })
})
const createInput = (body: string) => manualCreateSchema.parse({
  entity: { slug: 'pj-fictif', title: 'PJ fictif', kind: 'PLAYER_CHARACTER', placeKind: null,
    summary: null, bodyMarkdown: body, aliases: [], tags: [], visibility: 'GM' },
  source: { mode: 'existing', sourceId: id(3) }, evidence: { claimText: 'Origine fictive', sourceExcerpt: null,
    locator: null, timeStartSeconds: null, timeEndSeconds: null, confidence: null, visibility: 'GM' },
})

before(async () => {
  const folder = new URL('../../../prisma/migrations/', import.meta.url)
  for (const name of (await readdir(folder)).filter(name => /^\d/.test(name)).sort()) {
    await db.exec(await readFile(new URL(`${name}/migration.sql`, folder), 'utf8'))
  }
  await socket.start()
  prisma = new PrismaClient({ adapter: new PrismaPg({ host: '127.0.0.1', port: Number(socket.getServerConn().split(':')[1]), database: 'postgres', user: 'postgres', max: 1 }) })
  images = createPrismaImageService(prisma)
  png = await sharp({ create: { width: 3, height: 2, channels: 4, background: '#458899aa' } }).png().toBuffer()
  server = createApp(createPrismaStore(prisma), { images, admin: createPrismaAdminStore(prisma), editorial: createPrismaEditorialService(prisma),
    manual: createPrismaManualService(prisma), auth: { config, store: {
      async findSession(hash) {
        const discordId = hash === sessionHash('a'.repeat(43)) ? actor : hash === sessionHash('b'.repeat(43)) ? other :
          hash === sessionHash('c'.repeat(43)) ? '333333333333333333' : null
        return discordId ? { discordId, username: 'Fictif', displayName: null, expiresAt: new Date(Date.now() + 60000) } : null
      }, async rotateSession() {}, async revokeSession() {},
    }, discord: { authorizationUrl: () => '', async exchangeCode() { throw new Error('Unused') } } },
  }).listen(0, '127.0.0.1')
  await once(server, 'listening'); const address = server.address(); assert.ok(address && typeof address !== 'string')
  base = `http://127.0.0.1:${address.port}`
})
beforeEach(async () => {
  await db.exec('DROP TRIGGER IF EXISTS image_revision_failure ON "Revision"; TRUNCATE "EntityImage", "Entity", "Source" CASCADE;')
  await prisma.entity.createMany({ data: [1, 2].map(n => ({ id: id(n), slug: `fiche-${n}`, title: `Fiche fictive ${n}`, kind: 'PERSON', status: 'PROPOSED', visibility: 'GM' })) })
  await prisma.source.create({ data: { id: id(3), kind: 'MANUAL', label: 'Source fictive' } })
})
after(async () => {
  server?.closeAllConnections(); await new Promise<void>(resolve => server?.close(() => resolve()))
  await prisma?.$disconnect(); await socket.stop(); await db.close()
})

test('image parsing uses real Markdown nodes and resolves reference images without interpreting code or external URLs', () => {
  const url = `/api/images/${id(10)}`
  assert.deepEqual(referencedImageIds(`![a](${url})\n![b][ref]\n\n[ref]: /api/images/${id(11)}\n\n\`![code](/api/images/${id(12)})\`\n\n\`\`\`\n![code](/api/images/${id(13)})\n\`\`\`\n\n![ext](https://example.test${url})\n[link](/api/images/${id(14)})`), [id(10), id(11)])
})

test('PNG/JPEG/WebP are decoded, oriented and sanitized with no EXIF, original names or arbitrary payload preserved', async () => {
  const jpeg = await sharp(png).jpeg().withMetadata({ orientation: 6 }).withExif({ IFD0: { Artist: 'Auteur fictif' } }).toBuffer()
  assert.ok((await sharp(jpeg).metadata()).exif)
  for (const [input, mime] of [[png, 'image/png'], [jpeg, 'image/jpeg'], [await sharp(png).webp().toBuffer(), 'image/webp']] as const) {
    const clean = await sanitizeImage(input, mime), metadata = await sharp(clean.content).metadata()
    assert.equal(metadata.format, 'webp'); assert.equal(metadata.exif, undefined); assert.equal(metadata.xmp, undefined)
    assert.equal(metadata.icc, undefined); assert.equal(metadata.orientation, undefined)
    assert.equal(clean.byteSize, clean.content.byteLength)
  }
})

test('empty, oversized, disguised SVG, corrupt image, wrong MIME and excessive dimensions are rejected before persistence', async () => {
  const tooWide = await sharp({ create: { width: 6001, height: 1, channels: 3, background: 'red' } }).png().toBuffer()
  for (const [body, mime] of [[Buffer.alloc(0), 'image/png'], [Buffer.alloc(maxImageBytes + 1), 'image/png'],
    [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><image href="file:///private"/></svg>'), 'image/png'],
    [png.subarray(0, 15), 'image/png'], [png, 'image/jpeg'], [png, 'image/svg+xml'], [tooWide, 'image/png']] as const) {
    await assert.rejects(() => images.upload(body, mime, actor), { code: 'IMAGE_INVALID' })
  }
  assert.equal(await prisma.entityImage.count(), 0)
})

test('pending uploads remain private to their owner, expire after 24h and are pruned on the next import', async () => {
  const image = await upload()
  assert.equal(await images.read(image.id, null), null)
  assert.equal(await images.read(image.id, other), null)
  assert.ok(await images.read(image.id, actor))
  await prisma.entityImage.update({ where: { id: image.id }, data: { createdAt: new Date(Date.now() - 25 * 3600000) } })
  assert.equal(await images.read(image.id, actor), null)
  await upload(); assert.equal(await prisma.entityImage.findUnique({ where: { id: image.id } }), null)
})

test('animated images and compressed pixel bombs are refused even when their file size is small', async () => {
  const animated = await sharp(Buffer.from([255, 0, 0, 255, 0, 0, 255, 255]), {
    raw: { width: 1, height: 2, channels: 4, pageHeight: 1 },
  }).webp({ loop: 0, delay: [100, 100] }).toBuffer()
  assert.equal((await sharp(animated).metadata()).pages, 2)
  await assert.rejects(() => images.upload(animated, 'image/webp', actor), { code: 'IMAGE_INVALID' })
  const tooManyPixels = await sharp({ create: { width: 4500, height: 4500, channels: 3, background: 'white' } }).jpeg({ quality: 1 }).toBuffer()
  assert.ok(tooManyPixels.length < maxImageBytes)
  await assert.rejects(() => images.upload(tooManyPixels, 'image/jpeg', actor), { code: 'IMAGE_INVALID' })
})

test('quota bounds abandoned uploads and attached images do not consume the pending quota', async () => {
  const clean = await sanitizeImage(png, 'image/png')
  await prisma.entityImage.createMany({ data: Array.from({ length: 20 }, () => ({ ...clean, ownerDiscordId: actor })) })
  await assert.rejects(upload, { code: 'IMAGES_PENDING_LIMIT' })
  const first = await prisma.entityImage.findFirstOrThrow()
  await attach(markdown(first)); assert.ok(await upload())
  assert.equal(await prisma.entityImage.count({ where: { entityId: null } }), 20)
})

test('public reads require both PUBLISHED/PUBLIC and an image reference in the current body for every status/visibility combination', async () => {
  const image = await upload(); await attach(markdown(image))
  for (const status of ['DRAFT', 'PROPOSED', 'PUBLISHED', 'ARCHIVED'] as const) for (const visibility of ['PUBLIC', 'PLAYERS', 'GM', 'SECRET'] as const) {
    await prisma.entity.update({ where: { id: id(1) }, data: { status, visibility, publishedAt: status === 'PUBLISHED' ? new Date() : null } })
    assert.equal(Boolean(await images.read(image.id, null)), status === 'PUBLISHED' && visibility === 'PUBLIC')
    assert.ok(await images.read(image.id, other))
  }
  await prisma.entity.update({ where: { id: id(1) }, data: { status: 'PUBLISHED', visibility: 'PUBLIC', publishedAt: new Date(), bodyMarkdown: 'Image retirée.' } })
  assert.equal(await images.read(image.id, null), null)
  assert.ok(await images.read(image.id, actor))
})

test('missing, expired, foreign-owner and already-attached images cannot be claimed by another fiche', async () => {
  const image = await upload()
  await assert.rejects(() => attach(markdown(image), id(2), other), { code: 'IMAGE_UNAVAILABLE' })
  await attach(markdown(image)); await assert.rejects(() => attach(markdown(image), id(2)), { code: 'IMAGE_UNAVAILABLE' })
  await assert.rejects(() => attach(markdown({ id: id(99) })), { code: 'IMAGE_UNAVAILABLE' })
  const expired = await upload()
  await prisma.entityImage.update({ where: { id: expired.id }, data: { createdAt: new Date(0) } })
  await assert.rejects(() => attach(markdown(expired)), { code: 'IMAGE_UNAVAILABLE' })
  assert.equal((await prisma.entity.findUniqueOrThrow({ where: { id: id(2) } })).bodyMarkdown, '')
})

test('manual PJ creation binds images, retains Markdown and creates its ordinary Evidence and Revision #1 atomically', async () => {
  const image = await upload(), body = `## Portrait\n\n${markdown(image)}`
  const result = await createPrismaManualService(prisma).create(createInput(body), 'Auteur fictif', actor)
  assert.equal(result.kind, 'PLAYER_CHARACTER'); assert.equal(result.status, 'PROPOSED'); assert.equal(result.visibility, 'GM')
  assert.equal(result.bodyMarkdown, body); assert.equal(result.revisions.length, 1); assert.equal(result.evidence.length, 1)
  const stored = await prisma.entityImage.findUniqueOrThrow({ where: { id: image.id } })
  assert.equal(stored.entityId, result.id); assert.equal(stored.ownerDiscordId, null)
  assert.equal(await images.read(image.id, null), null)
  assert.equal(relationKindWarning('works_for', 'PLAYER_CHARACTER', 'PERSON'), null)
})

test('an invalid image rolls back creation, provenance and revision without deleting the pending upload', async () => {
  const image = await upload(), body = markdown(image)
  await assert.rejects(() => createPrismaManualService(prisma).create(createInput(body), 'Fictif', other), { code: 'IMAGE_UNAVAILABLE' })
  assert.equal(await prisma.entity.count(), 2); assert.equal(await prisma.evidence.count(), 0); assert.equal(await prisma.revision.count(), 0)
  assert.equal((await prisma.entityImage.findUniqueOrThrow({ where: { id: image.id } })).ownerDiscordId, actor)
})

test('editing to PJ binds new images and preserves existing images, slug, provenance and revision history', async () => {
  const first = await upload(); await attach(markdown(first))
  const second = await upload(), current = await prisma.entity.findUniqueOrThrow({ where: { id: id(1) } })
  const { slug: _slug, ...fields } = createInput(`${markdown(first)}\n\n${markdown(second)}`).entity
  void _slug
  const input = patchSchema.parse({ ...fields, expectedUpdatedAt: current.updatedAt.toISOString() })
  const result = await createPrismaEditorialService(prisma).patch(current.slug, input, 'Fictif', actor)
  assert.equal(result.kind, 'PLAYER_CHARACTER'); assert.equal(result.slug, 'fiche-1'); assert.equal(result.revisions.length, 1)
  assert.equal(await prisma.entityImage.count({ where: { entityId: id(1) } }), 2)
})

test('revision failures roll back both fiche modifications and image claims', async () => {
  const image = await upload(), current = await prisma.entity.findUniqueOrThrow({ where: { id: id(1) } })
  const { slug: _slug, ...fields } = createInput(markdown(image)).entity
  void _slug
  const input = patchSchema.parse({ ...fields, expectedUpdatedAt: current.updatedAt.toISOString() })
  await db.exec(`CREATE OR REPLACE FUNCTION image_fail_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$;
    CREATE TRIGGER image_revision_failure BEFORE INSERT ON "Revision" FOR EACH ROW EXECUTE FUNCTION image_fail_revision();`)
  await assert.rejects(() => createPrismaEditorialService(prisma).patch(current.slug, input, 'Fictif', actor))
  const unchanged = await prisma.entity.findUniqueOrThrow({ where: { id: id(1) } })
  assert.equal(unchanged.kind, 'PERSON'); assert.equal(unchanged.bodyMarkdown, current.bodyMarkdown)
  assert.equal((await prisma.entityImage.findUniqueOrThrow({ where: { id: image.id } })).entityId, null)
  assert.equal(await prisma.revision.count(), 0)
  await assert.rejects(() => createPrismaManualService(prisma).create(createInput(markdown(image)), 'Fictif', actor))
  assert.equal(await prisma.entity.count(), 2)
  assert.equal((await prisma.entityImage.findUniqueOrThrow({ where: { id: image.id } })).entityId, null)
})

test('individual deletion inventories and cascades only its bound images, preserving other fiches, sources and pending images', async () => {
  const own = await upload(), foreign = await upload(), pending = await upload()
  await attach(markdown(own)); await attach(markdown(foreign), id(2))
  const service = createPrismaEntityDeletionService(prisma), plan = await service.preview('fiche-1')
  assert.equal(plan.counts.images, 1)
  await service.remove('fiche-1', { entityId: id(1), fingerprint: plan.fingerprint, confirm: true })
  assert.equal(await prisma.entityImage.findUnique({ where: { id: own.id } }), null)
  assert.equal(await prisma.entityImage.count(), 2); assert.ok(await images.read(foreign.id, actor)); assert.ok(await images.read(pending.id, actor))
  assert.equal(await prisma.source.count(), 1)
})

test('image upload routes require Discord admin and exact Origin before accepting a body; reads hide private and missing IDs identically', async () => {
  const headers = { Cookie: cookie(), Origin: config.origin, 'Content-Type': 'image/png' }
  for (const [extra, expected] of [[{ Cookie: '' }, 401], [{ Cookie: cookie('c') }, 403], [{ Origin: 'https://elsewhere.test' }, 403], [{ Origin: '' }, 403]] as const) {
    const denied = await fetch(`${base}/api/admin/images`, { method: 'POST', headers: { ...headers, ...extra }, body: new Uint8Array(png) })
    assert.equal(denied.status, expected); assert.equal(denied.headers.get('cache-control'), 'no-store')
  }
  assert.equal(await prisma.entityImage.count(), 0)
  const encoded = await fetch(`${base}/api/admin/images`, { method: 'POST', headers: { ...headers, 'Content-Encoding': 'gzip' }, body: new Uint8Array(png) })
  assert.equal(encoded.status, 400); assert.equal(await prisma.entityImage.count(), 0)
  const response = await fetch(`${base}/api/admin/images`, { method: 'POST', headers, body: new Uint8Array(png) })
  assert.equal(response.status, 201); const image = await response.json() as { id: string; url: string }
  const privateRead = await fetch(`${base}${image.url}`), missingRead = await fetch(`${base}/api/images/${id(99)}`)
  assert.equal(privateRead.status, 404); assert.equal(await privateRead.text(), await missingRead.text())
  const authorized = await fetch(`${base}${image.url}`, { headers: { Cookie: cookie() } })
  assert.equal(authorized.status, 200); assert.equal(authorized.headers.get('content-type'), 'image/webp')
  assert.equal(authorized.headers.get('cache-control'), 'no-store'); assert.equal(authorized.headers.get('cross-origin-resource-policy'), 'same-origin')
  assert.equal(authorized.headers.get('x-content-type-options'), 'nosniff')
  assert.equal((await fetch(`${base}${image.url}`, { headers: { Cookie: cookie('b') } })).status, 404)
  assert.equal((await fetch(`${base}/api/images/not-an-id`)).status, 404)
})

test('oversized HTTP image payloads are rejected and a previously public image becomes unreadable immediately after privatization', async () => {
  const tooLarge = await fetch(`${base}/api/admin/images`, { method: 'POST', headers: { Cookie: cookie(), Origin: config.origin, 'Content-Type': 'image/png' }, body: Buffer.alloc(maxImageBytes + 1) })
  assert.equal(tooLarge.status, 413); assert.equal(await prisma.entityImage.count(), 0)
  const image = await upload(); await attach(markdown(image))
  await prisma.entity.update({ where: { id: id(1) }, data: { status: 'PUBLISHED', visibility: 'PUBLIC', publishedAt: new Date() } })
  assert.equal((await fetch(`${base}${image.url}`)).status, 200)
  await prisma.entity.update({ where: { id: id(1) }, data: { visibility: 'GM' } })
  const denied = await fetch(`${base}${image.url}`)
  assert.equal(denied.status, 404); assert.equal(denied.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await (await fetch(`${base}/api/v1/entities?kind=PLAYER_CHARACTER`)).json(), [])
})

test('a PJ fiche and its image become public only through the existing human publication workflow', async () => {
  const image = await upload(), manual = createPrismaManualService(prisma), editorial = createPrismaEditorialService(prisma)
  const created = await manual.create(createInput(markdown(image)), 'Auteur fictif', actor)
  assert.deepEqual(await (await fetch(`${base}/api/v1/entities?kind=PLAYER_CHARACTER`)).json(), [])
  const { slug: _slug, ...fields } = createInput(markdown(image)).entity
  void _slug
  const prepared = await editorial.patch(created.slug, { ...fields, visibility: 'PUBLIC', expectedUpdatedAt: created.updatedAt }, 'Auteur fictif', actor)
  assert.equal((await fetch(`${base}${image.url}`)).status, 404)
  await editorial.publish(created.slug, { expectedUpdatedAt: prepared.updatedAt }, 'Auteur fictif')
  const visible = await (await fetch(`${base}/api/v1/entities?kind=PLAYER_CHARACTER`)).json() as Array<{ kind: string; slug: string }>
  assert.deepEqual(visible.map(row => [row.kind, row.slug]), [['PLAYER_CHARACTER', 'pj-fictif']])
  assert.equal((await fetch(`${base}${image.url}`)).status, 200)
})
