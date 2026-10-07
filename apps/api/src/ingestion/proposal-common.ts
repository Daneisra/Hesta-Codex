import type { Visibility } from '@hesta-codex/shared'
import type { z } from 'zod'
import { Prisma } from '../prisma-client/client.ts'
import { EditorialError } from '../admin/editorial.js'
import { manualCreateSchema } from '../admin/manual-validation.js'
import { readIngestionIdentity } from './association.js'

export async function proposalIdentity(tx: Prisma.TransactionClient, itemId: string, receiptId: string) {
  try { return await readIngestionIdentity(tx, itemId, receiptId) }
  catch (error) {
    if (error instanceof EditorialError && error.status === 404) throw new EditorialError(404, 'INGESTION_ITEM_NOT_FOUND', 'Item ou réception introuvable.')
    throw error
  }
}
export async function proposalReceipt(tx: Prisma.TransactionClient, itemId: string, receiptId: string) {
  const receipt = await tx.ingestionReceipt.findFirst({ where: { id: receiptId, itemId }, select: {
    id: true, title: true, contentType: true, metadata: true, rawVariant: true, locator: true, observedAt: true, ingestedAt: true,
    item: { select: { version: true, content: true } },
  } })
  if (!receipt) throw new EditorialError(404, 'INGESTION_ITEM_NOT_FOUND', 'Item ou réception introuvable.')
  return receipt
}
export function receiptProposal(receipt: Awaited<ReturnType<typeof proposalReceipt>>) {
  const content = receipt.rawVariant ?? receipt.item.content, warnings: string[] = []
  const contentSupported = ['text/plain', 'text/markdown'].includes(receipt.contentType.toLowerCase())
  if (!contentSupported) warnings.push('Ce format n’est pas repris automatiquement : le contenu éditorial reste vide. Saisissez-le manuellement.')
  const metadata = receipt.metadata && typeof receipt.metadata === 'object' && !Array.isArray(receipt.metadata) ? receipt.metadata : {}
  const parsedTags = manualCreateSchema.shape.entity.shape.tags.safeParse(metadata.tags)
  if ('tags' in metadata && !parsedTags.success) warnings.push('Les tags de metadata sont invalides et n’ont pas été repris.')
  if ((receipt.title?.length ?? 0) > 200) warnings.push('Le titre dépasse 200 caractères : corrigez-le avant création.')
  if (contentSupported && content.length > 100_000) warnings.push('Le contenu dépasse 100 000 caractères : adaptez-le sans modifier le staging.')
  if ((receipt.locator?.length ?? 0) > 250) warnings.push('Le repère dépasse 250 caractères : choisissez un repère court. Le repère original reste dans la Revision.')
  return { content, contentSupported, tags: parsedTags.success ? parsedTags.data : [], tagsAvailable: 'tags' in metadata && parsedTags.success,
    sourceExcerpt: contentSupported && content.length <= 100_000 ? content : '',
    locator: (receipt.locator?.length ?? 0) <= 250 ? receipt.locator : null, warnings }
}
const visibilityRank: Visibility[] = ['PUBLIC', 'PLAYERS', 'GM', 'SECRET']
export function provenanceVisibility(entity: Visibility, source: Visibility): Visibility {
  return visibilityRank[Math.max(visibilityRank.indexOf(entity), visibilityRank.indexOf(source))]!
}
export function ingestionTrace(item: { id: string; contentHash: string }, receipt: {
  id: string; locator: string | null; observedAt: Date | null; ingestedAt: Date; item: { version: number };
}, sourceId: string, evidenceId: string): Prisma.InputJsonObject {
  return { itemId: item.id, receiptId: receipt.id, sourceId, evidenceId, contentHash: item.contentHash,
    version: receipt.item.version, locator: receipt.locator, observedAt: receipt.observedAt?.toISOString() ?? null,
    ingestedAt: receipt.ingestedAt.toISOString() }
}
export function checkProposalText(value: unknown, context: z.RefinementCtx) {
  const walk = (entry: unknown, path: (string | number)[]) => {
    if (typeof entry === 'string' && (entry.includes('\0') || Buffer.from(entry, 'utf8').toString('utf8') !== entry)) {
      context.addIssue({ code: 'custom', path, message: 'Texte Unicode invalide ou caractère nul.' })
    } else if (Array.isArray(entry)) entry.forEach((child, index) => walk(child, [...path, index]))
    else if (entry && typeof entry === 'object') for (const [key, child] of Object.entries(entry)) walk(child, [...path, key])
  }
  walk(value, [])
}
