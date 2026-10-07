import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { EntityKind, IngestionProposalCreated, IngestionProposalPreparation, IngestionProposalRequest, PlaceKind, Visibility } from '@hesta-codex/shared'
import { getAdminJson, errorStatus, HttpError } from './admin-http'
import { kindLabels, placeLabels } from './graph-model'
import { IngestionTerms as Terms } from './IngestionTerms'

const suggestSlug = (title: string) => title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 200).replace(/-$/, '')
type Issue = { path: string; message: string }
type Draft = { title: string; slug: string; kind: EntityKind | ''; placeKind: PlaceKind | ''; summary: string;
  bodyMarkdown: string; aliases: string[]; tags: string[]; visibility: Visibility; claimText: string; sourceExcerpt: string; locator: string }
type Load = { phase: 'loading' } | { phase: 'error'; status: number | null } | { phase: 'ready'; data: IngestionProposalPreparation }
export function IngestionProposalForm({ itemId, receiptId, onCancel, onCreated, onAccessError }: {
  itemId: string; receiptId: string; onCancel: () => void; onCreated: (result: IngestionProposalCreated) => void; onAccessError: (status: number) => void
}) {
  const [load, setLoad] = useState<Load>({ phase: 'loading' })
  const [draft, setDraft] = useState<Draft | null>(null)
  const [review, setReview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [issues, setIssues] = useState<Issue[]>([])
  const [failure, setFailure] = useState('')
  const controller = useRef<AbortController | null>(null)
  const slugEdited = useRef(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const alert = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const read = new AbortController()
    getAdminJson<IngestionProposalPreparation>(`/api/admin/ingestion/items/${itemId}/proposal?receiptId=${receiptId}`, read.signal)
      .then(data => {
        if (read.signal.aborted) return
        setLoad({ phase: 'ready', data }); setDraft({ title: data.title, slug: suggestSlug(data.title), kind: '', placeKind: '',
          summary: '', bodyMarkdown: data.bodyMarkdown, aliases: [], tags: data.tags, visibility: 'GM', claimText: '', sourceExcerpt: data.sourceExcerpt, locator: data.locator ?? '' })
      }).catch((error: unknown) => {
        if (read.signal.aborted) return
        const status = errorStatus(error); setLoad({ phase: 'error', status })
        if (status === 401 || status === 403) onAccessError(status)
      })
    return () => { read.abort(); controller.current?.abort() }
  }, [itemId, receiptId, onAccessError])
  useEffect(() => { heading.current?.focus() }, [load.phase, review])
  useEffect(() => { if (failure) alert.current?.focus() }, [failure])
  if (load.phase === 'loading') return <p role="status">Préparation de la fiche…</p>
  if (load.phase === 'error') return <div role="alert"><p>{load.status === 409 ? 'Cette identité ne permet plus une création. Vérifiez son association.' : load.status === 404 ? 'Item, réception ou Source introuvable.' : 'Préparation indisponible.'}</p>
    <button type="button" onClick={onCancel}>Retour vers l’item</button></div>
  if (!draft) return null
  const data = load.data
  const labels: Record<string, string> = { 'entity.title': 'Titre', 'entity.slug': 'Slug', 'entity.kind': 'Type de fiche',
    'entity.placeKind': 'Sous-type de lieu', 'entity.summary': 'Résumé', 'entity.bodyMarkdown': 'Contenu Markdown',
    'evidence.claimText': 'Énoncé de provenance', 'evidence.sourceExcerpt': 'Extrait de la Source', 'evidence.locator': 'Repère' }
  const issue = (path: string) => issues.find(value => value.path === path || value.path.startsWith(path + '.'))?.message
  const field = (path: string) => ({ id: `proposal-${path}`, 'aria-label': labels[path], 'aria-invalid': !!issue(path), 'aria-describedby': issue(path) ? `proposal-error-${path}` : undefined })
  const error = (path: string) => issue(path) ? <span id={`proposal-error-${path}`} className="admin-field-error">{issue(path)}</span> : null
  const change = <K extends keyof Draft>(key: K, value: Draft[K]) => { setDraft({ ...draft, [key]: value }); setIssues([]); if (!blocked) setFailure('') }
  const request = (): IngestionProposalRequest => ({ receiptId, expectedRevision: data.expectedRevision, entity: {
    title: draft.title, slug: draft.slug, kind: draft.kind as EntityKind, placeKind: draft.kind === 'PLACE' ? draft.placeKind as PlaceKind : null,
    summary: draft.summary.trim() || null, bodyMarkdown: draft.bodyMarkdown, aliases: draft.aliases, tags: draft.tags, visibility: draft.visibility,
  }, evidence: { claimText: draft.claimText, sourceExcerpt: draft.sourceExcerpt.trim() || null, locator: draft.locator.trim() || null } })
  const proceed = (event: FormEvent) => {
    event.preventDefault()
    if (busy || blocked) return
    const invalid: Issue[] = []
    if (!draft.title.trim() || draft.title.trim().length > 200) invalid.push({ path: 'entity.title', message: 'Titre requis, 200 caractères au plus.' })
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.slug) || draft.slug.length > 200) invalid.push({ path: 'entity.slug', message: 'Slug en minuscules, chiffres et tirets requis.' })
    if (!draft.kind) invalid.push({ path: 'entity.kind', message: 'Choisissez explicitement un type.' })
    if (draft.kind === 'PLACE' && !draft.placeKind) invalid.push({ path: 'entity.placeKind', message: 'Choisissez le sous-type de lieu.' })
    if (!draft.claimText.trim()) invalid.push({ path: 'evidence.claimText', message: 'Rédigez l’énoncé de provenance.' })
    if (draft.bodyMarkdown.length > 100_000) invalid.push({ path: 'entity.bodyMarkdown', message: '100 000 caractères au plus.' })
    setIssues(invalid)
    if (invalid.length) { document.getElementById(`proposal-${invalid[0]!.path}`)?.focus(); return }
    setFailure(''); setReview(true)
  }
  const submit = async () => {
    if (controller.current || blocked || !review) return
    const write = new AbortController(); controller.current = write; setBusy(true); setFailure('')
    try {
      const response = await fetch(`/api/admin/ingestion/items/${itemId}/proposal`, { method: 'POST', signal: write.signal,
        credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(request()) })
      if (!response.ok) {
        if (response.status === 400 || response.status === 409) {
          const payload = await response.json() as { error?: { code?: string; issues?: Issue[] } }
          if (write.signal.aborted) return
          if (response.status === 400) { setIssues(payload.error?.issues ?? []); setReview(false) }
          if (response.status === 409 && payload.error?.code === 'ENTITY_CONFLICT') {
            setReview(false); setIssues([{ path: 'entity.slug', message: 'Ce slug est déjà utilisé. Choisissez-en un autre.' }]); setFailure('Le slug est déjà utilisé. Votre saisie est conservée.'); return
          }
        }
        throw new HttpError(response.status)
      }
      const result = await response.json() as IngestionProposalCreated
      if (!write.signal.aborted) onCreated(result)
    } catch (error: unknown) {
      if (write.signal.aborted) return
      const status = errorStatus(error)
      if (status === 401 || status === 403) { setDraft(null); setBlocked(true); onAccessError(status); return }
      if (status === 413) {
        setReview(false); setIssues([])
        setFailure('Requête trop volumineuse. Réduisez le contenu ou l’extrait ; votre saisie est conservée.'); return
      }
      if (status !== 400) setBlocked(true)
      setFailure(status === 400 ? 'Corrigez les champs signalés. Votre saisie est conservée.' : status === 409 ?
        'L’association a changé. Revenez à l’item pour vérifier son état ; aucune nouvelle tentative automatique.' :
        status === 404 ? 'Item ou Source introuvable. Revenez à l’item.' : 'Création non confirmée. Vérifiez l’association de l’item avant de réessayer.')
    } finally {
      if (!write.signal.aborted) setBusy(false)
      if (controller.current === write) controller.current = null
    }
  }
  return <section className="ingestion-proposal" aria-labelledby="proposal-heading" aria-busy={busy}>
    <h3 id="proposal-heading" tabIndex={-1} ref={heading}>{review ? 'Vérifier la fiche proposée' : 'Préparer une fiche depuis le staging'}</h3>
    <p>PROPOSED · GM par défaut · sans publication. La Source existante sera réutilisée ; une Evidence et une Revision seront créées.</p>
    <p>Source : {data.source.label} · {data.source.kind} · {data.source.visibility}. La preuve conserve une visibilité au moins aussi restrictive que la Source et la fiche.</p>
    {data.warnings.map(warning => <p key={warning} className="ingestion-match-warning">{warning}</p>)}
    {failure && <div role="alert" tabIndex={-1} ref={alert}>{failure}</div>}
    {review ? <section className="ingestion-decision-confirmation" aria-label="Récapitulatif de création">
      <dl><dt>Fiche</dt><dd>{draft.title} · {draft.slug} · {draft.kind}{draft.kind === 'PLACE' && ` · ${draft.placeKind}`}</dd>
        <dt>Statut / visibilité</dt><dd>PROPOSED · {draft.visibility} · sans publication</dd>
        <dt>Résumé</dt><dd>{draft.summary || '—'}</dd><dt>Alias / tags</dt><dd>{draft.aliases.join(' · ') || '—'} / {draft.tags.join(' · ') || '—'}</dd>
        <dt>Evidence</dt><dd>{draft.claimText}</dd><dt>Repère</dt><dd>{draft.locator || '—'}</dd></dl>
      <details><summary>Lire le contenu éditorial</summary><pre>{draft.bodyMarkdown || '—'}</pre></details>
      <details><summary>Lire l’extrait de provenance</summary><pre>{draft.sourceExcerpt || '—'}</pre></details>
      <p>Seul le clic final crée la fiche et confirme son association. Une publication exigera ensuite une action éditoriale distincte.</p>
      <div className="ingestion-association-actions"><button type="button" disabled={busy} onClick={() => setReview(false)}>Corriger</button>
        <button type="button" disabled={busy || blocked} onClick={() => void submit()}>{busy ? 'Création…' : 'Créer la fiche proposée'}</button></div>
    </section> : <form onSubmit={proceed} noValidate>
      <fieldset disabled={busy || blocked} className="admin-editor-grid">
        <legend>Préparation humaine</legend>
        <label>Titre<input value={draft.title} {...field('entity.title')} onChange={event => {
          setDraft({ ...draft, title: event.target.value, slug: slugEdited.current ? draft.slug : suggestSlug(event.target.value) }); setIssues([]); if (!blocked) setFailure('')
        }} />{error('entity.title')}</label>
        <label>Slug<input value={draft.slug} maxLength={200} {...field('entity.slug')} onChange={event => { slugEdited.current = true; change('slug', event.target.value) }} />{error('entity.slug')}</label>
        <label>Type de fiche<select value={draft.kind} {...field('entity.kind')} onChange={event => change('kind', event.target.value as EntityKind)}>
          <option value="">Choisir un type…</option>{(Object.keys(kindLabels) as EntityKind[]).map(kind => <option value={kind} key={kind}>{kindLabels[kind]}</option>)}</select>{error('entity.kind')}</label>
        {draft.kind === 'PLACE' && <label>Sous-type de lieu<select value={draft.placeKind} {...field('entity.placeKind')} onChange={event => change('placeKind', event.target.value as PlaceKind)}>
          <option value="">Choisir…</option>{(Object.keys(placeLabels) as PlaceKind[]).map(kind => <option value={kind} key={kind}>{placeLabels[kind]}</option>)}</select>{error('entity.placeKind')}</label>}
        <label>Visibilité<select value={draft.visibility} onChange={event => change('visibility', event.target.value as Visibility)}>{(['GM', 'SECRET', 'PLAYERS', 'PUBLIC'] as Visibility[]).map(value => <option key={value}>{value}</option>)}</select></label>
        <label className="admin-editor-wide">Résumé<textarea rows={3} maxLength={500} value={draft.summary} {...field('entity.summary')} onChange={event => change('summary', event.target.value)} />{error('entity.summary')}</label>
        <div className="admin-editor-wide"><Terms label="Alias" values={draft.aliases} max={200} invalid={!!issue('entity.aliases')} errorId="proposal-error-entity.aliases" onChange={values => change('aliases', values)} />{error('entity.aliases')}
          <Terms label="Tag" values={draft.tags} max={100} invalid={!!issue('entity.tags')} errorId="proposal-error-entity.tags" onChange={values => change('tags', values)} />{error('entity.tags')}</div>
        <label className="admin-editor-wide">Contenu Markdown<textarea rows={12} value={draft.bodyMarkdown} {...field('entity.bodyMarkdown')} onChange={event => change('bodyMarkdown', event.target.value)} />{error('entity.bodyMarkdown')}</label>
        <label className="admin-editor-wide">Énoncé de provenance<textarea rows={3} maxLength={10_000} value={draft.claimText} {...field('evidence.claimText')} onChange={event => change('claimText', event.target.value)} />{error('evidence.claimText')}</label>
        <label className="admin-editor-wide">Extrait de la Source<textarea rows={4} maxLength={100_000} value={draft.sourceExcerpt} {...field('evidence.sourceExcerpt')} onChange={event => change('sourceExcerpt', event.target.value)} />{error('evidence.sourceExcerpt')}</label>
        <label>Repère<input maxLength={250} value={draft.locator} {...field('evidence.locator')} onChange={event => change('locator', event.target.value)} />{error('evidence.locator')}</label>
      </fieldset><button type="submit" disabled={busy || blocked}>Vérifier la création</button>
    </form>}
    <button type="button" disabled={busy} onClick={onCancel}>Retour vers l’item</button>
  </section>
}
