import { config } from 'dotenv'
import { resolve } from 'node:path'
import { createApp } from './app.js'
import { createPrismaClient } from './db.js'
import { createPrismaStore } from './store.js'

config({ path: resolve(import.meta.dirname, '../../../.env'), quiet: true })

const port = Number(process.env.PORT ?? 3000)

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535')
}

const prisma = createPrismaClient()
const app = createApp(createPrismaStore(prisma))
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
    await prisma.$disconnect()
  } catch {
    console.error('Hesta Codex API shutdown failed')
    process.exitCode = 1
  }
}

process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())
