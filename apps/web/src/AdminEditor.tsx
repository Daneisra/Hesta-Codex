import { useEffect, useState, type FormEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AdminEntityDetail, AdminEntityPatch, EntityKind, PlaceKind, Visibility } from '@hesta-codex/shared'

const kinds: EntityKind[] = [
  'PERSON', 'PLACE', 'ORGANIZATION', 'FAMILY', 'RELIGION', 'DEITY', 'SPECIES',
  'CREATURE', 'ARTIFACT', 'EVENT', 'QUEST', 'SESSION', 'CONCEPT', 'OTHER',
]
const places: PlaceKind[] = ['CITY', 'CONTINENT', 'REGION', 'SEA', 'OCEAN', 'OTHER']
const visibilities: Visibility[] = ['PUBLIC', 'PLAYERS', 'GM', 'SECRET']

interface FormState {
  title: string
  summary: string
  bodyMarkdown: string
  kind: EntityKind
  placeKind: PlaceKind | ''
  aliases: string
  tags: string
  visibility: Visibility
  revisionMessage: string
}

function initialForm(entity: AdminEntityDetail): FormState {
  return {
    title: entity.title, summary: entity.summary ?? '', bodyMarkdown: entity.bodyMarkdown,
    kind: entity.kind, placeKind: entity.placeKind ?? '', aliases: entity.aliases.join(', '),
    tags: entity.tags.join(', '), visibility: entity.visibility, revisionMessage: '',
  }
}

function terms(text: string): string[] {
  return text.trim() ? text.split(',').map((value) => value.trim()) : []
}

export function AdminEditor({ entity, busy, saveDisabled, error, onSave, onCancel, onDirtyChange }: {
  entity: AdminEntityDetail
  busy: boolean
  saveDisabled: boolean
  error: string | null
  onSave: (input: AdminEntityPatch) => void
  onCancel: () => void
  onDirtyChange: (dirty: boolean) => void
}) {
  const [form, setForm] = useState<FormState>(() => initialForm(entity))
  const [localError, setLocalError] = useState<string | null>(null)
  const dirty = JSON.stringify(form) !== JSON.stringify(initialForm(entity))
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
    setLocalError(null)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!form.title.trim()) { setLocalError('Le titre est requis.'); return }
    if (form.kind === 'PLACE' && !form.placeKind) { setLocalError('Choisissez un sous-type de lieu.'); return }
    onSave({
      title: form.title, summary: form.summary, bodyMarkdown: form.bodyMarkdown,
      kind: form.kind, placeKind: form.kind === 'PLACE' ? form.placeKind as PlaceKind : null,
      aliases: terms(form.aliases), tags: terms(form.tags), visibility: form.visibility,
      expectedUpdatedAt: entity.updatedAt, revisionMessage: form.revisionMessage.trim() || null,
    })
  }

  return <section className="admin-section admin-editor">
    <h2>Modifier la fiche</h2>
    <p className="admin-muted">Slug stable : <code>/{entity.slug}</code>. Les sources, preuves et relations restent en lecture seule.</p>
    {entity.status === 'PUBLISHED' && <p className="admin-warning" role="status">
      {entity.visibility === 'PUBLIC' && form.visibility === 'PUBLIC'
        ? 'Cette fiche est actuellement publique. L’enregistrement modifiera immédiatement sa version visible.'
        : entity.visibility !== 'PUBLIC' && form.visibility === 'PUBLIC'
          ? 'L’enregistrement rendra immédiatement cette fiche visible dans la bibliothèque publique.'
          : entity.visibility === 'PUBLIC'
            ? 'L’enregistrement retirera immédiatement cette fiche de la bibliothèque publique.'
            : 'Cette fiche restera publiée mais invisible dans la bibliothèque publique.'}
    </p>}
    <form onSubmit={submit} noValidate>
      <div className="admin-editor-grid">
        <label>Titre<input value={form.title} maxLength={200} required onChange={(event) => update('title', event.target.value)} /></label>
        <label>Type<select value={form.kind} onChange={(event) => {
          const kind = event.target.value as EntityKind
          setForm((current) => ({ ...current, kind, placeKind: kind === 'PLACE' ? current.placeKind : '' }))
        }}>{kinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></label>
        {form.kind === 'PLACE' && <label>Sous-type de lieu<select value={form.placeKind} required onChange={(event) => update('placeKind', event.target.value as PlaceKind)}>
          <option value="">Choisir…</option>{places.map((place) => <option key={place} value={place}>{place}</option>)}
        </select></label>}
        <label>Visibilité<select value={form.visibility} onChange={(event) => update('visibility', event.target.value as Visibility)}>
          {visibilities.map((visibility) => <option key={visibility} value={visibility}>{visibility}</option>)}
        </select></label>
        <label className="admin-editor-wide">Résumé<textarea value={form.summary} maxLength={500} rows={3}
          onChange={(event) => update('summary', event.target.value)} /></label>
        <label className="admin-editor-wide">Alias, séparés par des virgules<input value={form.aliases}
          onChange={(event) => update('aliases', event.target.value)} /></label>
        <label className="admin-editor-wide">Tags, séparés par des virgules<input value={form.tags}
          onChange={(event) => update('tags', event.target.value)} /></label>
        <p className="admin-muted admin-editor-wide">Alias et tags : 30 valeurs maximum, sans entrée vide ni doublon.</p>
        <label className="admin-editor-wide">Contenu Markdown<textarea value={form.bodyMarkdown} maxLength={100000} rows={16}
          onChange={(event) => update('bodyMarkdown', event.target.value)} /></label>
        <label className="admin-editor-wide">Message de révision (facultatif)<input value={form.revisionMessage} maxLength={500}
          onChange={(event) => update('revisionMessage', event.target.value)} /></label>
      </div>
      <div className="admin-editor-preview">
        <h3>Aperçu Markdown</h3>
        <div className="markdown-body admin-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
          {form.bodyMarkdown || 'Aucun contenu détaillé.'}
        </ReactMarkdown></div>
      </div>
      {(localError || error) && <p className="admin-form-error" role="alert">{localError ?? error}</p>}
      <div className="admin-editor-actions">
        <button type="button" disabled={busy} onClick={onCancel}>Annuler</button>
        <button className="admin-primary-button" type="submit" disabled={busy || saveDisabled}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
      </div>
    </form>
  </section>
}
