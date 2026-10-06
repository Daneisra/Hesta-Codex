import { Router } from 'express'
import { z } from 'zod'
import { adminSession } from '../auth/routes.js'
import type { IngestionAssociationService } from './association.js'
import { normalizeMatchName } from './matching-normalization.js'

const resetSchema = z.strictObject({ receiptId: z.uuid(), expectedRevision: z.number().int().min(0).max(2_147_483_646) })
const decisionSchema = resetSchema.extend({ entityId: z.uuid(), origin: z.enum(['MATCH', 'MANUAL']) })
const querySchema = z.strictObject({ receiptId: z.uuid().optional() })
const candidatesSchema = z.array(z.uuid()).max(10)
const searchSchema = z.strictObject({ q: z.string().trim().min(2).max(100)
  .refine(value => !value.includes('\0') && Buffer.from(value, 'utf8').toString('utf8') === value && Array.from(normalizeMatchName(value)).length >= 2) })

export function createIngestionAssociationRouter(service: IngestionAssociationService) {
  const router = Router()
  const bad = (response: import('express').Response) => response.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Décision ou recherche invalide.' } })
  router.get('/items/:id/association', async (request, response) => {
    const query = querySchema.safeParse(request.query)
    let candidateIds: string[] = []
    const headers = request.headersDistinct['x-hesta-association-candidates']
    if (headers) {
      if (headers.length !== 1 || headers[0]!.length > 500) { bad(response); return }
      try {
        const parsed = candidatesSchema.safeParse(JSON.parse(headers[0]!))
        if (!parsed.success) { bad(response); return }
        candidateIds = [...new Set(parsed.data)]
      } catch { bad(response); return }
    }
    if (!z.uuid().safeParse(request.params.id).success || !query.success) { bad(response); return }
    response.json(await service.read(request.params.id, query.data.receiptId, candidateIds))
  })
  for (const action of ['confirm', 'reject', 'reset'] as const) {
    router.post(`/items/:id/association/${action}`, async (request, response) => {
      if (!z.uuid().safeParse(request.params.id).success || Object.keys(request.query).length) { bad(response); return }
      const actor = adminSession(response)
      if (action === 'reset') {
        const parsed = resetSchema.safeParse(request.body)
        if (!parsed.success) { bad(response); return }
        response.json(await service.reset(request.params.id, parsed.data))
      } else {
        const parsed = decisionSchema.safeParse(request.body)
        if (!parsed.success) { bad(response); return }
        response.json(await service[action](request.params.id, parsed.data, {
          discordId: actor.discordId, label: actor.displayName?.trim() || actor.username,
        }))
      }
    })
  }
  router.post('/entities/search', async (request, response) => {
    const parsed = searchSchema.safeParse(request.body)
    if (!parsed.success || Object.keys(request.query).length) { bad(response); return }
    response.json(await service.search(parsed.data.q))
  })
  return router
}
