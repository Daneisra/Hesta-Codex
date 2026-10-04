import { config } from 'dotenv'
import { resolve } from 'node:path'
import { createApp } from './app.js'
import { createPrismaAdminStore } from './admin/store.js'
import { createPrismaEditorialService } from './admin/editorial.js'
import { createPrismaEvidenceAddService } from './admin/evidence-add.js'
import { createPrismaManualService } from './admin/manual.js'
import { createPrismaManualRelationService } from './admin/manual-relations.js'
import { createPrismaProvenanceService } from './admin/provenance.js'
import { readAuthConfig } from './auth/config.js'
import { createDiscordOAuth } from './auth/discord.js'
import { createPrismaAuthStore } from './auth/store.js'
import { createPrismaClient } from './db.js'
import { createPrismaStore } from './store.js'
import { createPrismaGraphStore } from './graph.js'
import { createPrismaIngestionAdminStore } from './ingestion/admin.js'

config({ path: resolve(import.meta.dirname, '../../../.env'), quiet: true })

const port = Number(process.env.PORT ?? 3000)

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535')
}

const authConfig = readAuthConfig()
const prisma = createPrismaClient()
const graph = createPrismaGraphStore(prisma)
const app = createApp(createPrismaStore(prisma), {
  auth: {
    config: authConfig,
    store: createPrismaAuthStore(prisma),
    discord: createDiscordOAuth(authConfig),
  },
  admin: createPrismaAdminStore(prisma),
  editorial: createPrismaEditorialService(prisma),
  manual: createPrismaManualService(prisma),
  manualRelations: createPrismaManualRelationService(prisma),
  evidenceAdd: createPrismaEvidenceAddService(prisma),
  provenance: createPrismaProvenanceService(prisma),
  graph,
  ingestion: createPrismaIngestionAdminStore(prisma),
}, graph)
const server = app.listen(port, () => {
  console.log(`Hesta Codex API listening on http://localhost:${port}`)
})

let shuttingDown = false
async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  try {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  } catch {
    console.error('Hesta Codex API shutdown failed')
    process.exitCode = 1
  } finally {
    try {
      await prisma.$disconnect()
    } catch {
      console.error('Hesta Codex database disconnect failed')
      process.exitCode = 1
    }
  }
}

process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())
