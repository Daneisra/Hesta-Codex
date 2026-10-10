import { useMemo, useState } from 'react'
import type { EntityKind } from '@hesta-codex/shared'
import { graphGroups, kindLabels, normalizeSearch, placeLabels, searchMatchParts, type GraphData, type GraphFilters } from './graph-model'

const statuses = ['DRAFT', 'PROPOSED', 'PUBLISHED', 'ARCHIVED']
const visibilities = ['PUBLIC', 'PLAYERS', 'GM', 'SECRET']

function SearchMatch({ text, query }: { text: string; query: string }) {
  return <>{searchMatchParts(text, query).map((part, i) => part.matched
    ? <mark key={i}>{part.text}</mark> : part.text)}</>
}

export function GraphFiltersPanel({ data, admin, filters, activeGroups, query, results, onQueryChange,
  onSelectResult, onFiltersChange, onToggleGroup, onReset, onSearchBlur }: {
  data: GraphData
  admin: boolean
  filters: GraphFilters
  activeGroups: ReadonlySet<string>
  query: string
  results: GraphData['nodes']
  onQueryChange: (value: string) => void
  onSearchBlur: () => void
  onSelectResult: (id: string) => void
  onFiltersChange: (next: GraphFilters) => void
  onToggleGroup: (id: string) => void
  onReset: () => void
}) {
  const [open, setOpen] = useState(() => typeof window === 'undefined' || !window.matchMedia?.('(max-width: 560px)').matches)
  const types = useMemo(() => [...new Map(data.edges.map((edge) => [edge.type, edge.label])).entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'fr')), [data.edges])
  const needle = normalizeSearch(query)
  const update = (key: keyof GraphFilters, value: string) => onFiltersChange({ ...filters, [key]: value })

  return <section className="graph-filters" aria-label="Recherche et filtres du graphe">
    <div className="graph-search"><label htmlFor="graph-search">Rechercher une fiche</label>
      <input id="graph-search" type="search" value={query} maxLength={200} onBlur={onSearchBlur} onChange={(event) => onQueryChange(event.target.value)}
        placeholder="Titre, slug ou alias" autoComplete="off" />
      {query.trim() && <div className="graph-search-results">
        {results.length === 0 ? <p role="status">Aucune fiche trouvée.</p> : <>
          <p role="status">{results.length} résultat{results.length > 1 ? 's' : ''}</p>
          <ul>{results.slice(0, 12).map((node) => {
            const alias = node.aliases.find((value) => normalizeSearch(value).includes(needle))
            return <li key={node.id}>
              <button type="button" onClick={() => onSelectResult(node.id)}>
                <SearchMatch text={node.title} query={query} />{' '}<small>/<SearchMatch text={node.slug} query={query} /></small>
                {alias && <> <small className="graph-result-alias">Alias : <SearchMatch text={alias} query={query} /></small></>}
              </button>
            </li>
          })}</ul>
          {results.length > 12 && <p>12 premiers résultats affichés. Précisez la recherche.</p>}
        </>}
      </div>}
    </div>
    <button type="button" className="graph-filter-toggle" aria-expanded={open} aria-controls="graph-filter-options"
      onClick={() => setOpen((value) => !value)}>{open ? 'Masquer les filtres' : 'Afficher les filtres'}</button>
    <div id="graph-filter-options" hidden={!open}>
    <fieldset className="graph-filter-fields"><legend>Filtres</legend>
      <label>Type de fiche<select value={filters.kind} onChange={(event) => update('kind', event.target.value)}>
        <option value="">Tous</option>
        {(Object.entries(kindLabels) as [EntityKind, string][]).map(([kind, label]) =>
          <option key={kind} value={kind}>{label}</option>)}
      </select></label>
      <label>Sous-type de lieu<select value={filters.placeKind} onChange={(event) => update('placeKind', event.target.value)}>
        <option value="">Tous</option>
        {Object.entries(placeLabels).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
      </select></label>
      <label>{admin ? 'Type de connexion' : 'Type de relation'}<select value={filters.relationType} onChange={(event) => update('relationType', event.target.value)}>
        <option value="">Tous</option>
        {types.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
      </select></label>
      {admin && <>
        <label>Statut de fiche<select value={filters.nodeStatus} onChange={(event) => update('nodeStatus', event.target.value)}>
          <option value="">Tous</option>
          {statuses.map((value) => <option key={value} value={value}>{value}</option>)}
        </select></label>
        <label>Visibilité de fiche<select value={filters.nodeVisibility} onChange={(event) => update('nodeVisibility', event.target.value)}>
          <option value="">Toutes</option>
          {visibilities.map((value) => <option key={value} value={value}>{value}</option>)}
        </select></label>
        <label>Statut de relation<select value={filters.edgeStatus} onChange={(event) => update('edgeStatus', event.target.value)}>
          <option value="">Tous</option>
          {statuses.map((value) => <option key={value} value={value}>{value}</option>)}
        </select></label>
        <label>Visibilité de relation<select value={filters.edgeVisibility} onChange={(event) => update('edgeVisibility', event.target.value)}>
          <option value="">Toutes</option>
          {visibilities.map((value) => <option key={value} value={value}>{value}</option>)}
        </select></label>
      </>}
    </fieldset>
    {admin && data.edges.some(edge => edge.origin === 'OBSIDIAN') && <p className="graph-reference-legend">
      <span className="graph-edge-swatch" /> Relations éditoriales
      {' · '}<span className="graph-edge-swatch graph-edge-swatch--reference" /> Références Obsidian
      <small>Les filtres de statut et de visibilité de relation concernent les relations éditoriales et masquent les références textuelles.</small>
    </p>}
    <div className="graph-filter-bottom">
      <div className="graph-legend"><h2>Catégories</h2><div className="graph-legend-buttons">
        {graphGroups.map((group) => <button type="button" key={group.id}
          aria-pressed={activeGroups.has(group.id)} onClick={() => onToggleGroup(group.id)}>
          <span className="graph-swatch" style={{ backgroundColor: group.color }} />{group.label}
        </button>)}
      </div></div>
      <button type="button" className="graph-reset" onClick={onReset}>Réinitialiser les filtres</button>
    </div>
    </div>
  </section>
}
