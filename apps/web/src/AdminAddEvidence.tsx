import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { AdminEvidence, AdminEvidenceAddRequest, AdminSource, SourceKind, Visibility } from '@hesta-codex/shared'
import { AdminSourcePicker } from './AdminSourcePicker'

type Issue = { path: string; message: string }
type Form = {
  sourceKind: SourceKind; sourceLabel: string; externalId: string; url: string; authorLabel: string;
  publishedAt: string; sourceVisibility: Visibility; claimText: string; sourceExcerpt: string;
  locator: string; timeStartSeconds: string; timeEndSeconds: string; confidence: string;
  visibility: Visibility
}
const initial: Form = { sourceKind: 'MANUAL', sourceLabel: '', externalId: '', url: '', authorLabel: '',
  publishedAt: '', sourceVisibility: 'GM', claimText: '', sourceExcerpt: '', locator: '',
  timeStartSeconds: '', timeEndSeconds: '', confidence: '', visibility: 'GM' }
const kinds: SourceKind[] = ['MANUAL', 'OBSIDIAN', 'DISCORD', 'HESTA_MAP', 'YOUTUBE', 'AI_DERIVED', 'OTHER']
const visibilities: Visibility[] = ['PUBLIC', 'PLAYERS', 'GM', 'SECRET']
const numberOrNull = (value: string) => value.trim() === '' ? null : Number(value)
const timeLabel = (seconds: number | null) => seconds === null || !Number.isInteger(seconds) || seconds < 0
  ? null : [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60]
    .map((part) => String(part).padStart(2, '0')).join(':')

export function AdminAddEvidence({ targetLabel, previous, busy, disabled, error, onSave, onCancel, onDirty }: {
  targetLabel: string; previous: AdminEvidence[]; busy: boolean; disabled: boolean
  error: { status: number | null; message: string; issues?: Issue[] } | null
  onSave: (input: AdminEvidenceAddRequest) => Promise<boolean>
  onCancel: () => void; onDirty: (dirty: boolean) => void
}) {
  const [form, setForm] = useState<Form>(initial)
  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const [source, setSource] = useState<AdminSource | null>(null)
  const [review, setReview] = useState(false)
  const [issues, setIssues] = useState<Issue[]>([])
  const errorRef = useRef<HTMLDivElement>(null)
  const allIssues = [...issues, ...(error?.issues ?? [])]
  const issue = (path: string) => allIssues.find((item) => item.path === path || item.path.startsWith(`${path}.`))?.message
  const errorText = (path: string) => issue(path) && <span id={`${path}-error`} className="admin-field-error">{issue(path)}</span>
  const field = (path: string) => ({ 'aria-invalid': !!issue(path),
    'aria-describedby': issue(path) ? `${path}-error` : undefined })
  useEffect(() => { onDirty(JSON.stringify(form) !== JSON.stringify(initial) || mode !== 'existing' || source !== null) },
    [form, mode, source, onDirty])
  useEffect(() => { if (error?.status === 400) setReview(false); if (error) errorRef.current?.focus() }, [error])

  function change<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((old) => ({ ...old, [key]: value })); setReview(false); setIssues([])
  }
  function request(): AdminEvidenceAddRequest {
    return { source: mode === 'existing' ? { mode, sourceId: source!.id } : { mode, data: {
      kind: form.sourceKind, label: form.sourceLabel.trim(), externalId: form.externalId || null,
      url: form.url || null, authorLabel: form.authorLabel.trim() || null,
      publishedAt: form.publishedAt || null, visibility: form.sourceVisibility,
    } }, evidence: {
      claimText: form.claimText.trim(), sourceExcerpt: form.sourceExcerpt.trim() || null,
      locator: form.locator.trim() || null, timeStartSeconds: numberOrNull(form.timeStartSeconds),
      timeEndSeconds: numberOrNull(form.timeEndSeconds), confidence: numberOrNull(form.confidence),
      visibility: form.visibility,
    } }
  }
  function proceed(event: FormEvent) {
    event.preventDefault()
    const found: Issue[] = []
    if (mode === 'existing' && !source) found.push({ path: 'source.sourceId', message: 'Choisissez une Source.' })
    if (mode === 'new' && !form.sourceLabel.trim()) found.push({ path: 'source.data.label', message: 'Le label est requis.' })
    if (!form.claimText.trim()) found.push({ path: 'evidence.claimText', message: 'L’énoncé est requis.' })
    for (const key of ['timeStartSeconds', 'timeEndSeconds'] as const) {
      const value = numberOrNull(form[key])
      if (value !== null && (!Number.isInteger(value) || value < 0 || value > 2_147_483_647)) {
        found.push({ path: `evidence.${key}`, message: 'Entier positif en secondes requis.' })
      }
    }
    const start = numberOrNull(form.timeStartSeconds), end = numberOrNull(form.timeEndSeconds)
    if (start !== null && end !== null && end < start) {
      found.push({ path: 'evidence.timeEndSeconds', message: 'La fin doit suivre le début.' })
    }
    const confidence = numberOrNull(form.confidence)
    if (confidence !== null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1 ||
      Math.abs(confidence * 1000 - Math.round(confidence * 1000)) >= 1e-8)) {
      found.push({ path: 'evidence.confidence', message: 'Nombre entre 0 et 1, avec trois décimales au plus.' })
    }
    setIssues(found)
    if (found.length) { document.getElementById(found[0]!.path)?.focus(); return }
    setReview(true)
  }
  const probable = mode === 'existing' && source && previous.some((item) => item.source.id === source.id &&
    (item.claimText === form.claimText.trim() || (form.locator.trim() !== '' && item.locator === form.locator.trim() &&
      item.timeStartSeconds === numberOrNull(form.timeStartSeconds) && item.timeEndSeconds === numberOrNull(form.timeEndSeconds))))

  return <section className="admin-section admin-add-evidence"><h3>Ajouter une preuve</h3>
    {error && <div className="admin-form-error" role="alert" tabIndex={-1} ref={errorRef}>{error.message}
      {error.status === 401 && <> La saisie reste affichée. <a href="/api/auth/discord/login">Se reconnecter avec Discord</a></>}
    </div>}
    {review ? <div className="admin-create-review"><h4>Vérifier avant ajout</h4><dl>
      <dt>Cible</dt><dd>{targetLabel}</dd><dt>Source</dt><dd>{mode === 'existing'
        ? `${source?.label} · ${source?.kind} · ${source?.externalId ?? 'sans ID externe'}`
        : `${form.sourceLabel.trim()} · ${form.sourceKind} (nouvelle)`}</dd>
      <dt>Détails de la Source</dt><dd>{mode === 'existing'
        ? `${source?.authorLabel ?? 'auteur non renseigné'} · ${source?.publishedAt ?? 'sans date'} · ${source?.visibility ?? '—'}`
        : `${form.externalId || 'sans ID externe'} · ${form.authorLabel.trim() || 'auteur non renseigné'} · ${form.publishedAt || 'sans date'} · ${form.sourceVisibility}`}</dd>
      {mode === 'new' && <><dt>URL</dt><dd>{form.url || '—'}</dd></>}
      <dt>Énoncé</dt><dd>{form.claimText.trim()}</dd><dt>Extrait</dt><dd>{form.sourceExcerpt.trim() || '—'}</dd>
      <dt>Repère / temps</dt><dd>{form.locator.trim() || '—'} · {timeLabel(numberOrNull(form.timeStartSeconds)) ?? '—'} →
        {' '}{timeLabel(numberOrNull(form.timeEndSeconds)) ?? '—'}</dd>
      <dt>Confiance / visibilité</dt><dd>{form.confidence || '—'} · {form.visibility}</dd></dl>
      {probable && <p className="admin-warning" role="status">Une preuve proche existe déjà pour cette cible et cette Source. Vérifiez l’énoncé et le repère.</p>}
      <div className="admin-editor-actions"><button type="button" disabled={busy} onClick={() => setReview(false)}>Corriger</button>
        <button className="admin-primary-button" type="button" disabled={busy || disabled}
          onClick={() => void onSave(request())}>{busy ? 'Ajout…' : 'Ajouter la preuve'}</button></div>
    </div> : <form onSubmit={proceed} noValidate>
      <fieldset className="admin-source-mode"><legend>Source de la preuve</legend>
        <label><input type="radio" name="add-evidence-source" checked={mode === 'existing'} onChange={() => { setMode('existing'); setReview(false) }} />Source existante</label>
        <label><input type="radio" name="add-evidence-source" checked={mode === 'new'} onChange={() => { setMode('new'); setReview(false) }} />Nouvelle source</label>
      </fieldset>
      {mode === 'existing' ? <AdminSourcePicker selected={source} onSelect={setSource} error={issue('source.sourceId')} />
        : <div className="admin-editor-grid">
          <label>Type de Source<select value={form.sourceKind} onChange={(event) => change('sourceKind', event.target.value as SourceKind)}>
            {kinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></label>
          <label>Label<input id="source.data.label" maxLength={250} value={form.sourceLabel} {...field('source.data.label')}
            onChange={(event) => change('sourceLabel', event.target.value)} />{errorText('source.data.label')}</label>
          <label>ID externe<input maxLength={250} value={form.externalId} {...field('source.data.externalId')}
            onChange={(event) => change('externalId', event.target.value)} />{errorText('source.data.externalId')}</label>
          <label>URL HTTP(S)<input type="url" value={form.url} {...field('source.data.url')}
            onChange={(event) => change('url', event.target.value)} />{errorText('source.data.url')}</label>
          <label>Auteur<input maxLength={200} value={form.authorLabel} onChange={(event) => change('authorLabel', event.target.value)} /></label>
          <label>Date de publication ISO 8601<input value={form.publishedAt} {...field('source.data.publishedAt')}
            placeholder="2026-09-29T12:00:00.000Z" onChange={(event) => change('publishedAt', event.target.value)} />
            {errorText('source.data.publishedAt')}</label>
          <label>Visibilité de la Source<select value={form.sourceVisibility}
            onChange={(event) => change('sourceVisibility', event.target.value as Visibility)}>
            {visibilities.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        </div>}
      <div className="admin-editor-grid">
        <label className="admin-editor-wide">Énoncé<textarea id="evidence.claimText" value={form.claimText} maxLength={10_000}
          {...field('evidence.claimText')} onChange={(event) => change('claimText', event.target.value)} rows={3} />
          {errorText('evidence.claimText')}</label>
        <label className="admin-editor-wide">Extrait source<textarea value={form.sourceExcerpt} maxLength={100_000} rows={3}
          onChange={(event) => change('sourceExcerpt', event.target.value)} /></label>
        <label>Repère<input value={form.locator} maxLength={250} onChange={(event) => change('locator', event.target.value)} /></label>
        <label>Début en secondes<input type="number" min="0" step="1" value={form.timeStartSeconds}
          {...field('evidence.timeStartSeconds')} onChange={(event) => change('timeStartSeconds', event.target.value)} />
          {timeLabel(numberOrNull(form.timeStartSeconds)) && <small>{timeLabel(numberOrNull(form.timeStartSeconds))}</small>}
          {errorText('evidence.timeStartSeconds')}</label>
        <label>Fin en secondes<input type="number" min="0" step="1" value={form.timeEndSeconds}
          {...field('evidence.timeEndSeconds')} onChange={(event) => change('timeEndSeconds', event.target.value)} />
          {timeLabel(numberOrNull(form.timeEndSeconds)) && <small>{timeLabel(numberOrNull(form.timeEndSeconds))}</small>}
          {errorText('evidence.timeEndSeconds')}</label>
        <label>Confiance (0 à 1)<input type="number" min="0" max="1" step="0.001" value={form.confidence}
          {...field('evidence.confidence')} onChange={(event) => change('confidence', event.target.value)} />
          {errorText('evidence.confidence')}</label>
        <label>Visibilité de la preuve<select value={form.visibility}
          onChange={(event) => change('visibility', event.target.value as Visibility)}>
          {visibilities.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      </div>
      <div className="admin-editor-actions"><button type="button" disabled={busy} onClick={onCancel}>Annuler</button>
        <button className="admin-primary-button" type="submit" disabled={busy || disabled}>Vérifier avant ajout</button></div>
    </form>}
  </section>
}
