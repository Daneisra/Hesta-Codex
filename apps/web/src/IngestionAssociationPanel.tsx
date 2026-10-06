import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import type { IngestionAssociationEntity, IngestionAssociationState, IngestionMatches } from '@hesta-codex/shared'
import { errorStatus, getAdminJson, HttpError } from './admin-http'
import { kindLabels, placeLabels } from './graph-model'
import { IngestionEntityPicker } from './IngestionEntityPicker'
import { IngestionMatchesPanel } from './IngestionMatchesPanel'

type MatchesLoad = { phase: 'loading' } | { phase: 'error'; status: number | null } | { phase: 'ready'; data: IngestionMatches }
type Load = { key: string; phase: 'loading' } | { key: string; phase: 'error'; status: number | null } |
  { key: string; phase: 'ready'; data: IngestionAssociationState; candidatesKey: string }
type Pending = { action: 'confirm' | 'reject'; entity: IngestionAssociationEntity; origin: 'MATCH' | 'MANUAL' } | { action: 'reset' }
type PreparedDecision = Pending & { expectedRevision: number }
const date = (value: string) => new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
export function IngestionAssociationPanel({ itemId, receiptId, matches, onRetryMatches, onAccessError, onNavigate, onPrepare }: {
  itemId: string; receiptId: string; matches: MatchesLoad; onRetryMatches: () => void;
  onAccessError: (status: number) => void; onNavigate?: (event: MouseEvent<HTMLAnchorElement>, path: string) => void
  onPrepare?: () => void
}) {
  const [load, setLoad] = useState<Load>({ key: '', phase: 'loading' })
  const [refresh, setRefresh] = useState(0)
  const [picker, setPicker] = useState(false)
  const [pending, setPending] = useState<PreparedDecision | null>(null)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [failure, setFailure] = useState<string | null>(null)
  const [denied, setDenied] = useState(false)
  const write = useRef<AbortController | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const confirmationHeading = useRef<HTMLHeadingElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const restoreFocus = useRef(false)
  const candidateIds = JSON.stringify(matches.phase === 'ready' ? matches.data.candidates.map(candidate => candidate.id) : [])
  const url = `/api/admin/ingestion/items/${itemId}/association?receiptId=${receiptId}`
  const key = JSON.stringify([url, refresh])
  const accessError = useCallback((status: number) => { setDenied(true); setPending(null); setPicker(false); onAccessError(status) }, [onAccessError])
  useEffect(() => {
    const controller = new AbortController()
    // Changing only the candidate annotation header must preserve the manual picker/input.
    // Context changes or explicit refreshes still hide the previous association immediately.
    setLoad(previous => previous.key === key && previous.phase === 'ready' ? previous : { key, phase: 'loading' })
    getAdminJson<IngestionAssociationState>(url, controller.signal, { 'X-Hesta-Association-Candidates': candidateIds })
      .then(data => { if (!controller.signal.aborted) setLoad({ key, phase: 'ready', data, candidatesKey: candidateIds }) })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        const status = errorStatus(error)
        setLoad({ key, phase: 'error', status })
        if (status === 401 || status === 403) accessError(status)
      })
    return () => controller.abort()
  }, [url, key, candidateIds, refresh, accessError])
  useEffect(() => {
    setPending(null); setPicker(false); setFeedback(''); setFailure(null); setBusy(false); write.current = null
    return () => { write.current?.abort() }
  }, [url])
  useEffect(() => {
    if (pending) confirmationHeading.current?.focus()
    else if (restoreFocus.current) {
      restoreFocus.current = false
      const previous = opener.current
      if (previous?.isConnected && !(previous instanceof HTMLButtonElement && previous.disabled)) previous.focus()
      else heading.current?.focus()
    }
  }, [pending])
  const current: Load = load.key === key ? load : { key, phase: 'loading' }
  const requestDecision = (decision: Pending) => {
    if (write.current || current.phase !== 'ready') return
    if (decision.action === 'confirm' && decision.entity.id === current.data.confirmed?.entity.id) {
      setPicker(false); setFeedback('Cette fiche est déjà associée.'); heading.current?.focus(); return
    }
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setPending({ ...decision, expectedRevision: current.data.revision }); setFailure(null); setFeedback(''); setPicker(false)
  }
  const cancel = () => {
    if (write.current) return
    restoreFocus.current = true; setPending(null)
  }
  const submit = async () => {
    if (!pending || current.phase !== 'ready' || write.current) return
    const controller = new AbortController()
    write.current = controller
    setBusy(true); setFailure(null)
    const action = pending.action
    try {
      const body = { receiptId, expectedRevision: pending.expectedRevision,
        ...(pending.action !== 'reset' ? { entityId: pending.entity.id, origin: pending.origin } : {}) }
      const response = await fetch(`/api/admin/ingestion/items/${itemId}/association/${action}`, { method: 'POST',
        signal: controller.signal, credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) })
      if (!response.ok) throw new HttpError(response.status)
      // Reload all current candidate decisions; a mutation response only describes its target.
      await response.json()
      if (controller.signal.aborted) return
      setPending(null); setRefresh(value => value + 1)
      setFeedback(action === 'reset' ? 'Association retirée.' : action === 'reject' ? 'Suggestion rejetée.' : 'Association enregistrée.')
      heading.current?.focus()
    } catch (error) {
      if (controller.signal.aborted) return
      const status = errorStatus(error)
      if (status === 401 || status === 403) { accessError(status); return }
      setPending(null)
      setFailure(status === 409 ? 'Conflit de modification ou fiche devenue inadmissible. Rechargez les associations avant de réessayer.' :
        status === 404 ? 'Item, réception ou fiche introuvable. Rechargez les associations.' : 'Impossible d’enregistrer la décision. Rechargez les associations pour vérifier son état.')
      heading.current?.focus()
    } finally {
      if (!controller.signal.aborted) setBusy(false)
      if (write.current === controller) write.current = null
    }
  }
  if (denied) return <p role="alert">Accès aux associations interrompu.</p>
  const confirmed = current.phase === 'ready' ? current.data.confirmed : null
  const entityLink = (entity: IngestionAssociationEntity) => {
    const path = `/admin/fiches/${encodeURIComponent(entity.slug)}`
    return <a href={path} onClick={event => onNavigate?.(event, path)}>Ouvrir la fiche</a>
  }
  return <>
    <section className="ingestion-association" aria-labelledby="ingestion-association-heading" aria-busy={busy}>
      <h3 id="ingestion-association-heading" ref={heading} tabIndex={-1}>Association au Codex</h3>
      <p>L’association seule ne modifie aucune fiche, preuve ou publication.</p>
      {feedback && <p role="status">{feedback}</p>}
      {failure && <div role="alert"><p>{failure}</p><button type="button" disabled={busy} onClick={() => { setFailure(null); setRefresh(value => value + 1) }}>Recharger les associations</button></div>}
      {current.phase === 'loading' && <p role="status">Chargement de l’association…</p>}
      {current.phase === 'error' && <div role="alert"><p>{current.status === 404 ? 'Item ou réception introuvable.' : current.status === 409 ? 'Identité incompatible : association à vérifier.' : 'Impossible de charger l’association.'}</p>
        <button type="button" onClick={() => setRefresh(value => value + 1)}>Réessayer l’association</button></div>}
      {current.phase === 'ready' && <>
        <p>{current.data.scope === 'EXTERNAL_ID' ? 'Décision partagée entre les versions de cette identité externe.' : 'Décision limitée à ce snapshot sans identifiant externe.'}</p>
        {confirmed ? <div className="ingestion-confirmed">
          <h4>Association confirmée</h4><p><strong>{confirmed.entity.title}</strong></p>
          <p>{kindLabels[confirmed.entity.kind]}{confirmed.entity.placeKind ? ` · ${placeLabels[confirmed.entity.placeKind]}` : ''} · {confirmed.entity.slug}</p>
          <p>Confirmée par {confirmed.authorLabel} le {date(confirmed.decidedAt)}.</p>
          {current.data.invalid && <p role="alert">Association devenue invalide : la fiche est archivée. Changez ou retirez l’association.</p>}
          {entityLink(confirmed.entity)}
          {onPrepare && <p>Cette identité possède déjà une fiche dans le Codex. La création depuis cet item est indisponible.</p>}
          <div className="ingestion-association-actions"><button type="button" disabled={busy || !!pending || !!failure} onClick={() => setPicker(value => !value)}>Changer l’association</button>
            <button type="button" disabled={busy || !!pending || !!failure} onClick={() => requestDecision({ action: 'reset' })}>Retirer l’association</button></div>
        </div> : <><p>Aucune association confirmée.</p><button type="button" disabled={busy || !!pending || !!failure} onClick={() => setPicker(value => !value)}>Choisir une autre fiche</button>
          {onPrepare && <button type="button" disabled={busy || !!pending || !!failure} onClick={onPrepare}>Créer une fiche dans le Codex</button>}</>}
        {current.data.rejectedCount > 0 && <details><summary>Suggestions rejetées ({current.data.rejectedCount})</summary>
          <p>Les 20 décisions les plus récentes sont affichées. Tous les candidats actuels sont vérifiés séparément.</p>
          <ul>{current.data.recentRejections.map(rejection => <li key={rejection.entity.id}>{rejection.entity.title} · rejetée par {rejection.authorLabel} le {date(rejection.decidedAt)}.</li>)}</ul>
        </details>}
      </>}
      {picker && current.phase === 'ready' && !busy && !pending && !failure && <><IngestionEntityPicker onChoose={entity => requestDecision({ action: 'confirm', entity, origin: 'MANUAL' })} onAccessError={accessError} />
        <button type="button" onClick={() => setPicker(false)}>Fermer le choix manuel</button></>}
      {pending && <div className="ingestion-decision-confirmation" role="group" aria-label="Confirmation de la décision" onKeyDown={event => { if (event.key === 'Escape') cancel() }}>
        <h4 ref={confirmationHeading} tabIndex={-1}>{pending.action === 'reset' ? 'Retirer cette association ?' : pending.action === 'reject' ? 'Rejeter cette suggestion ?' : confirmed ? 'Remplacer l’association confirmée ?' : 'Confirmer cette association ?'}</h4>
        {pending.action !== 'reset' && <p>{pending.entity.title} · {pending.entity.slug}</p>}
        <p>{pending.action === 'reset' ? 'La confirmation sera retirée ; les rejets restent conservés.' : pending.action === 'reject' ? 'Ce rejet concerne uniquement cette identité et cette fiche.' : 'Cette décision associe le staging à la fiche. Aucun contenu n’est importé dans le Codex.'}</p>
        <div className="ingestion-association-actions"><button type="button" disabled={busy || current.phase !== 'ready'} onClick={() => void submit()}>
          {busy ? 'Enregistrement…' : pending.action === 'reset' ? 'Confirmer le retrait' : pending.action === 'reject' ? 'Confirmer le rejet' : 'Enregistrer l’association'}</button>
          <button type="button" disabled={busy} onClick={cancel}>Annuler</button></div>
      </div>}
    </section>
    {confirmed && <p>Suggestions actuelles pour comparaison avec l’association confirmée :</p>}
    {confirmed && matches.phase === 'ready' && (matches.data.status === 'AMBIGUOUS' || matches.data.candidates.some(candidate => candidate.score >= 90 && candidate.id !== confirmed.entity.id)) &&
      <p className="ingestion-match-warning">Les suggestions actuelles sont ambiguës ou diffèrent de la fiche confirmée. Vérifiez l’identité externe et la décision humaine.</p>}
    <IngestionMatchesPanel load={matches} onRetry={onRetryMatches} onNavigate={onNavigate}
      associationActions={{ disabled: busy || !!pending || !!failure || current.phase !== 'ready' || current.candidatesKey !== candidateIds,
        decisionsReady: current.phase === 'ready' && current.candidatesKey === candidateIds, confirmedId: confirmed?.entity.id,
        rejectedIds: current.phase === 'ready' ? [...current.data.rejectedCandidateIds, ...current.data.recentRejections.map(value => value.entity.id)] : [],
        onConfirm: entity => requestDecision({ action: 'confirm', entity, origin: 'MATCH' }),
        onReject: entity => requestDecision({ action: 'reject', entity, origin: 'MATCH' }) }} />
  </>
}
