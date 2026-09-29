import { z } from 'zod'
import { creationSourceSchema, initialEvidenceSchema } from './manual-validation.js'

export const evidenceAddSchema = z.strictObject({
  source: creationSourceSchema,
  evidence: initialEvidenceSchema,
})

export type EvidenceAddInput = z.infer<typeof evidenceAddSchema>
