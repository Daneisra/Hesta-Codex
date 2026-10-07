import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { EntityKind, PlaceKind, Visibility, IngestionUpdateApplied, IngestionUpdateFields, IngestionUpdatePreparation, IngestionUpdateRequest } from '@hesta-codex/shared'
import { getAdminJson, errorStatus, HttpError } from './admin-http'
import { kindLabels, placeLabels } from './graph-model'
import { IngestionTerms } from './IngestionTerms'
import { editableUpdateFields, changedUpdateFields, updateFieldLabels, updateFields } from './ingestion-update-model'

type Issue = { path: string; message: string }
type Draft = { entity: IngestionUpdateFields; claimText: string; sourceExcerpt: string; locator: string }
type Load = { phase: 'loading' } | { phase: 'error'; status: number | null } | { phase: 'ready'; data: IngestionUpdatePreparation }
const publishedMessage = 'Cette fiche est publiée. Retirez d’abord sa publication avant d’appliquer une mise à jour issue du staging.'
function Display({ value, label }: { value: IngestionUpdateFields[keyof IngestionUpdateFields]; label: string }) {
  return <pre tabIndex={0} role="region" aria-label={label}>{Array.isArray(value) ? JSON.stringify(value, null, 2) :
    value === null ? <em>Absent (null)</em> : value === '' ? <em>Texte vide</em> : value}</pre>
}
export function IngestionUpdateForm({ itemId, receiptId, onCancel, onApplied, onAccessError }: {
  itemId: string; receiptId: string; onCancel: () => void; onApplied: (result: IngestionUpdateApplied) => void; onAccessError: (status: number) => void
}) {
  const [load, setLoad] = useState<Load>({ phase: 'loading' })
  const [draft, setDraft] = useState<Draft | null>(null)
  const [review, setReview] = useState(false), [busy, setBusy] = useState(false), [blocked, setBlocked] = useState(false)
  const [failure, setFailure] = useState(''), [issues, setIssues] = useState<Issue[]>([])
  const heading = useRef<HTMLHeadingElement>(null), alert = useRef<HTMLDivElement>(null)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => {
    const read = new AbortController()
    getAdminJson<IngestionUpdatePreparation>(`/api/admin/ingestion/items/${itemId}/update-proposal?receiptId=${receiptId}`, read.signal)
      .then(data => {
        if (read.signal.aborted) return
        setLoad({ phase: 'ready', data }); setDraft({ entity: { title: data.entity.title, kind: data.entity.kind, placeKind: data.entity.placeKind,
          summary: data.entity.summary, bodyMarkdown: data.entity.bodyMarkdown, aliases: [...data.entity.aliases], tags: [...data.entity.tags], visibility: data.entity.visibility }, claimText: data.evidence.claimText,
          sourceExcerpt: data.evidence.sourceExcerpt ?? '', locator: data.evidence.locator ?? '' })
      }).catch((error: unknown) => {
        if (read.signal.aborted) return
        const status = errorStatus(error); setLoad({ phase: 'error', status })
        if (status === 401 || status === 403) onAccessError(status)
      })
    return () => { read.abort(); controller.current?.abort() }
  }, [itemId, receiptId, onAccessError])
  useEffect(() => { if (load.phase === 'error') alert.current?.focus(); else heading.current?.focus() }, [load.phase, review])
  useEffect(() => { if (failure) alert.current?.focus() }, [failure])
  if (load.phase === 'loading') return <p role="status">Préparation de la mise à jour…</p>
  if (load.phase === 'error') return <div role="alert" ref={alert} tabIndex={-1}><p>{load.status === 409 ? 'Association absente, modifiée ou fiche archivée. Revenez à l’item pour vérifier son état.' :
    load.status === 404 ? 'Item, réception, Source ou fiche introuvable.' : 'Préparation indisponible.'}</p><button type="button" onClick={onCancel}>Retour vers l’item</button></div>
  if (!draft) return null
  const data = load.data, final = editableUpdateFields(draft.entity)
  const changed = changedUpdateFields(data.entity, final)
  const statusBlocked = data.entity.status !== 'DRAFT' && data.entity.status !== 'PROPOSED'
  const disabled = blocked || statusBlocked || data.alreadyApplied
  const issue = (path: string) => issues.find(entry => entry.path === path || entry.path.startsWith(path + '.'))?.message
  const field = (key: keyof IngestionUpdateFields) => ({ id: `update-entity.${key}`, 'aria-label': updateFieldLabels[key],
    'aria-invalid': !!issue(`entity.${key}`), 'aria-describedby': issue(`entity.${key}`) ? `update-error-entity.${key}` : undefined })
  const proofField = (key: 'claimText' | 'sourceExcerpt' | 'locator', label: string) => ({ id: `update-evidence.${key}`, 'aria-label': label,
    'aria-invalid': !!issue(`evidence.${key}`), 'aria-describedby': issue(`evidence.${key}`) ? `update-error-evidence.${key}` : undefined })
  const error = (path: string) => issue(path) ? <span id={`update-error-${path}`} className="admin-field-error">{issue(path)}</span> : null
  const change = <K extends keyof IngestionUpdateFields>(key: K, value: IngestionUpdateFields[K]) => {
    setDraft({ ...draft, entity: { ...draft.entity, [key]: value } }); setIssues([]); if (!blocked) setFailure('')
  }
  const proofChange = (key: 'claimText' | 'sourceExcerpt' | 'locator', value: string) => { setDraft({ ...draft, [key]: value }); setIssues([]); if (!blocked) setFailure('') }
  const proceed = (event: FormEvent) => {
    event.preventDefault()
    if (busy || disabled || !changed.length) return
    const invalid: Issue[] = []
    if (!final.title || final.title.length > 200) invalid.push({ path: 'entity.title', message: 'Titre requis, 200 caractères au plus.' })
    if (!final.kind) invalid.push({ path: 'entity.kind', message: 'Choisissez un type.' })
    if (final.kind === 'PLACE' && !final.placeKind) invalid.push({ path: 'entity.placeKind', message: 'Choisissez le sous-type de lieu.' })
    if ((final.summary?.length ?? 0) > 500) invalid.push({ path: 'entity.summary', message: '500 caractères au plus.' })
    if (final.bodyMarkdown.length > 100_000) invalid.push({ path: 'entity.bodyMarkdown', message: '100 000 caractères au plus.' })
    for (const [key, max] of [['aliases', 200], ['tags', 100]] as const) {
      const values = final[key], normalized = values.map(value => value.normalize('NFC').toLocaleLowerCase('fr'))
      if (values.length > 30 || values.some(value => !value || value.length > max) || new Set(normalized).size !== values.length) {
        invalid.push({ path: `entity.${key}`, message: `30 valeurs distinctes, non vides, de ${max} caractères au plus.` })
      }
    }
    if (!draft.claimText.trim() || draft.claimText.trim().length > 10_000) invalid.push({ path: 'evidence.claimText', message: 'Énoncé requis, 10 000 caractères au plus.' })
    if (draft.sourceExcerpt.length > 100_000) invalid.push({ path: 'evidence.sourceExcerpt', message: '100 000 caractères au plus.' })
    if (draft.locator.length > 250) invalid.push({ path: 'evidence.locator', message: '250 caractères au plus.' })
    setIssues(invalid)
    if (invalid.length) { document.getElementById(`update-${invalid[0]!.path}`)?.focus(); return }
    setFailure(''); setReview(true)
  }
  const submit = async () => {
    if (controller.current || disabled || !review || !changed.length) return
    const write = new AbortController(); controller.current = write; setBusy(true); setFailure('')
    const request: IngestionUpdateRequest = { receiptId, targetEntityId: data.entity.id,
      expectedAssociationRevision: data.expectedAssociationRevision, expectedEntityUpdatedAt: data.expectedEntityUpdatedAt,
      entity: final, evidence: { claimText: draft.claimText, sourceExcerpt: draft.sourceExcerpt || null, locator: draft.locator || null } }
    try {
      const response = await fetch(`/api/admin/ingestion/items/${itemId}/update-proposal`, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
        signal: write.signal, headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(request) })
      if (!response.ok) {
        if (response.status === 400 || response.status === 422) {
          const payload = await response.json() as { error?: { code?: string; issues?: Issue[] } }
          if (write.signal.aborted) return
          setIssues(payload.error?.issues ?? []); setReview(false)
        }
        throw new HttpError(response.status)
      }
      const result = await response.json() as IngestionUpdateApplied
      if (!write.signal.aborted) onApplied(result)
    } catch (error: unknown) {
      if (write.signal.aborted) return
      const status = errorStatus(error)
      if (status === 401 || status === 403) { setDraft(null); setBlocked(true); onAccessError(status); return }
      if (status === 400 || status === 422 || status === 413) {
        setReview(false); setFailure(status === 413 ? 'Requête trop volumineuse. Réduisez contenu ou extrait ; votre saisie est conservée.' : 'Corrigez les champs signalés. Votre saisie est conservée.'); return
      }
      setBlocked(true)
      setFailure(status === 409 ? 'La fiche, l’association ou l’application de cette réception a changé. Revenez à l’item, rechargez et comparez à nouveau.' :
        status === 404 ? 'Item, Source ou fiche introuvable. Revenez à l’item.' : 'Mise à jour non confirmée. Vérifiez la fiche et son historique avant toute nouvelle tentative.')
    } finally { if (!write.signal.aborted) setBusy(false); if (controller.current === write) controller.current = null }
  }
  return <section className="ingestion-proposal ingestion-update" aria-labelledby="update-heading" aria-busy={busy}>
    <h3 id="update-heading" ref={heading} tabIndex={-1}>{review ? 'Vérifier la mise à jour' : 'Préparer une mise à jour depuis le staging'}</h3>
    <p>Association confirmée vers {data.entity.title} · {data.entity.slug}. Le slug, le statut et la publication sont conservés.</p>
    <p>Statut : {data.entity.status} · visibilité : {data.entity.visibility} · version staging {data.version}.</p>
    <p>Source : {data.source.label} · {data.source.kind} · {data.source.visibility}. La preuve conserve une visibilité au moins aussi restrictive que la Source et la fiche finale.</p>
    {data.warnings.filter(warning => warning !== publishedMessage).map(warning => <p key={warning} className="ingestion-match-warning">{warning}</p>)}
    {statusBlocked && <p role="alert">{data.entity.status === 'PUBLISHED' ? publishedMessage : 'Une fiche archivée est en lecture seule.'}</p>}
    {failure && <div role="alert" ref={alert} tabIndex={-1}>{failure}</div>}
    {review ? <section className="ingestion-decision-confirmation" aria-label="Récapitulatif de mise à jour">
      <p>Cible : {data.entity.title} · {data.entity.slug} · {data.entity.status}. Visibilité finale : {final.visibility}.</p>
      <p>Version staging {data.version} · Source {data.source.label} · repère {draft.locator || 'Absent'}.</p>
      <p>Champs inchangés : {updateFields.filter(key => !changed.includes(key)).map(key => updateFieldLabels[key]).join(' · ') || 'Aucun'}.</p>
      {changed.map(key => <section key={key} className="ingestion-update-diff" aria-label={`Modification : ${updateFieldLabels[key]}`}>
        <h4>{updateFieldLabels[key]} — modifié</h4><div className="ingestion-update-columns">
          <div><h5>Avant</h5><Display value={data.entity[key]} label={`Avant : ${updateFieldLabels[key]}`} /></div><div><h5>Après</h5><Display value={final[key]} label={`Après : ${updateFieldLabels[key]}`} /></div></div>
      </section>)}
      <p>Provenance : {draft.claimText}</p><details><summary>Lire l’extrait de provenance</summary><pre tabIndex={0} role="region" aria-label="Extrait de provenance préparé">{draft.sourceExcerpt || '—'}</pre></details>
      <p>Le clic final met à jour cette fiche, ajoute une Evidence et une Revision. L’association existante et la publication restent inchangées.</p>
      <div className="ingestion-association-actions"><button type="button" disabled={busy} onClick={() => setReview(false)}>Corriger</button>
        <button type="button" disabled={busy || disabled || !changed.length} onClick={() => void submit()}>{busy ? 'Application…' : 'Appliquer la mise à jour'}</button></div>
    </section> : <>
      <div className="ingestion-update-columns">
        <section aria-label="Fiche actuelle"><h4>Fiche actuelle</h4><dl>{updateFields.map(key => <div key={key}><dt>{updateFieldLabels[key]}</dt><dd><Display value={data.entity[key]} label={`Valeur actuelle : ${updateFieldLabels[key]}`} /></dd></div>)}</dl></section>
        <section aria-label="Proposition du staging"><h4>Données du staging — version {data.version}</h4>
          <p>Format : {data.staging.contentType} · repère : {data.staging.locator || 'Absent'} · observation : {data.staging.observedAt || 'Absente'}.</p>
          <h5>Titre reçu</h5><pre tabIndex={0} role="region" aria-label="Titre du staging">{data.staging.title ?? 'Absent'}</pre><button type="button" disabled={busy || disabled || !data.staging.title} onClick={() => change('title', data.staging.title!)}>Utiliser le titre du staging</button>
          <h5>Contenu reçu</h5><pre tabIndex={0} role="region" aria-label="Contenu du staging">{data.staging.content}</pre><button type="button" disabled={busy || disabled || !data.staging.contentSupported || !data.staging.content} onClick={() => change('bodyMarkdown', data.staging.content)}>Utiliser le contenu du staging</button>
          <h5>Tags valides reçus</h5><Display value={data.staging.tags} label="Tags du staging" /><button type="button" disabled={busy || disabled || !data.staging.tagsAvailable} onClick={() => change('tags', [...data.staging.tags])}>Utiliser les tags du staging</button>
        </section>
      </div>
      <form onSubmit={proceed} noValidate><fieldset className="admin-editor-grid" disabled={busy || disabled}>
        <legend>Valeurs finales préparées manuellement</legend>
        <label>Titre<input {...field('title')} value={draft.entity.title} onChange={event => change('title', event.target.value)} />{error('entity.title')}</label>
        <label>Type de fiche<select {...field('kind')} value={draft.entity.kind} onChange={event => change('kind', event.target.value as EntityKind)}>{(Object.keys(kindLabels) as EntityKind[]).map(kind => <option value={kind} key={kind}>{kindLabels[kind]}</option>)}</select>{error('entity.kind')}</label>
        {draft.entity.kind === 'PLACE' && <label>Sous-type de lieu<select {...field('placeKind')} value={draft.entity.placeKind ?? ''} onChange={event => change('placeKind', event.target.value as PlaceKind)}><option value="">Choisir…</option>{(Object.keys(placeLabels) as PlaceKind[]).map(kind => <option value={kind} key={kind}>{placeLabels[kind]}</option>)}</select>{error('entity.placeKind')}</label>}
        <label>Visibilité<select {...field('visibility')} value={draft.entity.visibility} onChange={event => change('visibility', event.target.value as Visibility)}>{(['GM', 'SECRET', 'PLAYERS', 'PUBLIC'] as Visibility[]).map(value => <option key={value}>{value}</option>)}</select>{error('entity.visibility')}</label>
        <label className="admin-editor-wide">Résumé<textarea {...field('summary')} rows={3} maxLength={500} value={draft.entity.summary ?? ''} onChange={event => change('summary', event.target.value)} />{error('entity.summary')}</label>
        <div className="admin-editor-wide"><div id="update-entity.aliases" tabIndex={-1}><IngestionTerms label="Alias" values={draft.entity.aliases} max={200} invalid={!!issue('entity.aliases')} errorId="update-error-entity.aliases" onChange={values => change('aliases', values)} />{error('entity.aliases')}</div>
          <div id="update-entity.tags" tabIndex={-1}><IngestionTerms label="Tag" values={draft.entity.tags} max={100} invalid={!!issue('entity.tags')} errorId="update-error-entity.tags" onChange={values => change('tags', values)} />{error('entity.tags')}</div></div>
        <label className="admin-editor-wide">Contenu Markdown<textarea {...field('bodyMarkdown')} rows={12} value={draft.entity.bodyMarkdown} onChange={event => change('bodyMarkdown', event.target.value)} />{error('entity.bodyMarkdown')}</label>
        <label className="admin-editor-wide">Énoncé de provenance<textarea {...proofField('claimText', 'Énoncé de provenance')} rows={3} maxLength={10_000} value={draft.claimText} onChange={event => proofChange('claimText', event.target.value)} />{error('evidence.claimText')}</label>
        <label className="admin-editor-wide">Extrait de la Source<textarea {...proofField('sourceExcerpt', 'Extrait de la Source')} rows={4} maxLength={100_000} value={draft.sourceExcerpt} onChange={event => proofChange('sourceExcerpt', event.target.value)} />{error('evidence.sourceExcerpt')}</label>
        <label>Repère<input {...proofField('locator', 'Repère')} maxLength={250} value={draft.locator} onChange={event => proofChange('locator', event.target.value)} />{error('evidence.locator')}</label>
      </fieldset>{!changed.length && <p role="status">Aucun changement éditorial à appliquer.</p>}
        <button type="submit" disabled={busy || disabled || !changed.length}>Vérifier la mise à jour</button>
      </form>
    </>}
    <button type="button" disabled={busy} onClick={onCancel}>Retour vers l’item</button>
  </section>
}
