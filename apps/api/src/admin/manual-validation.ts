import { z } from 'zod'
import { PlaceKind, Visibility } from '../prisma-client/enums.ts'
import { checkEvidenceTimeOrder, evidenceFieldsSchema, sourceFieldsSchema } from './provenance-validation.js'
import { checkPlaceKind, editorialBase } from './validation.js'

const entity = editorialBase.extend({
  slug: z.string().max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'Minuscules, chiffres et tirets uniquement ; aucun changement automatique'),
  placeKind: z.enum(PlaceKind).nullable().optional().default(null),
  summary: z.union([z.string().trim().max(500).transform((value) => value || null), z.null()])
    .optional().default(null),
  bodyMarkdown: z.string().max(100_000).optional().default(''),
  aliases: editorialBase.shape.aliases.optional().default([]),
  tags: editorialBase.shape.tags.optional().default([]),
  visibility: z.enum(Visibility).optional().default('GM'),
}).superRefine(checkPlaceKind)

export const newSourceSchema = sourceFieldsSchema.extend({
  externalId: sourceFieldsSchema.shape.externalId.optional().default(null),
  url: sourceFieldsSchema.shape.url.optional().default(null),
  authorLabel: sourceFieldsSchema.shape.authorLabel.optional().default(null),
  publishedAt: sourceFieldsSchema.shape.publishedAt.optional().default(null),
  visibility: z.enum(Visibility).optional().default('GM'),
})

export const initialEvidenceSchema = evidenceFieldsSchema.extend({
  sourceExcerpt: evidenceFieldsSchema.shape.sourceExcerpt.optional().default(null),
  locator: evidenceFieldsSchema.shape.locator.optional().default(null),
  timeStartSeconds: evidenceFieldsSchema.shape.timeStartSeconds.optional().default(null),
  timeEndSeconds: evidenceFieldsSchema.shape.timeEndSeconds.optional().default(null),
  confidence: evidenceFieldsSchema.shape.confidence.optional().default(null),
  visibility: z.enum(Visibility).optional().default('GM'),
}).superRefine(checkEvidenceTimeOrder)

export const creationSourceSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('existing'), sourceId: z.uuid() }),
  z.strictObject({ mode: z.literal('new'), data: newSourceSchema }),
])

export type CreationSource = z.infer<typeof creationSourceSchema>
export type InitialEvidence = z.infer<typeof initialEvidenceSchema>

export const manualCreateSchema = z.strictObject({
  entity,
  source: creationSourceSchema,
  evidence: initialEvidenceSchema,
})

export type ManualCreateInput = z.infer<typeof manualCreateSchema>

export const sourceLookupSchema = z.strictObject({
  q: z.string().trim().min(2).max(100).optional(),
  page: z.string().regex(/^[1-9]\d{0,2}$|^1000$/).transform(Number).optional().default(1),
})

export type SourceLookupInput = z.infer<typeof sourceLookupSchema>
