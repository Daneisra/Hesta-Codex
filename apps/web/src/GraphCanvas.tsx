import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import type { ForceGraphMethods, NodeObject } from 'react-force-graph-2d'
import type { GraphEdge, GraphNode, GraphResponse } from '@hesta-codex/shared'
import { groupFor } from './graph-model'

type Node = GraphNode & NodeObject
type FocusRequest = { id: string; token: number } | null

export function GraphCanvas({ data, selectedId, selectedEdgeId, isolated, focusRequest,
  onSelectNode, onOpenNode, onSelectEdge, onClearSelection, onToggleIsolation }: {
  data: GraphResponse
  selectedId: string
  selectedEdgeId: string
  isolated: boolean
  focusRequest: FocusRequest
  onSelectNode: (id: string) => void
  onOpenNode: (slug: string) => void
  onSelectEdge: (id: string) => void
  onClearSelection: () => void
  onToggleIsolation: () => void
}) {
  const areaRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<ForceGraphMethods<Node, GraphEdge> | undefined>(undefined)
  const pendingFocus = useRef<string | null>(null)
  const fitted = useRef(false)
  const lastDrag = useRef(0)
  const lastClick = useRef<{ id: string; time: number } | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [hoveredNodeId, setHoveredNodeId] = useState('')
  const [hoveredEdgeId, setHoveredEdgeId] = useState('')
  // ForceGraph mutates coordinates and link endpoints. Keep the API response untouched.
  const graphData = useMemo(() => ({ nodes: data.nodes.map((node) => ({ ...node })),
    links: data.edges.map((edge) => ({ ...edge })) }), [data])
  const byId = useMemo(() => new Map(data.nodes.map((node) => [node.id, node])), [data.nodes])
  const edgeById = useMemo(() => new Map(data.edges.map((edge) => [edge.id, edge])), [data.edges])
  const activeNodeId = selectedId || hoveredNodeId
  const activeEdgeId = selectedEdgeId || hoveredEdgeId
  const highlighted = useMemo(() => {
    const ids = new Set<string>()
    const edges = new Set<string>()
    if (activeNodeId) ids.add(activeNodeId)
    for (const edge of data.edges) {
      if (edge.source === activeNodeId || edge.target === activeNodeId || edge.id === activeEdgeId) {
        ids.add(edge.source); ids.add(edge.target); edges.add(edge.id)
      }
    }
    return { ids, edges }
  }, [data.edges, activeNodeId, activeEdgeId])
  const hasHighlight = Boolean(activeNodeId || activeEdgeId)

  useEffect(() => {
    const area = areaRef.current
    if (!area) return
    const measure = () => setSize({ width: Math.max(0, Math.floor(area.getBoundingClientRect().width)),
      height: Math.max(320, Math.floor(area.getBoundingClientRect().height)) })
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(area)
    return () => observer.disconnect()
  }, [])

  const focus = useCallback((id: string) => {
    const node = graphData.nodes.find((candidate) => candidate.id === id) as Node | undefined
    if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y) || !graphRef.current) return false
    graphRef.current.centerAt(node.x, node.y, 450)
    graphRef.current.zoom(Math.max(1.7, graphRef.current.zoom()), 450)
    pendingFocus.current = null
    return true
  }, [graphData.nodes])

  useEffect(() => {
    if (!focusRequest || !data.nodes.some((node) => node.id === focusRequest.id)) return
    pendingFocus.current = focusRequest.id
    focus(focusRequest.id)
  }, [focusRequest, data.nodes, focus])

  useEffect(() => { fitted.current = false }, [graphData])

  const hoverEdge = edgeById.get(hoveredEdgeId)
  const hoverNode = byId.get(hoveredNodeId)
  const relationText = hoverEdge ? `${byId.get(hoverEdge.source)?.title ?? ''} ${hoverEdge.symmetric ? '↔' : '→'} ` +
    `${hoverEdge.label} ${hoverEdge.symmetric ? '↔' : '→'} ${byId.get(hoverEdge.target)?.title ?? ''}` : ''

  return <div className="graph-main">
    <div className="graph-controls" aria-label="Contrôles du graphe">
      <button type="button" onClick={() => graphRef.current?.zoom(Math.min(8, graphRef.current.zoom() * 1.3), 300)}>Zoom +</button>
      <button type="button" onClick={() => graphRef.current?.zoom(Math.max(.15, graphRef.current.zoom() / 1.3), 300)}>Zoom −</button>
      <button type="button" onClick={() => graphRef.current?.centerAt(0, 0, 400)}>Recentrer</button>
      <button type="button" onClick={() => graphRef.current?.zoomToFit(400, 48)}>Ajuster à l’écran</button>
      <button type="button" disabled={!selectedId} aria-pressed={isolated} onClick={onToggleIsolation}>
        {isolated ? 'Afficher tout le graphe' : 'Connexions directes'}
      </button>
      <button type="button" disabled={!selectedId && !selectedEdgeId} onClick={() => {
        onClearSelection(); graphRef.current?.zoomToFit(400, 48)
      }}>Vue complète</button>
    </div>
    <div className="graph-canvas" ref={areaRef} role="img"
      aria-label="Graphe interactif. La recherche et la liste de fiches permettent la navigation au clavier.">
      {size.width > 0 && <ForceGraph2D ref={graphRef} width={size.width} height={size.height}
        graphData={graphData} backgroundColor="#0c1525" nodeRelSize={5} minZoom={.15} maxZoom={8}
        showPointerCursor
        nodeColor={(node) => hasHighlight && !highlighted.ids.has(String(node.id))
          ? '#42516a' : groupFor(node.kind).color}
        // The library renders tooltip labels as HTML; all lore text stays in Canvas or React text.
        nodeLabel={() => ''} linkLabel={() => ''}
        linkColor={(edge) => hasHighlight && !highlighted.edges.has(String(edge.id))
          ? 'rgba(135, 150, 178, .16)' : 'rgba(225, 204, 157, .75)'}
        linkWidth={(edge) => highlighted.edges.has(String(edge.id)) ? 2.7 : 1.1}
        linkDirectionalArrowLength={(edge) => edge.symmetric ? 0 : 5}
        linkDirectionalArrowColor={() => '#d4bb8e'}
        onNodeHover={(node) => { setHoveredNodeId(node ? String(node.id) : '') }}
        onLinkHover={(edge) => { setHoveredEdgeId(edge ? String(edge.id) : '') }}
        onNodeClick={(node) => {
          const now = Date.now()
          if (now - lastDrag.current < 300) return
          const id = String(node.id)
          if (lastClick.current?.id === id && now - lastClick.current.time <= 350) {
            lastClick.current = null
            onOpenNode(node.slug)
          } else {
            lastClick.current = { id, time: now }
            onSelectNode(id)
          }
        }}
        onLinkClick={(edge) => onSelectEdge(String(edge.id))}
        onNodeDragEnd={(node) => { lastDrag.current = Date.now(); lastClick.current = null; node.fx = node.x; node.fy = node.y }}
        onEngineTick={() => { if (pendingFocus.current) focus(pendingFocus.current) }}
        onEngineStop={() => {
          if (pendingFocus.current) focus(pendingFocus.current)
          if (!fitted.current && !pendingFocus.current && !selectedId) {
            fitted.current = true; graphRef.current?.zoomToFit(450, 50)
          }
        }}
        nodeCanvasObjectMode={() => 'after'}
        nodeCanvasObject={(node, context, scale) => {
          const id = String(node.id)
          const active = id === selectedId || id === hoveredNodeId
          if (active) {
            context.beginPath()
            context.arc(node.x ?? 0, node.y ?? 0, 9, 0, 2 * Math.PI)
            context.strokeStyle = '#f6d99b'
            context.lineWidth = 2 / scale
            context.stroke()
          }
          if (!active && data.nodes.length > 90 && scale < 1.4) return
          context.font = `${Math.max(8, 11 / scale)}px sans-serif`
          context.fillStyle = hasHighlight && !highlighted.ids.has(id) ? '#8592a8' : '#e3eaf7'
          context.textAlign = 'center'
          context.fillText(String(node.title), node.x ?? 0, (node.y ?? 0) + 13 / scale)
        }} />}
      {(hoverEdge || hoverNode) && <p className="graph-hover" role="status">
        {hoverEdge ? relationText : hoverNode?.title}
      </p>}
    </div>
    <p className="graph-hint">Molette ou boutons pour zoomer · glisser le fond pour déplacer · glisser un nœud pour le fixer · double clic pour ouvrir.</p>
  </div>
}
