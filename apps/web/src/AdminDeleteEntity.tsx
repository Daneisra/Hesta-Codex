import { useEffect, useRef, useState } from 'react'
import type { AdminEntityDetail, AdminEntityDeletionPlan } from '@hesta-codex/shared'
import { errorStatus, getAdminJson, HttpError } from './admin-http'

export function AdminDeleteEntity({ entity, disabled, onPending, onDeleted, onAccessError }: {
  entity: AdminEntityDetail; disabled: boolean; onPending: (pending: boolean) => void
  onDeleted: (title: string) => void; onAccessError: (status: number) => void
}) {
  const [open, setOpen] = useState(false), [plan, setPlan] = useState<AdminEntityDeletionPlan | null>(null)
  const [loading, setLoading] = useState(false), [pending, setPending] = useState(false)
  const [confirmed, setConfirmed] = useState(false), [error, setError] = useState(''), [attempt, setAttempt] = useState(0)
  const dialog = useRef<HTMLDialogElement>(null), button = useRef<HTMLButtonElement>(null)
  const submitting = useRef(false), alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    const node = dialog.current
    if (!node) return
    if (open) {
      if (typeof node.showModal === 'function') node.showModal()
      else node.setAttribute('open', '')
    } else {
      if (typeof node.close === 'function') node.close()
      else node.removeAttribute('open')
    }
    return () => { if (node.open && typeof node.close === 'function') node.close() }
  }, [open])
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setPlan(null); setConfirmed(false); setLoading(true); setError('')
    getAdminJson<AdminEntityDeletionPlan>(`/api/admin/entities/${encodeURIComponent(entity.slug)}/deletion`, controller.signal)
      .then(data => {
        if (controller.signal.aborted) return
        if (data.id !== entity.id || data.slug !== entity.slug) throw new Error('Fiche remplacée')
        setPlan(data); setLoading(false)
      }).catch(reason => {
        if (controller.signal.aborted) return
        setLoading(false); setPlan(null)
        const status = errorStatus(reason)
        setError(status === 404 ? 'Cette fiche n’existe plus.' : 'Bilan indisponible ou fiche modifiée. Rechargez avant de confirmer.')
        if (status === 401 || status === 403) onAccessError(status)
      })
    return () => controller.abort()
  }, [open, attempt, entity.id, entity.slug, onAccessError])
  useEffect(() => {
    if (!pending) return
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', prevent)
    return () => window.removeEventListener('beforeunload', prevent)
  }, [pending])
  function cancel() {
    if (submitting.current) return
    setOpen(false); setPlan(null); setConfirmed(false); setError(''); button.current?.focus()
  }
  async function remove() {
    if (submitting.current || disabled || !plan || !confirmed) return
    submitting.current = true; setPending(true); onPending(true); setError('')
    try {
      const response = await fetch(`/api/admin/entities/${encodeURIComponent(entity.slug)}`, { method: 'DELETE',
        credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ entityId: plan.id, fingerprint: plan.fingerprint, confirm: true }) })
      if (!response.ok) throw new HttpError(response.status)
      if (alive.current) { setOpen(false); setPlan(null); setConfirmed(false); onDeleted(plan.title) }
    } catch (reason) {
      if (!alive.current) return
      const status = errorStatus(reason)
      setPlan(null); setConfirmed(false)
      setError(status === 409 ? 'La fiche ou ses données liées ont changé. Actualisez le bilan et confirmez de nouveau.'
        : status === 404 ? 'Cette fiche n’existe plus. Aucune suppression n’est confirmée par cette réponse.'
          : 'Suppression non confirmée. Actualisez le bilan pour vérifier l’état avant de réessayer.')
      if (status === 401 || status === 403) onAccessError(status)
    } finally {
      submitting.current = false; onPending(false)
      if (alive.current) setPending(false)
    }
  }
  return <>
    <button ref={button} type="button" className="admin-delete-button" disabled={disabled || pending}
      onClick={() => setOpen(true)}>Supprimer la fiche</button>
    <dialog ref={dialog} className="admin-delete-dialog" aria-labelledby="entity-delete-title" aria-modal="true"
      onCancel={event => { event.preventDefault(); cancel() }}>
      {open && <><h2 id="entity-delete-title">Supprimer définitivement « {plan?.title ?? entity.title} » ?</h2>
        <p>Cette opération est irréversible.</p>
        {loading && <p role="status">Calcul des données liées…</p>}
        {error && <p role="alert">{error}</p>}
        {plan && <>
          {plan.status === 'PUBLISHED' && <p>Cette fiche est publiée. Elle sera également retirée de toute vue publique où elle est visible.</p>}
          <ul>
            <li>{plan.counts.relations} relation(s) éditoriale(s) entrante(s) ou sortante(s).</li>
            <li>{plan.counts.directEvidence + plan.counts.relationEvidence} preuve(s) : {plan.counts.directEvidence} sur la fiche et {plan.counts.relationEvidence} sur ses relations.</li>
            <li>{plan.counts.revisions} révision(s).</li>
            <li>{plan.counts.images} image(s) importée(s).</li>
            <li>{plan.counts.associationDecisions} décision(s) d’association d’ingestion.</li>
            <li>{plan.counts.referenceIgnores} décision(s) d’ignorance de références Obsidian.</li>
          </ul>
          <p>{plan.counts.associations} association(s) d’ingestion conservée(s), avec une révision actualisée.</p>
          <p>Les autres fiches et leurs preuves indépendantes, les Sources, lots, items, réceptions et Markdown originaux du staging seront conservés.</p>
          <label><input type="checkbox" checked={confirmed} disabled={pending}
            onChange={event => setConfirmed(event.target.checked)} /> Je confirme la suppression définitive de cette fiche et de ses données liées.</label>
        </>}
        <div className="admin-editor-actions">
          <button type="button" autoFocus disabled={pending} onClick={cancel}>Annuler</button>
          {!loading && !plan && <button type="button" disabled={pending} onClick={() => setAttempt(value => value + 1)}>Actualiser le bilan</button>}
          <button type="button" className="admin-delete-button" disabled={disabled || pending || loading || !plan || !confirmed}
            onClick={() => void remove()}>{pending ? 'Suppression…' : 'Supprimer définitivement'}</button>
        </div>
      </>}
    </dialog>
  </>
}
