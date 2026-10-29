import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import type { LinkSuggestion, LinkSuggestionScan } from '@hesta-codex/shared'
import { errorStatus, HttpError, postAdminJson } from './admin-http'

export function AdminLinkSuggestions({ onNavigate, onAccessError, onPendingChange, onDirtyChange, onChanged }: {
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, path: string) => void
  onAccessError: (status: number) => void; onPendingChange: (pending: boolean) => void
  onDirtyChange: (dirty: boolean) => void; onChanged: () => void
}) {
  const [data, setData] = useState<LinkSuggestionScan | null>(null), [loading, setLoading] = useState(false)
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [review, setReview] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [stale, setStale] = useState(false)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [previewCount, setPreviewCount] = useState(30)
  const readController = useRef<AbortController | null>(null), applying = useRef(false), mounted = useRef(true)
  const callbacks = useRef({ onAccessError, onPendingChange, onDirtyChange, onChanged })
  callbacks.current = { onAccessError, onPendingChange, onDirtyChange, onChanged }
  const scan = useCallback(async (page = 1) => {
    readController.current?.abort(); const controller = new AbortController(); readController.current = controller
    setLoading(true); setError(''); setReview(null); setConfirmed(false)
    try {
      const result = await postAdminJson<LinkSuggestionScan>('/api/admin/link-suggestions/scan', { page }, controller.signal)
      if (!controller.signal.aborted) { setData(result); setStale(false); setHidden(new Set()) }
    } catch (error) { if (!controller.signal.aborted) {
      const status = errorStatus(error); if (status === 401 || status === 403) { setData(null); callbacks.current.onAccessError(status) }
      setError(error instanceof HttpError && status === 503 ? error.message : 'Scan indisponible. Réessayez. Aucune modification effectuée.')
    } } finally { if (!controller.signal.aborted) setLoading(false) }
  }, [])
  useEffect(() => { mounted.current = true; void scan(); return () => { mounted.current = false; readController.current?.abort() } }, [scan])
  async function apply(item: LinkSuggestion) {
    if (applying.current || !confirmed || stale || loading) return
    applying.current = true; setBusy(true); setError(''); callbacks.current.onPendingChange(true); callbacks.current.onDirtyChange(true)
    try {
      await postAdminJson('/api/admin/link-suggestions/apply', { id: item.id, fingerprint: item.fingerprint, confirm: true })
      if (mounted.current) { setNotice(`Liens ajoutés dans « ${item.from.title} » avec une nouvelle révision.`); callbacks.current.onChanged(); await scan() }
    } catch (error) { if (mounted.current) {
      const status = errorStatus(error)
      if (status === 401 || status === 403) { setData(null); callbacks.current.onAccessError(status) }
      if (status === 409) setStale(true)
      setError(error instanceof HttpError ? error.message : 'Enregistrement impossible. Relancez le scan pour vérifier l’état actuel avant de réessayer.')
    } } finally {
      applying.current = false; callbacks.current.onPendingChange(false); callbacks.current.onDirtyChange(false)
      if (mounted.current) setBusy(false)
    }
  }
  const items = data?.items.filter(item => !hidden.has(item.id)) ?? []
  return <section className="admin-link-suggestions">
    <a className="admin-back" href="/admin" onClick={event => onNavigate(event, '/admin')}>← Tableau de bord</a>
    <h1>Connexions suggérées</h1>
    <p>Mentions de titres ou d’alias sans connexion existante. Le scan est en lecture seule : chaque ajout de wikilinks exige votre validation.</p>
    <p className="admin-muted">Code, liens et images existants sont exclus. Aucune relation éditoriale n’est créée. Les fiches archivées sont exclues des propositions.</p>
    <button type="button" disabled={busy || loading} onClick={() => void scan()}>{loading ? 'Analyse des fiches…' : 'Relancer le scan'}</button>
    {notice && <p className="admin-message" role="status">{notice}</p>}
    {error && <p role="alert" className="admin-form-error">{error}</p>}
    {data && <p role="status">{data.entities} fiches analysées · {data.connections} connexions proposées · {data.occurrences} mentions à lier · {data.ambiguous} mentions ambiguës · {data.existing} mentions déjà connectées</p>}
    {data && !data.connections && !loading && <p>Aucune nouvelle connexion à proposer.</p>}
    <ul className="admin-connection-list">{items.map(item => <li key={item.id} className="admin-section">
      <h2><a href={`/admin/fiches/${item.from.slug}`} onClick={event => onNavigate(event, `/admin/fiches/${item.from.slug}`)}>{item.from.title}</a>
        {' → '}<a href={`/admin/fiches/${item.to.slug}`} onClick={event => onNavigate(event, `/admin/fiches/${item.to.slug}`)}>{item.to.title}</a></h2>
      <p>{item.occurrences.length} mention(s) · /{item.from.slug} → /{item.to.slug}</p>
      <button type="button" disabled={busy || loading || stale} onClick={() => { setReview(review === item.id ? null : item.id); setConfirmed(false); setPreviewCount(30) }}> {review === item.id ? 'Fermer l’aperçu' : 'Examiner et lier'}</button>
      <button type="button" disabled={busy} onClick={() => setHidden(current => new Set([...current, item.id]))}>Masquer pour ce scan</button>
      {review === item.id && <div className="admin-link-review">
        <h3>Avant / après</h3><p>Seules ces mentions seront entourées de wikilinks. Le reste du texte est conservé.</p>
        {item.occurrences.slice(0, previewCount).map((occurrence, index) => <details key={occurrence.start} open={index < 3}><summary>Mention {index + 1} : {occurrence.text}</summary>
          <p>{occurrence.before}<mark>{occurrence.text}</mark>{occurrence.after}</p>
          <pre>{occurrence.before}{occurrence.wikilink}{occurrence.after}</pre>
        </details>)}
        {previewCount < item.occurrences.length && <button type="button" onClick={() => setPreviewCount(count => count + 30)}>Afficher les mentions suivantes avant validation</button>}
        {item.from.status === 'PUBLISHED' && item.from.visibility === 'PUBLIC' && <p className="admin-warning">Cette fiche est publique : l’enregistrement modifiera immédiatement son contenu visible. La destination restera soumise à ses permissions.</p>}
        <label><input type="checkbox" checked={confirmed} disabled={busy || stale || previewCount < item.occurrences.length} onChange={event => setConfirmed(event.target.checked)} /> J’ai vérifié les mentions et la destination. Ajouter ces liens et créer une révision.</label>
        <div className="admin-editor-actions"><button type="button" disabled={busy} onClick={() => { setReview(null); setConfirmed(false) }}>Annuler</button>
          <button type="button" className="admin-primary-button" disabled={!confirmed || busy || loading || stale} onClick={() => void apply(item)}>{busy ? 'Enregistrement…' : 'Ajouter les liens validés'}</button></div>
      </div>}
    </li>)}</ul>
    {data && data.connections > data.pageSize && <div className="admin-pagination"><button type="button" disabled={busy || loading || data.page === 1} onClick={() => void scan(data.page - 1)}>Précédent</button>
      <span>Page {data.page}</span><button type="button" disabled={busy || loading || data.page * data.pageSize >= data.connections} onClick={() => void scan(data.page + 1)}>Suivant</button></div>}
    {!!data?.ambiguous && <details><summary>Mentions ambiguës ({data.ambiguous})</summary><p>Plusieurs fiches correspondent. Précisez les titres ou alias et relancez le scan ; aucune cible n’est choisie automatiquement. Jusqu’à 30 exemples sont affichés.</p>
      <ul>{data.ambiguities.map((item, index) => <li key={index}>{item.from.title} : « {item.text} » — {item.candidates.join(', ')}</li>)}</ul></details>}
  </section>
}
