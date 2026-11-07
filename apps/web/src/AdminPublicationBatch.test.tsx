import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PublicationCandidate, PublicationPreview } from '@hesta-codex/shared'
import { AdminPublicationBatch } from './AdminPublicationBatch'
import { AdminApp } from './AdminApp'

const a: PublicationCandidate = { id: 'a', slug: 'fictive-a', title: 'Fiche fictive A', status: 'PROPOSED', visibility: 'GM' }
const b: PublicationCandidate = { ...a, id: 'b', slug: 'fictive-b', title: 'Fiche fictive B' }
const c: PublicationCandidate = { ...a, id: 'c', slug: 'fictive-c', title: 'Fiche fictive C', status: 'PUBLISHED' }
const plan: PublicationPreview = { fingerprint: 'a'.repeat(64), entities: [
  { ...a, outcome: 'READY', reason: 'Prête à valider.', evidence: 1 }, { ...b, outcome: 'BLOCKED', reason: 'Aucune preuve directement liée à la fiche.', evidence: 0 },
], relations: [{ id: 'r', from: a, to: c, label: 'lien fictif', status: 'PROPOSED', visibility: 'GM', outcome: 'READY', reason: 'Prête à valider.', evidence: 1 }],
  counts: { entitiesReady: 1, entitiesBlocked: 1, entitiesSkipped: 0, relationsReady: 1, relationsBlocked: 0, relationsSkipped: 0, publicElements: 0 } }
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
function setup(options: { plan?: PublicationPreview; applyStatus?: number; candidateStatus?: number; previewStatus?: number; app?: boolean;
  result?: { entities: number; relations: number };
  apply?: () => Promise<ReturnType<typeof response>> } = {}) {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/candidates')) return response([a, b, c], options.candidateStatus)
    if (url.endsWith('/preview')) return response(options.previewStatus ? { error: { message: 'Bilan indisponible.' } } : options.plan ?? plan, options.previewStatus)
    if (url.endsWith('/apply')) return options.apply ? options.apply() : response(options.applyStatus ? { error: { message: 'Le bilan a changé.' } } : options.result ?? { entities: 1, relations: 1 }, options.applyStatus)
    if (url === '/api/auth/session') return response({ authenticated: true, isAdmin: true, user: { username: 'Fictif', displayName: null } })
    if (url === '/api/admin/stats') return response({ byStatus: {}, byVisibility: {}, sources: 1, relations: 1 })
    if (url.startsWith('/api/admin/entities?')) return response({ items: [], total: 0, page: 1, pageSize: 50 })
    throw new Error(`Unexpected request ${url} ${init?.method}`)
  })
  vi.stubGlobal('fetch', fetcher)
  const props = { onNavigate: vi.fn(event => event.preventDefault()), onAccessError: vi.fn(), onPendingChange: vi.fn(), onDirtyChange: vi.fn(), onChanged: vi.fn() }
  render(options.app ? <AdminApp /> : <AdminPublicationBatch {...props} />)
  return { fetcher, ...props }
}
async function review() {
  await screen.findByRole('checkbox', { name: /Fiche fictive A/ })
  fireEvent.click(screen.getByRole('checkbox', { name: 'Tout sélectionner parmi les fiches affichées' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Inclure les relations entrantes et sortantes admissibles' }))
  fireEvent.click(screen.getByRole('button', { name: 'Examiner le bilan' }))
  await screen.findByRole('heading', { name: 'Bilan avant validation' })
}
const confirm = () => fireEvent.click(screen.getByRole('checkbox', { name: /J’ai vérifié le bilan/ }))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/') })

describe('validation groupée', () => {
  it('loads candidates read-only, shows blocked reasons and requires a reviewed plan before applying', async () => {
    const { fetcher, onChanged, onDirtyChange } = setup()
    await review()
    const writes = () => fetcher.mock.calls.filter(([url]) => url.endsWith('/apply'))
    expect(writes()).toHaveLength(0)
    expect(screen.getByText(/Aucune preuve directement liée/)).toBeTruthy()
    expect(screen.getByText(/1 fiche\(s\) prête\(s\) · 1 relation/)).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Bilan avant validation' }))
    expect(screen.getByRole('button', { name: 'Confirmer la validation groupée' })).toHaveProperty('disabled', true)
    expect(JSON.parse(String(fetcher.mock.calls.find(([url]) => url.endsWith('/preview'))![1]!.body))).toEqual({ entityIds: ['a', 'b'], includeRelations: true })
    confirm(); fireEvent.click(screen.getByRole('button', { name: 'Confirmer la validation groupée' }))
    await screen.findByText('1 fiche(s) et 1 relation(s) validées. Visibilités conservées.')
    expect(writes()).toHaveLength(1)
    expect(JSON.parse(String(writes()[0]![1]!.body))).toEqual({ entityIds: ['a', 'b'], includeRelations: true, fingerprint: plan.fingerprint, confirm: true, confirmPublic: false })
    expect(onChanged).toHaveBeenCalledOnce()
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false))
  })
  it('supports selection across filters and invalidates the plan when the selection or relation option changes', async () => {
    const { fetcher } = setup(); await review()
    confirm()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Inclure les relations entrantes et sortantes admissibles' }))
    expect(screen.queryByRole('heading', { name: 'Bilan avant validation' })).toBeNull()
    fireEvent.change(screen.getByRole('combobox', { name: 'Statut' }), { target: { value: 'PUBLISHED' } })
    expect(screen.getByText(/2 fiche\(s\) sélectionnée/)).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: /Fiche fictive C/ }))
    expect(screen.getByText(/3 fiche\(s\) sélectionnée/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Examiner le bilan' })); await screen.findByRole('heading', { name: 'Bilan avant validation' })
    expect(screen.getByRole('checkbox', { name: /J’ai vérifié le bilan/ })).toHaveProperty('checked', false)
    fireEvent.click(screen.getByRole('button', { name: 'Effacer la sélection' }))
    expect(screen.queryByRole('heading', { name: 'Bilan avant validation' })).toBeNull()
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/apply'))).toBe(false)
  })
  it('cancel restores focus and performs no mutation', async () => {
    const { fetcher } = setup(); await review(); confirm()
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Examiner le bilan' }))
    expect(screen.queryByRole('heading', { name: 'Bilan avant validation' })).toBeNull()
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/apply'))).toBe(false)
  })
  it('PUBLIC items require an independent explicit confirmation', async () => {
    const { fetcher } = setup({ plan: { ...plan, counts: { ...plan.counts, publicElements: 1 }, entities: [{ ...plan.entities[0]!, visibility: 'PUBLIC' }] } })
    await review(); confirm()
    expect(screen.getByRole('button', { name: 'Confirmer la validation groupée' })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('checkbox', { name: /Je confirme explicitement/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer la validation groupée' }))
    await screen.findByText(/validées. Visibilités conservées/)
    expect(JSON.parse(String(fetcher.mock.calls.find(([url]) => url.endsWith('/apply'))![1]!.body)).confirmPublic).toBe(true)
  })
  it('a fully blocked plan cannot be applied', async () => {
    const { fetcher } = setup({ plan: { ...plan, counts: { ...plan.counts, entitiesReady: 0, relationsReady: 0 } } })
    await review(); confirm()
    expect(screen.getByRole('button', { name: 'Confirmer la validation groupée' })).toHaveProperty('disabled', true)
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/apply'))).toBe(false)
  })
  it.each([401, 403, 409, 500])('failed apply (%s) clears the approval, preserves no false success and requires a new preview', async status => {
    const { onAccessError, onChanged } = setup({ applyStatus: status })
    await review(); confirm(); fireEvent.click(screen.getByRole('button', { name: 'Confirmer la validation groupée' }))
    await screen.findByRole('alert')
    expect(screen.queryByRole('heading', { name: 'Bilan avant validation' })).toBeNull()
    expect(screen.queryByText(/validées. Visibilités conservées/)).toBeNull()
    expect(onChanged).not.toHaveBeenCalled()
    if (status === 401 || status === 403) { expect(onAccessError).toHaveBeenCalledWith(status); expect(screen.queryByText('Fiche fictive A')).toBeNull() }
  })
  it('blocks double application and locks selection and back navigation while pending', async () => {
    let done!: (value: ReturnType<typeof response>) => void
    const { fetcher, onPendingChange, onNavigate } = setup({ apply: () => new Promise(resolve => { done = resolve }) })
    await review(); confirm()
    const button = screen.getByRole('button', { name: 'Confirmer la validation groupée' })
    fireEvent.click(button); fireEvent.click(button)
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/apply'))).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Annuler' })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('link', { name: /Tableau de bord/ })); expect(onNavigate).not.toHaveBeenCalled()
    expect(onPendingChange).toHaveBeenLastCalledWith(true)
    done(response({ entities: 1, relations: 1 })); await screen.findByText(/validées. Visibilités conservées/)
    expect(onPendingChange).toHaveBeenLastCalledWith(false)
  })
  it('candidate or preview failures offer retry without performing a write', async () => {
    const { fetcher } = setup({ previewStatus: 503 })
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Tout sélectionner parmi les fiches affichées' }))
    fireEvent.click(screen.getByRole('button', { name: 'Examiner le bilan' })); await screen.findByRole('alert')
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/apply'))).toBe(false)
    expect(screen.getByRole('button', { name: 'Examiner le bilan' })).toHaveProperty('disabled', false)
  })
  it('opens from the dashboard and refreshes its counters after a successful batch', async () => {
    window.history.replaceState(null, '', '/admin')
    const { fetcher } = setup({ app: true })
    fireEvent.click(await screen.findByRole('link', { name: 'Validation groupée' }))
    await review(); confirm(); fireEvent.click(screen.getByRole('button', { name: 'Confirmer la validation groupée' }))
    await screen.findByText(/validées. Visibilités conservées/)
    await waitFor(() => expect(fetcher.mock.calls.filter(([url]) => url === '/api/admin/stats').length).toBeGreaterThan(1))
    expect(window.location.pathname).toBe('/admin/validation-groupee')
  })
})

const visibilityPlan: PublicationPreview = { ...plan, targetVisibility: 'PUBLIC', entities: plan.entities.map(row => ({ ...row, outcome: 'READY', reason: 'Visibilité modifiable ; statut conservé.' })),
  counts: { ...plan.counts, entitiesReady: 2, entitiesBlocked: 0, publicElements: 3 },
  visibilityImpact: { publicEntities: 0, publicRelations: 0, hiddenEntities: 0, hiddenRelations: 0 } }
async function reviewVisibility(target = 'PUBLIC') {
  await screen.findByRole('checkbox', { name: /Fiche fictive A/ })
  fireEvent.change(screen.getByRole('combobox', { name: 'Opération' }), { target: { value: 'visibility' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Nouvelle visibilité' }), { target: { value: target } })
  fireEvent.click(screen.getByRole('checkbox', { name: 'Tout sélectionner parmi les fiches affichées' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Inclure les relations entrantes et sortantes admissibles' }))
  fireEvent.click(screen.getByRole('button', { name: 'Examiner le bilan' }))
  await screen.findByRole('heading', { name: 'Bilan avant validation' })
}
describe('visibilité groupée', () => {
  it('requires an explicit target choice and never starts a publication on operation change', async () => {
    const { fetcher } = setup()
    await screen.findByRole('checkbox', { name: /Fiche fictive A/ })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tout sélectionner parmi les fiches affichées' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Opération' }), { target: { value: 'visibility' } })
    expect(screen.getByRole('combobox', { name: 'Nouvelle visibilité' })).toHaveProperty('value', '')
    expect(screen.getByRole('button', { name: 'Examiner le bilan' })).toHaveProperty('disabled', true)
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0)
  })
  it('shows before/after and immediate exposure, then requires both confirmations to set PUBLIC', async () => {
    const { fetcher, onChanged } = setup({ plan: { ...visibilityPlan, visibilityImpact: { publicEntities: 1, publicRelations: 2, hiddenEntities: 0, hiddenRelations: 0 } }, result: { entities: 2, relations: 1 } })
    await reviewVisibility()
    expect(screen.getByText(/Fiche : Fiche fictive A.*MJ → PUBLIC/)).toBeTruthy()
    expect(screen.getByText(/1 fiche\(s\) et 2 relation\(s\) deviendront visibles/)).toBeTruthy()
    expect(screen.getByText(/Aucun statut ne change/)).toBeTruthy()
    confirm()
    expect(screen.getByRole('button', { name: 'Confirmer le changement de visibilité' })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('checkbox', { name: /Je confirme explicitement le passage en PUBLIC/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer le changement de visibilité' }))
    await screen.findByText('Visibilité modifiée pour 2 fiche(s) et 1 relation(s). Statuts conservés.')
    const requests = fetcher.mock.calls.filter(([url]) => url.endsWith('/apply'))
    expect(requests).toHaveLength(1)
    expect(JSON.parse(String(requests[0]![1]!.body))).toEqual({ entityIds: ['a', 'b'], includeRelations: true,
      targetVisibility: 'PUBLIC', fingerprint: plan.fingerprint, confirm: true, confirmPublic: true })
    expect(onChanged).toHaveBeenCalledOnce()
  })
  it('target or operation changes discard the approval and require a newly reviewed plan', async () => {
    const { fetcher } = setup({ plan: visibilityPlan })
    await reviewVisibility(); confirm()
    fireEvent.click(screen.getByRole('checkbox', { name: /Je confirme explicitement le passage en PUBLIC/ }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Nouvelle visibilité' }), { target: { value: 'SECRET' } })
    expect(screen.queryByRole('heading', { name: 'Bilan avant validation' })).toBeNull()
    fireEvent.change(screen.getByRole('combobox', { name: 'Nouvelle visibilité' }), { target: { value: 'PUBLIC' } })
    fireEvent.click(screen.getByRole('button', { name: 'Examiner le bilan' })); await screen.findByRole('heading', { name: 'Bilan avant validation' })
    expect(screen.getByRole('checkbox', { name: /J’ai vérifié le bilan/ })).toHaveProperty('checked', false)
    expect(screen.getByRole('checkbox', { name: /Je confirme explicitement/ })).toHaveProperty('checked', false)
    fireEvent.change(screen.getByRole('combobox', { name: 'Opération' }), { target: { value: 'publish' } })
    expect(screen.queryByRole('heading', { name: 'Bilan avant validation' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Nouvelle visibilité' })).toBeNull()
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/apply'))).toBe(false)
  })
  it('can restrict visibility with a reviewed impact without requiring PUBLIC consent', async () => {
    const { fetcher } = setup({ plan: { ...visibilityPlan, targetVisibility: 'GM', counts: { ...visibilityPlan.counts, publicElements: 0 },
      visibilityImpact: { publicEntities: 0, publicRelations: 0, hiddenEntities: 2, hiddenRelations: 1 } } })
    await reviewVisibility('GM'); confirm()
    expect(screen.getByText(/2 fiche\(s\) et 1 relation\(s\) seront masquées/)).toBeTruthy()
    expect(screen.queryByRole('checkbox', { name: /Je confirme explicitement/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer le changement de visibilité' }))
    await screen.findByText(/Visibilité modifiée/)
    expect(JSON.parse(String(fetcher.mock.calls.find(([url]) => url.endsWith('/apply'))![1]!.body)).confirmPublic).toBe(false)
  })
  it('already matching visibility is shown as unchanged and cannot be applied', async () => {
    setup({ plan: { ...visibilityPlan, entities: visibilityPlan.entities.map(row => ({ ...row, visibility: 'PUBLIC', outcome: 'SKIPPED' })), relations: [],
      counts: { ...visibilityPlan.counts, entitiesReady: 0, entitiesSkipped: 2, relationsReady: 0, publicElements: 0 } } })
    await reviewVisibility(); confirm()
    expect(screen.getByRole('button', { name: 'Confirmer le changement de visibilité' })).toHaveProperty('disabled', true)
    expect(screen.getByText('Déjà à cette visibilité (2)')).toBeTruthy()
  })
  it('a stale visibility approval cannot be retried without a new preview', async () => {
    const { onChanged } = setup({ plan: visibilityPlan, applyStatus: 409 })
    await reviewVisibility(); confirm()
    fireEvent.click(screen.getByRole('checkbox', { name: /Je confirme explicitement/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer le changement de visibilité' }))
    await screen.findByRole('alert')
    expect(screen.queryByRole('button', { name: 'Confirmer le changement de visibilité' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Examiner le bilan' })).toHaveProperty('disabled', false)
    expect(onChanged).not.toHaveBeenCalled()
  })
})
