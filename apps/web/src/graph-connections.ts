import type { GraphEdge, GraphResponse } from '@hesta-codex/shared'
import type { GraphIndex } from './graph-model'

/** A rendering/physics projection only. Members retain their original direction and metadata. */
export type VisualConnection = {
  id: string
  source: string
  target: string
  fromId: string
  toId: string
  members: readonly GraphEdge[]
}

export function connectionKey(a: string, b: string): string {
  return JSON.stringify(a <= b ? [a, b] : [b, a])
}

/** Call with the filtered graph. Never recover members from the complete catalogue. */
export function groupGraphConnections(data: GraphResponse): VisualConnection[] {
  const ids = new Set(data.nodes.map(node => node.id))
  const groups = new Map<string, VisualConnection & { members: GraphEdge[] }>()
  for (const edge of data.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) continue
    const id = connectionKey(edge.source, edge.target)
    let group = groups.get(id)
    if (!group) {
      const [source, target] = edge.source <= edge.target ? [edge.source, edge.target] : [edge.target, edge.source]
      group = { id, source, target, fromId: source, toId: target, members: [] }
      groups.set(id, group)
    }
    group.members.push(edge)
  }
  for (const group of groups.values()) group.members.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  return [...groups.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

export function connectionDirections(connection: VisualConnection, editorial: boolean, references: boolean) {
  let forward = false, reverse = false
  for (const edge of connection.members) {
    if (edge.symmetric || edge.source === edge.target || !(edge.origin === 'OBSIDIAN' ? references : editorial)) continue
    if (edge.source === connection.fromId) forward = true
    else reverse = true
  }
  return { forward, reverse }
}

export function connectionCounts(edges: readonly GraphEdge[]) {
  const references = edges.filter(edge => edge.origin === 'OBSIDIAN')
  return { references: references.length, occurrences: references.reduce((sum, edge) => sum + (edge.occurrences ?? 1), 0),
    relations: edges.length - references.length }
}

export function distinctNeighbors(index: Pick<GraphIndex, 'neighbors'>, id: string): number {
  const neighbors = index.neighbors.get(id)
  return (neighbors?.size ?? 0) - (neighbors?.has(id) ? 1 : 0)
}
