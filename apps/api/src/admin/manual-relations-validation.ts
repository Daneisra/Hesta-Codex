import { z } from 'zod'
import { Visibility } from '../prisma-client/enums.ts'
import { creationSourceSchema, initialEvidenceSchema } from './manual-validation.js'

export const manualRelationSchema = z.strictObject({
  fromEntityId: z.uuid(),
  toEntityId: z.uuid(),
  relationCode: z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/, 'Code de relation invalide'),
  description: z.union([z.string().trim().max(10_000).transform((value) => value || null), z.null()])
    .optional().default(null),
  visibility: z.enum(Visibility).optional().default('GM'),
  source: creationSourceSchema,
  evidence: initialEvidenceSchema,
})

export type ManualRelationInput = z.infer<typeof manualRelationSchema>
