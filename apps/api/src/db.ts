import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from './prisma-client/client.ts'

export function createPrismaClient(): PrismaClient {
  const databaseUrl = process.env.DATABASE_URL

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to start the API')
  }

  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) })
}
