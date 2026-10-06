import { useEffect, useRef, useState, type MouseEvent } from 'react'
import type { AdminIngestionBatch, AdminIngestionItem, AdminIngestionItemDetail, IngestionOutcome, IngestionPage, IngestionMatches, IngestionProposalCreated, SourceKind } from '@hesta-codex/shared'
import { errorStatus, getAdminJson } from './admin-http'
import { IngestionAssociationPanel } from './IngestionAssociationPanel'
import { IngestionProposalForm } from './IngestionProposalForm'
import './Ingestion.css'

type Load<T> = { phase: 'loading'; key: string } | { phase: 'error'; key: string; status: number | null } | { phase: 'ready'; key: string; data: T }
type View = { kind: 'batches' } | { kind: 'batch'; id: string } | { kind: 'item'; id: string; receiptId?: string; batchId: string }
type NavigationEntry = { view: View; page: number; sourceKind: string; sourceId: string; outcome: string; search: string; query: string; after: string; before: string }
const kinds: SourceKind[] = ['MANUAL', 'OBSIDIAN', 'DISCORD', 'HESTA_MAP', 'YOUTUBE', 'AI_DERIVED', 'OTHER']
const outcomes: Record<IngestionOutcome, string> = { NEW: 'Nouveau', UNCHANGED: 'Inchangé', MODIFIED: 'Modifié' }
const date = (value: string) => new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))

function useRead<T>(url: string | null, refresh: number, onAccessError: (status: number) => void, query = ''): Load<T> {
  const [load, setLoad] = useState<Load<T>>({ phase: 'loading', key: '' })
  const key = JSON.stringify([url, query, refresh])
  useEffect(() => {
    if (!url) { setLoad({ phase: 'loading', key: '' }); return }
    const controller = new AbortController()
    setLoad({ phase: 'loading', key })
    getAdminJson<T>(url, controller.signal, query ? { 'X-Hesta-Ingestion-Search': encodeURIComponent(query) } : {})
      .then(data => { if (!controller.signal.aborted) setLoad({ phase: 'ready', key, data }) })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        const status = errorStatus(error)
        if (status === 401 || status === 403) onAccessError(status)
        setLoad({ phase: 'error', key, status })
      })
    return () => controller.abort()
  }, [url, key, query, refresh, onAccessError])
  return load.key === key ? load : { phase: 'loading', key }
}
function Status<T>({ load, onRetry }: { load: Load<T>; onRetry: () => void }) {
  return load.phase === 'loading' ? <p role="status">Chargement du staging…</p> : load.phase === 'error' ?
    <div role="alert"><p>{load.status === 404 ? 'Élément introuvable.' : 'Impossible de charger l’ingestion.'}</p>
      <button type="button" onClick={onRetry}>Réessayer</button></div> : null
}
function Pagination({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (page: number) => void }) {
  return <div className="admin-pagination"><button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>Précédent</button>
    <span>Page {page} · {total} résultat{total > 1 ? 's' : ''}</span>
    <button type="button" disabled={page >= 1000 || page * pageSize >= total} onClick={() => onPage(page + 1)}>Suivant</button></div>
}
function BatchSummary({ batch }: { batch: AdminIngestionBatch }) {
  return <><p>{date(batch.createdAt)} · {batch.receivedCount} item{batch.receivedCount > 1 ? 's' : ''} reçus</p>
    <p>{batch.newCount} nouveaux · {batch.unchangedCount} inchangés · {batch.modifiedCount} modifiés · {batch.warningCount} avertissements</p>
    <p>{batch.sourceCount} Source{batch.sourceCount > 1 ? 's' : ''} · {batch.sourceKinds.join(', ')}</p>
    <ul>{batch.sources.map(source => <li key={source.id}>{source.label} · {source.kind} <small>{source.id}</small></li>)}</ul>
    {batch.sourceCount > batch.sources.length && <p>20 Sources affichées ; les autres restent accessibles dans les items.</p>}</>
}
export function AdminIngestion({ onAccessError, onNavigate }: { onAccessError: (status: number) => void;
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>, path: string) => void }) {
  const [view, setView] = useState<View>({ kind: 'batches' })
  const [page, setPage] = useState(1)
  const [sourceKind, setSourceKind] = useState('')
  const [sourceId, setSourceId] = useState('')
  const [outcome, setOutcome] = useState('')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [after, setAfter] = useState('')
  const [before, setBefore] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [matchesRefresh, setMatchesRefresh] = useState(0)
  const [proposal, setProposal] = useState<string | null>(null)
  const [created, setCreated] = useState<{ key: string; data: IngestionProposalCreated } | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const focusRequested = useRef(false)
  const navigation = useRef(new Map<string, NavigationEntry>())
  const currentEntry = useRef('')
  useEffect(() => {
    const marker = crypto.randomUUID()
    currentEntry.current = marker
    navigation.current.set(marker, { view: { kind: 'batches' }, page: 1, sourceKind: '', sourceId: '', outcome: '', search: '', query: '', after: '', before: '' })
    // Browser history carries only an opaque marker, never staging IDs, filters or content.
    window.history.replaceState({ ...window.history.state, ingestionNavigation: marker }, '')
    const entries = navigation.current
    const restore = (event: PopStateEvent) => {
      if (!/^\/admin\/ingestion\/?$/.test(window.location.pathname)) return
      const marker = event.state?.ingestionNavigation
      const entry = typeof marker === 'string' ? entries.get(marker) : undefined
      if (!entry) return
      currentEntry.current = marker
      setProposal(null); setCreated(null)
      focusRequested.current = true
      setView(entry.view); setPage(entry.page)
      setSourceKind(entry.sourceKind); setSourceId(entry.sourceId); setOutcome(entry.outcome)
      setSearch(entry.search); setQuery(entry.query); setAfter(entry.after); setBefore(entry.before)
    }
    window.addEventListener('popstate', restore)
    return () => { window.removeEventListener('popstate', restore); entries.clear() }
  }, [])
  useEffect(() => {
    navigation.current.set(currentEntry.current, { view, page, sourceKind, sourceId, outcome, search, query, after, before })
  }, [view, page, sourceKind, sourceId, outcome, search, query, after, before])
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = search.trim().length >= 2 ? search.trim() : ''
      if (next !== query) { setQuery(next); setPage(1) }
    }, 320)
    return () => clearTimeout(timer)
  }, [search, query])
  useEffect(() => { if (focusRequested.current) { heading.current?.focus(); focusRequested.current = false } }, [view, page])
  const sourceValid = !sourceId.trim() || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sourceId.trim())
  const dateValid = !after || !before || after <= before
  const searchValid = !query.includes('\0') && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(query)
  const params = new URLSearchParams({ page: String(page) })
  if (sourceKind) params.set('sourceKind', sourceKind)
  if (sourceId.trim()) params.set('sourceId', sourceId.trim())
  if (outcome) params.set('outcome', outcome)
  if (after) params.set('after', `${after}T00:00:00.000Z`)
  if (before) params.set('before', `${before}T23:59:59.999Z`)
  if (view.kind === 'batch') params.set('batchId', view.id)
  const listUrl = sourceValid && dateValid && searchValid && view.kind !== 'item' ? `/api/admin/ingestion/${view.kind === 'batch' ? 'items' : 'batches'}?${params}` : null
  const batchUrl = view.kind === 'batch' ? `/api/admin/ingestion/batches/${view.id}` : null
  const itemUrl = view.kind === 'item' ? `/api/admin/ingestion/items/${view.id}${view.receiptId ? `?receiptId=${view.receiptId}` : ''}` : null
  const list = useRead<IngestionPage<AdminIngestionBatch> | IngestionPage<AdminIngestionItem>>(listUrl, refresh, onAccessError, query)
  const batch = useRead<AdminIngestionBatch>(batchUrl, refresh, onAccessError)
  const item = useRead<AdminIngestionItemDetail>(itemUrl, refresh, onAccessError)
  // Pin matching to the receipt actually displayed, including latest-receipt version navigation.
  const matchesUrl = view.kind === 'item' && item.phase === 'ready'
    ? `/api/admin/ingestion/items/${item.data.itemId}/matches?receiptId=${item.data.id}` : null
  const matches = useRead<IngestionMatches>(matchesUrl, refresh + matchesRefresh, onAccessError)
  const navigate = (next: View) => {
    setProposal(null); setCreated(null)
    navigation.current.set(currentEntry.current, { view, page, sourceKind, sourceId, outcome, search, query, after, before })
    const marker = crypto.randomUUID()
    currentEntry.current = marker
    navigation.current.set(marker, { view: next, page: 1, sourceKind, sourceId, outcome, search, query, after, before })
    window.history.pushState({ ...window.history.state, ingestionNavigation: marker }, '')
    focusRequested.current = true; setView(next); setPage(1)
  }
  const resetFilters = () => { setSourceKind(''); setSourceId(''); setOutcome(''); setSearch(''); setQuery(''); setAfter(''); setBefore(''); setPage(1) }
  const retry = () => setRefresh(value => value + 1)
  return <section className="ingestion-page" aria-label="Staging d’ingestion">
    <h1 ref={heading} tabIndex={-1}>Ingestion</h1>
    <p>Staging privé · associations humaines. Aucun contenu n’est transformé ou publié automatiquement.</p>
    {view.kind !== 'batches' && <button type="button" onClick={() => navigate(view.kind === 'item' ? { kind: 'batch', id: view.batchId } : { kind: 'batches' })}>
      {view.kind === 'item' ? '← Retour au batch' : '← Tous les batches'}</button>}
    {view.kind !== 'item' && <form className="ingestion-filters" onSubmit={event => event.preventDefault()}>
      <label>Type de Source<select value={sourceKind} onChange={event => { setSourceKind(event.target.value); setPage(1) }}>
        <option value="">Tous</option>{kinds.map(kind => <option key={kind}>{kind}</option>)}</select></label>
      <label>UUID de Source<input value={sourceId} maxLength={36} onChange={event => { setSourceId(event.target.value); setPage(1) }} aria-invalid={!sourceValid} /></label>
      <label>Résultat<select value={outcome} onChange={event => { setOutcome(event.target.value); setPage(1) }}><option value="">Tous</option>
        {Object.entries(outcomes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Rechercher les items<input type="search" value={search} maxLength={100} placeholder="Titre, identifiant ou locator"
        onChange={event => setSearch(event.target.value)} /></label>
      <label>Depuis (UTC)<input type="date" value={after} onChange={event => { setAfter(event.target.value); setPage(1) }} /></label>
      <label>Jusqu’au (UTC)<input type="date" value={before} onChange={event => { setBefore(event.target.value); setPage(1) }} /></label>
      <button type="button" onClick={resetFilters}>Réinitialiser les filtres</button>
      {!sourceValid && <p role="alert">UUID de Source invalide.</p>}{!dateValid && <p role="alert">Intervalle de dates invalide.</p>}
      {!searchValid && <p role="alert">Recherche Unicode invalide.</p>}
      {search.trim().length === 1 && <p>Saisissez au moins 2 caractères.</p>}
    </form>}
    {view.kind === 'batch' && <><Status load={batch} onRetry={retry} />{batch.phase === 'ready' && <section aria-label="Résumé du batch">
      <h2>{batch.data.label}</h2><p className="ingestion-id">Batch {batch.data.id}</p><BatchSummary batch={batch.data} /></section>}</>}
    {listUrl && <><Status load={list} onRetry={retry} />{list.phase === 'ready' && <>
      {list.data.items.length === 0 ? <p role="status">{view.kind === 'batches' ? 'Aucun batch pour ces filtres.' : 'Aucun item pour ces filtres.'}</p> :
        <ul className="ingestion-list">{list.data.items.map(row => 'receivedCount' in row ? <li key={row.id}>
          <h2><button type="button" onClick={() => navigate({ kind: 'batch', id: row.id })}>{row.label}</button></h2><BatchSummary batch={row} /></li> : <li key={row.id}>
          <h3><button type="button" onClick={() => navigate({ kind: 'item', id: row.itemId, receiptId: row.id, batchId: row.batchId })}>{row.title ?? row.externalId ?? `Item ${row.ordinal + 1}`}</button></h3>
          <p>{outcomes[row.outcome]} · version {row.version} · {row.source.label} · {row.source.kind}</p>
          <p>{row.externalId ?? 'Sans identifiant externe'}{row.locator ? ` · ${row.locator}` : ''}</p><p>{date(row.ingestedAt)}</p>
        </li>)}</ul>}
      <Pagination page={list.data.page} total={list.data.total} pageSize={list.data.pageSize} onPage={next => { focusRequested.current = true; setPage(next) }} />
    </>}</>}
    {view.kind === 'item' && <><Status load={item} onRetry={retry} />{item.phase === 'ready' && <article className="ingestion-detail">
      <h2>{item.data.title ?? 'Item sans titre'}</h2><p>{outcomes[item.data.outcome]} · version {item.data.version}</p>
      {created?.key === `${item.data.itemId}:${item.data.id}` && <div role="status"><h3>Fiche créée dans le Codex</h3>
        <p>{created.data.entity.title} · {created.data.entity.kind} · {created.data.entity.slug} · {created.data.entity.status} · {created.data.entity.visibility}</p></div>}
      {proposal === `${item.data.itemId}:${item.data.id}` ? <IngestionProposalForm key={proposal} itemId={item.data.itemId} receiptId={item.data.id}
        onCancel={() => { setProposal(null); setMatchesRefresh(value => value + 1); heading.current?.focus() }} onCreated={result => {
          setCreated({ key: `${item.data.itemId}:${item.data.id}`, data: result }); setProposal(null); setMatchesRefresh(value => value + 1); heading.current?.focus()
        }} onAccessError={onAccessError} /> : <IngestionAssociationPanel key={`${item.data.itemId}:${item.data.id}`} itemId={item.data.itemId} receiptId={item.data.id}
        matches={matches} onRetryMatches={() => setMatchesRefresh(value => value + 1)} onAccessError={onAccessError} onNavigate={onNavigate}
        onPrepare={() => setProposal(`${item.data.itemId}:${item.data.id}`)} />}
      <dl><dt>UUID de l’item</dt><dd>{item.data.itemId}</dd><dt>UUID de réception</dt><dd>{item.data.id}</dd>
        <dt>Source</dt><dd>{item.data.source.label} · {item.data.source.kind} · {item.data.source.id}</dd>
        <dt>Identifiant externe</dt><dd>{item.data.externalId ?? 'Absent'}</dd><dt>Locator</dt><dd>{item.data.locator ?? 'Absent'}</dd>
        <dt>SHA-256 normalisé</dt><dd>{item.data.contentHash}</dd><dt>Format</dt><dd>{item.data.contentType}</dd>
        <dt>Date d’observation externe</dt><dd>{item.data.observedAt ? date(item.data.observedAt) : 'Non renseignée'}</dd>
        <dt>Réception</dt><dd>{date(item.data.ingestedAt)}</dd><dt>Création du snapshot</dt><dd>{date(item.data.snapshotIngestedAt)}</dd>
        <dt>Batch d’origine du snapshot</dt><dd>{item.data.originBatchId}</dd></dl>
      <h3>Contenu brut reçu</h3><pre className="ingestion-raw" tabIndex={0} role="region" aria-label="Contenu brut reçu">{item.data.content}</pre>
      <details><summary>Metadata de cette réception</summary><pre tabIndex={0} role="region" aria-label="Metadata de réception">{JSON.stringify(item.data.metadata, null, 2)}</pre></details>
      <section aria-label="Versions du contenu"><h3>Versions du contenu</h3><p>Les 20 versions les plus récentes sont affichées.</p>
        <ul>{item.data.versions.map(version => <li key={version.id}><button type="button" disabled={version.id === item.data.itemId}
          onClick={() => navigate({ kind: 'item', id: version.id, batchId: view.batchId })}>Version {version.version} · {date(version.ingestedAt)}</button></li>)}</ul></section>
    </article>}</>}
  </section>
}
