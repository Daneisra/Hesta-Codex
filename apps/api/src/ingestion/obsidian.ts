import { link, lstat, mkdir, open, rmdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { MAX_INGEST_BYTES, MAX_INGEST_ITEMS, parseIngestionText, sha256, validateIngestionDocument, type IngestionInput } from './format.js'
import { localDirectory, ObsidianError, outputDestination, readNote, scanVault, type VaultFile } from './obsidian-files.js'
import { extractMarkdown, linkIndex, type LinkIndex, type WikiLink } from './obsidian-markdown.js'

export interface ObsidianOptions {
  vault: string; vaultId: string; sourceLabel: string; subdir?: string; limit?: number; output?: string; dryRun: boolean
}
export interface ObsidianReport {
  markdownDetected: number; selected: number; admissible: number; ignoredEntries: number; deferred: number
  errors: number; warnings: number; validatedBatches: number; estimatedBatches: number; writtenBatches: number
  wikilinks: Record<WikiLink['status'], number>
  issues: Array<{ note: number; severity: 'error' | 'warning'; code: string }>; omittedIssues: number
}
interface PlannedFile { file: VaultFile; digest: string }
interface PlannedBatch { files: PlannedFile[]; digest: string }
const label = (index: number) => `Obsidian — lot ${String(index + 1).padStart(6, '0')}`
const envelope = (items: IngestionInput[], index: number) => ({ version: 1, batch: { label: label(index) }, items })
function batchText(items: IngestionInput[], index: number) {
  const text = JSON.stringify(envelope(items, index)) + '\n'
  if (!parseIngestionText(text).success) throw new ObsidianError('BATCH_FORMAT_INVALID')
  return text
}
function validateOptions(options: ObsidianOptions) {
  if (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit < 1)) throw new ObsidianError('INVALID_LIMIT')
  if (!options.dryRun && !options.output) throw new ObsidianError('OUTPUT_REQUIRED')
  const source = { kind: 'OBSIDIAN', externalId: options.vaultId, label: options.sourceLabel }
  const parsed = validateIngestionDocument(envelope([{ source, content: 'Validation' } as IngestionInput], 0))
  if (!parsed.success) throw new ObsidianError('SOURCE_DESCRIPTOR_INVALID')
  return parsed.document.items[0]!.source
}
async function noteItem(vault: string, file: VaultFile, source: IngestionInput['source'], index: LinkIndex) {
  const { content, observedAt } = await readNote(vault, file)
  const extracted = extractMarkdown(content, file.path, index)
  const parsed = validateIngestionDocument(envelope([{
    source, externalId: file.path, locator: file.path, content, contentType: 'text/markdown', observedAt,
    title: extracted.title, metadata: extracted.metadata,
  }], 0))
  if (!parsed.success) {
    const field = parsed.issues[0]?.path.split('.').at(-1)
    throw new ObsidianError(['title', 'externalId', 'locator', 'content', 'metadata', 'observedAt'].includes(field ?? '')
      ? `NOTE_${field!.toUpperCase()}_INVALID` : 'NOTE_FORMAT_INVALID')
  }
  return { item: parsed.document.items[0]!, extracted }
}

// Two bounded passes: retain file/digest plans, never all vault bodies in memory.
export async function prepareObsidian(options: ObsidianOptions): Promise<ObsidianReport> {
  const source = validateOptions(options), vault = await localDirectory(options.vault)
  const destination = options.output ? await outputDestination(options.output, vault) : null
  const scanned = await scanVault(vault, options.subdir), selected = scanned.files.slice(0, options.limit)
  const index = linkIndex(scanned.files.map(file => file.path))
  const report: ObsidianReport = {
    markdownDetected: scanned.files.length, selected: selected.length, admissible: 0, ignoredEntries: scanned.ignored,
    deferred: scanned.files.length - selected.length, errors: 0, warnings: 0, validatedBatches: 0, estimatedBatches: 0,
    writtenBatches: 0, wikilinks: { FOUND: 0, MISSING: 0, AMBIGUOUS: 0, UNSUPPORTED: 0, OUT_OF_SCOPE: 0 }, issues: [], omittedIssues: 0,
  }
  const issue = (note: number, severity: 'error' | 'warning', code: string) => {
    report[severity === 'error' ? 'errors' : 'warnings']++
    if (report.issues.length < 100) report.issues.push({ note, severity, code })
    else report.omittedIssues++
  }
  const batches: PlannedBatch[] = []
  let items: IngestionInput[] = [], files: PlannedFile[] = [], itemBytes = 0
  const finish = () => {
    if (!items.length) return
    const text = batchText(items, batches.length)
    batches.push({ files, digest: sha256(text) }); report.validatedBatches++
    items = []; files = []; itemBytes = 0
  }
  for (const [ordinal, file] of selected.entries()) {
    try {
      const { item, extracted } = await noteItem(vault, file, source, index)
      const serialized = JSON.stringify(item), bytes = Buffer.byteLength(serialized, 'utf8')
      // Count actual escaped JSON bytes, including commas, defaults and the final newline.
      const headerBytes = Buffer.byteLength(JSON.stringify(envelope([], batches.length)), 'utf8') + 1
      if (items.length && (items.length >= MAX_INGEST_ITEMS || headerBytes + itemBytes + bytes + items.length > MAX_INGEST_BYTES)) finish()
      items.push(item); files.push({ file, digest: sha256(serialized) }); itemBytes += bytes
      report.admissible++
      for (const link of extracted.wikilinks) report.wikilinks[link.status]++
      for (const warning of extracted.warnings) issue(ordinal + 1, 'warning', warning)
    } catch (error) { issue(ordinal + 1, 'error', error instanceof ObsidianError ? error.code : 'NOTE_READ_FAILED') }
  }
  finish(); report.estimatedBatches = batches.length
  if (options.dryRun || report.errors || !batches.length) return report
  if (!destination) throw new ObsidianError('OUTPUT_REQUIRED')
  await outputDestination(destination, vault)
  await mkdir(destination, { mode: 0o700 }) // Fresh directory only; never overwrite a previous export.
  const owned = await lstat(destination), written: string[] = []
  try {
    for (const [ordinal, batch] of batches.entries()) {
      const values: IngestionInput[] = []
      for (const planned of batch.files) {
        const { item } = await noteItem(vault, planned.file, source, index)
        if (sha256(JSON.stringify(item)) !== planned.digest) throw new ObsidianError('VAULT_CHANGED_DURING_EXPORT')
        values.push(item)
      }
      const text = batchText(values, ordinal)
      if (sha256(text) !== batch.digest) throw new ObsidianError('VAULT_CHANGED_DURING_EXPORT')
      const safe = await localDirectory(destination), current = await lstat(destination)
      if (safe !== destination || current.ino !== owned.ino || current.dev !== owned.dev) throw new ObsidianError('OUTPUT_CHANGED')
      const path = join(destination, `obsidian-${String(ordinal + 1).padStart(6, '0')}.json`)
      const temporary = `${path}.part`, handle = await open(temporary, 'wx', 0o600)
      written.push(temporary)
      try { await handle.writeFile(text, 'utf8'); await handle.sync() } finally { await handle.close() }
      // Publish only a fully written file, atomically and without replacing an existing name.
      await link(temporary, path); written.push(path)
      await unlink(temporary); written.splice(written.indexOf(temporary), 1)
    }
    report.writtenBatches = batches.length
    return report
  } catch (error) {
    // Remove only our own files, after verifying the directory was not substituted.
    try {
      const safe = await localDirectory(destination), current = await lstat(destination)
      if (safe !== destination || current.ino !== owned.ino || current.dev !== owned.dev) throw new ObsidianError('OUTPUT_CHANGED')
      for (const path of written) await unlink(path)
      await rmdir(destination)
    } catch { throw new ObsidianError('EXPORT_FAILED_CLEANUP_REQUIRED') }
    throw error instanceof ObsidianError ? error : new ObsidianError('EXPORT_WRITE_FAILED')
  }
}
