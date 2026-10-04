import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { EntityDetail, EntityListItem, EntityRelationItem } from '@hesta-codex/shared'
import { App } from './App'

// Routing tests do not need a physics engine or Canvas in JSDOM.
vi.mock('react-force-graph-2d', () => ({ default: () => null }))

const city: EntityListItem = {
  id: 'city-id', slug: 'nikaius', kind: 'PLACE', placeKind: 'CITY',
  title: 'Nikaius', summary: 'Une ville du continent.', tags: ['Empire'],
}

const continent: EntityListItem = {
  id: 'continent-id', slug: 'vruliven', kind: 'PLACE', placeKind: 'CONTINENT',
  title: 'Vruliven', summary: 'Un continent.', tags: [],
}

const locatedIn: EntityRelationItem = {
  id: 'relation-id', description: null,
  relationType: {
    id: 'relation-type-id', code: 'located_in', label: 'Se situe dans',
    inverseCode: 'contains', inverseLabel: 'Contient', symmetric: false,
  },
  entity: continent,
}

const cityDetail: EntityDetail = {
  ...city, aliases: ['La Cité bleue'], bodyMarkdown: '## Histoire\n\nUne **cité** ancienne.\n\n<script>alert(1)</script>\n\n[danger](javascript:alert(1))\n\n[Voir Vruliven](/fiches/vruliven)',
  status: 'PUBLISHED', visibility: 'PUBLIC',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
  publishedAt: '2026-02-01T00:00:00.000Z',
  outgoingRelations: [locatedIn], incomingRelations: [{ ...locatedIn, id: 'incoming-id', entity: continent }],
}

const continentDetail: EntityDetail = {
  ...cityDetail, ...continent, bodyMarkdown: '## Géographie', aliases: [],
  outgoingRelations: [], incomingRelations: [],
}

function response(data: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as Response
}

function mockApi(options: {
  list?: EntityListItem[]
  listStatus?: number
  detailStatus?: number
  healthStatus?: number
  detail?: EntityDetail
} = {}) {
  const requests: string[] = []
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    requests.push(url)
    if (url === '/api/v1/health') {
      return response({ status: 'ok', database: 'ok', service: 'hesta-codex-api', version: 'v1' }, options.healthStatus)
    }
    if (url === '/api/v1/graph') return response({ nodes: [], edges: [] })
    if (url.startsWith('/api/v1/entities?') || url === '/api/v1/entities') {
      return response(options.list ?? [], options.listStatus)
    }
    if (url === '/api/v1/entities/nikaius') {
      return response(options.detail ?? cityDetail, options.detailStatus)
    }
    if (url === '/api/v1/entities/vruliven') return response(continentDetail, options.detailStatus)
    return response({}, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { requests, fetchMock }
}

beforeEach(() => window.history.replaceState(null, '', '/'))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

describe('consultation publique', () => {
  it('navigue entre bibliothèque et graphe sans rechargement et ouvre directement /graphe', async () => {
    const user = userEvent.setup()
    const { requests } = mockApi()
    render(<App />)
    await user.click(screen.getByRole('link', { name: 'Graphe' }))
    expect(window.location.pathname).toBe('/graphe')
    expect(await screen.findByText('Le graphe attend ses premières fiches publiées.', undefined, { timeout: 8_000 })).toBeTruthy()
    expect(requests).toContain('/api/v1/graph')
    await user.click(screen.getByRole('link', { name: 'Bibliothèque' }))
    expect(window.location.pathname).toBe('/')
    cleanup()
    window.history.replaceState(null, '', '/graphe')
    render(<App />)
    expect(await screen.findByText('Le graphe attend ses premières fiches publiées.', undefined, { timeout: 8_000 })).toBeTruthy()
  }, 12_000)

  it('affiche un état vide réel sans inventer de fiches', async () => {
    mockApi()
    render(<App />)
    expect(await screen.findByText('La bibliothèque attend ses premières fiches')).toBeTruthy()
    expect(screen.getByText('0 fiche affichée')).toBeTruthy()
    expect(screen.getByText('API disponible')).toBeTruthy()
  })

  it('filtre par type et recherche après temporisation, sans envoyer q pour un seul caractère', async () => {
    const user = userEvent.setup()
    const { requests } = mockApi({ list: [city] })
    render(<App />)
    await screen.findByText('Nikaius')
    await user.type(screen.getByRole('searchbox', { name: 'Rechercher' }), 'n')
    await new Promise((resolve) => setTimeout(resolve, 380))
    expect(requests.some((url) => url.includes('q='))).toBe(false)
    await user.type(screen.getByRole('searchbox', { name: 'Rechercher' }), 'i')
    await waitFor(() => expect(requests.some((url) => url.includes('q=ni'))).toBe(true))
    await user.click(screen.getByRole('button', { name: 'Lieux' }))
    await waitFor(() => expect(requests.some((url) => url.includes('kind=PLACE') && url.includes('q=ni'))).toBe(true))
    expect(screen.getByRole('button', { name: 'Lieux' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('distingue une recherche sans résultat de la bibliothèque vide', async () => {
    const user = userEvent.setup()
    const { requests } = mockApi()
    render(<App />)
    await screen.findByText('La bibliothèque attend ses premières fiches')
    await user.type(screen.getByRole('searchbox', { name: 'Rechercher' }), 'absent')
    expect(await screen.findByText('Aucune fiche trouvée')).toBeTruthy()
    expect(requests.some((url) => url.includes('q=absent'))).toBe(true)
  })

  it('annule une réponse de filtre devenue obsolète', async () => {
    const user = userEvent.setup()
    let staleSignal: AbortSignal | undefined
    let resolveStale: ((value: Response) => void) | undefined
    vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/health') {
        return Promise.resolve(response({ status: 'ok', database: 'ok' }))
      }
      if (url.includes('kind=PERSON')) {
        staleSignal = init?.signal as AbortSignal
        return new Promise<Response>((resolve) => { resolveStale = resolve })
      }
      return Promise.resolve(response(url.includes('kind=PLACE') ? [city] : []))
    }))
    render(<App />)
    await screen.findByText('La bibliothèque attend ses premières fiches')
    await user.click(screen.getByRole('button', { name: 'Personnages' }))
    await waitFor(() => expect(staleSignal).toBeDefined())
    await user.click(screen.getByRole('button', { name: 'Lieux' }))
    expect(staleSignal?.aborted).toBe(true)
    resolveStale?.(response([continent]))
    expect(await screen.findByRole('link', { name: 'Ouvrir la fiche Nikaius' })).toBeTruthy()
    expect(screen.queryByText('Vruliven')).toBeNull()
  })

  it('ouvre une fiche partageable, rend le Markdown et donne accès au retour', async () => {
    const user = userEvent.setup()
    mockApi({ list: [city] })
    render(<App />)
    await user.click(await screen.findByRole('link', { name: 'Ouvrir la fiche Nikaius' }))
    expect(window.location.pathname).toBe('/fiches/nikaius')
    expect(await screen.findByRole('heading', { name: 'Nikaius', level: 1 })).toBeTruthy()
    expect(screen.getByText('Ville')).toBeTruthy()
    expect(screen.getByText(/La Cité bleue/)).toBeTruthy()
    expect(screen.getByText('Empire')).toBeTruthy()
    expect(screen.getByText(/1 septembre 2026/)).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Histoire' })).toBeTruthy()
    expect(screen.getByText('cité').tagName).toBe('STRONG')
    expect(document.querySelector('script')).toBeNull()
    expect(document.querySelector('a[href^="javascript:"]')).toBeNull()
    expect(screen.getByRole('link', { name: 'Voir les relations' }).getAttribute('href')).toBe('#relations')
    expect(screen.getByRole('complementary', { name: 'Relations de la fiche' }).id).toBe('relations')
    await user.click(screen.getByRole('link', { name: /Retour à la bibliothèque/ }))
    expect(window.location.pathname).toBe('/')
    expect(await screen.findByRole('heading', { name: 'Bibliothèque', level: 1 })).toBeTruthy()
  })

  it('restaure bibliothèque et fiche avec précédent et suivant', async () => {
    const user = userEvent.setup()
    mockApi({ list: [city] })
    render(<App />)
    await user.click(await screen.findByRole('link', { name: 'Ouvrir la fiche Nikaius' }))
    await screen.findByRole('heading', { name: 'Nikaius', level: 1 })
    window.history.back()
    await waitFor(() => expect(window.location.pathname).toBe('/'))
    expect(await screen.findByRole('link', { name: 'Ouvrir la fiche Nikaius' })).toBeTruthy()
    window.history.forward()
    await waitFor(() => expect(window.location.pathname).toBe('/fiches/nikaius'))
    expect(await screen.findByRole('heading', { name: 'Nikaius', level: 1 })).toBeTruthy()
  })

  it('garde les liens clavier et place le focus sur le contenu après navigation', async () => {
    const user = userEvent.setup()
    mockApi({ list: [city] })
    render(<App />)
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Aller au contenu' }))
    const link = await screen.findByRole('link', { name: 'Ouvrir la fiche Nikaius' })
    link.focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('heading', { name: 'Nikaius', level: 1 })).toBeTruthy()
    expect(document.activeElement?.id).toBe('main-content')
  })

  it('ouvre un lien de fiche écrit dans le Markdown sans recharger la page', async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, '', '/fiches/nikaius')
    mockApi()
    render(<App />)
    await user.click(await screen.findByRole('link', { name: 'Voir Vruliven' }))
    expect(window.location.pathname).toBe('/fiches/vruliven')
    expect(await screen.findByRole('heading', { name: 'Vruliven', level: 1 })).toBeTruthy()
  })

  it('affiche les relations orientées et leurs libellés inverses', async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, '', '/fiches/nikaius')
    mockApi()
    render(<App />)
    const outgoing = await screen.findByRole('heading', { name: 'Relations sortantes' })
    const incoming = screen.getByRole('heading', { name: 'Relations entrantes' })
    expect(within(outgoing.parentElement as HTMLElement).getByText('Se situe dans')).toBeTruthy()
    expect(within(incoming.parentElement as HTMLElement).getByText('Contient')).toBeTruthy()
    await user.click(within(outgoing.parentElement as HTMLElement).getByRole('link', { name: /Vruliven/ }))
    expect(window.location.pathname).toBe('/fiches/vruliven')
    expect(await screen.findByRole('heading', { name: 'Vruliven', level: 1 })).toBeTruthy()
  })

  it('affiche clairement les relations absentes', async () => {
    window.history.replaceState(null, '', '/fiches/nikaius')
    mockApi({ detail: { ...cityDetail, outgoingRelations: [], incomingRelations: [] } })
    render(<App />)
    expect(await screen.findByText('Aucun lien publié pour cette fiche.')).toBeTruthy()
    expect(screen.getByText('Aucune relation sortante publiée.')).toBeTruthy()
    expect(screen.getByText('Aucune relation entrante publiée.')).toBeTruthy()
  })

  it('emploie le libellé direct pour une relation symétrique sans inverse', async () => {
    window.history.replaceState(null, '', '/fiches/nikaius')
    const symmetric = {
      ...locatedIn,
      relationType: {
        ...locatedIn.relationType,
        code: 'allied_with', label: 'Allié à', inverseCode: null, inverseLabel: null, symmetric: true,
      },
    }
    mockApi({ detail: { ...cityDetail, outgoingRelations: [], incomingRelations: [symmetric] } })
    render(<App />)
    const incoming = await screen.findByRole('heading', { name: 'Relations entrantes' })
    expect(within(incoming.parentElement as HTMLElement).getByText('Allié à')).toBeTruthy()
    expect(screen.queryByText('allied_with')).toBeNull()
  })

  it('conserve le code inverse lorsque son libellé manque sur une relation orientée', async () => {
    window.history.replaceState(null, '', '/fiches/nikaius')
    mockApi({ detail: {
      ...cityDetail, outgoingRelations: [],
      incomingRelations: [{
        ...locatedIn,
        relationType: { ...locatedIn.relationType, inverseLabel: null },
      }],
    } })
    render(<App />)
    const incoming = await screen.findByRole('heading', { name: 'Relations entrantes' })
    expect(within(incoming.parentElement as HTMLElement).getByText('contains')).toBeTruthy()
  })

  it('n’affiche pas placeKind sur une fiche qui n’est pas un lieu', async () => {
    window.history.replaceState(null, '', '/fiches/nikaius')
    mockApi({ detail: { ...cityDetail, kind: 'PERSON' } })
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Nikaius', level: 1 })).toBeTruthy()
    expect(screen.queryByText('Ville')).toBeNull()
  })

  it('annonce le chargement puis une indisponibilité réseau', async () => {
    let rejectList: ((error: Error) => void) | undefined
    vi.stubGlobal('fetch', vi.fn((input: string) => {
      if (String(input) === '/api/v1/health') {
        return Promise.resolve(response({ status: 'degraded', database: 'unavailable' }, 503))
      }
      return new Promise<Response>((_resolve, reject) => { rejectList = reject })
    }))
    render(<App />)
    expect(screen.getByText('Chargement de la bibliothèque…')).toBeTruthy()
    await act(async () => { rejectList?.(new TypeError('Network unavailable')) })
    expect(await screen.findByRole('heading', { name: 'API indisponible' })).toBeTruthy()
  })

  it('reconnaît une erreur de passerelle comme une API indisponible', async () => {
    mockApi({ listStatus: 502, healthStatus: 503 })
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'API indisponible' })).toBeTruthy()
  })

  it('ignore une ancienne réponse de santé après une nouvelle tentative', async () => {
    const user = userEvent.setup()
    let resolveOldHealth: ((value: Response) => void) | undefined
    let oldSignal: AbortSignal | undefined
    let healthCalls = 0
    let listCalls = 0
    vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => {
      if (String(input) === '/api/v1/health') {
        healthCalls += 1
        if (healthCalls === 1) {
          oldSignal = init?.signal as AbortSignal
          return new Promise<Response>((resolve) => { resolveOldHealth = resolve })
        }
        return Promise.resolve(response({ status: 'ok', database: 'ok' }))
      }
      listCalls += 1
      return Promise.resolve(response([], listCalls === 1 ? 500 : 200))
    }))
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByText('La bibliothèque attend ses premières fiches')).toBeTruthy()
    expect(screen.getByText('API disponible')).toBeTruthy()
    expect(oldSignal?.aborted).toBe(true)
    await act(async () => { resolveOldHealth?.(response({ status: 'degraded', database: 'unavailable' })) })
    expect(screen.getByText('API disponible')).toBeTruthy()
  })

  it('distingue recherche vide, API indisponible et fiche inexistante', async () => {
    const user = userEvent.setup()
    mockApi({ list: [] })
    const empty = render(<App />)
    await user.click(screen.getByRole('button', { name: 'Lieux' }))
    expect(await screen.findByText('Aucune fiche trouvée')).toBeTruthy()
    empty.unmount()

    mockApi({ listStatus: 500, healthStatus: 503 })
    const failed = render(<App />)
    expect(await screen.findByRole('heading', { name: 'Une erreur est survenue' })).toBeTruthy()
    expect(screen.getByText('API indisponible')).toBeTruthy()
    failed.unmount()

    window.history.replaceState(null, '', '/fiches/nikaius')
    mockApi({ detailStatus: 404 })
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Fiche introuvable' })).toBeTruthy()
  })

  it('signale une requête refusée et une URL frontend inconnue', async () => {
    mockApi({ listStatus: 400 })
    const failed = render(<App />)
    expect(await screen.findByRole('heading', { name: 'Requête invalide' })).toBeTruthy()
    failed.unmount()

    window.history.replaceState(null, '', '/route-inconnue')
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Page introuvable', level: 1 })).toBeTruthy()
  })
})
