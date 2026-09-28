import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { config } from 'dotenv'
import { createPrismaClient } from '../db.js'
import { createPrismaImportDatabase } from './repository.js'
import { ImportFileTooLargeError, InvalidEncodingError, MAX_IMPORT_BYTES, MissingDatabaseUrlError, runImportCommand } from './command.js'

config({ path: resolve(import.meta.dirname, '../../../../.env'), quiet: true })

const exitCode = await runImportCommand(process.argv.slice(2), {
  async readText(path) {
    const information = await stat(path)
    if (information.size > MAX_IMPORT_BYTES) throw new ImportFileTooLargeError()
    const contents = await readFile(path)
    if (contents.byteLength > MAX_IMPORT_BYTES) throw new ImportFileTooLargeError()
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(contents)
    } catch {
      throw new InvalidEncodingError()
    }
  },
  async openDatabase() {
    if (!process.env.DATABASE_URL) throw new MissingDatabaseUrlError()
    const prisma = createPrismaClient()
    return {
      database: createPrismaImportDatabase(prisma),
      close: () => prisma.$disconnect(),
    }
  },
  write: (line) => console.log(line),
})

process.exitCode = exitCode
