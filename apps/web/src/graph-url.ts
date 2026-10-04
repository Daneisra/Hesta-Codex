import { emptyFilters, graphGroups, kindLabels, placeLabels, type GraphFilters, type NeighborhoodDepth } from './graph-model'

export type GraphUrlState = {
  slug: string
  query: string
  depth: NeighborhoodDepth
  isolated: boolean
  filters: GraphFilters
  groups: ReadonlySet<string>
}
const statuses = new Set(['DRAFT', 'PROPOSED', 'PUBLISHED', 'ARCHIVED'])
const visibilities = new Set(['PUBLIC', 'PLAYERS', 'GM', 'SECRET'])
const parameters = { kind: 'type', placeKind: 'lieu', relationType: 'relation', nodeStatus: 'statut',
  nodeVisibility: 'visibilite', edgeStatus: 'statut-relation', edgeVisibility: 'visibilite-relation' } as const
export const allGraphGroups = () => new Set<string>(graphGroups.map(({ id }) => id))
export const defaultGraphState = (): GraphUrlState => ({ slug: '', query: '', depth: 1, isolated: false,
  filters: { ...emptyFilters }, groups: allGraphGroups() })

function single(params: URLSearchParams, key: string): string {
  const values = params.getAll(key)
  return values.length === 1 ? values[0]! : ''
}
const boundedText = (text: string, max: number) => text.length <= max && ![...text].some(character =>
  character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ? text : ''

export function readGraphState(search: string, admin = false): GraphUrlState {
  const state = defaultGraphState()
  const params = new URLSearchParams(search)
  const slug = single(params, 'fiche')
  state.slug = slug.length <= 200 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : ''
  state.query = admin ? '' : boundedText(single(params, 'q'), 200).trim()
  const depth = single(params, 'profondeur')
  if (depth === '2' || depth === '3') state.depth = Number(depth) as NeighborhoodDepth
  state.isolated = !admin && single(params, 'isoler') === '1' && Boolean(state.slug)
  const kind = single(params, parameters.kind)
  if (Object.hasOwn(kindLabels, kind)) state.filters.kind = kind as GraphFilters['kind']
  const place = single(params, parameters.placeKind)
  if (Object.hasOwn(placeLabels, place)) state.filters.placeKind = place as GraphFilters['placeKind']
  const relation = single(params, parameters.relationType)
  state.filters.relationType = boundedText(relation, 100)
  if (admin) {
    for (const key of ['nodeStatus', 'edgeStatus'] as const) {
      const value = single(params, parameters[key])
      if (statuses.has(value)) state.filters[key] = value
    }
    for (const key of ['nodeVisibility', 'edgeVisibility'] as const) {
      const value = single(params, parameters[key])
      if (visibilities.has(value)) state.filters[key] = value
    }
  }
  const disabled = single(params, 'sans').split(',')
  if (disabled.every(id => state.groups.has(id)) && new Set(disabled).size === disabled.length) {
    state.groups = new Set([...state.groups].filter(id => !disabled.includes(id)))
  }
  return state
}

// A syntactically valid but unknown relation type falls back to all relations.
export function resolveGraphState(state: GraphUrlState, relationTypes: ReadonlySet<string>): GraphUrlState {
  if (!state.filters.relationType || relationTypes.has(state.filters.relationType)) return state
  return { ...state, filters: { ...state.filters, relationType: '' } }
}

export function graphStateUrl(current: URL, state: GraphUrlState, admin = false): URL {
  const url = new URL(current.href)
  // Only a known exploration schema is serializable; unknown input (including tokens) is never shared.
  url.search = ''
  url.hash = ''
  const params = url.searchParams
  if (!admin && state.slug) params.set('fiche', state.slug)
  if (state.depth !== 1) params.set('profondeur', String(state.depth))
  if (!admin && state.slug && state.isolated) params.set('isoler', '1')
  if (!admin && state.query.trim()) params.set('q', state.query.trim())
  for (const [key, parameter] of Object.entries(parameters) as [keyof GraphFilters, string][]) {
    if (!admin && ['nodeStatus', 'nodeVisibility', 'edgeStatus', 'edgeVisibility'].includes(key)) continue
    if (state.filters[key]) params.set(parameter, state.filters[key])
  }
  const disabled = graphGroups.filter(({ id }) => !state.groups.has(id)).map(({ id }) => id)
  if (disabled.length) params.set('sans', disabled.join(','))
  return url
}
