import { describe, expect, it } from 'vitest'
import type { GraphEdge, GraphResponse } from '@hesta-codex/shared'
import { connectionCounts, connectionDirections, connectionKey, distinctNeighbors, groupGraphConnections } from './graph-connections'
import { emptyFilters, filterGraph, graphGroups, indexGraph } from './graph-model'

const nodes: GraphResponse['nodes'] = ['a', 'b', 'c'].map(id => ({ id, slug: id, title: `Fiche fictive ${id}`,
  kind: 'OTHER', placeKind: null, summary: null, aliases: [] }))
const relation = (id: string, source = 'a', target = 'b'): GraphEdge => ({ id, source, target,
  type: 'protects', label: 'protège', inverseLabel: 'est protégé par', symmetric: false })
const mention = (id: string, source = 'a', target = 'b', occurrences = 1): GraphEdge => ({ ...relation(id, source, target),
  type: 'OBSIDIAN_REFERENCE', label: 'Référence Obsidian', inverseLabel: 'Mentionné par', origin: 'OBSIDIAN', occurrences })

describe('unique graph connections', () => {
  it('collapses reciprocal mentions, repeated occurrences and distinct editorial facts without changing their members', () => {
    const data = { nodes, edges: [mention('ref-ab', 'a', 'b', 4), mention('ref-ba', 'b', 'a', 6),
      relation('protection'), { ...relation('ownership'), type: 'owns', label: 'possède' },
      { ...relation('alliance'), symmetric: true }] }
    const before = structuredClone(data), connections = groupGraphConnections(data)
    expect(connections).toHaveLength(1)
    expect(connections[0]).toMatchObject({ id: '["a","b"]', source: 'a', target: 'b', fromId: 'a', toId: 'b' })
    expect(connections[0]!.members.map(edge => edge.id)).toEqual(['alliance', 'ownership', 'protection', 'ref-ab', 'ref-ba'])
    expect(connectionCounts(connections[0]!.members)).toEqual({ references: 2, occurrences: 10, relations: 3 })
    expect(data).toEqual(before)
    expect(connections[0]!.members.find(edge => edge.id === 'ref-ba')!.source).toBe('b')
  })

  it('keeps stable identities and canonical endpoints regardless of input order or which direction survives filtering', () => {
    const edges = [mention('z', 'b', 'a'), relation('x'), relation('y', 'c', 'b')]
    expect(groupGraphConnections({ nodes, edges: [...edges].reverse() })).toEqual(groupGraphConnections({ nodes, edges }))
    expect(groupGraphConnections({ nodes, edges: [edges[0]!] })[0]!.id).toBe(connectionKey('a', 'b'))
    expect(connectionKey('a,b', 'c')).not.toBe(connectionKey('a', 'b,c'))
  })

  it('groups after filters without bringing back excluded references or private/status-filtered members', () => {
    const data = { nodes, edges: [mention('reference'), { ...relation('public'), visibility: 'PUBLIC', status: 'PUBLISHED' },
      { ...relation('private', 'b', 'a'), visibility: 'GM', status: 'PROPOSED' }] }
    const groups = new Set(graphGroups.map(group => group.id))
    const filtered = filterGraph(data, { ...emptyFilters, edgeVisibility: 'PUBLIC', edgeStatus: 'PUBLISHED' }, groups)
    expect(groupGraphConnections(filtered)[0]!.members.map(edge => edge.id)).toEqual(['public'])
    const refs = filterGraph(data, { ...emptyFilters, relationType: 'OBSIDIAN_REFERENCE' }, groups)
    expect(groupGraphConnections(refs)[0]!.members.map(edge => edge.id)).toEqual(['reference'])
  })

  it('preserves forward, reverse and mutual directions while respecting optional editorial/reference arrows', () => {
    const group = groupGraphConnections({ nodes, edges: [mention('reverse', 'b', 'a'), relation('forward'),
      { ...relation('symmetric'), symmetric: true }] })[0]!
    expect(connectionDirections(group, true, true)).toEqual({ forward: true, reverse: true })
    expect(connectionDirections(group, false, true)).toEqual({ forward: false, reverse: true })
    expect(connectionDirections(group, true, false)).toEqual({ forward: true, reverse: false })
    expect(connectionDirections(group, false, false)).toEqual({ forward: false, reverse: false })
    const symmetric = groupGraphConnections({ nodes, edges: [{ ...relation('sym'), symmetric: true }] })[0]!
    expect(connectionDirections(symmetric, true, true)).toEqual({ forward: false, reverse: false })
  })

  it('counts distinct neighbors for radius and ignores self loops in that degree', () => {
    const data = { nodes, edges: [mention('ab'), mention('ba', 'b', 'a'), relation('fact'), relation('self', 'a', 'a')] }
    expect(distinctNeighbors(indexGraph(data), 'a')).toBe(1)
    expect(distinctNeighbors(indexGraph(data), 'c')).toBe(0)
    expect(distinctNeighbors(indexGraph(data), 'missing')).toBe(0)
    expect(groupGraphConnections(data)).toHaveLength(2)
  })

  it('ignores dangling endpoints, preserves one self connection and handles an empty graph', () => {
    expect(groupGraphConnections({ nodes, edges: [relation('dangling', 'a', 'absent'), relation('self', 'b', 'b')] }))
      .toMatchObject([{ id: '["b","b"]', fromId: 'b', toId: 'b', members: [{ id: 'self' }] }])
    expect(groupGraphConnections({ nodes: [], edges: [] })).toEqual([])
    expect(connectionCounts([])).toEqual({ references: 0, occurrences: 0, relations: 0 })
  })

  it('keeps homonymous fiches distinct by identifier', () => {
    const homonyms = nodes.map(node => ({ ...node, title: 'Homonyme fictif' }))
    expect(groupGraphConnections({ nodes: homonyms, edges: [relation('ab'), relation('ac', 'a', 'c')] })).toHaveLength(2)
  })
})
