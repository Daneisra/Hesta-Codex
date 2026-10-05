import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AdminIngestionBatch, AdminIngestionItem, AdminIngestionItemDetail, IngestionMatches } from '@hesta-codex/shared'
import { AdminIngestion } from './AdminIngestion'
import { App } from './App'

const id = '11111111-1111-4111-8111-111111111111', previousId = '22222222-2222-4222-8222-222222222222'
const batch: AdminIngestionBatch = { id, label: 'Lot technique fictif', createdAt: '2026-10-04T00:00:00Z', formatVersion: 1,
  receivedCount: 2, newCount: 1, unchangedCount: 0, modifiedCount: 1, warningCount: 0, sourceCount: 1,
  sourceKinds: ['OBSIDIAN'], sources: [{ id, kind: 'OBSIDIAN', label: 'Origine artificielle' }] }
const item: AdminIngestionItem = { id, itemId: id, batchId: id, ordinal: 0, title: 'Fragment technique', externalId: 'fictional.md', locator: 'notes/fictional.md',
  contentType: 'text/markdown', outcome: 'MODIFIED', version: 2, contentHash: 'a'.repeat(64), source: batch.sources[0]!, observedAt: null, ingestedAt: batch.createdAt }
const detail: AdminIngestionItemDetail = { ...item, content: '<script>alert(1)</script>\nTexte fictif ' + 'contenu-long'.repeat(2000),
  metadata: { fictional: true, description: 'm'.repeat(4000) }, originBatchId: id, snapshotIngestedAt: batch.createdAt,
  versions: [{ id, version: 2, contentHash: item.contentHash, ingestedAt: item.ingestedAt }, { id: previousId, version: 1, contentHash: 'b'.repeat(64), ingestedAt: item.ingestedAt }] }
const response = (data: unknown, status = 200) => ({ ok: status === 200, status, json: async () => data }) as Response
const matched = (title: string): IngestionMatches => ({ status: 'EXACT', searchTruncated: false, candidatesTruncated: false,
  evaluatedCount: 1, exactCandidateCount: 1, strongCandidateCount: 1, approximateEvaluatedCount: 0, searchLimit: 200, candidateLimit: 10,
  candidates: [{ id, slug: 'fiche-fictive', title, kind: 'OTHER', placeKind: null, aliases: [], status: 'DRAFT', visibility: 'SECRET', score: 90, reasons: ['EXACT_TITLE'] }] })
function api(options: { status?: number; empty?: boolean; session?: 'admin' | 'anonymous' | 'denied' } = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); calls.push({ url, init })
    if (url === '/api/auth/session') return response(options.session === 'anonymous' ? { authenticated: false, isAdmin: false, user: null }
      : { authenticated: true, isAdmin: options.session !== 'denied', user: { username: 'test', displayName: null } })
    if (url === '/api/admin/stats') return response({ byStatus: {}, byVisibility: {}, sources: 0, relations: 0 })
    if (url.includes('/api/admin/ingestion')) {
      if (options.status) return response({}, options.status)
      const parsed = new URL(url, 'http://localhost')
      if (parsed.pathname.endsWith('/matches')) return response({ status: 'NONE', candidates: [], searchTruncated: false, candidatesTruncated: false, evaluatedCount: 0, searchLimit: 200, candidateLimit: 10 })
      if (parsed.pathname === '/api/admin/ingestion/batches') return response({ items: options.empty ? [] : [batch], total: options.empty ? 0 : 25, page: Number(parsed.searchParams.get('page') ?? 1), pageSize: 20 })
      if (parsed.pathname === `/api/admin/ingestion/batches/${id}`) return response(batch)
      if (parsed.pathname === '/api/admin/ingestion/items') return response({ items: [item], total: 1, page: 1, pageSize: 20 })
      if (parsed.pathname.endsWith(`/${previousId}`)) return response({ ...detail, itemId: previousId, version: 1, content: 'Ancienne version fictive' })
      if (parsed.pathname.endsWith(`/${id}`)) return response(detail)
    }
    return response({}, 404)
  }))
  return calls
}
beforeEach(() => window.history.replaceState(null, '', '/admin/ingestion'))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/') })

describe('consultation privée du staging', () => {
  it('never displays stale matches when switching receipts for the same snapshot, even when the aborted response resolves last', async () => {
    api(); const originalFetch = fetch, user = userEvent.setup(), access = vi.fn()
    const pending: Array<{ url: string; init?: RequestInit; complete: (value: Response) => void }> = []
    const otherReceipt = { ...item, id: previousId, title: 'Autre réception fictive', ordinal: 1 }
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const parsed = new URL(url, 'http://localhost')
      if (parsed.pathname.endsWith('/matches')) return new Promise<Response>(complete => pending.push({ url, init, complete }))
      if (parsed.pathname === '/api/admin/ingestion/items') return Promise.resolve(response({ items: [item, otherReceipt], page: 1, pageSize: 20, total: 2 }))
      if (parsed.pathname === `/api/admin/ingestion/items/${id}` && parsed.searchParams.get('receiptId') === previousId)
        return Promise.resolve(response({ ...detail, ...otherReceipt }))
      return originalFetch(url, init)
    }))
    render(<AdminIngestion onAccessError={access} />)
    await user.click(await screen.findByRole('button', { name: batch.label }))
    await user.click(await screen.findByRole('button', { name: item.title! }))
    await waitFor(() => expect(pending).toHaveLength(1))
    await user.click(screen.getByRole('button', { name: '← Retour au batch' }))
    await user.click(await screen.findByRole('button', { name: otherReceipt.title! }))
    await waitFor(() => expect(pending).toHaveLength(2))
    expect(pending[0]!.init!.signal!.aborted).toBe(true)
    expect(pending[1]!.url).toBe(`/api/admin/ingestion/items/${id}/matches?receiptId=${previousId}`)
    await act(async () => { pending[1]!.complete(response(matched('Candidat de la nouvelle réception'))) })
    await screen.findByRole('heading', { name: 'Candidat de la nouvelle réception' })
    await act(async () => { pending[0]!.complete(response(matched('Candidat obsolète interdit'))) })
    expect(screen.queryByText('Candidat obsolète interdit')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Candidat de la nouvelle réception' })).toBeTruthy()
    expect(access).not.toHaveBeenCalled()
  })
  it('clears the previous item matches during a version request and ignores an obsolete 401 response', async () => {
    api(); const originalFetch = fetch, user = userEvent.setup(), access = vi.fn()
    const pending: Array<{ url: string; init?: RequestInit; complete: (value: Response) => void }> = []
    let finishDetail!: (value: Response) => void
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const path = new URL(url, 'http://localhost').pathname
      if (path.endsWith('/matches')) return new Promise<Response>(complete => pending.push({ url, init, complete }))
      if (path === `/api/admin/ingestion/items/${previousId}`) return new Promise<Response>(complete => { finishDetail = complete })
      return originalFetch(url, init)
    }))
    render(<AdminIngestion onAccessError={access} />)
    await user.click(await screen.findByRole('button', { name: batch.label }))
    await user.click(await screen.findByRole('button', { name: item.title! }))
    await waitFor(() => expect(pending).toHaveLength(1))
    await act(async () => { pending[0]!.complete(response(matched('Candidat de version deux'))) })
    await screen.findByRole('heading', { name: 'Candidat de version deux' })
    await user.click(screen.getByRole('button', { name: /^Version 1/ }))
    expect(screen.queryByText('Candidat de version deux')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Correspondances dans le Codex' })).toBeNull()
    await act(async () => { finishDetail(response({ ...detail, id: previousId, itemId: previousId, version: 1 })) })
    await waitFor(() => expect(pending).toHaveLength(2))
    expect(pending[1]!.url).toBe(`/api/admin/ingestion/items/${previousId}/matches?receiptId=${previousId}`)
    await user.click(screen.getByRole('button', { name: '← Retour au batch' }))
    await user.click(await screen.findByRole('button', { name: item.title! }))
    await waitFor(() => expect(pending).toHaveLength(3))
    await act(async () => { pending[2]!.complete(response(matched('Candidat final fictif'))) })
    await screen.findByRole('heading', { name: 'Candidat final fictif' })
    await act(async () => { pending[1]!.complete(response({}, 401)) })
    expect(access).not.toHaveBeenCalled(); expect(screen.getByRole('heading', { name: 'Candidat final fictif' })).toBeTruthy()
  })
  it('loads matches for the receipt actually displayed with admin no-store requests and clears them on return', async () => {
    const calls = api(), user = userEvent.setup()
    render(<AdminIngestion onAccessError={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: batch.label }))
    await user.click(await screen.findByRole('button', { name: item.title! }))
    expect(await screen.findByText('Aucune fiche correspondante détectée')).toBeTruthy()
    expect(calls.find(call => call.url.includes('/matches'))?.url).toBe(`/api/admin/ingestion/items/${id}/matches?receiptId=${id}`)
    await user.click(screen.getByRole('button', { name: '← Retour au batch' }))
    expect(screen.queryByRole('region', { name: 'Correspondances dans le Codex' })).toBeNull()
    expect(window.location.search).toBe(''); expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0)
  })
  it('retries a matching failure independently of raw detail and reports matching-only access errors', async () => {
    const calls = api(), originalFetch = fetch, access = vi.fn(), user = userEvent.setup()
    let status = 500
    const matchingCalls: RequestInit[] = []
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (url.includes('/matches')) { matchingCalls.push(init!); return Promise.resolve(response({}, status)) }
      return originalFetch(url, init)
    }))
    render(<AdminIngestion onAccessError={access} />)
    await user.click(await screen.findByRole('button', { name: batch.label }))
    await user.click(await screen.findByRole('button', { name: item.title! }))
    expect(await screen.findByText('Impossible de charger les correspondances.')).toBeTruthy()
    const detailReads = calls.filter(call => call.url.startsWith(`/api/admin/ingestion/items/${id}?`)).length
    for (status of [401, 403]) {
      await user.click(screen.getByRole('button', { name: 'Réessayer les correspondances' }))
      await waitFor(() => expect(access).toHaveBeenCalledWith(status))
      expect(screen.getByRole('region', { name: 'Contenu brut reçu' }).textContent).toBe(detail.content)
    }
    expect(calls.filter(call => call.url.startsWith(`/api/admin/ingestion/items/${id}?`))).toHaveLength(detailReads)
    expect(matchingCalls.every(init => !init.method && init.cache === 'no-store' && init.credentials === 'same-origin')).toBe(true)
  })
  it('lists batches, opens a batch/item and versions with keyboard focus and no editorial mutations', async () => {
    const calls = api(), user = userEvent.setup()
    render(<AdminIngestion onAccessError={vi.fn()} />)
    const open = await screen.findByRole('button', { name: batch.label })
    open.focus(); await user.keyboard('{Enter}')
    expect(await screen.findByRole('heading', { name: batch.label })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Ingestion' }))
    await user.click(await screen.findByRole('button', { name: item.title! }))
    expect(await screen.findByRole('region', { name: 'Contenu brut reçu' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Contenu brut reçu' }).textContent).toBe(detail.content)
    expect(screen.getByText(detail.contentHash)).toBeTruthy()
    expect(document.querySelector('.ingestion-page script, .ingestion-page img')).toBeNull()
    expect(screen.queryByRole('button', { name: /Publier|Créer la fiche|Fusionner|Créer la relation/ })).toBeNull()
    await user.click(screen.getByText('Metadata de cette réception'))
    expect(screen.getByRole('region', { name: 'Metadata de réception' }).textContent).toContain('fictional')
    await user.click(screen.getByRole('button', { name: /^Version 1/ }))
    expect(await screen.findByText('Ancienne version fictive')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '← Retour au batch' }))
    expect(await screen.findByRole('heading', { name: batch.label })).toBeTruthy()
    expect(window.location.href).not.toMatch(/fictional|contenu-long|fragment|notes/)
    expect(calls.every(call => !call.init?.method && call.init?.cache === 'no-store' && call.init?.credentials === 'same-origin')).toBe(true)
  })

  it('paginates and filters by SourceKind, Source UUID, outcome, dates and title/identifier/locator only', async () => {
    const calls = api(), user = userEvent.setup()
    render(<AdminIngestion onAccessError={vi.fn()} />)
    await screen.findByRole('button', { name: batch.label })
    await user.click(screen.getByRole('button', { name: 'Suivant' }))
    await waitFor(() => expect(calls.at(-1)?.url).toContain('page=2'))
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Ingestion' }))
    await new Promise(resolve => setTimeout(resolve, 400))
    expect(calls.at(-1)?.url).toContain('page=2') // The initial search debounce must not undo pagination.
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type de Source' }), 'OBSIDIAN')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Résultat' }), 'MODIFIED')
    await user.type(screen.getByRole('searchbox'), 'fictional')
    await waitFor(() => expect((calls.at(-1)?.init?.headers as Record<string, string>)['X-Hesta-Ingestion-Search']).toBe('fictional'))
    expect(calls.every(call => !call.url.includes('q=') && !call.url.includes('fictional'))).toBe(true)
    expect(calls.at(-1)?.url).toContain('sourceKind=OBSIDIAN')
    expect(calls.at(-1)?.url).toContain('outcome=MODIFIED')
    await user.clear(screen.getByRole('searchbox')); await user.type(screen.getByRole('searchbox'), 'origine œ é')
    await waitFor(() => expect((calls.at(-1)?.init?.headers as Record<string, string>)['X-Hesta-Ingestion-Search']).toBe(encodeURIComponent('origine œ é')))
    expect(window.location.search).toBe('')
    await user.type(screen.getByRole('textbox', { name: 'UUID de Source' }), 'invalid')
    expect(screen.getByRole('alert').textContent).toBe('UUID de Source invalide.')
    await user.click(screen.getByRole('button', { name: 'Réinitialiser les filtres' }))
    await waitFor(() => expect(calls.at(-1)?.url).toBe('/api/admin/ingestion/batches?page=1'))
  })

  it('shows empty/error states, retries safely and reports expired/forbidden access', async () => {
    api({ empty: true }); const onAccessError = vi.fn(), user = userEvent.setup()
    render(<AdminIngestion onAccessError={onAccessError} />)
    expect(await screen.findByText('Aucun batch pour ces filtres.')).toBeTruthy()
    cleanup()
    const calls = api({ status: 500 })
    render(<AdminIngestion onAccessError={onAccessError} />)
    expect(await screen.findByRole('alert')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Réessayer' }))
    await waitFor(() => expect(calls.length).toBe(2))
    cleanup(); api({ status: 404 }); render(<AdminIngestion onAccessError={onAccessError} />)
    expect(await screen.findByText('Élément introuvable.')).toBeTruthy()
    for (const status of [401, 403]) {
      cleanup(); api({ status }); render(<AdminIngestion onAccessError={onAccessError} />)
      await waitFor(() => expect(onAccessError).toHaveBeenCalledWith(status))
      expect(screen.queryByRole('region', { name: 'Contenu brut reçu' })).toBeNull()
    }
  })

  it('restores batch/item navigation with browser back/forward without persisting private information', async () => {
    api(); const user = userEvent.setup()
    render(<AdminIngestion onAccessError={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: batch.label }))
    await user.click(await screen.findByRole('button', { name: item.title! }))
    expect(await screen.findByRole('region', { name: 'Contenu brut reçu' })).toBeTruthy()
    expect(Object.keys(window.history.state)).toEqual(['ingestionNavigation'])
    expect(JSON.stringify(window.history.state)).not.toMatch(/fictional|Fragment|private|11111111|notes|alert/)
    await act(async () => { window.history.back(); await new Promise(resolve => setTimeout(resolve, 40)) })
    expect(await screen.findByRole('button', { name: item.title! })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Contenu brut reçu' })).toBeNull()
    await act(async () => { window.history.forward(); await new Promise(resolve => setTimeout(resolve, 40)) })
    expect(await screen.findByRole('region', { name: 'Contenu brut reçu' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Ingestion' }))
    expect(window.location.pathname).toBe('/admin/ingestion'); expect(window.location.search).toBe('')
    expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0)
  })

  it('applies UTC date bounds and prevents invalid ranges from sending requests', async () => {
    const calls = api()
    render(<AdminIngestion onAccessError={vi.fn()} />)
    await screen.findByRole('button', { name: batch.label })
    fireEvent.change(screen.getByLabelText('Depuis (UTC)'), { target: { value: '2026-10-01' } })
    fireEvent.change(screen.getByLabelText('Jusqu’au (UTC)'), { target: { value: '2026-10-04' } })
    await waitFor(() => expect(calls.at(-1)?.url).toContain('before=2026-10-04T23%3A59%3A59.999Z'))
    expect(calls.at(-1)?.url).toContain('after=2026-10-01T00%3A00%3A00.000Z')
    const before = calls.length
    fireEvent.change(screen.getByLabelText('Depuis (UTC)'), { target: { value: '2026-10-05' } })
    expect(screen.getByRole('alert').textContent).toBe('Intervalle de dates invalide.')
    expect(calls.length).toBe(before)
    fireEvent.change(screen.getByLabelText('Depuis (UTC)'), { target: { value: '2026-10-01' } })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '\ud800abc' } })
    expect(await screen.findByText('Recherche Unicode invalide.')).toBeTruthy()
  })

  it('never briefly redisplays a previous raw detail before a fresh request completes', async () => {
    api(); const user = userEvent.setup()
    render(<AdminIngestion onAccessError={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: batch.label }))
    await user.click(await screen.findByRole('button', { name: item.title! }))
    await screen.findByRole('region', { name: 'Contenu brut reçu' })
    await user.click(screen.getByRole('button', { name: '← Retour au batch' }))
    await screen.findByRole('button', { name: item.title! })
    const originalFetch = fetch
    let complete!: (value: Response) => void
    const pending = new Promise<Response>(resolve => { complete = resolve })
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => new URL(url, 'http://localhost').pathname === `/api/admin/ingestion/items/${id}` ? pending : originalFetch(url, init)))
    let staleContentInserted = false
    const observer = new MutationObserver(records => {
      if (records.some(record => [...record.addedNodes].some(node => node instanceof Element && (node.matches('.ingestion-raw') || node.querySelector('.ingestion-raw'))))) staleContentInserted = true
    })
    observer.observe(document.body, { childList: true, subtree: true })
    await user.click(screen.getByRole('button', { name: item.title! }))
    expect(screen.queryByRole('region', { name: 'Contenu brut reçu' })).toBeNull()
    expect(staleContentInserted).toBe(false)
    observer.disconnect()
    await act(async () => { complete(response(detail)) })
    expect(await screen.findByRole('region', { name: 'Contenu brut reçu' })).toBeTruthy()
  })

  it('gates the direct admin route and links ingestion from the existing dashboard', async () => {
    const anonymous = api({ session: 'anonymous' }); render(<App />)
    expect(await screen.findByRole('link', { name: 'Se connecter avec Discord' })).toBeTruthy()
    expect(anonymous.some(call => call.url.includes('/ingestion/'))).toBe(false)
    cleanup(); const denied = api({ session: 'denied' }); render(<App />)
    expect(await screen.findByRole('heading', { name: 'Accès refusé' })).toBeTruthy()
    expect(denied.some(call => call.url.includes('/ingestion/'))).toBe(false)
    cleanup(); api(); render(<App />)
    expect(await screen.findByRole('button', { name: batch.label }, { timeout: 8000 })).toBeTruthy()
    expect(document.title).toBe('Administration · Hesta Codex')
    cleanup(); window.history.replaceState(null, '', '/admin'); api(); render(<App />)
    const link = await screen.findByRole('link', { name: 'Ingestion' })
    expect(link.getAttribute('href')).toBe('/admin/ingestion')
    expect(within(screen.getByRole('main')).queryByRole('button', { name: /Publier/ })).toBeNull()
  }, 15000)
})
