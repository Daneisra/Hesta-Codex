import { z } from 'zod'
import { initialEvidenceSchema, manualCreateSchema } from '../admin/manual-validation.js'
import { checkProposalText } from './proposal-common.js'

export const ingestionProposalSchema = z.strictObject({
  receiptId: z.uuid(), expectedRevision: z.number().int().min(0).max(2_147_483_646),
  entity: manualCreateSchema.shape.entity,
  evidence: z.strictObject({ claimText: initialEvidenceSchema.shape.claimText,
    sourceExcerpt: initialEvidenceSchema.shape.sourceExcerpt, locator: initialEvidenceSchema.shape.locator }),
}).superRefine(checkProposalText)
export type IngestionProposalInput = z.infer<typeof ingestionProposalSchema>
