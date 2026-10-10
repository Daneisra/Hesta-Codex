import type { AssociationActor } from './association.js'
import { actorSchema, buildPromotionPlan, MAX_PROMOTION_NOTES, parseClassificationExceptions, PromotionError,
  validateSourceExternalId, type PromotionRepository } from './promotion.js'

export const PROMOTION_USAGE = 'Usage : lore:staging:promote --source-external-id ID --author-discord-id ID --author-label LIBELLE --expected-count N (--dry-run | --apply --confirm-plan SHA256) [--classifications FICHIER_JSON] [--allow-provisional] [--details]'
export interface PromotionOptions {
  sourceExternalId: string; actor: AssociationActor; expectedCount: number; apply: boolean; confirmPlan?: string
  classifications?: string; allowProvisional: boolean; details: boolean
}
export function parsePromotionArgs(args: string[]): PromotionOptions {
  const values = new Map<string, string>(), flags = new Set<string>()
  const valued = new Set(['--source-external-id', '--author-discord-id', '--author-label', '--expected-count', '--confirm-plan', '--classifications'])
  const boolean = new Set(['--dry-run', '--apply', '--allow-provisional', '--details'])
  for (let at = 0; at < args.length; at++) {
    const arg = args[at]!
    if (boolean.has(arg) && !flags.has(arg)) { flags.add(arg); continue }
    if (!valued.has(arg) || values.has(arg) || !args[at + 1] || args[at + 1]!.startsWith('--')) throw new PromotionError('ARGUMENTS_INVALID')
    values.set(arg, args[++at]!)
  }
  const sourceExternalId = values.get('--source-external-id'), count = values.get('--expected-count')
  const actor = actorSchema.safeParse({ discordId: values.get('--author-discord-id'), label: values.get('--author-label') })
  if (!sourceExternalId || !count || !/^(?:0|[1-9]\d*)$/.test(count) || Number(count) > MAX_PROMOTION_NOTES || !actor.success ||
    flags.has('--apply') === flags.has('--dry-run')) throw new PromotionError('ARGUMENTS_INVALID')
  validateSourceExternalId(sourceExternalId)
  const apply = flags.has('--apply'), confirmPlan = values.get('--confirm-plan')
  if ((apply && (!confirmPlan || !/^[a-f0-9]{64}$/.test(confirmPlan))) || (!apply && confirmPlan !== undefined)) throw new PromotionError('CONFIRMATION_REQUIRED')
  return { sourceExternalId, actor: actor.data, expectedCount: Number(count), apply, confirmPlan,
    classifications: values.get('--classifications'), allowProvisional: flags.has('--allow-provisional'), details: flags.has('--details') }
}
export interface PromotionCommandDependencies {
  readClassifications(path: string): Promise<string>
  openDatabase(): Promise<{ repository: PromotionRepository; close(): Promise<void> }>
  write(line: string): void
}
export async function runPromotionCommand(args: string[], dependencies: PromotionCommandDependencies): Promise<number> {
  const write = dependencies.write
  if (args.length === 1 && args[0] === '--help') { write(PROMOTION_USAGE); return 0 }
  let connection: Awaited<ReturnType<PromotionCommandDependencies['openDatabase']>> | undefined
  let result = 1, created = 0, concurrentSkipped = 0
  try {
    const options = parsePromotionArgs(args)
    const exceptions = options.classifications ? parseClassificationExceptions(await dependencies.readClassifications(options.classifications)) : []
    connection = await dependencies.openDatabase()
    const plan = buildPromotionPlan(await connection.repository.snapshot(options.sourceExternalId), { actor: options.actor,
      expectedCount: options.expectedCount, allowProvisional: options.allowProvisional, exceptions })
    const summary = plan.summary
    write(`Notes détectées : ${summary.detected} ; fiches créables : ${summary.creatable} ; fiches ignorées (associées) : ${summary.skipped}.`)
    write(`Collisions détectées : ${summary.collisions} ; non résolues : ${summary.unresolvedCollisions} ; rejets : ${summary.rejected}.`)
    write(`Classifications provisoires OTHER à revoir (fiches créables) : ${summary.review}.`)
    write(`Empreinte du plan : ${plan.fingerprint}`)
    for (const [index, entry] of plan.entries.entries()) {
      if (entry.code) write(`Note ${index + 1} : ${entry.code}.`)
      if (options.details) write(JSON.stringify({ note: index + 1, externalId: entry.note.externalId, slug: entry.slug,
        kind: entry.classification.kind, placeKind: entry.classification.placeKind, review: entry.classification.review, action: entry.action }))
    }
    if (summary.detected !== options.expectedCount) throw new PromotionError('EXPECTED_COUNT_MISMATCH')
    if (summary.rejected || summary.unresolvedCollisions) throw new PromotionError('PLAN_BLOCKED')
    if (!options.apply) { write('Dry-run terminé : aucune écriture.'); result = 0 }
    else {
      if (plan.fingerprint !== options.confirmPlan) throw new PromotionError('PLAN_CHANGED')
      if (summary.review && !options.allowProvisional) throw new PromotionError('CLASSIFICATION_REVIEW_REQUIRED')
      for (const [index, entry] of plan.entries.entries()) {
        if (entry.action !== 'CREATE' || !entry.input) continue
        try {
          const outcome = await connection.repository.create(plan.source, entry.note, entry.input, options.actor)
          if (outcome === 'created') created++; else concurrentSkipped++
        } catch {
          write(`Note ${index + 1} : création interrompue (transaction refusée ou état modifié).`)
          throw new PromotionError('APPLY_INTERRUPTED')
        }
      }
      write(`Créées : ${created} ; ignorées : ${summary.skipped + concurrentSkipped}. Fiches PROPOSED/GM, aucune publication.`)
      result = 0
    }
  } catch (error) {
    write(`Promotion refusée : ${error instanceof PromotionError ? error.code : 'LOCAL_VALIDATION_OR_DATABASE_FAILED'}.`)
    if (created || concurrentSkipped) write(`Créées avant interruption : ${created} ; confirmations concurrentes ignorées : ${concurrentSkipped}.`)
    write('Après interruption, refaire le dry-run et approuver sa nouvelle empreinte ; les confirmations existantes seront ignorées.')
  } finally {
    if (connection) try { await connection.close() }
    catch { result = 1; write('Fermeture de connexion non confirmée : vérifier le résultat par un nouveau dry-run.') }
  }
  return result
}
