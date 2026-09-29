import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { EditorialStatus, EntityKind, Visibility } from '../prisma-client/enums.ts'
import { adminSession } from '../auth/routes.js'
import type { EditorialService } from './editorial.js'
import type { ManualService } from './manual.js'
import { manualCreateSchema, sourceLookupSchema } from './manual-validation.js'
import type { ManualRelationService } from './manual-relations.js'
import { manualRelationSchema } from './manual-relations-validation.js'
import type { ProvenanceService } from './provenance.js'
import { evidencePatchSchema, relationPatchSchema, relationWorkflowSchema, sourcePatchSchema } from './provenance-validation.js'
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

export function createAdminRouter(store: AdminStore, editorial: EditorialService,
  provenance?: ProvenanceService, manual?: ManualService, manualRelations?: ManualRelationService) {
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

  if (manual) {
    router.get('/sources', async (request, response) => {
      const parsed = sourceLookupSchema.safeParse(request.query)
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Recherche de sources invalide.' } })
        return
      }
      response.json(await manual.listSources(parsed.data))
    })

    router.post('/entities', async (request, response) => {
      const parsed = manualCreateSchema.safeParse(request.body)
      if (!parsed.success) {
        const issues = parsed.error.issues.flatMap((issue) => issue.code === 'unrecognized_keys'
          ? issue.keys.map((key) => ({ path: [...issue.path, key].join('.'), message: 'Champ inconnu' }))
          : [{ path: issue.path.join('.'), message: issue.message }])
        response.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Création invalide.', issues } })
        return
      }
      const created = await manual.create(parsed.data, editorLabel(response))
      response.status(201).json(created)
    })
  }

  if (manualRelations) {
    router.get('/relation-types', async (_request, response) => {
      response.json(await manualRelations.listTypes())
    })
    router.post('/relations', async (request, response) => {
      const parsed = manualRelationSchema.safeParse(request.body)
      if (!parsed.success) {
        const issues = parsed.error.issues.flatMap((issue) => issue.code === 'unrecognized_keys'
          ? issue.keys.map((key) => ({ path: [...issue.path, key].join('.'), message: 'Champ inconnu' }))
          : [{ path: issue.path.join('.'), message: issue.message }])
        response.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Relation invalide.', issues } })
        return
      }
      response.status(201).json(await manualRelations.create(parsed.data))
    })
  }

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

  if (provenance) {
    const uuid = z.uuid()
    const mutation = <T>(schema: z.ZodType<T>, action: (id: string, input: T) => Promise<unknown>) =>
      async (request: Request, response: Response) => {
        const id = request.params.id
        if (typeof id !== 'string' || !uuid.safeParse(id).success) {
          response.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Identifiant invalide' } })
          return
        }
        const parsed = schema.safeParse(request.body)
        if (!parsed.success) {
          response.status(400).json({ error: { code: 'INVALID_REQUEST', message: validationMessage(parsed.error) } })
          return
        }
        response.json(await action(id, parsed.data))
      }
    router.patch('/relations/:id', mutation(relationPatchSchema, (id, input) => provenance.patchRelation(id, input)))
    router.post('/relations/:id/publish', mutation(relationWorkflowSchema,
      (id, input) => provenance.publishRelation(id, input)))
    router.post('/relations/:id/unpublish', mutation(relationWorkflowSchema,
      (id, input) => provenance.unpublishRelation(id, input)))
    router.patch('/sources/:id', mutation(sourcePatchSchema, (id, input) => provenance.patchSource(id, input)))
    router.patch('/evidence/:id', mutation(evidencePatchSchema, (id, input) => provenance.patchEvidence(id, input)))
  }

  return router
}
