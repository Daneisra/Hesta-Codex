import { describe, expect, it } from 'vitest'
import { configureGraphPhysics, graphPhysics, settleGraphLayout, type PhysicsEngine } from './graph-physics'
import { syntheticGraph } from './graph-synthetic'
import { forceSimulation, forceManyBody, forceLink, type Force } from 'd3-force-3d'

describe('graph physics', () => {
  it('adapts repulsion, reach and collision gap to density while bounding growth', () => {
    const dense = syntheticGraph(), sparse = { ...dense, edges: dense.edges.slice(0, 10) }
    expect(graphPhysics(dense).charge).toBeLessThan(graphPhysics(sparse).charge)
    expect(graphPhysics(dense).distance).toBeGreaterThan(graphPhysics(sparse).distance)
    expect(graphPhysics(dense).reach).toBeLessThanOrEqual(900)
    expect(graphPhysics(dense).collisionGap).toBeLessThanOrEqual(10)
    expect(graphPhysics({ nodes: [], edges: [] }).charge).toBe(-85)
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
})
