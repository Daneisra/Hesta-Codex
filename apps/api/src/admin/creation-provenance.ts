import { Prisma } from '../prisma-client/client.ts'
import { EditorialError } from './editorial.js'
import type { CreationSource, InitialEvidence } from './manual-validation.js'

function prismaCode(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
}

export async function resolveCreationSource(tx: Prisma.TransactionClient, selection: CreationSource): Promise<string> {
  if (selection.mode === 'existing') {
    const source = await tx.source.findUnique({ where: { id: selection.sourceId }, select: { id: true } })
    if (!source) throw new EditorialError(404, 'SOURCE_NOT_FOUND', 'Source introuvable.')
    return source.id
  }
  const data = selection.data
  try {
    const source = await tx.source.create({ data: {
      kind: data.kind, label: data.label, externalId: data.externalId,
      url: data.url, authorLabel: data.authorLabel,
      publishedAt: data.publishedAt ? new Date(data.publishedAt) : null,
      visibility: data.visibility,
    }, select: { id: true } })
    return source.id
  } catch (error) {
    if (prismaCode(error, 'P2002')) {
      throw new EditorialError(409, 'SOURCE_CONFLICT', 'Une source de ce type utilise déjà cet identifiant externe.')
    }
    throw error
  }
}

export async function createInitialEvidence(tx: Prisma.TransactionClient, sourceId: string,
  target: { entityId: string; relationId: null } | { entityId: null; relationId: string },
  proof: InitialEvidence, sourceWasExisting: boolean): Promise<string> {
  try {
    const created = await tx.evidence.create({ data: {
      sourceId, ...target,
      claimText: proof.claimText, sourceExcerpt: proof.sourceExcerpt, locator: proof.locator,
      timeStartSeconds: proof.timeStartSeconds, timeEndSeconds: proof.timeEndSeconds,
      confidence: proof.confidence, visibility: proof.visibility,
    }, select: { id: true } })
    return created.id
  } catch (error) {
    if (sourceWasExisting && prismaCode(error, 'P2003')) {
      throw new EditorialError(404, 'SOURCE_NOT_FOUND', 'Source introuvable.')
    }
    throw error
  }
}
