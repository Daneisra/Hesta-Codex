import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type {
  AdminManualCreateRequest, AdminSource, EntityKind, PlaceKind, SourceKind, Visibility,
} from '@hesta-codex/shared'
import { AdminSourcePicker } from './AdminSourcePicker'

const kinds: EntityKind[] = ['PERSON', 'PLACE', 'ORGANIZATION', 'FAMILY', 'RELIGION', 'DEITY', 'SPECIES',
  'CREATURE', 'ARTIFACT', 'EVENT', 'QUEST', 'SESSION', 'CONCEPT', 'OTHER']
const places: PlaceKind[] = ['CITY', 'CONTINENT', 'REGION', 'SEA', 'OCEAN', 'OTHER']
const sourceKinds: SourceKind[] = ['MANUAL', 'OBSIDIAN', 'DISCORD', 'HESTA_MAP', 'YOUTUBE', 'AI_DERIVED', 'OTHER']
const visibilities: Visibility[] = ['PUBLIC', 'PLAYERS', 'GM', 'SECRET']
type Issue = { path: string; message: string }
type Form = {
  title: string; slug: string; kind: EntityKind; placeKind: PlaceKind | ''; summary: string;
  bodyMarkdown: string; aliases: string; tags: string; visibility: Visibility;
  sourceKind: SourceKind; sourceLabel: string; sourceExternalId: string; sourceUrl: string;
  sourceAuthorLabel: string; sourcePublishedAt: string; sourceVisibility: Visibility;
  claimText: string; sourceExcerpt: string; locator: string; timeStartSeconds: string;
  timeEndSeconds: string; confidence: string; evidenceVisibility: Visibility
}
const initial: Form = {
  title: '', slug: '', kind: 'PERSON', placeKind: '', summary: '', bodyMarkdown: '', aliases: '', tags: '',
  visibility: 'GM', sourceKind: 'MANUAL', sourceLabel: '', sourceExternalId: '', sourceUrl: '',
  sourceAuthorLabel: '', sourcePublishedAt: '', sourceVisibility: 'GM', claimText: '',
  sourceExcerpt: '', locator: '', timeStartSeconds: '', timeEndSeconds: '', confidence: '', evidenceVisibility: 'GM',
}

function suggestSlug(title: string): string {
  return title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 200).replace(/-$/, '')
}
function terms(text: string): string[] { return text.trim() ? text.split(',').map((value) => value.trim()) : [] }
function seconds(value: string): number | null { return value.trim() === '' ? null : Number(value) }
function timeLabel(value: string): string | null {
  const count = seconds(value)
  if (count === null || !Number.isInteger(count) || count < 0 || count > 2_147_483_647) return null
  return [Math.floor(count / 3600), Math.floor((count % 3600) / 60), count % 60]
    .map((part) => String(part).padStart(2, '0')).join(':')
}

export function AdminCreate({ busy, disabled, error, onCreate, onClearError, onDirtyChange, onNavigate }: {
  busy: boolean; disabled: boolean
  error: { status: number | null; message: string; issues?: Issue[] } | null
  onCreate: (input: AdminManualCreateRequest) => void
  onClearError: () => void
  onDirtyChange: (dirty: boolean) => void
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, path: string) => void
}) {
  const [form, setForm] = useState<Form>(initial)
  const [slugEdited, setSlugEdited] = useState(false)
  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const [selectedSource, setSelectedSource] = useState<AdminSource | null>(null)
  const [review, setReview] = useState(false)
  const [localIssues, setLocalIssues] = useState<Issue[]>([])
  const errorRef = useRef<HTMLDivElement>(null)
  const issues = [...localIssues, ...(error?.issues ?? [])]
  const issue = (path: string) => issues.find((item) => item.path === path || item.path.startsWith(`${path}.`))?.message
  const field = (path: string) => ({ 'aria-invalid': !!issue(path),
    'aria-describedby': issue(path) ? `${path}-error` : undefined })
  const errorText = (path: string) => issue(path)
    ? <span id={`${path}-error`} className="admin-field-error">{issue(path)}</span> : null

  useEffect(() => {
    if (error?.status === 400) setReview(false)
  }, [error])

  useEffect(() => { if (error) errorRef.current?.focus() }, [error])

  useEffect(() => {
    onDirtyChange(JSON.stringify(form) !== JSON.stringify(initial) || selectedSource !== null || mode !== 'existing')
  }, [form, selectedSource, mode, onDirtyChange])

  function change<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((previous) => ({ ...previous, [key]: value }))
    setReview(false)
    setLocalIssues([])
    if (error?.status !== 401) onClearError()
  }
  function switchMode(next: 'existing' | 'new') {
    setMode(next)
    setReview(false)
    setLocalIssues([])
    if (error?.status !== 401) onClearError()
  }
  function makeRequest(): AdminManualCreateRequest {
    return {
      entity: { slug: form.slug, kind: form.kind,
        placeKind: form.kind === 'PLACE' && form.placeKind !== '' ? form.placeKind : null,
        title: form.title.trim(), summary: form.summary.trim() || null, bodyMarkdown: form.bodyMarkdown,
        aliases: terms(form.aliases), tags: terms(form.tags), visibility: form.visibility },
      source: mode === 'existing' ? { mode, sourceId: selectedSource?.id ?? '' }
        : { mode, data: { kind: form.sourceKind, label: form.sourceLabel.trim(),
          externalId: form.sourceExternalId || null, url: form.sourceUrl || null,
          authorLabel: form.sourceAuthorLabel.trim() || null, publishedAt: form.sourcePublishedAt || null,
          visibility: form.sourceVisibility } },
      evidence: { claimText: form.claimText.trim(), sourceExcerpt: form.sourceExcerpt.trim() || null,
        locator: form.locator.trim() || null,
        timeStartSeconds: seconds(form.timeStartSeconds), timeEndSeconds: seconds(form.timeEndSeconds),
        confidence: seconds(form.confidence), visibility: form.evidenceVisibility },
    }
  }
  function proceed(event: FormEvent) {
    event.preventDefault()
    const invalid: Issue[] = []
    if (!form.title.trim()) invalid.push({ path: 'entity.title', message: 'Le titre est requis.' })
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.slug)) {
      invalid.push({ path: 'entity.slug', message: 'Slug en minuscules, chiffres et tirets requis.' })
    }
    if (form.kind === 'PLACE' && !form.placeKind) invalid.push({ path: 'entity.placeKind', message: 'Choisissez un sous-type de lieu.' })
    if (mode === 'existing' && !selectedSource) invalid.push({ path: 'source.sourceId', message: 'Choisissez une Source.' })
    if (mode === 'new' && !form.sourceLabel.trim()) invalid.push({ path: 'source.data.label', message: 'Le label est requis.' })
    if (!form.claimText.trim()) invalid.push({ path: 'evidence.claimText', message: 'L’énoncé est requis.' })
    for (const [key, path] of [
      ['timeStartSeconds', 'evidence.timeStartSeconds'], ['timeEndSeconds', 'evidence.timeEndSeconds'],
    ] as const) {
      const value = seconds(form[key])
      if (value !== null && (!Number.isInteger(value) || value < 0 || value > 2_147_483_647)) {
        invalid.push({ path, message: 'Entier positif en secondes requis.' })
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
    if (invalid.length > 0) {
      document.getElementById(invalid[0]!.path)?.focus()
      return
    }
    setReview(true)
  }

  return <div className="admin-create">
    <a className="admin-back" href="/admin" onClick={(event) => onNavigate(event, '/admin')}>← Tableau de bord</a>
    <div className="admin-page-heading"><p className="admin-eyebrow">Création éditoriale</p><h1>Nouvelle fiche</h1>
      <p>La fiche sera créée en proposition, avec une Source, une preuve et une première Revision.</p></div>
    {error && <div className="admin-form-error" role="alert" tabIndex={-1} ref={errorRef}>{error.message}
      {error.status === 401 && <> Vos données restent affichées. <a href="/api/auth/discord/login">Se reconnecter avec Discord</a></>}
    </div>}
    {review ? <section className="admin-section admin-create-review"><h2>Vérifier avant création</h2>
      <dl><dt>Fiche</dt><dd>{form.title.trim()} · /{form.slug} · {form.kind}{form.kind === 'PLACE' ? ` / ${form.placeKind}` : ''}</dd>
        <dt>Résumé</dt><dd>{form.summary.trim() || '—'}</dd>
        <dt>Contenu</dt><dd>{form.bodyMarkdown.length} caractères Markdown
          {form.bodyMarkdown && <details><summary>Lire le contenu</summary><pre>{form.bodyMarkdown}</pre></details>}</dd>
        <dt>Alias / tags</dt><dd>{terms(form.aliases).join(' · ') || '—'} / {terms(form.tags).join(' · ') || '—'}</dd>
        <dt>Source</dt><dd>{mode === 'existing' ? `${selectedSource?.label} · ${selectedSource?.kind} · ${selectedSource?.id}`
          : `${form.sourceLabel.trim()} · ${form.sourceKind} (nouvelle)${form.sourceExternalId ? ` · ${form.sourceExternalId}` : ''}`}</dd>
        {mode === 'existing' && <><dt>ID externe / auteur / visibilité</dt>
          <dd>{selectedSource?.externalId ?? '—'} · {selectedSource?.authorLabel ?? '—'} · {selectedSource?.visibility ?? '—'}</dd></>}
        {mode === 'new' && <><dt>URL / auteur / date</dt><dd>{form.sourceUrl || '—'} · {form.sourceAuthorLabel.trim() || '—'} · {form.sourcePublishedAt || '—'}</dd>
          <dt>Visibilité de la Source</dt><dd>{form.sourceVisibility}</dd></>}
        <dt>Evidence</dt><dd>{form.claimText.trim()}</dd>
        <dt>Extrait / repère</dt><dd>{form.sourceExcerpt.trim() || '—'} · {form.locator.trim() || '—'}</dd>
        <dt>Temps / confiance</dt><dd>{timeLabel(form.timeStartSeconds) ?? '—'} → {timeLabel(form.timeEndSeconds) ?? '—'} · {form.confidence || '—'}</dd>
        <dt>Statut initial</dt><dd>PROPOSED · sans publication</dd>
        <dt>Visibilité de la fiche</dt><dd>{form.visibility}</dd>
        <dt>Visibilité de la preuve</dt><dd>{form.evidenceVisibility}</dd></dl>
      <p className="admin-muted">Même avec une visibilité PUBLIC, la fiche restera absente du Codex public tant qu’elle n’est pas publiée.</p>
      <div className="admin-editor-actions"><button type="button" disabled={busy} onClick={() => setReview(false)}>Corriger</button>
        <button className="admin-primary-button" type="button" disabled={busy || disabled}
          onClick={() => onCreate(makeRequest())}>{busy ? 'Création…' : 'Créer la fiche'}</button></div>
    </section> : <form onSubmit={proceed} noValidate>
      <section className="admin-section"><h2>Fiche</h2><div className="admin-editor-grid">
        <label>Titre<input id="entity.title" value={form.title} maxLength={200} {...field('entity.title')}
          onChange={(event) => {
            change('title', event.target.value)
            if (!slugEdited) setForm((previous) => ({ ...previous, title: event.target.value,
              slug: suggestSlug(event.target.value) }))
          }} />{errorText('entity.title')}</label>
        <label>Slug<input id="entity.slug" value={form.slug} maxLength={200} {...field('entity.slug')}
          onChange={(event) => { setSlugEdited(true); change('slug', event.target.value) }} />
          {errorText('entity.slug')}</label>
        <label>Type<select value={form.kind} onChange={(event) => change('kind', event.target.value as EntityKind)}>
          {kinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></label>
        {form.kind === 'PLACE' && <label>Sous-type de lieu<select id="entity.placeKind" value={form.placeKind}
          {...field('entity.placeKind')} onChange={(event) => change('placeKind', event.target.value as PlaceKind)}>
          <option value="">Choisir…</option>{places.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
        </select>{errorText('entity.placeKind')}</label>}
        <label>Visibilité<select value={form.visibility} onChange={(event) => change('visibility', event.target.value as Visibility)}>
          {visibilities.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="admin-editor-wide">Résumé<textarea value={form.summary} maxLength={500} rows={3}
          onChange={(event) => change('summary', event.target.value)} /></label>
        <label className="admin-editor-wide">Alias, séparés par des virgules<input value={form.aliases} {...field('entity.aliases')}
          onChange={(event) => change('aliases', event.target.value)} />{errorText('entity.aliases')}</label>
        <label className="admin-editor-wide">Tags, séparés par des virgules<input value={form.tags} {...field('entity.tags')}
          onChange={(event) => change('tags', event.target.value)} />{errorText('entity.tags')}</label>
        <label className="admin-editor-wide">Contenu Markdown<textarea value={form.bodyMarkdown} maxLength={100_000} rows={12}
          onChange={(event) => change('bodyMarkdown', event.target.value)} /></label>
      </div><div className="admin-editor-preview"><h3>Aperçu Markdown</h3><div className="markdown-body admin-markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{form.bodyMarkdown || 'Aucun contenu détaillé.'}</ReactMarkdown>
      </div></div></section>
      <section className="admin-section"><h2>Provenance</h2><fieldset className="admin-source-mode"
        aria-describedby={issue('source.sourceId') ? 'source.sourceId-error' : undefined}>
        <legend>Source de la preuve</legend>
        <label><input type="radio" name="source-mode" checked={mode === 'existing'} onChange={() => switchMode('existing')} />Source existante</label>
        <label><input type="radio" name="source-mode" checked={mode === 'new'} onChange={() => switchMode('new')} />Nouvelle source</label>
      </fieldset>
        {mode === 'existing' ? <AdminSourcePicker selected={selectedSource}
          onSelect={(source) => { setSelectedSource(source); setLocalIssues([]); if (error?.status !== 401) onClearError() }}
          error={issue('source.sourceId')} /> : <><p className="admin-muted">Une nouvelle Source pourra ensuite être réutilisée par d’autres fiches et preuves.
          Sans ID externe, un label identique ne réutilise pas automatiquement une Source existante.</p>
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
        <label className="admin-editor-wide">Énoncé<input id="evidence.claimText" value={form.claimText} maxLength={10_000}
          {...field('evidence.claimText')} onChange={(event) => change('claimText', event.target.value)} />
          {errorText('evidence.claimText')}</label>
        <label className="admin-editor-wide">Extrait de la Source<textarea value={form.sourceExcerpt} maxLength={100_000} rows={3}
          onChange={(event) => change('sourceExcerpt', event.target.value)} /></label>
        <label>Repère<input value={form.locator} maxLength={250} {...field('evidence.locator')}
          onChange={(event) => change('locator', event.target.value)} />
          {errorText('evidence.locator')}</label>
        <label>Début en secondes<input type="number" min="0" step="1" value={form.timeStartSeconds}
          {...field('evidence.timeStartSeconds')}
          onChange={(event) => change('timeStartSeconds', event.target.value)} />
          {timeLabel(form.timeStartSeconds) && <small>{timeLabel(form.timeStartSeconds)}</small>}
          {errorText('evidence.timeStartSeconds')}</label>
        <label>Fin en secondes<input type="number" min="0" step="1" value={form.timeEndSeconds}
          {...field('evidence.timeEndSeconds')}
          onChange={(event) => change('timeEndSeconds', event.target.value)} />
          {timeLabel(form.timeEndSeconds) && <small>{timeLabel(form.timeEndSeconds)}</small>}
          {errorText('evidence.timeEndSeconds')}</label>
        <label>Confiance (0 à 1)<input type="number" min="0" max="1" step="0.001" value={form.confidence}
          {...field('evidence.confidence')}
          onChange={(event) => change('confidence', event.target.value)} />{errorText('evidence.confidence')}</label>
        <label>Visibilité de la preuve<select value={form.evidenceVisibility}
          onChange={(event) => change('evidenceVisibility', event.target.value as Visibility)}>
          {visibilities.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      </div></section>
      <div className="admin-editor-actions"><button className="admin-primary-button" type="submit">Vérifier la création</button></div>
    </form>}
  </div>
}
