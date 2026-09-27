import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client.ts'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to seed RelationType')
}

const relationTypes = [
  {
    code: 'located_in',
    label: 'situé dans',
    inverseCode: 'contains',
    inverseLabel: 'contient',
    symmetric: false,
  },
  {
    code: 'member_of',
    label: 'membre de',
    inverseCode: 'has_member',
    inverseLabel: 'compte parmi ses membres',
    symmetric: false,
  },
  {
    code: 'parent_of',
    label: 'parent de',
    inverseCode: 'child_of',
    inverseLabel: 'enfant de',
    symmetric: false,
  },
  {
    code: 'allied_with',
    label: 'allié à',
    inverseCode: null,
    inverseLabel: null,
    symmetric: true,
  },
] as const

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
})

try {
  for (const relationType of relationTypes) {
    await prisma.relationType.upsert({
      where: { code: relationType.code },
      create: relationType,
      update: {
        label: relationType.label,
        inverseCode: relationType.inverseCode,
        inverseLabel: relationType.inverseLabel,
        symmetric: relationType.symmetric,
      },
    })
  }

  console.log(`Seeded ${relationTypes.length} relation types`)
} finally {
  await prisma.$disconnect()
}
