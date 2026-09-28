import { z } from 'zod'
import type { AuthConfig } from './config.js'

const tokenResponse = z.object({ access_token: z.string().min(1), token_type: z.literal('Bearer') })
const userResponse = z.object({
  id: z.string().regex(/^\d{17,20}$/),
  username: z.string().min(1).max(100),
  global_name: z.string().max(200).nullable().optional(),
})

export interface DiscordIdentity {
  id: string
  username: string
  displayName: string | null
}

export interface DiscordOAuth {
  authorizationUrl(state: string): string
  exchangeCode(code: string): Promise<DiscordIdentity>
}

export function createDiscordOAuth(config: AuthConfig, request: typeof fetch = fetch): DiscordOAuth {
  return {
    authorizationUrl(state) {
      const url = new URL('https://discord.com/oauth2/authorize')
      url.search = new URLSearchParams({
        response_type: 'code',
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        scope: 'identify',
        state,
      }).toString()
      return url.href
    },
    async exchangeCode(code) {
      const token = await request('https://discord.com/api/v10/oauth2/token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: config.redirectUri }),
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      })
      if (!token.ok) throw new Error('Discord token exchange failed')
      const credentials = tokenResponse.parse(await token.json())
      const identity = await request('https://discord.com/api/v10/users/@me', {
        headers: { Authorization: `Bearer ${credentials.access_token}`, Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      })
      if (!identity.ok) throw new Error('Discord identity request failed')
      const user = userResponse.parse(await identity.json())
      return { id: user.id, username: user.username, displayName: user.global_name ?? null }
    },
  }
}
