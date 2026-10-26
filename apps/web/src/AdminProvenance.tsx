import { useEffect, useState, type FormEvent, type MouseEvent } from 'react'
import type {
  AdminEntityDetail, AdminEvidence, AdminEvidenceAddRequest, AdminEvidencePatch, AdminRelation,
  AdminSource, AdminSourcePatch, EditorialStatus, SourceKind, Visibility,
} from '@hesta-codex/shared'
import { AdminAddEvidence } from './AdminAddEvidence'
import { AdminEditRelation } from './AdminEditRelation'
import { errorStatus, getAdminJson } from './admin-http'

type Target = { kind: 'relation' | 'source' | 'evidence' | 'add-entity' | 'add-relation'; id: string }
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

export function AdminProvenance({ entity, onNavigate, onMutate, onDirtyChange, onEditingChange, busy, disabled, error, onAccessError }: {
  entity: AdminEntityDetail
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, path: string) => void
  onMutate: Mutation; onDirtyChange: (dirty: boolean) => void; onEditingChange: (editing: boolean) => void
  busy: boolean; disabled: boolean
  onAccessError?: (status: number) => void
  error: { status: number | null; message: string; issues?: Array<{ path: string; message: string }> } | null
}) {
  const [active, setActive] = useState<Target | null>(null)
  const [dirty, setDirty] = useState(false)
  const [expandedRelation, setExpandedRelation] = useState<string | null>(null)
  const [relationSearch, setRelationSearch] = useState({ incoming: '', outgoing: '' })
  const [relationStatus, setRelationStatus] = useState({ incoming: '', outgoing: '' })
  const [relationPage, setRelationPage] = useState({ incoming: 1, outgoing: 1 })
  const [loadedEvidence, setLoadedEvidence] = useState<{ entity: AdminEntityDetail; id: string; evidence: AdminEvidence[] } | null>(null)
  const [evidenceError, setEvidenceError] = useState(false), [evidenceRetry, setEvidenceRetry] = useState(0)
  useEffect(() => {
    const relation = [...entity.outgoingRelations, ...entity.incomingRelations].find(item => item.id === expandedRelation)
    if (!relation?.evidenceDeferred) return
    const controller = new AbortController()
    setEvidenceError(false); setLoadedEvidence(null)
    getAdminJson<{ evidence: AdminEvidence[] }>(`/api/admin/relations/${relation.id}/evidence`, controller.signal).then(result => {
      if (!controller.signal.aborted) setLoadedEvidence({ entity, id: relation.id, evidence: result.evidence })
    }).catch(error => {
      if (controller.signal.aborted) return
      setEvidenceError(true)
      const status = errorStatus(error)
      if (status === 401 || status === 403) onAccessError?.(status)
    })
    return () => controller.abort()
  }, [entity, expandedRelation, evidenceRetry, onAccessError])
  const start = (target: Target) => {
    if (dirty && !window.confirm('Perdre les modifications non enregistrées ?')) return
    setDirty(false); onDirtyChange(false); setActive(target); onEditingChange(true)
  }
  const cancel = () => {
    if (dirty && !window.confirm('Annuler et perdre les modifications non enregistrées ?')) return
    setDirty(false); onDirtyChange(false); setActive(null); onEditingChange(false)
  }
  const changeDirty = (value: boolean) => { setDirty(value); onDirtyChange(value) }
  const groups = (proofs: AdminEvidence[]) => [...new Map(proofs.map((proof) => [proof.source.id, proof.source])).values()]
    .map((source) => ({ source, proofs: proofs.filter((proof) => proof.source.id === source.id) }))
  const sources = groups(entity.evidence)
  const save = async (path: string, body: unknown) => {
    const ok = await onMutate(path, 'PATCH', body)
    if (ok) { setActive(null); setDirty(false); onDirtyChange(false); onEditingChange(false) }
    return ok
  }
  const addEvidence = async (path: string, body: AdminEvidenceAddRequest) => {
    const ok = await onMutate(path, 'POST', body)
    if (ok) {
      setActive(null); setDirty(false); onDirtyChange(false); onEditingChange(false)
    }
    return ok
  }
  const evidenceList = (evidence: AdminEvidence[], editable = true) => evidence.length === 0
    ? <p className="admin-muted">Aucune preuve liée.</p>
    : <ul className="admin-evidence-list">{evidence.map((item) => <li key={item.id}>
      <p className="admin-claim">{item.claimText}</p>
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
        : editable && <button type="button" disabled={disabled || busy}
          onClick={() => start({ kind: 'evidence', id: item.id })}>Modifier la preuve</button>}
    </li>)}</ul>
  const relationSection = (title: string, relations: AdminRelation[], direction: 'outgoing' | 'incoming') => {
    const query = relationSearch[direction].toLocaleLowerCase('fr')
    const filtered = relations.filter(relation => (!relationStatus[direction] || relation.status === relationStatus[direction]) &&
      [relation.entity.title, relation.entity.slug, relation.relationType.label, relation.relationType.inverseLabel ?? '', relation.relationType.code]
        .some(value => value.toLocaleLowerCase('fr').includes(query)))
    const pageSize = 10, page = Math.min(relationPage[direction], Math.max(1, Math.ceil(filtered.length / pageSize)))
    return <section className="admin-section"><h3>{title} <span className="admin-count">{relations.length}</span></h3>
      {relations.length > 10 && <div className="admin-filters"><label>Rechercher · {title}<input type="search" maxLength={100}
        disabled={active !== null || busy} value={relationSearch[direction]} onChange={event => {
          setRelationSearch(value => ({ ...value, [direction]: event.target.value })); setRelationPage(value => ({ ...value, [direction]: 1 }))
        }} /></label><label>Statut · {title}<select disabled={active !== null || busy} value={relationStatus[direction]} onChange={event => {
          setRelationStatus(value => ({ ...value, [direction]: event.target.value })); setRelationPage(value => ({ ...value, [direction]: 1 }))
        }}><option value="">Tous</option>{Object.entries(statusLabel).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>}
      {filtered.length === 0 ? <p className="admin-muted">Aucune relation.</p> : <ul className="admin-relation-list">{filtered.slice((page - 1) * pageSize, page * pageSize).map((original) => {
        const loaded = loadedEvidence?.entity === entity && loadedEvidence.id === original.id
        const relation = loaded ? { ...original, evidence: loadedEvidence.evidence } : original
        const ready = !original.evidenceDeferred || loaded
        const visible = relation.status === 'PUBLISHED' && relation.visibility === 'PUBLIC' &&
          entity.status === 'PUBLISHED' && entity.visibility === 'PUBLIC' &&
          relation.entity.status === 'PUBLISHED' && relation.entity.visibility === 'PUBLIC'
        const label = direction === 'incoming' && !relation.relationType.symmetric
          ? relation.relationType.inverseLabel ?? relation.relationType.inverseCode ?? relation.relationType.label
          : relation.relationType.label
        return <li key={relation.id}>
          <div className="admin-relation-line"><span>{label}</span>
            <a href={`/admin/fiches/${relation.entity.slug}`} onClick={(event) => onNavigate(event, `/admin/fiches/${relation.entity.slug}`)}>{relation.entity.title}</a>
            <span className="admin-badge">{statusLabel[relation.status]} · {visibilityLabel[relation.visibility]}</span>
          <span className="admin-muted">{loaded ? relation.evidence.length : relation.evidenceCount ?? relation.evidence.length} preuve(s)</span>{' '}
          {relation.status !== 'ARCHIVED' && entity.status !== 'ARCHIVED' && relation.entity.status !== 'ARCHIVED' &&
            <button type="button" disabled={disabled || busy || active !== null}
              onClick={() => { setExpandedRelation(relation.id); start({ kind: 'relation', id: relation.id }) }}>Modifier la relation</button>}
          <button type="button" aria-expanded={expandedRelation === relation.id} aria-controls={`relation-detail-${direction}-${relation.id}`}
            disabled={busy || active !== null} onClick={() => setExpandedRelation(value => value === relation.id ? null : relation.id)}>
            {expandedRelation === relation.id ? 'Masquer les détails' : 'Détails de la relation'}</button></div>
          {active?.kind === 'relation' && active.id === relation.id && <AdminEditRelation relation={relation}
            from={direction === 'outgoing' ? entity : relation.entity} to={direction === 'outgoing' ? relation.entity : entity}
            onSave={body => save(`/api/admin/relations/${relation.id}`, body)} onCancel={cancel} onDirty={changeDirty}
            busy={busy} disabled={disabled} onAccessError={onAccessError} />}
          {expandedRelation === relation.id && !ready && <div id={`relation-detail-${direction}-${relation.id}`}>
            {evidenceError ? <p role="alert">Preuves indisponibles. <button type="button" onClick={() => setEvidenceRetry(value => value + 1)}>Réessayer les preuves</button></p>
              : <p role="status">Chargement des preuves…</p>}</div>}
          {expandedRelation === relation.id && ready && <div id={`relation-detail-${direction}-${relation.id}`}>
          <p className="admin-muted">Type : {relation.relationType.code} · Mise à jour : {new Date(relation.updatedAt).toLocaleString('fr-FR')}</p>
          {relation.description && <p>{relation.description}</p>}
          <p className="admin-muted">{visible ? 'Cette relation est visible publiquement.' :
            relation.status === 'PUBLISHED' && relation.visibility === 'PUBLIC'
              ? 'Cette relation est publiée mais reste invisible publiquement car l’une de ses fiches n’est pas publique.'
              : 'Cette relation reste invisible dans la bibliothèque publique.'}</p>
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
          {relation.status !== 'ARCHIVED' && entity.status !== 'ARCHIVED' && relation.entity.status !== 'ARCHIVED' &&
            (active?.kind === 'add-relation' && active.id === relation.id
              ? <AdminAddEvidence targetLabel={`${entity.title} · ${label} · ${relation.entity.title}`}
                previous={relation.evidence} busy={busy} disabled={disabled} error={error}
                onSave={(body) => addEvidence(`/api/admin/relations/${relation.id}/evidence`, body)}
                onCancel={cancel} onDirty={changeDirty} />
              : <button type="button" disabled={busy || disabled || active !== null}
                onClick={() => start({ kind: 'add-relation', id: relation.id })}>Ajouter une preuve</button>)}
          <h4>Preuves de la relation · {groups(relation.evidence).length} source(s) · {relation.evidence.length} preuve(s)</h4>
          {groups(relation.evidence).map(({ source, proofs }) => <div className="admin-source-card" key={source.id}>
            <p><strong>{source.label}</strong> · {source.kind} · {proofs.length} preuve(s)</p>
            <p className="admin-muted">ID externe : {source.externalId ?? '—'} · Auteur : {source.authorLabel ?? '—'}
              · Publication : {source.publishedAt ?? '—'} · Visibilité : {visibilityLabel[source.visibility]}</p>
            {active?.kind === 'source' && active.id === `relation:${relation.id}:${source.id}`
              ? <SourceEditor source={source} onSave={(body) => save(`/api/admin/sources/${source.id}`, body)}
                onCancel={cancel} onDirty={changeDirty} busy={busy} disabled={disabled} />
              : <button type="button" disabled={disabled || busy || active !== null}
                onClick={() => start({ kind: 'source', id: `relation:${relation.id}:${source.id}` })}>Modifier la source</button>}
            {evidenceList(proofs, relation.status !== 'ARCHIVED' && entity.status !== 'ARCHIVED' &&
              relation.entity.status !== 'ARCHIVED')}
          </div>)}
          {relation.evidence.length === 0 && <p className="admin-muted">Aucune preuve liée.</p>}
          </div>}
        </li>
      })}</ul>}
      {filtered.length > pageSize && <div className="admin-pagination"><button type="button" disabled={active !== null || busy || page <= 1}
        onClick={() => { setExpandedRelation(null); setRelationPage(value => ({ ...value, [direction]: page - 1 })) }}>Précédent</button>
        <span>{filtered.length} résultat(s) · Page {page}</span><button type="button" disabled={active !== null || busy || page * pageSize >= filtered.length}
          onClick={() => { setExpandedRelation(null); setRelationPage(value => ({ ...value, [direction]: page + 1 })) }}>Suivant</button></div>}
    </section>
  }
  return <>
    <section className="admin-section"><h2>Provenance</h2>
      <p className="admin-muted">{sources.length} source(s) · {entity.evidence.length} preuve(s) directement sur la fiche. Les preuves des relations figurent sous chaque relation.</p>
      {entity.status !== 'ARCHIVED' && (active?.kind === 'add-entity'
        ? <AdminAddEvidence targetLabel={entity.title} previous={entity.evidence} busy={busy} disabled={disabled}
          error={error} onSave={(body) => addEvidence(`/api/admin/entities/${entity.slug}/evidence`, body)}
          onCancel={cancel} onDirty={changeDirty} />
        : <button type="button" disabled={disabled || busy || active !== null}
          onClick={() => start({ kind: 'add-entity', id: entity.id })}>Ajouter une preuve à la fiche</button>)}
      <h3>Sources de la fiche</h3>{sources.length === 0 ? <p className="admin-muted">Aucune source liée directement à la fiche.</p>
        : sources.map(({ source, proofs }) => <div className="admin-source-card" key={source.id}>
          <p><strong>Source :</strong> {source.label} · {source.kind} · {proofs.length} preuve(s)</p>
          <p className="admin-muted">ID externe : {source.externalId ?? '—'} · Auteur : {source.authorLabel ?? '—'}
            · Publication : {source.publishedAt ?? '—'} · Visibilité : {visibilityLabel[source.visibility]}</p>
          {source.url && safeUrl(source.url) && <a href={safeUrl(source.url)!} target="_blank" rel="noopener noreferrer">Ouvrir la source ↗</a>}
          {active?.kind === 'source' && active.id === `entity:${source.id}`
            ? <SourceEditor source={source} onSave={(body) => save(`/api/admin/sources/${source.id}`, body)}
              onCancel={cancel} onDirty={changeDirty} busy={busy} disabled={disabled} />
            : <button type="button" disabled={disabled || busy}
              onClick={() => start({ kind: 'source', id: `entity:${source.id}` })}>Modifier la source</button>}
          {entity.evidence.some((item) => item.source.id === source.id) && <>
            <h4>Preuves de la fiche</h4>{evidenceList(entity.evidence.filter((item) => item.source.id === source.id),
              entity.status !== 'ARCHIVED')}</>}
        </div>)}
      {entity.evidence.length === 0 && <p className="admin-muted">Aucune preuve directement liée à la fiche.</p>}</section>
    <div className="admin-relations">{relationSection('Relations sortantes', entity.outgoingRelations, 'outgoing')}
      {relationSection('Relations entrantes', entity.incomingRelations, 'incoming')}</div>
  </>
}
