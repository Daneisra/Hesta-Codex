import { useEffect, useRef, useState, type MouseEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type {
  AdminEntityDetail, AdminEntityListResponse, AdminEntityPatch, AdminStats,
  AuthSessionResponse, EditorialStatus, EntityKind, Visibility,
} from '@hesta-codex/shared'
import { AdminEditor } from './AdminEditor'
import { AdminProvenance } from './AdminProvenance'
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
  constructor(readonly status: number, message = `HTTP ${status}`, readonly code?: string) { super(message) }
}

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    signal, credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new HttpError(response.status)
  return response.json() as Promise<T>
}

async function mutateJson<T>(url: string, method: 'PATCH' | 'POST', body: unknown): Promise<T> {
  const response = await fetch(url, {
    method, credentials: 'same-origin', cache: 'no-store',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { message?: unknown; code?: unknown } } | null
    const message = payload?.error?.message
    const code = payload?.error?.code
    throw new HttpError(response.status, typeof message === 'string' ? message : `HTTP ${response.status}`,
      typeof code === 'string' ? code : undefined)
  }
  return response.json() as Promise<T>
}

function errorStatus(error: unknown): number | null {
  return error instanceof HttpError ? error.status : null
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function StateMessage({ children }: { children: string }) {
  return <p className="admin-message" role="status">{children}</p>
}

function Detail({ entity, onNavigate, editing, provenanceEditing, busy, authExpired, error, onEdit, onCancel, onSave,
  onDirtyChange, onWorkflow, onReload, onProvenanceMutation, onProvenanceEditingChange }: {
  entity: AdminEntityDetail
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, path: string) => void
  editing: boolean
  provenanceEditing: boolean
  busy: boolean
  authExpired: boolean
  error: { status: number | null; message: string; code?: string } | null
  onEdit: () => void
  onCancel: () => void
  onSave: (input: AdminEntityPatch) => void
  onDirtyChange: (dirty: boolean) => void
  onWorkflow: (action: 'publish' | 'unpublish') => void
  onReload: () => void
  onProvenanceMutation: (path: string, method: 'PATCH' | 'POST', body: unknown) => Promise<boolean>
  onProvenanceEditingChange: (editing: boolean) => void
}) {
  return <article className="admin-detail">
    <a className="admin-back" href="/admin" onClick={(event) => onNavigate(event, '/admin')}>← Tableau de bord</a>
    <div className="admin-detail-header">
      <p className="admin-eyebrow">Fiche éditoriale · {entity.kind}{entity.placeKind ? ` / ${entity.placeKind}` : ''}</p>
      <h1>{entity.title}</h1>
      <p className="admin-muted">/{entity.slug} · Mise à jour {dateLabel(entity.updatedAt)}</p>
      {entity.publishedAt && <p className="admin-muted">Publiée le {dateLabel(entity.publishedAt)}</p>}
      <div className="admin-badges">
        <span className="admin-badge">{statusLabels[entity.status]}</span>
        <span className="admin-badge">{visibilityLabels[entity.visibility]}</span>
      </div>
      {!editing && !provenanceEditing && entity.status !== 'ARCHIVED' &&
        <button className="admin-edit-button" type="button" onClick={onEdit}>Modifier</button>}
    </div>
    {error && <div className="admin-form-error" role="alert">{error.message}
      {error.status === 409 && error.code?.endsWith('_MODIFIED') &&
        <button type="button" onClick={onReload}>Recharger la version récente</button>}
      {error.status === 401 && <a href="/api/auth/discord/login">Se reconnecter avec Discord</a>}
    </div>}
    {editing ? <AdminEditor entity={entity} busy={busy} saveDisabled={authExpired} error={null} onSave={onSave}
      onCancel={onCancel} onDirtyChange={onDirtyChange} /> : <section className="admin-section">
      <h2>Contenu</h2>
      {entity.summary && <p className="admin-summary">{entity.summary}</p>}
      {entity.aliases.length > 0 && <p><strong>Alias :</strong> {entity.aliases.join(' · ')}</p>}
      {entity.tags.length > 0 && <p><strong>Tags :</strong> {entity.tags.join(' · ')}</p>}
      <div className="markdown-body admin-markdown">
        {entity.bodyMarkdown.trim() ? <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{entity.bodyMarkdown}</ReactMarkdown>
          : <p className="admin-muted">Aucun contenu détaillé.</p>}
      </div>
    </section>}
    {!editing && !provenanceEditing && (entity.status === 'PROPOSED' || entity.status === 'PUBLISHED') &&
      <section className="admin-section admin-publication">
        <h2>Publication</h2>
        <p>Visibilité actuelle : <strong>{visibilityLabels[entity.visibility]}</strong>.</p>
        {entity.status === 'PROPOSED' ? <>
          <p>{entity.visibility === 'PUBLIC'
            ? 'Cette fiche deviendra visible publiquement après publication.'
            : 'Cette fiche sera validée mais restera invisible dans la bibliothèque publique.'}</p>
          <button className="admin-primary-button" type="button" disabled={busy}
            onClick={() => onWorkflow('publish')}>{busy ? 'Publication…' : 'Publier'}</button>
        </> : <>
          <p>{entity.visibility === 'PUBLIC'
            ? 'Cette fiche est visible dans la bibliothèque publique.'
            : 'Cette fiche est publiée mais reste invisible dans la bibliothèque publique.'}</p>
          <button type="button" disabled={busy} onClick={() => onWorkflow('unpublish')}>Retirer de la publication</button>
        </>}
      </section>}
    <AdminProvenance entity={entity} onNavigate={onNavigate} onMutate={onProvenanceMutation}
      onDirtyChange={onDirtyChange} onEditingChange={onProvenanceEditingChange} busy={busy} disabled={authExpired || editing} />
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
  const [dataRefresh, setDataRefresh] = useState(0)
  const [detailRefresh, setDetailRefresh] = useState(0)
  const [editing, setEditing] = useState(false)
  const [provenanceEditing, setProvenanceEditing] = useState(false)
  const [editDirty, setEditDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [authExpired, setAuthExpired] = useState(false)
  const [mutationError, setMutationError] = useState<{ status: number | null; message: string; code?: string } | null>(null)
  const mainRef = useRef<HTMLElement>(null)
  const focusAfterNavigation = useRef(false)
  const currentPath = useRef(window.location.pathname)
  const dirtyRef = useRef(false)
  dirtyRef.current = editDirty

  const isAdmin = session.phase === 'ready' && session.data.authenticated && session.data.isAdmin
  const activeSlug = route.view === 'entity' ? route.slug : null
  const listKey = JSON.stringify([status, visibility, kind, query, page])

  useEffect(() => {
    const onPop = () => {
      if (dirtyRef.current && !window.confirm('Quitter cette fiche et perdre les modifications non enregistrées ?')) {
        window.history.pushState(null, '', currentPath.current)
        return
      }
      currentPath.current = window.location.pathname
      setEditing(false)
      setProvenanceEditing(false)
      setEditDirty(false)
      setAuthExpired(false)
      focusAfterNavigation.current = true
      setRoute(readRoute())
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    if (!editDirty) return
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', protect)
    return () => window.removeEventListener('beforeunload', protect)
  }, [editDirty])

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
  }, [isAdmin, refresh, dataRefresh])

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
  }, [isAdmin, route.view, status, visibility, kind, query, page, listKey, refresh, dataRefresh])

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
  }, [isAdmin, activeSlug, refresh, detailRefresh])

  useEffect(() => { document.title = 'Administration · Hesta Codex' }, [])

  function onNavigate(event: MouseEvent<HTMLAnchorElement>, path: string) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    if (editDirty && !window.confirm('Quitter cette fiche et perdre les modifications non enregistrées ?')) return
    if (window.location.pathname !== path) {
      currentPath.current = path
      setEditing(false)
      setProvenanceEditing(false)
      setEditDirty(false)
      setAuthExpired(false)
      setMutationError(null)
      focusAfterNavigation.current = true
      window.history.pushState(null, '', path)
      setRoute(readRoute())
    }
  }

  async function logout() {
    if (editDirty && !window.confirm('Se déconnecter et perdre les modifications non enregistrées ?')) return
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', cache: 'no-store' })
      if (!response.ok) throw new Error('Logout failed')
      window.history.replaceState(null, '', '/admin')
      currentPath.current = '/admin'
      setEditing(false)
      setProvenanceEditing(false)
      setEditDirty(false)
      setRoute({ view: 'dashboard' })
      setSession({ phase: 'ready', data: { authenticated: false, isAdmin: false, user: null } })
    } catch { setSession({ phase: 'error', status: null }) }
  }

  function cancelEdit() {
    if (editDirty && !window.confirm('Annuler et perdre les modifications non enregistrées ?')) return
    setEditing(false)
    setProvenanceEditing(false)
    setEditDirty(false)
    setAuthExpired(false)
    setMutationError(null)
  }

  function mutationFailed(error: unknown) {
    const status = errorStatus(error)
    setBusy(false)
    if (status === 401) {
      setAuthExpired(editing || provenanceEditing)
      setMutationError({ status, message: 'Session expirée. Vos modifications restent affichées : copiez-les avant de vous reconnecter.' })
      setSession({ phase: 'ready', data: { authenticated: false, isAdmin: false, user: null } })
    } else if (status === 403) {
      setEditing(false)
      setProvenanceEditing(false)
      setEditDirty(false)
      setSession((current) => current.phase === 'ready' && current.data.authenticated
        ? { phase: 'ready', data: { ...current.data, isAdmin: false } } : current)
    } else {
      const code = error instanceof HttpError ? error.code : undefined
      setMutationError({ status, code, message: status === 409 && code?.endsWith('_MODIFIED')
        ? 'Cet objet a été modifié depuis son ouverture. Rechargez la version récente avant de réessayer.'
        : status === 409 && error instanceof HttpError ? error.message
        : status === 400 || status === 422 ? error instanceof HttpError ? error.message : 'Données invalides.'
          : `Impossible d’enregistrer la fiche${status ? ` (erreur ${status})` : ''}.` })
    }
  }

  function mutationSucceeded(updated: AdminEntityDetail) {
    setDetailFor(updated.slug)
    setDetail({ phase: 'ready', data: updated })
    setEditing(false)
    setProvenanceEditing(false)
    setEditDirty(false)
    setAuthExpired(false)
    setMutationError(null)
    setBusy(false)
    setDataRefresh((value) => value + 1)
  }

  async function save(input: AdminEntityPatch) {
    if (busy || authExpired || !activeSlug) return
    setBusy(true)
    setMutationError(null)
    try {
      mutationSucceeded(await mutateJson<AdminEntityDetail>(`/api/admin/entities/${encodeURIComponent(activeSlug)}`, 'PATCH', input))
    } catch (error) { mutationFailed(error) }
  }

  async function provenanceMutation(path: string, method: 'PATCH' | 'POST', body: unknown): Promise<boolean> {
    if (busy || authExpired || !activeSlug) return false
    setBusy(true)
    setMutationError(null)
    try {
      await mutateJson(path, method, body)
      setBusy(false)
      setMutationError(null)
      setDataRefresh((value) => value + 1)
      setDetailRefresh((value) => value + 1)
      return true
    } catch (error) { mutationFailed(error); return false }
  }

  async function workflow(action: 'publish' | 'unpublish') {
    if (busy || authExpired || detail.phase !== 'ready' || !activeSlug) return
    const entity = detail.data
    const message = action === 'publish'
      ? entity.visibility === 'PUBLIC'
        ? `Publier « ${entity.title} » ?\nCette fiche sera immédiatement visible dans la bibliothèque publique.`
        : `Valider « ${entity.title} » ?\nLa fiche sera marquée comme publiée mais restera invisible pour le public avec la visibilité ${visibilityLabels[entity.visibility]}.`
      : `Retirer « ${entity.title} » de la publication ?${entity.visibility === 'PUBLIC'
        ? '\nCette fiche disparaîtra immédiatement de la bibliothèque publique.' : ''}`
    if (!window.confirm(message)) return
    setBusy(true)
    setMutationError(null)
    try {
      mutationSucceeded(await mutateJson<AdminEntityDetail>(
        `/api/admin/entities/${encodeURIComponent(activeSlug)}/${action}`,
        'POST', { expectedUpdatedAt: entity.updatedAt },
      ))
    } catch (error) { mutationFailed(error) }
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
      {session.phase === 'ready' && !session.data.authenticated && !authExpired && <div className="admin-state">
        <p className="admin-eyebrow">Espace réservé</p><h1>Administration Hesta Codex</h1>
        <p>Connectez-vous pour consulter les propositions et leur provenance.</p>
        <a className="admin-primary-link" href="/api/auth/discord/login">Se connecter avec Discord</a>
      </div>}
      {session.phase === 'ready' && session.data.authenticated && !session.data.isAdmin && <div className="admin-state" role="alert">
        <h1>Accès refusé</h1><p>Ce compte Discord ne figure pas parmi les administrateurs du Codex.</p>
      </div>}
      {isAdmin && route.view === 'not-found' && <div className="admin-state"><h1>Page introuvable</h1><a href="/admin">Retour au tableau de bord</a></div>}
      {isAdmin && route.view === 'dashboard' && <>
        <div className="admin-page-heading"><p className="admin-eyebrow">Pilotage éditorial</p>
          <h1>Tableau de bord</h1><p>Explorer les fiches, leurs liens, leurs sources et leur état de publication.</p></div>
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
      {(isAdmin || (authExpired && (editing || provenanceEditing))) && route.view === 'entity' && <>
        {(detailFor !== activeSlug || detail.phase === 'loading') && <StateMessage>Chargement de la fiche…</StateMessage>}
        {detailFor === activeSlug && detail.phase === 'error' && <div className="admin-state" role="alert"><h1>{detail.status === 404 ? 'Fiche introuvable' : 'Fiche indisponible'}</h1>
          <a href="/admin" onClick={(event) => onNavigate(event, '/admin')}>Retour au tableau de bord</a></div>}
        {detailFor === activeSlug && detail.phase === 'ready' && <Detail entity={detail.data} onNavigate={onNavigate}
          editing={editing} provenanceEditing={provenanceEditing} busy={busy} authExpired={authExpired} error={mutationError}
          onEdit={() => { setMutationError(null); setEditing(true) }} onCancel={cancelEdit}
          onSave={(input) => void save(input)} onDirtyChange={setEditDirty}
          onProvenanceMutation={provenanceMutation} onProvenanceEditingChange={setProvenanceEditing}
          onWorkflow={(action) => void workflow(action)}
          onReload={() => {
            if (editDirty && !window.confirm('Recharger la fiche et perdre les modifications non enregistrées ?')) return
            setEditing(false)
            setProvenanceEditing(false)
            setEditDirty(false)
            setMutationError(null)
            setDetailRefresh((value) => value + 1)
          }} />}
      </>}
    </main>
  </div>
}
