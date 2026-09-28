import express, { type ErrorRequestHandler } from 'express'
import type { HealthResponse } from '@hesta-codex/shared'
import { EntityKind } from './prisma-client/enums.ts'
import { createAdminRouter } from './admin/routes.js'
import type { AdminStore } from './admin/store.js'
import { createAuthRouter, requireAdmin, type AuthDependencies } from './auth/routes.js'
import type { CodexStore, EntityFilters } from './store.js'

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const entityKinds = new Set<string>(Object.values(EntityKind))

class BadRequestError extends Error {}

function parseEntityFilters(query: Record<string, unknown>): EntityFilters {
  const unknownKey = Object.keys(query).find((key) => key !== 'kind' && key !== 'q')
  if (unknownKey) throw new BadRequestError(`Unknown query parameter: ${unknownKey}`)

  const filters: EntityFilters = {}
  if (query.kind !== undefined) {
    if (typeof query.kind !== 'string' || !entityKinds.has(query.kind)) {
      throw new BadRequestError('kind must be a valid EntityKind')
    }
    filters.kind = query.kind as EntityKind
  }
  if (query.q !== undefined) {
    if (typeof query.q !== 'string' || query.q.trim().length < 2 || query.q.trim().length > 100) {
      throw new BadRequestError('q must contain 2 to 100 characters')
    }
    filters.q = query.q.trim()
  }
  return filters
}

export function createApp(store: CodexStore, privateServices?: { auth: AuthDependencies; admin: AdminStore }) {
  const app = express()
  app.disable('x-powered-by')

  if (privateServices) {
    app.use('/api/auth', createAuthRouter(privateServices.auth))
    app.use('/api/admin', requireAdmin(privateServices.auth), createAdminRouter(privateServices.admin))
    app.use('/api/auth', (_request, response) => {
      response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } })
    })
    app.use('/api/admin', (_request, response) => {
      response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } })
    })
  }

  app.get('/api/v1/health', async (_request, response) => {
    try {
      await store.ping()
      const health: HealthResponse = {
        status: 'ok',
        service: 'hesta-codex-api',
        version: 'v1',
        database: 'ok',
      }
      response.json(health)
    } catch {
      const health: HealthResponse = {
        status: 'degraded',
        service: 'hesta-codex-api',
        version: 'v1',
        database: 'unavailable',
      }
      response.status(503).json(health)
    }
  })

  app.get('/api/v1/relation-types', async (_request, response) => {
    response.json(await store.listRelationTypes())
  })

  app.get('/api/v1/entities', async (request, response) => {
    const filters = parseEntityFilters(request.query)
    response.json(await store.listEntities(filters))
  })

  app.get('/api/v1/entities/:slug', async (request, response) => {
    const slug = request.params.slug
    if (!slug || slug.length > 200 || !slugPattern.test(slug)) {
      throw new BadRequestError('slug must be a valid lowercase URL slug')
    }

    const entity = await store.getEntityBySlug(slug)
    if (!entity) {
      response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Entity not found' } })
      return
    }
    response.json(entity)
  })

  app.use('/api/v1', (_request, response) => {
    response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } })
  })

  const handleError: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    void _next
    if (error instanceof BadRequestError) {
      response.status(400).json({ error: { code: 'INVALID_REQUEST', message: error.message } })
      return
    }
    console.error('Hesta Codex API request failed')
    response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } })
  }
  app.use(handleError)

  return app
}
