import { z } from 'zod'
import { EntityKind, PlaceKind, type Visibility } from '../prisma-client/enums.ts'
import type { AssociationActor } from './association.js'
import { ingestionSourceSchema, itemIdentity, sha256 } from './format.js'
import { receiptProposal, type proposalReceipt } from './proposal-common.js'
import { ingestionProposalSchema, type IngestionProposalInput } from './proposal-validation.js'

export const MAX_PROMOTION_NOTES = 1000
export class PromotionError extends Error {
  constructor(public readonly code: string) { super(code) }
}
export interface PromotionSource {
  id: string; kind: 'OBSIDIAN'; externalId: string; label: string; visibility: Visibility; updatedAt: Date
}
export interface PromotionNote {
  id: string; sourceId: string; identityKey: string; externalId: string | null; version: number; contentHash: string
  receipt: Awaited<ReturnType<typeof proposalReceipt>>
  associationRevision: number; confirmedEntityId: string | null
}
export interface PromotionSnapshot {
  source: PromotionSource; notes: PromotionNote[]; occupiedSlugs: Array<{ id: string; slug: string }>
}
export interface PromotionRepository {
  snapshot(sourceExternalId: string): Promise<PromotionSnapshot>
  create(source: PromotionSource, note: PromotionNote, input: IngestionProposalInput, actor: AssociationActor): Promise<'created' | 'skipped'>
}
export interface Classification { kind: EntityKind; placeKind: PlaceKind | null; review: boolean }
const validText = (value: string) => ![...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) &&
  Buffer.from(value, 'utf8').toString('utf8') === value
export const actorSchema = z.strictObject({
  discordId: z.string().regex(/^\d{17,20}$/),
  label: z.string().min(1).max(200).refine(value => value === value.trim() && validText(value)),
})
export function validateSourceExternalId(value: string) {
  if (!ingestionSourceSchema.safeParse({ kind: 'OBSIDIAN', externalId: value, label: 'Validation' }).success || !validText(value)) {
    throw new PromotionError('SOURCE_ID_INVALID')
  }
}
export function validNotePath(value: string | null): value is string {
  return value !== null && Buffer.byteLength(value, 'utf8') <= 1024 && value === value.trim() && validText(value) &&
    /\.md$/i.test(value) && !/[\\:]/.test(value) && value.split('/').every(part => !!part && !part.startsWith('.'))
}
const exceptionSchema = z.strictObject({ version: z.literal(1), items: z.array(z.strictObject({
  externalId: z.string().refine(validNotePath), kind: z.enum(EntityKind), placeKind: z.enum(PlaceKind).nullable().optional().default(null),
}).superRefine((value, context) => {
  if ((value.kind === 'PLACE') !== (value.placeKind !== null)) context.addIssue({ code: 'custom', message: 'Sous-type incompatible.' })
})).max(MAX_PROMOTION_NOTES) })
export type ClassificationException = z.infer<typeof exceptionSchema>['items'][number]
export function parseClassificationExceptions(text: string): ClassificationException[] {
  try {
    const parsed = exceptionSchema.parse(JSON.parse(text)), paths = new Set<string>()
    for (const item of parsed.items) {
      if (paths.has(item.externalId)) throw new PromotionError('CLASSIFICATIONS_INVALID')
      paths.add(item.externalId)
    }
    return parsed.items
  } catch { throw new PromotionError('CLASSIFICATIONS_INVALID') }
}
const normalizedFolder = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
export function classifyNote(path: string, exceptions: ClassificationException[]): Classification {
  const exception = exceptions.find(entry => entry.externalId === path)
  if (exception) return { kind: exception.kind, placeKind: exception.placeKind, review: exception.kind === 'OTHER' }
  const parts = path.split('/').slice(0, -1).map(normalizedFolder)
  const folder = parts[0] === 'instances' && parts[1] ? `instances ${parts[1]}` : parts[0]
  const kinds: Record<string, EntityKind> = {
    artefacts: 'ARTIFACT', divinites: 'DEITY', 'familles nobles': 'FAMILY', hesta: 'CONCEPT',
    'instances autres': 'ORGANIZATION', 'instances imperiales': 'ORGANIZATION', 'instances militaires': 'ORGANIZATION',
    notables: 'PERSON', 'notables defunt': 'PERSON', 'notables defunts': 'PERSON',
  }
  const places: Record<string, PlaceKind> = { continents: 'CONTINENT', lieux: 'OTHER', villes: 'CITY' }
  if (folder && Object.hasOwn(places, folder)) return { kind: 'PLACE', placeKind: places[folder]!, review: false }
  if (folder && Object.hasOwn(kinds, folder)) return { kind: kinds[folder]!, placeKind: null, review: false }
  // Ambiguous or unmapped folders require an explicit exception or acceptance of provisional OTHER.
  return { kind: 'OTHER', placeKind: null, review: true }
}
export function canonicalPromotionJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry) ?
    Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry)
}
export const promotionNoteFingerprint = (note: PromotionNote) => sha256(canonicalPromotionJson(note))
const slugPart = (value: string) => value.toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/ß/g, 'ss')
  .normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const withSuffix = (base: string, suffix: string) => `${base.slice(0, 199 - suffix.length).replace(/-$/g, '')}-${suffix}`
export interface PromotionEntry {
  note: PromotionNote; classification: Classification; slug: string; collision: boolean
  action: 'CREATE' | 'SKIP' | 'REJECT' | 'COLLISION'; code: string | null; input: IngestionProposalInput | null
}
export interface PromotionPlan {
  source: PromotionSource; entries: PromotionEntry[]; fingerprint: string
  summary: { detected: number; creatable: number; skipped: number; rejected: number; collisions: number; unresolvedCollisions: number; review: number }
}
export interface PromotionPlanOptions { actor: AssociationActor; expectedCount: number; allowProvisional: boolean; exceptions: ClassificationException[] }
export function buildPromotionPlan(snapshot: PromotionSnapshot, options: PromotionPlanOptions): PromotionPlan {
  actorSchema.parse(options.actor)
  if (snapshot.notes.length > MAX_PROMOTION_NOTES) throw new PromotionError('SELECTION_LIMIT')
  const paths = new Set<string>(), identities = new Set<string>()
  for (const note of snapshot.notes) {
    if (note.sourceId !== snapshot.source.id || identities.has(note.identityKey) || (note.externalId !== null && paths.has(note.externalId))) {
      throw new PromotionError('SELECTION_INCOMPATIBLE')
    }
    identities.add(note.identityKey); if (note.externalId !== null) paths.add(note.externalId)
  }
  if (options.exceptions.some(entry => !paths.has(entry.externalId))) throw new PromotionError('CLASSIFICATION_PATH_NOT_SELECTED')
  const notes = [...snapshot.notes].sort((a, b) => (a.externalId ?? a.id) < (b.externalId ?? b.id) ? -1 : 1)
  const occupied = new Map(snapshot.occupiedSlugs.map(entry => [entry.slug, entry.id]))
  const base = notes.map(note => slugPart(note.receipt.title ?? '') || `fiche-${sha256(note.externalId ?? note.id).slice(0, 12)}`)
  const counts = (values: string[]) => {
    const map = new Map<string, number>()
    for (const value of values) map.set(value, (map.get(value) ?? 0) + 1)
    return map
  }
  const baseCounts = counts(base), collisions = base.map((slug, index) => baseCounts.get(slug)! > 1 ||
    (occupied.has(slug) && occupied.get(slug) !== notes[index]!.confirmedEntityId))
  const candidates = base.map((slug, index) => {
    if (!collisions[index]) return slug.slice(0, 200).replace(/-$/g, '')
    const folder = slugPart((notes[index]!.externalId ?? '').split('/').slice(0, -1).join('-')).slice(0, 80) || 'racine'
    return withSuffix(slug, folder)
  })
  const candidateCounts = counts(candidates)
  const slugs = candidates.map((slug, index) => {
    if (candidateCounts.get(slug)! <= 1 && (!occupied.has(slug) || occupied.get(slug) === notes[index]!.confirmedEntityId)) return slug
    collisions[index] = true
    return withSuffix(slug, sha256(notes[index]!.externalId ?? notes[index]!.id).slice(0, 12))
  })
  const finalCounts = counts(slugs)
  const entries: PromotionEntry[] = notes.map((note, index) => {
    const classification = classifyNote(note.externalId ?? '', options.exceptions), slug = slugs[index]!
    const entry: PromotionEntry = { note, classification, slug, collision: collisions[index]!, action: 'CREATE', code: null, input: null }
    if (note.identityKey !== itemIdentity(note.externalId, note.contentHash)) throw new PromotionError('SELECTION_INCOMPATIBLE')
    if (note.confirmedEntityId) { entry.action = 'SKIP'; return entry }
    if (finalCounts.get(slug)! > 1 || (occupied.has(slug) && occupied.get(slug) !== note.confirmedEntityId)) {
      entry.collision = true; entry.action = 'COLLISION'; entry.code = 'SLUG_COLLISION'; return entry
    }
    const proposed = receiptProposal(note.receipt)
    let code: string | null = null
    if (!validNotePath(note.externalId)) code = 'NOTE_PATH_INVALID'
    else if (note.receipt.locator !== note.externalId) code = 'LOCATOR_MISMATCH'
    else if (note.receipt.contentType.toLowerCase() !== 'text/markdown') code = 'NOTE_FORMAT_UNSUPPORTED'
    else if (!proposed.content.trim()) code = 'NOTE_CONTENT_EMPTY'
    else if (note.receipt.metadata && typeof note.receipt.metadata === 'object' && !Array.isArray(note.receipt.metadata) &&
      'tags' in note.receipt.metadata && !proposed.tagsAvailable) code = 'NOTE_TAGS_INVALID'
    const parsed = ingestionProposalSchema.safeParse({ receiptId: note.receipt.id, expectedRevision: note.associationRevision,
      entity: { title: note.receipt.title ?? '', slug, kind: classification.kind, placeKind: classification.placeKind,
        summary: null, bodyMarkdown: proposed.content, aliases: [], tags: proposed.tags, visibility: 'GM' },
      evidence: { claimText: 'Création éditoriale depuis une note Obsidian après validation du plan par l’opérateur.',
        sourceExcerpt: null, locator: note.externalId },
    })
    if (!parsed.success || (parsed.success && parsed.data.entity.title !== note.receipt.title)) code ??= 'EDITORIAL_FIELDS_INVALID'
    if (code) { entry.action = 'REJECT'; entry.code = code }
    else if (parsed.success) entry.input = parsed.data
    return entry
  })
  const summary = { detected: entries.length, creatable: entries.filter(entry => entry.action === 'CREATE').length,
    skipped: entries.filter(entry => entry.action === 'SKIP').length, rejected: entries.filter(entry => entry.action === 'REJECT').length,
    collisions: entries.filter(entry => entry.action !== 'SKIP' && entry.collision).length,
    unresolvedCollisions: entries.filter(entry => entry.action === 'COLLISION').length,
    review: entries.filter(entry => entry.action === 'CREATE' && entry.classification.review).length }
  const fingerprint = sha256(canonicalPromotionJson({ format: 1, source: snapshot.source, actor: options.actor,
    expectedCount: options.expectedCount, allowProvisional: options.allowProvisional,
    entries: entries.map(entry => ({ note: promotionNoteFingerprint(entry.note), classification: entry.classification,
      slug: entry.slug, action: entry.action, code: entry.code, input: entry.input })) }))
  return { source: snapshot.source, entries, summary, fingerprint }
}
