import { useEffect, useRef, useState } from 'react'
import type { AdminEntityDetail, AdminRelation, AdminRelationPatch, QualificationRow } from '@hesta-codex/shared'
import { AdminEditRelation } from './AdminEditRelation'
import { errorStatus, getAdminJson, HttpError } from './admin-http'

type Selection = { relation: AdminRelation; from: AdminRelation['entity']; to: AdminRelation['entity'] }

/** Load the current relation only when requested; never edit from a stale queue projection. */
export function AdminQualificationRelationEditor({ row, relationId, onClose, onSaved, onAccessError, onDirtyChange, onPendingChange }: {
  row: QualificationRow; relationId: string; onClose: () => void; onSaved: () => void
  onAccessError: (status: number) => void; onDirtyChange: (dirty: boolean) => void; onPendingChange: (pending: boolean) => void
}) {
  const [selection, setSelection] = useState<Selection | null>(null)
  const [loading, setLoading] = useState(true), [retry, setRetry] = useState(0), [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const dirty = useRef(false), pending = useRef(false), alive = useRef(true)
  const panel = useRef<HTMLElement>(null)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setSelection(null); setError('')
    getAdminJson<AdminEntityDetail>(`/api/admin/entities/${encodeURIComponent(row.from.slug)}`, controller.signal,
      { 'X-Hesta-Relation-Evidence': 'defer' }).then(entity => {
      if (controller.signal.aborted) return
      const outgoing = entity.outgoingRelations.find(item => item.id === relationId)
      const relation = outgoing ?? entity.incomingRelations.find(item => item.id === relationId)
      if (entity.id !== row.from.id || !relation || relation.entity.id !== row.to.id) throw new HttpError(404)
      if (entity.status === 'ARCHIVED' || relation.entity.status === 'ARCHIVED' || relation.status === 'ARCHIVED') {
        throw new HttpError(409, 'Cette relation ou l’une de ses fiches est archivée et ne peut pas être modifiée.')
      }
      setSelection({ relation, from: outgoing ? entity : relation.entity, to: outgoing ? relation.entity : entity })
      setLoading(false)
    }).catch(reason => {
      if (controller.signal.aborted) return
      const status = errorStatus(reason)
      setLoading(false)
      setError(status === 404 ? 'Cette relation n’est plus disponible pour cette paire de fiches. Actualisez la file.' :
        status === 409 ? (reason as HttpError).message : 'Impossible de charger la relation actuelle. Réessayez.')
      if (status === 401 || status === 403) onAccessError(status)
    })
    return () => controller.abort()
  }, [row.from.id, row.from.slug, row.to.id, relationId, retry, onAccessError])
  useEffect(() => { if (!loading) panel.current?.focus() }, [loading])
  const changeDirty = (value: boolean) => { dirty.current = value; onDirtyChange(value) }
  function discard() {
    if (pending.current || (dirty.current && !window.confirm('Annuler et perdre les modifications non enregistrées ?'))) return false
    changeDirty(false)
    return true
  }
  async function save(body: AdminRelationPatch): Promise<boolean> {
    if (pending.current) return false
    pending.current = true; setSaving(true); onPendingChange(true); setError('')
    try {
      const response = await fetch(`/api/admin/relations/${relationId}`, { method: 'PATCH', credentials: 'same-origin', cache: 'no-store',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: { message?: unknown } } | null
        throw new HttpError(response.status, typeof payload?.error?.message === 'string' ? payload.error.message : '')
      }
      if (alive.current) { changeDirty(false); onSaved() }
      return true
    } catch (reason) {
      if (!alive.current) return false
      const status = errorStatus(reason)
      setError(status === 409 ? `Correction refusée : ${(reason as HttpError).message || 'la relation a changé ou existe déjà'}. Rechargez la relation avant de réessayer.` :
        status === 404 ? 'Relation introuvable. Fermez cet éditeur et actualisez la file.' :
        status === 400 || status === 422 ? (reason as HttpError).message || 'Correction invalide.' :
          'Enregistrement non confirmé. Rechargez la relation pour vérifier son état avant de réessayer.')
      if (status === 401 || status === 403) onAccessError(status)
      return false
    } finally {
      pending.current = false; onPendingChange(false)
      if (alive.current) setSaving(false)
    }
  }
  return <section className="admin-source-card" aria-label="Correction de la relation éditoriale" ref={panel} tabIndex={-1}>
    <h3>Modifier la relation existante</h3>
    {loading && <p role="status">Chargement de la relation actuelle…</p>}
    {error && <div role="alert"><p>{error}</p><button type="button" disabled={saving}
      onClick={() => { if (discard()) setRetry(value => value + 1) }}>Recharger la relation</button></div>}
    {selection ? <AdminEditRelation {...selection} onSave={save} onCancel={() => { if (discard()) onClose() }}
      onDirty={changeDirty} busy={saving} disabled={false} onAccessError={onAccessError} /> :
      <button type="button" onClick={() => { if (discard()) onClose() }}>Annuler</button>}
  </section>
}
