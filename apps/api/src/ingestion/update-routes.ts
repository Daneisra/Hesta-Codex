import { Router } from 'express'
import { z } from 'zod'
import { adminSession } from '../auth/routes.js'
import type { IngestionUpdateService } from './update.js'
import { ingestionUpdateSchema } from './update-validation.js'

export function createIngestionUpdateRouter(service: IngestionUpdateService) {
  const router = Router()
  const bad = (response: import('express').Response) => response.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Contexte de mise à jour invalide.' } })
  router.get('/items/:id/update-proposal', async (request, response) => {
    const query = z.strictObject({ receiptId: z.uuid() }).safeParse(request.query)
    if (!z.uuid().safeParse(request.params.id).success || !query.success) { bad(response); return }
    response.json(await service.prepare(request.params.id, query.data.receiptId))
  })
  router.post('/items/:id/update-proposal', async (request, response) => {
    if (!z.uuid().safeParse(request.params.id).success || Object.keys(request.query).length) { bad(response); return }
    const parsed = ingestionUpdateSchema.safeParse(request.body)
    if (!parsed.success) {
      const issues = parsed.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.code === 'unrecognized_keys' ? 'Champ inconnu.' : issue.message }))
      response.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Mise à jour invalide.', issues } }); return
    }
    const actor = adminSession(response)
    response.json(await service.apply(request.params.id, parsed.data, { discordId: actor.discordId, label: actor.displayName?.trim() || actor.username }))
  })
  return router
}
