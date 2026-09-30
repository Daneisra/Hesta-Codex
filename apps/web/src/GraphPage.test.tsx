import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AdminGraphResponse, GraphResponse } from '@hesta-codex/shared'
import { GraphPage, visibleConnections } from './GraphPage'
import { emptyFilters, filterGraph, graphGroups, searchGraph } from './graph-model'

vi.mock('react-force-graph-2d', () => ({ default: ({ graphData, onNodeClick, onLinkClick,
  onNodeHover, onLinkHover, nodeLabel, linkLabel }: {
  graphData: { nodes: Array<{ id: string; title: string; slug: string }>; links: Array<{ id: string }> }
  onNodeClick: (node: { id: string; slug: string }, event: MouseEvent) => void
  onLinkClick: (edge: { id: string }) => void
  onNodeHover: (node: { id: string } | null) => void
  onLinkHover: (edge: { id: string } | null) => void
  nodeLabel: (node: { id: string; title: string }) => string
  linkLabel: (edge: { id: string }) => string
}) => <div data-testid="canvas-graph">{graphData.nodes.length} nœuds, {graphData.links.length} arêtes
  <span data-testid="tooltip-content">{nodeLabel(graphData.nodes[0]!)}{linkLabel(graphData.links[0]!)}</span>
  {graphData.nodes.map((node) => <button key={node.id} onMouseEnter={() => onNodeHover(node)}
    onMouseLeave={() => onNodeHover(null)} onClick={() => onNodeClick(node, new MouseEvent('pointerup'))}>{node.title}</button>)}
  {graphData.links.map((edge) => <button key={edge.id} onMouseEnter={() => onLinkHover(edge)}
    onMouseLeave={() => onLinkHover(null)} onClick={() => onLinkClick(edge)}>{edge.id}</button>)}
</div> }))

const fixture: GraphResponse = { nodes: [
  { id: 'a', slug: 'ville', title: 'Ville', kind: 'PLACE', placeKind: 'CITY', summary: 'Une ville côtière', aliases: ['Cité du port'] },
  { id: 'b', slug: 'continent', title: 'Continent', kind: 'PLACE', placeKind: 'CONTINENT', summary: null, aliases: [] },
  { id: 'c', slug: 'personnage', title: 'Personnage', kind: 'PERSON', placeKind: null, summary: null, aliases: ['Héros'] },
  { id: 'd', slug: 'organisation', title: 'Organisation', kind: 'ORGANIZATION', placeKind: null, summary: null, aliases: [] },
  { id: 'e', slug: 'isole', title: 'Isolé', kind: 'OTHER', placeKind: null, summary: null, aliases: [] },
], edges: [
  { id: 'located', source: 'a', target: 'b', type: 'located_in', label: 'situé dans', inverseLabel: 'contient', symmetric: false },
  { id: 'member', source: 'c', target: 'd', type: 'member_of', label: 'membre de', inverseLabel: 'compte parmi ses membres', symmetric: false },
  { id: 'ally', source: 'a', target: 'c', type: 'allied_with', label: 'allié à', inverseLabel: null, symmetric: true },
] }
const adminFixture: AdminGraphResponse = {
  nodes: fixture.nodes.map((node) => ({ ...node, status: node.id === 'a' ? 'PUBLISHED' : 'PROPOSED',
    visibility: node.id === 'a' ? 'PUBLIC' : 'GM' })),
  edges: fixture.edges.map((edge) => ({ ...edge, status: edge.id === 'located' ? 'PUBLISHED' : 'PROPOSED',
    visibility: edge.id === 'located' ? 'PUBLIC' : 'GM' })),
}

const response = (body: unknown, status = 200) => ({ ok: status === 200, status, json: async () => body })
const groups = new Set<string>(graphGroups.map((group) => group.id))

beforeEach(() => {
  window.history.replaceState(null, '', '/graphe')
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 600, height: 440 } as DOMRect)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/') })

describe('exploration du graphe', () => {
  it('shows loading and a clear empty state without a Canvas', async () => {
    let finish!: (value: unknown) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { finish = resolve })))
    render(<GraphPage endpoint="/api/v1/graph" onOpenNode={vi.fn()} />)
    expect(screen.getByText('Chargement du graphe…')).toBeTruthy()
    finish(response({ nodes: [], edges: [] }))
    expect(await screen.findByText('Le graphe attend ses premières fiches publiées.')).toBeTruthy()
    expect(screen.queryByTestId('canvas-graph')).toBeNull()
  })

  it('shows API failures, retries and explains an expired admin session', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({}, 500)).mockResolvedValueOnce(response(fixture))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<GraphPage endpoint="/api/v1/graph" onOpenNode={vi.fn()} />)
    expect(await screen.findByText('Impossible de charger le graphe.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByText('5 fiches · 3 relations affichées', { exact: false })).toBeTruthy()
    cleanup()
    vi.stubGlobal('fetch', vi.fn(async () => response({}, 401)))
    render(<GraphPage endpoint="/api/admin/graph" admin onOpenNode={vi.fn()} />)
    expect(await screen.findByText(/Session expirée/)).toBeTruthy()
  })

  it('searches title, slug and aliases locally, selects a result and updates the URL', async () => {
    const fetchMock = vi.fn(async () => response(fixture))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<GraphPage endpoint="/api/v1/graph" onOpenNode={vi.fn()} />)
    await screen.findByText('5 fiches · 3 relations affichées', { exact: false })
    const search = screen.getByRole('searchbox', { name: 'Rechercher une fiche' })
    await user.type(search, 'CITÉ DU PORT')
    expect(screen.getByRole('button', { name: /Ville \/ville/ })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /Ville \/ville/ }))
    expect(window.location.search).toBe('?fiche=ville')
    expect(screen.getByText('Une ville côtière')).toBeTruthy()
    await user.type(search, 'continent')
    expect(screen.getByRole('button', { name: /Continent \/continent/ })).toBeTruthy()
    await user.clear(search)
    await user.type(search, 'inconnu')
    expect(screen.getByText('Aucune fiche trouvée.')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('applies combined node/edge filters, removes orphan edges and resets', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(fixture)))
    const user = userEvent.setup()
    render(<GraphPage endpoint="/api/v1/graph" onOpenNode={vi.fn()} />)
    await screen.findByText('5 fiches · 3 relations affichées', { exact: false })
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type de fiche' }), 'PLACE')
    expect(screen.getByText('2 nœuds, 1 arêtes')).toBeTruthy()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type de relation' }), 'allied_with')
    expect(screen.getByText('2 nœuds, 0 arêtes')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Réinitialiser les filtres' }))
    expect(screen.getByText('5 nœuds, 3 arêtes')).toBeTruthy()
  })

  it('searches within combined filters and clears a selection hidden by a filter', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(fixture)))
    const user = userEvent.setup()
    render(<GraphPage endpoint="/api/v1/graph" onOpenNode={vi.fn()} />)
    await screen.findByText('5 nœuds, 3 arêtes')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Choisir une fiche' }), 'c')
    expect(window.location.search).toBe('?fiche=personnage')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type de fiche' }), 'PLACE')
    await waitFor(() => expect(window.location.search).toBe(''))
    expect((screen.getByRole('combobox', { name: 'Choisir une fiche' }) as HTMLSelectElement).value).toBe('')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sous-type de lieu' }), 'CITY')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type de relation' }), 'allied_with')
    const search = screen.getByRole('searchbox', { name: 'Rechercher une fiche' })
    await user.type(search, 'continent')
    expect(screen.getByText('Aucune fiche trouvée.')).toBeTruthy()
    await user.clear(search)
    await user.type(search, 'CITE')
    expect(screen.getByRole('button', { name: /Ville \/ville/ })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /Ville \/ville/ }))
    expect((screen.getByRole('combobox', { name: 'Type de fiche' }) as HTMLSelectElement).value).toBe('PLACE')
    expect(window.location.search).toBe('?fiche=ville')
  })

  it('clears a selected relation when a filter hides it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(fixture)))
    const user = userEvent.setup()
    render(<GraphPage endpoint="/api/v1/graph" onOpenNode={vi.fn()} />)
    await screen.findByText('5 nœuds, 3 arêtes')
    await user.click(screen.getByRole('button', { name: 'located' }))
    expect(screen.getByText('Relation sélectionnée')).toBeTruthy()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type de relation' }), 'allied_with')
    await waitFor(() => expect(screen.queryByText('Relation sélectionnée')).toBeNull())
    await user.click(screen.getByRole('button', { name: 'Réinitialiser les filtres' }))
    expect(screen.queryByText('Relation sélectionnée')).toBeNull()
  })

  it('toggles visual categories and keeps empty filtered state understandable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(fixture)))
    const user = userEvent.setup()
    render(<GraphPage endpoint="/api/v1/graph" onOpenNode={vi.fn()} />)
    await screen.findByText('5 nœuds, 3 arêtes')
    const places = screen.getByRole('button', { name: 'Lieux' })
    expect(places.getAttribute('aria-pressed')).toBe('true')
    await user.click(places)
    expect(places.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByText('3 nœuds, 1 arêtes')).toBeTruthy()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type de fiche' }), 'PLACE')
    expect(screen.getByText('Aucune fiche ne correspond aux filtres.')).toBeTruthy()
  })

  it('shows node details, inverse and symmetric relations, and opens a fiche', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(fixture)))
    const user = userEvent.setup()
    const open = vi.fn()
    render(<GraphPage endpoint="/api/v1/graph" onOpenNode={open} />)
    await screen.findByText('5 nœuds, 3 arêtes')
    expect(screen.getByTestId('tooltip-content').textContent).toBe('')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Choisir une fiche' }), 'b')
    expect(screen.getByRole('button', { name: /Continent → contient → Ville/ })).toBeTruthy()
    expect(screen.getByText(/1 entrante/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Recentrer sur cette fiche' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Ouvrir la fiche' }))
    expect(open).toHaveBeenCalledWith('continent')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Choisir une fiche' }), 'a')
    expect(screen.getByRole('button', { name: /Ville ↔ allié à ↔ Personnage/ })).toBeTruthy()
  })

  it('isolates direct neighbors and returns to the complete graph', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(fixture)))
    const user = userEvent.setup()
    render(<GraphPage endpoint="/api/v1/graph" onOpenNode={vi.fn()} />)
    await screen.findByText('5 nœuds, 3 arêtes')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Choisir une fiche' }), 'a')
    await user.click(screen.getByRole('button', { name: 'Connexions directes' }))
    expect(screen.getByText('3 nœuds, 2 arêtes')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Afficher tout le graphe' }).getAttribute('aria-pressed')).toBe('true')
    await user.click(screen.getByRole('button', { name: 'Vue complète' }))
    expect(screen.getByText('5 nœuds, 3 arêtes')).toBeTruthy()
    expect(window.location.search).toBe('')
  })

  it('supports direct URL selection, unknown slugs and history navigation', async () => {
    window.history.replaceState(null, '', '/graphe?fiche=ville')
    vi.stubGlobal('fetch', vi.fn(async () => response(fixture)))
    const user = userEvent.setup()
    render(<GraphPage endpoint="/api/v1/graph" onOpenNode={vi.fn()} />)
    expect(await screen.findByText('Une ville côtière')).toBeTruthy()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Choisir une fiche' }), 'b')
    expect(window.location.search).toBe('?fiche=continent')
    window.history.replaceState(null, '', '/graphe?fiche=ville')
    window.dispatchEvent(new PopStateEvent('popstate'))
    await waitFor(() => expect((screen.getByRole('combobox', { name: 'Choisir une fiche' }) as HTMLSelectElement).value).toBe('a'))
    expect(screen.getByText('Une ville côtière')).toBeTruthy()
    cleanup()
    window.history.replaceState(null, '', '/graphe?fiche=secret-inconnu')
    render(<GraphPage endpoint="/api/v1/graph" onOpenNode={vi.fn()} />)
    expect(await screen.findByText('Sélectionnez un nœud avec la recherche, la liste ou le graphe.')).toBeTruthy()
  })

  it('never resolves a private URL slug absent from the public graph and decodes a permitted slug once', async () => {
    window.history.replaceState(null, '', '/graphe?fiche=personnage')
    const publicOnly: GraphResponse = { nodes: fixture.nodes.filter((node) => node.id === 'a'), edges: [] }
    const fetchMock = vi.fn(async () => response(publicOnly))
    vi.stubGlobal('fetch', fetchMock)
    render(<GraphPage endpoint="/api/v1/graph" onOpenNode={vi.fn()} />)
    expect(await screen.findByText('Sélectionnez un nœud avec la recherche, la liste ou le graphe.')).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'Personnage · personnage' })).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    cleanup()
    window.history.replaceState(null, '', '/graphe?fiche=%76ille')
    render(<GraphPage endpoint="/api/v1/graph" onOpenNode={vi.fn()} />)
    expect(await screen.findByText('Une ville côtière')).toBeTruthy()
  })

  it('clicks to select, double-clicks to open and shows the hovered relation label safely', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(fixture)))
    const user = userEvent.setup()
    const open = vi.fn()
    render(<GraphPage endpoint="/api/v1/graph" onOpenNode={open} />)
    await screen.findByText('5 nœuds, 3 arêtes')
    await user.click(screen.getByRole('button', { name: /^Ville$/ }))
    expect(window.location.search).toBe('?fiche=ville')
    await user.hover(screen.getByRole('button', { name: 'located' }))
    expect(document.querySelector('.graph-hover')?.textContent).toBe('Ville → situé dans → Continent')
    await user.click(screen.getByRole('button', { name: 'located' }))
    expect(screen.getByText('Relation sélectionnée')).toBeTruthy()
    await user.dblClick(screen.getByRole('button', { name: /^Continent$/ }))
    expect(open).toHaveBeenCalledWith('continent')
  })

  it('keeps a single isolated fiche usable without relations', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ nodes: [fixture.nodes[4]], edges: [] })))
    const user = userEvent.setup()
    render(<GraphPage endpoint="/api/v1/graph" onOpenNode={vi.fn()} />)
    await screen.findByText('1 nœuds, 0 arêtes')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Choisir une fiche' }), 'e')
    expect(screen.getByText('Aucune relation visible pour cette fiche.')).toBeTruthy()
  })

  it('uses the admin projection and combines status/visibility filters', async () => {
    window.history.replaceState(null, '', '/admin/graphe')
    const fetchMock = vi.fn(async (_input: string | URL | Request) => { void _input; return response(adminFixture) })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<GraphPage endpoint="/api/admin/graph" admin onOpenNode={vi.fn()} />)
    await screen.findByText('5 nœuds, 3 arêtes')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Statut de fiche' }), 'PROPOSED')
    expect(screen.getByText('4 nœuds, 1 arêtes')).toBeTruthy()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Visibilité de relation' }), 'PUBLIC')
    expect(screen.getByText('4 nœuds, 0 arêtes')).toBeTruthy()
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/admin/graph')
  })

  it('keeps symmetric edges singular and the inverse label human-readable', () => {
    expect(fixture.edges.filter((edge) => edge.symmetric)).toHaveLength(1)
    expect(visibleConnections(fixture, 'a').find((edge) => edge.id === 'ally')?.displayLabel).toBe('allié à')
    expect(visibleConnections(fixture, 'c').find((edge) => edge.id === 'ally')?.displayLabel).toBe('allié à')
    expect(visibleConnections(fixture, 'b')[0]?.displayLabel).toBe('contient')
    expect(searchGraph(fixture, 'CITE')).toHaveLength(1)
    const filtered = filterGraph(fixture, { ...emptyFilters, kind: 'PLACE' }, groups)
    expect(filtered.edges.map((edge) => edge.id)).toEqual(['located'])
  })
})
