import type { PrismaClient } from '../prisma-client/client.ts'
import type { DiscordIdentity } from './discord.js'

export interface StoredSession {
  discordId: string
  username: string
  displayName: string | null
  expiresAt: Date
}

export interface AuthStore {
  findSession(tokenHash: string, now: Date): Promise<StoredSession | null>
  rotateSession(previousHash: string | null, identity: DiscordIdentity, tokenHash: string, expiresAt: Date): Promise<void>
  revokeSession(tokenHash: string): Promise<void>
}

export function createPrismaAuthStore(prisma: PrismaClient): AuthStore {
  return {
    async findSession(tokenHash, now) {
      const session = await prisma.session.findUnique({
        where: { tokenHash },
        select: {
          expiresAt: true,
          user: { select: { discordId: true, username: true, displayName: true } },
        },
      })
      if (!session || session.expiresAt <= now) return null
      return { ...session.user, expiresAt: session.expiresAt }
    },
    async rotateSession(previousHash, identity, tokenHash, expiresAt) {
      await prisma.$transaction(async (tx) => {
        const user = await tx.user.upsert({
          where: { discordId: identity.id },
          create: {
            discordId: identity.id,
            username: identity.username,
            displayName: identity.displayName,
          },
          update: { username: identity.username, displayName: identity.displayName },
          select: { id: true },
        })
        if (previousHash) await tx.session.deleteMany({ where: { tokenHash: previousHash } })
        await tx.session.create({ data: { tokenHash, userId: user.id, expiresAt } })
      })
    },
    async revokeSession(tokenHash) {
      await prisma.session.deleteMany({ where: { tokenHash } })
    },
  }
}
