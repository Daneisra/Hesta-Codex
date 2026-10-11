import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../apps/api/src/prisma-client/client.ts'
import { installRelationCatalog } from './relation-catalog.js'
import { relationTypeDefinitions } from '../packages/shared/src/relation-catalog.js'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to seed RelationType')
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
})

try {
  await installRelationCatalog(prisma)
  console.log(`Installed ${relationTypeDefinitions.length} relation types`)
} finally {
  await prisma.$disconnect()
}
