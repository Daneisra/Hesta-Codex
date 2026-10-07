import { z } from 'zod'
import { editorialFieldsSchema } from '../admin/validation.js'
import { ingestionProposalSchema } from './proposal-validation.js'
import { checkProposalText } from './proposal-common.js'

export const ingestionUpdateSchema = z.strictObject({
  receiptId: z.uuid(), targetEntityId: z.uuid(), expectedAssociationRevision: z.number().int().min(0).max(2_147_483_647),
  expectedEntityUpdatedAt: z.iso.datetime({ offset: true }), entity: editorialFieldsSchema,
  evidence: ingestionProposalSchema.shape.evidence.extend({
    // Preserve the exact receipt excerpt/locator, including line endings and boundary whitespace.
    sourceExcerpt: z.string().max(100_000).nullable().optional().default(null),
    locator: z.string().max(250).nullable().optional().default(null),
  }),
}).superRefine(checkProposalText)
export type IngestionUpdateInput = z.infer<typeof ingestionUpdateSchema>
