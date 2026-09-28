import { useEffect, useState, type FormEvent, type MouseEvent } from 'react'
import type {
  AdminEntityDetail, AdminEvidence, AdminEvidencePatch, AdminRelation, AdminRelationPatch,
  AdminSource, AdminSourcePatch, EditorialStatus, SourceKind, Visibility,
} from '@hesta-codex/shared'

type Target = { kind: 'relation' | 'source' | 'evidence'; id: string }
type Mutation = (path: string, method: 'PATCH' | 'POST', body: unknown) => Promise<boolean>
const visibilities: Visibility[] = ['PUBLIC', 'PLAYERS', 'GM', 'SECRET']
const sourceKinds: SourceKind[] = ['MANUAL', 'OBSIDIAN', 'DISCORD', 'HESTA_MAP', 'YOUTUBE', 'AI_DERIVED', 'OTHER']
const statusLabel: Record<EditorialStatus, string> = {
  DRAFT: 'Brouillon', PROPOSED: 'Proposée', PUBLISHED: 'Publiée', ARCHIVED: 'Archivée',
}
const visibilityLabel: Record<Visibility, string> = {
  PUBLIC: 'Public', PLAYERS: 'Joueurs', GM: 'MJ', SECRET: 'Secret',
}

function safeUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch { return null }
}
function timeLabel(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60
  return [hours, minutes, remainder].map((part) => String(part).padStart(2, '0')).join(':')
}
function VisibilityField({ value, change }: { value: Visibility; change: (value: Visibility) => void }) {
  return <label>Visibilité<select value={value} onChange={(event) => change(event.target.value as Visibility)}>
    {visibilities.map((visibility) => <option key={visibility} value={visibility}>{visibilityLabel[visibility]}</option>)}
  </select></label>
}

function RelationEditor({ relation, onSave, onCancel, onDirty, busy, disabled }: {
  relation: AdminRelation; onSave: (body: AdminRelationPatch) => Promise<boolean>
  onCancel: () => void; onDirty: (dirty: boolean) => void; busy: boolean; disabled: boolean
}) {
  const [description, setDescription] = useState(relation.description ?? '')
  const [visibility, setVisibility] = useState(relation.visibility)
  useEffect(() => { onDirty(description.trim() !== (relation.description ?? '') || visibility !== relation.visibility) },
    [description, visibility, relation, onDirty])
  async function submit(event: FormEvent) {
    event.preventDefault()
    await onSave({ description: description.trim() || null, visibility, expectedUpdatedAt: relation.updatedAt })
  }
  return <form className="admin-editor-grid admin-provenance-editor" onSubmit={(event) => void submit(event)}>
    <label className="admin-editor-wide">Description<textarea value={description} maxLength={10_000}
      onChange={(event) => setDescription(event.target.value)} rows={4} /></label>
    <VisibilityField value={visibility} change={setVisibility} />
    <div className="admin-editor-actions admin-editor-wide"><button type="button" onClick={onCancel}>Annuler</button>
      <button className="admin-primary-button" type="submit" disabled={busy || disabled}>Enregistrer</button></div>
  </form>
}

function SourceEditor({ source, onSave, onCancel, onDirty, busy, disabled }: {
  source: AdminSource; onSave: (body: AdminSourcePatch) => Promise<boolean>
  onCancel: () => void; onDirty: (dirty: boolean) => void; busy: boolean; disabled: boolean
}) {
  const initial = {
    kind: source.kind, label: source.label, externalId: source.externalId ?? '', url: source.url ?? '',
    authorLabel: source.authorLabel ?? '', publishedAt: source.publishedAt ?? '', visibility: source.visibility,
  }
  const [draft, setDraft] = useState(initial)
  const change = <K extends keyof typeof draft>(key: K, value: typeof draft[K]) => setDraft((old) => ({ ...old, [key]: value }))
  useEffect(() => { onDirty(JSON.stringify(draft) !== JSON.stringify(initial)) }, [draft, source, onDirty])
  async function submit(event: FormEvent) {
    event.preventDefault()
    await onSave({ kind: draft.kind, label: draft.label, externalId: draft.externalId || null,
      url: draft.url || null, authorLabel: draft.authorLabel || null,
      publishedAt: draft.publishedAt || null, visibility: draft.visibility, expectedUpdatedAt: source.updatedAt })
  }
  return <form className="admin-editor-grid admin-provenance-editor" onSubmit={(event) => void submit(event)}>
    <label>Type<select value={draft.kind} onChange={(event) => change('kind', event.target.value as SourceKind)}>
      {sourceKinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></label>
    <label>Label<input required maxLength={250} value={draft.label} onChange={(event) => change('label', event.target.value)} /></label>
    <label>ID externe<input maxLength={250} value={draft.externalId} onChange={(event) => change('externalId', event.target.value)} /></label>
    <label>URL HTTP(S)<input type="url" value={draft.url} onChange={(event) => change('url', event.target.value)} /></label>
    <label>Auteur<input maxLength={200} value={draft.authorLabel} onChange={(event) => change('authorLabel', event.target.value)} /></label>
    <label>Date de publication (ISO 8601)<input value={draft.publishedAt} placeholder="2026-09-28T12:00:00.000Z"
      onChange={(event) => change('publishedAt', event.target.value)} /></label>
    <VisibilityField value={draft.visibility} change={(value) => change('visibility', value)} />
    <div className="admin-editor-actions admin-editor-wide"><button type="button" onClick={onCancel}>Annuler</button>
      <button className="admin-primary-button" type="submit" disabled={busy || disabled}>Enregistrer</button></div>
  </form>
}

function EvidenceEditor({ evidence, onSave, onCancel, onDirty, busy, disabled }: {
  evidence: AdminEvidence; onSave: (body: AdminEvidencePatch) => Promise<boolean>
  onCancel: () => void; onDirty: (dirty: boolean) => void; busy: boolean; disabled: boolean
}) {
  const initial = {
    claimText: evidence.claimText, sourceExcerpt: evidence.sourceExcerpt ?? '', locator: evidence.locator ?? '',
    timeStartSeconds: evidence.timeStartSeconds?.toString() ?? '', timeEndSeconds: evidence.timeEndSeconds?.toString() ?? '',
    confidence: evidence.confidence ?? '', visibility: evidence.visibility,
  }
  const [draft, setDraft] = useState(initial)
  const change = <K extends keyof typeof draft>(key: K, value: typeof draft[K]) => setDraft((old) => ({ ...old, [key]: value }))
  useEffect(() => { onDirty(JSON.stringify(draft) !== JSON.stringify(initial)) }, [draft, evidence, onDirty])
  async function submit(event: FormEvent) {
    event.preventDefault()
    await onSave({ claimText: draft.claimText, sourceExcerpt: draft.sourceExcerpt || null,
      locator: draft.locator || null, timeStartSeconds: draft.timeStartSeconds ? Number(draft.timeStartSeconds) : null,
      timeEndSeconds: draft.timeEndSeconds ? Number(draft.timeEndSeconds) : null,
      confidence: draft.confidence ? Number(draft.confidence) : null, visibility: draft.visibility,
      expectedUpdatedAt: evidence.updatedAt })
  }
  return <form className="admin-editor-grid admin-provenance-editor" onSubmit={(event) => void submit(event)}>
    <label className="admin-editor-wide">Énoncé<textarea required maxLength={10_000} rows={3} value={draft.claimText}
      onChange={(event) => change('claimText', event.target.value)} /></label>
    <label className="admin-editor-wide">Extrait source<textarea maxLength={100_000} rows={3} value={draft.sourceExcerpt}
      onChange={(event) => change('sourceExcerpt', event.target.value)} /></label>
    <label>Repère<input maxLength={250} value={draft.locator} onChange={(event) => change('locator', event.target.value)} /></label>
    <label>Début (secondes)<input type="number" min="0" step="1" value={draft.timeStartSeconds}
      onChange={(event) => change('timeStartSeconds', event.target.value)} /></label>
    <label>Fin (secondes)<input type="number" min="0" step="1" value={draft.timeEndSeconds}
      onChange={(event) => change('timeEndSeconds', event.target.value)} /></label>
    <label>Confiance (0 à 1)<input type="number" min="0" max="1" step="0.001" value={draft.confidence}
      onChange={(event) => change('confidence', event.target.value)} /></label>
    <VisibilityField value={draft.visibility} change={(value) => change('visibility', value)} />
    <div className="admin-editor-actions admin-editor-wide"><button type="button" onClick={onCancel}>Annuler</button>
      <button className="admin-primary-button" type="submit" disabled={busy || disabled}>Enregistrer</button></div>
  </form>
}

export function AdminProvenance({ entity, onNavigate, onMutate, onDirtyChange, onEditingChange, busy, disabled }: {
  entity: AdminEntityDetail
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, path: string) => void
  onMutate: Mutation; onDirtyChange: (dirty: boolean) => void; onEditingChange: (editing: boolean) => void
  busy: boolean; disabled: boolean
}) {
  const [active, setActive] = useState<Target | null>(null)
  const [dirty, setDirty] = useState(false)
  const start = (target: Target) => {
    if (dirty && !window.confirm('Perdre les modifications non enregistrées ?')) return
    setDirty(false); onDirtyChange(false); setActive(target); onEditingChange(true)
  }
  const cancel = () => {
    if (dirty && !window.confirm('Annuler et perdre les modifications non enregistrées ?')) return
    setDirty(false); onDirtyChange(false); setActive(null); onEditingChange(false)
  }
  const changeDirty = (value: boolean) => { setDirty(value); onDirtyChange(value) }
  const allEvidence = [...entity.evidence, ...entity.outgoingRelations.flatMap((relation) => relation.evidence),
    ...entity.incomingRelations.flatMap((relation) => relation.evidence)]
  const sources = [...new Map(allEvidence.map((item) => [item.source.id, item.source])).values()]
  const save = async (path: string, body: unknown) => {
    const ok = await onMutate(path, 'PATCH', body)
    if (ok) { setActive(null); setDirty(false); onDirtyChange(false); onEditingChange(false) }
    return ok
  }
  const evidenceList = (evidence: AdminEvidence[]) => evidence.length === 0
    ? <p className="admin-muted">Aucune preuve liée.</p>
    : <ul className="admin-evidence-list">{evidence.map((item) => <li key={item.id}>
      <p className="admin-claim">{item.claimText}</p>
      <p className="admin-muted">Source : {item.source.label} · {item.source.kind}
        {item.source.authorLabel && <> · Auteur : {item.source.authorLabel}</>}
        {item.source.externalId && <> · ID externe : {item.source.externalId}</>}</p>
      {item.source.url && safeUrl(item.source.url) && <a href={safeUrl(item.source.url)!} target="_blank" rel="noopener noreferrer">Ouvrir la source ↗</a>}
      {item.sourceExcerpt && <blockquote>{item.sourceExcerpt}</blockquote>}
      {(item.locator || item.timeStartSeconds !== null || item.timeEndSeconds !== null) && <p className="admin-muted">
        {item.locator && <>Repère : {item.locator}</>}
        {item.timeStartSeconds !== null && <> · Début : {item.timeStartSeconds} s ({timeLabel(item.timeStartSeconds)})</>}
        {item.timeEndSeconds !== null && <> · Fin : {item.timeEndSeconds} s ({timeLabel(item.timeEndSeconds)})</>}
      </p>}
      {item.confidence !== null && <p className="admin-muted">Confiance : {item.confidence}</p>}
      <p className="admin-muted">Visibilité : {visibilityLabel[item.visibility]} · Mise à jour : {new Date(item.updatedAt).toLocaleString('fr-FR')}</p>
      {active?.kind === 'evidence' && active.id === item.id
        ? <EvidenceEditor evidence={item} onSave={(body) => save(`/api/admin/evidence/${item.id}`, body)}
          onCancel={cancel} onDirty={changeDirty} busy={busy} disabled={disabled} />
        : <button type="button" disabled={disabled || busy} onClick={() => start({ kind: 'evidence', id: item.id })}>Modifier la preuve</button>}
    </li>)}</ul>
  const relationSection = (title: string, relations: AdminRelation[], direction: 'outgoing' | 'incoming') =>
    <section className="admin-section"><h3>{title} <span className="admin-count">{relations.length}</span></h3>
      {relations.length === 0 ? <p className="admin-muted">Aucune relation.</p> : <ul className="admin-relation-list">{relations.map((relation) => {
        const visible = relation.status === 'PUBLISHED' && relation.visibility === 'PUBLIC' &&
          entity.status === 'PUBLISHED' && entity.visibility === 'PUBLIC' &&
          relation.entity.status === 'PUBLISHED' && relation.entity.visibility === 'PUBLIC'
        return <li key={relation.id}>
          <div className="admin-relation-line"><span>{direction === 'incoming' && !relation.relationType.symmetric
            ? relation.relationType.inverseLabel ?? relation.relationType.inverseCode ?? relation.relationType.label
            : relation.relationType.label}</span>
            <a href={`/admin/fiches/${relation.entity.slug}`} onClick={(event) => onNavigate(event, `/admin/fiches/${relation.entity.slug}`)}>{relation.entity.title}</a>
            <span className="admin-badge">{statusLabel[relation.status]} · {visibilityLabel[relation.visibility]}</span></div>
          <p className="admin-muted">Type : {relation.relationType.code} · Mise à jour : {new Date(relation.updatedAt).toLocaleString('fr-FR')}</p>
          {relation.description && <p>{relation.description}</p>}
          <p className="admin-muted">{visible ? 'Cette relation est visible publiquement.' :
            relation.status === 'PUBLISHED' && relation.visibility === 'PUBLIC'
              ? 'Cette relation est publiée mais reste invisible publiquement car l’une de ses fiches n’est pas publique.'
              : 'Cette relation reste invisible dans la bibliothèque publique.'}</p>
          {active?.kind === 'relation' && active.id === relation.id
            ? <RelationEditor relation={relation} onSave={(body) => save(`/api/admin/relations/${relation.id}`, body)}
              onCancel={cancel} onDirty={changeDirty} busy={busy} disabled={disabled} />
            : relation.status !== 'ARCHIVED' && <button type="button" disabled={disabled || busy}
              onClick={() => start({ kind: 'relation', id: relation.id })}>Modifier la relation</button>}
          {relation.status === 'PROPOSED' && relation.evidence.length === 0 &&
            <p className="admin-muted">Une preuve liée directement à cette relation est requise pour la publier.</p>}
          {(relation.status === 'PROPOSED' || relation.status === 'PUBLISHED') && <div className="admin-publication">
            <button type="button" disabled={busy || disabled || dirty || active !== null ||
              (relation.status === 'PROPOSED' && relation.evidence.length === 0)} onClick={() => {
              const action = relation.status === 'PROPOSED' ? 'publish' : 'unpublish'
              const message = action === 'publish'
                ? `Publier la relation ${relation.relationType.code} ? Elle ne sera visible publiquement que si les deux fiches sont publiées et publiques.`
                : 'Retirer cette relation de la publication ? Elle disparaîtra immédiatement de la bibliothèque publique.'
              if (window.confirm(message)) void onMutate(`/api/admin/relations/${relation.id}/${action}`,
                'POST', { expectedUpdatedAt: relation.updatedAt })
            }}>{relation.status === 'PROPOSED' ? 'Publier la relation' : 'Retirer de la publication'}</button></div>}
          <h4>Preuves de la relation</h4>{evidenceList(relation.evidence)}
        </li>
      })}</ul>}</section>
  return <>
    <section className="admin-section"><h2>Provenance</h2>
      <h3>Sources liées</h3>{sources.length === 0 ? <p className="admin-muted">Aucune source liée.</p>
        : sources.map((source) => <div className="admin-source-card" key={source.id}>
          <p><strong>Source :</strong> {source.label} · {source.kind}</p>
          <p className="admin-muted">ID externe : {source.externalId ?? '—'} · Auteur : {source.authorLabel ?? '—'}
            · Publication : {source.publishedAt ?? '—'} · Visibilité : {visibilityLabel[source.visibility]}</p>
          {source.url && safeUrl(source.url) && <a href={safeUrl(source.url)!} target="_blank" rel="noopener noreferrer">Ouvrir la source ↗</a>}
          {active?.kind === 'source' && active.id === source.id
            ? <SourceEditor source={source} onSave={(body) => save(`/api/admin/sources/${source.id}`, body)}
              onCancel={cancel} onDirty={changeDirty} busy={busy} disabled={disabled} />
            : <button type="button" disabled={disabled || busy} onClick={() => start({ kind: 'source', id: source.id })}>Modifier la source</button>}
        </div>)}
      <h3>Preuves de la fiche</h3>{evidenceList(entity.evidence)}</section>
    <div className="admin-relations">{relationSection('Relations sortantes', entity.outgoingRelations, 'outgoing')}
      {relationSection('Relations entrantes', entity.incomingRelations, 'incoming')}</div>
  </>
}
