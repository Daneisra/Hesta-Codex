import type { AdminEntityDetail, AdminEntityListItem, AdminRelation, AdminSource, RelationTypeItem } from '@hesta-codex/shared'

/** This context stays in React memory, never in a URL, history state or browser storage. */
export interface ReferenceRelationSeed {
  fromId: string; toId: string; toSlug: string; returnSlug: string; returnTitle: string
}

export function referenceProvenance(entity: AdminEntityDetail, targetId: string): {
  source: AdminSource | null; locator: string; excerpt: string
} {
  const reference = entity.obsidianReferences?.updatedAt === entity.updatedAt
    ? entity.obsidianReferences.outgoing.find(item => item.id === targetId) : undefined
  const origin = reference?.origin
  const source = origin ? entity.evidence.find(proof => proof.source.id === origin.sourceId && proof.source.kind === 'OBSIDIAN')?.source : null
  // The existing Evidence validator trims locators. Never silently change a path that needs those spaces.
  const locator = origin && origin.path.length <= 250 && origin.path === origin.path.trim() ? origin.path : ''
  return { source: source ?? null, locator, excerpt: origin?.excerpt ?? '' }
}

export function existingRelation(entity: AdminEntityDetail, target: AdminEntityListItem | null,
  type: RelationTypeItem | undefined, code: string, reversed: boolean): AdminRelation | undefined {
  if (!target || !type) return undefined
  let from = reversed ? target.id : entity.id, to = reversed ? entity.id : target.id
  if (!type.symmetric && code === type.inverseCode) [from, to] = [to, from]
  return [...entity.outgoingRelations.map(relation => ({ relation, from: entity.id, to: relation.entity.id })),
    ...entity.incomingRelations.map(relation => ({ relation, from: relation.entity.id, to: entity.id }))]
    .find(item => item.relation.relationType.code === type.code &&
      (item.from === from && item.to === to || type.symmetric && item.from === to && item.to === from))?.relation
}
