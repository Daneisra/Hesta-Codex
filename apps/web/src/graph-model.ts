import type { AdminGraphResponse, EntityKind, GraphEdge, GraphNode, GraphResponse, PlaceKind } from '@hesta-codex/shared'

export type GraphData = GraphResponse | AdminGraphResponse
export type NeighborhoodDepth = 1 | 2 | 3
export type GraphIndex = {
  nodes: Map<string, GraphNode>
  edges: Map<string, GraphEdge>
  neighbors: Map<string, Set<string>>
  incidentEdges: Map<string, GraphEdge[]>
}

// Build once per filtered graph, never in the Canvas drawing loop.
export function indexGraph(data: GraphResponse): GraphIndex {
  const nodes = new Map(data.nodes.map((node) => [node.id, node]))
  const neighbors = new Map(data.nodes.map((node) => [node.id, new Set<string>()]))
  const incidentEdges = new Map(data.nodes.map((node) => [node.id, [] as GraphEdge[]]))
  const edges = new Map<string, GraphEdge>()
  for (const edge of data.edges) {
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) continue
    edges.set(edge.id, edge)
    neighbors.get(edge.source)!.add(edge.target)
    neighbors.get(edge.target)!.add(edge.source)
    incidentEdges.get(edge.source)!.push(edge)
    if (edge.target !== edge.source) incidentEdges.get(edge.target)!.push(edge)
  }
  return { nodes, edges, neighbors, incidentEdges }
}

// Exploration traverses both directions; stored orientation and arrowheads stay intact.
export function neighborhoodDistances(index: GraphIndex, id: string, depth: NeighborhoodDepth): Map<string, number> {
  const distances = new Map<string, number>()
  if (!index.nodes.has(id)) return distances
  distances.set(id, 0)
  const queue = [id]
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head]!
    const distance = distances.get(current)!
    if (distance >= depth) continue
    for (const neighbor of index.neighbors.get(current) ?? []) {
      if (distances.has(neighbor)) continue
      distances.set(neighbor, distance + 1)
      queue.push(neighbor)
    }
  }
  return distances
}

export function isolateNeighborhood(data: GraphResponse, distances: ReadonlyMap<string, number>): GraphResponse {
  return { nodes: data.nodes.filter((node) => distances.has(node.id)),
    edges: data.edges.filter((edge) => distances.has(edge.source) && distances.has(edge.target)) }
}

export function nodeRadius(connectionCount: number): number {
  return Math.min(9, 4 + Math.sqrt(Math.max(0, connectionCount)))
}
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

export function indexGraphSearch(data: GraphData): Map<string, string[]> {
  return new Map(data.nodes.map(node => [node.id, [node.title, node.slug, ...node.aliases].map(normalizeSearch)]))
}

export function searchIndexedGraph(data: GraphResponse, query: string, index: ReadonlyMap<string, readonly string[]>): GraphNode[] {
  const needle = normalizeSearch(query)
  if (!needle) return []
  return data.nodes.filter(node => index.get(node.id)?.some(value => value.includes(needle)))
}

export function nodeMatchesFilters(node: GraphNode, filters: GraphFilters, groups: ReadonlySet<string>): boolean {
  return groups.has(groupFor(node.kind).id) && (!filters.kind || node.kind === filters.kind) &&
    (!filters.placeKind || node.placeKind === filters.placeKind) &&
    (!filters.nodeStatus || ('status' in node && node.status === filters.nodeStatus)) &&
    (!filters.nodeVisibility || ('visibility' in node && node.visibility === filters.nodeVisibility))
}

export type MatchPart = { text: string; matched: boolean }

// Keep original Unicode characters while matching the same accent-insensitive text as searchGraph.
export function searchMatchParts(value: string, query: string): MatchPart[] {
  const needle = normalizeSearch(query)
  if (!needle) return [{ text: value, matched: false }]
  let normalized = ''
  const offsets: Array<{ start: number; end: number }> = []
  let offset = 0
  for (const character of value) {
    const folded = character.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('fr')
    for (let i = 0; i < folded.length; i++) offsets.push({ start: offset, end: offset + character.length })
    // A decomposed accent belongs to the preceding highlighted character.
    if (!folded && offsets.length) offsets[offsets.length - 1]!.end = offset + character.length
    normalized += folded
    offset += character.length
  }
  const parts: MatchPart[] = []
  let cursor = 0
  let searchAt = 0
  for (let match = normalized.indexOf(needle, searchAt); match !== -1; match = normalized.indexOf(needle, searchAt)) {
    const start = offsets[match]!.start
    const end = offsets[match + needle.length - 1]!.end
    if (start > cursor) parts.push({ text: value.slice(cursor, start), matched: false })
    parts.push({ text: value.slice(start, end), matched: true })
    cursor = end
    searchAt = match + needle.length
  }
  if (cursor < value.length) parts.push({ text: value.slice(cursor), matched: false })
  return parts.length ? parts : [{ text: value, matched: false }]
}

export function filterGraph(data: GraphData, filters: GraphFilters, groups: ReadonlySet<string>): GraphResponse {
  const nodes = data.nodes.filter(node => nodeMatchesFilters(node, filters, groups))
  const ids = new Set(nodes.map((node) => node.id))
  const edges = data.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target) &&
    (!filters.relationType || edge.type === filters.relationType) &&
    (!filters.edgeStatus || ('status' in edge && edge.status === filters.edgeStatus)) &&
    (!filters.edgeVisibility || ('visibility' in edge && edge.visibility === filters.edgeVisibility)))
  return { nodes, edges }
}

export type GraphConnection = GraphEdge & {
  otherId: string
  otherTitle: string
  displayLabel: string
  direction: 'outgoing' | 'incoming' | 'symmetric'
}

export function visibleConnections(data: GraphResponse, id: string, index = indexGraph(data)): GraphConnection[] {
  return (index.incidentEdges.get(id) ?? []).map((edge) => {
    const outgoing = edge.source === id
    const otherId = outgoing ? edge.target : edge.source
    return { ...edge, otherId, otherTitle: index.nodes.get(otherId)?.title ?? '',
      displayLabel: outgoing || edge.symmetric ? edge.label : edge.inverseLabel ?? edge.label,
      direction: edge.symmetric ? 'symmetric' as const : outgoing ? 'outgoing' as const : 'incoming' as const }
  })
}
