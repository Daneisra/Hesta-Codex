import { useEffect, useState } from 'react'
import type { AdminSource, AdminSourceListResponse } from '@hesta-codex/shared'

export function AdminSourcePicker({ selected, onSelect, error }: {
  selected: AdminSource | null
  onSelect: (source: AdminSource) => void
  error?: string
}) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [sources, setSources] = useState<AdminSourceListResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    if (search.trim().length === 1) {
      setLoading(false)
      setFailure(null)
      setSources(null)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    setFailure(null)
    setSources(null)
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ page: String(page) })
      if (search.trim().length >= 2) params.set('q', search.trim())
      fetch(`/api/admin/sources?${params}`, { signal: controller.signal, credentials: 'same-origin', cache: 'no-store' })
        .then(async (response) => {
          if (!response.ok) throw new Error(response.status === 401 ? 'Session expirée.' : 'Recherche de sources indisponible.')
          return response.json() as Promise<AdminSourceListResponse>
        })
        .then((data) => { if (!controller.signal.aborted) setSources(data) })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted) setFailure(reason instanceof Error ? reason.message : 'Recherche indisponible.')
        })
        .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, search ? 320 : 0)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [search, page])

  return <div className="admin-source-picker">
    <label>Rechercher une Source<input type="search" value={search} maxLength={100}
      onChange={(event) => { setSearch(event.target.value); setPage(1) }} /></label>
    {search.trim().length === 1 && <p className="admin-muted">Deux caractères minimum pour rechercher.</p>}
    {loading && <p role="status">Recherche des Sources…</p>}
    {failure && <p role="alert" className="admin-field-error">{failure}</p>}
    {sources && !loading && !failure && <><p className="admin-muted">{sources.total} Source(s) trouvée(s), 20 par page.</p>
      {sources.items.length === 0 && <p>Aucune Source trouvée. Vous pouvez en créer une nouvelle.</p>}
      <div className="admin-source-options">{sources.items.map((source) => <label key={source.id}>
        <input type="radio" name="existing-source" checked={selected?.id === source.id} onChange={() => onSelect(source)} />
        <span><strong>{source.label}</strong><small>{source.kind} · ID externe : {source.externalId ?? '—'}
          {source.authorLabel ? ` · Auteur : ${source.authorLabel}` : ''}</small></span>
      </label>)}</div><div className="admin-pagination"><button type="button" disabled={page <= 1}
        onClick={() => setPage(page - 1)}>Précédent</button><span>Page {page}</span>
        <button type="button" disabled={page * sources.pageSize >= sources.total}
          onClick={() => setPage(page + 1)}>Suivant</button></div></>}
    <span id="source.sourceId" tabIndex={-1}>{error && <span id="source.sourceId-error" className="admin-field-error">{error}</span>}</span>
    {selected && <p className="admin-muted">Source choisie : {selected.label} · {selected.kind}</p>}
  </div>
}
