import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AdminEntityDetail, AdminManualCreateRequest, AdminSource } from '@hesta-codex/shared'
import { App } from './App'

const now = '2026-09-29T12:00:00.000Z'
const source: AdminSource = { id: '11111111-1111-4111-8111-111111111111', kind: 'MANUAL',
  label: 'Notes existantes', externalId: 'notes-01', url: null, authorLabel: 'MJ',
  publishedAt: null, visibility: 'GM', updatedAt: now }
const detail: AdminEntityDetail = {
  id: 'entity-1', slug: 'nouvelle-fiche', kind: 'PERSON', placeKind: null, title: 'Nouvelle fiche',
  summary: null, bodyMarkdown: '## Texte', aliases: [], tags: [], status: 'PROPOSED', visibility: 'GM',
  createdAt: now, updatedAt: now, publishedAt: null, outgoingRelations: [], incomingRelations: [],
  evidence: [{ id: 'evidence-1', claimText: 'Fait sourcé', sourceExcerpt: null, locator: null,
    timeStartSeconds: 0, timeEndSeconds: 8072, confidence: null, visibility: 'GM', updatedAt: now, source }],
  revisions: [{ id: 'revision-1', number: 1, snapshot: { version: 1, entity: { title: 'Nouvelle fiche' } },
    message: 'Création manuelle depuis l’administration', editorLabel: 'Danny', createdAt: now }],
}
function response(data: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as Response
}
function mockApi(options: { session?: 'admin' | 'anonymous' | 'denied'; createStatus?: number;
  createCode?: string; createMessage?: string; createIssues?: Array<{ path: string; message: string }>;
  sourceStatus?: number } = {}) {
  const requests: Array<{ url: string; init?: RequestInit }> = []
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    requests.push({ url, init })
    if (url === '/api/auth/session') return response(options.session === 'anonymous'
      ? { authenticated: false, isAdmin: false, user: null }
      : { authenticated: true, isAdmin: options.session !== 'denied',
        user: { username: 'danny', displayName: 'Danny' } })
    if (url === '/api/admin/stats') return response({ byStatus: { DRAFT: 0, PROPOSED: 0,
      PUBLISHED: 0, ARCHIVED: 0 }, byVisibility: { PUBLIC: 0, PLAYERS: 0, GM: 0, SECRET: 0 },
    sources: 1, relations: 0 })
    if (url.startsWith('/api/admin/entities?')) return response({ items: [], total: 0, page: 1, pageSize: 50 })
    if (url.startsWith('/api/admin/sources?')) return options.sourceStatus
      ? response({ error: { code: 'FAILED' } }, options.sourceStatus)
      : response({ items: [source], total: 1, page: 1, pageSize: 20 })
    if (url === '/api/admin/entities' && init?.method === 'POST') return options.createStatus
      ? response({ error: { code: options.createCode ?? 'ENTITY_CONFLICT', issues: options.createIssues,
        message: options.createMessage ?? (options.createStatus === 401 ? 'Connexion requise'
          : 'Ce slug est déjà utilisé par une fiche.') } },
      options.createStatus)
      : response(detail, 201)
    if (url === '/api/admin/entities/nouvelle-fiche') return response(detail)
    return response({}, 404)
  }))
  return requests
}

beforeEach(() => window.history.replaceState(null, '', '/admin'))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/') })

async function fillMinimal(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByRole('textbox', { name: /^Titre/ }), 'Nouvelle fiche')
  await user.type(screen.getByRole('textbox', { name: 'Énoncé' }), 'Fait sourcé')
}

describe('création manuelle admin', () => {
  it('ouvre le formulaire depuis le tableau de bord et suggère un slug modifiable', async () => {
    const requests = mockApi()
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('link', { name: 'Nouvelle fiche' }))
    expect(window.location.pathname).toBe('/admin/nouvelle-fiche')
    await user.type(screen.getByRole('textbox', { name: 'Titre' }), 'Épée d’Or')
    expect((screen.getByRole('textbox', { name: 'Slug' }) as HTMLInputElement).value).toBe('epee-d-or')
    await user.clear(screen.getByRole('textbox', { name: 'Slug' }))
    await user.type(screen.getByRole('textbox', { name: 'Slug' }), 'slug-choisi')
    await user.type(screen.getByRole('textbox', { name: 'Titre' }), ' du Nord')
    expect((screen.getByRole('textbox', { name: 'Slug' }) as HTMLInputElement).value).toBe('slug-choisi')
    expect(requests.some(({ url }) => url.startsWith('/api/v1/'))).toBe(false)
  })

  it('choisit une Source existante, vérifie le résumé et ouvre la fiche créée avec sa Revision', async () => {
    const requests = mockApi()
    const user = userEvent.setup()
    window.history.replaceState(null, '', '/admin/nouvelle-fiche')
    render(<App />)
    await fillMinimal(user)
    await user.click(await screen.findByRole('radio', { name: /Notes existantes/ }))
    await user.click(screen.getByRole('button', { name: 'Vérifier la création' }))
    expect(screen.getByText('PROPOSED · sans publication')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Créer la fiche' }))
    await waitFor(() => expect(window.location.pathname).toBe('/admin/fiches/nouvelle-fiche'))
    expect(await screen.findByText('Fiche créée en proposition.')).toBeTruthy()
    expect(screen.getByText('Fait sourcé')).toBeTruthy()
    expect(screen.getByText(/Revision #1/)).toBeTruthy()
    const create = requests.find(({ url, init }) => url === '/api/admin/entities' && init?.method === 'POST')
    expect(create).toBeTruthy()
    const body = JSON.parse(String(create?.init?.body)) as AdminManualCreateRequest
    expect(body.source).toEqual({ mode: 'existing', sourceId: source.id })
    expect(body.entity).toMatchObject({ slug: 'nouvelle-fiche', visibility: 'GM' })
    expect(body.entity).not.toHaveProperty('status')
    expect(body.evidence.claimText).toBe('Fait sourcé')
  })

  it('crée une Source et une Evidence avec repères temporels humains, sans IDs injectés', async () => {
    const requests = mockApi()
    const user = userEvent.setup()
    window.history.replaceState(null, '', '/admin/nouvelle-fiche')
    render(<App />)
    await fillMinimal(user)
    await user.click(screen.getByRole('radio', { name: 'Nouvelle source' }))
    await user.type(screen.getByRole('textbox', { name: 'Label' }), 'Vidéo de partie')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type de Source' }), 'YOUTUBE')
    await user.type(screen.getByRole('spinbutton', { name: 'Début en secondes' }), '8072')
    expect(screen.getByText('02:14:32')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Vérifier la création' }))
    expect(screen.getByText(/Vidéo de partie · YOUTUBE/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Créer la fiche' }))
    await waitFor(() => expect(requests.some(({ url, init }) => url === '/api/admin/entities' && init?.method === 'POST')).toBe(true))
    const create = requests.find(({ url, init }) => url === '/api/admin/entities' && init?.method === 'POST')
    const body = JSON.parse(String(create?.init?.body)) as AdminManualCreateRequest
    expect(body.source).toMatchObject({ mode: 'new', data: { kind: 'YOUTUBE', label: 'Vidéo de partie',
      visibility: 'GM' } })
    expect(body.evidence.timeStartSeconds).toBe(8072)
    expect(body.evidence).not.toHaveProperty('entityId')
    expect(body.evidence).not.toHaveProperty('sourceId')
  })

  it('signale les champs requis avant confirmation et protège la navigation avec saisie', async () => {
    mockApi()
    const user = userEvent.setup()
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)
    window.history.replaceState(null, '', '/admin/nouvelle-fiche')
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Vérifier la création' }))
    expect(screen.getByText('Le titre est requis.')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: /^Titre/ }))
    await user.type(screen.getByRole('textbox', { name: /^Titre/ }), 'Nouvelle fiche')
    await user.click(screen.getByRole('link', { name: /Tableau de bord/ }))
    expect(confirm).toHaveBeenCalled()
    expect(window.location.pathname).toBe('/admin/nouvelle-fiche')
  })

  it('garde le résumé et les données saisies après un conflit de slug', async () => {
    mockApi({ createStatus: 409 })
    const user = userEvent.setup()
    window.history.replaceState(null, '', '/admin/nouvelle-fiche')
    render(<App />)
    await fillMinimal(user)
    await user.click(await screen.findByRole('radio', { name: /Notes existantes/ }))
    await user.click(screen.getByRole('button', { name: 'Vérifier la création' }))
    await user.click(screen.getByRole('button', { name: 'Créer la fiche' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Ce slug est déjà utilisé par une fiche.')
    await user.click(screen.getByRole('button', { name: 'Corriger' }))
    expect((screen.getByRole('textbox', { name: 'Titre' }) as HTMLInputElement).value).toBe('Nouvelle fiche')
  })

  it('revient aux champs et associe une erreur serveur au champ concerné', async () => {
    mockApi({ createStatus: 400, createCode: 'INVALID_REQUEST',
      createIssues: [{ path: 'entity.tags.1', message: 'Valeur dupliquée' }] })
    const user = userEvent.setup()
    window.history.replaceState(null, '', '/admin/nouvelle-fiche')
    render(<App />)
    await fillMinimal(user)
    await user.click(await screen.findByRole('radio', { name: /Notes existantes/ }))
    await user.click(screen.getByRole('button', { name: 'Vérifier la création' }))
    await user.click(screen.getByRole('button', { name: 'Créer la fiche' }))
    const tags = await screen.findByRole('textbox', { name: /Tags, séparés par des virgules/ })
    expect(tags.getAttribute('aria-invalid')).toBe('true')
    expect(tags.getAttribute('aria-describedby')).toBe('entity.tags-error')
    expect(screen.getByText('Valeur dupliquée')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('alert'))
    await user.type(tags, 'nouveau')
    expect(screen.queryByText('Valeur dupliquée')).toBeNull()
  })

  it.each([
    [409, 'SOURCE_CONFLICT', 'Cette Source existe déjà.'],
    [404, 'SOURCE_NOT_FOUND', 'Source introuvable.'],
  ])('préserve la saisie et affiche %s %s', async (status, code, message) => {
    mockApi({ createStatus: status, createCode: code, createMessage: message })
    const user = userEvent.setup()
    window.history.replaceState(null, '', '/admin/nouvelle-fiche')
    render(<App />)
    await fillMinimal(user)
    await user.click(await screen.findByRole('radio', { name: /Notes existantes/ }))
    await user.click(screen.getByRole('button', { name: 'Vérifier la création' }))
    await user.click(screen.getByRole('button', { name: 'Créer la fiche' }))
    expect((await screen.findByRole('alert')).textContent).toContain(message)
    await user.click(screen.getByRole('button', { name: 'Corriger' }))
    expect((screen.getByRole('textbox', { name: 'Titre' }) as HTMLInputElement).value).toBe('Nouvelle fiche')
  })

  it('bloque les timestamps hors borne et la confiance trop précise avant le POST', async () => {
    const requests = mockApi()
    const user = userEvent.setup()
    window.history.replaceState(null, '', '/admin/nouvelle-fiche')
    render(<App />)
    await fillMinimal(user)
    await user.click(await screen.findByRole('radio', { name: /Notes existantes/ }))
    const start = screen.getByRole('spinbutton', { name: 'Début en secondes' })
    fireEvent.change(start, { target: { value: '2147483648' } })
    await user.click(screen.getByRole('button', { name: 'Vérifier la création' }))
    expect(screen.getByText('Entier positif en secondes requis.')).toBeTruthy()
    fireEvent.change(start, { target: { value: '' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Confiance (0 à 1)' }),
      { target: { value: '0.1234' } })
    await user.click(screen.getByRole('button', { name: 'Vérifier la création' }))
    expect(screen.getByText('Confiance entre 0 et 1, avec trois décimales au plus.')).toBeTruthy()
    expect(requests.filter(({ url, init }) => url === '/api/admin/entities' && init?.method === 'POST')).toHaveLength(0)
  })

  it('annule les anciennes recherches de Sources et quitte le chargement sur un seul caractère', async () => {
    mockApi()
    const fallback = globalThis.fetch
    let resolveOld!: (response: Response) => void
    let oldSignal: AbortSignal | undefined
    const sourceNew = { ...source, id: '22222222-2222-4222-8222-222222222222', label: 'Nouvelle provenance' }
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('q=ancien')) {
        oldSignal = init?.signal ?? undefined
        return new Promise<Response>((resolve) => { resolveOld = resolve })
      }
      if (url.includes('q=nouveau')) return Promise.resolve(response({ items: [sourceNew], total: 1,
        page: 1, pageSize: 20 }))
      return fallback(input, init)
    }))
    const user = userEvent.setup()
    window.history.replaceState(null, '', '/admin/nouvelle-fiche')
    render(<App />)
    const search = await screen.findByRole('searchbox', { name: 'Rechercher une Source' })
    expect(await screen.findByRole('radio', { name: /Notes existantes/ })).toBeTruthy()
    await user.type(search, 'a')
    expect(screen.queryByText('Recherche des Sources…')).toBeNull()
    await user.clear(search)
    await user.type(search, 'ancien')
    await waitFor(() => expect(resolveOld).toBeTypeOf('function'))
    await user.clear(search)
    await user.type(search, 'nouveau')
    expect(await screen.findByRole('radio', { name: /Nouvelle provenance/ })).toBeTruthy()
    expect(oldSignal?.aborted).toBe(true)
    resolveOld(response({ items: [source], total: 1, page: 1, pageSize: 20 }))
    expect(screen.getByRole('radio', { name: /Nouvelle provenance/ })).toBeTruthy()
    expect(screen.queryByRole('radio', { name: /Notes existantes/ })).toBeNull()
  })

  it('désactive la confirmation pendant l’envoi pour éviter un double POST', async () => {
    mockApi()
    const fallback = globalThis.fetch
    let resolveCreate!: (response: Response) => void
    let postCount = 0
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === '/api/admin/entities' && init?.method === 'POST') {
        postCount++
        return new Promise<Response>((resolve) => { resolveCreate = resolve })
      }
      return fallback(input, init)
    }))
    const user = userEvent.setup()
    window.history.replaceState(null, '', '/admin/nouvelle-fiche')
    render(<App />)
    await fillMinimal(user)
    await user.click(await screen.findByRole('radio', { name: /Notes existantes/ }))
    await user.click(screen.getByRole('button', { name: 'Vérifier la création' }))
    await user.click(screen.getByRole('button', { name: 'Créer la fiche' }))
    expect(screen.getByRole('button', { name: 'Création…' }).hasAttribute('disabled')).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Création…' }))
    expect(postCount).toBe(1)
    resolveCreate(response(detail, 201))
    await waitFor(() => expect(window.location.pathname).toBe('/admin/fiches/nouvelle-fiche'))
  })

  it('conserve le formulaire si la session expire pendant la création', async () => {
    mockApi({ createStatus: 401 })
    const user = userEvent.setup()
    window.history.replaceState(null, '', '/admin/nouvelle-fiche')
    render(<App />)
    await fillMinimal(user)
    await user.click(await screen.findByRole('radio', { name: /Notes existantes/ }))
    await user.click(screen.getByRole('button', { name: 'Vérifier la création' }))
    await user.click(screen.getByRole('button', { name: 'Créer la fiche' }))
    expect(await screen.findByRole('link', { name: 'Se reconnecter avec Discord' })).toBeTruthy()
    expect(screen.getByText('PROPOSED · sans publication')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Créer la fiche' }).hasAttribute('disabled')).toBe(true)
  })

  it('réserve l’écran aux administrateurs et indique une recherche de Sources indisponible', async () => {
    window.history.replaceState(null, '', '/admin/nouvelle-fiche')
    const anonymous = mockApi({ session: 'anonymous' })
    const first = render(<App />)
    expect(await screen.findByRole('heading', { name: 'Administration Hesta Codex' })).toBeTruthy()
    expect(anonymous.some(({ url }) => url.startsWith('/api/admin/sources'))).toBe(false)
    first.unmount()
    mockApi({ session: 'denied' })
    const second = render(<App />)
    expect(await screen.findByRole('heading', { name: 'Accès refusé' })).toBeTruthy()
    second.unmount()
    mockApi({ sourceStatus: 500 })
    render(<App />)
    expect(await screen.findByText('Recherche de sources indisponible.')).toBeTruthy()
  })
})
