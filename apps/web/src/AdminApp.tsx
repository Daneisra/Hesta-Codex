import { useEffect, useRef, useState, type MouseEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type {
  AdminEntityDetail, AdminEntityListResponse, AdminEvidence, AdminRelation, AdminStats,
  AuthSessionResponse, EditorialStatus, EntityKind, Visibility,
} from '@hesta-codex/shared'
import './Admin.css'

type AdminRoute = { view: 'dashboard' } | { view: 'entity'; slug: string } | { view: 'not-found' }
type Load<T> = { phase: 'loading' } | { phase: 'ready'; data: T } | { phase: 'error'; status: number | null }
const detailPath = /^\/admin\/fiches\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/
const statuses: EditorialStatus[] = ['DRAFT', 'PROPOSED', 'PUBLISHED', 'ARCHIVED']
const visibilities: Visibility[] = ['PUBLIC', 'PLAYERS', 'GM', 'SECRET']
const kinds: EntityKind[] = [
  'PERSON', 'PLACE', 'ORGANIZATION', 'FAMILY', 'RELIGION', 'DEITY', 'SPECIES',
  'CREATURE', 'ARTIFACT', 'EVENT', 'QUEST', 'SESSION', 'CONCEPT', 'OTHER',
]
const statusLabels: Record<EditorialStatus, string> = {
  DRAFT: 'Brouillon', PROPOSED: 'Proposée', PUBLISHED: 'Publiée', ARCHIVED: 'Archivée',
}
const visibilityLabels: Record<Visibility, string> = {
  PUBLIC: 'Public', PLAYERS: 'Joueurs', GM: 'MJ', SECRET: 'Secret',
}

function readRoute(): AdminRoute {
  if (window.location.pathname === '/admin' || window.location.pathname === '/admin/') return { view: 'dashboard' }
  const match = detailPath.exec(window.location.pathname)
  return match ? { view: 'entity', slug: match[1] } : { view: 'not-found' }
}

class HttpError extends Error {
  constructor(readonly status: number) { super(`HTTP ${status}`) }
}

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    signal, credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new HttpError(response.status)
  return response.json() as Promise<T>
}

function errorStatus(error: unknown): number | null {
  return error instanceof HttpError ? error.status : null
}

function safeUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch { return null }
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function StateMessage({ children }: { children: string }) {
  return <p className="admin-message" role="status">{children}</p>
}

function EvidenceList({ evidence }: { evidence: AdminEvidence[] }) {
  if (evidence.length === 0) return <p className="admin-muted">Aucune preuve liée.</p>
  return <ul className="admin-evidence-list">{evidence.map((item) => (
    <li key={item.id}>
      <p className="admin-claim">{item.claimText}</p>
      <p className="admin-muted">
        Source : {item.source.label} · {item.source.kind}
        {item.source.authorLabel && <> · Auteur : {item.source.authorLabel}</>}
        {item.source.externalId && <> · ID externe : {item.source.externalId}</>}
      </p>
      {item.source.url && safeUrl(item.source.url) && (
        <a href={safeUrl(item.source.url)!} target="_blank" rel="noopener noreferrer">Ouvrir la source ↗</a>
      )}
      {item.sourceExcerpt && <blockquote>{item.sourceExcerpt}</blockquote>}
      {(item.locator || item.timeStartSeconds !== null || item.timeEndSeconds !== null) && (
        <p className="admin-muted">
          {item.locator && <>Repère : {item.locator}</>}
          {item.timeStartSeconds !== null && <> · Début : {item.timeStartSeconds} s</>}
          {item.timeEndSeconds !== null && <> · Fin : {item.timeEndSeconds} s</>}
        </p>
      )}
      {item.confidence !== null && <p className="admin-muted">Confiance : {item.confidence}</p>}
    </li>
  ))}</ul>
}

function RelationSection({ title, relations, direction, onNavigate }: {
  title: string
  relations: AdminRelation[]
  direction: 'outgoing' | 'incoming'
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, path: string) => void
}) {
  return <section className="admin-section">
    <h3>{title} <span className="admin-count">{relations.length}</span></h3>
    {relations.length === 0 ? <p className="admin-muted">Aucune relation.</p> : (
      <ul className="admin-relation-list">{relations.map((relation) => (
        <li key={relation.id}>
          <div className="admin-relation-line">
            <span>{direction === 'incoming' && !relation.relationType.symmetric
              ? relation.relationType.inverseLabel ?? relation.relationType.inverseCode ?? relation.relationType.label
              : relation.relationType.label}</span>
            <a href={`/admin/fiches/${relation.entity.slug}`} onClick={(event) => onNavigate(event, `/admin/fiches/${relation.entity.slug}`)}>
              {relation.entity.title}
            </a>
            <span className="admin-badge">{statusLabels[relation.status]} · {visibilityLabels[relation.visibility]}</span>
          </div>
          {relation.description && <p>{relation.description}</p>}
          <EvidenceList evidence={relation.evidence} />
        </li>
      ))}</ul>
    )}
  </section>
}

function Detail({ entity, onNavigate }: {
  entity: AdminEntityDetail
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, path: string) => void
}) {
  return <article className="admin-detail">
    <a className="admin-back" href="/admin" onClick={(event) => onNavigate(event, '/admin')}>← Tableau de bord</a>
    <div className="admin-detail-header">
      <p className="admin-eyebrow">Fiche éditoriale · {entity.kind}{entity.placeKind ? ` / ${entity.placeKind}` : ''}</p>
      <h1>{entity.title}</h1>
      <p className="admin-muted">/{entity.slug} · Mise à jour {dateLabel(entity.updatedAt)}</p>
      <div className="admin-badges">
        <span className="admin-badge">{statusLabels[entity.status]}</span>
        <span className="admin-badge">{visibilityLabels[entity.visibility]}</span>
      </div>
    </div>
    <section className="admin-section">
      <h2>Contenu</h2>
      {entity.summary && <p className="admin-summary">{entity.summary}</p>}
      {entity.aliases.length > 0 && <p><strong>Alias :</strong> {entity.aliases.join(' · ')}</p>}
      {entity.tags.length > 0 && <p><strong>Tags :</strong> {entity.tags.join(' · ')}</p>}
      <div className="markdown-body admin-markdown">
        {entity.bodyMarkdown.trim() ? <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{entity.bodyMarkdown}</ReactMarkdown>
          : <p className="admin-muted">Aucun contenu détaillé.</p>}
      </div>
    </section>
    <section className="admin-section"><h2>Provenance</h2><EvidenceList evidence={entity.evidence} /></section>
    <div className="admin-relations">
      <RelationSection title="Relations sortantes" direction="outgoing" relations={entity.outgoingRelations} onNavigate={onNavigate} />
      <RelationSection title="Relations entrantes" direction="incoming" relations={entity.incomingRelations} onNavigate={onNavigate} />
    </div>
    <section className="admin-section">
      <h2>Historique</h2>
      {entity.revisions.length === 0 ? <p className="admin-muted">Aucune révision.</p> : (
        <ol className="admin-revision-list">{entity.revisions.map((revision) => (
          <li key={revision.id}>
            <p><strong>Revision #{revision.number}</strong> · {dateLabel(revision.createdAt)}</p>
            <p className="admin-muted">{revision.editorLabel ?? 'Éditeur non renseigné'}{revision.message ? ` · ${revision.message}` : ''}</p>
            <details><summary>Consulter le snapshot</summary><pre>{JSON.stringify(revision.snapshot, null, 2)}</pre></details>
          </li>
        ))}</ol>
      )}
    </section>
  </article>
}

export function AdminApp() {
  const [route, setRoute] = useState<AdminRoute>(readRoute)
  const [session, setSession] = useState<Load<AuthSessionResponse>>({ phase: 'loading' })
  const [stats, setStats] = useState<Load<AdminStats>>({ phase: 'loading' })
  const [list, setList] = useState<Load<AdminEntityListResponse>>({ phase: 'loading' })
  const [detail, setDetail] = useState<Load<AdminEntityDetail>>({ phase: 'loading' })
  const [listFor, setListFor] = useState('')
  const [detailFor, setDetailFor] = useState<string | null>(null)
  const [status, setStatus] = useState<EditorialStatus | ''>('')
  const [visibility, setVisibility] = useState<Visibility | ''>('')
  const [kind, setKind] = useState<EntityKind | ''>('')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [refresh, setRefresh] = useState(0)
  const mainRef = useRef<HTMLElement>(null)
  const focusAfterNavigation = useRef(false)

  const isAdmin = session.phase === 'ready' && session.data.authenticated && session.data.isAdmin
  const activeSlug = route.view === 'entity' ? route.slug : null
  const listKey = JSON.stringify([status, visibility, kind, query, page])

  useEffect(() => {
    const onPop = () => { focusAfterNavigation.current = true; setRoute(readRoute()) }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    if (focusAfterNavigation.current) {
      mainRef.current?.focus()
      focusAfterNavigation.current = false
    }
  }, [route])

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim().length >= 2 ? search.trim() : ''), 320)
    return () => window.clearTimeout(timer)
  }, [search])

  useEffect(() => {
    const controller = new AbortController()
    setSession({ phase: 'loading' })
    getJson<AuthSessionResponse>('/api/auth/session', controller.signal)
      .then((data) => { if (!controller.signal.aborted) setSession({ phase: 'ready', data }) })
      .catch((error: unknown) => { if (!controller.signal.aborted) setSession({ phase: 'error', status: errorStatus(error) }) })
    return () => controller.abort()
  }, [refresh])

  useEffect(() => {
    if (!isAdmin) return
    const controller = new AbortController()
    setStats({ phase: 'loading' })
    getJson<AdminStats>('/api/admin/stats', controller.signal)
      .then((data) => { if (!controller.signal.aborted) setStats({ phase: 'ready', data }) })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        if (errorStatus(error) === 401) setSession({ phase: 'ready', data: { authenticated: false, isAdmin: false, user: null } })
        else if (errorStatus(error) === 403) setSession((current) => current.phase === 'ready' && current.data.authenticated
          ? { phase: 'ready', data: { ...current.data, isAdmin: false } } : current)
        else setStats({ phase: 'error', status: errorStatus(error) })
      })
    return () => controller.abort()
  }, [isAdmin, refresh])

  useEffect(() => {
    if (!isAdmin || route.view !== 'dashboard') return
    const controller = new AbortController()
    const params = new URLSearchParams({ page: String(page) })
    if (status) params.set('status', status)
    if (visibility) params.set('visibility', visibility)
    if (kind) params.set('kind', kind)
    if (query) params.set('q', query)
    setListFor(listKey)
    setList({ phase: 'loading' })
    getJson<AdminEntityListResponse>(`/api/admin/entities?${params}`, controller.signal)
      .then((data) => { if (!controller.signal.aborted) setList({ phase: 'ready', data }) })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        if (errorStatus(error) === 401) setSession({ phase: 'ready', data: { authenticated: false, isAdmin: false, user: null } })
        else if (errorStatus(error) === 403) setSession((current) => current.phase === 'ready' && current.data.authenticated
          ? { phase: 'ready', data: { ...current.data, isAdmin: false } } : current)
        else setList({ phase: 'error', status: errorStatus(error) })
      })
    return () => controller.abort()
  }, [isAdmin, route.view, status, visibility, kind, query, page, listKey, refresh])

  useEffect(() => {
    if (!isAdmin || !activeSlug) return
    const controller = new AbortController()
    setDetailFor(activeSlug)
    setDetail({ phase: 'loading' })
    getJson<AdminEntityDetail>(`/api/admin/entities/${encodeURIComponent(activeSlug)}`, controller.signal)
      .then((data) => { if (!controller.signal.aborted) setDetail({ phase: 'ready', data }) })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        if (errorStatus(error) === 401) setSession({ phase: 'ready', data: { authenticated: false, isAdmin: false, user: null } })
        else if (errorStatus(error) === 403) setSession((current) => current.phase === 'ready' && current.data.authenticated
          ? { phase: 'ready', data: { ...current.data, isAdmin: false } } : current)
        else setDetail({ phase: 'error', status: errorStatus(error) })
      })
    return () => controller.abort()
  }, [isAdmin, activeSlug, refresh])

  useEffect(() => { document.title = 'Administration · Hesta Codex' }, [])

  function onNavigate(event: MouseEvent<HTMLAnchorElement>, path: string) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    if (window.location.pathname !== path) {
      focusAfterNavigation.current = true
      window.history.pushState(null, '', path)
      setRoute(readRoute())
    }
  }

  async function logout() {
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', cache: 'no-store' })
      if (!response.ok) throw new Error('Logout failed')
      window.history.replaceState(null, '', '/admin')
      setRoute({ view: 'dashboard' })
      setSession({ phase: 'ready', data: { authenticated: false, isAdmin: false, user: null } })
    } catch { setSession({ phase: 'error', status: null }) }
  }

  const user = session.phase === 'ready' && session.data.authenticated ? session.data.user : null
  return <div className="admin-shell">
    <a className="skip-link" href="#admin-main">Aller au contenu</a>
    <header className="site-header admin-header">
      <a className="site-brand" href="/"><span className="brand-sigil" aria-hidden="true">H</span>
        <span className="brand-wordmark"><small>HESTA · CODEX</small><strong>Administration</strong></span></a>
      <div className="header-actions"><a className="hub-link" href="/">Bibliothèque publique</a>
        {user && <span className="admin-user">{user.displayName ?? user.username}</span>}
        {user && <button className="admin-logout" type="button" onClick={() => void logout()}>Se déconnecter</button>}
      </div>
    </header>
    <main id="admin-main" className="admin-main" ref={mainRef} tabIndex={-1}>
      {session.phase === 'loading' && <StateMessage>Vérification de la session…</StateMessage>}
      {session.phase === 'error' && <div className="admin-state" role="alert"><h1>Administration indisponible</h1>
        <p>Impossible de vérifier la session pour le moment.</p><button type="button" onClick={() => setRefresh((value) => value + 1)}>Réessayer</button></div>}
      {session.phase === 'ready' && !session.data.authenticated && <div className="admin-state">
        <p className="admin-eyebrow">Espace réservé</p><h1>Administration Hesta Codex</h1>
        <p>Connectez-vous pour consulter les propositions et leur provenance.</p>
        <a className="admin-primary-link" href="/api/auth/discord/login">Se connecter avec Discord</a>
      </div>}
      {session.phase === 'ready' && session.data.authenticated && !session.data.isAdmin && <div className="admin-state" role="alert">
        <h1>Accès refusé</h1><p>Ce compte Discord ne figure pas parmi les administrateurs du Codex.</p>
      </div>}
      {isAdmin && route.view === 'not-found' && <div className="admin-state"><h1>Page introuvable</h1><a href="/admin">Retour au tableau de bord</a></div>}
      {isAdmin && route.view === 'dashboard' && <>
        <div className="admin-page-heading"><p className="admin-eyebrow">Pilotage éditorial · lecture seule</p>
          <h1>Tableau de bord</h1><p>Explorer les fiches en attente de validation, leurs liens et leurs sources.</p></div>
        {stats.phase === 'loading' && <StateMessage>Chargement des statistiques…</StateMessage>}
        {stats.phase === 'error' && <p className="admin-message" role="alert">Statistiques indisponibles.</p>}
        {stats.phase === 'ready' && <div className="admin-stats" aria-label="Statistiques éditoriales">
          <div><strong>{stats.data.byStatus.PROPOSED}</strong><span>Fiches proposées</span></div>
          <div><strong>{stats.data.byStatus.PUBLISHED}</strong><span>Fiches publiées</span></div>
          <div><strong>{stats.data.sources}</strong><span>Sources</span></div>
          <div><strong>{stats.data.relations}</strong><span>Relations</span></div>
        </div>}
        <section className="admin-section admin-list-section"><div className="admin-section-title"><h2>Fiches</h2>
          {listFor === listKey && list.phase === 'ready' && <span>{list.data.total} résultat{list.data.total > 1 ? 's' : ''}</span>}</div>
          <div className="admin-filters">
            <label>Rechercher<input type="search" value={search} maxLength={100} placeholder="Titre, résumé ou slug"
              onChange={(event) => { setSearch(event.target.value); setPage(1) }} /></label>
            <label>Statut<select value={status} onChange={(event) => { setStatus(event.target.value as EditorialStatus | ''); setPage(1) }}>
              <option value="">Tous</option>{statuses.map((value) => <option value={value} key={value}>{statusLabels[value]}</option>)}
            </select></label>
            <label>Visibilité<select value={visibility} onChange={(event) => { setVisibility(event.target.value as Visibility | ''); setPage(1) }}>
              <option value="">Toutes</option>{visibilities.map((value) => <option value={value} key={value}>{visibilityLabels[value]}</option>)}
            </select></label>
            <label>Type<select value={kind} onChange={(event) => { setKind(event.target.value as EntityKind | ''); setPage(1) }}>
              <option value="">Tous</option>{kinds.map((value) => <option value={value} key={value}>{value}</option>)}
            </select></label>
          </div>
          {search.trim().length === 1 && <p className="admin-muted">Saisissez au moins 2 caractères pour rechercher.</p>}
          {(listFor !== listKey || list.phase === 'loading') && <StateMessage>Chargement des fiches…</StateMessage>}
          {listFor === listKey && list.phase === 'error' && <div role="alert" className="admin-message">Impossible de charger les fiches{list.status ? ` (erreur ${list.status})` : ''}.
            <button type="button" onClick={() => setRefresh((value) => value + 1)}>Réessayer</button></div>}
          {listFor === listKey && list.phase === 'ready' && (list.data.items.length === 0 ? <p className="admin-message">Aucune fiche pour ces filtres.</p> : <>
            <ul className="admin-entity-list">{list.data.items.map((entity) => <li key={entity.id}>
              <a href={`/admin/fiches/${entity.slug}`} onClick={(event) => onNavigate(event, `/admin/fiches/${entity.slug}`)}>
                <span className="admin-list-title">{entity.title}</span><span className="admin-muted">/{entity.slug} · {entity.kind}</span>
                {entity.summary && <span>{entity.summary}</span>}
                <span className="admin-badge">{statusLabels[entity.status]} · {visibilityLabels[entity.visibility]}</span>
              </a></li>)}</ul>
            <div className="admin-pagination"><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Précédent</button>
              <span>Page {page}</span><button type="button" disabled={page * list.data.pageSize >= list.data.total} onClick={() => setPage(page + 1)}>Suivant</button></div>
          </>)}
        </section>
      </>}
      {isAdmin && route.view === 'entity' && <>
        {(detailFor !== activeSlug || detail.phase === 'loading') && <StateMessage>Chargement de la fiche…</StateMessage>}
        {detailFor === activeSlug && detail.phase === 'error' && <div className="admin-state" role="alert"><h1>{detail.status === 404 ? 'Fiche introuvable' : 'Fiche indisponible'}</h1>
          <a href="/admin" onClick={(event) => onNavigate(event, '/admin')}>Retour au tableau de bord</a></div>}
        {detailFor === activeSlug && detail.phase === 'ready' && <Detail entity={detail.data} onNavigate={onNavigate} />}
      </>}
    </main>
  </div>
}
