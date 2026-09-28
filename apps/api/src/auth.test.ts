import assert from 'node:assert/strict'
import { once } from 'node:events'
import type { Server } from 'node:http'
import { after, before, test } from 'node:test'
import type { Request, Response as ExpressResponse } from 'express'
import type { AdminEntityDetail, AdminStats } from '@hesta-codex/shared'
import type { PrismaClient } from './prisma-client/client.ts'
import { createApp } from './app.js'
import type { AdminStore } from './admin/store.js'
import { readAuthConfig } from './auth/config.js'
import { createDiscordOAuth, type DiscordOAuth } from './auth/discord.js'
import { beginOAuth, checkOAuthState } from './auth/session.js'
import { createPrismaAuthStore } from './auth/store.js'
import type { AuthStore, StoredSession } from './auth/store.js'
import type { CodexStore } from './store.js'

const config = readAuthConfig({
  DISCORD_CLIENT_ID: '111111111111111111',
  DISCORD_CLIENT_SECRET: 'test-client-secret',
  DISCORD_REDIRECT_URI: 'http://localhost:5173/api/auth/discord/callback',
  DISCORD_ADMIN_IDS: '222222222222222222',
  SESSION_SECRET: 'test-secret-that-is-longer-than-thirty-two-characters',
  SESSION_TTL_MS: '3600000',
})
const stats: AdminStats = {
  byStatus: { DRAFT: 0, PROPOSED: 1, PUBLISHED: 0, ARCHIVED: 0 },
  byVisibility: { PUBLIC: 0, PLAYERS: 0, GM: 1, SECRET: 0 },
  sources: 1,
  relations: 1,
}
const detail: AdminEntityDetail = {
  id: 'entity-1', slug: 'barolt', kind: 'PERSON', placeKind: null,
  title: 'Barolt', summary: 'Résumé privé', tags: ['lore'], aliases: [],
  status: 'PROPOSED', visibility: 'GM', bodyMarkdown: 'Texte privé',
  createdAt: '2026-09-28T00:00:00.000Z', updatedAt: '2026-09-28T00:00:00.000Z', publishedAt: null,
  evidence: [{
    id: 'evidence-1', claimText: 'Information vérifiée', sourceExcerpt: null, locator: 'p. 2',
    timeStartSeconds: null, timeEndSeconds: null, confidence: null, visibility: 'GM',
    source: { id: 'source-1', kind: 'MANUAL', label: 'Document privé', externalId: null,
      url: null, authorLabel: null, visibility: 'GM' },
  }],
  outgoingRelations: [], incomingRelations: [],
  revisions: [{ id: 'revision-1', number: 1, snapshot: { title: 'Barolt' },
    message: null, editorLabel: 'Import CLI Hesta Codex', createdAt: '2026-09-28T00:00:00.000Z' }],
}

const sessions = new Map<string, StoredSession>()
let lastHash: string | null = null
let receivedFilters: unknown
const authStore: AuthStore = {
  async findSession(hash, now) {
    const session = sessions.get(hash)
    return session && session.expiresAt > now ? session : null
  },
  async rotateSession(previousHash, identity, hash, expiresAt) {
    if (previousHash) sessions.delete(previousHash)
    sessions.set(hash, { discordId: identity.id, username: identity.username,
      displayName: identity.displayName, expiresAt })
    lastHash = hash
  },
  async revokeSession(hash) { sessions.delete(hash) },
}
const discord: DiscordOAuth = {
  authorizationUrl(state) { return `https://discord.com/oauth2/authorize?state=${state}&scope=identify` },
  async exchangeCode(code) {
    if (code === 'admin-code') return { id: '222222222222222222', username: 'admin', displayName: 'Admin' }
    if (code === 'player-code') return { id: '333333333333333333', username: 'player', displayName: null }
    throw new Error('Discord unavailable: secret must not be printed')
  },
}
const adminStore: AdminStore = {
  async listEntities(filters) {
    receivedFilters = filters
    return { items: [detail], total: 1, page: filters.page, pageSize: 50 }
  },
  async getEntity(slug) { return slug === 'barolt' ? detail : null },
  async getStats() { return stats },
}
const publicStore: CodexStore = {
  async ping() {},
  async listRelationTypes() { return [] },
  async listEntities() { return [] },
  async getEntityBySlug() { return null },
}

let server: Server
let baseUrl: string
before(async () => {
  server = createApp(publicStore, { auth: { config, store: authStore, discord }, admin: adminStore }).listen(0)
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  baseUrl = `http://127.0.0.1:${address.port}`
})
after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
})

function cookie(response: Response, name: string): string {
  const header = response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`))
  assert.ok(header, `Cookie ${name} missing`)
  return header.split(';')[0]!
}

async function login(code: string): Promise<string> {
  const started = await fetch(`${baseUrl}/api/auth/discord/login`, { redirect: 'manual' })
  assert.equal(started.status, 302)
  const state = new URL(started.headers.get('location')!).searchParams.get('state')
  assert.ok(state)
  const oauthCookie = cookie(started, 'hesta_codex_oauth')
  const callback = await fetch(`${baseUrl}/api/auth/discord/callback?state=${state}&code=${code}`, {
    headers: { Cookie: oauthCookie }, redirect: 'manual',
  })
  assert.equal(callback.status, 303)
  assert.equal(callback.headers.get('location'), '/admin')
  return cookie(callback, 'hesta_codex_session')
}

test('missing auth configuration fails closed without printing values', () => {
  assert.throws(() => readAuthConfig({}), /Missing auth configuration: DISCORD_CLIENT_ID/)
  assert.throws(() => readAuthConfig({ ...configEnv(), SESSION_SECRET: 'short' }), /SESSION_SECRET/)
  assert.throws(() => readAuthConfig({ ...configEnv(), SESSION_TTL_MS: '0' }), /SESSION_TTL_MS/)
  assert.throws(() => readAuthConfig({ ...configEnv(), DISCORD_ADMIN_IDS: ', , ' }), /DISCORD_ADMIN_IDS/)
  assert.throws(() => readAuthConfig({ ...configEnv(), DISCORD_REDIRECT_URI: 'https://evil.example/other' }), /DISCORD_REDIRECT_URI/)
  assert.deepEqual([...readAuthConfig({ ...configEnv(), DISCORD_ADMIN_IDS: ' , 222222222222222222 , ,333333333333333333, ' }).adminIds],
    ['222222222222222222', '333333333333333333'])
})

function configEnv(): NodeJS.ProcessEnv {
  return {
    DISCORD_CLIENT_ID: '111111111111111111', DISCORD_CLIENT_SECRET: 'test-client-secret',
    DISCORD_REDIRECT_URI: 'http://localhost:5173/api/auth/discord/callback',
    DISCORD_ADMIN_IDS: '222222222222222222',
    SESSION_SECRET: 'test-secret-that-is-longer-than-thirty-two-characters', SESSION_TTL_MS: '3600000',
  }
}

test('anonymous session and admin endpoints are protected with no-store', async () => {
  const session = await fetch(`${baseUrl}/api/auth/session`)
  assert.equal(session.status, 200)
  assert.deepEqual(await session.json(), { authenticated: false, isAdmin: false, user: null })
  assert.equal(session.headers.get('cache-control'), 'no-store')
  for (const path of [
    '/api/admin/stats', '/api/admin/entities', '/api/admin/entities/barolt',
    '/api/admin/entities?status=PROPOSED', '/api/admin/entities/', '/API/ADMIN/entities/barolt',
  ]) {
    const response = await fetch(`${baseUrl}${path}`)
    assert.equal(response.status, 401)
    assert.equal(response.headers.get('cache-control'), 'no-store')
  }
})

test('OAuth state mismatch is rejected before contacting Discord', async () => {
  const started = await fetch(`${baseUrl}/api/auth/discord/login`, { redirect: 'manual' })
  const oauthCookie = cookie(started, 'hesta_codex_oauth')
  const response = await fetch(`${baseUrl}/api/auth/discord/callback?state=invalid&code=admin-code`, {
    headers: { Cookie: oauthCookie }, redirect: 'manual',
  })
  assert.equal(response.status, 400)
  assert.equal((await response.json() as { error: { code: string } }).error.code, 'INVALID_OAUTH_STATE')
  assert.equal(response.headers.getSetCookie().some((value) => value.startsWith('hesta_codex_session=')), false)
})

test('callback rejects missing state, missing code, user refusal and provider failure without leaking details', async () => {
  const started = await fetch(`${baseUrl}/api/auth/discord/login`, { redirect: 'manual' })
  const state = new URL(started.headers.get('location')!).searchParams.get('state')!
  const oauthCookie = cookie(started, 'hesta_codex_oauth')
  const callback = async (query: string) => fetch(`${baseUrl}/api/auth/discord/callback?${query}`, {
    headers: { Cookie: oauthCookie }, redirect: 'manual',
  })
  assert.equal((await callback('code=admin-code')).status, 400)
  assert.equal((await callback(`state=${state}`)).status, 400)
  const denied = await callback(`state=${state}&error=access_denied&error_description=private-value`)
  assert.equal(denied.status, 400)
  assert.deepEqual(await denied.json(), { error: { code: 'OAUTH_DENIED', message: 'Connexion Discord annulée' } })
  assert.ok(denied.headers.getSetCookie().some((value) => value.startsWith('hesta_codex_oauth=')))
  const failed = await callback(`state=${state}&code=bad-code`)
  assert.equal(failed.status, 502)
  const body = JSON.stringify(await failed.json())
  assert.ok(!body.includes('secret'))
  assert.ok(!body.includes('bad-code'))
  assert.ok(!body.includes('private-value'))
})

test('authenticated non-admin receives 403 for all admin routes', async () => {
  const userCookie = await login('player-code')
  const session = await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: userCookie } })
  assert.deepEqual(await session.json(), {
    authenticated: true, isAdmin: false, user: { username: 'player', displayName: null },
  })
  for (const path of ['/api/admin/stats', '/api/admin/entities', '/api/admin/entities/barolt']) {
    const forbidden = await fetch(`${baseUrl}${path}`, { headers: { Cookie: userCookie } })
    assert.equal(forbidden.status, 403)
    assert.equal(forbidden.headers.get('cache-control'), 'no-store')
  }
})

test('admin reads PROPOSED GM list, filters, detail, provenance and revisions', async () => {
  const adminCookie = await login('admin-code')
  const session = await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: adminCookie } })
  assert.equal((await session.json() as { isAdmin: boolean }).isAdmin, true)
  const headers = { Cookie: adminCookie }
  const statsResponse = await fetch(`${baseUrl}/api/admin/stats`, { headers })
  assert.deepEqual(await statsResponse.json(), stats)
  const list = await fetch(`${baseUrl}/api/admin/entities?status=PROPOSED&visibility=GM&kind=PERSON&q=bar&page=2`, { headers })
  assert.equal(list.status, 200)
  assert.deepEqual(receivedFilters, { status: 'PROPOSED', visibility: 'GM', kind: 'PERSON', q: 'bar', page: 2 })
  assert.equal((await list.json() as { items: Array<{ status: string; visibility: string }> }).items[0]?.status, 'PROPOSED')
  const full = await fetch(`${baseUrl}/api/admin/entities/barolt`, { headers })
  assert.equal(full.status, 200)
  assert.deepEqual(await full.json(), detail)
  assert.equal((await fetch(`${baseUrl}/api/admin/entities/absent`, { headers })).status, 404)
  assert.equal((await fetch(`${baseUrl}/api/admin/entities?status=INVALID`, { headers })).status, 400)
  assert.equal((await fetch(`${baseUrl}/api/admin/entities?q=x`, { headers })).status, 400)
})

test('expired session is rejected and logout revokes a live session', async () => {
  const expiredCookie = await login('admin-code')
  assert.ok(lastHash)
  sessions.get(lastHash)!.expiresAt = new Date(Date.now() - 1)
  const expired = await fetch(`${baseUrl}/api/admin/stats`, { headers: { Cookie: expiredCookie } })
  assert.equal(expired.status, 401)
  const adminCookie = await login('admin-code')
  const csrf = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST', headers: { Cookie: adminCookie, Origin: 'https://other.example' },
  })
  assert.equal(csrf.status, 403)
  const logout = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST', headers: { Cookie: adminCookie, Origin: config.origin },
  })
  assert.equal(logout.status, 204)
  assert.ok(logout.headers.getSetCookie().some((value) => value.startsWith('hesta_codex_session=')))
  assert.equal((await fetch(`${baseUrl}/api/admin/stats`, { headers: { Cookie: adminCookie } })).status, 401)
})

test('logging out one browser does not revoke another session of the same Discord user', async () => {
  const first = await login('admin-code')
  const second = await login('admin-code')
  assert.notEqual(first, second)
  const logout = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST', headers: { Cookie: first, Origin: config.origin },
  })
  assert.equal(logout.status, 204)
  assert.equal((await fetch(`${baseUrl}/api/admin/stats`, { headers: { Cookie: first } })).status, 401)
  assert.equal((await fetch(`${baseUrl}/api/admin/stats`, { headers: { Cookie: second } })).status, 200)
})

test('production login cookies are HttpOnly Secure SameSite=Lax and host-only', async () => {
  const production = readAuthConfig({ ...configEnv(),
    NODE_ENV: 'production', DISCORD_REDIRECT_URI: 'https://codexhesta.dannytech.fr/api/auth/discord/callback',
  })
  const secureServer = createApp(publicStore, {
    auth: { config: production, store: authStore, discord }, admin: adminStore,
  }).listen(0)
  try {
    await once(secureServer, 'listening')
    const address = secureServer.address()
    assert.ok(address && typeof address !== 'string')
    const response = await fetch(`http://127.0.0.1:${address.port}/api/auth/discord/login`, { redirect: 'manual' })
    const header = response.headers.getSetCookie().find((value) => value.startsWith('__Host-hesta_codex_oauth='))
    assert.ok(header)
    assert.match(header, /HttpOnly/)
    assert.match(header, /Secure/)
    assert.match(header, /SameSite=Lax/)
    assert.match(header, /Path=\//)
    assert.match(header, /Max-Age=600/)
    assert.doesNotMatch(header, /Domain=/)
    const state = new URL(response.headers.get('location')!).searchParams.get('state')
    assert.ok(state)
    const callback = await fetch(`http://127.0.0.1:${address.port}/api/auth/discord/callback?state=${state}&code=admin-code`, {
      headers: { Cookie: cookie(response, '__Host-hesta_codex_oauth') }, redirect: 'manual',
    })
    assert.equal(callback.status, 303)
    const sessionHeader = callback.headers.getSetCookie().find((value) => value.startsWith('__Host-hesta_codex_session='))
    assert.ok(sessionHeader)
    assert.match(sessionHeader, /HttpOnly/)
    assert.match(sessionHeader, /Secure/)
    assert.match(sessionHeader, /SameSite=Lax/)
    assert.match(sessionHeader, /Max-Age=3600/)
    assert.doesNotMatch(sessionHeader, /Domain=/)
  } finally {
    await new Promise<void>((resolve, reject) => secureServer.close((error) => error ? reject(error) : resolve()))
  }
})

test('OAuth state expires even when its signed cookie is retained', () => {
  let stored = ''
  const response = {
    cookie(_name: string, value: string) { stored = value },
    clearCookie() {},
  } as unknown as ExpressResponse
  const state = beginOAuth(response, config, 1_000)
  const request = {
    headers: { cookie: `hesta_codex_oauth=${stored}` },
    query: { state },
  } as unknown as Request
  assert.equal(checkOAuthState(request, response, config, 1_000 + 10 * 60 * 1000 + 1), false)
})

test('Discord provider requests only identify and keeps the OAuth token transient', async () => {
  const calls: Array<{ url: string; options: RequestInit | undefined }> = []
  const fakeFetch = async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = String(input)
    calls.push({ url, options })
    if (url.endsWith('/oauth2/token')) {
      return new Response(JSON.stringify({ access_token: 'temporary-test-token', token_type: 'Bearer' }), { status: 200 })
    }
    return new Response(JSON.stringify({ id: '222222222222222222', username: 'mj', global_name: 'Maître du jeu' }), { status: 200 })
  }
  const provider = createDiscordOAuth(config, fakeFetch as typeof fetch)
  const url = new URL(provider.authorizationUrl('state-example'))
  assert.equal(url.origin, 'https://discord.com')
  assert.equal(url.searchParams.get('scope'), 'identify')
  assert.equal(url.searchParams.get('state'), 'state-example')
  assert.equal(url.searchParams.get('redirect_uri'), config.redirectUri)
  assert.deepEqual(await provider.exchangeCode('one-time-code'), {
    id: '222222222222222222', username: 'mj', displayName: 'Maître du jeu',
  })
  assert.equal(calls.length, 2)
  assert.equal(calls[0]?.options?.method, 'POST')
  assert.equal(calls[0]?.options?.redirect, 'error')
  assert.equal(calls[1]?.options?.redirect, 'error')
  assert.equal((calls[1]?.options?.headers as Record<string, string>).Authorization, 'Bearer temporary-test-token')
})

test('invalid Discord identity is rejected without creating a session', async () => {
  const provider = createDiscordOAuth(config, async (input) => String(input).endsWith('/oauth2/token')
    ? new Response(JSON.stringify({ access_token: 'temporary', token_type: 'Bearer' }), { status: 200 })
    : new Response(JSON.stringify({ id: 'invalid', username: 'someone' }), { status: 200 }))
  await assert.rejects(provider.exchangeCode('one-time-code'))
})

test('Prisma session store rotates and revokes only hashed session tokens in a transaction', async () => {
  const calls: string[] = []
  const expiresAt = new Date(Date.now() + 60_000)
  const transactionClient = {
    user: { async upsert() { calls.push('user.upsert'); return { id: 'user-1' } } },
    session: {
      async deleteMany(query: { where: { tokenHash: string } }) {
        calls.push(`session.deleteMany:${query.where.tokenHash}`)
      },
      async create(query: { data: { tokenHash: string; userId: string; expiresAt: Date } }) {
        assert.equal(query.data.userId, 'user-1')
        assert.equal(query.data.tokenHash, 'new-hash')
        assert.equal(query.data.expiresAt, expiresAt)
        calls.push('session.create')
      },
    },
  }
  const prisma = {
    async $transaction(work: (client: typeof transactionClient) => Promise<void>) {
      calls.push('transaction.begin')
      await work(transactionClient)
      calls.push('transaction.commit')
    },
    session: {
      async findUnique() {
        return { expiresAt, user: { discordId: '222222222222222222', username: 'mj', displayName: null } }
      },
      async deleteMany(query: { where: { tokenHash: string } }) {
        calls.push(`revoke:${query.where.tokenHash}`)
      },
    },
  } as unknown as PrismaClient
  const store = createPrismaAuthStore(prisma)
  await store.rotateSession('old-hash', { id: '222222222222222222', username: 'mj', displayName: null }, 'new-hash', expiresAt)
  assert.deepEqual(calls, [
    'transaction.begin', 'user.upsert', 'session.deleteMany:old-hash', 'session.create', 'transaction.commit',
  ])
  assert.equal((await store.findSession('new-hash', new Date()))?.discordId, '222222222222222222')
  assert.equal(await store.findSession('new-hash', new Date(expiresAt.getTime() + 1)), null)
  await store.revokeSession('new-hash')
  assert.equal(calls.at(-1), 'revoke:new-hash')
})
