import { importDocument } from './service.js'
import type { ImportDatabase } from './repository.js'
import { invalidReport, type ImportReport } from './resolve.js'
import { parseImportText } from './validation.js'

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024

export class ImportFileTooLargeError extends Error {}
export class InvalidEncodingError extends Error {}
export class MissingDatabaseUrlError extends Error {}

export interface ImportCommandDependencies {
  readText(path: string): Promise<string>
  openDatabase(): Promise<{ database: ImportDatabase; close(): Promise<void> }>
  write(line: string): void
}

function printReport(report: ImportReport, write: (line: string) => void): void {
  const { summary } = report
  write(`Source : ${summary.source}${report.sourceAction ? ` (${report.sourceAction === 'new' ? 'nouvelle' : 'réutilisée'})` : ''}`)
  write(`Fiches nouvelles : ${summary.entitiesNew}`)
  write(`Fiches existantes : ${summary.entitiesExisting}`)
  write(`Relations nouvelles : ${summary.relationsNew}`)
  write(`Relations existantes : ${summary.relationsExisting}`)
  write(`Erreurs : ${summary.errors}`)
  write(`Avertissements : ${summary.warnings}`)
  for (const issue of report.issues) write(`ERREUR ${issue.path} : ${issue.message}`)
  for (const warning of report.warnings) write(`AVERTISSEMENT ${warning.path} : ${warning.message}`)
  if (report.applied) write('Import appliqué dans une seule transaction.')
  else if (summary.errors === 0) write('Dry-run terminé : aucune écriture effectuée.')
}

export async function runImportCommand(args: string[], dependencies: ImportCommandDependencies): Promise<number> {
  const dryRunCount = args.filter((arg) => arg === '--dry-run').length
  const paths = args.filter((arg) => arg !== '--dry-run')
  if (dryRunCount > 1 || paths.length !== 1 || paths[0]?.startsWith('--')) {
    dependencies.write('Usage : npm run lore:import -- chemin/vers/fichier.json [--dry-run]')
    return 1
  }

  let text: string
  try {
    text = await dependencies.readText(paths[0])
    if (Buffer.byteLength(text, 'utf8') > MAX_IMPORT_BYTES) throw new ImportFileTooLargeError()
  } catch (error) {
    dependencies.write(error instanceof ImportFileTooLargeError
      ? 'Fichier trop volumineux (maximum 5 Mio).'
      : error instanceof InvalidEncodingError
        ? 'Encodage du fichier invalide : UTF-8 attendu.'
      : 'Fichier introuvable ou illisible.')
    return 1
  }

  const parsed = parseImportText(text)
  if (!parsed.success) {
    printReport(invalidReport(parsed.issues), dependencies.write)
    return 1
  }

  let connection: Awaited<ReturnType<ImportCommandDependencies['openDatabase']>> | undefined
  let report: ImportReport
  let closeFailed = false
  try {
    connection = await dependencies.openDatabase()
    report = await importDocument(parsed.document, connection.database, dryRunCount === 1)
  } catch (error) {
    dependencies.write(error instanceof MissingDatabaseUrlError
      ? 'DATABASE_URL absente : configurer la connexion dans le .env local ou dans l’environnement.'
      : 'Import interrompu : vérification ou transaction impossible. Aucune écriture partielle conservée.')
    return 1
  } finally {
    if (connection) {
      try {
        await connection.close()
      } catch {
        closeFailed = true
        dependencies.write('Avertissement : fermeture de la connexion à la base non confirmée.')
      }
    }
  }

  printReport(report, dependencies.write)
  return report.summary.errors === 0 && !closeFailed ? 0 : 1
}
