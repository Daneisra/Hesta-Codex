import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { config } from 'dotenv'
import { createPrismaClient } from '../db.js'
import { localDirectory } from './obsidian-files.js'
import { runPromotionCommand } from './promotion-command.js'
import { createPrismaPromotionRepository } from './promotion-repository.js'
import { PromotionError } from './promotion.js'

config({ path: resolve(import.meta.dirname, '../../../../.env'), quiet: true })
process.exitCode = await runPromotionCommand(process.argv.slice(2), {
  async readClassifications(path) {
    await localDirectory(dirname(path))
    const before = await lstat(path)
    if (!before.isFile() || before.isSymbolicLink()) throw new PromotionError('CLASSIFICATIONS_FILE_INVALID')
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const opened = await handle.stat(), buffer = Buffer.alloc(1024 * 1024 + 1)
      if (!opened.isFile() || opened.ino !== before.ino || opened.dev !== before.dev || opened.size >= buffer.length) throw new PromotionError('CLASSIFICATIONS_FILE_INVALID')
      let length = 0
      while (length < buffer.length) {
        const read = await handle.read(buffer, length, buffer.length - length, length)
        if (!read.bytesRead) break
        length += read.bytesRead
      }
      const after = await handle.stat()
      if (length >= buffer.length || opened.size !== after.size || opened.mtimeMs !== after.mtimeMs || opened.ctimeMs !== after.ctimeMs) throw new PromotionError('CLASSIFICATIONS_FILE_INVALID')
      try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)) }
      catch { throw new PromotionError('CLASSIFICATIONS_FILE_INVALID') }
    } finally { await handle.close() }
  },
  async openDatabase() {
    if (!process.env.DATABASE_URL) throw new PromotionError('DATABASE_NOT_CONFIGURED')
    const prisma = createPrismaClient()
    return { repository: createPrismaPromotionRepository(prisma), close: () => prisma.$disconnect() }
  },
  write: line => console.log(line),
})
