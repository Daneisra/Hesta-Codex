import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { relationTypeDefinitions, type AdminEntityDetail, type AdminRelation, type QualificationFilters,
  type QualificationResponse, type QualificationRow } from '@hesta-codex/shared'
import { AdminReferenceQueue } from './AdminReferenceQueue'
import { App } from './App'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const stamp = '2026-01-01T00:00:00.000Z'
const types = relationTypeDefinitions.map((type, index) => ({ ...type, id: id(100 + index) }))
const type = types.find(item => item.code === 'works_for')!
const from = { id: id(1), title: 'Fiche fictive A', slug: 'fiche-a', kind: 'PERSON' as const,
  status: 'PROPOSED' as const, visibility: 'GM' as const }
const to = { ...from, id: id(2), title: 'Fiche fictive B', slug: 'fiche-b' }
const relation: AdminRelation = { id: id(3), relationType: type, description: 'Description conservée', status: 'PROPOSED', visibility: 'GM',
  updatedAt: stamp, entity: { ...to, placeKind: null, summary: null, tags: [], updatedAt: stamp }, evidence: [], evidenceDeferred: true, evidenceCount: 1 }
const entity: AdminEntityDetail = { ...from, placeKind: null, summary: null, tags: [], aliases: [], bodyMarkdown: 'Contenu fictif',
  createdAt: stamp, updatedAt: stamp, publishedAt: null, outgoingRelations: [relation], incomingRelations: [], evidence: [], revisions: [] }
const row: QualificationRow = { id: 'pair-a-b', from, to, state: 'QUALIFIED', occurrences: 3, fingerprint: 'a'.repeat(64),
  decisionRevision: null, ignoredBy: null, ignoredAt: null, stale: false, origins: [],
  relations: [{ id: relation.id, fromEntityId: from.id, toEntityId: to.id, status: relation.status, visibility: relation.visibility, relationType: type }] }
const data: QualificationResponse = { items: [row], total: 1, page: 1, pageSize: 50, counts: { total: 1, QUALIFIED: 1, PENDING: 0, IGNORED: 0 },
  entities: [from, to], sources: [], diagnostics: [], diagnosticCounts: {}, diagnosticTotal: 0 }
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

function setup(options: { entity?: AdminEntityDetail; data?: QualificationResponse; loadStatus?: number; patchStatus?: number; app?: boolean;
  patch?: () => Promise<ReturnType<typeof response>> } = {}) {
  let currentEntity = options.entity ?? entity, currentData = options.data ?? data
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/auth/session') return response({ authenticated: true, isAdmin: true, user: { username: 'Fictif', displayName: null } })
    if (url.includes('/api/admin/entities/')) return response(currentEntity, options.loadStatus)
    if (url === '/api/admin/relation-types') return response(types)
    if (url.startsWith('/api/admin/reference-qualifications?')) return response(currentData)
    if (init?.method === 'PATCH') {
      if (options.patch) return options.patch()
      if (options.patchStatus) return response({ error: { message: 'Conflit fictif' } }, options.patchStatus)
      currentData = { ...currentData, items: currentData.items.map(item => ({ ...item,
        relations: item.relations.map(item => item.id === relation.id ? { ...item, fromEntityId: to.id, toEntityId: from.id } : item) })) }
      return response({ id: relation.id, updatedAt: '2026-01-02T00:00:00.000Z' })
    }
    if (url === '/api/admin/stats') return response({ byStatus: {}, sources: 0, relations: 1 })
    throw new Error(`Unexpected request: ${url}`)
  })
  vi.stubGlobal('fetch', fetcher)
  const onAccessError = vi.fn(), onDirtyChange = vi.fn(), onPendingChange = vi.fn(), onNavigate = vi.fn()
  function Fixture() {
    const [filters, setFilters] = useState<QualificationFilters>({ page: 1, state: 'QUALIFIED', q: 'fictive' })
    return <AdminReferenceQueue filters={filters} onFilters={setFilters} onAccessError={onAccessError} onDefine={vi.fn()}
      onNavigate={onNavigate} onDirtyChange={onDirtyChange} onPendingChange={onPendingChange} />
  }
  if (options.app) window.history.replaceState(null, '', '/admin/relations-a-qualifier')
  render(options.app ? <App /> : <Fixture />)
  return { fetcher, onAccessError, onDirtyChange, onPendingChange, setEntity: (next: AdminEntityDetail) => { currentEntity = next } }
}
const open = async () => fireEvent.click(await screen.findByRole('button', { name: /^Modifier la relation :/ }))
const invert = async () => { await open(); fireEvent.click(await screen.findByRole('button', { name: 'Inverser les fiches' }));
  fireEvent.click(screen.getByRole('button', { name: 'Vérifier la modification' })) }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/') })

describe('correction depuis la file de qualification', () => {
  it('expose les relations qualifiées sans ouvrir la provenance et ne charge la fiche qu’au clic', async () => {
    const { fetcher } = setup()
    await screen.findByRole('button', { name: /^Modifier la relation : Fiche fictive A travaille pour Fiche fictive B$/ })
    expect(screen.getByText('Sens éditorial : /fiche-a → /fiche-b')).toBeTruthy()
    expect(fetcher.mock.calls.every(([url]) => !url.includes('/entities/'))).toBe(true)
    await open()
    await screen.findByRole('combobox', { name: 'Type et sens' })
    expect(fetcher.mock.calls.find(([url]) => url.includes('/entities/'))?.[1]).toMatchObject({ cache: 'no-store',
      headers: { 'X-Hesta-Relation-Evidence': 'defer' } })
    expect(fetcher.mock.calls.every(([url]) => !url.endsWith('/evidence'))).toBe(true)
    expect(screen.getByRole('button', { name: 'Actualiser la file' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('combobox', { name: 'État' })).toHaveProperty('disabled', true)
  })

  it('confirme une inversion puis recharge la file et ses compteurs en gardant les filtres', async () => {
    const { fetcher, onPendingChange } = setup()
    await invert()
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer la modification' }))
    await screen.findByText('Sens éditorial : /fiche-b → /fiche-a')
    const patches = fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH')
    expect(patches).toHaveLength(1)
    expect(patches[0][0]).toBe(`/api/admin/relations/${relation.id}`)
    expect(JSON.parse(String(patches[0][1]?.body))).toEqual({ description: relation.description, visibility: 'GM',
      expectedUpdatedAt: stamp, relationCode: 'works_for', reverse: true })
    expect(fetcher.mock.calls.filter(([url]) => url.includes('reference-qualifications?')).at(-1)?.[0]).toContain('state=QUALIFIED')
    expect(screen.getByRole('searchbox')).toHaveProperty('value', 'fictive')
    expect(screen.queryByRole('button', { name: 'Confirmer la modification' })).toBeNull()
    expect(onPendingChange.mock.calls).toEqual([[true], [false]])
  })

  it('utilise le sens réel et la version récente même si la mention Obsidian et la projection sont inversées', async () => {
    const incoming = { ...relation, entity: { ...entity, id: to.id, slug: to.slug, title: to.title }, updatedAt: '2026-01-03T00:00:00.000Z' }
    const { fetcher } = setup({ entity: { ...entity, outgoingRelations: [], incomingRelations: [incoming] } })
    await invert()
    expect(screen.getByText('Avant : Fiche fictive B travaille pour Fiche fictive A')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer la modification' }))
    await waitFor(() => expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(true))
    const patch = fetcher.mock.calls.find(([, init]) => init?.method === 'PATCH')!
    expect(JSON.parse(String(patch[1]?.body)).expectedUpdatedAt).toBe(incoming.updatedAt)
  })

  it('permet de choisir précisément entre plusieurs relations existantes, avec homonymes', async () => {
    const other = { ...row.relations[0], id: id(4), relationType: types.find(item => item.code === 'protects')! }
    const sameName = { ...to, title: from.title }
    const { fetcher } = setup({ data: { ...data, items: [{ ...row, to: sameName, relations: [row.relations[0], other] }] },
      entity: { ...entity, outgoingRelations: [relation, { ...relation, id: other.id, relationType: other.relationType }] } })
    fireEvent.click(await screen.findByRole('button', { name: 'Modifier la relation : Fiche fictive A protège Fiche fictive A' }))
    await screen.findByRole('button', { name: 'Inverser les fiches' })
    fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), { target: { value: 'Correction fictive' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
    await waitFor(() => expect(fetcher.mock.calls.some(([url, init]) => init?.method === 'PATCH' && url.endsWith(other.id))).toBe(true))
  })

  it.each(['relation', 'entity'] as const)('une %s archivée ne propose aucune action de correction', async target => {
    const archived = { ...row, ...(target === 'entity' ? { to: { ...to, status: 'ARCHIVED' as const } } :
      { relations: [{ ...row.relations[0], status: 'ARCHIVED' as const }] }) }
    setup({ data: { ...data, items: [archived] } })
    await screen.findByText(/Sens éditorial/)
    expect(screen.queryByRole('button', { name: /^Modifier la relation :/ })).toBeNull()
  })

  it.each(['missing', 'wrong-pair', 'archived'] as const)('refuse une relation devenue %s entre la file et l’ouverture', async condition => {
    const current = condition === 'missing' ? [] : [{ ...relation, status: condition === 'archived' ? 'ARCHIVED' as const : relation.status,
      entity: condition === 'wrong-pair' ? { ...relation.entity, id: id(9) } : relation.entity }]
    const { fetcher } = setup({ entity: { ...entity, outgoingRelations: current } })
    await open(); await screen.findByRole('alert')
    expect(screen.queryByRole('combobox', { name: 'Type et sens' })).toBeNull()
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0)
  })

  it('conserve la saisie après conflit et exige confirmation avant de recharger ou d’annuler', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { fetcher, onDirtyChange, setEntity } = setup({ patchStatus: 409 })
    await invert(); fireEvent.click(screen.getByRole('button', { name: 'Confirmer la modification' }))
    await screen.findByText(/Correction refusée/)
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(screen.getByRole('button', { name: 'Confirmer la modification' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Recharger la relation' }))
    expect(fetcher.mock.calls.filter(([url]) => url.includes('/entities/'))).toHaveLength(1)
    confirm.mockReturnValue(true)
    setEntity({ ...entity, outgoingRelations: [{ ...relation, updatedAt: '2026-01-04T00:00:00.000Z' }] })
    fireEvent.click(screen.getByRole('button', { name: 'Recharger la relation' }))
    await screen.findByRole('combobox', { name: 'Type et sens' })
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(screen.getByRole('button', { name: 'Actualiser la file' })).toHaveProperty('disabled', false)
  })

  it.each([401, 403])('signale une session refusée (%s) au chargement et ne permet aucune écriture', async status => {
    const { fetcher, onAccessError } = setup({ loadStatus: status })
    await open()
    await waitFor(() => expect(onAccessError).toHaveBeenCalledWith(status))
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(0)
  })

  it.each([401, 403, 500])('ne confirme pas une sauvegarde refusée (%s)', async status => {
    const { onAccessError } = setup({ patchStatus: status })
    await invert(); fireEvent.click(screen.getByRole('button', { name: 'Confirmer la modification' }))
    await screen.findByRole('alert')
    if (status !== 500) expect(onAccessError).toHaveBeenCalledWith(status)
    expect(screen.getByRole('button', { name: 'Confirmer la modification' })).toBeTruthy()
    expect(screen.queryByText(/Relation modifiée/)).toBeNull()
  })

  it('bloque le double clic et la navigation pendant une mutation, puis libère le verrou', async () => {
    let done!: (value: ReturnType<typeof response>) => void
    const promise = new Promise<ReturnType<typeof response>>(resolve => { done = resolve })
    const { fetcher, onPendingChange } = setup({ patch: () => promise })
    await invert(); await userEvent.setup().dblClick(screen.getByRole('button', { name: 'Confirmer la modification' }))
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Annuler' })).toHaveProperty('disabled', true)
    expect(onPendingChange).toHaveBeenLastCalledWith(true)
    done(response({}, 500)); await screen.findByRole('alert')
    expect(onPendingChange).toHaveBeenLastCalledWith(false)
  })

  it('protège la navigation globale et la déconnexion quand la correction contient une saisie', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    setup({ app: true }); await invert()
    const editor = screen.getByRole('region', { name: 'Correction de la relation éditoriale' })
    expect(within(editor).getByRole('button', { name: 'Confirmer la modification' })).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: '← Tableau de bord' }))
    expect(confirm).toHaveBeenCalled()
    expect(window.location.pathname).toBe('/admin/relations-a-qualifier')
    fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }))
    expect(window.location.pathname).toBe('/admin/relations-a-qualifier')
    expect(screen.getByRole('button', { name: 'Confirmer la modification' })).toBeTruthy()
  })
})
