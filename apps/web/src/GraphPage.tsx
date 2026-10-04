import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AdminGraphResponse, GraphResponse } from '@hesta-codex/shared'
import { GraphCanvas } from './GraphCanvas'
import { GraphDetails } from './GraphDetails'
import { GraphFiltersPanel } from './GraphFilters'
import { emptyFilters, filterGraph, indexGraph, indexGraphSearch, isolateNeighborhood, neighborhoodDistances,
  nodeMatchesFilters, searchIndexedGraph, type GraphData, type NeighborhoodDepth } from './graph-model'
import { allGraphGroups, graphStateUrl, readGraphState, resolveGraphState, type GraphUrlState } from './graph-url'
import './Graph.css'

export { visibleConnections } from './graph-model'

type Load = { phase: 'loading' } | { phase: 'error'; status: number | null } | { phase: 'ready'; data: GraphData }
const noMatches: ReadonlySet<string> = new Set()

function writeGraphUrl(state: GraphUrlState, admin: boolean, replace = false): string {
  const current = new URL(window.location.href)
  if (current.pathname.replace(/\/$/, '') !== (admin ? '/admin/graphe' : '/graphe')) return current.href
  const url = graphStateUrl(current, state, admin)
  if (url.href !== current.href) window.history[replace ? 'replaceState' : 'pushState'](null, '', `${url.pathname}${url.search}`)
  return url.href
}

export function GraphPage({ endpoint, admin = false, onOpenNode }: {
  endpoint: '/api/v1/graph' | '/api/admin/graph'
  admin?: boolean
  onOpenNode: (slug: string) => void
}) {
  const [load, setLoad] = useState<Load>({ phase: 'loading' })
  const [retry, setRetry] = useState(0)
  const [exploration, setExploration] = useState(() => readGraphState(window.location.search, admin))
  const explorationRef = useRef(exploration)
  const editingSearch = useRef(false)
  const [selectedEdgeId, setSelectedEdgeId] = useState('')
  const [detailsFocusToken, setDetailsFocusToken] = useState(0)
  const [focusRequest, setFocusRequest] = useState<{ id: string; token: number } | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'pending' | 'copied' | 'error'>('idle')
  const [copyUrl, setCopyUrl] = useState('')
  const copyInput = useRef<HTMLInputElement>(null)
  const copyButton = useRef<HTMLButtonElement>(null)
  const copyRequest = useRef(0)
  const restoreCopyFocus = useRef(false)

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
  const loadedIndex = useMemo(() => data ? indexGraph(data) : null, [data])
  const nodesBySlug = useMemo(() => new Map(data?.nodes.map(node => [node.slug, node]) ?? []), [data])
  const searchIndex = useMemo(() => data ? indexGraphSearch(data) : new Map(), [data])
  const relationTypes = useMemo(() => new Set(data?.edges.map(edge => edge.type)), [data])
  const canonicalize = useCallback((state: GraphUrlState): GraphUrlState => {
    if (!data) return state
    const next = resolveGraphState(state, relationTypes)
    const node = nodesBySlug.get(next.slug)
    if (next.slug && (!node || !nodeMatchesFilters(node, next.filters, next.groups))) return { ...next, slug: '', isolated: false }
    if (!next.slug && next.isolated) return { ...next, isolated: false }
    return next
  }, [data, nodesBySlug, relationTypes])
  const state = useMemo(() => canonicalize(exploration), [canonicalize, exploration])
  const { query, filters, groups: activeGroups, depth, isolated } = state
  const selectedId = nodesBySlug.get(state.slug)?.id ?? ''
  const baseGraph = useMemo(() => data ? filterGraph(data, filters, activeGroups) : null,
    [data, filters, activeGroups])
  const baseIndex = useMemo(() => baseGraph && loadedIndex && baseGraph.nodes.length === data?.nodes.length &&
    baseGraph.edges.length === data?.edges.length ? loadedIndex : baseGraph ? indexGraph(baseGraph) : null,
  [baseGraph, loadedIndex, data])
  const results = useMemo(() => baseGraph ? searchIndexedGraph(baseGraph, query, searchIndex) : [], [baseGraph, query, searchIndex])
  const searchMatches = useMemo(() => results.length ? new Set(results.map(node => node.id)) : noMatches, [results])
  const distances = useMemo(() => baseIndex ? neighborhoodDistances(baseIndex, selectedId, depth) : new Map<string, number>(),
    [baseIndex, selectedId, depth])
  const visibleGraph = useMemo(() => baseGraph && isolated && selectedId
    ? distances.size === baseGraph.nodes.length ? baseGraph : isolateNeighborhood(baseGraph, distances) : baseGraph,
  [baseGraph, isolated, selectedId, distances])
  const visibleIndex = useMemo(() => visibleGraph === baseGraph ? baseIndex
    : visibleGraph ? indexGraph(visibleGraph) : null, [visibleGraph, baseGraph, baseIndex])
  const selected = visibleIndex?.nodes.get(selectedId) ?? null
  const selectedEdge = visibleIndex?.edges.get(selectedEdgeId) ?? null

  const commitState = useCallback((change: (previous: GraphUrlState) => GraphUrlState, replace = false) => {
    const next = canonicalize(change(explorationRef.current))
    explorationRef.current = next
    setExploration(next)
    writeGraphUrl(next, admin, replace)
    copyRequest.current++
    setCopyState('idle')
    return next
  }, [canonicalize, admin])

  useEffect(() => {
    if (!data) return
    explorationRef.current = state
    if (state !== exploration) setExploration(state)
    writeGraphUrl(state, admin, true)
    if (!state.slug) setFocusRequest(null)
  }, [data, state, exploration, admin])

  useEffect(() => {
    if (!data) return
    const node = nodesBySlug.get(canonicalize(explorationRef.current).slug)
    if (node) setFocusRequest(previous => ({ id: node.id, token: (previous?.token ?? 0) + 1 }))
  }, [data, nodesBySlug, canonicalize])

  useEffect(() => {
    const restore = () => {
      if (window.location.pathname.replace(/\/$/, '') !== (admin ? '/admin/graphe' : '/graphe')) return
      const parsed = readGraphState(window.location.search, admin)
      const previous = explorationRef.current
      const next = commitState(() => admin ? { ...parsed, slug: parsed.slug || previous.slug,
        query: previous.query, isolated: previous.isolated } : parsed, true)
      editingSearch.current = false
      setSelectedEdgeId('')
      const node = nodesBySlug.get(next.slug)
      setFocusRequest(old => node ? { id: node.id, token: (old?.token ?? 0) + 1 } : null)
    }
    window.addEventListener('popstate', restore)
    return () => window.removeEventListener('popstate', restore)
  }, [admin, commitState, nodesBySlug])

  useEffect(() => {
    if (selectedEdgeId && visibleIndex && !visibleIndex.edges.has(selectedEdgeId)) {
      setSelectedEdgeId('')
    }
  }, [selectedEdgeId, visibleIndex])

  const selectNode = useCallback((id: string, recenter = true) => {
    const node = baseIndex?.nodes.get(id)
    editingSearch.current = false
    commitState(previous => ({ ...previous, slug: node?.slug ?? '',
      isolated: node && node.slug === previous.slug ? previous.isolated : false }))
    setSelectedEdgeId('')
    if (node && recenter) setFocusRequest((previous) => ({ id, token: (previous?.token ?? 0) + 1 }))
    else setFocusRequest(null)
  }, [baseIndex, commitState])

  // Keep the hit target still between the two clicks that open a fiche.
  const selectCanvasNode = useCallback((id: string) => selectNode(id, false), [selectNode])

  const clearSelection = useCallback(() => {
    editingSearch.current = false
    commitState(previous => ({ ...previous, slug: '', isolated: false }))
    setSelectedEdgeId(''); setFocusRequest(null)
  }, [commitState])

  const toggleGroup = useCallback((id: string) => {
    editingSearch.current = false
    commitState(previous => {
      const groups = new Set(previous.groups)
      if (groups.has(id)) groups.delete(id)
      else groups.add(id)
      return { ...previous, groups }
    })
  }, [commitState])

  const resetFilters = useCallback(() => {
    editingSearch.current = false
    commitState(previous => ({ ...previous, filters: { ...emptyFilters }, groups: allGraphGroups(), query: '', isolated: false }))
  }, [commitState])
  const setDepth = useCallback((depth: NeighborhoodDepth) => {
    editingSearch.current = false
    commitState(previous => ({ ...previous, depth }))
  }, [commitState])
  const toggleIsolation = useCallback(() => {
    editingSearch.current = false
    commitState(previous => ({ ...previous, isolated: !previous.isolated }))
  }, [commitState])
  const selectDetailsNode = useCallback((id: string, focusDetails = false) => {
    selectNode(id)
    if (focusDetails) setDetailsFocusToken(value => value + 1)
  }, [selectNode])
  const recenter = useCallback(() => {
    const id = nodesBySlug.get(explorationRef.current.slug)?.id
    if (id) setFocusRequest(previous => ({ id, token: (previous?.token ?? 0) + 1 }))
  }, [nodesBySlug])

  const copyLink = async () => {
    const link = writeGraphUrl(canonicalize(explorationRef.current), admin, true)
    const request = ++copyRequest.current
    restoreCopyFocus.current = document.activeElement === copyButton.current
    setCopyState('pending'); setCopyUrl(link)
    try {
      if (!navigator.clipboard?.writeText) throw new Error('unavailable')
      await navigator.clipboard.writeText(link)
      if (request === copyRequest.current && window.location.href === link) setCopyState('copied')
    } catch { if (request === copyRequest.current && window.location.href === link) setCopyState('error') }
  }
  useEffect(() => {
    if (copyState === 'error') { copyInput.current?.focus(); copyInput.current?.select() }
    else if (copyState === 'copied' && restoreCopyFocus.current && document.activeElement === document.body) {
      copyButton.current?.focus({ preventScroll: true })
    }
  }, [copyState])
  useEffect(() => () => { copyRequest.current++ }, [])

  return <section className="graph-page" aria-label={admin ? 'Graphe éditorial' : 'Graphe public'}>
    <div className="graph-heading"><div><p className="section-eyebrow">Explorer les connexions</p>
      <h1>{admin ? 'Graphe éditorial' : 'Graphe du Codex'}</h1>
      <p>{admin ? 'Fiches et relations accessibles à l’administration.' : 'Fiches et relations publiées, visibles de tous.'}</p></div>
      {data && visibleGraph && <p className="graph-count" role="status">
        {visibleGraph.nodes.length} fiche{visibleGraph.nodes.length > 1 ? 's' : ''} · {visibleGraph.edges.length} relation{visibleGraph.edges.length > 1 ? 's' : ''} affichée{visibleGraph.edges.length > 1 ? 's' : ''}
        <small> sur {data.nodes.length} fiches · {data.edges.length} relations chargées</small>
      </p>}</div>
    {data && <div className="graph-share">
      <button ref={copyButton} type="button" disabled={copyState === 'pending'} onClick={() => { void copyLink() }}
        title={admin ? 'Copier les filtres et la profondeur, sans sélection ni recherche éditoriale' : 'Copier le lien de cet état du graphe'}>Copier le lien</button>
      {copyState === 'copied' && <span role="status">Lien copié.</span>}
      {copyState === 'error' && <><span role="status">Copie indisponible. Vous pouvez copier le lien ci-dessous.</span>
        <label>Lien du graphe<input ref={copyInput} value={copyUrl} readOnly onFocus={event => event.target.select()} /></label></>}
    </div>}
    {load.phase === 'loading' && <p className="graph-message" role="status">Chargement du graphe…</p>}
    {load.phase === 'error' && <div className="graph-message" role="alert"><p>{load.status === 401 ? 'Session expirée. Reconnectez-vous pour voir le graphe éditorial.'
      : load.status === 403 ? 'Accès au graphe éditorial refusé.' : 'Impossible de charger le graphe.'}</p>
      <button type="button" onClick={() => setRetry((value) => value + 1)}>Réessayer</button></div>}
    {data && data.nodes.length === 0 && <p className="graph-message">{admin ? 'Aucune fiche à représenter.'
      : 'Le graphe attend ses premières fiches publiées.'}</p>}
    {data && data.nodes.length > 0 && visibleGraph && visibleIndex && loadedIndex && <>
      <GraphFiltersPanel data={data} admin={admin} filters={filters} activeGroups={activeGroups} query={query}
        results={results} onQueryChange={query => {
          const previousUrl = window.location.href
          commitState(previous => ({ ...previous, query }), editingSearch.current)
          // Whitespace-only edits do not serialize; the first real change still needs a new entry.
          editingSearch.current ||= window.location.href !== previousUrl
        }} onSearchBlur={() => { editingSearch.current = false }} onSelectResult={(id) => {
          selectNode(id); commitState(previous => ({ ...previous, query: '' }), true)
          setDetailsFocusToken((value) => value + 1)
        }}
        onFiltersChange={filters => {
          editingSearch.current = false
          commitState(previous => ({ ...previous, filters }))
        }} onToggleGroup={toggleGroup} onReset={resetFilters} />
      {visibleGraph.nodes.length === 0 ? <div className="graph-message" role="status">
        <p>Aucune fiche ne correspond aux filtres.</p>
        <button type="button" onClick={resetFilters}>Réinitialiser les filtres</button>
      </div> : <div className="graph-layout">
        <GraphCanvas key={admin ? 'admin' : 'public'} scope={admin ? 'admin' : 'public'} data={visibleGraph} selectedId={selectedId} selectedEdgeId={selectedEdgeId}
          index={visibleIndex} totalIndex={loadedIndex} distances={distances} depth={depth}
          onDepthChange={setDepth} searchMatches={searchMatches}
          isolated={isolated} focusRequest={focusRequest} onSelectNode={selectCanvasNode} onOpenNode={onOpenNode}
          onSelectEdge={setSelectedEdgeId} onClearSelection={clearSelection}
          onToggleIsolation={toggleIsolation} />
        <GraphDetails data={visibleGraph} index={visibleIndex} totalIndex={loadedIndex}
          focusToken={detailsFocusToken}
          selected={selected} selectedEdge={selectedEdge}
          onSelectNode={selectDetailsNode} onOpenNode={onOpenNode} onRecenter={recenter} />
      </div>}
    </>}
  </section>
}
