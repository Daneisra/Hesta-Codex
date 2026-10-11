import { relationTypeDefinitions } from '../packages/shared/src/relation-catalog.js'
import type { PrismaClient } from '../apps/api/src/prisma-client/client.ts'

/** Add missing definitions without rewriting any existing UUID, label, timestamp or lore. */
export async function installRelationCatalog(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('LOCK TABLE "RelationType" IN SHARE ROW EXCLUSIVE MODE')
    const existing = await tx.relationType.findMany()
    for (const type of relationTypeDefinitions) {
      const codes = [type.code, type.inverseCode].filter(code => code !== null)
      if (existing.some(row => row.code !== type.code && (codes.includes(row.code) ||
        (row.inverseCode !== null && codes.includes(row.inverseCode))))) {
        throw new Error(`Conflicting relation code: ${type.code}`)
      }
      const same = existing.find(row => row.code === type.code)
      if (same) {
        if (same.label !== type.label || same.inverseCode !== type.inverseCode ||
          same.inverseLabel !== type.inverseLabel || same.symmetric !== type.symmetric) {
          throw new Error(`Existing relation definition differs: ${type.code}`)
        }
      } else existing.push(await tx.relationType.create({ data: type }))
    }
  })
}
