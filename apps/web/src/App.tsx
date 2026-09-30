import { lazy, Suspense, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type {
  EntityDetail,
  EntityKind,
  EntityListItem,
  EntityRelationItem,
  HealthResponse,
  PlaceKind,
} from '@hesta-codex/shared'
import { AdminApp } from './AdminApp'
const GraphPage = lazy(() => import('./GraphPage').then((module) => ({ default: module.GraphPage })))

const kindOptions: { kind: EntityKind; label: string }[] = [
  { kind: 'PERSON', label: 'Personnages' },
  { kind: 'PLACE', label: 'Lieux' },
  { kind: 'ORGANIZATION', label: 'Organisations' },
  { kind: 'FAMILY', label: 'Familles' },
  { kind: 'RELIGION', label: 'Religions' },
  { kind: 'DEITY', label: 'Divinités' },
  { kind: 'SPECIES', label: 'Espèces' },
  { kind: 'CREATURE', label: 'Créatures' },
  { kind: 'ARTIFACT', label: 'Artefacts' },
  { kind: 'EVENT', label: 'Événements' },
  { kind: 'QUEST', label: 'Quêtes' },
  { kind: 'SESSION', label: 'Sessions JDR' },
  { kind: 'CONCEPT', label: 'Concepts' },
  { kind: 'OTHER', label: 'Autres' },
]

const placeLabels: Record<PlaceKind, string> = {
  CITY: 'Ville',
  CONTINENT: 'Continent',
  REGION: 'Région',
  SEA: 'Mer',
  OCEAN: 'Océan',
  OTHER: 'Autre lieu',
}

const entityPathPattern = /^\/fiches\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/

type Route = { view: 'library' } | { view: 'graph' } | { view: 'entity'; slug: string } | { view: 'not-found' }
type ApiState = 'checking' | 'online' | 'offline'
type LoadError = { status: number | null }
type LoadState<T> =
  | { key: string; phase: 'loading' }
  | { key: string; phase: 'ready'; data: T }
  | { key: string; phase: 'error'; error: LoadError }

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`)
  }
}

function readRoute(): Route {
  if (window.location.pathname === '/') return { view: 'library' }
  if (window.location.pathname === '/graphe' || window.location.pathname === '/graphe/') return { view: 'graph' }
  const match = entityPathPattern.exec(window.location.pathname)
  return match ? { view: 'entity', slug: match[1] } : { view: 'not-found' }
}

function internalPagePath(href: string | undefined): string | null {
  if (!href) return null
  try {
    const url = new URL(href, window.location.href)
    if (url.origin !== window.location.origin || url.search || url.hash) return null
    return url.pathname === '/' || url.pathname === '/graphe' || entityPathPattern.test(url.pathname) ? url.pathname : null
  } catch {
    return null
  }
}

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!response.ok) throw new HttpError(response.status)
  return await response.json() as T
}

function toLoadError(error: unknown): LoadError {
  return { status: error instanceof HttpError ? error.status : null }
}

function kindLabel(kind: EntityKind): string {
  return kindOptions.find((option) => option.kind === kind)?.label ?? kind
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(value))
}

type NavigateLink = (event: MouseEvent<HTMLAnchorElement>, href: string) => void

function InternalLink({
  href,
  onNavigate,
  className,
  children,
  label,
}: {
  href: string
  onNavigate: NavigateLink
  className?: string
  children: ReactNode
  label?: string
}) {
  return (
    <a href={href} className={className} aria-label={label} onClick={(event) => onNavigate(event, href)}>
      {children}
    </a>
  )
}

function Tags({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null
  return (
    <ul className="tag-list" aria-label="Mots-clés">
      {tags.map((tag) => <li key={tag}>{tag}</li>)}
    </ul>
  )
}

function LibraryPanel({
  search,
  selectedKind,
  open,
  onOpenChange,
  onSearchChange,
  onKindChange,
}: {
  search: string
  selectedKind: EntityKind | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSearchChange: (value: string) => void
  onKindChange: (kind: EntityKind | null) => void
}) {
  return (
    <aside className="library-panel" aria-label="Bibliothèque">
      <button
        className="library-toggle"
        type="button"
        aria-expanded={open}
        aria-controls="library-controls"
        onClick={() => onOpenChange(!open)}
      >
        <span><strong>Bibliothèque</strong><small>{selectedKind ? kindLabel(selectedKind) : 'Toutes les fiches'}</small></span>
        <span className="toggle-chevron" aria-hidden="true">⌄</span>
      </button>
      <div id="library-controls" className={`library-controls${open ? ' is-open' : ''}`}>
        <div className="panel-heading">
          <span className="panel-index">01 / Explorer</span>
          <h2>Bibliothèque</h2>
          <p>Parcourir les connaissances publiées du Monde d’Hesta.</p>
        </div>
        <div className="search-field">
          <label htmlFor="entity-search">Rechercher</label>
          <div className="search-input-wrap">
            <span aria-hidden="true">⌕</span>
            <input
              id="entity-search"
              type="search"
              value={search}
              maxLength={100}
              autoComplete="off"
              placeholder="Titre, lieu, concept…"
              aria-describedby="search-help"
              onChange={(event) => onSearchChange(event.target.value)}
            />
          </div>
          <p id="search-help" className="field-help" aria-live="polite">
            {search.trim().length === 1
              ? 'Saisissez au moins 2 caractères pour lancer la recherche.'
              : 'Recherche dans les titres, résumés et slugs.'}
          </p>
        </div>
        <nav className="kind-nav" aria-label="Types de fiches">
          <p className="nav-caption">Explorer par type</p>
          <button
            type="button"
            className={`kind-button${selectedKind === null ? ' is-active' : ''}`}
            aria-pressed={selectedKind === null}
            onClick={() => onKindChange(null)}
          >
            <span className="kind-marker" aria-hidden="true" />Toutes les fiches
          </button>
          {kindOptions.map(({ kind, label }) => (
            <button
              key={kind}
              type="button"
              className={`kind-button${selectedKind === kind ? ' is-active' : ''}`}
              aria-pressed={selectedKind === kind}
              onClick={() => onKindChange(kind)}
            >
              <span className="kind-marker" aria-hidden="true" />{label}
            </button>
          ))}
        </nav>
      </div>
    </aside>
  )
}

function LoadingView({ label }: { label: string }) {
  return (
    <div className="state-card loading-card" role="status" aria-live="polite">
      <div className="loading-lines" aria-hidden="true"><span /><span /><span /></div>
      <p>{label}</p>
    </div>
  )
}

function EmptyView({ title, description, pageHeading = false }: {
  title: string
  description: string
  pageHeading?: boolean
}) {
  const Heading = pageHeading ? 'h1' : 'h2'
  return (
    <div className="state-card empty-card">
      <span className="empty-symbol" aria-hidden="true">◇</span>
      <Heading>{title}</Heading>
      <p>{description}</p>
    </div>
  )
}

function ErrorView({ error, onRetry, entity = false }: {
  error: LoadError
  onRetry: () => void
  entity?: boolean
}) {
  const missing = entity && error.status === 404
  const unavailable = error.status === null || error.status === 502 || error.status === 503 || error.status === 504
  const invalid = error.status === 400
  const title = missing
    ? 'Fiche introuvable'
    : unavailable
      ? 'API indisponible'
      : invalid
        ? 'Requête invalide'
        : 'Une erreur est survenue'
  const description = missing
    ? 'Cette fiche n’existe pas ou n’est pas accessible publiquement.'
    : unavailable
      ? 'Le Codex ne peut pas joindre son service de données pour le moment.'
      : invalid
        ? 'Les paramètres de cette requête ont été refusés par l’API.'
        : `Impossible de charger les données du Codex${error.status ? ` (erreur ${error.status})` : ''}.`
  const Heading = entity ? 'h1' : 'h2'
  return (
    <div className="state-card error-card" role="alert">
      <span className="empty-symbol" aria-hidden="true">!</span>
      <Heading>{title}</Heading>
      <p>{description}</p>
      {!missing && <button className="action-button" type="button" onClick={onRetry}>Réessayer</button>}
    </div>
  )
}

function LibraryView({
  entities,
  selectedKind,
  query,
  onNavigate,
}: {
  entities: EntityListItem[]
  selectedKind: EntityKind | null
  query: string
  onNavigate: NavigateLink
}) {
  if (entities.length === 0) {
    return selectedKind || query ? (
      <EmptyView
        title="Aucune fiche trouvée"
        description="Essayez une autre recherche ou choisissez un autre type de fiche."
      />
    ) : (
      <EmptyView
        title="La bibliothèque attend ses premières fiches"
        description="Les entrées publiées du Monde d’Hesta apparaîtront ici dès qu’elles seront disponibles."
      />
    )
  }

  return (
    <ul className="entity-grid" aria-label="Fiches du Codex">
      {entities.map((entity) => (
        <li key={entity.id}>
          <InternalLink
            href={`/fiches/${encodeURIComponent(entity.slug)}`}
            onNavigate={onNavigate}
            className="entity-card"
            label={`Ouvrir la fiche ${entity.title}`}
          >
            <span className="card-kind">{kindLabel(entity.kind)}</span>
            <h2>{entity.title}</h2>
            <p className="card-summary">{entity.summary || 'Aucun résumé disponible.'}</p>
            <Tags tags={entity.tags} />
            <span className="card-arrow" aria-hidden="true">↗</span>
          </InternalLink>
        </li>
      ))}
    </ul>
  )
}

function EntityArticle({ entity, onNavigate }: { entity: EntityDetail; onNavigate: NavigateLink }) {
  return (
    <article className="entity-article">
      <header className="entity-header">
        <div className="entity-actions">
          <InternalLink href="/" onNavigate={onNavigate} className="back-link">
            <span aria-hidden="true">←</span> Retour à la bibliothèque
          </InternalLink>
          <a href="#relations" className="relations-shortcut">Voir les relations <span aria-hidden="true">↓</span></a>
        </div>
        <div className="entity-type-line">
          <span>{kindLabel(entity.kind)}</span>
          {entity.kind === 'PLACE' && entity.placeKind && <><span className="type-divider" aria-hidden="true">/</span><span>{placeLabels[entity.placeKind]}</span></>}
        </div>
        <h1>{entity.title}</h1>
        {entity.summary && <p className="entity-summary">{entity.summary}</p>}
        {entity.aliases.length > 0 && (
          <p className="entity-aliases"><span>Autres noms</span> {entity.aliases.join(' · ')}</p>
        )}
        <Tags tags={entity.tags} />
      </header>
      <div className="article-rule" aria-hidden="true"><span>✦</span></div>
      <div className="markdown-body">
        {entity.bodyMarkdown.trim() ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            skipHtml
            components={{
              a: ({ href, title, children }) => {
                const path = internalPagePath(href)
                return path
                  ? <InternalLink href={path} onNavigate={onNavigate}>{children}</InternalLink>
                  : <a href={href} title={title}>{children}</a>
              },
            }}
          >
            {entity.bodyMarkdown}
          </ReactMarkdown>
        ) : (
          <p className="muted-copy">Cette fiche ne contient pas encore de texte détaillé.</p>
        )}
      </div>
      <footer className="entity-footer">
        <span>Dernière mise à jour : {formatDate(entity.updatedAt)}</span>
      </footer>
    </article>
  )
}

function RelationList({ relations, direction, onNavigate }: {
  relations: EntityRelationItem[]
  direction: 'outgoing' | 'incoming'
  onNavigate: NavigateLink
}) {
  return (
    <section className="relation-group">
      <h3>{direction === 'outgoing' ? 'Relations sortantes' : 'Relations entrantes'}</h3>
      {relations.length === 0 ? (
        <p className="relation-empty">Aucune relation {direction === 'outgoing' ? 'sortante' : 'entrante'} publiée.</p>
      ) : (
        <ul className="relation-list">
          {relations.map((relation) => {
            const label = direction === 'outgoing' || relation.relationType.symmetric
              ? relation.relationType.label
              : relation.relationType.inverseLabel ?? relation.relationType.inverseCode ?? relation.relationType.label
            return (
              <li key={relation.id}>
                <span className="relation-label">{label}</span>
                <InternalLink
                  href={`/fiches/${encodeURIComponent(relation.entity.slug)}`}
                  onNavigate={onNavigate}
                  className="relation-link"
                >
                  {relation.entity.title}<span aria-hidden="true">↗</span>
                </InternalLink>
                <span className="relation-kind">{kindLabel(relation.entity.kind)}</span>
                {relation.description && <p>{relation.description}</p>}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function RelationsPanel({ entity, onNavigate }: { entity: EntityDetail; onNavigate: NavigateLink }) {
  const count = entity.outgoingRelations.length + entity.incomingRelations.length
  return (
    <aside id="relations" className="relations-panel" aria-label="Relations de la fiche">
      <div className="panel-heading relations-heading">
        <span className="panel-index">02 / Connexions</span>
        <h2>Relations</h2>
        <p>{count === 0 ? 'Aucun lien publié pour cette fiche.' : `${count} lien${count > 1 ? 's' : ''} avec le Codex.`}</p>
      </div>
      <RelationList relations={entity.outgoingRelations} direction="outgoing" onNavigate={onNavigate} />
      <RelationList relations={entity.incomingRelations} direction="incoming" onNavigate={onNavigate} />
    </aside>
  )
}

function PublicApp() {
  const [route, setRoute] = useState<Route>(readRoute)
  const [apiState, setApiState] = useState<ApiState>('checking')
  const [selectedKind, setSelectedKind] = useState<EntityKind | null>(null)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [listState, setListState] = useState<LoadState<EntityListItem[]>>({ key: '', phase: 'loading' })
  const [detailState, setDetailState] = useState<LoadState<EntityDetail>>({ key: '', phase: 'loading' })
  const mainRef = useRef<HTMLElement>(null)
  const focusAfterNavigation = useRef(false)

  const effectiveSearch = search.trim().length >= 2 ? search.trim() : ''
  const listKey = JSON.stringify([selectedKind, debouncedSearch])
  const activeSlug = route.view === 'entity' ? route.slug : null

  useEffect(() => {
    const onPopState = () => {
      focusAfterNavigation.current = true
      setRoute(readRoute())
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    if (focusAfterNavigation.current) {
      mainRef.current?.focus()
      focusAfterNavigation.current = false
    }
  }, [route])

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(effectiveSearch), 320)
    return () => window.clearTimeout(timer)
  }, [effectiveSearch])

  useEffect(() => {
    const controller = new AbortController()
    setApiState('checking')
    getJson<HealthResponse>('/api/v1/health', controller.signal)
      .then((health) => {
        if (!controller.signal.aborted) {
          setApiState(health.status === 'ok' && health.database === 'ok' ? 'online' : 'offline')
        }
      })
      .catch(() => { if (!controller.signal.aborted) setApiState('offline') })
    return () => controller.abort()
  }, [refresh])

  useEffect(() => {
    if (route.view !== 'library') return
    const controller = new AbortController()
    const params = new URLSearchParams()
    if (selectedKind) params.set('kind', selectedKind)
    if (debouncedSearch) params.set('q', debouncedSearch)
    const url = `/api/v1/entities${params.size ? `?${params}` : ''}`
    setListState({ key: listKey, phase: 'loading' })
    getJson<EntityListItem[]>(url, controller.signal)
      .then((data) => { if (!controller.signal.aborted) setListState({ key: listKey, phase: 'ready', data }) })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setListState({ key: listKey, phase: 'error', error: toLoadError(error) })
      })
    return () => controller.abort()
  }, [route.view, selectedKind, debouncedSearch, listKey, refresh])

  useEffect(() => {
    if (!activeSlug) return
    const controller = new AbortController()
    setDetailState({ key: activeSlug, phase: 'loading' })
    getJson<EntityDetail>(`/api/v1/entities/${encodeURIComponent(activeSlug)}`, controller.signal)
      .then((data) => { if (!controller.signal.aborted) setDetailState({ key: activeSlug, phase: 'ready', data }) })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setDetailState({ key: activeSlug, phase: 'error', error: toLoadError(error) })
      })
    return () => controller.abort()
  }, [activeSlug, refresh])

  useEffect(() => {
    document.title = detailState.phase === 'ready' && detailState.key === activeSlug
      ? `${detailState.data.title} · Hesta Codex`
      : 'Hesta Codex'
  }, [activeSlug, detailState])

  function navigate(href: string, focus = true) {
    if (window.location.pathname === href) return
    focusAfterNavigation.current = focus
    window.history.pushState(null, '', href)
    setRoute(readRoute())
  }

  function onNavigate(event: MouseEvent<HTMLAnchorElement>, href: string) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigate(href)
  }

  function onKindChange(kind: EntityKind | null) {
    setSelectedKind(kind)
    setFiltersOpen(false)
    navigate('/')
  }

  function onSearchChange(value: string) {
    setSearch(value)
    navigate('/', false)
  }

  const apiLabel = apiState === 'checking' ? 'Vérification de l’API' : apiState === 'online' ? 'API disponible' : 'API indisponible'
  const listIsCurrent = listState.key === listKey && effectiveSearch === debouncedSearch
  const detailIsCurrent = detailState.key === activeSlug
  const detail = route.view === 'entity' && detailIsCurrent && detailState.phase === 'ready' ? detailState.data : null

  return (
    <div className="codex-shell">
      <a className="skip-link" href="#main-content">Aller au contenu</a>
      <header className="site-header">
        <InternalLink href="/" onNavigate={onNavigate} className="site-brand" label="Hesta Codex, accueil">
          <span className="brand-sigil" aria-hidden="true">H</span>
          <span className="brand-wordmark"><small>HESTA <span aria-hidden="true">·</span></small><strong>Hesta Codex</strong></span>
        </InternalLink>
        <div className="header-actions">
          <InternalLink href="/" onNavigate={onNavigate} className="hub-link">Bibliothèque</InternalLink>
          <InternalLink href="/graphe" onNavigate={onNavigate} className="hub-link">Graphe</InternalLink>
          <a className="hub-link" href="/admin">Administration</a>
          <a className="hub-link" href="https://hesta.dannytech.fr/">Portail Hesta <span aria-hidden="true">↗</span></a>
          <span className={`api-state api-state--${apiState}`} role="status" aria-live="polite">
            <span className="api-dot" aria-hidden="true" />{apiLabel}
          </span>
        </div>
      </header>

      <div className={`workspace${route.view === 'entity' ? ' workspace--detail' : ''}${route.view === 'graph' ? ' workspace--graph' : ''}`}>
        {route.view !== 'graph' && <LibraryPanel
          search={search}
          selectedKind={selectedKind}
          open={filtersOpen}
          onOpenChange={setFiltersOpen}
          onSearchChange={onSearchChange}
          onKindChange={onKindChange}
        />}

        <main id="main-content" className="main-panel" ref={mainRef} tabIndex={-1}>
          {route.view === 'graph' && <Suspense fallback={<LoadingView label="Chargement du graphe…" />}>
            <GraphPage endpoint="/api/v1/graph" onOpenNode={(slug) => navigate(`/fiches/${slug}`)} />
          </Suspense>}
          {route.view === 'library' && (
            <>
              <div className="view-heading">
                <div>
                  <span className="section-eyebrow">Le savoir du Monde d’Hesta</span>
                  <h1>Bibliothèque</h1>
                  <p className="view-subtitle">Explorer les fiches publiques et suivre leurs liens.</p>
                </div>
                {listIsCurrent && listState.phase === 'ready' && (
                  <p className="result-count" aria-live="polite">
                    {listState.data.length} fiche{listState.data.length > 1 ? 's' : ''} affichée{listState.data.length > 1 ? 's' : ''}
                    {listState.data.length === 100 && <small>Limite actuelle de l’API</small>}
                  </p>
                )}
              </div>
              {(selectedKind || effectiveSearch) && (
                <div className="active-filters" aria-label="Filtres actifs">
                  <span>Sélection</span>
                  {selectedKind && <span className="filter-pill">{kindLabel(selectedKind)}</span>}
                  {effectiveSearch && <span className="filter-pill">« {effectiveSearch} »</span>}
                </div>
              )}
              {!listIsCurrent || listState.phase === 'loading' ? (
                <LoadingView label="Chargement de la bibliothèque…" />
              ) : listState.phase === 'error' ? (
                <ErrorView error={listState.error} onRetry={() => setRefresh((value) => value + 1)} />
              ) : (
                <LibraryView
                  entities={listState.data}
                  selectedKind={selectedKind}
                  query={effectiveSearch}
                  onNavigate={onNavigate}
                />
              )}
            </>
          )}

          {route.view === 'entity' && (
            !detailIsCurrent || detailState.phase === 'loading' ? (
              <LoadingView label="Chargement de la fiche…" />
            ) : detailState.phase === 'error' ? (
              <>
                <InternalLink href="/" onNavigate={onNavigate} className="back-link"><span aria-hidden="true">←</span> Retour à la bibliothèque</InternalLink>
                <ErrorView error={detailState.error} entity onRetry={() => setRefresh((value) => value + 1)} />
              </>
            ) : (
              <EntityArticle entity={detailState.data} onNavigate={onNavigate} />
            )
          )}

          {route.view === 'not-found' && (
            <>
              <InternalLink href="/" onNavigate={onNavigate} className="back-link"><span aria-hidden="true">←</span> Retour à la bibliothèque</InternalLink>
              <EmptyView title="Page introuvable" description="Cette adresse ne correspond à aucune page du Codex." pageHeading />
            </>
          )}
        </main>

        {detail && <RelationsPanel entity={detail} onNavigate={onNavigate} />}
      </div>
    </div>
  )
}

export function App() {
  return window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/')
    ? <AdminApp />
    : <PublicApp />
}
