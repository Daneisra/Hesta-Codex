import { z } from 'zod'
import { initialEvidenceSchema, manualCreateSchema } from '../admin/manual-validation.js'

export const ingestionProposalSchema = z.strictObject({
  receiptId: z.uuid(), expectedRevision: z.number().int().min(0).max(2_147_483_646),
  entity: manualCreateSchema.shape.entity,
  evidence: z.strictObject({ claimText: initialEvidenceSchema.shape.claimText,
    sourceExcerpt: initialEvidenceSchema.shape.sourceExcerpt, locator: initialEvidenceSchema.shape.locator }),
}).superRefine((value, context) => {
  const walk = (entry: unknown, path: (string | number)[]) => {
    if (typeof entry === 'string' && (entry.includes('\0') || Buffer.from(entry, 'utf8').toString('utf8') !== entry)) {
      context.addIssue({ code: 'custom', path, message: 'Texte Unicode invalide ou caractère nul.' })
    } else if (Array.isArray(entry)) entry.forEach((child, index) => walk(child, [...path, index]))
    else if (entry && typeof entry === 'object') for (const [key, child] of Object.entries(entry)) walk(child, [...path, key])
  }
  walk(value, [])
})
export type IngestionProposalInput = z.infer<typeof ingestionProposalSchema>
