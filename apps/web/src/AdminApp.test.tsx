import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AdminEntityDetail, AdminEntityListResponse, AdminStats, AuthSessionResponse } from '@hesta-codex/shared'
import { App } from './App'

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
    source: { id: 'source-1', kind: 'MANUAL', label: 'Notes de partie', externalId: 'notes-001',
      url: null, authorLabel: 'MJ', visibility: 'GM' },
  }],
  outgoingRelations: [{
    id: 'relation-1', description: null, status: 'PROPOSED', visibility: 'GM',
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
} = {}) {
  const requests: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    requests.push(url)
    if (url === '/api/auth/session') return response(options.session ?? administrator, options.sessionStatus)
    if (url === '/api/admin/stats') return response(stats)
    if (url.startsWith('/api/admin/entities?')) return response(options.list ?? list, options.listStatus)
    if (url === '/api/admin/entities/barolt') return response(detail, options.detailStatus)
    if (url === '/api/auth/logout') return response({}, 204)
    return response({}, 404)
  }))
  return requests
}

beforeEach(() => window.history.replaceState(null, '', '/admin'))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/') })

describe('administration en lecture seule', () => {
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
    expect(screen.getByText('Notes de partie', { exact: false })).toBeTruthy()
    expect(screen.getByText('Auteur : MJ', { exact: false })).toBeTruthy()
    expect(screen.getByText('Fait sourcé')).toBeTruthy()
    expect(screen.getByRole('heading', { name: /Relations sortantes/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Organisation' })).toBeTruthy()
    expect(screen.getByText(/Revision #1/)).toBeTruthy()
    await user.click(screen.getByText('Consulter le snapshot'))
    expect(within(screen.getByRole('article')).getByText(/"title": "Barolt"/)).toBeTruthy()
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
})
