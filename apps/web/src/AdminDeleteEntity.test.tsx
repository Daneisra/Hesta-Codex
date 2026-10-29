import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AdminEntityDetail, AdminEntityDeletionPlan } from '@hesta-codex/shared'
import { AdminDeleteEntity } from './AdminDeleteEntity'
import { App } from './App'

const entity: AdminEntityDetail = { id: '00000000-0000-4000-8000-000000000001', slug: 'cible', title: 'Cible fictive',
  kind: 'CONCEPT', placeKind: null, summary: null, bodyMarkdown: '', aliases: [], tags: [], status: 'PUBLISHED', visibility: 'PUBLIC',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', publishedAt: '2026-01-01T00:00:00Z',
  evidence: [], revisions: [], incomingRelations: [], outgoingRelations: [] }
const plan: AdminEntityDeletionPlan = { id: entity.id, slug: entity.slug, title: entity.title, status: entity.status,
  fingerprint: 'a'.repeat(64), counts: { relations: 3, directEvidence: 1, relationEvidence: 3, revisions: 1,
    associationDecisions: 2, associations: 2, referenceIgnores: 3, images: 0 } }
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response
function setup(options: { previewStatus?: number; deleteStatus?: number | 'network'; delayed?: Promise<void>; preview?: AdminEntityDeletionPlan } = {}) {
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'DELETE') {
      await options.delayed
      if (options.deleteStatus === 'network') throw new Error('Réponse perdue')
      return response(null, options.deleteStatus ?? 204)
    }
    return response(options.preview ?? plan, options.previewStatus ?? 200)
  })
  vi.stubGlobal('fetch', fetcher)
  const onDeleted = vi.fn(), onPending = vi.fn(), onAccessError = vi.fn()
  render(<AdminDeleteEntity entity={entity} disabled={false} onDeleted={onDeleted} onPending={onPending} onAccessError={onAccessError} />)
  return { fetcher, onDeleted, onPending, onAccessError }
}
async function confirm() {
  fireEvent.click(screen.getByRole('button', { name: 'Supprimer la fiche' }))
  await screen.findByRole('checkbox', { name: /Je confirme la suppression/ })
  fireEvent.click(screen.getByRole('checkbox', { name: /Je confirme la suppression/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Supprimer définitivement' }))
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/') })

describe('suppression individuelle administrateur', () => {
  it('charge le bilan seulement au clic, expose les dépendances et protège les Sources/staging sans confirmer automatiquement', async () => {
    const { fetcher } = setup()
    expect(fetcher).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer la fiche' }))
    await screen.findByRole('checkbox', { name: /Je confirme la suppression/ })
    expect(screen.getByRole('dialog', { name: 'Supprimer définitivement « Cible fictive » ?' })).toBeTruthy()
    expect(screen.getByText(/3 relation\(s\)/)).toBeTruthy()
    expect(screen.getByText(/4 preuve\(s\)/)).toBeTruthy()
    expect(screen.getByText(/2 décision\(s\) d’association/)).toBeTruthy()
    expect(screen.getByText(/Cette fiche est publiée/)).toBeTruthy()
    expect(screen.getByText(/Markdown originaux du staging seront conservés/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Supprimer définitivement' })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Supprimer la fiche' }))
  })

  it('exige la case puis un clic explicite, bloque le double clic et Escape pendant la requête', async () => {
    let complete!: () => void
    const delayed = new Promise<void>(resolve => { complete = resolve })
    const { fetcher, onDeleted, onPending } = setup({ delayed })
    await confirm()
    const dialog = screen.getByRole('dialog'), button = screen.getByRole('button', { name: 'Suppression…' })
    fireEvent.click(button); fireEvent(dialog, new Event('cancel', { cancelable: true }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Annuler' })).toHaveProperty('disabled', true)
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1)
    const mutation = fetcher.mock.calls.find(([, init]) => init?.method === 'DELETE')!
    expect(mutation[1]).toMatchObject({ credentials: 'same-origin', cache: 'no-store' })
    expect(JSON.parse(String(mutation[1]?.body))).toEqual({ entityId: entity.id, fingerprint: plan.fingerprint, confirm: true })
    expect(onDeleted).not.toHaveBeenCalled(); complete()
    await waitFor(() => expect(onDeleted).toHaveBeenCalledExactlyOnceWith(entity.title))
    expect(onPending.mock.calls).toEqual([[true], [false]])
  })

  it('Échap annule la confirmation sans écrire', async () => {
    const { fetcher } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer la fiche' }))
    await screen.findByRole('checkbox', { name: /Je confirme/ })
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
  })

  it.each([401, 403, 404, 500])('un bilan refusé (%s) ne permet aucune suppression', async previewStatus => {
    const { onAccessError, fetcher } = setup({ previewStatus })
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer la fiche' }))
    await screen.findByRole('alert')
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByRole('button', { name: 'Supprimer définitivement' })).toHaveProperty('disabled', true)
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
    if (previewStatus < 404) expect(onAccessError).toHaveBeenCalledWith(previewStatus)
  })

  it.each([401, 403, 404, 409, 500, 'network'] as const)('un échec DELETE (%s) conserve une issue explicite et exige un nouveau bilan et une nouvelle confirmation', async deleteStatus => {
    const { onAccessError, onDeleted, fetcher } = setup({ deleteStatus })
    await confirm(); await screen.findByRole('alert')
    expect(onDeleted).not.toHaveBeenCalled()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByRole('button', { name: 'Supprimer définitivement' })).toHaveProperty('disabled', true)
    if (deleteStatus === 401 || deleteStatus === 403) expect(onAccessError).toHaveBeenCalledWith(deleteStatus)
    fireEvent.click(screen.getByRole('button', { name: 'Actualiser le bilan' }))
    await screen.findByRole('checkbox', { name: /Je confirme/ })
    expect(screen.getByRole('checkbox')).toHaveProperty('checked', false)
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1)
  })

  it('un slug repris par une autre fiche ne peut pas supprimer son nouveau UUID', async () => {
    const { fetcher } = setup({ preview: { ...plan, id: '00000000-0000-4000-8000-000000000002' } })
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer la fiche' }))
    await screen.findByRole('alert')
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
  })

  it('revient au tableau de bord avec confirmation, recharge la liste et les compteurs après succès et protège la navigation en cours', async () => {
    window.history.replaceState(null, '', '/admin')
    let deleted = false, complete!: () => void, refreshComplete!: () => void
    const delayed = new Promise<void>(resolve => { complete = resolve })
    const refreshDelayed = new Promise<void>(resolve => { refreshComplete = resolve })
    const other = { ...entity, id: '00000000-0000-4000-8000-000000000002', slug: 'autre', title: 'Autre fictive' }
    const requests: { url: string; init?: RequestInit }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, init })
      if (init?.method === 'DELETE') { await delayed; deleted = true; return response(null, 204) }
      if (url === '/api/auth/session') return response({ authenticated: true, isAdmin: true, user: { username: 'editor', displayName: null } })
      if (url === '/api/admin/stats') {
        if (deleted) await refreshDelayed
        return response({ byStatus: { DRAFT: 0, PROPOSED: 0, PUBLISHED: deleted ? 1 : 2, ARCHIVED: 0 },
          byVisibility: { PUBLIC: deleted ? 1 : 2, PLAYERS: 0, GM: 0, SECRET: 0 }, sources: 1, relations: deleted ? 0 : 3 })
      }
      if (url === '/api/admin/entities/cible/deletion') return response(plan)
      if (url === '/api/admin/entities/cible') return response(deleted ? {} : entity, deleted ? 404 : 200)
      if (url.startsWith('/api/admin/entities?')) {
        if (deleted) await refreshDelayed
        return response({ items: deleted ? [other] : [entity, other], total: deleted ? 1 : 2, page: 1, pageSize: 50 })
      }
      return response({}, 404)
    }))
    render(<App />)
    fireEvent.click(await screen.findByRole('link', { name: /Cible fictive/ }))
    await screen.findByRole('button', { name: 'Supprimer la fiche' }); await confirm()
    fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }))
    fireEvent.click(screen.getByRole('link', { name: '← Tableau de bord' }))
    expect(window.location.pathname).toBe('/admin/fiches/cible')
    expect(requests.some(request => request.url === '/api/auth/logout')).toBe(false)
    complete()
    await screen.findByText('Fiche « Cible fictive » supprimée définitivement.')
    expect(window.location.pathname).toBe('/admin'); expect(window.history.state).toBeNull()
    expect(screen.queryByRole('link', { name: /Cible fictive/ })).toBeNull()
    expect(document.querySelector('.admin-stats')).toBeNull()
    refreshComplete()
    await screen.findByRole('link', { name: /Autre fictive/ })
    expect(screen.queryByRole('link', { name: /Cible fictive/ })).toBeNull()
    expect(screen.getByText('1 résultat')).toBeTruthy()
    await waitFor(() => expect(document.querySelector('.admin-stats')?.textContent).toContain('0Relations'))
  })
})
