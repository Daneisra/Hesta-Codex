import { useEffect, useRef, useState, type MouseEvent } from 'react'
import type { EntityKind, QualificationFilters, QualificationResponse, QualificationRow, QualificationState } from '@hesta-codex/shared'
import { decideReference, errorStatus, getAdminJson } from './admin-http'
import type { ReferenceRelationSeed } from './reference-relation'
import { AdminQualificationRelationEditor } from './AdminQualificationRelationEditor'
import { entityKindName } from '@hesta-codex/shared'

const noop = () => {}

export const qualificationLabels: Record<QualificationState, string> = {
  PENDING: 'À qualifier', QUALIFIED: 'Qualifiée', IGNORED: 'Ignorée volontairement',
}
const kinds: EntityKind[] = ['PERSON', 'PLAYER_CHARACTER', 'PLACE', 'ORGANIZATION', 'FAMILY', 'RELIGION', 'DEITY', 'SPECIES', 'CREATURE',
  'ARTIFACT', 'EVENT', 'QUEST', 'SESSION', 'CONCEPT', 'OTHER']
const diagnosticLabels: Record<string, string> = { MISSING: 'Absentes', AMBIGUOUS: 'Ambiguës',
  UNASSOCIATED: 'Sans fiche associée', UNSUPPORTED: 'Non prises en charge', OUT_OF_SCOPE: 'Hors périmètre', RESOLVED: 'Ancres à revoir' }
export function AdminReferenceQueue({ filters, onFilters, onNavigate, onDefine, onAccessError, onDirtyChange = noop, onPendingChange = noop }: {
  filters: QualificationFilters; onFilters: (filters: QualificationFilters) => void
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, path: string) => void
  onDefine: (seed: ReferenceRelationSeed, fromSlug: string) => void
  onAccessError: (status: number) => void
  onDirtyChange?: (dirty: boolean) => void; onPendingChange?: (pending: boolean) => void
}) {
  const [data, setData] = useState<QualificationResponse | null>(null)
  const [loading, setLoading] = useState(true), [message, setMessage] = useState(''), [failed, setFailed] = useState(false)
  const [refresh, setRefresh] = useState(0), [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<{ rowId: string; relationId: string } | null>(null)
  const locked = busy || editing !== null
  const pending = useRef(false), alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const request = new URLSearchParams(Object.entries({ ...filters, q: filters.q?.trim() }).filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => [key, String(value)])).toString()
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setFailed(false)
    const timer = window.setTimeout(() => {
      getAdminJson<QualificationResponse>(`/api/admin/reference-qualifications?${request}`, controller.signal).then(result => {
        if (!controller.signal.aborted) { setData(result); setLoading(false) }
      }).catch(error => {
        if (controller.signal.aborted) return
        const status = errorStatus(error)
        setLoading(false); setFailed(true); setData(null)
        if (status === 401 || status === 403) onAccessError(status)
      })
    }, 180)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [request, refresh, onAccessError])
  const change = (patch: Partial<QualificationFilters>) => onFilters({ ...filters, ...patch, page: 1 })
  const link = (slug: string, title: string) => <a href={`/admin/fiches/${slug}`}
    onClick={event => { if (busy) event.preventDefault(); else onNavigate(event, `/admin/fiches/${slug}`) }}>{title}</a>
  async function decide(row: QualificationRow, ignore: boolean) {
    if (pending.current || loading) return
    pending.current = true; setBusy(true); setMessage('')
    try {
      await decideReference({ fromEntityId: row.from.id, toEntityId: row.to.id, fingerprint: row.fingerprint,
        expectedDecisionRevision: row.decisionRevision, ignore })
      if (alive.current) { setMessage(ignore ? 'Référence ignorée. La mention automatique est conservée.' : 'Décision révoquée.'); setRefresh(value => value + 1) }
    } catch (error) {
      if (!alive.current) return
      const status = errorStatus(error)
      if (status === 401 || status === 403) onAccessError(status)
      else { setMessage(status === 409 ? 'Référence ou décision modifiée. La liste va être actualisée : examinez-la avant de réessayer.' :
        'Décision non confirmée. Actualisez pour vérifier son état avant de réessayer.'); setRefresh(value => value + 1) }
    } finally { pending.current = false; if (alive.current) setBusy(false) }
  }
  return <section className="admin-section reference-queue">
    <a href="/admin" onClick={event => onNavigate(event, '/admin')}>← Tableau de bord</a>
    <h1>Relations à qualifier</h1>
    <p>Mentions Obsidian dirigées, regroupées par paire de fiches. Toute qualification sémantique reste une décision humaine.</p>
    {data && <p className="qualification-counts" aria-label="Compteurs globaux">{data.counts.total} connexions ·
      {' '}{data.counts.PENDING} à qualifier · {data.counts.QUALIFIED} qualifiées · {data.counts.IGNORED} ignorées</p>}
    <div className="admin-filters">
      <label>Rechercher une référence<input type="search" maxLength={100} value={filters.q ?? ''}
        onChange={event => change({ q: event.target.value })} placeholder="Titre, alias ou slug" disabled={locked} /></label>
      <label>Afficher<select value={filters.view ?? 'references'} disabled={locked} onChange={event => change({ view: event.target.value as QualificationFilters['view'] })}>
        <option value="references">Références résolues</option><option value="diagnostics">Diagnostics techniques</option></select></label>
      <label>État<select value={filters.state ?? ''} disabled={locked || filters.view === 'diagnostics'} onChange={event => change({ state: event.target.value as QualificationState || undefined })}>
        <option value="">Tous</option>{Object.entries(qualificationLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
    </div>
    <details><summary>Filtres avancés</summary><div className="admin-filters">
      <label>Type de fiche<select value={filters.kind ?? ''} disabled={locked} onChange={event => change({ kind: event.target.value as EntityKind || undefined })}>
        <option value="">Tous</option>{kinds.map(kind => <option key={kind} value={kind}>{entityKindName(kind)}</option>)}</select></label>
      <label>Source<select value={filters.sourceId ?? ''} disabled={locked} onChange={event => change({ sourceId: event.target.value || undefined })}>
        <option value="">Toutes</option>{filters.sourceId && !data?.sources.some(source => source.id === filters.sourceId) &&
          <option value={filters.sourceId}>Source sélectionnée indisponible</option>}
        {data?.sources.map(source => <option key={source.id} value={source.id}>{source.label} · {source.id}</option>)}</select></label>
      <label>Autour de la fiche<select value={filters.entityId ?? ''} disabled={locked} onChange={event => change({ entityId: event.target.value || undefined, direction: 'all' })}>
        <option value="">Toutes</option>{filters.entityId && !data?.entities.some(entity => entity.id === filters.entityId) &&
          <option value={filters.entityId}>Fiche sélectionnée indisponible</option>}
        {data?.entities.map(entity => <option key={entity.id} value={entity.id}>{entity.title} · /{entity.slug}</option>)}</select></label>
      <label>Direction<select value={filters.direction ?? 'all'} disabled={locked || !filters.entityId || filters.view === 'diagnostics'}
        onChange={event => change({ direction: event.target.value as QualificationFilters['direction'] })}>
        <option value="all">Entrantes et sortantes</option><option value="outgoing">Sortantes</option><option value="incoming">Entrantes</option></select></label>
      <label>Trier par<select value={filters.sort ?? 'mentions'} disabled={locked || filters.view === 'diagnostics'} onChange={event => change({ sort: event.target.value as QualificationFilters['sort'] })}>
        <option value="mentions">Nombre de mentions</option><option value="name">Nom</option><option value="state">État</option></select></label>
    </div></details>
    <button type="button" disabled={locked} onClick={() => setRefresh(value => value + 1)}>Actualiser la file</button>
    {message && <p role="status">{message}</p>}
    {loading && <p role="status">Chargement des références…</p>}
    {failed && <p role="alert">File indisponible. Réessayez avec « Actualiser la file ».</p>}
    {!loading && !failed && data && <>
      {filters.view === 'diagnostics' ? <>
        <p>Ces diagnostics ne sont pas des références à qualifier. Aucun choix de fiche automatique.
          {' '}{Object.entries(data.diagnosticCounts).map(([key, count]) => `${diagnosticLabels[key] ?? key} : ${count}`).join(' · ')} (totaux globaux)</p>
        <ul className="reference-rows">{data.diagnostics.map((diagnostic, index) => <li key={index}>
          {link(diagnostic.entity.slug, diagnostic.entity.title)} · <strong>{diagnostic.target}{diagnostic.anchor && `#${diagnostic.anchor}`}</strong>
          <p>{diagnostic.message} · {diagnostic.occurrences} occurrence(s)</p></li>)}</ul>
      </> : <ul className="reference-rows">{data.items.map(row => <li key={row.id}>
        <div className="reference-row-heading">{link(row.from.slug, row.from.title)} <span aria-label="mentionne">→</span> {link(row.to.slug, row.to.title)}
          <span>{row.occurrences} occurrence(s)</span><span className="admin-badge">{qualificationLabels[row.state]}</span></div>
        <p className="admin-muted">/{row.from.slug} → /{row.to.slug}</p>
        {row.stale && <p>La note ou son identité a changé : ancienne décision à revoir.</p>}
        {row.ignoredBy && <p className="admin-muted">Décision d’ignorance : {row.ignoredBy} · {new Date(row.ignoredAt!).toLocaleString('fr-FR')}</p>}
        <details><summary>Examiner la référence et sa provenance</summary>
          <p>UUID : {row.from.id} → {row.to.id}</p>
          {row.origins.length ? row.origins.map(origin => <p key={`${origin.sourceId}:${origin.path}`}>
            {origin.sourceLabel} · {origin.path} · {origin.sourceId}</p>) : <p>Provenance indisponible.</p>}
          {row.origins.length > 1 && <p>Plusieurs origines : vérifier manuellement la Source lors de la création.</p>}
          <p>Consultez la fiche source pour lire le Markdown original et ses preuves.</p>
        </details>
        {row.relations.map(relation => {
          const from = relation.fromEntityId === row.from.id ? row.from : row.to
          const to = relation.toEntityId === row.to.id ? row.to : row.from
          const text = `${from.title} ${relation.relationType.label} ${to.title}`
          return <div key={relation.id}>
            <div className="reference-row-heading"><span>Relation éditoriale : <strong>{text}</strong></span>
              <span className="admin-badge">{relation.status} · {relation.visibility}</span>
              {relation.status !== 'ARCHIVED' && row.from.status !== 'ARCHIVED' && row.to.status !== 'ARCHIVED' &&
                <button type="button" disabled={locked} aria-label={`Modifier la relation : ${text}`}
                  onClick={() => { setMessage(''); setEditing({ rowId: row.id, relationId: relation.id }) }}>Modifier la relation</button>}
            </div>
            <p className="admin-muted">Sens éditorial : /{from.slug} {relation.relationType.symmetric ? '↔' : '→'} /{to.slug}</p>
            {editing?.rowId === row.id && editing.relationId === relation.id &&
              <AdminQualificationRelationEditor key={relation.id} row={row} relationId={relation.id}
                onClose={() => setEditing(null)} onSaved={() => {
                  setEditing(null); setMessage('Relation modifiée. Actualisation de la file…'); setRefresh(value => value + 1)
                }} onAccessError={onAccessError} onDirtyChange={onDirtyChange} onPendingChange={onPendingChange} />}
          </div>
        })}
        <div className="reference-actions">
          {row.from.id !== row.to.id && row.from.status !== 'ARCHIVED' && row.to.status !== 'ARCHIVED' &&
            <button type="button" disabled={locked} onClick={() => onDefine({ fromId: row.from.id, toId: row.to.id,
              toSlug: row.to.slug, returnSlug: row.from.slug, returnTitle: 'Relations à qualifier', returnPath: '/admin/relations-a-qualifier' }, row.from.slug)}>
              {row.state === 'QUALIFIED' ? 'Ajouter un autre type de relation' : 'Définir une relation'}</button>}
          {row.state === 'PENDING' && <button type="button" disabled={locked} onClick={() => void decide(row, true)}>Ignorer volontairement</button>}
          {row.decisionRevision && <button type="button" disabled={locked} onClick={() => void decide(row, false)}>Révoquer l’ignorance</button>}
          {row.from.id === row.to.id && <span className="admin-muted">Auto-référence : création éditoriale indisponible.</span>}
        </div>
      </li>)}</ul>}
      {!data.total && <p>Aucun résultat pour ces filtres.</p>}
      <div className="admin-pagination"><button type="button" disabled={locked || data.page <= 1} onClick={() => onFilters({ ...filters, page: data.page - 1 })}>Précédent</button>
        <span>{data.total} résultat(s) · Page {data.page} / {Math.max(1, Math.ceil(data.total / data.pageSize))}</span>
        <button type="button" disabled={locked || data.page * data.pageSize >= data.total} onClick={() => onFilters({ ...filters, page: data.page + 1 })}>Suivant</button></div>
    </>}
  </section>
}
