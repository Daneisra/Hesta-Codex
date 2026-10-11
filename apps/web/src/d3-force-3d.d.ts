// The installed D3 engine has no bundled declarations. Keep this surface to the APIs we use.
declare module 'd3-force-3d' {
  export interface SimulationNode { id?: string | number; x?: number; y?: number; vx?: number; vy?: number; fx?: number; fy?: number }
  export interface Force {
    (alpha: number): void
    initialize?: (nodes: SimulationNode[], ...args: unknown[]) => void
    strength(value: number | ((node: SimulationNode) => number)): Force
    iterations(value: number): Force
    radius(value: (node: SimulationNode) => number): Force
    distance(value: number | ((link: { source: unknown; target: unknown }) => number)): Force
    distanceMax(value: number): Force
    theta(value: number): Force
    id(value: (node: SimulationNode) => string | number): Force
  }
  export function forceCollide(radius: (node: SimulationNode) => number): Force
  export function forceX(x: number): Force
  export function forceY(y: number): Force
  export function forceManyBody(): Force
  export function forceCenter(x?: number, y?: number): Force
  export function forceLink(links: Array<{ source: unknown; target: unknown }>): Force
  export interface Simulation {
    force(name: string): Force | undefined
    force(name: string, force: Force): Simulation
    stop(): Simulation
    tick(iterations: number): Simulation
    alphaDecay(value: number): Simulation
    velocityDecay(value: number): Simulation
  }
  export function forceSimulation(nodes: SimulationNode[], dimensions?: number): Simulation
}
