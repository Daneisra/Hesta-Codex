import type { EditorialStatus, Visibility } from './index.js'

export const publicationBatchLimit = 500
export interface PublicationSelection { entityIds: string[]; includeRelations: boolean; targetVisibility?: Visibility }
export interface PublicationCandidate { id: string; slug: string; title: string; status: EditorialStatus; visibility: Visibility }
export type PublicationOutcome = 'READY' | 'BLOCKED' | 'SKIPPED'
export interface PublicationEntity extends PublicationCandidate { outcome: PublicationOutcome; reason: string; evidence: number }
export interface PublicationRelation {
  id: string; from: PublicationCandidate; to: PublicationCandidate; label: string;
  status: EditorialStatus; visibility: Visibility; outcome: PublicationOutcome; reason: string; evidence: number;
}
export interface PublicationPreview {
  fingerprint: string; entities: PublicationEntity[]; relations: PublicationRelation[];
  targetVisibility?: Visibility;
  visibilityImpact?: { publicEntities: number; publicRelations: number; hiddenEntities: number; hiddenRelations: number };
  counts: { entitiesReady: number; entitiesBlocked: number; entitiesSkipped: number;
    relationsReady: number; relationsBlocked: number; relationsSkipped: number; publicElements: number }
}
export interface PublicationApply extends PublicationSelection { fingerprint: string; confirm: true; confirmPublic: boolean }
export interface PublicationResult { entities: number; relations: number }
