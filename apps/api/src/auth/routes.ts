import { Router, type RequestHandler } from 'express'
import type { AuthConfig } from './config.js'
import type { DiscordOAuth } from './discord.js'
import type { AuthStore, StoredSession } from './store.js'
import {
  beginOAuth, checkOAuthState, clearSessionCookie, currentSessionHash,
  newSessionToken, readSession, sessionHash, sessionResponse, setSessionCookie,
} from './session.js'

export interface AuthDependencies {
  config: AuthConfig
  store: AuthStore
  discord: DiscordOAuth
}

export function createAuthRouter({ config, store, discord }: AuthDependencies) {
  const router = Router()
  router.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store')
    next()
  })

  router.get('/session', async (request, response) => {
    response.json(sessionResponse(await readSession(request, response, config, store), config))
  })

  router.get('/discord/login', (_request, response) => {
    const state = beginOAuth(response, config)
    response.redirect(302, discord.authorizationUrl(state))
  })

  router.get('/discord/callback', async (request, response) => {
    if (!checkOAuthState(request, response, config)) {
      response.status(400).json({ error: { code: 'INVALID_OAUTH_STATE', message: 'Connexion Discord refusée' } })
      return
    }
    if (request.query.error !== undefined) {
      const denied = request.query.error === 'access_denied'
      response.status(400).json({ error: {
        code: denied ? 'OAUTH_DENIED' : 'OAUTH_FAILED',
        message: denied ? 'Connexion Discord annulée' : 'Connexion Discord refusée',
      } })
      return
    }
    const code = request.query.code
    if (typeof code !== 'string' || !code || code.length > 2048) {
      response.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Code Discord invalide' } })
      return
    }
    try {
      const identity = await discord.exchangeCode(code)
      const token = newSessionToken()
      await store.rotateSession(
        currentSessionHash(request, config), identity, sessionHash(token),
        new Date(Date.now() + config.sessionTtlMs),
      )
      setSessionCookie(response, config, token)
      response.redirect(303, '/admin')
    } catch {
      response.status(502).json({ error: { code: 'OAUTH_FAILED', message: 'Connexion Discord indisponible' } })
    }
  })

  router.post('/logout', async (request, response) => {
    if (request.headers.origin !== config.origin) {
      response.status(403).json({ error: { code: 'FORBIDDEN', message: 'Origine refusée' } })
      return
    }
    const hash = currentSessionHash(request, config)
    if (hash) await store.revokeSession(hash)
    clearSessionCookie(response, config)
    response.status(204).end()
  })

  return router
}

export function requireAdmin({ config, store }: Pick<AuthDependencies, 'config' | 'store'>): RequestHandler {
  return async (request, response, next) => {
    response.setHeader('Cache-Control', 'no-store')
    try {
      const session = await readSession(request, response, config, store)
      if (!session) {
        response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Connexion requise' } })
      } else if (!config.adminIds.has(session.discordId)) {
        response.status(403).json({ error: { code: 'FORBIDDEN', message: 'Accès administrateur refusé' } })
      } else {
        response.locals.adminSession = session
        next()
      }
    } catch (error) {
      next(error)
    }
  }
}

export function adminSession(response: { locals: Record<string, unknown> }): StoredSession {
  return response.locals.adminSession as StoredSession
}

export function requireSameOrigin(origin: string): RequestHandler {
  return (request, response, next) => {
    if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') {
      next()
      return
    }
    if (request.headers.origin !== origin) {
      response.status(403).json({ error: { code: 'INVALID_ORIGIN', message: 'Origine refusée' } })
      return
    }
    next()
  }
}
