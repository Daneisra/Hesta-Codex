import { createHash } from 'node:crypto'
import { z } from 'zod'
import { newSourceSchema } from '../admin/manual-validation.js'

export const MAX_INGEST_BYTES = 5 * 1024 * 1024
export const MAX_CONTENT_BYTES = 256 * 1024
export const MAX_METADATA_BYTES = 16 * 1024
export const MAX_INGEST_ITEMS = 500
export interface IngestionIssue { path: string; message: string }

const credentialKey = /^(?:password|passwd|token|accesstoken|refreshtoken|secret|apikey|authorization|cookie|databaseurl|clientsecret|sessionsecret|discordtoken)$/i
const containsCredential = (text: string) => /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:gh[pousr]_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{20,}|sk-[a-zA-Z0-9_-]{20,}|AKIA[A-Z0-9]{16})\b|\b(?:DATABASE_URL\s*=|Authorization\s*:\s*Bearer\s+)|postgres(?:ql)?:\/\/[^\s]+/i.test(text)
const noCredential = (text: string) => !containsCredential(text)
const text = (max: number) => z.string().trim().min(1).max(max).refine(noCredential, 'Identifiant de connexion ou secret interdit')
const identifier = (max: number) => z.string().min(1).max(max).refine(value => value === value.trim() &&
  ![...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127), 'Identifiant invalide')
  .refine(noCredential, 'Secret interdit')
const optional = (schema: z.ZodString) => schema.nullable().optional().default(null)

// Reuse the editorial Source rules; new sources must have a stable identity for re-ingestion.
const sourceDescriptor = newSourceSchema.omit({ visibility: true }).extend({
  label: text(250), externalId: identifier(250),
  url: newSourceSchema.shape.url.refine(value => {
    if (!value) return true
    if (value.length > 2048 || !noCredential(value)) return false
    try {
      const url = new URL(value)
      return !url.username && !url.password && ![...url.searchParams.keys()].some(key => credentialKey.test(key.replace(/[^a-z]/gi, '')))
    } catch { return false }
  }, 'URL sans identifiants ni secrets attendue'),
  authorLabel: optional(text(200)),
  publishedAt: newSourceSchema.shape.publishedAt.refine(value => !value || Number(value.slice(0, 4)) >= 1, 'Année invalide'),
})
export const ingestionSourceSchema = z.union([z.strictObject({ id: z.uuid() }), sourceDescriptor])

function metadataValid(value: Record<string, unknown>): boolean {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }]
  let count = 0
  while (stack.length) {
    const entry = stack.pop()!
    if (++count > 1024 || entry.depth > 8) return false
    if (typeof entry.value === 'string' && (entry.value.length > 4000 || !noCredential(entry.value))) return false
    if (entry.value && typeof entry.value === 'object') {
      for (const [key, child] of Object.entries(entry.value)) {
        if (key.length > 100 || !noCredential(key) || credentialKey.test(key.replace(/[^a-z]/gi, '')) || ['__proto__', 'constructor', 'prototype'].includes(key)) return false
        stack.push({ value: child, depth: entry.depth + 1 })
      }
    }
  }
  return Buffer.byteLength(JSON.stringify(value), 'utf8') <= MAX_METADATA_BYTES
}
export const ingestionSchema = z.strictObject({
  version: z.literal(1),
  batch: z.strictObject({ label: text(250) }),
  items: z.array(z.strictObject({
    source: ingestionSourceSchema,
    externalId: optional(identifier(1024).refine(value => Buffer.byteLength(value, 'utf8') <= 1024, 'Identifiant trop volumineux')), title: optional(text(250)), locator: optional(text(1024)),
    content: z.string().refine(value => value.trim().length > 0, 'Contenu vide')
      .refine(value => Buffer.byteLength(value, 'utf8') <= MAX_CONTENT_BYTES, 'Contenu trop volumineux')
      .refine(noCredential, 'Secret ou identifiant de connexion interdit'),
    contentType: z.string().max(100).regex(/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i).refine(noCredential, 'Secret interdit').default('text/plain'),
    observedAt: z.iso.datetime({ offset: true }).refine(value => Number(value.slice(0, 4)) >= 1, 'Année invalide').nullable().optional().default(null),
    metadata: z.record(z.string(), z.unknown()).refine(metadataValid, 'Metadata excessives ou interdites').nullable().optional().default(null),
  })).min(1).max(MAX_INGEST_ITEMS),
})
export type IngestionDocument = z.infer<typeof ingestionSchema>
export type IngestionInput = IngestionDocument['items'][number]
export type IngestionSource = IngestionInput['source']

export const normalizedContent = (content: string) => content.replace(/\r\n?/g, '\n').normalize('NFC')
export const sha256 = (content: string) => createHash('sha256').update(content, 'utf8').digest('hex')
export const contentHash = (content: string) => sha256(normalizedContent(content))
export const itemIdentity = (externalId: string | null, hash: string) => externalId === null ? `h:${hash}` : `e:${sha256(externalId)}`

function issuePath(path: PropertyKey[]): string {
  return path.reduce<string>((result, part) => typeof part === 'number' ? `${result}[${part}]`
    : `${result}${result ? '.' : ''}${typeof part === 'string' && /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(part) && noCredential(part) ? part : '[champ]'}`, '') || '$'
}

export function parseIngestionText(input: string): { success: true; document: IngestionDocument } | { success: false; issues: IngestionIssue[] } {
  const fail = (message: string) => ({ success: false as const, issues: [{ path: '$', message }] })
  if (Buffer.byteLength(input, 'utf8') > MAX_INGEST_BYTES) return fail('Fichier trop volumineux (maximum 5 Mio)')
  let value: unknown
  try { value = JSON.parse(input.replace(/^\uFEFF/, '')) } catch { return fail('JSON invalide') }
  return validateIngestionDocument(value)
}

export function validateIngestionDocument(value: unknown): { success: true; document: IngestionDocument } | { success: false; issues: IngestionIssue[] } {
  // Bound nesting before schema validation, and reject strings PostgreSQL cannot preserve exactly.
  const stack: Array<{ value: unknown; path: PropertyKey[] }> = [{ value, path: [] }]
  let count = 0, textBytes = 0
  while (stack.length) {
    const entry = stack.pop()!
    const at = (message: string) => ({ success: false as const, issues: [{ path: issuePath(entry.path), message }] })
    if (++count > MAX_INGEST_ITEMS * (1024 + 32) + 32) return at('Structure trop volumineuse')
    if (entry.path.length > 16) return at('Structure trop profonde')
    if (entry.value !== null && !['string', 'number', 'boolean', 'object'].includes(typeof entry.value)) return at('Valeur JSON invalide')
    if (typeof entry.value === 'number' && !Number.isFinite(entry.value)) return at('Nombre JSON non fini')
    if (typeof entry.value === 'string') {
      textBytes += Buffer.byteLength(entry.value, 'utf8')
      if (textBytes > MAX_INGEST_BYTES) return at('Contenu total trop volumineux')
    }
    if (typeof entry.value === 'string' && (Buffer.from(entry.value, 'utf8').toString('utf8') !== entry.value || entry.value.includes('\0'))) return at('Texte Unicode invalide ou caractère nul')
    if (entry.value && typeof entry.value === 'object') {
      const array = Array.isArray(entry.value), prototype = Object.getPrototypeOf(entry.value)
      if (!array && prototype !== Object.prototype && prototype !== null) return at('Objet JSON attendu')
      if ((array ? (entry.value as unknown[]).length : Object.keys(entry.value).length) > 1024) return at('Conteneur JSON trop volumineux')
      for (const [key, child] of Object.entries(entry.value)) {
        if (Buffer.from(key, 'utf8').toString('utf8') !== key || key.includes('\0')) return at('Clé JSON Unicode invalide')
        stack.push({ value: child, path: [...entry.path, array ? Number(key) : key] })
      }
    }
  }
  const parsed = ingestionSchema.safeParse(value)
  if (!parsed.success) {
    const issues: IngestionIssue[] = []
    for (const issue of parsed.error.issues) {
      if (issue.code === 'invalid_union') {
        let inputAtPath: unknown = value
        for (const part of issue.path) inputAtPath = inputAtPath && typeof inputAtPath === 'object' ? Reflect.get(inputAtPath, part) : undefined
        const branch = inputAtPath && typeof inputAtPath === 'object' && Object.hasOwn(inputAtPath, 'id') ? 0 : 1
        for (const child of issue.errors[branch] ?? []) {
          if (child.code === 'unrecognized_keys') for (const key of child.keys) issues.push({ path: issuePath([...issue.path, ...child.path, key]), message: 'Champ inconnu' })
          else issues.push({ path: issuePath([...issue.path, ...child.path]), message: child.message })
        }
      } else if (issue.code === 'unrecognized_keys') for (const key of issue.keys) issues.push({ path: issuePath([...issue.path, key]), message: 'Champ inconnu' })
      else issues.push({ path: issuePath(issue.path), message: issue.message })
    }
    return { success: false, issues: issues.slice(0, 100) }
  }
  return { success: true, document: parsed.data }
}
