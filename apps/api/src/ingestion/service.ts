import { contentHash, itemIdentity, validateIngestionDocument, type IngestionDocument, type IngestionInput, type IngestionIssue, type IngestionSource } from './format.js'
import type { IngestionDatabase, IngestionReader, IngestionWriter, Outcome, SnapshotRef, SourceRef } from './repository.js'

export interface IngestionSummary { received: number; sourcesNew: number; sourcesExisting: number; new: number; unchanged: number; modified: number; ignored: number; errors: number; warnings: number }
export interface IngestionReport { summary: IngestionSummary; issues: IngestionIssue[]; warnings: IngestionIssue[]; batchId: string | null; applied: boolean }
type PlannedSource = { key: string; input: IngestionSource; ref: SourceRef | null }
type PlannedItem = { input: IngestionInput; source: PlannedSource; identityKey: string; hash: string; version: number;
  outcome: Outcome; snapshot: SnapshotRef | null; priorOrdinal: number | null; rawVariant: string | null }

export function invalidIngestionReport(issues: IngestionIssue[], received = 0): IngestionReport {
  return { summary: { received, sourcesNew: 0, sourcesExisting: 0, new: 0, unchanged: 0, modified: 0, ignored: 0, errors: issues.length, warnings: 0 },
    issues, warnings: [], batchId: null, applied: false }
}

async function plan(document: IngestionDocument, reader: IngestionReader) {
  const report = invalidIngestionReport([], document.items.length)
  const sourceInputs = new Map<string, PlannedSource>(), sources = new Map<string, PlannedSource>()
  const items: PlannedItem[] = []
  const current = new Map<string, { snapshot: SnapshotRef | null; ordinal: number | null; hash: string; version: number; content: string }>()
  const seen = new Map<string, string>()
  for (const [ordinal, input] of document.items.entries()) {
    const sourceInputKey = JSON.stringify('id' in input.source ? ['id', input.source.id] : [input.source.kind, input.source.externalId])
    let source = sourceInputs.get(sourceInputKey)
    if (!source) {
      const ref = await reader.findSource(input.source)
      if (!ref && 'id' in input.source) { report.issues.push({ path: `items[${ordinal}].source.id`, message: 'Source existante introuvable' }); continue }
      const key = ref ? `id:${ref.id}` : sourceInputKey
      source = sources.get(key) ?? { key, input: input.source, ref }
      sourceInputs.set(sourceInputKey, source); sources.set(key, source)
      if (ref) report.summary.sourcesExisting = [...sources.values()].filter(source => source.ref).length
      else report.summary.sourcesNew = [...sources.values()].filter(source => !source.ref).length
    }
    if (!('id' in input.source) && ((source.ref && (source.ref.label !== input.source.label || source.ref.url !== input.source.url || source.ref.authorLabel !== input.source.authorLabel)) ||
      (!source.ref && !('id' in source.input) && JSON.stringify(source.input) !== JSON.stringify(input.source)))) {
      report.warnings.push({ path: `items[${ordinal}].source`, message: 'Source réutilisée sans modifier ses descriptions ; la première description du lot prévaut' })
    }
    const hash = contentHash(input.content), identityKey = itemIdentity(input.externalId, hash)
    const key = JSON.stringify([source.key, identityKey])
    const earlierHash = seen.get(key)
    if (earlierHash && earlierHash !== hash) {
      report.issues.push({ path: `items[${ordinal}].externalId`, message: 'Deux contenus différents pour la même identité dans ce lot ; séparer les observations en lots ordonnés' })
      continue
    }
    seen.set(key, hash)
    let previous = current.get(key)
    if (!previous) {
      const snapshot = source.ref ? await reader.latest(source.ref.id, identityKey) : null
      if (snapshot) previous = { snapshot, ordinal: null, hash: snapshot.contentHash, version: snapshot.version, content: snapshot.content }
    }
    const unchanged = previous?.hash === hash
    const outcome: Outcome = unchanged ? 'UNCHANGED' : previous ? 'MODIFIED' : 'NEW'
    const version = unchanged ? previous!.version : (previous?.version ?? 0) + 1
    const rawVariant = unchanged && previous!.content !== input.content ? input.content : null
    if (rawVariant !== null) report.warnings.push({ path: `items[${ordinal}].content`, message: 'Contenu normalisé identique ; variante brute exacte conservée dans la réception' })
    items.push({ input, source, identityKey, hash, version, outcome,
      snapshot: unchanged ? previous!.snapshot : null, priorOrdinal: unchanged ? previous!.ordinal : null, rawVariant })
    report.summary[outcome === 'NEW' ? 'new' : outcome === 'MODIFIED' ? 'modified' : 'unchanged']++
    if (!unchanged) current.set(key, { snapshot: null, ordinal: items.length - 1, hash, version, content: input.content })
    else if (previous) current.set(key, previous)
  }
  report.summary.errors = report.issues.length
  report.summary.warnings = report.warnings.length
  return { report, sources: [...sources.values()], items }
}

async function apply(document: IngestionDocument, tx: IngestionWriter): Promise<IngestionReport> {
  const planned = await plan(document, tx)
  if (planned.report.issues.length) return planned.report
  const sourceIds = new Map<string, string>()
  for (const source of planned.sources) {
    if (!source.ref && 'id' in source.input) throw new Error('Unresolved Source')
    sourceIds.set(source.key, source.ref?.id ?? await tx.createSource(source.input as Exclude<IngestionSource, { id: string }>))
  }
  const batchId = await tx.createBatch(document.batch.label, planned.report.summary)
  const itemIds: string[] = []
  for (const [ordinal, item] of planned.items.entries()) {
    const id = item.snapshot?.id ?? (item.priorOrdinal !== null ? itemIds[item.priorOrdinal] :
      await tx.createItem(batchId, sourceIds.get(item.source.key)!, item.identityKey, item.version, item.hash, item.input.content, item.input.externalId))
    if (!id) throw new Error('Unresolved snapshot')
    itemIds.push(id)
    await tx.createReceipt(batchId, id, ordinal, item.outcome, item.input, item.rawVariant)
  }
  return { ...planned.report, applied: true, batchId }
}

export async function ingestDocument(document: IngestionDocument, database: IngestionDatabase, dryRun: boolean): Promise<IngestionReport> {
  // The service is also safe when called outside the CLI; no writes before full validation.
  const parsed = validateIngestionDocument(document)
  if (!parsed.success) return invalidIngestionReport(parsed.issues)
  if (dryRun) return (await plan(parsed.document, database.reader)).report
  return database.transaction(tx => apply(parsed.document, tx))
}
