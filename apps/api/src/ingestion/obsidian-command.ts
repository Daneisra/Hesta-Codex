import { ObsidianError } from './obsidian-files.js'
import { prepareObsidian, type ObsidianOptions } from './obsidian.js'

export const OBSIDIAN_USAGE = 'Usage : lore:obsidian:prepare --vault CHEMIN_ABSOLU --vault-id ID_STABLE --source-label LIBELLE [--subdir RELATIF] [--limit N] [--output REPERTOIRE_NEUF] [--dry-run]'
export function parseObsidianArgs(args: string[]): ObsidianOptions {
  const values = new Map<string, string>(), allowed = new Set(['--vault', '--vault-id', '--source-label', '--subdir', '--limit', '--output'])
  let dryRun = false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--dry-run' && !dryRun) { dryRun = true; continue }
    if (!allowed.has(arg) || values.has(arg) || !args[i + 1] || args[i + 1]!.startsWith('--')) throw new ObsidianError('INVALID_ARGUMENTS')
    values.set(arg, args[++i]!)
  }
  if (!values.get('--vault') || !values.get('--vault-id') || !values.get('--source-label')) throw new ObsidianError('INVALID_ARGUMENTS')
  const limit = values.get('--limit')
  if (limit !== undefined && (!/^[1-9]\d*$/.test(limit) || !Number.isSafeInteger(Number(limit)))) throw new ObsidianError('INVALID_LIMIT')
  return { vault: values.get('--vault')!, vaultId: values.get('--vault-id')!, sourceLabel: values.get('--source-label')!,
    subdir: values.get('--subdir'), limit: limit === undefined ? undefined : Number(limit), output: values.get('--output'), dryRun }
}

export async function runObsidianCommand(args: string[], write: (line: string) => void): Promise<number> {
  if (args.length === 1 && args[0] === '--help') { write(OBSIDIAN_USAGE); return 0 }
  try {
    const options = parseObsidianArgs(args), report = await prepareObsidian(options)
    write(options.dryRun ? 'Obsidian : inspection locale sans écriture.' : 'Obsidian : préparation locale du staging.')
    write(`Markdown détectés : ${report.markdownDetected} ; sélectionnés : ${report.selected} ; admissibles : ${report.admissible}.`)
    write(`Entrées ignorées : ${report.ignoredEntries} ; notes différées par limite : ${report.deferred}.`)
    write(`Erreurs : ${report.errors} ; avertissements : ${report.warnings}.`)
    write(`Lots estimés : ${report.estimatedBatches} ; format v1 validé : ${report.validatedBatches} ; lots écrits : ${report.writtenBatches}.`)
    write(`Wikilinks : ${Object.entries(report.wikilinks).map(([code, count]) => `${code}=${count}`).join(' ; ')}.`)
    write('Identité fondée sur le chemin : renommages et déplacements à résoudre manuellement.')
    for (const issue of report.issues) write(`Note ${issue.note} : ${issue.severity} ${issue.code}.`)
    if (report.omittedIssues) write(`Diagnostics supplémentaires non affichés : ${report.omittedIssues}.`)
    if (report.errors) write('Export refusé : corriger les erreurs puis relancer. Aucun lot écrit.')
    return report.errors ? 1 : 0
  } catch (error) {
    write(`Préparation refusée : ${error instanceof ObsidianError ? error.code : 'LOCAL_IO_ERROR'}.`)
    write(OBSIDIAN_USAGE)
    return 1
  }
}
