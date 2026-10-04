import { InvalidEncodingError, MissingDatabaseUrlError } from '../import/command.js'
import { MAX_INGEST_BYTES, parseIngestionText } from './format.js'
import type { IngestionDatabase } from './repository.js'
import { ingestDocument, invalidIngestionReport, type IngestionReport } from './service.js'

export class IngestionFileTooLargeError extends Error {}
export interface IngestionCommandDependencies {
  readText(path: string): Promise<string>
  openDatabase(): Promise<{ database: IngestionDatabase; close(): Promise<void> }>
  write(line: string): void
}
function printReport(report: IngestionReport, write: (line: string) => void) {
  const summary = report.summary
  write(`Sources nouvelles : ${summary.sourcesNew} ; existantes : ${summary.sourcesExisting}`)
  write(`Items reçus : ${summary.received} ; nouveaux : ${summary.new} ; inchangés : ${summary.unchanged} ; modifiés : ${summary.modified} ; ignorés : ${summary.ignored}`)
  write(`Erreurs : ${summary.errors} ; avertissements : ${summary.warnings}`)
  for (const issue of report.issues) write(`ERREUR ${issue.path} : ${issue.message}`)
  for (const warning of report.warnings) write(`AVERTISSEMENT ${warning.path} : ${warning.message}`)
  if (report.applied) write(`Batch créé : ${report.batchId}. Staging uniquement, aucune publication.`)
  else if (!summary.errors) write('Dry-run terminé : aucune écriture effectuée.')
}
export async function runIngestionCommand(args: string[], dependencies: IngestionCommandDependencies): Promise<number> {
  const dry = args.filter(arg => arg === '--dry-run'), paths = args.filter(arg => arg !== '--dry-run')
  if (dry.length > 1 || paths.length !== 1 || paths[0]?.startsWith('--')) {
    dependencies.write('Usage : npm run lore:ingest -- chemin/vers/fichier.json [--dry-run]'); return 1
  }
  let input: string
  try { input = await dependencies.readText(paths[0]); if (Buffer.byteLength(input, 'utf8') > MAX_INGEST_BYTES) throw new IngestionFileTooLargeError() }
  catch (error) {
    dependencies.write(error instanceof IngestionFileTooLargeError ? 'Fichier trop volumineux (maximum 5 Mio).'
      : error instanceof InvalidEncodingError ? 'Encodage invalide : UTF-8 attendu.' : 'Fichier introuvable ou illisible.'); return 1
  }
  const parsed = parseIngestionText(input)
  if (!parsed.success) { printReport(invalidIngestionReport(parsed.issues), dependencies.write); return 1 }
  let connection: Awaited<ReturnType<IngestionCommandDependencies['openDatabase']>> | undefined
  let report: IngestionReport
  let closeFailed = false
  try {
    connection = await dependencies.openDatabase()
    report = await ingestDocument(parsed.document, connection.database, dry.length === 1)
  } catch (error) {
    dependencies.write(error instanceof MissingDatabaseUrlError ? 'Connexion locale non configurée.'
      : 'Ingestion interrompue : vérification ou transaction impossible. Aucune écriture partielle conservée.'); return 1
  } finally {
    if (connection) try { await connection.close() } catch { closeFailed = true; dependencies.write('Avertissement : fermeture de connexion non confirmée.') }
  }
  printReport(report, dependencies.write)
  return report.summary.errors === 0 && !closeFailed ? 0 : 1
}
