import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react'
import type {
  AdminEntityDetail, AdminEntityListItem, AdminEntityListResponse, AdminManualRelationRequest,
  AdminSource, RelationTypeItem, SourceKind, Visibility,
} from '@hesta-codex/shared'
import { AdminSourcePicker } from './AdminSourcePicker'
import { existingRelation, referenceProvenance, type ReferenceRelationSeed } from './reference-relation'
import { getAdminJson, errorStatus } from './admin-http'
import { groupRelationTypes, relationKindWarning } from '@hesta-codex/shared'

const sourceKinds: SourceKind[] = ['MANUAL', 'OBSIDIAN', 'DISCORD', 'HESTA_MAP', 'YOUTUBE', 'AI_DERIVED', 'OTHER']
const visibilities: Visibility[] = ['PUBLIC', 'PLAYERS', 'GM', 'SECRET']
type Issue = { path: string; message: string }
type Form = {
  relationCode: string; description: string; visibility: Visibility;
  sourceKind: SourceKind; sourceLabel: string; sourceExternalId: string; sourceUrl: string;
  sourceAuthorLabel: string; sourcePublishedAt: string; sourceVisibility: Visibility;
  claimText: string; sourceExcerpt: string; locator: string; timeStartSeconds: string;
  timeEndSeconds: string; confidence: string; evidenceVisibility: Visibility
}
const initial: Form = {
  relationCode: '', description: '', visibility: 'GM', sourceKind: 'MANUAL', sourceLabel: '',
  sourceExternalId: '', sourceUrl: '', sourceAuthorLabel: '', sourcePublishedAt: '', sourceVisibility: 'GM',
  claimText: '', sourceExcerpt: '', locator: '', timeStartSeconds: '', timeEndSeconds: '', confidence: '',
  evidenceVisibility: 'GM',
}
const seconds = (value: string) => value.trim() === '' ? null : Number(value)
function timeLabel(value: string): string | null {
  const count = seconds(value)
  if (count === null || !Number.isInteger(count) || count < 0 || count > 2_147_483_647) return null
  return [Math.floor(count / 3600), Math.floor((count % 3600) / 60), count % 60]
    .map((part) => String(part).padStart(2, '0')).join(':')
}

export function AdminCreateRelation({ entity, busy, disabled, error, onCreate, onClearError, onDirtyChange, onNavigate, seed }: {
  entity: AdminEntityDetail; busy: boolean; disabled: boolean
  seed?: ReferenceRelationSeed
  error: { status: number | null; message: string; code?: string; issues?: Issue[] } | null
  onCreate: (input: AdminManualRelationRequest) => void
  onClearError: () => void
  onDirtyChange: (dirty: boolean) => void
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, path: string) => void
}) {
  const [provenance] = useState(() => seed ? referenceProvenance(entity, seed.toId) : null)
  const [form, setForm] = useState<Form>(() => ({ ...initial,
    locator: provenance?.locator ?? '', sourceExcerpt: provenance?.excerpt ?? '' }))
  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const [selectedSource, setSelectedSource] = useState<AdminSource | null>(provenance?.source ?? null)
  const [target, setTarget] = useState<AdminEntityListItem | null>(null)
  const [reversed, setReversed] = useState(false)
  const [targetPickerOpen, setTargetPickerOpen] = useState(!seed)
  const [seedAttempt, setSeedAttempt] = useState(0)
  const [seedLoading, setSeedLoading] = useState(!!seed)
  const [seedError, setSeedError] = useState<string | null>(null)
  const [seedSessionExpired, setSeedSessionExpired] = useState(false)
  const [recentEntity, setRecentEntity] = useState(entity)
  const [targetQuery, setTargetQuery] = useState('')
  const [targetPage, setTargetPage] = useState(1)
  const [targets, setTargets] = useState<AdminEntityListResponse | null>(null)
  const [targetLoading, setTargetLoading] = useState(false)
  const [targetError, setTargetError] = useState<string | null>(null)
  const [types, setTypes] = useState<RelationTypeItem[] | null>(null)
  const [typesError, setTypesError] = useState(false)
  const [typesAttempt, setTypesAttempt] = useState(0)
  const [review, setReview] = useState(false)
  const [localIssues, setLocalIssues] = useState<Issue[]>([])
  const errorRef = useRef<HTMLDivElement>(null)
  const issues = [...localIssues, ...(error?.issues ?? [])]
  const issue = (path: string) => issues.find((item) => item.path === path || item.path.startsWith(`${path}.`))?.message
  const field = (path: string) => ({ 'aria-invalid': !!issue(path),
    'aria-describedby': issue(path) ? `${path}-error` : undefined })
  const errorText = (path: string) => issue(path)
    ? <span id={`${path}-error`} className="admin-field-error">{issue(path)}</span> : null

  useEffect(() => { onDirtyChange(JSON.stringify(form) !== JSON.stringify(initial) || target !== null ||
    selectedSource !== null || mode !== 'existing') }, [form, target, selectedSource, mode, onDirtyChange])
  useEffect(() => { if (error?.status === 400) setReview(false) }, [error])
  useEffect(() => { if (error) errorRef.current?.focus() }, [error])
  useEffect(() => { setRecentEntity(entity) }, [entity])
  useEffect(() => {
    if (error?.code !== 'RELATION_CONFLICT') return
    const controller = new AbortController()
    getAdminJson<AdminEntityDetail>(`/api/admin/entities/${encodeURIComponent(entity.slug)}`, controller.signal)
      .then(data => { if (!controller.signal.aborted && data.id === entity.id) setRecentEntity(data) })
      .catch(() => { /* Keep the form and the server conflict message available for a retry. */ })
    return () => controller.abort()
  }, [error, entity.id, entity.slug])

  useEffect(() => {
    if (!seed) return
    const reference = entity.id === seed.fromId && entity.obsidianReferences?.updatedAt === entity.updatedAt
      ? entity.obsidianReferences.outgoing.find(item => item.id === seed.toId) : undefined
    if (!reference || reference.archived || seed.fromId === seed.toId) {
      setSeedError('Cette référence ne permet plus de préparer une relation. Retournez à la fiche.'); setSeedLoading(false); return
    }
    const controller = new AbortController()
    setSeedLoading(true); setSeedError(null); setSeedSessionExpired(false)
    getAdminJson<AdminEntityDetail>(`/api/admin/entities/${encodeURIComponent(seed.toSlug)}`, controller.signal)
      .then(data => {
        if (controller.signal.aborted) return
        if (data.id !== seed.toId || data.status === 'ARCHIVED') throw new Error('La fiche cible a changé ou est archivée.')
        setTarget(data)
      }).catch((reason: unknown) => {
        if (!controller.signal.aborted) setSeedSessionExpired(errorStatus(reason) === 401)
        if (!controller.signal.aborted) setSeedError(errorStatus(reason) === 401 ? 'Session expirée. Reconnectez-vous avec Discord.'
          : reason instanceof Error ? reason.message : 'Fiche cible indisponible.')
      }).finally(() => { if (!controller.signal.aborted) setSeedLoading(false) })
    return () => controller.abort()
  }, [seed, seedAttempt, entity.id, entity.updatedAt, entity.obsidianReferences])

  useEffect(() => {
    const controller = new AbortController()
    setTypesError(false)
    fetch('/api/admin/relation-types', { signal: controller.signal, credentials: 'same-origin', cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Catalogue indisponible.')
        return response.json() as Promise<RelationTypeItem[]>
      }).then((items) => { if (!controller.signal.aborted) setTypes(items) })
      .catch(() => { if (!controller.signal.aborted) setTypesError(true) })
    return () => controller.abort()
  }, [typesAttempt])

  useEffect(() => {
    if (!targetPickerOpen) return
    if (targetQuery.trim().length === 1) { setTargets(null); setTargetLoading(false); setTargetError(null); return }
    const controller = new AbortController()
    setTargets(null); setTargetLoading(true); setTargetError(null)
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ page: String(targetPage) })
      if (targetQuery.trim().length >= 2) params.set('q', targetQuery.trim())
      fetch(`/api/admin/entities?${params}`, { signal: controller.signal, credentials: 'same-origin', cache: 'no-store' })
        .then(async (response) => {
          if (!response.ok) throw new Error(response.status === 401 ? 'Session expirée.' : 'Recherche de fiches indisponible.')
          return response.json() as Promise<AdminEntityListResponse>
        }).then((data) => { if (!controller.signal.aborted) setTargets(data) })
        .catch((reason: unknown) => { if (!controller.signal.aborted) setTargetError(reason instanceof Error
          ? reason.message : 'Recherche indisponible.') })
        .finally(() => { if (!controller.signal.aborted) setTargetLoading(false) })
    }, targetQuery ? 320 : 0)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [targetQuery, targetPage, targetPickerOpen])

  function change<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((old) => ({ ...old, [key]: value }))
    setReview(false); setLocalIssues([])
    if (error?.status !== 401) onClearError()
  }
  function chooseTarget(item: AdminEntityListItem) {
    setTarget(item); setReview(false); setLocalIssues([])
    // A different destination is no longer supported by the original mention's excerpt.
    if (seed && item.id !== seed.toId) {
      setForm(old => ({ ...old, sourceExcerpt: '', claimText: '' }))
    }
    if (error?.status !== 401) onClearError()
  }
  function switchSourceMode(next: 'existing' | 'new') {
    setMode(next); setReview(false); setLocalIssues([])
    if (error?.status !== 401) onClearError()
  }
  const chosenType = types?.find((item) => item.code === form.relationCode || item.inverseCode === form.relationCode)
  const chosenLabel = chosenType?.code === form.relationCode ? chosenType.label :
    chosenType?.inverseLabel ?? chosenType?.inverseCode
  const inverseDirection = !!chosenType && !chosenType.symmetric && form.relationCode === chosenType.inverseCode
  const from = reversed && target ? target : entity
  const to = reversed ? entity : target
  const kindWarning = to ? relationKindWarning(form.relationCode, from.kind, to.kind) : null
  const swapForStorage = !!to && (inverseDirection || (!!chosenType?.symmetric && from.id > to.id))
  const duplicate = existingRelation(recentEntity, target, chosenType, form.relationCode, reversed)
  const blocked = busy || disabled || seedLoading || !!seedError || !!duplicate
  function request(): AdminManualRelationRequest {
    return {
      fromEntityId: from.id, toEntityId: to!.id, relationCode: form.relationCode,
      description: form.description.trim() || null, visibility: form.visibility,
      source: mode === 'existing' ? { mode, sourceId: selectedSource!.id }
        : { mode, data: { kind: form.sourceKind, label: form.sourceLabel.trim(),
          externalId: form.sourceExternalId || null, url: form.sourceUrl || null,
          authorLabel: form.sourceAuthorLabel.trim() || null, publishedAt: form.sourcePublishedAt || null,
          visibility: form.sourceVisibility } },
      evidence: { claimText: form.claimText.trim(), sourceExcerpt: form.sourceExcerpt.trim() || null,
        locator: form.locator.trim() || null, timeStartSeconds: seconds(form.timeStartSeconds),
        timeEndSeconds: seconds(form.timeEndSeconds), confidence: seconds(form.confidence),
        visibility: form.evidenceVisibility },
    }
  }
  function proceed(event: FormEvent) {
    event.preventDefault()
    if (blocked) return
    const invalid: Issue[] = []
    if (!chosenType) invalid.push({ path: 'relationCode', message: 'Choisissez un type et un sens.' })
    if (!target) invalid.push({ path: 'toEntityId', message: 'Choisissez une fiche cible.' })
    if (target?.id === entity.id) invalid.push({ path: 'toEntityId', message: 'Une fiche ne peut pas se lier à elle-même.' })
    if (target?.status === 'ARCHIVED') invalid.push({ path: 'toEntityId', message: 'Une fiche archivée ne peut pas être liée.' })
    if (mode === 'existing' && !selectedSource) invalid.push({ path: 'source.sourceId', message: 'Choisissez une Source.' })
    if (mode === 'new' && !form.sourceLabel.trim()) invalid.push({ path: 'source.data.label', message: 'Le label est requis.' })
    if (!form.claimText.trim()) invalid.push({ path: 'evidence.claimText', message: 'L’énoncé est requis.' })
    for (const key of ['timeStartSeconds', 'timeEndSeconds'] as const) {
      const count = seconds(form[key])
      if (count !== null && (!Number.isInteger(count) || count < 0 || count > 2_147_483_647)) {
        invalid.push({ path: `evidence.${key}`, message: 'Entier positif en secondes requis.' })
      }
    }
    const start = seconds(form.timeStartSeconds)
    const end = seconds(form.timeEndSeconds)
    if (start !== null && end !== null && Number.isFinite(start) && Number.isFinite(end) && end < start) {
      invalid.push({ path: 'evidence.timeEndSeconds', message: 'La fin doit suivre le début.' })
    }
    const confidence = seconds(form.confidence)
    if (confidence !== null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1 ||
      Math.abs(confidence * 1000 - Math.round(confidence * 1000)) >= 1e-8)) {
      invalid.push({ path: 'evidence.confidence', message: 'Confiance entre 0 et 1, avec trois décimales au plus.' })
    }
    setLocalIssues(invalid)
    if (invalid.length) { document.getElementById(invalid[0]!.path)?.focus(); return }
    setReview(true)
  }

  const back = seed?.returnPath ?? `/admin/fiches/${seed?.returnSlug ?? entity.slug}`
  return <div className="admin-create">
    <a className="admin-back" href={back} onClick={(event) => onNavigate(event, back)}>← {seed?.returnTitle ?? entity.title}</a>
    <div className="admin-page-heading"><p className="admin-eyebrow">Graphe éditorial</p><h1>Ajouter une relation</h1>
      <p>Fiche de départ : <strong>{entity.title}</strong> · /{entity.slug} · {entity.kind}</p></div>
    {seed && <section className="admin-section" aria-label="Référence à qualifier">
      <h2>Référence à qualifier</h2><p>{from.title} → {to?.title ?? 'Chargement…'}</p>
      <p className="admin-muted">Départ : /{from.slug} · {from.id}<br />Destination : /{to?.slug ?? seed.toSlug} · {to?.id ?? seed.toId}</p>
      <p className="admin-muted">Note contenant la mention : {entity.title}{provenance?.locator ? ` · ${provenance.locator}` : ''}.</p>
      <p className="admin-muted">Une mention n’est pas une preuve sémantique. Choisissez le type et vérifiez l’énoncé et la provenance avant de confirmer.</p>
      {!provenance?.source && <p>Source Obsidian non vérifiable : choisissez manuellement une Source.</p>}
      {seedLoading && <p role="status">Vérification de la fiche cible…</p>}
      {seedError && <p role="alert">{seedError} <button type="button" onClick={() => setSeedAttempt(value => value + 1)}>Réessayer</button></p>}
      {seedSessionExpired && <a href="/api/auth/discord/login">Se reconnecter avec Discord</a>}
      <button type="button" disabled={busy || disabled || !target} onClick={() => {
        setReversed(value => !value); setReview(false); change('claimText', '')
      }}>Inverser les fiches</button>
    </section>}
    {duplicate && <p role="alert">Cette relation éditoriale existe déjà ({duplicate.status} · {duplicate.visibility}).
      {' '}Choisissez un autre type ou retournez à la fiche.</p>}
    {error && <div className="admin-form-error" role="alert" tabIndex={-1} ref={errorRef}>{error.message}
      {error.status === 401 && <> Vos données restent affichées. <a href="/api/auth/discord/login">Se reconnecter avec Discord</a></>}
    </div>}
    {kindWarning && <p role="status" className="admin-muted">{kindWarning}</p>}
    {review ? <section className="admin-section admin-create-review"><h2>Vérifier avant création</h2>
      <dl><dt>Relation</dt><dd>{from.title} → {chosenLabel} → {to?.title}</dd>
        <dt>Stockage canonique</dt><dd>{swapForStorage ? to?.title : from.title} → {chosenType?.code} →
          {' '}{swapForStorage ? from.title : to?.title}{chosenType?.symmetric ? ' · symétrique' : ''}</dd>
        <dt>Description</dt><dd>{form.description.trim() || '—'}</dd>
        <dt>Statut initial</dt><dd>PROPOSED · sans publication</dd>
        <dt>Visibilité</dt><dd>{form.visibility}</dd>
        <dt>Source</dt><dd>{mode === 'existing' ? `${selectedSource?.label} · ${selectedSource?.kind} · ${selectedSource?.id}`
          : `${form.sourceLabel.trim()} · ${form.sourceKind} (nouvelle) · ${form.sourceVisibility}`}</dd>
        {mode === 'existing' && <><dt>ID externe / auteur</dt><dd>{selectedSource?.externalId ?? '—'} · {selectedSource?.authorLabel ?? '—'}</dd></>}
        {mode === 'new' && <><dt>ID externe / URL</dt><dd>{form.sourceExternalId || '—'} · {form.sourceUrl || '—'}</dd>
          <dt>Auteur / date</dt><dd>{form.sourceAuthorLabel.trim() || '—'} · {form.sourcePublishedAt || '—'}</dd></>}
        <dt>Evidence</dt><dd>{form.claimText.trim()}</dd>
        <dt>Extrait / repère</dt><dd>{form.sourceExcerpt.trim() || '—'} · {form.locator.trim() || '—'}</dd>
        <dt>Temps / confiance</dt><dd>{timeLabel(form.timeStartSeconds) ?? '—'} → {timeLabel(form.timeEndSeconds) ?? '—'} · {form.confidence || '—'}</dd>
        <dt>Visibilité de la preuve</dt><dd>{form.evidenceVisibility}</dd></dl>
      <p className="admin-muted">Cette relation restera absente du Codex public jusqu’à sa publication et celle de ses deux fiches en PUBLIC.</p>
      <div className="admin-editor-actions"><button type="button" disabled={busy} onClick={() => setReview(false)}>Corriger</button>
        <button className="admin-primary-button" type="button" disabled={blocked}
          onClick={() => { if (!blocked) onCreate(request()) }}>{busy ? 'Création…' : 'Créer la relation'}</button></div>
    </section> : <form onSubmit={proceed} noValidate>
      <section className="admin-section"><h2>Relation</h2><div className="admin-editor-grid">
        <label>Type et sens<select id="relationCode" value={form.relationCode} {...field('relationCode')}
          onChange={(event) => change('relationCode', event.target.value)}><option value="">Choisir…</option>
          {groupRelationTypes(types ?? []).map(group => <optgroup key={group.code} label={group.label}>
            {group.types.flatMap(item => [<option key={item.code} value={item.code}>{item.label}{item.symmetric ? ' · symétrique' : ''}</option>,
              ...(!item.symmetric && item.inverseCode
                ? [<option key={item.inverseCode} value={item.inverseCode}>{item.inverseLabel ?? item.inverseCode}</option>] : [])])}
          </optgroup>)}
        </select>{errorText('relationCode')}</label>
        <label>Visibilité<select value={form.visibility} onChange={(event) => change('visibility', event.target.value as Visibility)}>
          {visibilities.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        {types === null && !typesError && <p role="status">Chargement du catalogue…</p>}
        {typesError && <p role="alert" className="admin-field-error">Catalogue des relations indisponible.
          {' '}<button type="button" onClick={() => setTypesAttempt(value => value + 1)}>Recharger le catalogue</button></p>}
        <label className="admin-editor-wide">Description<textarea value={form.description} maxLength={10_000} rows={3}
          onChange={(event) => change('description', event.target.value)} /></label>
      </div>{seed && <button type="button" onClick={() => setTargetPickerOpen(value => !value)}
        aria-expanded={targetPickerOpen}>Changer la fiche cible</button>}
      <div className="admin-source-picker" hidden={!targetPickerOpen}><label>Rechercher une fiche cible<input type="search" value={targetQuery}
        maxLength={100} onChange={(event) => { setTargetQuery(event.target.value); setTargetPage(1) }} /></label>
        {targetQuery.trim().length === 1 && <p className="admin-muted">Deux caractères minimum pour rechercher.</p>}
        {targetLoading && <p role="status">Recherche des fiches…</p>}
        {targetError && <p role="alert" className="admin-field-error">{targetError}</p>}
        {targets && !targetLoading && <><p className="admin-muted">{targets.total} fiche(s) trouvée(s), 50 par page.</p>
          {targets.items.length === 0 && <p>Aucune fiche trouvée.</p>}
          <div className="admin-source-options">{targets.items.map((item) => <label key={item.id}>
            <input type="radio" name="relation-target" checked={target?.id === item.id}
              disabled={item.id === entity.id || item.status === 'ARCHIVED'} onChange={() => chooseTarget(item)} />
            <span><strong>{item.title}</strong><small>/{item.slug} · {item.kind}{item.placeKind ? ` / ${item.placeKind}` : ''} · {item.status} · {item.visibility}
              {item.id === entity.id ? ' · fiche de départ' : item.status === 'ARCHIVED' ? ' · archivée' : ''}</small></span>
          </label>)}</div><div className="admin-pagination"><button type="button" disabled={targetPage <= 1}
            onClick={() => setTargetPage(targetPage - 1)}>Précédent</button><span>Page {targetPage}</span>
            <button type="button" disabled={targetPage * targets.pageSize >= targets.total}
              onClick={() => setTargetPage(targetPage + 1)}>Suivant</button></div></>}
        <span id="toEntityId" tabIndex={-1}>{errorText('toEntityId')}</span>
        {target && <p className="admin-muted">Fiche cible choisie : {target.title} · /{target.slug}</p>}
      </div></section>
      <section className="admin-section"><h2>Provenance</h2><fieldset className="admin-source-mode">
        <legend>Source de la preuve</legend>
        <label><input type="radio" name="source-mode" checked={mode === 'existing'} onChange={() => switchSourceMode('existing')} />Source existante</label>
        <label><input type="radio" name="source-mode" checked={mode === 'new'} onChange={() => switchSourceMode('new')} />Nouvelle source</label>
      </fieldset>
        {mode === 'existing' ? <AdminSourcePicker selected={selectedSource} onSelect={(source) => {
          setSelectedSource(source); setLocalIssues([]); if (error?.status !== 401) onClearError()
        }} error={issue('source.sourceId')} /> : <><p className="admin-muted">La Source pourra être réutilisée. Un label identique sans ID externe ne provoque aucune fusion.</p>
          <div className="admin-editor-grid">
            <label>Type de Source<select value={form.sourceKind} onChange={(event) => change('sourceKind', event.target.value as SourceKind)}>
              {sourceKinds.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            <label>Label<input id="source.data.label" value={form.sourceLabel} maxLength={250} {...field('source.data.label')}
              onChange={(event) => change('sourceLabel', event.target.value)} />{errorText('source.data.label')}</label>
            <label>ID externe<input value={form.sourceExternalId} maxLength={250} {...field('source.data.externalId')}
              onChange={(event) => change('sourceExternalId', event.target.value)} />{errorText('source.data.externalId')}</label>
            <label>URL HTTP(S)<input type="url" value={form.sourceUrl} {...field('source.data.url')}
              onChange={(event) => change('sourceUrl', event.target.value)} />{errorText('source.data.url')}</label>
            <label>Auteur<input value={form.sourceAuthorLabel} maxLength={200}
              onChange={(event) => change('sourceAuthorLabel', event.target.value)} /></label>
            <label>Date de publication (ISO 8601)<input value={form.sourcePublishedAt} {...field('source.data.publishedAt')}
              placeholder="2026-09-29T12:00:00.000Z" onChange={(event) => change('sourcePublishedAt', event.target.value)} />
              {errorText('source.data.publishedAt')}</label>
            <label>Visibilité de la Source<select value={form.sourceVisibility}
              onChange={(event) => change('sourceVisibility', event.target.value as Visibility)}>
              {visibilities.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          </div></>}
      </section>
      <section className="admin-section"><h2>Evidence initiale</h2><div className="admin-editor-grid">
        {seed && chosenType && to && <div className="admin-editor-wide"><p>Énoncé proposé : {from.title} {chosenLabel} {to.title}.</p>
          <button type="button" onClick={() => change('claimText', `${from.title} ${chosenLabel} ${to.title}.`)}>Utiliser cet énoncé</button></div>}
        <label className="admin-editor-wide">Énoncé<input id="evidence.claimText" value={form.claimText} maxLength={10_000}
          {...field('evidence.claimText')} onChange={(event) => change('claimText', event.target.value)} />
          {errorText('evidence.claimText')}</label>
        <label className="admin-editor-wide">Extrait de la Source<textarea value={form.sourceExcerpt} maxLength={100_000} rows={3}
          onChange={(event) => change('sourceExcerpt', event.target.value)} /></label>
        <label>Repère<input value={form.locator} maxLength={250} {...field('evidence.locator')}
          onChange={(event) => change('locator', event.target.value)} />{errorText('evidence.locator')}</label>
        <label>Début en secondes<input type="number" min="0" step="1" value={form.timeStartSeconds}
          {...field('evidence.timeStartSeconds')} onChange={(event) => change('timeStartSeconds', event.target.value)} />
          {timeLabel(form.timeStartSeconds) && <small>{timeLabel(form.timeStartSeconds)}</small>}
          {errorText('evidence.timeStartSeconds')}</label>
        <label>Fin en secondes<input type="number" min="0" step="1" value={form.timeEndSeconds}
          {...field('evidence.timeEndSeconds')} onChange={(event) => change('timeEndSeconds', event.target.value)} />
          {timeLabel(form.timeEndSeconds) && <small>{timeLabel(form.timeEndSeconds)}</small>}
          {errorText('evidence.timeEndSeconds')}</label>
        <label>Confiance (0 à 1)<input type="number" min="0" max="1" step="0.001" value={form.confidence}
          {...field('evidence.confidence')} onChange={(event) => change('confidence', event.target.value)} />
          {errorText('evidence.confidence')}</label>
        <label>Visibilité de la preuve<select value={form.evidenceVisibility}
          onChange={(event) => change('evidenceVisibility', event.target.value as Visibility)}>
          {visibilities.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      </div></section>
      <div className="admin-editor-actions"><button className="admin-primary-button" type="submit" disabled={blocked}>Vérifier la création</button></div>
    </form>}
  </div>
}
