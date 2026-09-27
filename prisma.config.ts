import 'dotenv/config'
import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  // Offline schema validation uses an unreachable placeholder. Database operations require DATABASE_URL.
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://invalid:invalid@127.0.0.1:1/invalid',
  },
})
