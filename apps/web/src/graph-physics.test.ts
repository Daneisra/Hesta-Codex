import { describe, expect, it } from 'vitest'
import { configureGraphPhysics, graphPhysics, settleGraphLayout, type PhysicsEngine } from './graph-physics'
import { readabilityGraph, syntheticGraph } from './graph-synthetic'
import { nodeRadius } from './graph-model'
import { groupGraphConnections } from './graph-connections'
import { forceSimulation, forceManyBody, forceLink, type Force } from 'd3-force-3d'

describe('graph physics', () => {
  it('adapts repulsion, reach and collision gap to density while bounding growth', () => {
    const dense = syntheticGraph(), sparse = { ...dense, edges: dense.edges.slice(0, 10) }
    expect(graphPhysics(dense).charge).toBeLessThan(graphPhysics(sparse).charge)
    expect(graphPhysics(dense).distance).toBeGreaterThan(graphPhysics(sparse).distance)
    expect(graphPhysics(dense).reach).toBeLessThanOrEqual(1000)
    expect(graphPhysics(dense).collisionGap).toBeLessThanOrEqual(14)
    expect(graphPhysics({ nodes: [], edges: [] }).charge).toBe(-110)
  })

  it('does not increase density when editorial and automatic connections join the same pair', () => {
    const data = syntheticGraph(), duplicate = { ...data, edges: [...data.edges, ...data.edges.map(edge => ({ ...edge, id: edge.id + '-reference' }))] }
    expect(graphPhysics(duplicate).charge).toBe(graphPhysics(data).charge)
    expect(graphPhysics(duplicate).pairs.get('node-0\u0000node-1')).toBe(2)
  })

  it('installs collision and soft containment on the actual existing D3 engine', () => {
    const data = syntheticGraph(), simulation = forceSimulation(data.nodes.map(node => ({ ...node })), 2).stop()
      .force('charge', forceManyBody()).force('link', forceLink(data.edges.map(edge => ({ ...edge }))).id(node => node.id!))
    const engine = { d3Force(name: string, force?: Force) { return force ? simulation.force(name, force) : simulation.force(name) } } as PhysicsEngine
    configureGraphPhysics(engine, data)
    expect(simulation.force('collision')).toBeTypeOf('function')
    expect(simulation.force('x')).toBeTypeOf('function')
    expect(simulation.force('y')).toBeTypeOf('function')
    expect(data.nodes.every(node => !('x' in node))).toBe(true)
  })

  it('settles disconnected components and orphans at finite bounded coordinates without touching API data', () => {
    const data = syntheticGraph(), fixture = { nodes: data.nodes.slice(0, 130), edges: data.edges.filter(edge =>
      Number(edge.source.slice(5)) < 120 && Number(edge.target.slice(5)) < 120) }
    const original = JSON.stringify(fixture), nodes = fixture.nodes.map(node => ({ ...node, x: undefined as number | undefined, y: undefined as number | undefined }))
    settleGraphLayout(nodes, fixture.edges.map(edge => ({ ...edge })), fixture)
    expect(nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(true)
    expect(Math.max(...nodes.map(node => Math.hypot(node.x!, node.y!)))).toBeLessThan(1500)
    expect(JSON.stringify(fixture)).toBe(original)
  })

  it('separates initially overlapping nodes in the reduced-motion layout', () => {
    const data = syntheticGraph(), fixture = { nodes: data.nodes.slice(0, 12), edges: [] }
    const nodes = fixture.nodes.map(node => ({ ...node, x: 0, y: 0 }))
    settleGraphLayout(nodes, [], fixture)
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      expect(Math.hypot(nodes[i]!.x - nodes[j]!.x, nodes[i]!.y - nodes[j]!.y)).toBeGreaterThan(8)
    }
  })

  it('gives the same layout when reciprocal/parallel facts are projected to one physical link per pair', () => {
    const data = syntheticGraph(), nodes = data.nodes.slice(0, 12)
    const edges = data.edges.filter(edge => nodes.some(node => node.id === edge.source) && nodes.some(node => node.id === edge.target))
    const duplicated = [...edges, ...edges.map(edge => ({ ...edge, id: edge.id + '-reverse', source: edge.target, target: edge.source }))]
    const run = (input: typeof edges) => {
      const links = groupGraphConnections({ nodes, edges: input }), positioned = nodes.map(node => ({ ...node, x: 0, y: 0 }))
      settleGraphLayout(positioned, links.map(link => ({ ...link })), { nodes, edges: links })
      return positioned.map(node => [node.x, node.y])
    }
    expect(run(duplicated)).toEqual(run(edges))
  })

  it.each([[1920, 1080], [3840, 2160]])('keeps all 141 fictitious notes framed and gives the main network room at %s × %s', (width, height) => {
    const fixture = readabilityGraph(), original = JSON.stringify(fixture)
    expect(fixture.edges).toHaveLength(310)
    // Let D3 use its ordinary phyllotaxis seed, as with a fresh browser layout.
    const positioned = fixture.nodes.map(node => ({ ...node, x: undefined as number | undefined, y: undefined as number | undefined }))
    const links = groupGraphConnections(fixture)
    settleGraphLayout(positioned, links.map(edge => ({ ...edge })), { nodes: fixture.nodes, edges: links }, { width, height })
    const settings = graphPhysics(fixture), radius = (id: string) => nodeRadius(settings.index.neighbors.get(id)!.size)
    expect(positioned.every(node => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(true)
    const left = Math.min(...positioned.map(node => node.x! - radius(node.id))), right = Math.max(...positioned.map(node => node.x! + radius(node.id)))
    const top = Math.min(...positioned.map(node => node.y! - radius(node.id))), bottom = Math.max(...positioned.map(node => node.y! + radius(node.id)))
    const scale = Math.min((width - 100) / (right - left), (height - 100) / (bottom - top))
    const core = positioned.filter(node => Number(node.id.slice(5)) < 122)
    expect((Math.max(...core.map(node => node.x!)) - Math.min(...core.map(node => node.x!))) * scale / width).toBeGreaterThan(.55)
    const gaps = core.map(node => Math.min(...core.filter(other => other !== node).map(other => Math.hypot(node.x! - other.x!, node.y! - other.y!))) * scale).sort((a, b) => a - b)
    expect(gaps[Math.floor(gaps.length / 2)]! / height).toBeGreaterThan(.04)
    expect(JSON.stringify(fixture)).toBe(original)
  })

  it('keeps component anchors finite in portrait, empty, disconnected and self-linked graphs without fixing nodes', () => {
    const fixture = readabilityGraph(), nodes = fixture.nodes.slice(0, 4)
    for (const data of [{ nodes: [], edges: [] }, { nodes, edges: [] }, { nodes, edges: [{ source: nodes[0]!.id, target: nodes[0]!.id }] }]) {
      const settings = graphPhysics(data, { width: 390, height: 844 })
      expect([...settings.anchors.values()].every(anchor => Number.isFinite(anchor.x) && Number.isFinite(anchor.y))).toBe(true)
      expect(data.nodes.some(node => 'fx' in node)).toBe(false)
    }
  })

  it('retains manually fixed coordinates while settling a mixed-component viewport layout', () => {
    const fixture = readabilityGraph()
    const nodes = fixture.nodes.map((node, i) => ({ ...node, x: 0, y: 0, fx: i === 0 ? 123 : undefined, fy: i === 0 ? 456 : undefined }))
    settleGraphLayout(nodes, fixture.edges.map(edge => ({ ...edge })), fixture, { width: 1920, height: 1080 })
    expect(nodes[0]).toMatchObject({ x: 123, y: 456, fx: 123, fy: 456 })
    expect(nodes.slice(1).every(node => node.fx === undefined && node.fy === undefined && Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(true)
  })
})
