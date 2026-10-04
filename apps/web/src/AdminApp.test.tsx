import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AdminEntityDetail, AdminEntityListResponse, AdminStats, AuthSessionResponse } from '@hesta-codex/shared'
import { App } from './App'

// Keep these tests focused on session authorization and SPA navigation.
vi.mock('react-force-graph-2d', () => ({ default: () => null }))

const anonymous: AuthSessionResponse = { authenticated: false, isAdmin: false, user: null }
const denied: AuthSessionResponse = { authenticated: true, isAdmin: false, user: { username: 'joueur', displayName: null } }
const administrator: AuthSessionResponse = { authenticated: true, isAdmin: true, user: { username: 'mj', displayName: 'Maître du jeu' } }
const stats: AdminStats = {
  byStatus: { DRAFT: 0, PROPOSED: 8, PUBLISHED: 0, ARCHIVED: 0 },
  byVisibility: { PUBLIC: 0, PLAYERS: 0, GM: 8, SECRET: 0 },
  sources: 1, relations: 6,
}
const detail: AdminEntityDetail = {
  id: 'entity-1', slug: 'barolt', kind: 'PERSON', placeKind: null,
  title: 'Barolt', summary: 'Résumé privé', bodyMarkdown: '## Chronique\n\nUn **texte** privé.',
  aliases: ['Autre nom'], tags: ['personnage'], status: 'PROPOSED', visibility: 'GM',
  createdAt: '2026-09-28T00:00:00.000Z', updatedAt: '2026-09-28T00:00:00.000Z', publishedAt: null,
  evidence: [{
    id: 'evidence-1', claimText: 'Fait sourcé', sourceExcerpt: 'Extrait privé', locator: 'p. 2',
    timeStartSeconds: null, timeEndSeconds: null, confidence: '0.800', visibility: 'GM',
    updatedAt: '2026-09-28T00:00:00.000Z',
    source: { id: 'source-1', kind: 'MANUAL', label: 'Notes de partie', externalId: 'notes-001',
      url: null, authorLabel: 'MJ', visibility: 'GM', publishedAt: null,
      updatedAt: '2026-09-28T00:00:00.000Z' },
  }],
  outgoingRelations: [{
    id: 'relation-1', description: null, status: 'PROPOSED', visibility: 'GM',
    updatedAt: '2026-09-28T00:00:00.000Z',
    relationType: { id: 'type-1', code: 'member_of', label: 'membre de', inverseCode: 'has_member',
      inverseLabel: 'compte parmi ses membres', symmetric: false },
    entity: { id: 'entity-2', slug: 'organisation', title: 'Organisation', kind: 'ORGANIZATION',
      placeKind: null, summary: null, tags: [], status: 'PROPOSED', visibility: 'GM',
      updatedAt: '2026-09-28T00:00:00.000Z' },
    evidence: [],
  }],
  incomingRelations: [],
  revisions: [{ id: 'revision-1', number: 1, snapshot: { entity: { title: 'Barolt' } },
    message: 'Import', editorLabel: 'Import CLI Hesta Codex', createdAt: '2026-09-28T00:00:00.000Z' }],
}
const list: AdminEntityListResponse = {
  items: [{ id: detail.id, slug: detail.slug, kind: detail.kind, placeKind: detail.placeKind,
    title: detail.title, summary: detail.summary, tags: detail.tags, status: detail.status,
    visibility: detail.visibility, updatedAt: detail.updatedAt }],
  total: 8, page: 1, pageSize: 50,
}

function response(data: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as Response
}

function mockApi(options: {
  session?: AuthSessionResponse
  sessionStatus?: number
  listStatus?: number
  list?: AdminEntityListResponse
  detailStatus?: number
  sourceMutationStatus?: number
  evidenceAddStatus?: number
} = {}) {
  const requests: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    requests.push(url)
    if (url === '/api/auth/session') return response(options.session ?? administrator, options.sessionStatus)
    if (url === '/api/admin/graph') return response({ nodes: [], edges: [] })
    if (url === '/api/admin/stats') return response(stats)
    if (url.startsWith('/api/admin/entities?')) return response(options.list ?? list, options.listStatus)
    if (url === '/api/admin/sources/source-1' && init?.method === 'PATCH') {
      const status = options.sourceMutationStatus ?? 200
      return response(status === 409 ? { error: { code: 'SOURCE_CONFLICT',
        message: 'Une source de ce type utilise déjà cet identifiant externe.' } }
        : status === 401 ? { error: { code: 'UNAUTHORIZED', message: 'Session expirée.' } }
          : { id: 'source-1', updatedAt: detail.updatedAt }, status)
    }
    if (url === '/api/admin/entities/barolt/evidence' && init?.method === 'POST') {
      const status = options.evidenceAddStatus ?? 201
      return response(status === 401 ? { error: { code: 'UNAUTHORIZED', message: 'Session expirée.' } }
        : status === 409 ? { error: { code: 'EVIDENCE_CONFLICT', message: 'Cette preuve existe déjà.' } }
          : { id: 'evidence-2' }, status)
    }
    if (url.startsWith('/api/admin/sources?')) return response({ items: [detail.evidence[0]!.source],
      total: 1, page: 1, pageSize: 20 })
    if (url === '/api/admin/entities/barolt') return response(detail, options.detailStatus)
    if (url === '/api/auth/logout') return response({}, 204)
    return response({}, 404)
  }))
  return requests
}

beforeEach(() => window.history.replaceState(null, '', '/admin'))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/') })

describe('administration en lecture seule', () => {
  it('ouvre /admin/graphe seulement après la session admin, y compris par URL directe', async () => {
    window.history.replaceState(null, '', '/admin/graphe')
    const requests = mockApi()
    render(<App />)
    expect(await screen.findByText('Aucune fiche à représenter.', undefined, { timeout: 8_000 })).toBeTruthy()
    expect(requests).toContain('/api/admin/graph')
    cleanup()
    const deniedRequests = mockApi({ session: denied })
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Accès refusé' })).toBeTruthy()
    expect(deniedRequests).not.toContain('/api/admin/graph')
  }, 12_000)

  it('présente la connexion Discord sans demander de données privées', async () => {
    const requests = mockApi({ session: anonymous })
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Administration Hesta Codex' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Se connecter avec Discord' }).getAttribute('href')).toBe('/api/auth/discord/login')
    expect(requests).toEqual(['/api/auth/session'])
  })

  it('affiche accès refusé et propose la déconnexion à un non administrateur', async () => {
    mockApi({ session: denied })
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Accès refusé' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Se déconnecter' })).toBeTruthy()
    expect(screen.queryByText('8')).toBeNull()
  })

  it('affiche les huit propositions et filtre sans envoyer q avant deux caractères', async () => {
    const user = userEvent.setup()
    const requests = mockApi()
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Tableau de bord' })).toBeTruthy()
    expect(await screen.findByText('Barolt')).toBeTruthy()
    expect(screen.getByText('8 résultats')).toBeTruthy()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Statut' }), 'PROPOSED')
    await waitFor(() => expect(requests.some((url) => url.includes('status=PROPOSED'))).toBe(true))
    await user.type(screen.getByRole('searchbox', { name: 'Rechercher' }), 'b')
    await new Promise((resolve) => setTimeout(resolve, 380))
    expect(requests.some((url) => url.includes('q=b&') || url.endsWith('q=b'))).toBe(false)
    await user.type(screen.getByRole('searchbox', { name: 'Rechercher' }), 'a')
    await waitFor(() => expect(requests.some((url) => url.includes('q=ba'))).toBe(true))
  })

  it('ouvre une fiche privée avec contenu, Source, Evidence, relation et Revision', async () => {
    const user = userEvent.setup()
    mockApi()
    render(<App />)
    await user.click(await screen.findByRole('link', { name: /Barolt/ }))
    expect(window.location.pathname).toBe('/admin/fiches/barolt')
    expect(await screen.findByRole('heading', { name: 'Barolt', level: 1 })).toBeTruthy()
    expect(screen.getByText('Résumé privé')).toBeTruthy()
    expect(screen.getByText('Autre nom', { exact: false })).toBeTruthy()
    expect(screen.getAllByText('Notes de partie', { exact: false }).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Auteur : MJ', { exact: false }).length).toBeGreaterThan(0)
    expect(screen.getByText('Fait sourcé')).toBeTruthy()
    expect(screen.getByRole('heading', { name: /Relations sortantes/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Organisation' })).toBeTruthy()
    expect(screen.getByText(/Revision #1/)).toBeTruthy()
    await user.click(screen.getByText('Consulter le snapshot'))
    expect(within(screen.getByRole('article')).getByText(/"title": "Barolt"/)).toBeTruthy()
  })

  it('ajoute une preuve depuis la fiche, rafraîchit le détail et garde la confirmation visible', async () => {
    const user = userEvent.setup()
    const requests = mockApi()
    window.history.replaceState(null, '', '/admin/fiches/barolt')
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Ajouter une preuve à la fiche' }))
    await user.click(await screen.findByRole('radio', { name: /Notes de partie/ }))
    await user.type(screen.getByRole('textbox', { name: 'Énoncé' }), 'Preuve complémentaire')
    await user.click(screen.getByRole('button', { name: 'Vérifier avant ajout' }))
    await user.click(screen.getByRole('button', { name: 'Ajouter la preuve' }))
    expect(await screen.findByText('Preuve ajoutée.')).toBeTruthy()
    expect(requests.filter((path) => path === '/api/admin/entities/barolt').length).toBeGreaterThan(1)
  })

  it('ouvre directement une URL admin partageable et gère erreurs de session ou de fiche', async () => {
    window.history.replaceState(null, '', '/admin/fiches/barolt')
    mockApi({ detailStatus: 404 })
    const missing = render(<App />)
    expect(await screen.findByRole('heading', { name: 'Fiche introuvable' })).toBeTruthy()
    missing.unmount()
    mockApi({ sessionStatus: 503 })
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Administration indisponible' })).toBeTruthy()
  })

  it('annonce chargement puis erreur de liste', async () => {
    mockApi({ listStatus: 500 })
    render(<App />)
    expect(screen.getByText('Vérification de la session…')).toBeTruthy()
    expect(await screen.findByText(/Impossible de charger les fiches/)).toBeTruthy()
  })

  it('affiche un état vide sans fiche et pagine une liste volumineuse', async () => {
    const empty = mockApi({ list: { items: [], total: 0, page: 1, pageSize: 50 } })
    const view = render(<App />)
    expect(await screen.findByText('Aucune fiche pour ces filtres.')).toBeTruthy()
    expect(empty.some((url) => url.includes('page=1'))).toBe(true)
    view.unmount()
    const requests = mockApi({ list: { ...list, total: 120 } })
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Suivant' }))
    await waitFor(() => expect(requests.some((url) => url.includes('page=2'))).toBe(true))
  })

  it('revient à la connexion si la session expire pendant une lecture admin', async () => {
    mockApi({ listStatus: 401 })
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Administration Hesta Codex' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Tableau de bord' })).toBeNull()
  })

  it('ouvre une URL admin directe et revient au tableau de bord sans rechargement', async () => {
    window.history.replaceState(null, '', '/admin/fiches/barolt')
    const requests = mockApi()
    const user = userEvent.setup()
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Barolt', level: 1 })).toBeTruthy()
    await user.click(screen.getByRole('link', { name: /Tableau de bord/ }))
    expect(window.location.pathname).toBe('/admin')
    expect(await screen.findByRole('heading', { name: 'Tableau de bord', level: 1 })).toBeTruthy()
    expect(requests.includes('/api/admin/entities/barolt')).toBe(true)
  })

  it('respecte le retour arrière du navigateur après ouverture d’une fiche', async () => {
    mockApi()
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('link', { name: /Barolt/ }))
    expect(await screen.findByRole('heading', { name: 'Barolt', level: 1 })).toBeTruthy()
    window.history.back()
    await waitFor(() => expect(window.location.pathname).toBe('/admin'))
    expect(await screen.findByRole('heading', { name: 'Tableau de bord', level: 1 })).toBeTruthy()
  })

  it('affiche un conflit Source sans perdre le formulaire ni proposer un faux rechargement', async () => {
    window.history.replaceState(null, '', '/admin/fiches/barolt')
    mockApi({ sourceMutationStatus: 409 })
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Modifier la source' }))
    await user.clear(screen.getByRole('textbox', { name: 'Label' }))
    await user.type(screen.getByRole('textbox', { name: 'Label' }), 'Notes corrigées')
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent',
      'Une source de ce type utilise déjà cet identifiant externe.')
    expect((screen.getByRole('textbox', { name: 'Label' }) as HTMLInputElement).value).toBe('Notes corrigées')
    expect(screen.queryByRole('button', { name: 'Recharger la version récente' })).toBeNull()
  })

  it('conserve la saisie Source et bloque Enregistrer après expiration de session', async () => {
    window.history.replaceState(null, '', '/admin/fiches/barolt')
    mockApi({ sourceMutationStatus: 401 })
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Modifier la source' }))
    await user.type(screen.getByRole('textbox', { name: 'Label' }), ' corrigées')
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))
    expect(await screen.findByRole('link', { name: 'Se reconnecter avec Discord' })).toBeTruthy()
    expect((screen.getByRole('textbox', { name: 'Label' }) as HTMLInputElement).value).toContain('corrigées')
    expect(screen.getByRole('button', { name: 'Enregistrer' }).hasAttribute('disabled')).toBe(true)
  })
})
