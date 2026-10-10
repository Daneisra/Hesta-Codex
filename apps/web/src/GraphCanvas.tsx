import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import type { ForceGraphMethods, NodeObject } from 'react-force-graph-2d'
import type { GraphEdge, GraphNode, GraphResponse } from '@hesta-codex/shared'
import { groupFor, neighborhoodDistances, nodeRadius, type GraphIndex, type NeighborhoodDepth } from './graph-model'
import { layoutGraphLabels, shortLabel, type LabelCandidate } from './graph-labels'
import { clearPositions, loadPositions, savePositions, validPosition, type GraphScope } from './graph-positions'

type Node = GraphNode & NodeObject
type FocusRequest = { id: string; token: number } | null

function motionDuration(duration: number): number {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : duration
}

export const GraphCanvas = memo(function GraphCanvas({ data, selectedId, selectedEdgeId, isolated, focusRequest, scope = 'public',
  index, totalIndex, distances, depth, onDepthChange, searchMatches,
  onSelectNode, onOpenNode, onSelectEdge, onClearSelection, onToggleIsolation }: {
  data: GraphResponse
  scope?: GraphScope
  index: GraphIndex
  totalIndex: GraphIndex
  distances: ReadonlyMap<string, number>
  depth: NeighborhoodDepth
  onDepthChange: (depth: NeighborhoodDepth) => void
  searchMatches: ReadonlySet<string>
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
  const fitButtonRef = useRef<HTMLButtonElement>(null)
  const resetFocus = useRef(false)
  const graphRef = useRef<ForceGraphMethods<Node, GraphEdge> | undefined>(undefined)
  const pendingFocus = useRef<string | null>(null)
  const issuedFocusRequest = useRef<FocusRequest>(null)
  const fitted = useRef(false)
  const lastDrag = useRef(0)
  const lastClick = useRef<{ id: string; time: number } | null>(null)
  const layoutNodes = useRef(new Map<string, Node>())
  const [initialPositions] = useState(() => loadPositions(scope, new Set(totalIndex.nodes.keys())))
  const savedPositions = useRef(initialPositions.positions)
  const [fixedCount, setFixedCount] = useState(initialPositions.positions.size)
  const [layoutMessage, setLayoutMessage] = useState(initialPositions.available ? '' : 'Stockage local indisponible : disposition conservée pour cette vue uniquement.')
  const fitAfterReset = useRef(false)
  const textWidths = useRef(new Map<string, number>())
  const [size, setSize] = useState({ width: 0, height: 0 })
  const canvasReady = size.width > 0
  const [hoveredNodeId, setHoveredNodeId] = useState('')
  const [hoveredEdgeId, setHoveredEdgeId] = useState('')
  // ForceGraph mutates coordinates and link endpoints. Keep the API response untouched.
  const graphData = useMemo(() => ({ nodes: data.nodes.map((node) => {
    // Keep session-local coordinates (including dragged positions) through filters and isolation.
    const saved = savedPositions.current.get(node.id)
    const positioned = layoutNodes.current.get(node.id) ?? { ...node,
      ...(saved ? { x: saved.x, y: saved.y, fx: saved.x, fy: saved.y } : {}) }
    Object.assign(positioned, node)
    layoutNodes.current.set(node.id, positioned)
    return positioned
  }), links: data.edges.map((edge) => ({ ...edge })) }), [data])
  const positionedNodes = useMemo(() => new Map(graphData.nodes.map((node) => [node.id, node])), [graphData.nodes])
  const labelText = useMemo(() => new Map(data.nodes.map(node => [node.id, shortLabel(node.title)])), [data.nodes])
  const hoverNode = index.nodes.get(hoveredNodeId)
  const hoverEdge = index.edges.get(hoveredEdgeId)
  const activeEdgeId = hoverEdge?.id || selectedEdgeId
  const highlightedDistances = useMemo(() => hoverNode
    ? neighborhoodDistances(index, hoverNode.id, 1) : distances, [hoverNode, index, distances])
  const highlighted = useMemo(() => {
    const ids = new Set(highlightedDistances.keys())
    const edges = new Set<string>()
    const hoverEdges = hoverNode ? new Set(index.incidentEdges.get(hoverNode.id)?.map((edge) => edge.id)) : null
    for (const edge of data.edges) {
      if ((hoverEdges ? hoverEdges.has(edge.id) : highlightedDistances.has(edge.source) && highlightedDistances.has(edge.target)) ||
        edge.id === activeEdgeId) {
        ids.add(edge.source); ids.add(edge.target); edges.add(edge.id)
      }
    }
    return { ids, edges }
  }, [data.edges, highlightedDistances, activeEdgeId, hoverNode, index])
  const hasHighlight = highlighted.ids.size > 0
  const labelCandidates = useMemo(() => graphData.nodes.map(node => {
    const id = String(node.id)
    return { node, text: labelText.get(id) ?? '', radius: nodeRadius(totalIndex.incidentEdges.get(id)?.length ?? 0),
      priority: id === selectedId ? 0 : id === hoveredNodeId ? 1 : distances.get(id) === 1 ||
        highlightedDistances.get(id) === 1 ? 2 : searchMatches.has(id) ? 3 : 4 } satisfies LabelCandidate
  }).sort((a, b) => a.priority - b.priority ||
    (totalIndex.incidentEdges.get(String(b.node.id))?.length ?? 0) - (totalIndex.incidentEdges.get(String(a.node.id))?.length ?? 0) ||
    String(a.node.id).localeCompare(String(b.node.id))),
  [graphData.nodes, labelText, totalIndex, selectedId, hoveredNodeId, distances, highlightedDistances, searchMatches])

  useEffect(() => { textWidths.current.clear() }, [labelText])
  useEffect(() => {
    if (resetFocus.current && fixedCount === 0) { resetFocus.current = false; fitButtonRef.current?.focus({ preventScroll: true }) }
  }, [fixedCount])

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
    const node = positionedNodes.get(id)
    if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y) || !graphRef.current) return false
    const duration = motionDuration(600)
    graphRef.current.centerAt(node.x, node.y, duration)
    graphRef.current.zoom(Math.min(2.2, Math.max(1.2, graphRef.current.zoom())), duration)
    pendingFocus.current = null
    return true
  }, [positionedNodes])

  useEffect(() => {
    if (!canvasReady || !focusRequest || focusRequest.id !== selectedId || !index.nodes.has(focusRequest.id)) {
      pendingFocus.current = null
      issuedFocusRequest.current = null
      return
    }
    // A completed request must not override later manual camera movements on a data change.
    if (issuedFocusRequest.current === focusRequest) return
    issuedFocusRequest.current = focusRequest
    pendingFocus.current = focusRequest.id
    focus(focusRequest.id)
  }, [focusRequest, selectedId, index, focus, canvasReady])

  useEffect(() => { fitted.current = false }, [graphData])

  const radiusFor = useCallback((id: string) => nodeRadius(totalIndex.incidentEdges.get(id)?.length ?? 0), [totalIndex])
  const resetLayout = useCallback(() => {
    const cleared = clearPositions(scope)
    savedPositions.current.clear()
    for (const node of layoutNodes.current.values()) { node.fx = undefined; node.fy = undefined; node.vx = 0; node.vy = 0 }
    setFixedCount(0)
    resetFocus.current = true
    setLayoutMessage(cleared ? 'Disposition réinitialisée.' : 'Disposition réinitialisée pour cette vue. Le stockage local est indisponible.')
    lastClick.current = null
    pendingFocus.current = null
    fitAfterReset.current = true
    graphRef.current?.d3ReheatSimulation()
  }, [scope])
  const relationText = hoverEdge ? `${index.nodes.get(hoverEdge.source)?.title ?? ''} ${hoverEdge.symmetric ? '↔' : '→'} ` +
    `${hoverEdge.label} ${hoverEdge.symmetric ? '↔' : '→'} ${index.nodes.get(hoverEdge.target)?.title ?? ''}` : ''

  return <div className="graph-main">
    <div className="graph-controls" aria-label="Contrôles du graphe">
      <button type="button" onClick={() => graphRef.current?.zoom(Math.min(8, graphRef.current.zoom() * 1.3), motionDuration(300))}>Zoom +</button>
      <button type="button" onClick={() => graphRef.current?.zoom(Math.max(.15, graphRef.current.zoom() / 1.3), motionDuration(300))}>Zoom −</button>
      <button type="button" onClick={() => graphRef.current?.centerAt(0, 0, motionDuration(400))}>Recentrer</button>
      <button ref={fitButtonRef} type="button" onClick={() => graphRef.current?.zoomToFit(motionDuration(400), 48)}>Ajuster à l’écran</button>
      <label className="graph-depth">Profondeur du voisinage<select value={depth} disabled={!selectedId}
        onChange={(event) => { const value = Number(event.target.value)
          if (value === 1 || value === 2 || value === 3) onDepthChange(value) }}>
        <option value="1">1 · Connexions directes</option><option value="2">2 · Deux {scope === 'admin' ? 'connexions' : 'relations'}</option>
        <option value="3">3 · Trois {scope === 'admin' ? 'connexions' : 'relations'}</option>
      </select></label>
      <button type="button" disabled={!selectedId} aria-pressed={isolated} onClick={onToggleIsolation}>
        {isolated ? 'Afficher tout le graphe' : depth === 1 ? 'Connexions directes' : 'Isoler le voisinage'}
      </button>
      <button type="button" disabled={!selectedId && !selectedEdgeId} onClick={() => {
        onClearSelection(); graphRef.current?.zoomToFit(motionDuration(400), 48)
      }}>Vue complète</button>
      <button type="button" disabled={!fixedCount || !canvasReady} onClick={resetLayout}
        title="Effacer les positions fixées de ce graphe dans ce navigateur et relancer la disposition automatique">
        Réinitialiser la disposition
      </button>
    </div>
    <div className="graph-canvas" ref={areaRef} role="group"
      aria-label="Graphe interactif. La recherche et la liste de fiches permettent la navigation au clavier.">
      {size.width > 0 && <ForceGraph2D ref={graphRef} width={size.width} height={size.height}
        graphData={graphData} backgroundColor="#0c1525" nodeRelSize={4}
        nodeVal={(node) => (radiusFor(String(node.id)) / 4) ** 2} minZoom={.15} maxZoom={8}
        showPointerCursor
        nodeColor={(node) => {
          const id = String(node.id)
          const color = groupFor(node.kind).color
          return hasHighlight && !highlighted.ids.has(id) ? `${color}55`
            : (highlightedDistances.get(id) ?? 0) > 1 ? `${color}bb` : color
        }}
        // The library renders tooltip labels as HTML; all lore text stays in Canvas or React text.
        nodeLabel={() => ''} linkLabel={() => ''}
        linkColor={(edge) => hasHighlight && !highlighted.edges.has(String(edge.id))
          ? 'rgba(135, 150, 178, .16)' : edge.origin === 'OBSIDIAN' ? '#79bddb' : 'rgba(225, 204, 157, .75)'}
        linkLineDash={(edge) => edge.origin === 'OBSIDIAN' ? [5, 3] : null}
        // Separate a textual mention from an editorial relation joining the same fiches.
        linkCurvature={(edge) => edge.origin === 'OBSIDIAN' ? 0.15 : 0}
        linkWidth={(edge) => highlighted.edges.has(String(edge.id)) ? 2.7 : 1.1}
        linkDirectionalArrowLength={(edge) => edge.symmetric ? 0 : 5}
        linkDirectionalArrowColor={(edge) => edge.origin === 'OBSIDIAN' ? '#79bddb' : '#d4bb8e'}
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
        onLinkClick={(edge) => { lastClick.current = null; onSelectEdge(String(edge.id)) }}
        onBackgroundClick={() => { lastClick.current = null }}
        onZoom={() => { lastClick.current = null }}
        onNodeDragEnd={(node) => {
          lastDrag.current = Date.now(); lastClick.current = null
          if (typeof node.x !== 'number' || typeof node.y !== 'number' || !validPosition({ x: node.x, y: node.y })) return
          node.fx = node.x; node.fy = node.y
          savedPositions.current.set(String(node.id), { x: node.x, y: node.y })
          setFixedCount(savedPositions.current.size)
          const saved = savePositions(scope, savedPositions.current)
          setLayoutMessage(saved ? 'Position sauvegardée dans ce navigateur.' : 'Stockage local indisponible : disposition conservée pour cette vue uniquement.')
        }}
        onEngineTick={() => { if (pendingFocus.current) focus(pendingFocus.current) }}
        onEngineStop={() => {
          if (pendingFocus.current) focus(pendingFocus.current)
          if (fitAfterReset.current || !fitted.current && !pendingFocus.current && !selectedId) {
            fitAfterReset.current = false
            fitted.current = true; graphRef.current?.zoomToFit(motionDuration(450), 50)
          }
        }}
        nodeCanvasObjectMode={() => 'after'}
        nodeCanvasObject={(node, context, scale) => {
          const id = String(node.id)
          const active = id === selectedId || id === hoveredNodeId
          const distance = highlightedDistances.get(id)
          const radius = radiusFor(id)
          context.save()
          if (active || distance !== undefined) {
            context.beginPath()
            context.arc(node.x ?? 0, node.y ?? 0, radius + (active ? 4 : 2), 0, 2 * Math.PI)
            context.strokeStyle = active ? '#f6d99b' : '#b8c6df'
            context.lineWidth = (active ? 2 : 1) / scale
            if (!active && distance !== undefined && distance > 1) context.setLineDash([3 / scale, 3 / scale])
            context.stroke()
            context.setLineDash([])
          }
          if (searchMatches.has(id)) {
            const side = radius + 6
            context.strokeStyle = '#f6d99b'; context.lineWidth = 1.5 / scale
            context.strokeRect((node.x ?? 0) - side, (node.y ?? 0) - side, side * 2, side * 2)
          }
          context.restore()
        }}
        onRenderFramePost={(context, scale) => {
          context.save()
          const topLeft = graphRef.current?.screen2GraphCoords?.(0, 0)
          const bottomRight = graphRef.current?.screen2GraphCoords?.(size.width, size.height)
          const labels = layoutGraphLabels(labelCandidates, scale, (text, fontSize) => {
            const key = `${fontSize}:${text}`
            let width = textWidths.current.get(key)
            if (width === undefined) {
              context.font = `${fontSize}px sans-serif`
              width = context.measureText(text).width
              textWidths.current.set(key, width)
            }
            return width
          }, topLeft && bottomRight ? { left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y } : undefined)
          context.textAlign = 'center'; context.textBaseline = 'middle'
          for (const [id, label] of labels) {
            context.fillStyle = label.important ? 'rgba(12, 21, 37, .94)' : 'rgba(12, 21, 37, .8)'
            context.fillRect(label.x, label.y, label.width, label.height)
            context.font = `${label.fontSize}px sans-serif`
            context.fillStyle = hasHighlight && !highlighted.ids.has(id) && id !== selectedId ? '#9dacbf' : '#e3eaf7'
            context.fillText(label.text, label.x + label.width / 2, label.y + label.height / 2)
          }
          context.restore()
        }} />}
      {(hoverEdge || hoverNode) && <p className="graph-hover" role="status">
        {hoverEdge ? relationText : hoverNode?.title}
      </p>}
    </div>
    {layoutMessage && <p className="graph-feedback" role="status">{layoutMessage}</p>}
    {selectedId && <p className="graph-neighborhood-key">
      <span>◎ Fiche sélectionnée</span><span>○ Voisins directs</span><span>◌ Voisins à 2–3 {scope === 'admin' ? 'connexions' : 'relations'}</span>
    </p>}
    <p className="graph-hint">Molette ou boutons pour zoomer · glisser le fond pour déplacer · glisser un nœud pour le fixer · double clic pour ouvrir.</p>
  </div>
})
