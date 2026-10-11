import { forceCollide, forceX, forceY, forceSimulation, forceManyBody, forceLink, forceCenter, type Force, type SimulationNode } from 'd3-force-3d'
import type { GraphResponse } from '@hesta-codex/shared'
import { indexGraph, nodeRadius } from './graph-model'

const endpoint = (value: unknown): string => typeof value === 'object' && value !== null && 'id' in value
  ? String(value.id) : String(value)
const pair = (source: unknown, target: unknown) => [endpoint(source), endpoint(target)].sort().join('\u0000')

export function graphPhysics(data: GraphResponse) {
  const index = indexGraph(data), pairs = new Map<string, number>()
  for (const edge of data.edges) {
    const key = pair(edge.source, edge.target)
    pairs.set(key, (pairs.get(key) ?? 0) + 1)
  }
  const density = Math.min(18, 2 * pairs.size / Math.max(1, data.nodes.length))
  return {
    index, pairs, charge: -(85 + density * 12 + Math.sqrt(data.nodes.length) * 3),
    distance: 62 + density * 3, reach: Math.min(900, 360 + Math.sqrt(data.nodes.length) * 20),
    collisionGap: 5 + Math.min(5, density / 3),
  }
}

export interface PhysicsEngine {
  d3Force(name: string): Force | undefined
  d3Force(name: string, force: Force): unknown
}

/** Tune the existing D3 simulation, without changing graph data or editorial orientation. */
export function configureGraphPhysics(engine: PhysicsEngine, data: GraphResponse) {
  const settings = graphPhysics(data)
  const degree = (id: string) => settings.index.neighbors.get(id)?.size ?? 0
  engine.d3Force('charge')?.strength(node => settings.charge * (degree(String(node.id)) ? 1 : .45))
    .distanceMax(settings.reach).theta(.9)
  engine.d3Force('link')?.distance(settings.distance).strength(link => {
    const edge = link as unknown as { source: unknown; target: unknown }
    // Parallel references and editorial relations must not pull the same pair twice as hard.
    return .38 / Math.sqrt(1 + Math.min(degree(endpoint(edge.source)), degree(endpoint(edge.target)))) /
      (settings.pairs.get(pair(edge.source, edge.target)) ?? 1)
  })
  engine.d3Force('collision', forceCollide(node => nodeRadius(settings.index.incidentEdges.get(String(node.id))?.length ?? 0) +
    settings.collisionGap).strength(.8).iterations(2))
  const containment = (node: { id?: string | number }) => degree(String(node.id)) ? .012 : .035
  engine.d3Force('x', forceX(0).strength(containment))
  engine.d3Force('y', forceY(0).strength(containment))
}

/** Let the same D3 engine seed fresh coordinates, without running or duplicating its layout algorithm. */
export function initializeGraphLayout(nodes: SimulationNode[]) {
  forceSimulation(nodes, 2).stop()
}

/** Reduced motion: settle offscreen, then let the Canvas render stationary coordinates. */
export function settleGraphLayout(nodes: SimulationNode[], links: Array<{ source: unknown; target: unknown }>, data: GraphResponse) {
  const simulation = forceSimulation(nodes, 2).stop()
    .force('charge', forceManyBody()).force('link', forceLink(links).id(node => node.id!)).force('center', forceCenter())
    .alphaDecay(.04).velocityDecay(.42)
  const engine = { d3Force(name: string, force?: Force) { return force ? simulation.force(name, force) : simulation.force(name) } } as PhysicsEngine
  configureGraphPhysics(engine, data)
  simulation.tick(180)
}
