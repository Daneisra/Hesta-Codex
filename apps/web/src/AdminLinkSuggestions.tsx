import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import type { LinkSuggestion, LinkSuggestionScan, LinkSuggestionBatchResult } from '@hesta-codex/shared'
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
  const [selected, setSelected] = useState<Set<string>>(new Set()), [batchReview, setBatchReview] = useState(false)
  const readController = useRef<AbortController | null>(null), applying = useRef(false), mounted = useRef(true)
  const callbacks = useRef({ onAccessError, onPendingChange, onDirtyChange, onChanged })
  callbacks.current = { onAccessError, onPendingChange, onDirtyChange, onChanged }
  const scan = useCallback(async (page = 1) => {
    readController.current?.abort(); const controller = new AbortController(); readController.current = controller
    setLoading(true); setStale(true); setError(''); setReview(null); setBatchReview(false); setConfirmed(false); setSelected(new Set())
    try {
      const result = await postAdminJson<LinkSuggestionScan>('/api/admin/link-suggestions/scan', { page }, controller.signal)
      if (!controller.signal.aborted) { setData(result); setStale(false); setHidden(new Set()) }
    } catch (error) { if (!controller.signal.aborted) {
      const status = errorStatus(error); if (status === 401 || status === 403) { setData(null); callbacks.current.onAccessError(status) }
      setError(error instanceof HttpError && status === 503 ? error.message : 'Scan indisponible. Réessayez. Aucune modification effectuée.')
    } } finally { if (!controller.signal.aborted) setLoading(false) }
  }, [])
  useEffect(() => { mounted.current = true; void scan(); return () => { mounted.current = false; readController.current?.abort() } }, [scan])
  async function apply(groups: LinkSuggestion[], batch = false) {
    if (applying.current || !confirmed || stale || loading) return
    if (!groups.length) return
    applying.current = true; setBusy(true); setError(''); callbacks.current.onPendingChange(true); callbacks.current.onDirtyChange(true)
    try {
      let message: string
      if (batch) {
        const result = await postAdminJson<LinkSuggestionBatchResult>('/api/admin/link-suggestions/apply-batch', {
          ids: groups.map(item => item.id), fingerprint: groups[0]!.fingerprint, confirm: true })
        message = `${result.connections} connexion(s) validée(s) · ${result.occurrences} mention(s) liée(s) · ${result.entities} fiche(s) modifiée(s), avec une révision par fiche.`
      } else {
        const item = groups[0]!
        await postAdminJson('/api/admin/link-suggestions/apply', { id: item.id, fingerprint: item.fingerprint, confirm: true })
        message = `Liens ajoutés dans « ${item.from.title} » avec une nouvelle révision.`
      }
      if (mounted.current) { setNotice(message); callbacks.current.onChanged(); await scan() }
    } catch (error) { if (mounted.current) {
      const status = errorStatus(error)
      if (status === 401 || status === 403) { setData(null); setSelected(new Set()); setReview(null); setBatchReview(false); callbacks.current.onAccessError(status) }
      setStale(true); setConfirmed(false)
      setError(`${error instanceof HttpError ? error.message : 'Enregistrement impossible.'} Relancez le scan pour vérifier l’état actuel avant de réessayer.`)
    } } finally {
      applying.current = false; callbacks.current.onPendingChange(false); callbacks.current.onDirtyChange(false)
      if (mounted.current) setBusy(false)
    }
  }
  const items = data?.items.filter(item => !hidden.has(item.id)) ?? []
  const selectedItems = items.filter(item => selected.has(item.id))
  const selectedOccurrences = selectedItems.flatMap(item => item.occurrences.map(occurrence => ({ item, occurrence })))
  const selectedSources = new Set(selectedItems.map(item => item.from.id)).size
  function changeSelection(next: Set<string>) {
    setSelected(next); setBatchReview(false); setReview(null); setConfirmed(false)
  }
  return <section className="admin-link-suggestions">
    <a className="admin-back" href="/admin" onClick={event => onNavigate(event, '/admin')}>← Tableau de bord</a>
    <h1>Connexions suggérées</h1>
    <p>Mentions sans connexion existante dans ce sens et wikilinks non résolus à réparer. Le scan est en lecture seule : chaque ajout ou correction exige votre validation.</p>
    <p className="admin-muted">Code, liens déjà résolus et images sont exclus. Une connexion inverse ne masque pas les mentions à lier dans cette fiche. Aucune relation éditoriale n’est créée.</p>
    <button type="button" disabled={busy || loading} onClick={() => void scan()}>{loading ? 'Analyse des fiches…' : 'Relancer le scan'}</button>
    {notice && <p className="admin-message" role="status">{notice}</p>}
    {error && <p role="alert" className="admin-form-error">{error}</p>}
    {data && <p role="status">{data.entities} fiches analysées · {data.connections} connexions proposées · {data.occurrences} mentions à lier · {data.repairs ?? 0} wikilinks à réparer · {data.ambiguous} mentions ambiguës · {data.existing} mentions déjà connectées</p>}
    {data && !data.connections && !loading && <p>Aucune nouvelle connexion à proposer.</p>}
    {items.length > 0 && <div className="admin-link-selection">
      <label><input type="checkbox" checked={selectedItems.length === items.length}
        ref={input => { if (input) input.indeterminate = selectedItems.length > 0 && selectedItems.length < items.length }}
        disabled={busy || loading || stale} onChange={event => changeSelection(new Set(event.target.checked ? items.map(item => item.id) : []))} /> Tout sélectionner sur cette page</label>
      <span role="status">{selectedItems.length} connexion(s) sélectionnée(s) · {selectedOccurrences.length} mention(s) · {selectedSources} fiche(s)</span>
      <button type="button" disabled={!selectedItems.length || busy || loading || stale} onClick={() => {
        setBatchReview(true); setReview(null); setConfirmed(false); setPreviewCount(30)
      }}>Examiner la sélection ({selectedItems.length})</button>
      <p className="admin-muted">Sélection limitée à cette page (30 connexions maximum). Un changement de page ou un nouveau scan efface la sélection.</p>
    </div>}
    {batchReview && selectedItems.length > 0 && <section className="admin-link-review" aria-label="Validation groupée">
      <h2>Valider les connexions sélectionnées</h2>
      <p>{selectedItems.length} connexion(s) · {selectedOccurrences.length} mention(s) · {selectedSources} fiche(s). Une seule révision par fiche ; en cas d’erreur, toute la sélection est annulée.</p>
      <ul>{selectedItems.map(item => <li key={item.id}>{item.from.title} → {item.to.title} · {item.occurrences.length} mention(s)</li>)}</ul>
      {selectedItems.some(item => item.from.status === 'PUBLISHED' && item.from.visibility === 'PUBLIC') && <p className="admin-warning">La sélection contient des fiches publiques : l’enregistrement modifiera immédiatement leur contenu visible. Les destinations restent soumises à leurs permissions.</p>}
      {selectedOccurrences.some(({ occurrence }) => occurrence.repair) && <p className="admin-warning">La sélection contient des wikilinks non résolus dont la destination sera corrigée après votre confirmation.</p>}
      <h3>Avant / après</h3>
      {selectedOccurrences.slice(0, previewCount).map(({ item, occurrence }, index) => <details key={`${item.id}-${occurrence.start}`} open={index < 3}>
        <summary>{item.from.title} → {item.to.title} · {occurrence.repair ? 'Wikilink à réparer' : 'Mention'} {index + 1} : {occurrence.text}</summary>
        <p>{occurrence.before}<mark>{occurrence.text}</mark>{occurrence.after}</p>
        <pre>{occurrence.before}{occurrence.wikilink}{occurrence.after}</pre>
      </details>)}
      {previewCount < selectedOccurrences.length && <button type="button" disabled={busy} onClick={() => setPreviewCount(count => count + 30)}>Afficher les mentions suivantes avant validation</button>}
      <label><input type="checkbox" checked={confirmed} disabled={busy || loading || stale || previewCount < selectedOccurrences.length}
        onChange={event => setConfirmed(event.target.checked)} /> J’ai vérifié la sélection, les mentions et leurs destinations. Ajouter ou corriger ces liens et créer les révisions.</label>
      <div className="admin-editor-actions"><button type="button" disabled={busy} onClick={() => { setBatchReview(false); setConfirmed(false) }}>Annuler</button>
        <button type="button" className="admin-primary-button" disabled={!confirmed || busy || loading || stale}
          onClick={() => void apply(selectedItems, true)}>{busy ? 'Enregistrement…' : 'Valider les connexions sélectionnées'}</button></div>
    </section>}
    <ul className="admin-connection-list">{items.map(item => <li key={item.id} className="admin-section">
      <label className="admin-link-choice"><input type="checkbox" checked={selected.has(item.id)} disabled={busy || loading || stale} onChange={event => {
        const next = new Set(selected); if (event.target.checked) next.add(item.id); else next.delete(item.id); changeSelection(next)
      }} /> Sélectionner {item.from.title} → {item.to.title}</label>
      <h2><a href={`/admin/fiches/${item.from.slug}`} onClick={event => onNavigate(event, `/admin/fiches/${item.from.slug}`)}>{item.from.title}</a>
        {' → '}<a href={`/admin/fiches/${item.to.slug}`} onClick={event => onNavigate(event, `/admin/fiches/${item.to.slug}`)}>{item.to.title}</a></h2>
      <p>{item.occurrences.length} mention(s) · /{item.from.slug} → /{item.to.slug}</p>
      {item.occurrences.some(occurrence => occurrence.repair) && <p className="admin-warning">Des wikilinks déjà écrits ne sont pas résolus. Leur destination sera corrigée vers cette fiche après votre confirmation.</p>}
      <button type="button" disabled={busy || loading || stale} onClick={() => { setReview(review === item.id ? null : item.id); setBatchReview(false); setConfirmed(false); setPreviewCount(30) }}> {review === item.id ? 'Fermer l’aperçu' : 'Examiner et lier'}</button>
      <button type="button" disabled={busy || loading} onClick={() => { setHidden(current => new Set([...current, item.id])); const next = new Set(selected); next.delete(item.id); changeSelection(next) }}>Masquer pour ce scan</button>
      {review === item.id && <div className="admin-link-review">
        <h3>Avant / après</h3><p>Seules ces mentions seront liées ou leurs wikilinks corrigés. Le reste du texte est conservé.</p>
        {item.occurrences.slice(0, previewCount).map((occurrence, index) => <details key={occurrence.start} open={index < 3}><summary>{occurrence.repair ? 'Wikilink à réparer' : 'Mention'} {index + 1} : {occurrence.text}</summary>
          <p>{occurrence.before}<mark>{occurrence.text}</mark>{occurrence.after}</p>
          <pre>{occurrence.before}{occurrence.wikilink}{occurrence.after}</pre>
        </details>)}
        {previewCount < item.occurrences.length && <button type="button" onClick={() => setPreviewCount(count => count + 30)}>Afficher les mentions suivantes avant validation</button>}
        {item.from.status === 'PUBLISHED' && item.from.visibility === 'PUBLIC' && <p className="admin-warning">Cette fiche est publique : l’enregistrement modifiera immédiatement son contenu visible. La destination restera soumise à ses permissions.</p>}
        <label><input type="checkbox" checked={confirmed} disabled={busy || stale || previewCount < item.occurrences.length} onChange={event => setConfirmed(event.target.checked)} /> J’ai vérifié les mentions et la destination. Ajouter ces liens et créer une révision.</label>
        <div className="admin-editor-actions"><button type="button" disabled={busy} onClick={() => { setReview(null); setConfirmed(false) }}>Annuler</button>
          <button type="button" className="admin-primary-button" disabled={!confirmed || busy || loading || stale} onClick={() => void apply([item])}>{busy ? 'Enregistrement…' : 'Ajouter les liens validés'}</button></div>
      </div>}
    </li>)}</ul>
    {data && data.connections > data.pageSize && <div className="admin-pagination"><button type="button" disabled={busy || loading || data.page === 1} onClick={() => void scan(data.page - 1)}>Précédent</button>
      <span>Page {data.page}</span><button type="button" disabled={busy || loading || data.page * data.pageSize >= data.connections} onClick={() => void scan(data.page + 1)}>Suivant</button></div>}
    {!!data?.ambiguous && <details><summary>Mentions ambiguës ({data.ambiguous})</summary><p>Plusieurs fiches correspondent. Précisez les titres ou alias et relancez le scan ; aucune cible n’est choisie automatiquement. Jusqu’à 30 exemples sont affichés.</p>
      <ul>{data.ambiguities.map((item, index) => <li key={index}>{item.from.title} : « {item.text} » — {item.candidates.join(', ')}</li>)}</ul></details>}
  </section>
}
