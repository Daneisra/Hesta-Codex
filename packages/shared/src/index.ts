export interface HealthResponse {
  status: 'ok' | 'degraded'
  service: 'hesta-codex-api'
  version: 'v1'
  database: 'ok' | 'unavailable'
}

export interface RelationTypeItem {
  id: string
  code: string
  label: string
  inverseCode: string | null
  inverseLabel: string | null
  symmetric: boolean
}

export type EntityKind =
  | 'PERSON'
  | 'PLACE'
  | 'ORGANIZATION'
  | 'FAMILY'
  | 'RELIGION'
  | 'DEITY'
  | 'SPECIES'
  | 'CREATURE'
  | 'ARTIFACT'
  | 'EVENT'
  | 'QUEST'
  | 'SESSION'
  | 'CONCEPT'
  | 'OTHER'

export type PlaceKind = 'CITY' | 'CONTINENT' | 'REGION' | 'SEA' | 'OCEAN' | 'OTHER'

/** Projection de lecture minimale ; les identifiants restent ceux du Codex. */
export interface GraphNode {
  id: string
  slug: string
  title: string
  kind: EntityKind
  placeKind: PlaceKind | null
  summary: string | null
  aliases: string[]
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  type: string
  label: string
  inverseLabel: string | null
  symmetric: boolean
}

export interface GraphResponse { nodes: GraphNode[]; edges: GraphEdge[] }
export interface AdminGraphNode extends GraphNode { status: EditorialStatus; visibility: Visibility }
export interface AdminGraphEdge extends GraphEdge { status: EditorialStatus; visibility: Visibility }
export interface AdminGraphResponse { nodes: AdminGraphNode[]; edges: AdminGraphEdge[] }

export interface EntityListItem {
  id: string
  slug: string
  kind: EntityKind
  placeKind: PlaceKind | null
  title: string
  summary: string | null
  tags: string[]
}

export interface EntityRelationItem {
  id: string
  description: string | null
  relationType: RelationTypeItem
  entity: EntityListItem
}

export interface EntityDetail extends EntityListItem {
  bodyMarkdown: string
  aliases: string[]
  status: 'PUBLISHED'
  visibility: 'PUBLIC'
  createdAt: string
  updatedAt: string
  publishedAt: string
  outgoingRelations: EntityRelationItem[]
  incomingRelations: EntityRelationItem[]
}

export type EditorialStatus = 'DRAFT' | 'PROPOSED' | 'PUBLISHED' | 'ARCHIVED'
export type Visibility = 'PUBLIC' | 'PLAYERS' | 'GM' | 'SECRET'
export type SourceKind = 'MANUAL' | 'OBSIDIAN' | 'DISCORD' | 'HESTA_MAP' | 'YOUTUBE' | 'AI_DERIVED' | 'OTHER'

export type AuthSessionResponse =
  | { authenticated: false; isAdmin: false; user: null }
  | { authenticated: true; isAdmin: boolean; user: { username: string; displayName: string | null } }

export interface AdminEntityListItem extends EntityListItem {
  status: EditorialStatus
  visibility: Visibility
  updatedAt: string
}

export interface AdminEntityListResponse {
  items: AdminEntityListItem[]
  total: number
  page: number
  pageSize: number
}

export interface AdminSource {
  id: string
  kind: SourceKind
  label: string
  externalId: string | null
  url: string | null
  authorLabel: string | null
  publishedAt: string | null
  visibility: Visibility
  updatedAt: string
}

export interface AdminSourceListResponse {
  items: AdminSource[]
  total: number
  page: number
  pageSize: number
}

export interface AdminManualCreateRequest {
  entity: {
    slug: string
    kind: EntityKind
    placeKind: PlaceKind | null
    title: string
    summary: string | null
    bodyMarkdown: string
    aliases: string[]
    tags: string[]
    visibility: Visibility
  }
  source: { mode: 'existing'; sourceId: string } | {
    mode: 'new'
    data: {
      kind: SourceKind
      label: string
      externalId: string | null
      url: string | null
      authorLabel: string | null
      publishedAt: string | null
      visibility: Visibility
    }
  }
  evidence: {
    claimText: string
    sourceExcerpt: string | null
    locator: string | null
    timeStartSeconds: number | null
    timeEndSeconds: number | null
    confidence: number | null
    visibility: Visibility
  }
}

export interface AdminManualRelationRequest {
  fromEntityId: string
  toEntityId: string
  relationCode: string
  description?: string | null
  visibility?: Visibility
  source: AdminManualCreateRequest['source']
  evidence: AdminManualCreateRequest['evidence']
}

export interface AdminEvidenceAddRequest {
  source: AdminManualCreateRequest['source']
  evidence: AdminManualCreateRequest['evidence']
}

export interface AdminEvidence {
  id: string
  claimText: string
  sourceExcerpt: string | null
  locator: string | null
  timeStartSeconds: number | null
  timeEndSeconds: number | null
  confidence: string | null
  visibility: Visibility
  updatedAt: string
  source: AdminSource
}

export interface AdminRelation {
  id: string
  description: string | null
  status: EditorialStatus
  visibility: Visibility
  updatedAt: string
  relationType: RelationTypeItem
  entity: AdminEntityListItem
  evidence: AdminEvidence[]
}

export interface AdminRevision {
  id: string
  number: number
  snapshot: unknown
  message: string | null
  editorLabel: string | null
  createdAt: string
}

export interface AdminEntityDetail extends AdminEntityListItem {
  bodyMarkdown: string
  aliases: string[]
  createdAt: string
  publishedAt: string | null
  evidence: AdminEvidence[]
  outgoingRelations: AdminRelation[]
  incomingRelations: AdminRelation[]
  revisions: AdminRevision[]
}

export interface AdminEntityPatch {
  title: string
  summary: string | null
  bodyMarkdown: string
  kind: EntityKind
  placeKind: PlaceKind | null
  aliases: string[]
  tags: string[]
  visibility: Visibility
  expectedUpdatedAt: string
  revisionMessage?: string | null
}

export interface AdminWorkflowRequest {
  expectedUpdatedAt: string
  revisionMessage?: string | null
}

export interface AdminRelationPatch {
  description: string | null
  visibility: Visibility
  expectedUpdatedAt: string
}

export interface AdminSourcePatch {
  kind: SourceKind
  label: string
  externalId: string | null
  url: string | null
  authorLabel: string | null
  publishedAt: string | null
  visibility: Visibility
  expectedUpdatedAt: string
}

export interface AdminEvidencePatch {
  claimText: string
  sourceExcerpt: string | null
  locator: string | null
  timeStartSeconds: number | null
  timeEndSeconds: number | null
  confidence: number | null
  visibility: Visibility
  expectedUpdatedAt: string
}

export interface AdminStats {
  byStatus: Record<EditorialStatus, number>
  byVisibility: Record<Visibility, number>
  sources: number
  relations: number
}

export type IngestionOutcome = 'NEW' | 'UNCHANGED' | 'MODIFIED'
export interface IngestionPage<T> { items: T[]; total: number; page: number; pageSize: number }
export interface IngestionSourceSummary { id: string; kind: SourceKind; label: string }
export interface AdminIngestionBatch {
  id: string; label: string; formatVersion: number; receivedCount: number; newCount: number;
  unchangedCount: number; modifiedCount: number; warningCount: number; createdAt: string;
  sourceCount: number; sourceKinds: SourceKind[]; sources: IngestionSourceSummary[];
}
export interface AdminIngestionItem {
  id: string; itemId: string; batchId: string; ordinal: number; outcome: IngestionOutcome;
  title: string | null; locator: string | null; contentType: string; externalId: string | null;
  observedAt: string | null; ingestedAt: string; version: number; contentHash: string; source: IngestionSourceSummary;
}
export interface AdminIngestionItemDetail extends AdminIngestionItem {
  content: string; metadata: unknown; originBatchId: string; snapshotIngestedAt: string;
  versions: Array<{ id: string; version: number; contentHash: string; ingestedAt: string }>;
}
