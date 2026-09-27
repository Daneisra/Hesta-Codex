import express from 'express'
import type { HealthResponse } from '@hesta-codex/shared'

export const app = express()

app.get('/api/v1/health', (_request, response) => {
  const health: HealthResponse = {
    status: 'ok',
    service: 'hesta-codex-api',
    version: 'v1',
  }

  response.json(health)
})

