import { useEffect, useState } from 'react'
import type { IngestionAssociationEntity, IngestionAssociationSearch } from '@hesta-codex/shared'
import { errorStatus, HttpError } from './admin-http'
import { kindLabels, placeLabels } from './graph-model'

type SearchLoad = { key: string; phase: 'loading' } | { key: string; phase: 'error' } |
  { key: string; phase: 'ready'; data: IngestionAssociationSearch }
export function IngestionEntityPicker({ onChoose, onAccessError }: {
  onChoose: (entity: IngestionAssociationEntity) => void; onAccessError: (status: number) => void
}) {
  const [search, setSearch] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [load, setLoad] = useState<SearchLoad>({ key: '', phase: 'loading' })
  const query = search.trim()
  const valid = query.length >= 2 && !query.includes('\0') && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(query)
  const key = JSON.stringify([query, refresh])
  useEffect(() => {
    if (!valid) { setLoad({ key: '', phase: 'loading' }); return }
    const controller = new AbortController()
    setLoad({ key, phase: 'loading' })
    const timer = setTimeout(() => {
      fetch('/api/admin/ingestion/entities/search', { method: 'POST', signal: controller.signal,
        credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ q: query }) })
        .then(async response => { if (!response.ok) throw new HttpError(response.status); return response.json() as Promise<IngestionAssociationSearch> })
        .then(data => { if (!controller.signal.aborted) setLoad({ key, phase: 'ready', data }) })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          const status = errorStatus(error)
          setLoad({ key, phase: 'error' })
          if (status === 401 || status === 403) onAccessError(status)
        })
    }, 320)
    return () => { clearTimeout(timer); controller.abort() }
  }, [query, key, valid, refresh, onAccessError])
  const current = load.key === key ? load : { key, phase: 'loading' as const }
  return <section className="ingestion-picker" aria-label="Choix manuel d’une fiche">
    <label>Rechercher une fiche du Codex<input type="search" value={search} maxLength={100}
      placeholder="Titre, slug ou alias" onChange={event => setSearch(event.target.value)} /></label>
    {!valid && <p>Saisissez au moins deux caractères valides.</p>}
    {valid && current.phase === 'loading' && <p role="status">Recherche des fiches…</p>}
    {valid && current.phase === 'error' && <div role="alert"><p>Recherche de fiches indisponible.</p>
      <button type="button" onClick={() => setRefresh(value => value + 1)}>Réessayer la recherche de fiches</button></div>}
    {valid && current.phase === 'ready' && <>
      {!current.data.items.length && <p role="status">Aucune fiche admissible trouvée.</p>}
      {current.data.truncated && <p>Les {current.data.limit} premiers résultats sont affichés. Précisez la recherche.</p>}
      <ul className="ingestion-match-list">{current.data.items.filter(entity => entity.status !== 'ARCHIVED').map(entity => <li key={entity.id}>
        <h4>{entity.title}</h4><p>{kindLabels[entity.kind]}{entity.placeKind ? ` · ${placeLabels[entity.placeKind]}` : ''} · {entity.slug}</p>
        <button type="button" onClick={() => onChoose(entity)} aria-label={`Choisir la fiche : ${entity.title}`}>Choisir cette fiche</button>
      </li>)}</ul>
    </>}
  </section>
}
