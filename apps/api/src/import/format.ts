import { z } from 'zod'
import { EntityKind, PlaceKind, SourceKind, Visibility } from '../prisma-client/enums.ts'

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug attendu : minuscules, chiffres et tirets').max(200)
const nonEmpty = (max: number) => z.string().trim().min(1, 'Valeur requise').max(max)
const optionalText = (max: number) => nonEmpty(max).nullable().optional().default(null)
const exactIdentifier = (max: number) => z.string().min(1, 'Valeur requise').max(max)
  .refine((value) => value === value.trim(), 'Espaces périphériques interdits')
const seconds = z.number().int().min(0).max(2_147_483_647).nullable().optional().default(null)

export const evidenceSchema = z.strictObject({
  claimText: nonEmpty(10_000),
  sourceExcerpt: z.string().nullable().optional().default(null),
  locator: optionalText(250),
  timeStartSeconds: seconds,
  timeEndSeconds: seconds,
  confidence: z.number().min(0).max(1)
    .refine((value) => Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-8, 'Au plus trois décimales')
    .nullable().optional().default(null),
}).superRefine((evidence, context) => {
  if (evidence.timeStartSeconds !== null && evidence.timeEndSeconds !== null && evidence.timeEndSeconds < evidence.timeStartSeconds) {
    context.addIssue({ code: 'custom', path: ['timeEndSeconds'], message: 'La fin précède le début' })
  }
})

const evidenceList = z.array(evidenceSchema).min(1, 'Au moins une preuve est requise pour la provenance').max(100)

export const entitySchema = z.strictObject({
  slug,
  kind: z.enum(EntityKind),
  placeKind: z.enum(PlaceKind).optional(),
  title: nonEmpty(200),
  summary: z.string().max(500).nullable().optional().default(null),
  bodyMarkdown: z.string().default(''),
  aliases: z.array(nonEmpty(200)).max(100).default([]),
  tags: z.array(nonEmpty(100)).max(100).default([]),
  visibility: z.enum(Visibility).default('GM'),
  evidence: evidenceList,
}).superRefine((entity, context) => {
  if (entity.kind === 'PLACE' && entity.placeKind === undefined) {
    context.addIssue({ code: 'custom', path: ['placeKind'], message: 'placeKind est requis pour PLACE' })
  }
  if (entity.kind !== 'PLACE' && entity.placeKind !== undefined) {
    context.addIssue({ code: 'custom', path: ['placeKind'], message: 'placeKind est réservé à PLACE' })
  }
  for (const field of ['aliases', 'tags'] as const) {
    const seen = new Set<string>()
    for (const [index, value] of entity[field].entries()) {
      const key = value.toLocaleLowerCase('fr')
      if (seen.has(key)) {
        context.addIssue({ code: 'custom', path: [field, index], message: 'Valeur dupliquée dans la liste' })
      }
      seen.add(key)
    }
  }
})

export const relationSchema = z.strictObject({
  from: slug,
  to: slug,
  type: exactIdentifier(64),
  description: z.string().nullable().optional().default(null),
  visibility: z.enum(Visibility).default('GM'),
  evidence: evidenceList,
})

export const importSchema = z.strictObject({
  version: z.literal(1),
  source: z.strictObject({
    kind: z.enum(SourceKind),
    label: nonEmpty(250),
    externalId: exactIdentifier(250).nullable().optional().default(null),
    url: z.url().refine((value) => /^https?:\/\//i.test(value), 'URL HTTP(S) attendue')
      .nullable().optional().default(null),
    authorLabel: optionalText(200),
  }),
  entities: z.array(entitySchema).max(200).default([]),
  relations: z.array(relationSchema).max(500).default([]),
}).superRefine((document, context) => {
  if (document.entities.length === 0 && document.relations.length === 0) {
    context.addIssue({ code: 'custom', path: ['entities'], message: 'Le lot doit contenir une fiche ou une relation' })
  }
  const seen = new Set<string>()
  for (const [index, entity] of document.entities.entries()) {
    if (seen.has(entity.slug)) {
      context.addIssue({ code: 'custom', path: ['entities', index, 'slug'], message: 'Slug déjà présent dans ce fichier' })
    }
    seen.add(entity.slug)
  }
})

export type ImportDocument = z.infer<typeof importSchema>
export type ImportEntity = ImportDocument['entities'][number]
export type ImportRelation = ImportDocument['relations'][number]
export type ImportEvidence = ImportEntity['evidence'][number]
