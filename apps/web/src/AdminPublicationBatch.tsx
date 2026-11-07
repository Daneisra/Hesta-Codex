import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { publicationBatchLimit, type PublicationCandidate, type PublicationPreview, type PublicationResult, type Visibility } from '@hesta-codex/shared'
import { getAdminJson, postAdminJson, errorStatus, HttpError } from './admin-http'

const statusLabels = { DRAFT: 'Brouillon', PROPOSED: 'Proposée', PUBLISHED: 'Publiée', ARCHIVED: 'Archivée' }
const visibilityLabels = { PUBLIC: 'PUBLIC', PLAYERS: 'Joueurs', GM: 'MJ', SECRET: 'Secret' }
const outcomes = { READY: 'Prêts', BLOCKED: 'Bloqués', SKIPPED: 'Déjà publiés' } as const
export function AdminPublicationBatch(props: {
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, path: string) => void; onAccessError: (status: number) => void;
  onPendingChange: (pending: boolean) => void; onDirtyChange: (dirty: boolean) => void; onChanged: () => void
}) {
  const callbacks = useRef(props); callbacks.current = props
  const [candidates, setCandidates] = useState<PublicationCandidate[]>([])
  const [loading, setLoading] = useState(true), [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState(0), [selected, setSelected] = useState(new Set<string>())
  const [query, setQuery] = useState(''), [status, setStatus] = useState('PROPOSED'), [includeRelations, setIncludeRelations] = useState(false)
  const [operation, setOperation] = useState<'publish' | 'visibility'>('publish'), [targetVisibility, setTargetVisibility] = useState<Visibility | ''>('')
  const visibilityMode = operation === 'visibility'
  const [preview, setPreview] = useState<PublicationPreview | null>(null)
  const [confirmed, setConfirmed] = useState(false), [publicConfirmed, setPublicConfirmed] = useState(false)
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  const pending = useRef(false), mounted = useRef(false), read = useRef<AbortController | null>(null)
  const summary = useRef<HTMLHeadingElement>(null), previewButton = useRef<HTMLButtonElement>(null)
  function failure(error: unknown) {
    const code = errorStatus(error)
    if (code === 401 || code === 403) {
      setCandidates([]); setSelected(new Set()); setPreview(null); setLoaded(false)
      callbacks.current.onAccessError(code)
    }
    setError(error instanceof HttpError ? error.message : 'Opération indisponible. Réessayez après actualisation.')
  }
  useEffect(() => {
    mounted.current = true
    const controller = new AbortController(); read.current = controller
    setLoading(true); setLoaded(false); setError('')
    getAdminJson<PublicationCandidate[]>('/api/admin/publication-batches/candidates', controller.signal).then(rows => {
      if (!controller.signal.aborted) { setCandidates(rows); setLoaded(true) }
    }).catch(error => { if (!controller.signal.aborted) failure(error) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { mounted.current = false; controller.abort(); read.current?.abort() }
  }, [retry])
  useEffect(() => { callbacks.current.onDirtyChange(selected.size > 0); return () => callbacks.current.onDirtyChange(false) }, [selected])
  useEffect(() => { if (preview) summary.current?.focus({ preventScroll: true }) }, [preview])
  function invalidate() { setPreview(null); setConfirmed(false); setPublicConfirmed(false); setError('') }
  function changeSelection(next: Set<string>) {
    if (next.size > publicationBatchLimit) { invalidate(); setError(`${publicationBatchLimit} fiches maximum par opération. Réduisez la sélection.`); return }
    invalidate(); setSelected(next)
  }
  const visible = candidates.filter(row => (!status || row.status === status) &&
    `${row.title} ${row.slug}`.normalize('NFC').toLocaleLowerCase('fr').includes(query.normalize('NFC').toLocaleLowerCase('fr').trim()))
  const selection = { entityIds: [...selected].sort(), includeRelations, ...(visibilityMode && targetVisibility ? { targetVisibility } : {}) }
  async function prepare() {
    if (pending.current || !selected.size || loading || visibilityMode && !targetVisibility) return
    pending.current = true; setLoading(true); invalidate(); setNotice('')
    const controller = new AbortController(); read.current = controller
    try {
      const result = await postAdminJson<PublicationPreview>('/api/admin/publication-batches/preview', selection, controller.signal)
      if (mounted.current && !controller.signal.aborted) setPreview(result)
    } catch (error) { if (mounted.current && !controller.signal.aborted) failure(error) }
    finally { pending.current = false; if (mounted.current) setLoading(false) }
  }
  async function apply() {
    if (pending.current || !preview || !confirmed || preview.counts.publicElements > 0 && !publicConfirmed) return
    pending.current = true; setBusy(true); setError(''); callbacks.current.onPendingChange(true)
    try {
      const result = await postAdminJson<PublicationResult>('/api/admin/publication-batches/apply', {
        ...selection, fingerprint: preview.fingerprint, confirm: true, confirmPublic: publicConfirmed,
      })
      if (mounted.current) {
        setNotice(visibilityMode
          ? `Visibilité modifiée pour ${result.entities} fiche(s) et ${result.relations} relation(s). Statuts conservés.`
          : `${result.entities} fiche(s) et ${result.relations} relation(s) validées. Visibilités conservées.`)
        setSelected(new Set()); setPreview(null); setConfirmed(false); setPublicConfirmed(false)
        callbacks.current.onChanged(); setRetry(value => value + 1)
      }
    } catch (error) { if (mounted.current) { setPreview(null); setConfirmed(false); setPublicConfirmed(false); failure(error) } }
    finally { pending.current = false; callbacks.current.onPendingChange(false); if (mounted.current) setBusy(false) }
  }
  const disabled = loading || busy
  return <section className="admin-publication-batch">
    <a className="admin-back" aria-disabled={busy} href="/admin" onClick={event => {
      if (busy) event.preventDefault(); else props.onNavigate(event, '/admin')
    }}>← Tableau de bord</a>
    <h1>Validation groupée</h1>
    {visibilityMode ? <>
      <p>Changer la visibilité des fiches sélectionnées et, au choix, de leurs relations. Les statuts et dates de publication sont conservés.</p>
      <p className="admin-muted">Seules les fiches déjà publiées deviennent visibles en passant en PUBLIC. Les relations exigent aussi deux fiches publiques et publiées. Le passage en PUBLIC demande une confirmation supplémentaire.</p>
    </> : <>
      <p>Valider les fiches sélectionnées et, au choix, leurs relations admissibles. Les visibilités sont conservées : une fiche MJ reste privée.</p>
      <p className="admin-muted">Aucune visibilité ne passe automatiquement en PUBLIC. Les éléments déjà marqués PUBLIC exigent une confirmation supplémentaire.</p>
    </>}
    {notice && <p role="status" className="admin-message">{notice}</p>}
    {error && <p role="alert" className="admin-form-error">{error} Recalculez le bilan avant toute nouvelle confirmation.</p>}
    <button type="button" disabled={disabled} onClick={() => { invalidate(); setSelected(new Set()); setRetry(value => value + 1) }}>Actualiser les fiches</button>
    <fieldset disabled={disabled} className="admin-section">
      <legend>Sélection des fiches</legend>
      <div className="admin-filters">
        <label>Opération<select value={operation} onChange={event => { invalidate(); setOperation(event.target.value as 'publish' | 'visibility'); setTargetVisibility('') }}>
          <option value="publish">Valider en conservant les visibilités</option>
          <option value="visibility">Changer la visibilité de la sélection</option>
        </select></label>
        {visibilityMode && <label>Nouvelle visibilité<select value={targetVisibility} onChange={event => { invalidate(); setTargetVisibility(event.target.value as Visibility | '') }}>
          <option value="">Choisir une visibilité</option>{Object.entries(visibilityLabels).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
        </select></label>}
      </div>
      <div className="admin-filters">
        <label>Rechercher une fiche<input type="search" maxLength={200} value={query} onChange={event => setQuery(event.target.value)} /></label>
        <label>Statut<select value={status} onChange={event => setStatus(event.target.value)}>
          <option value="">Tous</option>{Object.entries(statusLabels).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
        </select></label>
      </div>
      <p role="status">{selected.size} fiche(s) sélectionnée(s) · {visible.length} affichée(s). Maximum {publicationBatchLimit} par opération.</p>
      <p className="admin-muted">Les choix restent sélectionnés lorsque vous changez les filtres. {visibilityMode
        ? 'Choisissez le statut « Publiée » ou « Tous » pour inclure les fiches déjà validées.'
        : 'Sélectionnez aussi les fiches déjà publiées pour valider uniquement leurs relations.'}</p>
      <label className="admin-link-choice"><input type="checkbox" disabled={!visible.length || disabled}
        checked={visible.length > 0 && visible.every(row => selected.has(row.id))}
        ref={input => { if (input) input.indeterminate = visible.some(row => selected.has(row.id)) && !visible.every(row => selected.has(row.id)) }}
        onChange={event => { const next = new Set(selected); for (const row of visible) { if (event.target.checked) next.add(row.id); else next.delete(row.id) } changeSelection(next) }} /> Tout sélectionner parmi les fiches affichées</label>
      <button type="button" disabled={!selected.size} onClick={() => changeSelection(new Set())}>Effacer la sélection</button>
      {loading && <p role="status">Chargement du catalogue ou du bilan…</p>}
      {loaded && !visible.length && <p>Aucune fiche pour ces filtres.</p>}
      <ul className="admin-bulk-candidates">{visible.map(row => <li key={row.id}><label className="admin-link-choice">
        <input type="checkbox" checked={selected.has(row.id)} onChange={event => { const next = new Set(selected); if (event.target.checked) next.add(row.id); else next.delete(row.id); changeSelection(next) }} />
        <span><strong>{row.title}</strong> · /{row.slug} · {statusLabels[row.status]} · {visibilityLabels[row.visibility]}</span>
      </label></li>)}</ul>
      <label className="admin-link-choice"><input type="checkbox" checked={includeRelations} onChange={event => { invalidate(); setIncludeRelations(event.target.checked) }} /> Inclure les relations entrantes et sortantes admissibles</label>
      <p className="admin-muted">Une relation est incluse une seule fois. {visibilityMode
        ? 'Les fiches voisines hors sélection et les preuves gardent leur visibilité. Les éléments archivés restent en lecture seule.'
        : 'Ses deux fiches doivent être déjà publiées ou validables dans cette sélection.'} Aucun wikilink n’est transformé en relation éditoriale.</p>
      <button type="button" ref={previewButton} disabled={!selected.size || !loaded || visibilityMode && !targetVisibility} onClick={() => void prepare()}>Examiner le bilan</button>
    </fieldset>
    {preview && <section className="admin-section admin-link-review" aria-label="Bilan de validation groupée">
      <h2 tabIndex={-1} ref={summary}>Bilan avant validation</h2>
      <p role="status">{preview.counts.entitiesReady} fiche(s) prête(s) · {preview.counts.relationsReady} relation(s) prête(s).</p>
      <p>{preview.counts.entitiesBlocked + preview.counts.relationsBlocked} élément(s) bloqué(s) · {preview.counts.entitiesSkipped + preview.counts.relationsSkipped} {visibilityMode ? 'déjà à cette visibilité' : 'déjà publié(s)'}. Ces éléments restent inchangés.</p>
      {preview.targetVisibility && <p>Visibilité cible : <strong>{visibilityLabels[preview.targetVisibility]}</strong>. Aucun statut ne change.</p>}
      {preview.visibilityImpact && <div className="admin-message">
        <p>Effet immédiat dans la bibliothèque publique : {preview.visibilityImpact.publicEntities} fiche(s) et {preview.visibilityImpact.publicRelations} relation(s) deviendront visibles ; {preview.visibilityImpact.hiddenEntities} fiche(s) et {preview.visibilityImpact.hiddenRelations} relation(s) seront masquées.</p>
        <p>Ce bilan inclut les effets sur les relations déjà publiées PUBLIC, même sans modification de leur visibilité. Le contenu et les images des fiches devenues publiques seront accessibles.</p>
      </div>}
      {Object.entries(outcomes).map(([outcome, label]) => <details key={outcome} open={outcome === 'BLOCKED'}>
        <summary>{visibilityMode && outcome === 'SKIPPED' ? 'Déjà à cette visibilité' : label} ({preview.entities.filter(row => row.outcome === outcome).length + preview.relations.filter(row => row.outcome === outcome).length})</summary>
        <ul>{preview.entities.filter(row => row.outcome === outcome).map(row => <li key={row.id}>
          Fiche : {row.title} · /{row.slug} · {visibilityLabels[row.visibility]}{preview.targetVisibility && row.outcome === 'READY' ? ` → ${visibilityLabels[preview.targetVisibility]}` : ''} · {row.evidence} preuve(s). {row.reason}
        </li>)}{preview.relations.filter(row => row.outcome === outcome).map(row => <li key={row.id}>
          Relation : {row.from.title} ({row.from.slug}) {row.label} {row.to.title} ({row.to.slug}) · {visibilityLabels[row.visibility]}{preview.targetVisibility && row.outcome === 'READY' ? ` → ${visibilityLabels[preview.targetVisibility]}` : ''} · {row.evidence} preuve(s). {row.reason}
        </li>)}</ul>
      </details>)}
      {!!preview.counts.publicElements && <div className="admin-warning">
        <p>{preview.counts.publicElements} élément(s) prêt(s) {visibilityMode ? 'passeront en PUBLIC. Seuls les éléments publiés peuvent devenir visibles.' : 'sont déjà marqués PUBLIC. Les fiches concernées deviendront publiques ; les relations seront visibles si leurs deux fiches sont publiques et publiées.'}</p>
        <label><input type="checkbox" disabled={busy} checked={publicConfirmed} onChange={event => setPublicConfirmed(event.target.checked)} /> {visibilityMode ? 'Je confirme explicitement le passage en PUBLIC des éléments prêts.' : 'Je confirme explicitement la publication des éléments déjà marqués PUBLIC.'}</label>
      </div>}
      <label><input type="checkbox" disabled={busy} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> J’ai vérifié le bilan. {visibilityMode ? 'Changer uniquement les visibilités des éléments prêts en conservant leurs statuts.' : 'Valider uniquement les éléments prêts en conservant leurs visibilités.'}</label>
      <div className="admin-editor-actions"><button type="button" disabled={busy} onClick={() => { invalidate(); previewButton.current?.focus() }}>Annuler</button>
        <button type="button" className="admin-primary-button" disabled={busy || !confirmed || (!preview.counts.entitiesReady && !preview.counts.relationsReady) || !!preview.counts.publicElements && !publicConfirmed}
          onClick={() => void apply()}>{busy ? 'Validation en cours…' : visibilityMode ? 'Confirmer le changement de visibilité' : 'Confirmer la validation groupée'}</button></div>
    </section>}
  </section>
}
