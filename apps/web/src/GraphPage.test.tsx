import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { GraphResponse } from '@hesta-codex/shared'
import { GraphPage, visibleConnections } from './GraphPage'

vi.mock('react-force-graph-2d', () => ({ default: ({ graphData, onNodeClick, nodeLabel, linkLabel }: {
  graphData: { nodes: Array<{ id: string; title: string }>; links: Array<{ id: string }> }
  onNodeClick: (node: { id: string }) => void
  nodeLabel: (node: { id: string; title: string }) => string
  linkLabel: (edge: { id: string }) => string
}) => <div data-testid="canvas-graph">{graphData.nodes.length} nœuds, {graphData.links.length} arêtes
  <span data-testid="tooltip-content">{nodeLabel(graphData.nodes[0]!)}{linkLabel(graphData.links[0]!)}</span>
  {graphData.nodes.map((node) => <button key={node.id} onClick={() => onNodeClick(node)}>{node.title}</button>)}</div> }))

const fixture: GraphResponse = { nodes: [
  { id: 'a', slug: 'ville', title: 'Ville', kind: 'PLACE', placeKind: 'CITY' },
  { id: 'b', slug: 'continent', title: 'Continent', kind: 'PLACE', placeKind: 'CONTINENT' },
  { id: 'c', slug: 'personnage', title: 'Personnage', kind: 'PERSON', placeKind: null },
  { id: 'd', slug: 'organisation', title: 'Organisation', kind: 'ORGANIZATION', placeKind: null },
  { id: 'e', slug: 'isole', title: 'Isolé', kind: 'OTHER', placeKind: null },
], edges: [
  { id: 'located', source: 'a', target: 'b', type: 'located_in', label: 'situé dans', inverseLabel: 'contient', symmetric: false },
  { id: 'ally', source: 'c', target: 'd', type: 'allied_with', label: 'allié à', inverseLabel: null, symmetric: true },
] }

const response = (body: unknown, status = 200) => ({ ok: status === 200, status, json: async () => body })
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 600, height: 440 } as DOMRect)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('graphe public', () => {
  it('shows loading then a clear empty state', async () => {
    let finish!: (value: unknown) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { finish = resolve })))
    render(<GraphPage endpoint="/api/v1/graph" onOpenNode={vi.fn()} />)
    expect(screen.getByText('Chargement du graphe…')).toBeTruthy()
    finish(response({ nodes: [], edges: [] }))
    expect(await screen.findByText('Le graphe attend ses premières fiches publiées.')).toBeTruthy()
    expect(screen.queryByTestId('canvas-graph')).toBeNull()
  })

  it('shows API errors and retries', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({}, 500)).mockResolvedValueOnce(response(fixture))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<GraphPage endpoint="/api/v1/graph" onOpenNode={vi.fn()} />)
    expect(await screen.findByText('Impossible de charger le graphe.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByText('5 nœuds, 2 arêtes')).toBeTruthy()
  })

  it('selects a node, shows visible connections and opens the fiche', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(fixture)))
    const user = userEvent.setup()
    const open = vi.fn()
    render(<GraphPage endpoint="/api/v1/graph" onOpenNode={open} />)
    await screen.findByText('5 nœuds, 2 arêtes')
    expect(screen.getByTestId('tooltip-content').textContent).toBe('')
    await user.selectOptions(screen.getByLabelText('Choisir une fiche'), 'b')
    expect(screen.getByText('1 connexion visible')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'contient Ville' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Ouvrir la fiche' }))
    expect(open).toHaveBeenCalledWith('continent')
    await user.selectOptions(screen.getByLabelText('Choisir une fiche'), 'e')
    expect(screen.getByText('0 connexion visible')).toBeTruthy()
  })

  it('keeps one symmetric edge and the same label from either endpoint', () => {
    expect(fixture.edges.filter((edge) => edge.symmetric)).toHaveLength(1)
    expect(visibleConnections(fixture, 'c')[0]?.displayLabel).toBe('allié à')
    expect(visibleConnections(fixture, 'd')[0]?.displayLabel).toBe('allié à')
    expect(visibleConnections(fixture, 'b')[0]?.displayLabel).toBe('contient')
  })

  it('does not filter private records in the frontend and requests only the supplied endpoint', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      void input
      return response({ nodes: [{ ...fixture.nodes[0], status: 'PROPOSED', visibility: 'GM' }], edges: [] })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<GraphPage endpoint="/api/admin/graph" admin onOpenNode={vi.fn()} />)
    expect(await screen.findByText('1 nœuds, 0 arêtes')).toBeTruthy()
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/admin/graph')
  })
})
