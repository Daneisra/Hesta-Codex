import type { EntityKind, EditorialStatus, Visibility, RelationTypeItem } from './index.js'
import type { ObsidianReferences } from './obsidian.js'

export type QualificationState = 'PENDING' | 'QUALIFIED' | 'IGNORED'
export interface QualificationEntity {
  id: string; slug: string; title: string; kind: EntityKind; status: EditorialStatus; visibility: Visibility
}
export interface ReferenceQualification {
  state: QualificationState; fingerprint: string; decisionRevision: string | null; stale: boolean
  ignoredAt: string | null; ignoredBy: string | null
}
export interface QualificationRow extends ReferenceQualification {
  id: string; from: QualificationEntity; to: QualificationEntity; occurrences: number
  origins: Array<{ sourceId: string; sourceLabel: string; path: string }>
  relations: Array<{ id: string; fromEntityId: string; toEntityId: string; status: EditorialStatus;
    visibility: Visibility; relationType: RelationTypeItem }>
}
export interface QualificationFilters {
  q?: string; state?: QualificationState; kind?: EntityKind; sourceId?: string; entityId?: string
  direction?: 'all' | 'incoming' | 'outgoing'; sort?: 'mentions' | 'name' | 'state'; page: number
  view?: 'references' | 'diagnostics'
}
export interface QualificationResponse {
  items: QualificationRow[]; total: number; page: number; pageSize: number
  counts: Record<QualificationState, number> & { total: number }
  sources: Array<{ id: string; label: string }>; entities: QualificationEntity[]
  diagnosticCounts: Record<string, number>
  diagnostics: Array<ObsidianReferences['diagnostics'][number] & { entity: QualificationEntity }>
  diagnosticTotal: number
}
export interface ReferenceIgnoreRequest {
  fromEntityId: string; toEntityId: string; fingerprint: string; expectedDecisionRevision: string | null; ignore: boolean
}
