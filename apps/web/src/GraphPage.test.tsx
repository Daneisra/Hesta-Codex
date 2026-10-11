import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useImperativeHandle, type Ref } from 'react'
import type { AdminGraphResponse, GraphResponse } from '@hesta-codex/shared'
import { GraphPage, visibleConnections } from './GraphPage'
import { emptyFilters, filterGraph, graphGroups, searchGraph } from './graph-model'

const interactionMock = vi.hoisted(() => ({ renderCount: 0, methods: {
  centerAt: vi.fn(), zoom: vi.fn(() => 1.7), zoomToFit: vi.fn(),
} }))

vi.mock('react-force-graph-2d', () => ({ default: ({ ref, graphData, onNodeClick, onLinkClick,
  onNodeHover, onLinkHover, nodeLabel, linkLabel }: {
  ref?: Ref<typeof interactionMock.methods>
  graphData: { nodes: Array<{ id: string; title: string; slug: string; x?: number; y?: number }>; links: Array<{ id: string }> }
  onNodeClick: (node: { id: string; slug: string }, event: MouseEvent) => void
  onLinkClick: (edge: { id: string }) => void
  onNodeHover: (node: { id: string } | null) => void
  onLinkHover: (edge: { id: string } | null) => void
  nodeLabel: (node: { id: string; title: string }) => string
  linkLabel: (edge: { id: string }) => string
}) => {
  interactionMock.renderCount++
  useImperativeHandle(ref, () => interactionMock.methods)
  graphData.nodes.forEach((node, i) => { node.x ??= 10 + i * 10; node.y ??= 20 + i * 10 })
  return <div data-testid="canvas-graph">{graphData.nodes.length} nœuds, {graphData.links.length} arêtes
  <span data-testid="tooltip-content">{nodeLabel(graphData.nodes[0]!)}{linkLabel(graphData.links[0]!)}</span>
  {graphData.nodes.map((node) => <button key={node.id} onMouseEnter={() => onNodeHover(node)}
    onMouseLeave={() => onNodeHover(null)} onClick={() => onNodeClick(node, new MouseEvent('pointerup'))}>{node.title}</button>)}
  {graphData.links.map((edge) => <button key={edge.id} onMouseEnter={() => onLinkHover(edge)}
    onMouseLeave={() => onLinkHover(null)} onClick={() => onLinkClick(edge)}>{edge.id}</button>)}
</div> } }))

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
async function openAdvanced(user: ReturnType<typeof userEvent.setup>) {
  const toggle = screen.queryByRole('button', { name: 'Afficher les filtres' })
  if (toggle) await user.click(toggle)
}

beforeEach(() => {
  localStorage.clear()
  interactionMock.renderCount = 0
  interactionMock.methods.centerAt.mockClear()
  window.history.replaceState(null, '', '/graphe')
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 600, height: 440 } as DOMRect)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); window.history.replaceState(null, '', '/') })

describe('exploration du graphe', () => {
  it('keeps a hidden details panel closed when selecting in Canvas, preserving the double-click target', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(fixture)))
    const user = userEvent.setup(), open = vi.fn()
    render(<GraphPage endpoint="/api/v1/graph" onOpenNode={open} />)
    await screen.findByText('5 nœuds, 3 arêtes')
    await user.click(screen.getByRole('button', { name: 'Détails' }))
    await user.dblClick(screen.getByRole('button', { name: /^Ville$/ }))
    expect(document.getElementById('graph-details-panel')?.hidden).toBe(true)
    expect(open).toHaveBeenCalledWith('ville')
  })

  it('offers an immersive fallback, foldable panels, Escape and focus restoration without changing data', async () => {
    const fetchMock = vi.fn(async () => response(fixture))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<GraphPage endpoint="/api/v1/graph" onOpenNode={vi.fn()} />)
    await screen.findByText('5 nœuds, 3 arêtes')
    expect(screen.queryByRole('combobox', { name: 'Type de fiche' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Plein écran' }))
    expect(await screen.findByRole('dialog', { name: 'Graphe public' })).toBeTruthy()
    expect(document.getElementById('graph-filters-panel')?.hidden).toBe(true)
    expect(document.getElementById('graph-details-panel')?.hidden).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Filtres' }))
    await openAdvanced(user)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type de fiche' }), 'PLACE')
    expect(screen.getByText('2 nœuds, 1 arêtes')).toBeTruthy()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.getElementById('graph-details-panel')?.hidden).toBe(false)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Plein écran' })))
    expect(window.location.search).toBe('?type=PLACE')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('requests real browser fullscreen and handles the native Escape/fullscreenchange exit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(fixture)))
    const user = userEvent.setup()
    render(<GraphPage endpoint="/api/v1/graph" onOpenNode={vi.fn()} />)
    await screen.findByText('5 nœuds, 3 arêtes')
    const page = document.querySelector('.graph-page') as HTMLElement
    const original = Object.getOwnPropertyDescriptor(document, 'fullscreenElement')
    let nativeElement: Element | null = null
    const request = vi.fn(async () => { nativeElement = page; document.dispatchEvent(new Event('fullscreenchange')) })
    Object.defineProperty(page, 'requestFullscreen', { configurable: true, value: request })
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => nativeElement })
    try {
      await user.click(screen.getByRole('button', { name: 'Détails' }))
      act(() => { nativeElement = document.body; document.dispatchEvent(new Event('fullscreenchange')) })
      act(() => { nativeElement = null; document.dispatchEvent(new Event('fullscreenchange')) })
      expect(document.getElementById('graph-details-panel')?.hidden).toBe(true)
      await user.click(screen.getByRole('button', { name: 'Plein écran' }))
      expect(request).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('button', { name: 'Quitter le plein écran' })).toBeTruthy()
      act(() => { nativeElement = null; document.dispatchEvent(new Event('fullscreenchange')) })
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(document.body.style.overflow).not.toBe('hidden')
    } finally {
      if (original) Object.defineProperty(document, 'fullscreenElement', original)
      else Reflect.deleteProperty(document, 'fullscreenElement')
    }
  })

  it('keeps a rejected fullscreen request escapable and restores page scrolling on unmount', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(fixture)))
    const user = userEvent.setup(), before = document.body.style.overflow
    render(<GraphPage endpoint="/api/v1/graph" onOpenNode={vi.fn()} />)
    await screen.findByText('5 nœuds, 3 arêtes')
    Object.defineProperty(document.querySelector('.graph-page'), 'requestFullscreen', { value: vi.fn(async () => { throw new Error('denied') }) })
    await user.click(screen.getByRole('button', { name: 'Plein écran' }))
    expect(await screen.findByText(/plein écran du navigateur est indisponible/)).toBeTruthy()
    cleanup()
    expect(document.body.style.overflow).toBe(before)
  })

  it('temporarily hides global orphans, retains an orphan selection and restores all nodes on reset', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(fixture)))
    const user = userEvent.setup()
    render(<GraphPage endpoint="/api/v1/graph" onOpenNode={vi.fn()} />)
    await screen.findByText('5 nœuds, 3 arêtes')
    await user.click(screen.getByRole('checkbox', { name: /Masquer les fiches sans connexion/ }))
    expect(screen.getByText('4 nœuds, 3 arêtes')).toBeTruthy()
    await user.click(screen.getByRole('checkbox', { name: /Masquer les fiches sans connexion/ }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Choisir une fiche' }), 'e')
    await user.click(screen.getByRole('checkbox', { name: /Masquer les fiches sans connexion/ }))
    expect(screen.getByText('5 nœuds, 3 arêtes')).toBeTruthy()
    await openAdvanced(user)
    await user.click(screen.getByRole('button', { name: 'Réinitialiser les filtres' }))
    expect((screen.getByRole('checkbox', { name: /Masquer les fiches sans connexion/ }) as HTMLInputElement).checked).toBe(false)
    expect(fixture.nodes).toHaveLength(5)
  })

  it('shows distinct Obsidian arcs, diagnostics counters and preserves relation-only status filters', async () => {
    const referenceGraph: AdminGraphResponse = { ...adminFixture, edges: [...adminFixture.edges, {
      id: 'obsidian:a:b', source: 'a', target: 'b', type: 'OBSIDIAN_REFERENCE', origin: 'OBSIDIAN',
      label: 'Référence Obsidian', inverseLabel: 'Mentionné par', symmetric: false, occurrences: 3,
    }], obsidianStats: { occurrences: 6, resolved: 2, ambiguous: 1, missing: 1, unassociated: 1, unsupported: 0 } }
    window.history.replaceState(null, '', '/admin/graphe')
    vi.stubGlobal('fetch', vi.fn(async () => response(referenceGraph)))
    const user = userEvent.setup(), open = vi.fn()
    render(<GraphPage endpoint="/api/admin/graph" admin onOpenNode={open} />)
    await screen.findByText('5 nœuds, 4 arêtes')
    expect(screen.getByText(/6 occurrences · 2 références uniques résolues/)).toBeTruthy()
    expect(screen.getByText(/Les filtres de statut/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'obsidian:a:b' }))
    expect(screen.getByRole('heading', { name: 'Référence Obsidian sélectionnée' })).toBeTruthy()
    expect(screen.getByText(/Mention textuelle · 3 occurrences/)).toBeTruthy()
    await openAdvanced(user)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type de connexion' }), 'OBSIDIAN_REFERENCE')
    expect(screen.getByText('5 nœuds, 1 arêtes')).toBeTruthy()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Choisir une fiche' }), 'a')
    expect(screen.getByText(/1 référence Obsidian · 2 relations éditoriales/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Ouvrir la fiche' }))
    expect(open).toHaveBeenCalledWith('ville')
    await openAdvanced(user)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Statut de relation' }), 'PUBLISHED')
    expect(screen.getByText('5 nœuds, 0 arêtes')).toBeTruthy()
    expect(window.location.search).not.toContain('fiche=')
  })
  it('reloads a complete public URL and restores filters, categories, query, depth and isolation on popstate', async () => {
    const first = '/graphe?fiche=ville&profondeur=2&isoler=1&q=CITE&type=PLACE&lieu=CITY&relation=located_in&sans=ideas'
    window.history.replaceState(null, '', first)
    const fetchMock = vi.fn(async () => response(fixture))
    vi.stubGlobal('fetch', fetchMock)
    render(<GraphPage endpoint="/api/v1/graph" onOpenNode={vi.fn()} />)
    await screen.findByRole('heading', { name: 'Ville' })
    expect(await screen.findByText('1 nœuds, 0 arêtes')).toBeTruthy()
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('CITE')
    expect((screen.getByRole('combobox', { name: 'Profondeur du voisinage' }) as HTMLSelectElement).value).toBe('2')
    expect(screen.getByRole('button', { name: 'Afficher tout le graphe' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Idées et autres' }).getAttribute('aria-pressed')).toBe('false')
    act(() => {
      window.history.pushState(null, '', '/graphe?fiche=personnage&profondeur=3&type=PERSON&q=HEROS')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(await screen.findByRole('heading', { name: 'Personnage' })).toBeTruthy()
    expect((screen.getByRole('combobox', { name: 'Type de fiche' }) as HTMLSelectElement).value).toBe('PERSON')
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('HEROS')
    expect(screen.getByRole('button', { name: 'Isoler le voisinage' }).getAttribute('aria-pressed')).toBe('false')
    act(() => {
      window.history.replaceState(null, '', first)
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(await screen.findByRole('heading', { name: 'Ville' })).toBeTruthy()
    expect(screen.getByText('1 nœuds, 0 arêtes')).toBeTruthy()
    expect((screen.getByRole('combobox', { name: 'Sous-type de lieu' }) as HTMLSelectElement).value).toBe('CITY')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('canonicalizes invalid URLs, unavailable selections and relation types without guessing private data', async () => {
    window.history.replaceState(null, '', '/graphe?fiche=personnage&type=PLACE&profondeur=9&isoler=1&relation=unknown_type&q=%00secret&token=secret')
    vi.stubGlobal('fetch', vi.fn(async () => response(fixture)))
    render(<GraphPage endpoint="/api/v1/graph" onOpenNode={vi.fn()} />)
    await screen.findByText('2 nœuds, 1 arêtes')
    await waitFor(() => expect(window.location.search).toBe('?type=PLACE'))
    expect((screen.getByRole('combobox', { name: 'Choisir une fiche' }) as HTMLSelectElement).value).toBe('')
    expect(screen.queryByRole('heading', { name: 'Personnage' })).toBeNull()
  })

  it('copies the synchronized complete URL with keyboard activation and discreet feedback', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(fixture)))
    const user = userEvent.setup()
    const clipboard = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    render(<GraphPage endpoint="/api/v1/graph" onOpenNode={vi.fn()} />)
    await screen.findByText('5 nœuds, 3 arêtes')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Choisir une fiche' }), 'a')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Profondeur du voisinage' }), '3')
    await user.click(screen.getByRole('button', { name: 'Isoler le voisinage' }))
    await openAdvanced(user)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type de relation' }), 'located_in')
    await user.type(screen.getByRole('searchbox'), 'CITE')
    const button = screen.getByRole('button', { name: 'Copier le lien' })
    button.focus(); await user.keyboard('{Enter}')
    expect(clipboard).toHaveBeenCalledWith(window.location.href)
    expect(new URL(clipboard.mock.calls[0]![0]).searchParams.get('q')).toBe('CITE')
    expect(new URL(clipboard.mock.calls[0]![0]).searchParams.get('isoler')).toBe('1')
    expect(screen.getByText('Lien copié.')).toBeTruthy()
    expect(document.activeElement).toBe(button)
  })

  it('provides a selectable safe URL when clipboard access is denied, including an empty filtered view', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(fixture)))
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
    render(<GraphPage endpoint="/api/v1/graph" onOpenNode={vi.fn()} />)
    await screen.findByText('5 nœuds, 3 arêtes')
    await openAdvanced(user)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type de fiche' }), 'DEITY')
    await user.click(screen.getByRole('button', { name: 'Copier le lien' }))
    const input = await screen.findByRole('textbox', { name: 'Lien du graphe' }) as HTMLInputElement
    expect(input.value).toBe(window.location.href)
    expect(document.activeElement).toBe(input)
    expect(input.selectionEnd).toBe(input.value.length)
    expect(screen.getByText('Aucune fiche ne correspond aux filtres.')).toBeTruthy()
  })

  it('groups a search typing session into one history entry and starts another after blur', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(fixture)))
    const user = userEvent.setup()
    render(<GraphPage endpoint="/api/v1/graph" onOpenNode={vi.fn()} />)
    await screen.findByText('5 nœuds, 3 arêtes')
    const push = vi.spyOn(window.history, 'pushState')
    const replace = vi.spyOn(window.history, 'replaceState')
    await user.type(screen.getByRole('searchbox'), 'CITE')
    expect(push).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledTimes(3)
    expect(window.location.search).toBe('?q=CITE')
    await user.tab()
    await user.type(screen.getByRole('searchbox'), ' PORT')
    expect(push).toHaveBeenCalledTimes(2)
    expect(window.location.search).toBe('?q=CITE+PORT')
  })

  it('ignores a delayed clipboard failure after the exploration changes without stealing focus', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(fixture)))
    const user = userEvent.setup()
    let rejectCopy!: (error: Error) => void
    vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(() => new Promise<void>((_resolve, reject) => { rejectCopy = reject }))
    render(<GraphPage endpoint="/api/v1/graph" onOpenNode={vi.fn()} />)
    await screen.findByText('5 nœuds, 3 arêtes')
    const copy = screen.getByRole('button', { name: 'Copier le lien' }) as HTMLButtonElement
    await user.click(copy)
    expect(copy.disabled).toBe(true)
    await openAdvanced(user)
    const filter = screen.getByRole('combobox', { name: 'Type de fiche' })
    await user.selectOptions(filter, 'PLACE')
    filter.focus()
    await act(async () => { rejectCopy(new Error('denied')); await Promise.resolve() })
    expect(copy.disabled).toBe(false)
    expect(screen.queryByRole('textbox', { name: 'Lien du graphe' })).toBeNull()
    expect(document.activeElement).toBe(filter)
    expect(window.location.search).toBe('?type=PLACE')
  })

  it('shares only admin filters/depth while keeping legacy selection and private search local', async () => {
    window.history.replaceState(null, '', '/admin/graphe?fiche=personnage&q=secret&profondeur=2&statut=PROPOSED&visibilite=GM')
    vi.stubGlobal('fetch', vi.fn(async () => response(adminFixture)))
    const user = userEvent.setup()
    const clipboard = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    render(<GraphPage endpoint="/api/admin/graph" admin onOpenNode={vi.fn()} />)
    await screen.findByRole('heading', { name: 'Personnage' })
    await user.type(screen.getByRole('searchbox'), 'Héros')
    await user.click(screen.getByRole('button', { name: 'Isoler le voisinage' }))
    await user.click(screen.getByRole('button', { name: 'Copier le lien' }))
    expect(window.location.search).toBe('?profondeur=2&statut=PROPOSED&visibilite=GM')
    expect(clipboard).toHaveBeenCalledWith(window.location.href)
    expect(window.history.state).toBeNull()
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('Héros')
    expect(screen.getByRole('button', { name: 'Afficher tout le graphe' })).toBeTruthy()
  })

  it('does not rerender the Canvas or change its data on unmatched searches or copy feedback', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(fixture)))
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    render(<GraphPage endpoint="/api/v1/graph" onOpenNode={vi.fn()} />)
    await screen.findByText('5 nœuds, 3 arêtes')
    const renders = interactionMock.renderCount
    await user.type(screen.getByRole('searchbox'), 'zzzzzz')
    await user.click(screen.getByRole('button', { name: 'Copier le lien' }))
    expect(screen.getByText('Aucune fiche trouvée.')).toBeTruthy()
    expect(interactionMock.renderCount).toBe(renders)
  })

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
    expect(interactionMock.methods.centerAt).toHaveBeenCalledWith(10, 20, 600)
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
    await openAdvanced(user)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type de fiche' }), 'PLACE')
    expect(screen.getByText('2 nœuds, 1 arêtes')).toBeTruthy()
    await openAdvanced(user)
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
    await openAdvanced(user)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type de fiche' }), 'PLACE')
    await waitFor(() => expect(window.location.search).toBe('?type=PLACE'))
    expect((screen.getByRole('combobox', { name: 'Choisir une fiche' }) as HTMLSelectElement).value).toBe('')
    await openAdvanced(user)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sous-type de lieu' }), 'CITY')
    await openAdvanced(user)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type de relation' }), 'allied_with')
    const search = screen.getByRole('searchbox', { name: 'Rechercher une fiche' })
    await user.type(search, 'continent')
    expect(screen.getByText('Aucune fiche trouvée.')).toBeTruthy()
    await user.clear(search)
    await user.type(search, 'CITE')
    expect(screen.getByRole('button', { name: /Ville \/ville/ })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /Ville \/ville/ }))
    expect((screen.getByRole('combobox', { name: 'Type de fiche' }) as HTMLSelectElement).value).toBe('PLACE')
    expect(window.location.search).toBe('?fiche=ville&type=PLACE&lieu=CITY&relation=allied_with')
  })

  it('clears a selected relation when a filter hides it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(fixture)))
    const user = userEvent.setup()
    render(<GraphPage endpoint="/api/v1/graph" onOpenNode={vi.fn()} />)
    await screen.findByText('5 nœuds, 3 arêtes')
    await user.click(screen.getByRole('button', { name: 'located' }))
    expect(screen.getByText('Relation sélectionnée')).toBeTruthy()
    await openAdvanced(user)
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
    await openAdvanced(user)
    const places = screen.getByRole('button', { name: 'Lieux' })
    expect(places.getAttribute('aria-pressed')).toBe('true')
    await user.click(places)
    expect(places.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByText('3 nœuds, 1 arêtes')).toBeTruthy()
    await openAdvanced(user)
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

  it('expands the filtered neighborhood through depths 1, 2 and 3 and immediately restores the full view', async () => {
    const deepFixture = { ...fixture, edges: [...fixture.edges, {
      id: 'de', source: 'd', target: 'e', type: 'member_of', label: 'membre de',
      inverseLabel: 'compte parmi ses membres', symmetric: false,
    }] }
    const fetchMock = vi.fn(async () => response(deepFixture))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<GraphPage endpoint="/api/v1/graph" onOpenNode={vi.fn()} />)
    await screen.findByText('5 nœuds, 4 arêtes')
    const depth = screen.getByRole('combobox', { name: 'Profondeur du voisinage' })
    expect((depth as HTMLSelectElement).disabled).toBe(true)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Choisir une fiche' }), 'a')
    await user.click(screen.getByRole('button', { name: 'Connexions directes' }))
    expect(screen.getByText('3 nœuds, 2 arêtes')).toBeTruthy()
    await user.selectOptions(depth, '2')
    expect(screen.getByText('4 nœuds, 3 arêtes')).toBeTruthy()
    await user.selectOptions(depth, '3')
    expect(screen.getByText('5 nœuds, 4 arêtes')).toBeTruthy()
    await openAdvanced(user)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type de relation' }), 'located_in')
    expect(screen.getByText('2 nœuds, 1 arêtes')).toBeTruthy()
    expect(screen.getByText('2 relations au total')).toBeTruthy()
    expect(screen.getByText(/1 affichée avec ces filtres/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Vue complète' }))
    expect(window.location.search).toBe('?profondeur=3&relation=located_in')
    expect(screen.getByText('5 nœuds, 1 arêtes')).toBeTruthy()
    expect((depth as HTMLSelectElement).disabled).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('highlights an accent-insensitive alias match and moves keyboard focus to the selected details', async () => {
    const fetchMock = vi.fn(async () => response(fixture))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    render(<GraphPage endpoint="/api/v1/graph" onOpenNode={vi.fn()} />)
    await screen.findByText('5 nœuds, 3 arêtes')
    await user.type(screen.getByRole('searchbox', { name: 'Rechercher une fiche' }), 'CITE')
    expect(document.querySelector('.graph-search-results mark')?.textContent).toBe('Cité')
    const result = screen.getByRole('button', { name: /Ville \/ville Alias/ })
    result.focus()
    await user.keyboard('{Enter}')
    expect(window.location.search).toBe('?fiche=ville')
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Ville' }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
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

  it('keeps keyboard focus visible when navigating from a connection to its neighbor', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(fixture)))
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    const user = userEvent.setup()
    render(<GraphPage endpoint="/api/v1/graph" onOpenNode={vi.fn()} />)
    await screen.findByText('5 nœuds, 3 arêtes')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Choisir une fiche' }), 'a')
    screen.getByRole('button', { name: /Ville → situé dans → Continent/ }).focus()
    await user.keyboard('{Enter}')
    expect(window.location.search).toBe('?fiche=continent')
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Continent' }))
    expect(focus.mock.calls.at(-1)?.[0]?.preventScroll).not.toBe(true)
  })

  it('renders HTML-looking lore as literal text in search, details and hover', async () => {
    const title = '<img src=x onerror="alert(1)">'
    const unsafeText: GraphResponse = { nodes: [{ ...fixture.nodes[0]!, title,
      summary: '<script>alert(1)</script>', aliases: ['<svg onload="alert(1)">'] }], edges: [] }
    vi.stubGlobal('fetch', vi.fn(async () => response(unsafeText)))
    const user = userEvent.setup()
    render(<GraphPage endpoint="/api/v1/graph" onOpenNode={vi.fn()} />)
    await screen.findByText('1 nœuds, 0 arêtes')
    await user.type(screen.getByRole('searchbox', { name: 'Rechercher une fiche' }), '<img')
    expect(document.querySelector('.graph-search-results mark')?.textContent).toBe('<img')
    await user.click(screen.getByRole('button', { name: `${title} /ville` }))
    expect(screen.getByRole('heading', { name: title })).toBeTruthy()
    expect(screen.getByText('<script>alert(1)</script>')).toBeTruthy()
    await user.hover(screen.getByRole('button', { name: title }))
    expect(document.querySelector('.graph-hover')?.textContent).toBe(title)
    expect(document.querySelector('.graph-page img, .graph-page script, .graph-page svg')).toBeNull()
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
    interactionMock.methods.centerAt.mockClear()
    await user.click(screen.getByRole('button', { name: /^Ville$/ }))
    expect(window.location.search).toBe('?fiche=ville')
    expect(interactionMock.methods.centerAt).not.toHaveBeenCalled()
    await user.hover(screen.getByRole('button', { name: 'located' }))
    expect(document.querySelector('.graph-hover')?.textContent).toBe('Ville → situé dans → Continent')
    expect(document.querySelector('.graph-hover')?.closest('[role="img"]')).toBeNull()
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
    await openAdvanced(user)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Statut de fiche' }), 'PROPOSED')
    expect(screen.getByText('4 nœuds, 1 arêtes')).toBeTruthy()
    await openAdvanced(user)
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
