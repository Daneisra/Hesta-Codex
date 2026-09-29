import { z } from 'zod'
import { EntityKind, PlaceKind, Visibility } from '../prisma-client/enums.ts'

const label = (max: number) => z.string().trim().min(1).max(max)
const terms = (maxLength: number) => z.array(label(maxLength)).max(30).superRefine((values, context) => {
  const seen = new Set<string>()
  values.forEach((value, index) => {
    const key = value.normalize('NFC').toLocaleLowerCase('fr')
    if (seen.has(key)) context.addIssue({ code: 'custom', path: [index], message: 'Valeur dupliquée' })
    seen.add(key)
  })
})

export const editorialBase = z.strictObject({
  title: label(200),
  summary: z.union([z.string().trim().max(500).transform((value) => value || null), z.null()]),
  bodyMarkdown: z.string().max(100_000),
  kind: z.enum(EntityKind),
  placeKind: z.enum(PlaceKind).nullable(),
  aliases: terms(200),
  tags: terms(100),
  visibility: z.enum(Visibility),
})

export function checkPlaceKind(value: z.infer<typeof editorialBase>, context: z.RefinementCtx): void {
  if ((value.kind === 'PLACE') !== (value.placeKind !== null)) {
    context.addIssue({ code: 'custom', path: ['placeKind'], message: 'Requis uniquement pour PLACE' })
  }
}

export const editorialFieldsSchema = editorialBase.superRefine(checkPlaceKind)

const expectedUpdatedAt = z.iso.datetime({ offset: true })
const revisionMessage = z.union([z.string().trim().max(500).transform((value) => value || null), z.null()]).optional()

export const patchSchema = editorialBase.extend({
  expectedUpdatedAt,
  revisionMessage,
}).superRefine(checkPlaceKind)

export const workflowSchema = z.strictObject({ expectedUpdatedAt, revisionMessage })

export function validationMessage(error: z.ZodError): string {
  return error.issues.slice(0, 5).map((issue) => `${issue.path.join('.') || 'body'} : ${issue.message}`).join(' ; ')
}
