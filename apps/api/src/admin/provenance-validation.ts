import { z } from 'zod'
import { SourceKind, Visibility } from '../prisma-client/enums.ts'

const expectedUpdatedAt = z.iso.datetime({ offset: true })
const nullableText = (max: number) => z.string().trim().max(max).transform((value) => value || null).nullable()
const seconds = z.number().int().min(0).max(2_147_483_647).nullable()
const confidence = z.number().min(0).max(1)
  .refine((value) => Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-8, 'Au plus trois décimales').nullable()

export const relationPatchSchema = z.strictObject({
  description: nullableText(10_000), visibility: z.enum(Visibility), expectedUpdatedAt,
})

export const sourcePatchSchema = z.strictObject({
  kind: z.enum(SourceKind),
  label: z.string().trim().min(1).max(250),
  externalId: z.string().min(1).max(250).refine((value) => value === value.trim(),
    'Espaces périphériques interdits').nullable(),
  url: z.url().refine((value) => /^https?:\/\//i.test(value), 'URL HTTP(S) attendue').nullable(),
  authorLabel: nullableText(200),
  publishedAt: expectedUpdatedAt.nullable(),
  visibility: z.enum(Visibility), expectedUpdatedAt,
})

export const evidencePatchSchema = z.strictObject({
  claimText: z.string().trim().min(1).max(10_000),
  sourceExcerpt: nullableText(100_000), locator: nullableText(250),
  timeStartSeconds: seconds, timeEndSeconds: seconds,
  confidence, visibility: z.enum(Visibility), expectedUpdatedAt,
}).superRefine((value, context) => {
  if (value.timeStartSeconds !== null && value.timeEndSeconds !== null && value.timeEndSeconds < value.timeStartSeconds) {
    context.addIssue({ code: 'custom', path: ['timeEndSeconds'], message: 'La fin précède le début' })
  }
})

export const relationWorkflowSchema = z.strictObject({ expectedUpdatedAt })
