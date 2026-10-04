import { open } from 'node:fs/promises'
import { resolve } from 'node:path'
import { config } from 'dotenv'
import { createPrismaClient } from '../db.js'
import { InvalidEncodingError, MissingDatabaseUrlError } from '../import/command.js'
import { MAX_INGEST_BYTES } from './format.js'
import { IngestionFileTooLargeError, runIngestionCommand } from './command.js'
import { createPrismaIngestionDatabase } from './repository.js'

config({ path: resolve(import.meta.dirname, '../../../../.env'), quiet: true })
process.exitCode = await runIngestionCommand(process.argv.slice(2), {
  async readText(path) {
    const handle = await open(path, 'r')
    try {
      const information = await handle.stat()
      if (!information.isFile()) throw new Error('Not a regular file')
      if (information.size > MAX_INGEST_BYTES) throw new IngestionFileTooLargeError()
      // A bounded read also protects against a file growing after stat().
      const buffer = Buffer.alloc(MAX_INGEST_BYTES + 1)
      let length = 0
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null)
        if (!bytesRead) break
        length += bytesRead
      }
      if (length > MAX_INGEST_BYTES) throw new IngestionFileTooLargeError()
      try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)) }
      catch { throw new InvalidEncodingError() }
    } finally { await handle.close() }
  },
  async openDatabase() {
    if (!process.env.DATABASE_URL) throw new MissingDatabaseUrlError()
    const prisma = createPrismaClient()
    return { database: createPrismaIngestionDatabase(prisma), close: () => prisma.$disconnect() }
  },
  write: line => console.log(line),
})
