import { forceCollide, forceX, forceY, forceSimulation, forceManyBody, forceLink, forceCenter, type Force, type SimulationNode } from 'd3-force-3d'
import type { GraphNode } from '@hesta-codex/shared'
import { nodeRadius } from './graph-model'
import { distinctNeighbors } from './graph-connections'

type PhysicsGraph = { nodes: readonly GraphNode[]; edges: ReadonlyArray<{ source: string; target: string }>; radii?: ReadonlyMap<string, number> }
export type GraphViewport = { width: number; height: number }

const endpoint = (value: unknown): string => typeof value === 'object' && value !== null && 'id' in value
  ? String(value.id) : String(value)
const pair = (source: unknown, target: unknown) => [endpoint(source), endpoint(target)].sort().join('\u0000')

export function graphPhysics(data: PhysicsGraph, viewport?: GraphViewport) {
  const index = { neighbors: new Map(data.nodes.map(node => [node.id, new Set<string>()])) }, pairs = new Map<string, number>()
  for (const edge of data.edges) {
    if (!index.neighbors.has(edge.source) || !index.neighbors.has(edge.target)) continue
    index.neighbors.get(edge.source)!.add(edge.target); index.neighbors.get(edge.target)!.add(edge.source)
    const key = pair(edge.source, edge.target)
    pairs.set(key, (pairs.get(key) ?? 0) + 1)
  }
  const density = Math.min(18, 2 * pairs.size / Math.max(1, data.nodes.length))
  const aspect = viewport && viewport.width > 0 && viewport.height > 0
    ? Math.max(.65, Math.min(2, viewport.width / viewport.height)) : 1
  const components: string[][] = [], seen = new Set<string>()
  for (const id of [...index.neighbors.keys()].sort()) {
    if (seen.has(id)) continue
    const component = [id]; seen.add(id)
    for (let at = 0; at < component.length; at++) for (const other of index.neighbors.get(component[at]!) ?? []) {
      if (!seen.has(other)) { seen.add(other); component.push(other) }
    }
    components.push(component)
  }
  components.sort((a, b) => b.length - a.length || a[0]!.localeCompare(b[0]!))
  const anchors = new Map<string, { x: number; y: number; strength: number }>()
  const dominant = (components[0]?.length ?? 0) > data.nodes.length / 2
  const satellites = dominant ? components.slice(1) : components
  if (dominant) for (const id of components[0]!) anchors.set(id, { x: 0, y: 0, strength: .005 })
  const ring = dominant ? 100 + Math.sqrt(components[0]!.length) * 38 : 50 + Math.sqrt(data.nodes.length) * 13
  satellites.forEach((component, at) => {
    const angle = at * Math.PI * (3 - Math.sqrt(5)), radius = ring * (.85 + .15 * Math.sqrt((at + 1) / satellites.length))
    const anchor = { x: Math.cos(angle) * radius * Math.sqrt(aspect), y: Math.sin(angle) * radius / Math.sqrt(aspect), strength: .028 }
    for (const id of component) anchors.set(id, anchor)
  })
  return {
    index, pairs, anchors, aspect, charge: -(110 + density * 18 + Math.sqrt(data.nodes.length) * 4),
    distance: 80 + density * 4, reach: Math.min(1000, 450 + Math.sqrt(data.nodes.length) * 24),
    collisionGap: 8 + Math.min(6, density / 2),
  }
}

export interface PhysicsEngine {
  d3Force(name: string): Force | undefined
  d3Force(name: string, force: Force): unknown
}

/** Tune the existing D3 simulation, without changing graph data or editorial orientation. */
export function configureGraphPhysics(engine: PhysicsEngine, data: PhysicsGraph, viewport?: GraphViewport) {
  const settings = graphPhysics(data, viewport)
  const degree = (id: string) => distinctNeighbors(settings.index, id)
  engine.d3Force('charge')?.strength(node => {
    const neighbors = degree(String(node.id))
    return settings.charge * (neighbors ? 1 + Math.min(.6, Math.sqrt(neighbors) * .08) : .4)
  })
    .distanceMax(settings.reach).theta(.9)
  engine.d3Force('link')?.distance(link => {
    const edge = link as unknown as { source: unknown; target: unknown }
    const hub = Math.max(degree(endpoint(edge.source)), degree(endpoint(edge.target)))
    return settings.distance * (1 + Math.min(.65, Math.log2(1 + hub) * .12))
  }).strength(link => {
    const edge = link as unknown as { source: unknown; target: unknown }
    // Parallel references and editorial relations must not pull the same pair twice as hard.
    return .38 / Math.sqrt(1 + Math.min(degree(endpoint(edge.source)), degree(endpoint(edge.target)))) /
      (settings.pairs.get(pair(edge.source, edge.target)) ?? 1)
  })
  engine.d3Force('collision', forceCollide(node => (data.radii?.get(String(node.id)) ?? nodeRadius(degree(String(node.id)))) +
    settings.collisionGap).strength(.8).iterations(2))
  const anchor = (node: { id?: string | number }) => settings.anchors.get(String(node.id)) ?? { x: 0, y: 0, strength: .005 }
  engine.d3Force('x', forceX(node => anchor(node).x).strength(node => anchor(node).strength / settings.aspect ** 2))
  engine.d3Force('y', forceY(node => anchor(node).y).strength(node => anchor(node).strength * settings.aspect ** 2))
}

/** Let the same D3 engine seed fresh coordinates, without running or duplicating its layout algorithm. */
export function initializeGraphLayout(nodes: SimulationNode[]) {
  forceSimulation(nodes, 2).stop()
}

/** Reduced motion: settle offscreen, then let the Canvas render stationary coordinates. */
export function settleGraphLayout(nodes: SimulationNode[], links: Array<{ source: unknown; target: unknown }>, data: PhysicsGraph, viewport?: GraphViewport) {
  const simulation = forceSimulation(nodes, 2).stop()
    .force('charge', forceManyBody()).force('link', forceLink(links).id(node => node.id!)).force('center', forceCenter())
    .alphaDecay(.04).velocityDecay(.42)
  const engine = { d3Force(name: string, force?: Force) { return force ? simulation.force(name, force) : simulation.force(name) } } as PhysicsEngine
  configureGraphPhysics(engine, data, viewport)
  simulation.tick(180)
}
