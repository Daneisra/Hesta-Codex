import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { CookieOptions, Request, Response } from 'express'
import type { AuthSessionResponse } from '@hesta-codex/shared'
import type { AuthConfig } from './config.js'
import type { AuthStore, StoredSession } from './store.js'

const oauthTtlMs = 10 * 60 * 1000
const sessionTokenPattern = /^[A-Za-z0-9_-]{43}$/

function equalSecret(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

function readCookie(request: Request, name: string): string | null {
  const values = request.headers.cookie?.split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`)) ?? []
  return values.length === 1 ? values[0]!.slice(name.length + 1) : null
}

export function sessionCookieName(config: AuthConfig): string {
  return config.secureCookies ? '__Host-hesta_codex_session' : 'hesta_codex_session'
}

function oauthCookieName(config: AuthConfig): string {
  return config.secureCookies ? '__Host-hesta_codex_oauth' : 'hesta_codex_oauth'
}

function cookieOptions(config: AuthConfig, maxAge: number): CookieOptions {
  return { httpOnly: true, secure: config.secureCookies, sameSite: 'lax', path: '/', maxAge }
}

export function clearSessionCookie(response: Response, config: AuthConfig): void {
  response.clearCookie(sessionCookieName(config), cookieOptions(config, 0))
}

export function setSessionCookie(response: Response, config: AuthConfig, token: string): void {
  response.cookie(sessionCookieName(config), token, cookieOptions(config, config.sessionTtlMs))
}

export function sessionHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

export function currentSessionHash(request: Request, config: AuthConfig): string | null {
  const token = readCookie(request, sessionCookieName(config))
  return token && sessionTokenPattern.test(token) ? sessionHash(token) : null
}

export function beginOAuth(response: Response, config: AuthConfig, now = Date.now()): string {
  const nonce = randomBytes(32).toString('base64url')
  const payload = `${now}.${nonce}`
  const signature = createHmac('sha256', config.sessionSecret).update(payload).digest('base64url')
  response.cookie(oauthCookieName(config), `${payload}.${signature}`, cookieOptions(config, oauthTtlMs))
  return nonce
}

export function checkOAuthState(request: Request, response: Response, config: AuthConfig, now = Date.now()): boolean {
  const cookie = readCookie(request, oauthCookieName(config))
  response.clearCookie(oauthCookieName(config), cookieOptions(config, 0))
  const state = request.query.state
  if (typeof state !== 'string' || !cookie || !/^[A-Za-z0-9_-]{43}$/.test(state)) return false
  const parts = cookie.split('.')
  if (parts.length !== 3) return false
  const [timeText, nonce, signature] = parts
  const issuedAt = Number(timeText)
  if (!Number.isSafeInteger(issuedAt) || issuedAt > now || now - issuedAt > oauthTtlMs) return false
  const expected = createHmac('sha256', config.sessionSecret).update(`${timeText}.${nonce}`).digest('base64url')
  return equalSecret(signature, expected) && equalSecret(state, nonce)
}

export async function readSession(
  request: Request,
  response: Response,
  config: AuthConfig,
  store: AuthStore,
): Promise<StoredSession | null> {
  const hash = currentSessionHash(request, config)
  if (!hash) return null
  const session = await store.findSession(hash, new Date())
  if (!session) clearSessionCookie(response, config)
  return session
}

export function sessionResponse(session: StoredSession | null, config: AuthConfig): AuthSessionResponse {
  if (!session) return { authenticated: false, isAdmin: false, user: null }
  return {
    authenticated: true,
    isAdmin: config.adminIds.has(session.discordId),
    user: { username: session.username, displayName: session.displayName },
  }
}
