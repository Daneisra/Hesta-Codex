import { Router } from 'express'
import { z } from 'zod'
import { adminSession } from '../auth/routes.js'
import type { IngestionProposalService } from './proposal.js'
import { ingestionProposalSchema } from './proposal-validation.js'

export function createIngestionProposalRouter(service: IngestionProposalService) {
  const router = Router()
  const bad = (response: import('express').Response) => response.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Contexte de proposition invalide.' } })
  router.get('/items/:id/proposal', async (request, response) => {
    const query = z.strictObject({ receiptId: z.uuid() }).safeParse(request.query)
    if (!z.uuid().safeParse(request.params.id).success || !query.success) { bad(response); return }
    response.json(await service.prepare(request.params.id, query.data.receiptId))
  })
  router.post('/items/:id/proposal', async (request, response) => {
    if (!z.uuid().safeParse(request.params.id).success || Object.keys(request.query).length) { bad(response); return }
    const parsed = ingestionProposalSchema.safeParse(request.body)
    if (!parsed.success) {
      const issues = parsed.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.code === 'unrecognized_keys' ? 'Champ inconnu.' : issue.message }))
      response.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Proposition invalide.', issues } }); return
    }
    const actor = adminSession(response)
    response.status(201).json(await service.create(request.params.id, parsed.data, { discordId: actor.discordId, label: actor.displayName?.trim() || actor.username }))
  })
  return router
}
