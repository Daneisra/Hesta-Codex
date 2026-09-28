import { Router } from 'express'
import { z } from 'zod'
import { EditorialStatus, EntityKind, Visibility } from '../prisma-client/enums.ts'
import { adminSession } from '../auth/routes.js'
import type { EditorialService } from './editorial.js'
import type { AdminStore } from './store.js'
import { patchSchema, validationMessage, workflowSchema } from './validation.js'

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const filtersSchema = z.strictObject({
  status: z.enum(EditorialStatus).optional(),
  visibility: z.enum(Visibility).optional(),
  kind: z.enum(EntityKind).optional(),
  q: z.string().trim().min(2).max(100).optional(),
  page: z.string().regex(/^[1-9]\d{0,3}$/).transform(Number).optional().default(1),
})

function validSlug(slug: string | undefined): slug is string {
  return !!slug && slug.length <= 200 && slugPattern.test(slug)
}

function editorLabel(response: { locals: Record<string, unknown> }): string {
  const actor = adminSession(response)
  return (actor.displayName?.trim() || actor.username).replace(/[\r\n]/g, ' ')
}

export function createAdminRouter(store: AdminStore, editorial: EditorialService) {
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
    if (!validSlug(slug)) {
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

  router.patch('/entities/:slug', async (request, response) => {
    if (!validSlug(request.params.slug)) {
      response.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Slug invalide' } })
      return
    }
    const parsed = patchSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'INVALID_REQUEST', message: validationMessage(parsed.error) } })
      return
    }
    response.json(await editorial.patch(request.params.slug, parsed.data, editorLabel(response)))
  })

  router.post('/entities/:slug/publish', async (request, response) => {
    if (!validSlug(request.params.slug)) {
      response.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Slug invalide' } })
      return
    }
    const parsed = workflowSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'INVALID_REQUEST', message: validationMessage(parsed.error) } })
      return
    }
    response.json(await editorial.publish(request.params.slug, parsed.data, editorLabel(response)))
  })

  router.post('/entities/:slug/unpublish', async (request, response) => {
    if (!validSlug(request.params.slug)) {
      response.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Slug invalide' } })
      return
    }
    const parsed = workflowSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'INVALID_REQUEST', message: validationMessage(parsed.error) } })
      return
    }
    response.json(await editorial.unpublish(request.params.slug, parsed.data, editorLabel(response)))
  })

  return router
}
