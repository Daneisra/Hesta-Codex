export interface AuthConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  origin: string
  adminIds: ReadonlySet<string>
  sessionSecret: string
  sessionTtlMs: number
  secureCookies: boolean
}

const snowflake = /^\d{17,20}$/
const callbackPath = '/api/auth/discord/callback'
const maxSessionTtl = 30 * 24 * 60 * 60 * 1000

export function readAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const required = [
    'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_REDIRECT_URI',
    'DISCORD_ADMIN_IDS', 'SESSION_SECRET', 'SESSION_TTL_MS',
  ] as const
  for (const key of required) {
    if (!env[key]?.trim()) throw new Error(`Missing auth configuration: ${key}`)
  }

  const clientId = env.DISCORD_CLIENT_ID!
  const clientSecret = env.DISCORD_CLIENT_SECRET!
  const sessionSecret = env.SESSION_SECRET!
  const rawRedirect = env.DISCORD_REDIRECT_URI!
  const sessionTtlMs = Number(env.SESSION_TTL_MS)
  const adminIds = env.DISCORD_ADMIN_IDS!.split(',').map((id) => id.trim()).filter(Boolean)
  if (!snowflake.test(clientId)) throw new Error('Invalid auth configuration: DISCORD_CLIENT_ID')
  if (sessionSecret.length < 32) throw new Error('Invalid auth configuration: SESSION_SECRET')
  if (!Number.isSafeInteger(sessionTtlMs) || sessionTtlMs < 60_000 || sessionTtlMs > maxSessionTtl) {
    throw new Error('Invalid auth configuration: SESSION_TTL_MS')
  }
  if (adminIds.length === 0 || adminIds.some((id) => !snowflake.test(id))) {
    throw new Error('Invalid auth configuration: DISCORD_ADMIN_IDS')
  }

  let redirect: URL
  try {
    redirect = new URL(rawRedirect)
  } catch {
    throw new Error('Invalid auth configuration: DISCORD_REDIRECT_URI')
  }
  const localHttp = redirect.protocol === 'http:' &&
    (redirect.hostname === 'localhost' || redirect.hostname === '127.0.0.1')
  if (redirect.pathname !== callbackPath || redirect.search || redirect.hash ||
    redirect.username || redirect.password ||
    (redirect.protocol !== 'https:' && !localHttp) ||
    (env.NODE_ENV === 'production' && redirect.protocol !== 'https:')) {
    throw new Error('Invalid auth configuration: DISCORD_REDIRECT_URI')
  }

  return {
    clientId,
    clientSecret,
    redirectUri: redirect.href,
    origin: redirect.origin,
    adminIds: new Set(adminIds),
    sessionSecret,
    sessionTtlMs,
    secureCookies: redirect.protocol === 'https:' || env.NODE_ENV === 'production',
  }
}
