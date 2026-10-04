import { describe, expect, it } from 'vitest'
import type { GraphEdge, GraphNode, GraphResponse } from '@hesta-codex/shared'
import { emptyFilters, filterGraph, graphGroups, indexGraph, isolateNeighborhood, neighborhoodDistances,
  nodeRadius, searchMatchParts, visibleConnections } from './graph-model'

const node = (id: string): GraphNode => ({ id, slug: id, title: id, kind: 'PLACE', placeKind: 'CITY', summary: null, aliases: [] })
const edge = (id: string, source: string, target: string, symmetric = false): GraphEdge => ({
  id, source, target, type: symmetric ? 'allied_with' : 'located_in', label: symmetric ? 'allié à' : 'situé dans',
  inverseLabel: symmetric ? null : 'contient', symmetric,
})
const graph: GraphResponse = { nodes: ['a', 'b', 'c', 'd', 'e', 'x', 'y', 'z'].map(node),
  edges: [edge('ab', 'a', 'b'), edge('bc', 'b', 'c', true), edge('dc', 'd', 'c'), edge('de', 'd', 'e'), edge('xy', 'x', 'y')] }

describe('graph neighborhoods', () => {
  it('traverses directional and symmetric edges at depths 1, 2 and 3 without disconnected nodes', () => {
    const index = indexGraph(graph)
    expect([...neighborhoodDistances(index, 'a', 1)]).toEqual([['a', 0], ['b', 1]])
    expect([...neighborhoodDistances(index, 'a', 2)]).toEqual([['a', 0], ['b', 1], ['c', 2]])
    expect([...neighborhoodDistances(index, 'a', 3)]).toEqual([['a', 0], ['b', 1], ['c', 2], ['d', 3]])
    expect(neighborhoodDistances(index, 'inaccessible', 3).size).toBe(0)
    expect([...neighborhoodDistances(index, 'z', 3)]).toEqual([['z', 0]])
  })

  it('keeps one symmetric edge and the stored orientation when isolating', () => {
    const isolated = isolateNeighborhood(graph, neighborhoodDistances(indexGraph(graph), 'a', 3))
    expect(isolated.nodes.map((node) => node.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(isolated.edges).toEqual(graph.edges.slice(0, 3))
    expect(visibleConnections(isolated, 'b').find((edge) => edge.id === 'ab')?.displayLabel).toBe('contient')
    expect(visibleConnections(isolated, 'b').find((edge) => edge.id === 'bc')?.displayLabel).toBe('allié à')
    expect(visibleConnections(isolated, 'c').find((edge) => edge.id === 'bc')?.displayLabel).toBe('allié à')
  })

  it('uses shortest distance in a cyclic graph and counts parallel relations independently', () => {
    const cyclic = { ...graph, edges: [...graph.edges, edge('ac', 'a', 'c'), edge('ab2', 'a', 'b')] }
    const index = indexGraph(cyclic)
    expect(neighborhoodDistances(index, 'a', 3).get('d')).toBe(2)
    expect(index.neighbors.get('a')?.size).toBe(2)
    expect(index.incidentEdges.get('a')?.length).toBe(3)
  })

  it('never traverses nodes or edges removed by combined filters', () => {
    const filtered = filterGraph(graph, { ...emptyFilters, relationType: 'located_in' },
      new Set(graphGroups.map((group) => group.id)))
    expect([...neighborhoodDistances(indexGraph(filtered), 'a', 3).keys()]).toEqual(['a', 'b'])
    const malformed = { ...graph, edges: [...graph.edges, edge('ghost', 'a', 'absent')] }
    expect(indexGraph(malformed).edges.has('ghost')).toBe(false)
  })

  it('bounds node radii while preserving a modest distinction for connected nodes', () => {
    expect(nodeRadius(0)).toBe(4)
    expect(nodeRadius(1)).toBe(5)
    expect(nodeRadius(1_000_000)).toBe(9)
    expect(nodeRadius(-1)).toBe(4)
  })
})

describe('search highlighting', () => {
  it('highlights repeated case/accent-insensitive matches without rewriting the original text', () => {
    const parts = searchMatchParts('Cité du port · cité', 'CITE')
    expect(parts.filter((part) => part.matched).map((part) => part.text)).toEqual(['Cité', 'cité'])
    expect(parts.map((part) => part.text).join('')).toBe('Cité du port · cité')
  })

  it('preserves surrogate pairs, decomposed accents and literal HTML-looking text', () => {
    const text = '🌊 Ci\u0301te\u0301 <script>'
    expect(searchMatchParts(text, 'cité').find((part) => part.matched)?.text).toBe('Ci\u0301te\u0301')
    expect(searchMatchParts(text, '<script>').find((part) => part.matched)?.text).toBe('<script>')
    expect(searchMatchParts(text, 'absent')).toEqual([{ text, matched: false }])
    expect(searchMatchParts(text, ' ')).toEqual([{ text, matched: false }])
  })
})
