import type { AdminGraphResponse, EntityKind, GraphEdge, GraphNode, GraphResponse, PlaceKind } from '@hesta-codex/shared'

export type GraphData = GraphResponse | AdminGraphResponse
export type GraphFilters = {
  kind: EntityKind | ''
  placeKind: PlaceKind | ''
  relationType: string
  nodeStatus: string
  nodeVisibility: string
  edgeStatus: string
  edgeVisibility: string
}

export const emptyFilters: GraphFilters = {
  kind: '', placeKind: '', relationType: '', nodeStatus: '', nodeVisibility: '',
  edgeStatus: '', edgeVisibility: '',
}

export const graphGroups = [
  { id: 'places', label: 'Lieux', kinds: ['PLACE'], color: '#75b7d7' },
  { id: 'people', label: 'Personnes et peuples', kinds: ['PERSON', 'FAMILY', 'SPECIES', 'CREATURE'], color: '#b8a3df' },
  { id: 'collectives', label: 'Collectifs et croyances', kinds: ['ORGANIZATION', 'RELIGION', 'DEITY'], color: '#d8bc85' },
  { id: 'stories', label: 'Récits et objets', kinds: ['ARTIFACT', 'EVENT', 'QUEST', 'SESSION'], color: '#d596a7' },
  { id: 'ideas', label: 'Idées et autres', kinds: ['CONCEPT', 'OTHER'], color: '#9fbed1' },
] as const

export const kindLabels: Record<EntityKind, string> = {
  PERSON: 'Personnage', PLACE: 'Lieu', ORGANIZATION: 'Organisation', FAMILY: 'Famille',
  RELIGION: 'Religion', DEITY: 'Divinité', SPECIES: 'Espèce', CREATURE: 'Créature',
  ARTIFACT: 'Artefact', EVENT: 'Événement', QUEST: 'Quête', SESSION: 'Session JDR',
  CONCEPT: 'Concept', OTHER: 'Autre',
}

export const placeLabels: Record<PlaceKind, string> = {
  CITY: 'Ville', CONTINENT: 'Continent', REGION: 'Région', SEA: 'Mer', OCEAN: 'Océan', OTHER: 'Autre lieu',
}

export function groupFor(kind: EntityKind) {
  return graphGroups.find((group) => (group.kinds as readonly string[]).includes(kind))!
}

export function normalizeSearch(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('fr').trim()
}

export function searchGraph(data: GraphData, query: string): GraphNode[] {
  const needle = normalizeSearch(query)
  if (!needle) return []
  return data.nodes.filter((node) => [node.title, node.slug, ...node.aliases]
    .some((value) => normalizeSearch(value).includes(needle)))
}

export function filterGraph(data: GraphData, filters: GraphFilters, groups: ReadonlySet<string>,
  isolatedId: string | null = null): GraphResponse {
  const nodes = data.nodes.filter((node) => groups.has(groupFor(node.kind).id) &&
    (!filters.kind || node.kind === filters.kind) &&
    (!filters.placeKind || node.placeKind === filters.placeKind) &&
    (!filters.nodeStatus || ('status' in node && node.status === filters.nodeStatus)) &&
    (!filters.nodeVisibility || ('visibility' in node && node.visibility === filters.nodeVisibility)))
  const ids = new Set(nodes.map((node) => node.id))
  const edges = data.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target) &&
    (!filters.relationType || edge.type === filters.relationType) &&
    (!filters.edgeStatus || ('status' in edge && edge.status === filters.edgeStatus)) &&
    (!filters.edgeVisibility || ('visibility' in edge && edge.visibility === filters.edgeVisibility)))
  if (!isolatedId || !ids.has(isolatedId)) return { nodes, edges }
  const nearby = new Set([isolatedId])
  for (const edge of edges) {
    if (edge.source === isolatedId) nearby.add(edge.target)
    if (edge.target === isolatedId) nearby.add(edge.source)
  }
  return { nodes: nodes.filter((node) => nearby.has(node.id)),
    edges: edges.filter((edge) => nearby.has(edge.source) && nearby.has(edge.target)) }
}

export type GraphConnection = GraphEdge & {
  otherId: string
  otherTitle: string
  displayLabel: string
  direction: 'outgoing' | 'incoming' | 'symmetric'
}

export function visibleConnections(data: GraphResponse, id: string): GraphConnection[] {
  const names = new Map(data.nodes.map((node) => [node.id, node.title]))
  return data.edges.filter((edge) => edge.source === id || edge.target === id).map((edge) => {
    const outgoing = edge.source === id
    const otherId = outgoing ? edge.target : edge.source
    return { ...edge, otherId, otherTitle: names.get(otherId) ?? '',
      displayLabel: outgoing || edge.symmetric ? edge.label : edge.inverseLabel ?? edge.label,
      direction: edge.symmetric ? 'symmetric' as const : outgoing ? 'outgoing' as const : 'incoming' as const }
  })
}
