import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps, Ref } from 'react'
import type { GraphEdge, GraphNode, GraphResponse } from '@hesta-codex/shared'
import { GraphCanvas } from './GraphCanvas'
import { indexGraph, neighborhoodDistances } from './graph-model'
import { positionStorageKey, serializePositions } from './graph-positions'

type PositionedNode = GraphNode & { x?: number; y?: number; fx?: number; fy?: number }
type RenderedGraph = {
  graphData: { nodes: PositionedNode[]; links: GraphEdge[] }
  onNodeClick: (node: PositionedNode) => void
  onNodeDragEnd: (node: PositionedNode) => void
  onNodeHover: (node: PositionedNode | null) => void
  onLinkHover: (edge: GraphEdge | null) => void
  onLinkClick: (edge: GraphEdge) => void
  onBackgroundClick: () => void
  onZoom: () => void
  onEngineStop: () => void
  onEngineTick: () => void
  nodeColor: (node: PositionedNode) => string
  linkWidth: (edge: GraphEdge) => number
  linkDirectionalArrowLength: (edge: GraphEdge) => number
  nodeCanvasObject: (node: PositionedNode, context: CanvasRenderingContext2D, scale: number) => void
  onRenderFramePost: (context: CanvasRenderingContext2D, scale: number) => void
}
const graphMock = vi.hoisted(() => ({ props: null as unknown, initializePositions: true,
  methods: { centerAt: vi.fn(), zoom: vi.fn(() => 6), zoomToFit: vi.fn(), d3ReheatSimulation: vi.fn() } }))

vi.mock('react-force-graph-2d', async () => {
  const { useImperativeHandle } = await import('react')
  return { default: ({ ref, ...props }: RenderedGraph & { ref?: Ref<typeof graphMock.methods> }) => {
    if (graphMock.initializePositions) props.graphData.nodes.forEach((node, i) => { node.x ??= 10 + i * 10; node.y ??= 20 + i * 10 })
    useImperativeHandle(ref, () => graphMock.methods)
    graphMock.props = props
    return <div data-testid="force-graph" />
  } }
})

const fixture: GraphResponse = { nodes: ['a', 'b', 'c', 'd'].map((id) => ({
  id, slug: id, title: id, kind: 'PLACE', placeKind: 'CITY', summary: null, aliases: [],
})), edges: [
  { id: 'ab', source: 'a', target: 'b', type: 'located_in', label: 'situé dans', inverseLabel: 'contient', symmetric: false },
  { id: 'bc', source: 'b', target: 'c', type: 'allied_with', label: 'allié à', inverseLabel: null, symmetric: true },
] }
const index = indexGraph(fixture)
const latest = () => graphMock.props as RenderedGraph
function props(): ComponentProps<typeof GraphCanvas> {
  return { data: fixture, index, totalIndex: index, selectedId: 'a', selectedEdgeId: '', isolated: false,
    focusRequest: { id: 'a', token: 1 }, distances: neighborhoodDistances(index, 'a', 1), depth: 1,
    onDepthChange: vi.fn(), searchMatches: new Set(), onSelectNode: vi.fn(), onOpenNode: vi.fn(),
    onSelectEdge: vi.fn(), onClearSelection: vi.fn(), onToggleIsolation: vi.fn() }
}

beforeEach(() => {
  localStorage.clear()
  graphMock.initializePositions = true
  graphMock.methods.centerAt.mockClear()
  graphMock.methods.zoom.mockReset().mockReturnValue(6)
  graphMock.methods.zoomToFit.mockClear()
  graphMock.methods.d3ReheatSimulation.mockClear()
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 600, height: 440 } as DOMRect)
})
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('graph canvas interactions', () => {
  it('keeps a manual zoom made before the initial simulation settles', () => {
    render(<GraphCanvas {...props()} selectedId="" focusRequest={null} />)
    fireEvent.wheel(screen.getByRole('group', { name: /Graphe interactif/ }), { deltaY: -100 })
    act(() => latest().onEngineStop())
    expect(graphMock.methods.zoomToFit).not.toHaveBeenCalled()
  })

  it('restores dragged positions after remount without fixing new nodes or altering API data', () => {
    render(<GraphCanvas {...props()} />)
    const dragged = latest().graphData.nodes[0]!
    dragged.x = -500; dragged.y = 700
    act(() => latest().onNodeDragEnd(dragged))
    expect(localStorage.getItem(positionStorageKey('public'))).toContain('["a",-500,700]')
    cleanup()
    render(<GraphCanvas {...props()} />)
    expect(latest().graphData.nodes[0]).toMatchObject({ x: -500, y: 700, fx: -500, fy: 700 })
    expect(latest().graphData.nodes[1]?.fx).toBeUndefined()
    expect(Object.hasOwn(fixture.nodes[0]!, 'x')).toBe(false)
  })

  it('resets hidden and visible fixed nodes, reheats the engine, fits the graph and keeps keyboard focus', async () => {
    localStorage.setItem(positionStorageKey('public'), serializePositions(new Map([['a', { x: 100, y: 200 }], ['c', { x: 300, y: 400 }]])))
    localStorage.setItem(positionStorageKey('admin'), serializePositions(new Map([['a', { x: 900, y: 900 }]])))
    const input = props()
    const { rerender } = render(<GraphCanvas {...input} />)
    const hidden = latest().graphData.nodes[2]!
    const isolated = { nodes: fixture.nodes.slice(0, 2), edges: fixture.edges.slice(0, 1) }
    rerender(<GraphCanvas {...input} data={isolated} index={indexGraph(isolated)} isolated />)
    const user = userEvent.setup()
    screen.getByRole('button', { name: 'Réinitialiser la disposition' }).focus()
    await user.keyboard('{Enter}')
    expect(latest().graphData.nodes[0]?.fx).toBeUndefined()
    expect(hidden.fx).toBeUndefined()
    expect(localStorage.getItem(positionStorageKey('public'))).toBeNull()
    expect(localStorage.getItem(positionStorageKey('admin'))).not.toBeNull()
    expect(graphMock.methods.d3ReheatSimulation).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Ajuster à l’écran' }))
    expect(screen.getByText('Disposition réinitialisée.')).toBeTruthy()
    act(() => latest().onEngineStop())
    expect(graphMock.methods.zoomToFit).toHaveBeenCalledWith(450, 50)
  })

  it('does not write storage per frame and reports a denied write without losing the drag', () => {
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    render(<GraphCanvas {...props()} />)
    act(() => latest().onEngineTick())
    expect(write).not.toHaveBeenCalled()
    const node = latest().graphData.nodes[0]!
    node.x = 10; node.y = 20
    act(() => latest().onNodeDragEnd(node))
    expect(node.fx).toBe(10)
    expect(write).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/Stockage local indisponible/)).toBeTruthy()
  })

  it('draws readable label backgrounds with cached measurements and bounded screen font sizes', () => {
    render(<GraphCanvas {...props()} />)
    const context = { save: vi.fn(), restore: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(),
      measureText: vi.fn((text: string) => ({ width: text.length * 6 })) }
    latest().onRenderFramePost(context as unknown as CanvasRenderingContext2D, 8)
    expect(context.fillText).toHaveBeenCalledWith('a', expect.any(Number), expect.any(Number))
    expect(context.fillRect).toHaveBeenCalled()
    const measurements = context.measureText.mock.calls.length
    latest().onRenderFramePost(context as unknown as CanvasRenderingContext2D, 8)
    expect(context.measureText).toHaveBeenCalledTimes(measurements)
    expect(context.restore).toHaveBeenCalledTimes(2)
  })

  it('does not replay a completed focus request when filters or isolation change', () => {
    const input = props()
    const { rerender } = render(<GraphCanvas {...input} />)
    graphMock.methods.centerAt.mockClear()
    const isolated = { nodes: fixture.nodes.slice(0, 2), edges: fixture.edges.slice(0, 1) }
    rerender(<GraphCanvas {...input} data={isolated} index={indexGraph(isolated)} isolated />)
    rerender(<GraphCanvas {...input} />)
    expect(graphMock.methods.centerAt).not.toHaveBeenCalled()
    rerender(<GraphCanvas {...input} focusRequest={{ id: 'a', token: 2 }} />)
    expect(graphMock.methods.centerAt).toHaveBeenCalledTimes(1)
  })

  it('respects reduced motion for centering and zooming', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
    render(<GraphCanvas {...props()} />)
    expect(graphMock.methods.centerAt).toHaveBeenCalledWith(10, 20, 0)
    expect(graphMock.methods.zoom).toHaveBeenCalledWith(2.2, 0)
  })

  it('retains a pending focus through a data change and cancels it when selection clears', () => {
    graphMock.initializePositions = false
    const input = props()
    const { rerender } = render(<GraphCanvas {...input} />)
    expect(graphMock.methods.centerAt).not.toHaveBeenCalled()
    const isolated = { nodes: fixture.nodes.slice(0, 2), edges: fixture.edges.slice(0, 1) }
    rerender(<GraphCanvas {...input} data={isolated} index={indexGraph(isolated)} isolated />)
    const node = latest().graphData.nodes[0]!
    node.x = 123; node.y = 456
    act(() => latest().onEngineTick())
    expect(graphMock.methods.centerAt).toHaveBeenCalledWith(123, 456, 600)
    act(() => latest().onEngineTick())
    expect(graphMock.methods.centerAt).toHaveBeenCalledTimes(1)
    node.x = undefined; node.y = undefined
    rerender(<GraphCanvas {...input} focusRequest={{ id: 'a', token: 2 }} />)
    rerender(<GraphCanvas {...input} selectedId="" distances={new Map()} />)
    node.x = 789; node.y = 987
    act(() => latest().onEngineTick())
    expect(graphMock.methods.centerAt).toHaveBeenCalledTimes(1)
  })

  it('centers a selected node smoothly at a bounded zoom and recenters after drag', () => {
    const input = props()
    const { rerender } = render(<GraphCanvas {...input} />)
    expect(graphMock.methods.centerAt).toHaveBeenCalledWith(10, 20, 600)
    expect(graphMock.methods.zoom).toHaveBeenCalledWith(2.2, 600)
    const dragged = latest().graphData.nodes[0]!
    dragged.x = 500; dragged.y = 700
    act(() => latest().onNodeDragEnd(dragged))
    graphMock.methods.centerAt.mockClear()
    rerender(<GraphCanvas {...input} focusRequest={{ id: 'a', token: 2 }} />)
    expect(graphMock.methods.centerAt).toHaveBeenCalledWith(500, 700, 600)
    expect(dragged.fx).toBe(500)
    expect(dragged.fy).toBe(700)
    expect(Object.hasOwn(fixture.nodes[0]!, 'x')).toBe(false)
  })

  it('retains local dragged positions through isolation and does not refocus a cleared selection', () => {
    const input = props()
    const { rerender } = render(<GraphCanvas {...input} />)
    const dragged = latest().graphData.nodes[0]!
    dragged.x = 123; dragged.y = 456
    act(() => latest().onNodeDragEnd(dragged))
    const isolated = { nodes: fixture.nodes.slice(0, 2), edges: fixture.edges.slice(0, 1) }
    rerender(<GraphCanvas {...input} data={isolated} index={indexGraph(isolated)} isolated />)
    expect(latest().graphData.nodes[0]).toBe(dragged)
    graphMock.methods.centerAt.mockClear()
    rerender(<GraphCanvas {...input} selectedId="" distances={new Map()} />)
    act(() => latest().onEngineStop())
    expect(graphMock.methods.centerAt).not.toHaveBeenCalled()
    expect(graphMock.methods.zoomToFit).toHaveBeenCalledWith(450, 50)
    expect(latest().graphData.nodes[0]?.fx).toBe(123)
  })

  it('opens on two activations of the same node but never as a consequence of dragging', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    const input = props()
    render(<GraphCanvas {...input} selectedId="" focusRequest={null} />)
    const node = latest().graphData.nodes[0]!
    act(() => latest().onNodeClick(node))
    now.mockReturnValue(1_200)
    act(() => latest().onNodeClick(node))
    expect(input.onSelectNode).toHaveBeenCalledWith('a')
    expect(input.onOpenNode).toHaveBeenCalledTimes(1)
    now.mockReturnValue(2_000)
    act(() => latest().onNodeClick(node))
    now.mockReturnValue(2_100)
    act(() => latest().onNodeDragEnd(node))
    now.mockReturnValue(2_200)
    act(() => latest().onNodeClick(node))
    now.mockReturnValue(2_500)
    act(() => latest().onNodeClick(node))
    expect(input.onOpenNode).toHaveBeenCalledTimes(1)
  })

  it('temporarily highlights a hovered neighborhood then restores the selection', () => {
    render(<GraphCanvas {...props()} />)
    const area = screen.getByRole('group', { name: /Graphe interactif/ })
    fireEvent.pointerOver(area)
    const node = latest().graphData.nodes[2]!
    expect(latest().nodeColor(node)).toMatch(/30$/)
    act(() => latest().onNodeHover(node))
    expect(latest().nodeColor(node)).toBe('#8eafb9')
    expect(latest().linkWidth(fixture.edges[1]!)).toBe(1.35)
    expect(latest().linkWidth(fixture.edges[0]!)).toBe(.8)
    act(() => latest().onNodeHover(null))
    expect(latest().linkWidth(fixture.edges[0]!)).toBe(1.35)
    expect(latest().nodeColor(node)).toMatch(/30$/)
    act(() => latest().onNodeHover(node))
    fireEvent.pointerOut(area)
    expect(latest().nodeColor(node)).toMatch(/30$/)
    expect(document.querySelector('.graph-hover')).toBeNull()
    // The engine can still report objects at its previous pointer coordinates during a zoom.
    act(() => { latest().onNodeHover(node); latest().onLinkHover(fixture.edges[1]!) })
    expect(latest().nodeColor(node)).toMatch(/30$/)
    expect(document.querySelector('.graph-hover')).toBeNull()
    fireEvent.pointerOver(area)
    act(() => latest().onNodeHover(node))
    expect(latest().nodeColor(node)).toBe('#8eafb9')
  })

  it('interrupts double activation after a relation click, a background click or a camera movement', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    const input = props()
    render(<GraphCanvas {...input} selectedId="" focusRequest={null} />)
    const node = latest().graphData.nodes[0]!
    for (const interrupt of [() => latest().onLinkClick(fixture.edges[0]!),
      () => latest().onBackgroundClick(), () => latest().onZoom()]) {
      act(() => latest().onNodeClick(node))
      act(interrupt)
      now.mockReturnValue(Date.now() + 100)
      act(() => latest().onNodeClick(node))
      now.mockReturnValue(Date.now() + 1_000)
    }
    expect(input.onOpenNode).not.toHaveBeenCalled()
    expect(input.onSelectNode).toHaveBeenCalledTimes(6)
  })

  it('uses dashed distant rings and a search outline while preserving direction and symmetry', () => {
    render(<GraphCanvas {...props()} depth={2} distances={neighborhoodDistances(index, 'a', 2)} searchMatches={new Set(['c'])} />)
    const context = { save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), arc: vi.fn(),
      stroke: vi.fn(), setLineDash: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn() }
    latest().nodeCanvasObject(latest().graphData.nodes[2]!, context as unknown as CanvasRenderingContext2D, 1)
    expect(context.setLineDash).toHaveBeenCalledWith([3, 3])
    expect(context.strokeRect).toHaveBeenCalledTimes(1)
    expect(context.restore).toHaveBeenCalledTimes(1)
    expect(latest().linkDirectionalArrowLength(fixture.edges[0]!)).toBe(4)
    expect(latest().linkDirectionalArrowLength(fixture.edges[1]!)).toBe(0)
  })

  it('keeps references subtle globally and restores direction when their neighborhood is highlighted', () => {
    const reference = { ...fixture.edges[0]!, origin: 'OBSIDIAN' as const }
    const data = { ...fixture, edges: [reference] }, input = props()
    render(<GraphCanvas {...input} data={data} index={indexGraph(data)} selectedId="" focusRequest={null} distances={new Map()} />)
    fireEvent.pointerOver(screen.getByRole('group', { name: /Graphe interactif/ }))
    expect(latest().linkDirectionalArrowLength(reference)).toBe(0)
    expect(latest().linkWidth(reference)).toBe(.55)
    act(() => latest().onNodeHover(latest().graphData.nodes[0]!))
    expect(latest().linkDirectionalArrowLength(reference)).toBe(4)
    act(() => latest().onNodeHover(null))
    expect(latest().linkDirectionalArrowLength(reference)).toBe(0)
  })

  it('allows a fresh layout even when no node was manually fixed', async () => {
    render(<GraphCanvas {...props()} />)
    latest().graphData.nodes[0]!.x = 1_000_000
    await userEvent.setup().click(screen.getByRole('button', { name: 'Réinitialiser la disposition' }))
    expect(Math.abs(latest().graphData.nodes[0]!.x!)).toBeLessThan(100)
    expect(graphMock.methods.d3ReheatSimulation).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Ajuster à l’écran' }))
  })
})
