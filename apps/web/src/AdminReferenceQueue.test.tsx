import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import type { AdminEntityDetail, QualificationFilters, QualificationResponse, QualificationRow } from '@hesta-codex/shared'
import { AdminReferenceQueue } from './AdminReferenceQueue'
import { ObsidianReferences } from './ObsidianReferences'
import { App } from './App'

const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
const from = { id: id(1), slug: 'homonyme-a', title: 'Homonyme', kind: 'PERSON' as const, status: 'PROPOSED' as const, visibility: 'SECRET' as const }
const to = { ...from, id: id(2), slug: 'homonyme-b', kind: 'PLACE' as const }
const row: QualificationRow = { id: 'obsidian-pair', from, to, occurrences: 3, state: 'PENDING', fingerprint: 'a'.repeat(64),
  decisionRevision: null, ignoredAt: null, ignoredBy: null, stale: false, relations: [],
  origins: [{ sourceId: id(3), sourceLabel: 'Source fictive', path: 'Fictif/Homonyme.md' }] }
const data: QualificationResponse = { items: [row], total: 296, page: 1, pageSize: 50,
  counts: { PENDING: 294, QUALIFIED: 1, IGNORED: 1, total: 296 }, sources: [{ id: id(3), label: 'Source fictive' }],
  entities: [from, to], diagnosticCounts: { UNASSOCIATED: 31 }, diagnostics: [], diagnosticTotal: 31 }
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
function setup(options: { status?: number; initial?: QualificationResponse } = {}) {
  let state = options.initial ?? data
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/decision') && init?.method === 'POST') {
      if (options.status) return response({}, options.status)
      const ignore = JSON.parse(String(init.body)).ignore
      state = { ...state, items: [{ ...row, state: ignore ? 'IGNORED' : 'PENDING',
        decisionRevision: ignore ? id(99) : null, ignoredBy: ignore ? 'Auteur fictif' : null, ignoredAt: ignore ? '2026-10-11T00:00:00Z' : null }],
        counts: { ...state.counts, PENDING: ignore ? 293 : 294, IGNORED: ignore ? 2 : 1 } }
      return response(null, 204)
    }
    return response(state)
  })
  vi.stubGlobal('fetch', fetcher)
  const onDefine = vi.fn(), onNavigate = vi.fn(), onAccessError = vi.fn()
  function Fixture() {
    const [filters, setFilters] = useState<QualificationFilters>({ page: 1 })
    return <AdminReferenceQueue filters={filters} onFilters={setFilters} onNavigate={onNavigate} onDefine={onDefine} onAccessError={onAccessError} />
  }
  render(<Fixture />)
  return { fetcher, onDefine, onNavigate, onAccessError }
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/') })

describe('file de qualification', () => {
  it('affiche les compteurs globaux, homonymes distincts, provenance à la demande et lance le formulaire existant', async () => {
    const { onDefine } = setup()
    await screen.findByRole('button', { name: 'Définir une relation' })
    expect(screen.getByLabelText('Compteurs globaux').textContent).toContain('296 connexions')
    expect(screen.getAllByRole('link', { name: 'Homonyme' }).map(link => link.getAttribute('href'))).toEqual([
      '/admin/fiches/homonyme-a', '/admin/fiches/homonyme-b'])
    fireEvent.click(screen.getByText('Examiner la référence et sa provenance'))
    expect(screen.getByText(/Fictif\/Homonyme.md/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Définir une relation' }))
    expect(onDefine).toHaveBeenCalledWith(expect.objectContaining({ fromId: from.id, toId: to.id, toSlug: to.slug,
      returnPath: '/admin/relations-a-qualifier' }), from.slug)
    expect(window.location.search).toBe('')
  })

  it('enregistre et révoque une ignorance avec empreinte et contrôle de concurrence, puis actualise les compteurs', async () => {
    const { fetcher } = setup()
    fireEvent.click(await screen.findByRole('button', { name: 'Ignorer volontairement' }))
    await screen.findByRole('button', { name: 'Révoquer l’ignorance' })
    expect(screen.getByLabelText('Compteurs globaux').textContent).toContain('2 ignorées')
    const mutation = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(JSON.parse(String(mutation[1]?.body))).toEqual({ fromEntityId: from.id, toEntityId: to.id,
      fingerprint: row.fingerprint, expectedDecisionRevision: null, ignore: true })
    fireEvent.click(screen.getByRole('button', { name: 'Révoquer l’ignorance' }))
    await screen.findByRole('button', { name: 'Ignorer volontairement' })
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2)
  })

  it('les filtres sont paginés côté API et restent hors de l’URL et du stockage navigateur', async () => {
    const { fetcher } = setup()
    await screen.findByRole('button', { name: 'Définir une relation' })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Alias privé' } })
    fireEvent.click(screen.getByText('Filtres avancés'))
    fireEvent.change(screen.getByRole('combobox', { name: 'Autour de la fiche' }), { target: { value: from.id } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Direction' }), { target: { value: 'incoming' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Source' }), { target: { value: id(3) } })
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url.includes('direction=incoming') && url.includes('sourceId='))).toBe(true))
    await screen.findByRole('button', { name: 'Suivant' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Définir une relation' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Suivant' }))
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url.includes('page=2'))).toBe(true))
    expect(window.location.search).toBe(''); expect(window.history.state).toBeNull()
  })

  it.each([401, 403, 409, 500])('une mutation refusée (%s) ne valide pas optimistement la décision', async status => {
    const { onAccessError } = setup({ status })
    fireEvent.click(await screen.findByRole('button', { name: 'Ignorer volontairement' }))
    if (status < 409) await waitFor(() => expect(onAccessError).toHaveBeenCalledWith(status))
    else await screen.findByText(status === 409 ? /Référence ou décision modifiée/ : /Décision non confirmée/)
    expect(screen.queryByRole('button', { name: 'Révoquer l’ignorance' })).toBeNull()
  })

  it('une référence qualifiée autorise un autre type et les diagnostics ne proposent aucune création', async () => {
    setup({ initial: { ...data, items: [{ ...row, state: 'QUALIFIED' }], diagnostics: [] } })
    await screen.findByRole('button', { name: 'Ajouter un autre type de relation' })
    expect(screen.queryByRole('button', { name: 'Ignorer volontairement' })).toBeNull()
    fireEvent.change(screen.getByRole('combobox', { name: 'Afficher' }), { target: { value: 'diagnostics' } })
    await screen.findByText(/Ces diagnostics ne sont pas des références à qualifier/)
    expect(screen.queryByRole('button', { name: 'Définir une relation' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Ajouter un autre type de relation' })).toBeNull()
  })

  it('la page centrale ne lance aucun chargement privé pour une session non administratrice', async () => {
    window.history.replaceState(null, '', '/admin/relations-a-qualifier')
    const fetcher = vi.fn(async () => response({ authenticated: true, isAdmin: false, user: { username: 'guest', displayName: null } }))
    vi.stubGlobal('fetch', fetcher); render(<App />)
    await screen.findByRole('heading', { name: 'Accès refusé' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('les références de fiche sont limitées, repliables et distinguent l’ignorance persistante des diagnostics', () => {
    const entity = { ...from, updatedAt: 'now', status: 'PROPOSED', outgoingRelations: [], incomingRelations: [] } as unknown as AdminEntityDetail
    const refs = { updatedAt: 'now', links: [], outgoing: Array.from({ length: 25 }, (_, index) => ({
      id: id(index + 10), slug: `note-${index}`, title: `Note ${index}`, occurrences: 1,
      qualification: { state: 'IGNORED' as const, fingerprint: 'a'.repeat(64), decisionRevision: id(99),
        stale: false, ignoredAt: null, ignoredBy: null } })), incoming: [],
      stats: { occurrences: 25, resolved: 25, ambiguous: 0, missing: 0, unassociated: 1, unsupported: 0 },
      diagnostics: [{ target: 'Réserve', anchor: null, status: 'UNASSOCIATED' as const, message: 'Note vide sans fiche.', occurrences: 1 }] }
    const onIgnore = vi.fn()
    render(<ObsidianReferences references={refs} entity={entity} onNavigate={vi.fn()} onDefine={vi.fn()} onIgnore={onIgnore} />)
    expect(screen.getAllByRole('button', { name: 'Révoquer l’ignorance' })).toHaveLength(10)
    fireEvent.click(screen.getByRole('button', { name: 'Suivant' }))
    expect(screen.getByRole('link', { name: 'Note 10' })).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Note 24' } })
    expect(screen.getAllByRole('button', { name: 'Révoquer l’ignorance' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Révoquer l’ignorance' }))
    expect(onIgnore).toHaveBeenCalledWith(expect.objectContaining({ fromEntityId: from.id, toEntityId: id(34), ignore: false }))
    fireEvent.click(screen.getByText('Fiches mentionnées (25)'))
    expect(screen.queryByRole('link', { name: 'Note 24' })).toBeNull()
  })
})
