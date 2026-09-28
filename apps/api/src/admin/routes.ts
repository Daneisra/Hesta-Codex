import { Router } from 'express'
import { z } from 'zod'
import { EditorialStatus, EntityKind, Visibility } from '../prisma-client/enums.ts'
import type { AdminStore } from './store.js'

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const filtersSchema = z.strictObject({
  status: z.enum(EditorialStatus).optional(),
  visibility: z.enum(Visibility).optional(),
  kind: z.enum(EntityKind).optional(),
  q: z.string().trim().min(2).max(100).optional(),
  page: z.string().regex(/^[1-9]\d{0,3}$/).transform(Number).optional().default(1),
})

export function createAdminRouter(store: AdminStore) {
  const router = Router()

  router.get('/stats', async (_request, response) => {
    response.json(await store.getStats())
  })

  router.get('/entities', async (request, response) => {
    const parsed = filtersSchema.safeParse(request.query)
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Filtres admin invalides' } })
      return
    }
    response.json(await store.listEntities(parsed.data))
  })

  router.get('/entities/:slug', async (request, response) => {
    const slug = request.params.slug
    if (!slug || slug.length > 200 || !slugPattern.test(slug)) {
      response.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Slug invalide' } })
      return
    }
    const entity = await store.getEntity(slug)
    if (!entity) {
      response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Fiche introuvable' } })
      return
    }
    response.json(entity)
  })

  return router
}
