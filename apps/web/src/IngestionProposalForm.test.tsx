import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { IngestionProposalCreated, IngestionProposalPreparation } from '@hesta-codex/shared'
import { IngestionProposalForm } from './IngestionProposalForm'
import { IngestionAssociationPanel } from './IngestionAssociationPanel'

const itemId = '00000000-0000-4000-8000-000000000001', receiptId = '00000000-0000-4000-8000-000000000002'
const prepared: IngestionProposalPreparation = { receiptId, expectedRevision: 7, title: 'Épreuve technique', bodyMarkdown: '<script>alert(1)</script>\nTexte fictif',
  tags: ['test, intact', 'épreuve'], sourceExcerpt: 'Extrait fictif', locator: 'fixture.md', warnings: [], source: { label: 'Source fictive', kind: 'OBSIDIAN', visibility: 'SECRET' } }
const created: IngestionProposalCreated = { entity: { id: receiptId, slug: 'epreuve-technique', title: prepared.title, kind: 'PERSON', placeKind: null, status: 'PROPOSED', visibility: 'GM' } }
const props = { itemId, receiptId, onCancel: vi.fn(), onCreated: vi.fn(), onAccessError: vi.fn() }
const response = (data: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data }) as Response
function api(options: { readStatus?: number; writeStatus?: number; code?: string; prepare?: IngestionProposalPreparation } = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return init?.method ? response(options.writeStatus ? { error: { code: options.code, message: 'Private server detail', issues: [{ path: 'entity.title', message: 'Titre invalide.' }] } } : created, options.writeStatus ?? 201) :
      response(options.prepare ?? prepared, options.readStatus ?? 200)
  }))
  return calls
}
beforeEach(() => { vi.clearAllMocks(); window.history.replaceState(null, '', '/admin/ingestion'); document.title = 'Administration · Hesta Codex'; localStorage.clear(); sessionStorage.clear() })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/') })
async function review(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('heading', { name: 'Préparer une fiche depuis le staging' })
  await user.selectOptions(screen.getByLabelText('Type de fiche'), 'PERSON')
  await user.type(screen.getByLabelText('Énoncé de provenance'), 'Énoncé humain fictif')
  await user.click(screen.getByRole('button', { name: 'Vérifier la création' }))
  await screen.findByRole('heading', { name: 'Vérifier la fiche proposée' })
}
describe('création humaine depuis le staging', () => {
  it('prefills only safe fields, requires an explicit type and provenance statement, and never writes while preparing', async () => {
    const calls = api(), user = userEvent.setup(); render(<IngestionProposalForm {...props} />)
    expect(await screen.findByDisplayValue(prepared.title)).toBeTruthy()
    expect((screen.getByLabelText('Résumé') as HTMLTextAreaElement).value).toBe('')
    expect((screen.getByLabelText('Visibilité') as HTMLSelectElement).value).toBe('GM')
    expect((screen.getByLabelText('Contenu Markdown') as HTMLTextAreaElement).value).toBe(prepared.bodyMarkdown)
    expect((screen.getByLabelText('Tag 1') as HTMLInputElement).value).toBe('test, intact')
    await user.click(screen.getByRole('button', { name: 'Vérifier la création' }))
    expect(screen.getByText('Choisissez explicitement un type.')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText('Type de fiche'))
    expect(calls.every(call => !call.init?.method)).toBe(true); expect(props.onCreated).not.toHaveBeenCalled()
  })
  it('requires PLACE subtype and retains an explicitly edited slug when the title changes', async () => {
    api(); const user = userEvent.setup(); render(<IngestionProposalForm {...props} />)
    await screen.findByDisplayValue(prepared.title)
    await user.selectOptions(screen.getByLabelText('Type de fiche'), 'PLACE')
    await user.type(screen.getByLabelText('Énoncé de provenance'), 'Énoncé fictif')
    await user.clear(screen.getByLabelText('Slug')); await user.type(screen.getByLabelText('Slug'), 'slug-choisi')
    await user.clear(screen.getByLabelText('Titre')); await user.type(screen.getByLabelText('Titre'), 'Titre changé')
    await user.click(screen.getByRole('button', { name: 'Vérifier la création' }))
    expect(screen.getByText('Choisissez le sous-type de lieu.')).toBeTruthy()
    await user.selectOptions(screen.getByLabelText('Sous-type de lieu'), 'CITY')
    await user.click(screen.getByRole('button', { name: 'Vérifier la création' }))
    expect(screen.getByText(/Titre changé · slug-choisi · PLACE · CITY/)).toBeTruthy()
  })
  it('keyboard review/final action sends a strict request with frozen revision, no publication/actor/Source fields or private URL/storage', async () => {
    const calls = api(), user = userEvent.setup(); const { container } = render(<IngestionProposalForm {...props} />)
    await review(user)
    expect(calls.filter(call => call.init?.method)).toHaveLength(0)
    const save = screen.getByRole('button', { name: 'Créer la fiche proposée' }); save.focus(); await user.keyboard('{Enter}')
    await waitFor(() => expect(props.onCreated).toHaveBeenCalledWith(created))
    const write = calls.find(call => call.init?.method)!, payload = JSON.parse(String(write.init?.body))
    expect(payload.expectedRevision).toBe(7); expect(payload.receiptId).toBe(receiptId)
    expect(payload.entity.tags).toEqual(prepared.tags); expect(payload.entity.visibility).toBe('GM')
    expect(payload.evidence.claimText).toBe('Énoncé humain fictif')
    expect(JSON.stringify(payload)).not.toMatch(/status|publishedAt|sourceId|authorDiscordId|editorLabel/)
    expect(write.url).toBe(`/api/admin/ingestion/items/${itemId}/proposal`)
    expect(write.init?.credentials).toBe('same-origin'); expect(write.init?.cache).toBe('no-store')
    expect(container.querySelector('script, img')).toBeNull(); expect(window.location.search).toBe('')
    expect(document.title).toBe('Administration · Hesta Codex'); expect(window.history.state).toBeNull()
    expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0)
  })
  it('cancel/correct retains the draft and creates nothing', async () => {
    const calls = api(), user = userEvent.setup(); render(<IngestionProposalForm {...props} />); await review(user)
    await user.click(screen.getByRole('button', { name: 'Corriger' }))
    expect(screen.getByDisplayValue('Énoncé humain fictif')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Retour vers l’item' }))
    expect(props.onCancel).toHaveBeenCalledOnce(); expect(calls.filter(call => call.init?.method)).toHaveLength(0)
  })
  it('a slow double submission produces only one POST and no optimistic successful callback', async () => {
    api(); const original = fetch, user = userEvent.setup(); let complete!: (value: Response) => void
    const writes: RequestInit[] = []
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (init?.method) { writes.push(init); return new Promise<Response>(resolve => { complete = resolve }) }
      return original(url, init)
    }))
    render(<IngestionProposalForm {...props} />); await review(user)
    const save = screen.getByRole('button', { name: 'Créer la fiche proposée' }); fireEvent.click(save); fireEvent.click(save)
    expect(writes).toHaveLength(1); expect(props.onCreated).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Création…' }).hasAttribute('disabled')).toBe(true)
    await act(async () => { complete(response(created, 201)) }); expect(props.onCreated).toHaveBeenCalledOnce()
  })
  it('slug conflict is recoverable and keeps all input; correction resubmits only after a new review', async () => {
    api({ writeStatus: 409, code: 'ENTITY_CONFLICT' }); const user = userEvent.setup(); render(<IngestionProposalForm {...props} />); await review(user)
    await user.click(screen.getByRole('button', { name: 'Créer la fiche proposée' }))
    expect(await screen.findByText('Ce slug est déjà utilisé. Choisissez-en un autre.')).toBeTruthy()
    expect(screen.getByDisplayValue('Énoncé humain fictif')).toBeTruthy(); expect(props.onCreated).not.toHaveBeenCalled()
    api(); await user.clear(screen.getByLabelText('Slug')); await user.type(screen.getByLabelText('Slug'), 'autre-slug')
    await user.click(screen.getByRole('button', { name: 'Vérifier la création' })); await user.click(screen.getByRole('button', { name: 'Créer la fiche proposée' }))
    await waitFor(() => expect(props.onCreated).toHaveBeenCalledOnce())
  })
  it('correcting a rejected title clears the stale server error before another review', async () => {
    api({ writeStatus: 400 }); const user = userEvent.setup(); render(<IngestionProposalForm {...props} />); await review(user)
    await user.click(screen.getByRole('button', { name: 'Créer la fiche proposée' }))
    await screen.findByRole('alert')
    expect(screen.getByLabelText('Titre').getAttribute('aria-describedby')).toBe('proposal-error-entity.title')
    await user.clear(screen.getByLabelText('Titre')); await user.type(screen.getByLabelText('Titre'), 'Titre corrigé')
    expect(screen.queryByRole('alert')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Vérifier la création' }))
    expect(screen.queryByRole('alert')).toBeNull(); expect(props.onCreated).not.toHaveBeenCalled()
  })
  it('an oversized HTTP request remains editable without losing the draft or retrying automatically', async () => {
    const calls = api({ writeStatus: 413 }), user = userEvent.setup(); render(<IngestionProposalForm {...props} />); await review(user)
    await user.click(screen.getByRole('button', { name: 'Créer la fiche proposée' }))
    await screen.findByRole('alert')
    expect(screen.getByLabelText('Contenu Markdown').hasAttribute('disabled')).toBe(false)
    expect(screen.getByDisplayValue('Énoncé humain fictif')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toMatch(/volumineuse/)
    expect(calls.filter(call => call.init?.method)).toHaveLength(1)
    api(); await user.clear(screen.getByLabelText('Extrait de la Source'))
    await user.click(screen.getByRole('button', { name: 'Vérifier la création' })); await user.click(screen.getByRole('button', { name: 'Créer la fiche proposée' }))
    await waitFor(() => expect(props.onCreated).toHaveBeenCalledOnce())
  })
  for (const status of [400, 401, 403, 404, 409, 500]) it(`handles creation ${status} with no optimistic success, no private error and appropriate retry policy`, async () => {
    api({ writeStatus: status, code: 'ASSOCIATION_CONFLICT' }); const user = userEvent.setup(); render(<IngestionProposalForm {...props} />); await review(user)
    await user.click(screen.getByRole('button', { name: 'Créer la fiche proposée' }))
    if (status === 401 || status === 403) {
      await waitFor(() => expect(props.onAccessError).toHaveBeenCalledWith(status)); expect(screen.queryByDisplayValue(prepared.title)).toBeNull()
    } else {
      await screen.findByRole('alert'); expect(screen.queryByText('Private server detail')).toBeNull()
      if (status === 400) expect(screen.getByDisplayValue('Énoncé humain fictif')).toBeTruthy()
      else expect(screen.getByRole('button', { name: 'Créer la fiche proposée' }).hasAttribute('disabled')).toBe(true)
    }
    expect(props.onCreated).not.toHaveBeenCalled()
  })
  for (const status of [401, 403, 404, 409]) it(`handles preparation ${status} without exposing a writable form`, async () => {
    api({ readStatus: status }); render(<IngestionProposalForm {...props} />)
    await screen.findByRole('alert'); expect(screen.queryByLabelText('Titre')).toBeNull()
    if (status === 401 || status === 403) expect(props.onAccessError).toHaveBeenCalledWith(status)
  })
  it('unmount after browser/item navigation aborts the write and ignores a late successful response', async () => {
    api(); const original = fetch, user = userEvent.setup(); let finish!: (value: Response) => void, signal!: AbortSignal
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (init?.method) { signal = init.signal!; return new Promise<Response>(resolve => { finish = resolve }) }
      return original(url, init)
    }))
    const { unmount } = render(<IngestionProposalForm {...props} />); await review(user)
    await user.click(screen.getByRole('button', { name: 'Créer la fiche proposée' })); unmount(); expect(signal.aborted).toBe(true)
    await act(async () => { finish(response(created, 201)) }); expect(props.onCreated).not.toHaveBeenCalled()
  })
  it('large content is preserved for explicit correction; preparation warnings do not become silent truncation', async () => {
    const long = { ...prepared, title: 'x'.repeat(201), bodyMarkdown: 'y'.repeat(100_001), warnings: ['Corrigez les limites éditoriales.'] }
    api({ prepare: long }); render(<IngestionProposalForm {...props} />)
    await screen.findByLabelText('Titre')
    expect((screen.getByLabelText('Titre') as HTMLInputElement).value.length).toBe(201)
    expect((screen.getByLabelText('Contenu Markdown') as HTMLTextAreaElement).value.length).toBe(100_001)
    expect(screen.getByText(long.warnings[0]!)).toBeTruthy()
  })
  it('creation is available only after an unassociated state loads; a confirmed identity explains its unavailability', async () => {
    const empty = { revision: 0, scope: 'EXTERNAL_ID', confirmed: null, invalid: false, rejectedCount: 0, recentRejections: [], rejectedCandidateIds: [] }
    vi.stubGlobal('fetch', vi.fn(async () => response(empty)))
    const panel = { ...props, matches: { phase: 'loading' as const }, onRetryMatches: vi.fn(), onPrepare: vi.fn() }
    const { rerender } = render(<IngestionAssociationPanel {...panel} />)
    expect(screen.queryByRole('button', { name: 'Créer une fiche dans le Codex' })).toBeNull()
    await screen.findByRole('button', { name: 'Créer une fiche dans le Codex' })
    vi.stubGlobal('fetch', vi.fn(async () => response({ ...empty, confirmed: { entity: created.entity, origin: 'MANUAL', authorLabel: 'Admin technique', decidedAt: '2026-10-06T10:00:00Z' } })))
    rerender(<IngestionAssociationPanel key="new" {...panel} />)
    await screen.findByText(/Cette identité possède déjà une fiche/)
    expect(screen.queryByRole('button', { name: 'Créer une fiche dans le Codex' })).toBeNull()
  })
})
