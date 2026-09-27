import assert from 'node:assert/strict'
import { once } from 'node:events'
import { after, before, test } from 'node:test'
import type { Server } from 'node:http'
import type { HealthResponse } from '@hesta-codex/shared'
import { app } from './app.js'

let server: Server
let baseUrl: string

before(async () => {
  server = app.listen(0)
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  baseUrl = `http://127.0.0.1:${address.port}`
})

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
})

test('GET /api/v1/health returns the public API health contract', async () => {
  const response = await fetch(`${baseUrl}/api/v1/health`)
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') ?? '', /application\/json/)

  const body = (await response.json()) as HealthResponse
  assert.deepEqual(body, {
    status: 'ok',
    service: 'hesta-codex-api',
    version: 'v1',
  })
})

