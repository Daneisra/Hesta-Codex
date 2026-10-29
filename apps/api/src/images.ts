import sharp from 'sharp'
import { Router, raw } from 'express'
import { maxImageBytes, maxEntityImages, referencedImageIds, type UploadedImage } from '@hesta-codex/shared'
import { Prisma, type PrismaClient } from './prisma-client/client.ts'
import { EditorialError } from './admin/editorial.js'
import { adminSession, type AuthDependencies } from './auth/routes.js'
import { readSession } from './auth/session.js'

const pendingLifetime = 24 * 60 * 60 * 1000
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const formats: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp' }
const invalidImage = () => new EditorialError(400, 'IMAGE_INVALID', 'Image invalide. PNG, JPEG ou WebP fixe, 5 Mio et 20 millions de pixels maximum.')

export async function sanitizeImage(input: Buffer, mime: string) {
  if (!input.length || input.length > maxImageBytes || !Object.hasOwn(formats, mime)) throw invalidImage()
  const signature = mime === 'image/png' ? input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) :
    mime === 'image/jpeg' ? input.subarray(0, 3).equals(Buffer.from([255, 216, 255])) :
      input.subarray(0, 4).toString() === 'RIFF' && input.subarray(8, 12).toString() === 'WEBP'
  if (!signature) throw invalidImage()
  try {
    const image = sharp(input, { limitInputPixels: 20_000_000, failOn: 'warning' })
    const meta = await image.metadata()
    if (meta.format !== formats[mime] || !meta.width || !meta.height || meta.width > 6000 || meta.height > 6000 ||
      (meta.pages ?? 1) !== 1) throw invalidImage()
    // Re-encoding strips EXIF/GPS/XMP and prevents storing active/vector payloads.
    const { data, info } = await image.autoOrient().webp({ quality: 90, effort: 4 }).timeout({ seconds: 10 }).toBuffer({ resolveWithObject: true })
    if (!data.length || data.length > maxImageBytes) throw invalidImage()
    return { content: new Uint8Array(data), byteSize: data.length, width: info.width, height: info.height }
  } catch { throw invalidImage() }
}

/** Bind only this actor's fresh pending uploads, in the same transaction as the fiche/revision. */
export async function bindEntityImages(tx: Prisma.TransactionClient, body: string, entityId: string, actor?: string) {
  const ids = referencedImageIds(body)
  if (!ids.length) return
  if (ids.length > maxEntityImages) throw new EditorialError(400, 'IMAGES_LIMIT', '20 images maximum par fiche.')
  const rows = await tx.entityImage.findMany({ where: { id: { in: ids } }, select: { id: true, entityId: true, ownerDiscordId: true, createdAt: true } })
  if (rows.length !== ids.length || rows.some(row => row.entityId !== entityId &&
    (row.entityId !== null || !actor || row.ownerDiscordId !== actor || row.createdAt.getTime() <= Date.now() - pendingLifetime))) {
    throw new EditorialError(400, 'IMAGE_UNAVAILABLE', 'Une image est indisponible ou appartient à une autre fiche. Importez-la depuis ce formulaire.')
  }
  const pending = rows.filter(row => row.entityId === null).map(row => row.id)
  if (!pending.length) return
  const changed = await tx.entityImage.updateMany({ where: { id: { in: pending }, entityId: null, ownerDiscordId: actor },
    data: { entityId, ownerDiscordId: null } })
  if (changed.count !== pending.length) throw new EditorialError(409, 'IMAGE_MODIFIED', 'Une image a changé. Rechargez avant de réessayer.')
}

export interface ImageService {
  upload(input: Buffer, mime: string, actor: string): Promise<UploadedImage>
  read(id: string, admin: string | null): Promise<{ content: Uint8Array } | null>
}
export function createPrismaImageService(prisma: PrismaClient): ImageService {
  let active = 0
  return {
    async upload(input, mime, actor) {
      if (active >= 2) throw new EditorialError(429, 'IMAGE_BUSY', 'Deux imports sont déjà en cours. Réessayez dans un instant.')
      active++
      try {
        const data = await sanitizeImage(input, mime)
        return await prisma.$transaction(async tx => {
          await tx.entityImage.deleteMany({ where: { entityId: null, createdAt: { lte: new Date(Date.now() - pendingLifetime) } } })
          if (await tx.entityImage.count({ where: { entityId: null, ownerDiscordId: actor } }) >= maxEntityImages) {
            throw new EditorialError(429, 'IMAGES_PENDING_LIMIT', '20 imports non enregistrés maximum. Enregistrez votre fiche ou réessayez après leur expiration (24 h).')
          }
          const row = await tx.entityImage.create({ data: { ...data, ownerDiscordId: actor },
            select: { id: true, width: true, height: true, byteSize: true } })
          return { ...row, url: `/api/images/${row.id}` }
        }, { isolationLevel: 'Serializable' })
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
          throw new EditorialError(409, 'IMAGE_MODIFIED', 'Import concurrent. Réessayez.')
        }
        throw error
      } finally { active-- }
    },
    read(id, admin) {
      return prisma.$transaction(async tx => {
        const row = await tx.entityImage.findUnique({ where: { id }, select: {
          entityId: true, ownerDiscordId: true, createdAt: true,
          entity: { select: { status: true, visibility: true, bodyMarkdown: true } },
        } })
        if (!row) return null
        if (!row.entity) {
          if (!admin || admin !== row.ownerDiscordId || row.createdAt.getTime() <= Date.now() - pendingLifetime) return null
        } else if (!admin && (row.entity.status !== 'PUBLISHED' || row.entity.visibility !== 'PUBLIC' ||
          !referencedImageIds(row.entity.bodyMarkdown).includes(id))) return null
        return tx.entityImage.findUnique({ where: { id }, select: { content: true } })
      }, { isolationLevel: 'RepeatableRead' })
    },
  }
}

export function imageUploadRouter(service: ImageService) {
  const router = Router()
  router.post('/', (request, _response, next) => {
    if (request.headers['content-encoding'] || !Object.hasOwn(formats, request.headers['content-type']?.split(';')[0]?.trim() ?? '')) throw invalidImage()
    next()
  }, raw({ type: () => true, limit: maxImageBytes, inflate: false }), async (request, response) => {
    if (!Buffer.isBuffer(request.body) || request.headers['content-encoding']) throw invalidImage()
    response.status(201).json(await service.upload(request.body, request.headers['content-type']?.split(';')[0]?.trim() ?? '', adminSession(response).discordId))
  })
  return router
}
export function imageReadRouter(service: ImageService, auth: AuthDependencies) {
  const router = Router()
  router.use((_request, response, next) => {
    response.set({ 'Cache-Control': 'no-store', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' })
    next()
  })
  router.get('/:id', async (request, response) => {
    const id = request.params.id
    if (typeof id !== 'string' || !uuid.test(id)) { response.status(404).end(); return }
    const session = await readSession(request, response, auth.config, auth.store)
    const actor = session && auth.config.adminIds.has(session.discordId) ? session.discordId : null
    const image = await service.read(id, actor)
    if (!image) { response.status(404).end(); return }
    response.type('image/webp').send(Buffer.from(image.content))
  })
  return router
}
