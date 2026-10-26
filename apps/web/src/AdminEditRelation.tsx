import { useEffect, useRef, useState, type FormEvent } from 'react'
import { canonicalRelationEndpoints, groupRelationTypes, relationKindWarning, type AdminRelation, type AdminRelationPatch,
  type RelationTypeItem, type Visibility } from '@hesta-codex/shared'
import { errorStatus, getAdminJson } from './admin-http'

type Entity = Pick<AdminRelation['entity'], 'id' | 'title' | 'slug' | 'kind'>
const visibilities: Visibility[] = ['PUBLIC', 'PLAYERS', 'GM', 'SECRET']
const visibilityLabel: Record<Visibility, string> = { PUBLIC: 'Public', PLAYERS: 'Joueurs', GM: 'MJ', SECRET: 'Secret' }

export function AdminEditRelation({ relation, from, to, onSave, onCancel, onDirty, busy, disabled, onAccessError }: {
  relation: AdminRelation; from: Entity; to: Entity; onSave: (body: AdminRelationPatch) => Promise<boolean>
  onCancel: () => void; onDirty: (dirty: boolean) => void; busy: boolean; disabled: boolean; onAccessError?: (status: number) => void
}) {
  const [initial] = useState(() => ({ relation, from, to }))
  const original = initial.relation
  const [description, setDescription] = useState(original.description ?? '')
  const [visibility, setVisibility] = useState(original.visibility)
  const [code, setCode] = useState(original.relationType.code)
  const [reversed, setReversed] = useState(false)
  const [types, setTypes] = useState<RelationTypeItem[]>([original.relationType])
  const [catalogError, setCatalogError] = useState(false), [retry, setRetry] = useState(0)
  const [review, setReview] = useState(false), [saving, setSaving] = useState(false)
  const pending = useRef(false)
  useEffect(() => {
    const controller = new AbortController()
    setCatalogError(false)
    getAdminJson<RelationTypeItem[]>('/api/admin/relation-types', controller.signal).then(result => {
      if (controller.signal.aborted) return
      if (!Array.isArray(result)) throw new Error('Invalid catalogue')
      setTypes(result.some(type => type.id === original.relationType.id) ? result : [original.relationType, ...result])
    }).catch(error => {
      if (controller.signal.aborted) return
      setCatalogError(true)
      const status = errorStatus(error)
      if (status === 401 || status === 403) onAccessError?.(status)
    })
    return () => controller.abort()
  }, [original.relationType, retry, onAccessError])
  const type = types.find(item => item.code === code || item.inverseCode === code) ?? original.relationType
  const readingFrom = reversed ? initial.to : initial.from, readingTo = reversed ? initial.from : initial.to
  const next = canonicalRelationEndpoints(type, code, readingFrom.id, readingTo.id)
  const before = canonicalRelationEndpoints(original.relationType, original.relationType.code, initial.from.id, initial.to.id)
  const structural = next.fromEntityId !== before.fromEntityId || next.toEntityId !== before.toEntityId || next.relationTypeId !== before.relationTypeId
  const nextFrom = next.fromEntityId === initial.from.id ? initial.from : initial.to
  const nextTo = next.toEntityId === initial.to.id ? initial.to : initial.from
  const beforeText = `${initial.from.title} ${original.relationType.label} ${initial.to.title}`
  const afterText = `${nextFrom.title} ${type.label} ${nextTo.title}`
  const warning = relationKindWarning(code, readingFrom.kind, readingTo.kind)
  const dirty = structural || description.trim() !== (original.description ?? '') || visibility !== original.visibility
  const blocked = busy || disabled || saving
  useEffect(() => { onDirty(dirty) }, [dirty, onDirty])
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (blocked || pending.current) return
    if (structural && !review) { setReview(true); return }
    pending.current = true; setSaving(true)
    try {
      await onSave({ description: description.trim() || null, visibility, expectedUpdatedAt: original.updatedAt,
        ...(structural ? { relationCode: code, reverse: reversed } : {}) })
    } finally { pending.current = false; setSaving(false) }
  }
  return <form className="admin-editor-grid admin-provenance-editor" aria-label="Modifier le type et le sens de la relation"
    onSubmit={event => void submit(event)}>
    <p className="admin-editor-wide">Relation actuelle : <strong>{beforeText}</strong></p>
    {catalogError && <p role="alert" className="admin-editor-wide">Catalogue indisponible. Le type actuel reste utilisable.
      {' '}<button type="button" disabled={blocked} onClick={() => setRetry(value => value + 1)}>Recharger les types</button></p>}
    {!review ? <>
      <label className="admin-editor-wide">Type et sens<select value={code} disabled={blocked}
        onChange={event => { setCode(event.target.value); setReview(false) }}>
        {groupRelationTypes(types).map(group => <optgroup key={group.code} label={group.label}>{group.types.flatMap(item => [
          <option key={item.code} value={item.code}>{item.label}{item.symmetric ? ' · symétrique' : ''}</option>,
          ...(item.inverseCode ? [<option key={item.inverseCode} value={item.inverseCode}>{item.inverseLabel}</option>] : []),
        ])}</optgroup>)}
      </select></label>
      <button type="button" disabled={blocked || type.symmetric} onClick={() => setReversed(value => !value)}>Inverser les fiches</button>
      <label className="admin-editor-wide">Description<textarea value={description} maxLength={10_000} rows={4} disabled={blocked}
        onChange={event => setDescription(event.target.value)} /></label>
      <label>Visibilité<select value={visibility} disabled={blocked} onChange={event => setVisibility(event.target.value as Visibility)}>
        {visibilities.map(value => <option key={value} value={value}>{visibilityLabel[value]}</option>)}</select></label>
    </> : <div className="admin-editor-wide"><h4>Vérifier la correction</h4><p>Avant : {beforeText}</p><p>Après : <strong>{afterText}</strong></p>
      <p>Les preuves et les sources sont conservées. Vérifiez que leurs énoncés correspondent à la relation corrigée.</p>
      {original.status === 'PUBLISHED' && <p>Cette correction retirera la relation de la publication et la remettra en Proposée.</p>}
      <p>Visibilité : {visibilityLabel[visibility]}</p>
    </div>}
    {!review && <p className="admin-editor-wide" role="status">Après : <strong>{afterText}</strong></p>}
    <p className="admin-muted admin-editor-wide">Sens après correction : /{nextFrom.slug} → /{nextTo.slug}</p>
    {warning && <p className="admin-muted admin-editor-wide" role="status">{warning}</p>}
    <div className="admin-editor-actions admin-editor-wide">
      <button type="button" disabled={blocked} onClick={onCancel}>Annuler</button>
      {review && <button type="button" disabled={blocked} onClick={() => setReview(false)}>Revenir à la correction</button>}
      <button className="admin-primary-button" type="submit" disabled={blocked}>
        {structural ? review ? 'Confirmer la modification' : 'Vérifier la modification' : 'Enregistrer'}
      </button>
    </div>
  </form>
}
