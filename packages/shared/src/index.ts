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
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue | undefined }

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
  metadata: JsonValue | null
  status: 'PUBLISHED'
  visibility: 'PUBLIC'
  createdAt: string
  updatedAt: string
  publishedAt: string
  outgoingRelations: EntityRelationItem[]
  incomingRelations: EntityRelationItem[]
}
