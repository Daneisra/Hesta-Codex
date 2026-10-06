import type { IngestionAssociationEntity, IngestionAssociationRequest, IngestionAssociationResetRequest,
  IngestionAssociationSearch, IngestionAssociationState } from '@hesta-codex/shared'
import { Prisma, type PrismaClient } from '../prisma-client/client.ts'
import { EditorialError } from '../admin/editorial.js'
import { itemIdentity } from './format.js'
import { matchingWhitespace, normalizeMatchName } from './matching-normalization.js'

export interface AssociationActor { discordId: string; label: string }
export interface IngestionAssociationService {
  read(itemId: string, receiptId?: string, candidateIds?: string[]): Promise<IngestionAssociationState>
  confirm(itemId: string, input: IngestionAssociationRequest, actor: AssociationActor): Promise<IngestionAssociationState>
  reject(itemId: string, input: IngestionAssociationRequest, actor: AssociationActor): Promise<IngestionAssociationState>
  reset(itemId: string, input: IngestionAssociationResetRequest): Promise<IngestionAssociationState>
  search(query: string): Promise<IngestionAssociationSearch>
}
const entitySelect = { id: true, slug: true, title: true, kind: true, placeKind: true, status: true, visibility: true } satisfies Prisma.EntitySelect
const associationSelect = { id: true, sourceId: true, identityKey: true, externalId: true, itemId: true, revision: true } satisfies Prisma.IngestionAssociationSelect
const decisionSelect = { origin: true, authorLabel: true, decidedAt: true, entity: { select: entitySelect } } satisfies Prisma.IngestionAssociationDecisionSelect
type Identity = { id: string; sourceId: string; identityKey: string; externalId: string | null; contentHash: string }
type Association = Prisma.IngestionAssociationGetPayload<{ select: typeof associationSelect }>
type Decision = Prisma.IngestionAssociationDecisionGetPayload<{ select: typeof decisionSelect }>
const conflict = () => new EditorialError(409, 'ASSOCIATION_MODIFIED', 'Conflit de modification, rechargez les associations.')
const notFound = () => new EditorialError(404, 'NOT_FOUND', 'Item, réception ou fiche introuvable.')
const incompatible = () => new EditorialError(409, 'INCOMPATIBLE_IDENTITY', 'Identité de staging incompatible. Association à vérifier.')
const identityWhere = (item: Identity) => ({ sourceId_identityKey: { sourceId: item.sourceId, identityKey: item.identityKey } })
const mapEntity = (row: IngestionAssociationEntity): IngestionAssociationEntity => ({ id: row.id, slug: row.slug,
  title: row.title, kind: row.kind, placeKind: row.placeKind, status: row.status, visibility: row.visibility })
const mapDecision = (row: Decision) => ({ entity: mapEntity(row.entity), origin: row.origin, authorLabel: row.authorLabel, decidedAt: row.decidedAt.toISOString() })

export { identity as readIngestionIdentity, association as readIngestionAssociation, mapEntity as associationEntity }
export function associationActorFields(actor: AssociationActor) {
  return { authorDiscordId: actor.discordId, authorLabel: Array.from(actor.label.replace(/[\r\n]/g, ' ')).slice(0, 200).join(''), decidedAt: new Date() }
}
export async function advanceIngestionAssociation(tx: Prisma.TransactionClient, item: Identity, row: Association | null, expectedRevision: number): Promise<Association> {
  if ((row?.revision ?? 0) !== expectedRevision) throw conflict()
  if (!row) return tx.ingestionAssociation.create({ data: { sourceId: item.sourceId, identityKey: item.identityKey,
    externalId: item.externalId, itemId: item.id, revision: 1 }, select: associationSelect })
  const changed = await tx.ingestionAssociation.updateMany({ where: { id: row.id, revision: expectedRevision }, data: { revision: { increment: 1 } } })
  if (changed.count !== 1) throw conflict()
  return { ...row, revision: row.revision + 1 }
}

async function identity(tx: Prisma.TransactionClient, itemId: string, receiptId?: string): Promise<Identity> {
  const receipt = await tx.ingestionReceipt.findFirst({ where: { itemId, ...(receiptId ? { id: receiptId } : {}) },
    orderBy: [{ ingestedAt: 'desc' }, { ordinal: 'desc' }, { id: 'desc' }],
    select: { item: { select: { id: true, sourceId: true, identityKey: true, externalId: true, contentHash: true } } } })
  if (!receipt) throw notFound()
  const item = receipt.item
  if (item.identityKey !== itemIdentity(item.externalId, item.contentHash)) throw incompatible()
  return item
}
async function association(tx: Prisma.TransactionClient, item: Identity): Promise<Association | null> {
  const row = await tx.ingestionAssociation.findUnique({ where: identityWhere(item), select: associationSelect })
  // No inheritance by locator, title, basename, score, or between different anonymous snapshots.
  if (row && (row.externalId !== item.externalId || (item.externalId === null && row.itemId !== item.id))) throw incompatible()
  return row
}
async function state(tx: Prisma.TransactionClient, item: Identity, row: Association | null, candidateIds: string[] = []): Promise<IngestionAssociationState> {
  const scope = item.externalId === null ? 'SNAPSHOT' : 'EXTERNAL_ID'
  if (!row) return { revision: 0, scope, confirmed: null, invalid: false, rejectedCandidateIds: [], rejectedCount: 0, recentRejections: [] }
  const [confirmed, rejections, rejectedCount, rejectedCandidates] = await Promise.all([
    tx.ingestionAssociationDecision.findFirst({ where: { associationId: row.id, decision: 'CONFIRMED' }, select: decisionSelect }),
    tx.ingestionAssociationDecision.findMany({ where: { associationId: row.id, decision: 'REJECTED' }, select: decisionSelect,
      orderBy: [{ decidedAt: 'desc' }, { id: 'desc' }], take: 20 }),
    tx.ingestionAssociationDecision.count({ where: { associationId: row.id, decision: 'REJECTED' } }),
    candidateIds.length ? tx.ingestionAssociationDecision.findMany({ where: { associationId: row.id, decision: 'REJECTED', entityId: { in: candidateIds } },
      select: { entityId: true }, take: 10 }) : Promise.resolve([]),
  ])
  return { revision: row.revision, scope, confirmed: confirmed ? mapDecision(confirmed) : null,
    invalid: confirmed?.entity.status === 'ARCHIVED', rejectedCandidateIds: rejectedCandidates.map(value => value.entityId),
    rejectedCount, recentRejections: rejections.map(mapDecision) }
}

export function createPrismaIngestionAssociationService(prisma: PrismaClient): IngestionAssociationService {
  const read: IngestionAssociationService['read'] = (itemId, receiptId, candidateIds = []) => prisma.$transaction(async tx => {
    const item = await identity(tx, itemId, receiptId)
    return state(tx, item, await association(tx, item), candidateIds)
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })

  const decide = async (itemId: string, input: IngestionAssociationRequest | IngestionAssociationResetRequest,
    action: 'CONFIRMED' | 'REJECTED' | 'RESET', actor?: AssociationActor): Promise<IngestionAssociationState> => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await prisma.$transaction(async tx => {
          const item = await identity(tx, itemId, input.receiptId)
          let row = await association(tx, item)
          const current = row ? await tx.ingestionAssociationDecision.findFirst({ where: { associationId: row.id, decision: 'CONFIRMED' }, select: { entityId: true } }) : null
          const entityId = 'entityId' in input ? input.entityId : null
          if (action !== 'RESET') {
            const entity = await tx.entity.findUnique({ where: { id: entityId! }, select: { id: true, status: true } })
            if (!entity) throw notFound()
            if (entity.status === 'ARCHIVED') throw new EditorialError(409, 'INVALID_STATUS', 'Une fiche archivée ne peut pas recevoir de nouvelle décision.')
          }
          const existing = row && entityId ? await tx.ingestionAssociationDecision.findUnique({ where: { associationId_entityId: { associationId: row.id, entityId } }, select: { decision: true } }) : null
          // Identical repeats preserve the original author/date and do not increment the revision.
          if ((action === 'CONFIRMED' && current?.entityId === entityId) || (action === 'REJECTED' && existing?.decision === 'REJECTED') ||
            (action === 'RESET' && !current)) return state(tx, item, row, entityId ? [entityId] : [])
          if ((row?.revision ?? 0) !== input.expectedRevision) throw conflict()
          if (action === 'REJECTED' && current?.entityId === entityId) throw new EditorialError(409, 'ALREADY_CONFIRMED', 'Retirez ou changez d’abord cette association confirmée.')
          row = await advanceIngestionAssociation(tx, item, row, input.expectedRevision)
          if (action === 'RESET' || action === 'CONFIRMED') {
            await tx.ingestionAssociationDecision.deleteMany({ where: { associationId: row.id, decision: 'CONFIRMED' } })
          }
          if (action !== 'RESET' && 'entityId' in input && actor) {
            const data = { decision: action, origin: input.origin, ...associationActorFields(actor) }
            await tx.ingestionAssociationDecision.upsert({ where: { associationId_entityId: { associationId: row.id, entityId: input.entityId } },
              create: { ...data, associationId: row.id, entityId: input.entityId }, update: data })
          }
          return state(tx, item, row, entityId ? [entityId] : [])
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !['P2002', 'P2034'].includes(error.code)) throw error
        // Start a fresh transaction, so same-target races can resolve as an idempotent repeat.
        // Different targets keep their original expectedRevision and return 409; no last-write-wins retry.
        if (attempt >= 1) throw conflict()
      }
    }
  }
  return {
    read,
    confirm: (id, input, actor) => decide(id, input, 'CONFIRMED', actor),
    reject: (id, input, actor) => decide(id, input, 'REJECTED', actor),
    reset: (id, input) => decide(id, input, 'RESET'),
    async search(query) {
      const normalized = normalizeMatchName(query)
      const name = (column: Prisma.Sql) => Prisma.sql`btrim(regexp_replace(lower(normalize(${column}, NFC)), ${matchingWhitespace}, ' ', 'g'))`
      const rows = await prisma.$queryRaw<IngestionAssociationEntity[]>(Prisma.sql`SELECT e.id, e.slug, e.title, e.kind, e."placeKind", e.status, e.visibility
        FROM "Entity" e WHERE e.status <> 'ARCHIVED' AND (strpos(${name(Prisma.sql`e.title`)}, ${normalized}) > 0
          OR strpos(e.slug, ${normalized}) > 0 OR EXISTS (SELECT 1 FROM unnest(e.aliases) a(name) WHERE strpos(${name(Prisma.sql`a.name`)}, ${normalized}) > 0))
        ORDER BY lower(normalize(e.title, NFC)) COLLATE "C", e.id LIMIT 21`)
      return { items: rows.slice(0, 20).map(mapEntity), truncated: rows.length > 20, limit: 20 }
    },
  }
}
