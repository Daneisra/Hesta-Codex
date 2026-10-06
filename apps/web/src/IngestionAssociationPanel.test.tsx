import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { IngestionAssociationDecision, IngestionAssociationEntity, IngestionAssociationState, IngestionMatches } from '@hesta-codex/shared'
import { IngestionAssociationPanel } from './IngestionAssociationPanel'
import { IngestionEntityPicker } from './IngestionEntityPicker'

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const itemId = uuid(1), receiptId = uuid(2)
const a: IngestionAssociationEntity = { id: uuid(3), title: 'Fiche technique A', slug: 'technique-a', kind: 'PLACE', placeKind: 'CITY', status: 'DRAFT', visibility: 'SECRET' }
const b = { ...a, id: uuid(4), title: 'Fiche technique B', slug: 'technique-b' }
const manual = { ...a, id: uuid(5), title: 'Station Épreuve — œ', slug: 'station-epreuve' }
const matches: IngestionMatches = { status: 'EXACT', candidates: [a, b].map((entity, i) => ({ ...entity, aliases: [], score: i ? 79 : 90, reasons: [i ? 'SIMILAR_TITLE' : 'EXACT_TITLE'] })),
  evaluatedCount: 2, exactCandidateCount: 1, strongCandidateCount: 1, approximateEvaluatedCount: 1,
  searchTruncated: false, candidatesTruncated: false, candidateLimit: 10, searchLimit: 200 }
const empty = (): IngestionAssociationState => ({ revision: 0, scope: 'EXTERNAL_ID', confirmed: null, invalid: false, rejectedCandidateIds: [], rejectedCount: 0, recentRejections: [] })
const decision = (entity = a): IngestionAssociationDecision => ({ entity, origin: 'MATCH', authorLabel: 'Admin technique', decidedAt: '2026-10-06T00:00:00Z' })
const response = (data: unknown, status = 200) => ({ ok: status === 200, status, json: async () => data }) as Response
const props = { itemId, receiptId, matches: { phase: 'ready' as const, data: matches }, onRetryMatches: vi.fn(), onAccessError: vi.fn() }
function api(initial = empty()) {
  let state = initial
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    if (url.endsWith('/entities/search')) return response({ items: [manual], truncated: false, limit: 20 })
    if (!init?.method) return response(structuredClone(state))
    const input = JSON.parse(String(init.body)) as { entityId?: string; origin?: 'MATCH' | 'MANUAL'; expectedRevision: number; receiptId: string }
    expect(input.receiptId).toBe(receiptId)
    if (input.expectedRevision !== state.revision) return response({}, 409)
    const target = [a, b, manual].find(entity => entity.id === input.entityId)!
    if (url.endsWith('/confirm')) {
      state = { ...state, revision: state.revision + 1, confirmed: { ...decision(target), origin: input.origin! },
        rejectedCandidateIds: state.rejectedCandidateIds.filter(id => id !== target.id), recentRejections: state.recentRejections.filter(value => value.entity.id !== target.id) }
    } else if (url.endsWith('/reject')) state = { ...state, revision: state.revision + 1, rejectedCandidateIds: [...state.rejectedCandidateIds, target.id], recentRejections: [...state.recentRejections, decision(target)] }
    else if (url.endsWith('/reset')) state = { ...state, revision: state.revision + 1, confirmed: null }
    state.rejectedCount = state.recentRejections.length
    return response(structuredClone(state))
  })
  vi.stubGlobal('fetch', fetcher)
  return { calls, fetcher, state: () => state }
}
beforeEach(() => { window.history.replaceState(null, '', '/admin/ingestion'); document.title = 'Administration · Hesta Codex'; props.onAccessError.mockClear() })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/') })
const candidate = (title = a.title) => within(screen.getByRole('heading', { name: title }).closest('li')!)

describe('décisions humaines d’association', () => {
  for (const entity of [a, b]) it(`confirms an explicit exact/possible suggestion for ${entity.title} without an automatic write`, async () => {
    const mock = api(), user = userEvent.setup(); render(<IngestionAssociationPanel {...props} />)
    await screen.findByText('Aucune association confirmée.')
    expect(mock.calls.every(call => !call.init?.method)).toBe(true)
    await user.click(candidate(entity.title).getByRole('button', { name: 'Confirmer cette fiche' }))
    expect(mock.calls.every(call => !call.init?.method)).toBe(true)
    expect(screen.getByRole('group', { name: 'Confirmation de la décision' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Enregistrer l’association' }))
    await screen.findByRole('heading', { name: 'Association confirmée' })
    expect(mock.state().confirmed?.entity.id).toBe(entity.id)
    expect(screen.getByText(/Confirmée par Admin technique/)).toBeTruthy()
    expect(candidate(entity.title).getByText('Cette fiche est déjà associée.')).toBeTruthy()
    expect(screen.getByText('Association enregistrée.')).toBeTruthy()
  })
  it('persists a rejection and marks the precise candidate, keeping other suggestions admissible', async () => {
    const mock = api(), user = userEvent.setup(); render(<IngestionAssociationPanel {...props} />)
    await screen.findByText('Aucune association confirmée.')
    await user.click(candidate().getByRole('button', { name: 'Ce n’est pas cette fiche' }))
    await user.click(screen.getByRole('button', { name: 'Confirmer le rejet' }))
    await screen.findByText('Rejetée précédemment pour cette identité.')
    expect(candidate().getByRole('button', { name: 'Ce n’est pas cette fiche' }).hasAttribute('disabled')).toBe(true)
    expect(candidate(b.title).getByRole('button', { name: 'Confirmer cette fiche' }).hasAttribute('disabled')).toBe(false)
    expect(mock.state().rejectedCandidateIds).toEqual([a.id]); expect(mock.state().confirmed).toBeNull()
    expect(screen.getByText('Suggestion rejetée.')).toBeTruthy()
  })
  it('manual title/slug/alias search is debounced, private, keyboard usable and requires confirmation', async () => {
    const mock = api(), user = userEvent.setup(); render(<IngestionAssociationPanel {...props} />)
    await user.click(await screen.findByRole('button', { name: 'Choisir une autre fiche' }))
    await user.type(screen.getByRole('searchbox', { name: 'Rechercher une fiche du Codex' }), 'Épreuve privée')
    const choose = await screen.findByRole('button', { name: `Choisir la fiche : ${manual.title}` })
    choose.focus(); await user.keyboard('{Enter}')
    expect(mock.calls.filter(call => call.url.endsWith('/confirm'))).toHaveLength(0)
    const save = screen.getByRole('button', { name: 'Enregistrer l’association' }); save.focus(); await user.keyboard('{Enter}')
    await screen.findByRole('heading', { name: 'Association confirmée' })
    expect(mock.state().confirmed?.origin).toBe('MANUAL'); expect(mock.state().confirmed?.entity.id).toBe(manual.id)
    const search = mock.calls.find(call => call.url.endsWith('/entities/search'))!
    expect(search.init?.method).toBe('POST'); expect(JSON.parse(String(search.init?.body))).toEqual({ q: 'Épreuve privée' })
    expect(mock.calls.every(call => !call.url.includes('Épreuve') && !call.url.includes('q='))).toBe(true)
    expect(window.location.search).toBe(''); expect(document.title).toBe('Administration · Hesta Codex')
    expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0)
  })
  it('replacement A → B asks for confirmation and removal retains previous rejections', async () => {
    const mock = api({ ...empty(), revision: 1, confirmed: decision(), rejectedCount: 1, rejectedCandidateIds: [manual.id], recentRejections: [decision(manual)] }), user = userEvent.setup()
    render(<IngestionAssociationPanel {...props} />)
    await screen.findByRole('heading', { name: 'Association confirmée' })
    await user.click(candidate(b.title).getByRole('button', { name: 'Confirmer cette fiche' }))
    expect(screen.getByRole('heading', { name: 'Remplacer l’association confirmée ?' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Annuler' })); expect(mock.state().confirmed?.entity.id).toBe(a.id)
    await user.click(candidate(b.title).getByRole('button', { name: 'Confirmer cette fiche' }))
    await user.click(screen.getByRole('button', { name: 'Enregistrer l’association' }))
    await waitFor(() => expect(mock.state().confirmed?.entity.id).toBe(b.id))
    await user.click(await screen.findByRole('button', { name: 'Retirer l’association' }))
    expect(mock.state().confirmed?.entity.id).toBe(b.id)
    await user.click(screen.getByRole('button', { name: 'Confirmer le retrait' }))
    await screen.findByText('Aucune association confirmée.')
    expect(mock.state().confirmed).toBeNull(); expect(mock.state().rejectedCount).toBe(1)
    expect(screen.getByText('Association retirée.')).toBeTruthy()
  })
  it('manual cancellation restores focus and choosing an already confirmed Entity performs no write', async () => {
    const mock = api({ ...empty(), confirmed: decision(manual), revision: 1 }), user = userEvent.setup()
    render(<IngestionAssociationPanel {...props} />)
    await user.click(await screen.findByRole('button', { name: 'Changer l’association' }))
    await user.type(screen.getByRole('searchbox'), 'Épreuve')
    await user.click(await screen.findByRole('button', { name: `Choisir la fiche : ${manual.title}` }))
    expect(await screen.findByText('Cette fiche est déjà associée.')).toBeTruthy()
    expect(mock.calls.filter(call => call.url.endsWith('/confirm'))).toHaveLength(0)
    cleanup(); api(); render(<IngestionAssociationPanel {...props} />)
    await user.click(await screen.findByRole('button', { name: 'Choisir une autre fiche' }))
    await user.type(screen.getByRole('searchbox'), 'Épreuve')
    await user.click(await screen.findByRole('button', { name: `Choisir la fiche : ${manual.title}` }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('group', { name: 'Confirmation de la décision' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Association au Codex' }))
    const original = candidate().getByRole('button', { name: 'Confirmer cette fiche' })
    await user.click(original); await user.keyboard('{Escape}')
    expect(document.activeElement).toBe(original)
  })
  it('late matching annotation does not erase a manual search already in progress', async () => {
    api(); const user = userEvent.setup()
    const { rerender } = render(<IngestionAssociationPanel {...props} matches={{ phase: 'loading' }} />)
    await user.click(await screen.findByRole('button', { name: 'Choisir une autre fiche' }))
    await user.type(screen.getByRole('searchbox'), 'Épreuve privée')
    rerender(<IngestionAssociationPanel {...props} />)
    await screen.findByRole('button', { name: `Choisir la fiche : ${manual.title}` })
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('Épreuve privée')
  })
  it('a prepared decision keeps its original revision even if a later read observes another admin change', async () => {
    const mock = api(), user = userEvent.setup()
    const { rerender } = render(<IngestionAssociationPanel {...props} />)
    await screen.findByText('Aucune association confirmée.')
    await user.click(candidate().getByRole('button', { name: 'Confirmer cette fiche' }))
    mock.state().revision = 1; mock.state().confirmed = decision(manual)
    rerender(<IngestionAssociationPanel {...props} matches={{ phase: 'ready', data: { ...matches, candidates: [matches.candidates[0]!] } }} />)
    await screen.findByRole('heading', { name: 'Association confirmée' })
    await user.click(screen.getByRole('button', { name: 'Enregistrer l’association' }))
    await screen.findByRole('button', { name: 'Recharger les associations' })
    const sent = mock.calls.find(call => call.url.endsWith('/confirm'))!
    expect(JSON.parse(String(sent.init?.body)).expectedRevision).toBe(0)
    expect(mock.state().confirmed?.entity.id).toBe(manual.id)
  })
  it('a double click while the write is slow sends a single request', async () => {
    const mock = api(), original = fetch, writes: RequestInit[] = [], user = userEvent.setup()
    let finish!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('/confirm')) { writes.push(init!); return new Promise<Response>(resolve => { finish = resolve }) }
      return original(url, init)
    }))
    render(<IngestionAssociationPanel {...props} />); await screen.findByText('Aucune association confirmée.')
    await user.click(candidate().getByRole('button', { name: 'Confirmer cette fiche' }))
    const save = screen.getByRole('button', { name: 'Enregistrer l’association' })
    fireEvent.click(save); fireEvent.click(save); expect(writes).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Enregistrement…' }).hasAttribute('disabled')).toBe(true)
    await act(async () => { finish(response(empty())) })
    await screen.findByText('Association enregistrée.')
    expect(mock.calls.filter(call => !call.init?.method).length).toBeGreaterThan(1)
  })
  for (const status of [401, 403, 404, 409]) it(`handles association write ${status} without optimistic confirmation or private server details`, async () => {
    api(); const original = fetch, user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => url.endsWith('/confirm') ? Promise.resolve(response({ error: { message: 'Private internal fixture' } }, status)) : original(url, init)))
    render(<IngestionAssociationPanel {...props} />); await screen.findByText('Aucune association confirmée.')
    await user.click(candidate().getByRole('button', { name: 'Confirmer cette fiche' })); await user.click(screen.getByRole('button', { name: 'Enregistrer l’association' }))
    await screen.findByRole('alert')
    expect(screen.queryByText('Private internal fixture')).toBeNull(); expect(screen.queryByRole('heading', { name: 'Association confirmée' })).toBeNull()
    if (status === 401 || status === 403) { expect(props.onAccessError).toHaveBeenCalledWith(status); expect(screen.queryByText(a.title)).toBeNull() }
    else { expect(await screen.findByRole('button', { name: 'Recharger les associations' })).toBeTruthy(); expect(candidate().getByRole('button', { name: 'Confirmer cette fiche' }).hasAttribute('disabled')).toBe(true) }
  })
  for (const status of [401, 403, 404, 409]) it(`handles association read ${status} without enabling a decision`, async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({}, status)))
    render(<IngestionAssociationPanel {...props} />); await screen.findByRole('alert')
    if (status === 401 || status === 403) expect(props.onAccessError).toHaveBeenCalledWith(status)
    else expect(candidate().getByRole('button', { name: 'Confirmer cette fiche' }).hasAttribute('disabled')).toBe(true)
  })
  it('clears old identity decisions and ignores late aborted reads, including obsolete 401 responses', async () => {
    let finish!: (response: Response) => void, signal!: AbortSignal
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (url.includes(`/items/${itemId}/`)) { signal = init!.signal!; return new Promise<Response>(resolve => { finish = resolve }) }
      return Promise.resolve(response(empty()))
    }))
    const { rerender } = render(<IngestionAssociationPanel key="old" {...props} />)
    await waitFor(() => expect(signal).toBeTruthy())
    rerender(<IngestionAssociationPanel key="new" {...props} itemId={uuid(90)} receiptId={uuid(91)} />)
    await screen.findByText('Aucune association confirmée.')
    expect(signal.aborted).toBe(true)
    await act(async () => { finish(response({ ...empty(), confirmed: decision() }, 401)) })
    expect(props.onAccessError).not.toHaveBeenCalled(); expect(screen.queryByRole('heading', { name: 'Association confirmée' })).toBeNull()
  })
  it('late aborted writes after an item change cannot affect the new panel or its feedback', async () => {
    api(); const original = fetch, user = userEvent.setup()
    let finish!: (response: Response) => void, signal!: AbortSignal
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('/confirm')) { signal = init!.signal!; return new Promise<Response>(resolve => { finish = resolve }) }
      return original(url, init)
    }))
    const { rerender } = render(<IngestionAssociationPanel key="old" {...props} />)
    await screen.findByText('Aucune association confirmée.'); await user.click(candidate().getByRole('button', { name: 'Confirmer cette fiche' }))
    await user.click(screen.getByRole('button', { name: 'Enregistrer l’association' }))
    rerender(<IngestionAssociationPanel key="new" {...props} itemId={uuid(90)} receiptId={uuid(91)} />)
    await screen.findByText('Aucune association confirmée.'); expect(signal.aborted).toBe(true)
    await act(async () => { finish(response({ ...empty(), confirmed: decision() })) })
    expect(screen.queryByText('Association enregistrée.')).toBeNull(); expect(screen.queryByRole('heading', { name: 'Association confirmée' })).toBeNull()
  })
  it('archived association is explicit and removable; archived suggestions have no confirmation/rejection action', async () => {
    const archived = { ...a, status: 'ARCHIVED' as const }
    api({ ...empty(), confirmed: decision(archived), revision: 1, invalid: true })
    const data = { ...matches, candidates: [{ ...matches.candidates[0]!, ...archived }] }
    render(<IngestionAssociationPanel {...props} matches={{ phase: 'ready', data }} />)
    expect(await screen.findByText(/Association devenue invalide/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retirer l’association' }).hasAttribute('disabled')).toBe(false)
    expect(screen.queryByRole('button', { name: 'Confirmer cette fiche' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Ce n’est pas cette fiche' })).toBeNull()
  })
  it('hostile long Unicode titles remain text and links remain admin-only with no URL/history/storage/title leaks', async () => {
    const hostile = { ...a, title: '<script>alert(1)</script>Épreuve'.repeat(8), slug: 'f'.repeat(200) }
    api({ ...empty(), confirmed: decision(hostile), revision: 1 })
    const initialHistory = JSON.stringify(window.history.state)
    const { container } = render(<IngestionAssociationPanel {...props} />)
    await screen.findByRole('heading', { name: 'Association confirmée' })
    expect(container.querySelector('script, img')).toBeNull(); expect(screen.getByText(hostile.title)).toBeTruthy()
    expect(screen.getAllByRole('link').every(link => link.getAttribute('href')!.startsWith('/admin/fiches/'))).toBe(true)
    expect(document.title).toBe('Administration · Hesta Codex'); expect(window.location.search).toBe('')
    expect(JSON.stringify(window.history.state)).toBe(initialHistory); expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0)
  })
  it('manual search hides old results immediately and ignores late aborted success/error responses', async () => {
    const pending: Array<{ complete: (response: Response) => void; signal: AbortSignal }> = []
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise<Response>(complete => pending.push({ complete, signal: init!.signal! }))))
    const choose = vi.fn(), access = vi.fn(); render(<IngestionEntityPicker onChoose={choose} onAccessError={access} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Ancienne recherche' } })
    await waitFor(() => expect(pending).toHaveLength(1))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Nouvelle recherche' } })
    await waitFor(() => expect(pending).toHaveLength(2)); expect(pending[0]!.signal.aborted).toBe(true)
    await act(async () => { pending[1]!.complete(response({ items: [manual], truncated: false, limit: 20 })) })
    await screen.findByRole('button', { name: `Choisir la fiche : ${manual.title}` })
    await act(async () => { pending[0]!.complete(response({ items: [a] }, 401)) })
    expect(access).not.toHaveBeenCalled(); expect(screen.queryByText(a.title)).toBeNull()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Encore nouvelle' } })
    expect(screen.queryByText(manual.title)).toBeNull()
  })
})
