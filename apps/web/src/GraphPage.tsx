import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AdminGraphResponse, GraphResponse } from '@hesta-codex/shared'
import { GraphCanvas } from './GraphCanvas'
import { GraphDetails } from './GraphDetails'
import { GraphFiltersPanel } from './GraphFilters'
import { emptyFilters, filterGraph, graphGroups, searchGraph, type GraphData, type GraphFilters } from './graph-model'
import './Graph.css'

export { visibleConnections } from './graph-model'

type Load = { phase: 'loading' } | { phase: 'error'; status: number | null } | { phase: 'ready'; data: GraphData }
const allGroups = () => new Set<string>(graphGroups.map((group) => group.id))

function selectedSlugFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get('fiche')
}

function writeSelectedSlug(slug: string | null, replace = false) {
  const url = new URL(window.location.href)
  if (slug) url.searchParams.set('fiche', slug)
  else url.searchParams.delete('fiche')
  if (url.href === window.location.href) return
  window.history[replace ? 'replaceState' : 'pushState'](null, '', `${url.pathname}${url.search}${url.hash}`)
}

export function GraphPage({ endpoint, admin = false, onOpenNode }: {
  endpoint: '/api/v1/graph' | '/api/admin/graph'
  admin?: boolean
  onOpenNode: (slug: string) => void
}) {
  const [load, setLoad] = useState<Load>({ phase: 'loading' })
  const [retry, setRetry] = useState(0)
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<GraphFilters>(emptyFilters)
  const [activeGroups, setActiveGroups] = useState<Set<string>>(allGroups)
  const [selectedId, setSelectedId] = useState('')
  const [selectedEdgeId, setSelectedEdgeId] = useState('')
  const [isolated, setIsolated] = useState(false)
  const [focusRequest, setFocusRequest] = useState<{ id: string; token: number } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoad({ phase: 'loading' })
    fetch(endpoint, { signal: controller.signal, credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) throw { status: response.status }
        return response.json() as Promise<GraphResponse | AdminGraphResponse>
      })
      .then((data) => { if (!controller.signal.aborted) setLoad({ phase: 'ready', data }) })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoad({ phase: 'error', status: typeof error === 'object' && error !== null &&
          'status' in error && typeof error.status === 'number' ? error.status : null })
      })
    return () => controller.abort()
  }, [endpoint, retry])

  const data = load.phase === 'ready' ? load.data : null
  const baseGraph = useMemo(() => data ? filterGraph(data, filters, activeGroups) : null,
    [data, filters, activeGroups])
  const results = useMemo(() => baseGraph ? searchGraph(baseGraph, query) : [], [baseGraph, query])
  const visibleGraph = useMemo(() => baseGraph && isolated && selectedId
    ? filterGraph(baseGraph, emptyFilters, allGroups(), selectedId) : baseGraph,
  [baseGraph, isolated, selectedId])
  const byId = useMemo(() => new Map(data?.nodes.map((node) => [node.id, node]) ?? []), [data])
  const selected = visibleGraph?.nodes.find((node) => node.id === selectedId) ?? null
  const selectedEdge = visibleGraph?.edges.find((edge) => edge.id === selectedEdgeId) ?? null

  useEffect(() => {
    if (!data) return
    const readSelection = () => {
      const slug = selectedSlugFromUrl()
      const node = slug ? data.nodes.find((candidate) => candidate.slug === slug) : null
      setSelectedId(node?.id ?? '')
      setSelectedEdgeId('')
      setIsolated(false)
      if (node) setFocusRequest((previous) => ({ id: node.id, token: (previous?.token ?? 0) + 1 }))
    }
    readSelection()
    window.addEventListener('popstate', readSelection)
    return () => window.removeEventListener('popstate', readSelection)
  }, [data])

  useEffect(() => {
    if (!selectedId || !baseGraph || baseGraph.nodes.some((node) => node.id === selectedId)) return
    setSelectedId('')
    setSelectedEdgeId('')
    setIsolated(false)
    writeSelectedSlug(null, true)
  }, [selectedId, baseGraph])

  useEffect(() => {
    if (selectedEdgeId && visibleGraph && !visibleGraph.edges.some((edge) => edge.id === selectedEdgeId)) {
      setSelectedEdgeId('')
    }
  }, [selectedEdgeId, visibleGraph])

  const selectNode = useCallback((id: string) => {
    const node = byId.get(id)
    if (!node) {
      setSelectedId(''); setSelectedEdgeId(''); setIsolated(false); writeSelectedSlug(null)
      return
    }
    if (id !== selectedId) setIsolated(false)
    setSelectedId(id)
    setSelectedEdgeId('')
    setFocusRequest((previous) => ({ id, token: (previous?.token ?? 0) + 1 }))
    writeSelectedSlug(node.slug)
  }, [byId, selectedId])

  const clearSelection = useCallback(() => {
    setSelectedId(''); setSelectedEdgeId(''); setIsolated(false); writeSelectedSlug(null)
  }, [])

  const toggleGroup = (id: string) => setActiveGroups((previous) => {
    const next = new Set(previous)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const resetFilters = () => {
    setFilters(emptyFilters); setActiveGroups(allGroups()); setQuery(''); setIsolated(false)
  }

  return <section className="graph-page" aria-label={admin ? 'Graphe éditorial' : 'Graphe public'}>
    <div className="graph-heading"><div><p className="section-eyebrow">Explorer les connexions</p>
      <h1>{admin ? 'Graphe éditorial' : 'Graphe du Codex'}</h1>
      <p>{admin ? 'Fiches et relations accessibles à l’administration.' : 'Fiches et relations publiées, visibles de tous.'}</p></div>
      {data && visibleGraph && <p className="graph-count" role="status">
        {visibleGraph.nodes.length} fiche{visibleGraph.nodes.length > 1 ? 's' : ''} · {visibleGraph.edges.length} relation{visibleGraph.edges.length > 1 ? 's' : ''} affichée{visibleGraph.edges.length > 1 ? 's' : ''}
        <small> sur {data.nodes.length} fiches · {data.edges.length} relations chargées</small>
      </p>}</div>
    {load.phase === 'loading' && <p className="graph-message" role="status">Chargement du graphe…</p>}
    {load.phase === 'error' && <div className="graph-message" role="alert"><p>{load.status === 401 ? 'Session expirée. Reconnectez-vous pour voir le graphe éditorial.'
      : load.status === 403 ? 'Accès au graphe éditorial refusé.' : 'Impossible de charger le graphe.'}</p>
      <button type="button" onClick={() => setRetry((value) => value + 1)}>Réessayer</button></div>}
    {data && data.nodes.length === 0 && <p className="graph-message">{admin ? 'Aucune fiche à représenter.'
      : 'Le graphe attend ses premières fiches publiées.'}</p>}
    {data && data.nodes.length > 0 && visibleGraph && <>
      <GraphFiltersPanel data={data} admin={admin} filters={filters} activeGroups={activeGroups} query={query}
        results={results} onQueryChange={setQuery} onSelectResult={(id) => { selectNode(id); setQuery('') }}
        onFiltersChange={setFilters} onToggleGroup={toggleGroup} onReset={resetFilters} />
      {visibleGraph.nodes.length === 0 ? <div className="graph-message" role="status">
        <p>Aucune fiche ne correspond aux filtres.</p>
        <button type="button" onClick={resetFilters}>Réinitialiser les filtres</button>
      </div> : <div className="graph-layout">
        <GraphCanvas data={visibleGraph} selectedId={selectedId} selectedEdgeId={selectedEdgeId}
          isolated={isolated} focusRequest={focusRequest} onSelectNode={selectNode} onOpenNode={onOpenNode}
          onSelectEdge={setSelectedEdgeId} onClearSelection={clearSelection}
          onToggleIsolation={() => setIsolated((value) => !value)} />
        <GraphDetails data={visibleGraph} selected={selected} selectedEdge={selectedEdge}
          onSelectNode={selectNode} onOpenNode={onOpenNode}
          onRecenter={() => { if (selected) setFocusRequest((previous) => ({ id: selected.id,
            token: (previous?.token ?? 0) + 1 })) }} />
      </div>}
    </>}
  </section>
}
