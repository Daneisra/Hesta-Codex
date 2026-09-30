import { useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import type { ForceGraphMethods, NodeObject } from 'react-force-graph-2d'
import type { AdminGraphResponse, GraphEdge, GraphNode, GraphResponse } from '@hesta-codex/shared'
import './Graph.css'

type Node = GraphNode & NodeObject
type Data = GraphResponse | AdminGraphResponse
type Load = { phase: 'loading' } | { phase: 'error'; status: number | null } | { phase: 'ready'; data: Data }

const groups = [
  { label: 'Lieux', kinds: ['PLACE'], color: '#75b7d7' },
  { label: 'Personnes et peuples', kinds: ['PERSON', 'FAMILY', 'SPECIES', 'CREATURE'], color: '#b8a3df' },
  { label: 'Collectifs et croyances', kinds: ['ORGANIZATION', 'RELIGION', 'DEITY'], color: '#d8bc85' },
  { label: 'Récits et objets', kinds: ['ARTIFACT', 'EVENT', 'QUEST', 'SESSION'], color: '#d596a7' },
  { label: 'Idées et autres', kinds: ['CONCEPT', 'OTHER'], color: '#9fbed1' },
] as const
const colorFor = (kind: string) => groups.find((group) => (group.kinds as readonly string[]).includes(kind))?.color ?? '#9fbed1'
const typeLabel = (kind: string, placeKind: string | null) => kind === 'PLACE' && placeKind
  ? `Lieu · ${placeKind}` : kind

export function visibleConnections(data: Data, id: string) {
  const names = new Map(data.nodes.map((node) => [node.id, node.title]))
  return data.edges.filter((edge) => edge.source === id || edge.target === id).map((edge) => {
    const outgoing = edge.source === id
    const otherId = outgoing ? edge.target : edge.source
    return { ...edge, otherId, otherTitle: names.get(otherId) ?? '',
      displayLabel: outgoing || edge.symmetric ? edge.label : edge.inverseLabel ?? edge.label }
  })
}

export function GraphPage({ endpoint, admin = false, onOpenNode }: {
  endpoint: '/api/v1/graph' | '/api/admin/graph'
  admin?: boolean
  onOpenNode: (slug: string) => void
}) {
  const [load, setLoad] = useState<Load>({ phase: 'loading' })
  const [retry, setRetry] = useState(0)
  const [selectedId, setSelectedId] = useState<string>('')
  const [size, setSize] = useState({ width: 0, height: 0 })
  const areaRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<ForceGraphMethods<Node, GraphEdge> | undefined>(undefined)
  const fitted = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    setLoad({ phase: 'loading' })
    fetch(endpoint, { signal: controller.signal, credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) throw { status: response.status }
        return response.json() as Promise<Data>
      })
      .then((data) => { if (!controller.signal.aborted) { fitted.current = false; setSelectedId(''); setLoad({ phase: 'ready', data }) } })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoad({ phase: 'error', status: typeof error === 'object' && error !== null &&
          'status' in error && typeof error.status === 'number' ? error.status : null })
      })
    return () => controller.abort()
  }, [endpoint, retry])

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
  }, [load.phase])

  const data = load.phase === 'ready' ? load.data : null
  const graphData = useMemo(() => data ? { nodes: data.nodes.map((node) => ({ ...node })),
    links: data.edges.map((edge) => ({ ...edge })) } : { nodes: [], links: [] }, [data])
  const selected = data?.nodes.find((node) => node.id === selectedId)
  const connections = selected && data ? visibleConnections(data, selected.id) : []
  const byId = new Map(data?.nodes.map((node) => [node.id, node]) ?? [])
  const focusNode = (id: string) => {
    setSelectedId(id)
    const node = graphData.nodes.find((candidate) => candidate.id === id) as Node | undefined
    if (node && Number.isFinite(node.x) && Number.isFinite(node.y)) graphRef.current?.centerAt(node.x, node.y, 450)
  }

  return <section className="graph-page" aria-label={admin ? 'Graphe éditorial' : 'Graphe public'}>
    <div className="graph-heading"><div><p className="section-eyebrow">Explorer les connexions</p>
      <h1>{admin ? 'Graphe éditorial' : 'Graphe du Codex'}</h1>
      <p>{admin ? 'Toutes les fiches et relations accessibles à l’administration.' : 'Fiches et relations publiées, visibles de tous.'}</p></div>
      {data && <p className="graph-count">{data.nodes.length} fiches · {data.edges.length} relations</p>}</div>
    {load.phase === 'loading' && <p className="graph-message" role="status">Chargement du graphe…</p>}
    {load.phase === 'error' && <div className="graph-message" role="alert"><p>{load.status === 401 ? 'Session expirée. Reconnectez-vous pour voir le graphe éditorial.'
      : load.status === 403 ? 'Accès au graphe éditorial refusé.' : 'Impossible de charger le graphe.'}</p>
      <button type="button" onClick={() => setRetry((value) => value + 1)}>Réessayer</button></div>}
    {data && data.nodes.length === 0 && <p className="graph-message">{admin ? 'Aucune fiche à représenter.'
      : 'Le graphe attend ses premières fiches publiées.'}</p>}
    {data && data.nodes.length > 0 && <div className="graph-layout">
      <div className="graph-main"><div className="graph-controls" aria-label="Contrôles du graphe">
        <button type="button" onClick={() => graphRef.current?.zoom(Math.min(8, graphRef.current.zoom() * 1.3), 300)}>Zoom +</button>
        <button type="button" onClick={() => graphRef.current?.zoom(Math.max(.15, graphRef.current.zoom() / 1.3), 300)}>Zoom −</button>
        <button type="button" onClick={() => graphRef.current?.centerAt(0, 0, 400)}>Recentrer</button>
        <button type="button" onClick={() => graphRef.current?.zoomToFit(400, 48)}>Ajuster à l’écran</button>
      </div>
        <div className="graph-canvas" ref={areaRef} role="img" aria-label="Graphe interactif. Utilisez la liste de fiches pour une navigation au clavier.">
          {size.width > 0 && <ForceGraph2D ref={graphRef} width={size.width} height={size.height}
            graphData={graphData} backgroundColor="#0c1525" nodeRelSize={5}
            nodeColor={(node) => colorFor(node.kind as string)}
            // The library treats tooltip labels as HTML. Lore titles/labels stay in Canvas or React text.
            nodeLabel={() => ''} linkLabel={() => ''}
            linkColor={() => 'rgba(177, 195, 225, .4)'} linkWidth={1.1}
            linkDirectionalArrowLength={(link) => link.symmetric ? 0 : 5}
            linkDirectionalArrowColor={() => '#d4bb8e'}
            onNodeClick={(node) => focusNode(String(node.id))}
            onNodeDragEnd={(node) => { node.fx = node.x; node.fy = node.y }}
            onEngineStop={() => { if (!fitted.current) { fitted.current = true; graphRef.current?.zoomToFit(450, 50) } }}
            nodeCanvasObjectMode={() => 'after'}
            nodeCanvasObject={(node, context, scale) => {
              if (node.id !== selectedId && data.nodes.length > 90 && scale < 1.4) return
              const x = node.x ?? 0, y = node.y ?? 0
              context.font = `${Math.max(8, 11 / scale)}px sans-serif`
              context.fillStyle = node.id === selectedId ? '#f6d99b' : '#e3eaf7'
              context.textAlign = 'center'
              context.fillText(String(node.title), x, y + 13 / scale)
            }} />}
        </div>
        <p className="graph-hint">Molette ou boutons pour zoomer · glisser le fond pour déplacer · glisser un nœud pour le fixer.</p>
      </div>
      <aside className="graph-side" aria-label="Navigation du graphe">
        <label>Choisir une fiche<select value={selectedId} onChange={(event) => focusNode(event.target.value)}>
          <option value="">Sélectionner…</option>
          {data.nodes.map((node) => <option key={node.id} value={node.id}>{node.title} · {node.slug}</option>)}
        </select></label>
        {selected ? <div className="graph-selected"><h2>{selected.title}</h2>
          <p>{typeLabel(selected.kind, selected.placeKind)} · /{selected.slug}</p>
          {'status' in selected && 'visibility' in selected &&
            <p>Statut : {String(selected.status)} · Visibilité : {String(selected.visibility)}</p>}
          <p>{connections.length} connexion{connections.length > 1 ? 's' : ''} visible{connections.length > 1 ? 's' : ''}</p>
          {connections.length > 0 && <ul>{connections.slice(0, 8).map((edge) => <li key={edge.id}>
            <button type="button" onClick={() => focusNode(edge.otherId)}>{edge.displayLabel} {edge.otherTitle}</button>
          </li>)}</ul>}
          {connections.length > 8 && <p>8 connexions affichées sur {connections.length}.</p>}
          <button className="graph-open" type="button" onClick={() => onOpenNode(selected.slug)}>Ouvrir la fiche</button>
        </div> : <p className="graph-hint">Sélectionnez un nœud ou choisissez une fiche dans la liste.</p>}
        <div className="graph-legend"><h2>Légende</h2><ul>{groups.map((group) => <li key={group.label}>
          <span className="graph-swatch" style={{ backgroundColor: group.color }} />{group.label}</li>)}</ul></div>
        {selected && connections.length > 0 && <span className="sr-only">{connections.map((edge) =>
          `${edge.displayLabel} ${byId.get(edge.otherId)?.title ?? ''}`).join(', ')}</span>}
      </aside>
    </div>}
  </section>
}
