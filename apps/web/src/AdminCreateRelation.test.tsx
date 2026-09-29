import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AdminEntityDetail, AdminEntityListItem, AdminManualRelationRequest, AdminSource } from '@hesta-codex/shared'
import { App } from './App'

const now = '2026-09-29T12:00:00.000Z'
const barolt = '11111111-1111-4111-8111-111111111111'
const archipel = '22222222-2222-4222-8222-222222222222'
const source: AdminSource = { id: '33333333-3333-4333-8333-333333333333', kind: 'MANUAL',
  label: 'Notes existantes', externalId: 'notes-01', url: null, authorLabel: 'MJ', publishedAt: null,
  visibility: 'GM', updatedAt: now }
const target: AdminEntityListItem = { id: archipel, slug: 'archipel', title: 'Archipel Trekrerith', kind: 'PLACE',
  placeKind: 'REGION', summary: null, tags: [], status: 'PROPOSED', visibility: 'GM', updatedAt: now }
const detail: AdminEntityDetail = { id: barolt, slug: 'barolt', title: 'Barolt', kind: 'PERSON', placeKind: null,
  summary: null, bodyMarkdown: '', aliases: [], tags: [], status: 'PROPOSED', visibility: 'GM',
  createdAt: now, updatedAt: now, publishedAt: null, evidence: [], revisions: [], outgoingRelations: [], incomingRelations: [] }
const archipelDetail: AdminEntityDetail = { ...detail, id: archipel, slug: 'archipel', title: 'Archipel Trekrerith',
  kind: 'PLACE', placeKind: 'REGION' }
const baroltItem: AdminEntityListItem = { id: barolt, slug: 'barolt', title: 'Barolt', kind: 'PERSON',
  placeKind: null, summary: null, tags: [], status: 'PROPOSED', visibility: 'GM', updatedAt: now }
const types = [
  { id: 'type-1', code: 'located_in', label: 'situé dans', inverseCode: 'contains', inverseLabel: 'contient', symmetric: false },
  { id: 'type-2', code: 'allied_with', label: 'allié à', inverseCode: null, inverseLabel: null, symmetric: true },
]
function response(data: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as Response
}
function mockApi(options: { createStatus?: number; code?: string; message?: string;
  session?: 'admin' | 'anonymous' | 'denied'; fromArchipel?: boolean } = {}) {
  const requests: Array<{ url: string; init?: RequestInit }> = []
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    requests.push({ url, init })
    if (url === '/api/auth/session') return response(options.session === 'anonymous'
      ? { authenticated: false, isAdmin: false, user: null }
      : { authenticated: true, isAdmin: options.session !== 'denied',
        user: { username: 'danny', displayName: 'Danny' } })
    if (url === '/api/admin/stats') return response({ byStatus: { DRAFT: 0, PROPOSED: 1,
      PUBLISHED: 0, ARCHIVED: 0 }, byVisibility: { PUBLIC: 0, PLAYERS: 0, GM: 1, SECRET: 0 },
    sources: 1, relations: 0 })
    if (url === '/api/admin/entities/barolt') return response(detail)
    if (url === '/api/admin/entities/archipel') return response(archipelDetail)
    if (url === '/api/admin/relation-types') return response(types)
    if (url.startsWith('/api/admin/entities?')) return response({ items: options.fromArchipel ? [baroltItem, target] : [target, baroltItem],
      total: 2, page: 1, pageSize: 50 })
    if (url.startsWith('/api/admin/sources?')) return response({ items: [source], total: 1, page: 1, pageSize: 20 })
    if (url === '/api/admin/relations' && init?.method === 'POST') return options.createStatus
      ? response({ error: { code: options.code ?? 'RELATION_CONFLICT',
        message: options.message ?? 'Cette relation existe déjà.' } }, options.createStatus)
      : response({ ...detail, outgoingRelations: [{ id: 'relation-1', description: null, status: 'PROPOSED',
        visibility: 'GM', updatedAt: now, relationType: types[0], entity: target,
        evidence: [{ id: 'proof-1', claimText: 'Preuve initiale', sourceExcerpt: null, locator: null,
          timeStartSeconds: null, timeEndSeconds: null, confidence: null, visibility: 'GM',
          updatedAt: now, source }] }] }, 201)
    return response({}, 404)
  }))
  return requests
}
beforeEach(() => window.history.replaceState(null, '', '/admin/fiches/barolt'))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/') })

async function openForm(user: ReturnType<typeof userEvent.setup>) {
  render(<App />)
  await user.click(await screen.findByRole('link', { name: 'Ajouter une relation' }))
  expect(window.location.pathname).toBe('/admin/fiches/barolt/nouvelle-relation')
  expect(await screen.findByRole('heading', { name: 'Ajouter une relation' })).toBeTruthy()
}
async function fillCore(user: ReturnType<typeof userEvent.setup>, code = 'located_in') {
  await user.selectOptions(await screen.findByRole('combobox', { name: 'Type et sens' }), code)
  await user.click(await screen.findByRole('radio', { name: /Archipel Trekrerith/ }))
  await user.click(await screen.findByRole('radio', { name: /Notes existantes/ }))
  await user.type(screen.getByRole('textbox', { name: 'Énoncé' }), 'Preuve initiale')
}

describe('création de relation depuis l’admin', () => {
  it('montre le sens direct, confirme puis affiche la relation et sa preuve sans changer les révisions', async () => {
    const requests = mockApi()
    const user = userEvent.setup()
    await openForm(user)
    await fillCore(user)
    await user.click(screen.getByRole('button', { name: 'Vérifier la création' }))
    expect(screen.getByText('Barolt → situé dans → Archipel Trekrerith')).toBeTruthy()
    expect(screen.getByText('PROPOSED · sans publication')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Créer la relation' }))
    await waitFor(() => expect(window.location.pathname).toBe('/admin/fiches/barolt'))
    expect(await screen.findByText('Relation créée en proposition.')).toBeTruthy()
    expect(screen.getByText('Preuve initiale')).toBeTruthy()
    expect(screen.queryByText(/Revision #1/)).toBeNull()
    const post = requests.find(({ url, init }) => url === '/api/admin/relations' && init?.method === 'POST')
    const body = JSON.parse(String(post?.init?.body)) as AdminManualRelationRequest
    expect(body.fromEntityId).toBe(barolt)
    expect(body.toEntityId).toBe(archipel)
    expect(body.relationCode).toBe('located_in')
    expect(body.source).toEqual({ mode: 'existing', sourceId: source.id })
    expect(body).not.toHaveProperty('status')
    expect(body.evidence).not.toHaveProperty('relationId')
  })

  it('propose le sens inverse issu du catalogue et un seul libellé symétrique', async () => {
    mockApi()
    const user = userEvent.setup()
    await openForm(user)
    await screen.findByRole('combobox', { name: 'Type et sens' })
    expect(screen.getByRole('option', { name: 'contient' })).toBeTruthy()
    expect(screen.getAllByRole('option', { name: 'allié à' })).toHaveLength(1)
    await fillCore(user, 'contains')
    await user.click(screen.getByRole('button', { name: 'Vérifier la création' }))
    expect(screen.getByText('Barolt → contient → Archipel Trekrerith')).toBeTruthy()
    expect(screen.getByText('Archipel Trekrerith → located_in → Barolt')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Corriger' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type et sens' }), 'allied_with')
    await user.click(screen.getByRole('button', { name: 'Vérifier la création' }))
    expect(screen.getByText('Barolt → allié à → Archipel Trekrerith')).toBeTruthy()
  })

  it('depuis la fiche cible, présente « contient » et envoie les UUID affichés sans les inverser côté client', async () => {
    const requests = mockApi({ fromArchipel: true })
    const user = userEvent.setup()
    window.history.replaceState(null, '', '/admin/fiches/archipel/nouvelle-relation')
    render(<App />)
    await screen.findByRole('option', { name: 'contient' })
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type et sens' }), 'contains')
    await user.click(await screen.findByRole('radio', { name: /Barolt/ }))
    await user.click(await screen.findByRole('radio', { name: /Notes existantes/ }))
    await user.type(screen.getByRole('textbox', { name: 'Énoncé' }), 'Preuve initiale')
    await user.click(screen.getByRole('button', { name: 'Vérifier la création' }))
    expect(screen.getByText('Archipel Trekrerith → contient → Barolt')).toBeTruthy()
    expect(screen.getByText('Barolt → located_in → Archipel Trekrerith')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Créer la relation' }))
    await waitFor(() => expect(requests.some(({ url, init }) => url === '/api/admin/relations' && init?.method === 'POST')).toBe(true))
    const post = requests.find(({ url, init }) => url === '/api/admin/relations' && init?.method === 'POST')
    const body = JSON.parse(String(post?.init?.body)) as AdminManualRelationRequest
    expect([body.fromEntityId, body.relationCode, body.toEntityId]).toEqual([archipel, 'contains', barolt])
  })

  it('crée une nouvelle Source avec Evidence et repères horaires', async () => {
    const requests = mockApi()
    const user = userEvent.setup()
    await openForm(user)
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Type et sens' }), 'located_in')
    await user.click(await screen.findByRole('radio', { name: /Archipel Trekrerith/ }))
    await user.click(screen.getByRole('radio', { name: 'Nouvelle source' }))
    await user.type(screen.getByRole('textbox', { name: 'Label' }), 'Enregistrement de partie')
    await user.type(screen.getByRole('textbox', { name: 'Énoncé' }), 'Preuve initiale')
    await user.type(screen.getByRole('spinbutton', { name: 'Début en secondes' }), '8072')
    expect(screen.getByText('02:14:32')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Vérifier la création' }))
    await user.click(screen.getByRole('button', { name: 'Créer la relation' }))
    await waitFor(() => expect(requests.some(({ url, init }) => url === '/api/admin/relations' && init?.method === 'POST')).toBe(true))
    const post = requests.find(({ url, init }) => url === '/api/admin/relations' && init?.method === 'POST')
    const body = JSON.parse(String(post?.init?.body)) as AdminManualRelationRequest
    expect(body.source).toMatchObject({ mode: 'new', data: { label: 'Enregistrement de partie', visibility: 'GM' } })
    expect(body.evidence.timeStartSeconds).toBe(8072)
    expect(body.evidence.visibility).toBe('GM')
  })

  it.each([
    [409, 'RELATION_CONFLICT', 'Cette relation existe déjà.'],
    [409, 'SOURCE_CONFLICT', 'Cette Source existe déjà.'],
    [404, 'TO_ENTITY_NOT_FOUND', 'Fiche cible introuvable.'],
  ])('conserve la saisie après %s %s', async (status, code, message) => {
    mockApi({ createStatus: status, code, message })
    const user = userEvent.setup()
    await openForm(user)
    await fillCore(user)
    await user.click(screen.getByRole('button', { name: 'Vérifier la création' }))
    await user.click(screen.getByRole('button', { name: 'Créer la relation' }))
    expect((await screen.findByRole('alert')).textContent).toContain(message)
    await user.click(screen.getByRole('button', { name: 'Corriger' }))
    expect((screen.getByRole('combobox', { name: 'Type et sens' }) as HTMLSelectElement).value).toBe('located_in')
  })

  it('protège la navigation et garde le formulaire après expiration de session', async () => {
    mockApi({ createStatus: 401 })
    const user = userEvent.setup()
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)
    await openForm(user)
    await fillCore(user)
    await user.click(screen.getByRole('link', { name: /Barolt/ }))
    expect(confirm).toHaveBeenCalled()
    expect(window.location.pathname).toContain('nouvelle-relation')
    await user.click(screen.getByRole('button', { name: 'Vérifier la création' }))
    await user.click(screen.getByRole('button', { name: 'Créer la relation' }))
    expect(await screen.findByRole('link', { name: 'Se reconnecter avec Discord' })).toBeTruthy()
    expect(screen.getByText('PROPOSED · sans publication')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Créer la relation' }).hasAttribute('disabled')).toBe(true)
  })

  it('annule une recherche cible obsolète et ne soumet pas deux fois', async () => {
    mockApi()
    const fallback = globalThis.fetch
    let oldSignal: AbortSignal | undefined
    let resolveOld!: (response: Response) => void
    let resolvePost!: (response: Response) => void
    let postCount = 0
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('q=ancien')) {
        oldSignal = init?.signal ?? undefined
        return new Promise<Response>((resolve) => { resolveOld = resolve })
      }
      if (url === '/api/admin/relations' && init?.method === 'POST') {
        postCount++
        return new Promise<Response>((resolve) => { resolvePost = resolve })
      }
      return fallback(input, init)
    }))
    const user = userEvent.setup()
    await openForm(user)
    const search = screen.getByRole('searchbox', { name: 'Rechercher une fiche cible' })
    await user.type(search, 'ancien')
    await waitFor(() => expect(resolveOld).toBeTypeOf('function'))
    await user.clear(search)
    await user.type(search, 'nouveau')
    expect(await screen.findByRole('radio', { name: /Archipel Trekrerith/ })).toBeTruthy()
    expect(oldSignal?.aborted).toBe(true)
    resolveOld(response({ items: [], total: 0, page: 1, pageSize: 50 }))
    await fillCore(user)
    await user.click(screen.getByRole('button', { name: 'Vérifier la création' }))
    await user.click(screen.getByRole('button', { name: 'Créer la relation' }))
    expect(screen.getByRole('button', { name: 'Création…' }).hasAttribute('disabled')).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Création…' }))
    expect(postCount).toBe(1)
    resolvePost(response({ ...detail, outgoingRelations: [] }, 201))
  })

  it('valide les champs puis donne le focus à la première erreur', async () => {
    mockApi()
    const user = userEvent.setup()
    await openForm(user)
    await user.click(screen.getByRole('button', { name: 'Vérifier la création' }))
    expect(screen.getByText('Choisissez un type et un sens.')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: /^Type et sens/ }))
    await user.selectOptions(screen.getByRole('combobox', { name: /^Type et sens/ }), 'located_in')
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Confiance (0 à 1)' }), { target: { value: '0.1234' } })
    await user.click(screen.getByRole('button', { name: 'Vérifier la création' }))
    expect(screen.getByText('Confiance entre 0 et 1, avec trois décimales au plus.')).toBeTruthy()
  })
})
