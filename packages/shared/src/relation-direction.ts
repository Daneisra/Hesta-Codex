import type { RelationTypeItem } from './index.js'

/** Normalize the stored tuple for both creation and correction, preserving the chosen reading. */
export function canonicalRelationEndpoints(type: Pick<RelationTypeItem, 'id' | 'code' | 'inverseCode' | 'symmetric'>,
  code: string, from: string, to: string) {
  let fromEntityId = from, toEntityId = to
  if (!type.symmetric && code === type.inverseCode) [fromEntityId, toEntityId] = [toEntityId, fromEntityId]
  if (type.symmetric && fromEntityId > toEntityId) [fromEntityId, toEntityId] = [toEntityId, fromEntityId]
  return { fromEntityId, toEntityId, relationTypeId: type.id }
}
