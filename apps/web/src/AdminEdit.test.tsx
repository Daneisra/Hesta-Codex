import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AdminEntityDetail, AdminEntityPatch, AdminStats } from '@hesta-codex/shared'
import { App } from './App'

const original: AdminEntityDetail = {
  id: 'entity-1', slug: 'barolt', kind: 'PERSON', placeKind: null, title: 'Barolt',
  summary: 'Ancien résumé', bodyMarkdown: '## Chronique\n\nTexte **ancien**.',
  aliases: ['Alias'], tags: ['personnage'], status: 'PROPOSED', visibility: 'GM',
  createdAt: '2026-09-28T00:00:00.000Z', updatedAt: '2026-09-28T00:00:00.000Z', publishedAt: null,
  evidence: [{ id: 'evidence-1', claimText: 'Note source', sourceExcerpt: null, locator: null,
    timeStartSeconds: null, timeEndSeconds: null, confidence: null, visibility: 'GM',
    source: { id: 'source-1', kind: 'MANUAL', label: 'Notes', externalId: null,
      url: null, authorLabel: null, visibility: 'GM' } }],
  outgoingRelations: [], incomingRelations: [],
  revisions: [{ id: 'revision-1', number: 1, snapshot: { version: 1, entity: { title: 'Barolt' } },
    message: null, editorLabel: 'Import CLI', createdAt: '2026-09-28T00:00:00.000Z' }],
}

function response(data: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as Response
}

function mockEditorialApi(options: { entity?: AdminEntityDetail; mutationStatus?: number } = {}) {
  let entity = structuredClone(options.entity ?? original)
  const mutations: Array<{ url: string; method: string; body: Record<string, unknown> }> = []
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/auth/session') return response({ authenticated: true, isAdmin: true,
      user: { username: 'mj', displayName: 'Danny' } })
    if (url === '/api/admin/stats') {
      const stats: AdminStats = { byStatus: { DRAFT: 0, PROPOSED: entity.status === 'PROPOSED' ? 1 : 0,
        PUBLISHED: entity.status === 'PUBLISHED' ? 1 : 0, ARCHIVED: 0 },
      byVisibility: { PUBLIC: 0, PLAYERS: 0, GM: 1, SECRET: 0 }, sources: 1, relations: 0 }
      return response(stats)
    }
    if (url.startsWith('/api/admin/entities?')) return response({ items: [entity], total: 1, page: 1, pageSize: 50 })
    if (url === '/api/admin/entities/barolt' && !init?.method) return response(entity)
    if (url.startsWith('/api/admin/entities/barolt') && init?.method) {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>
      mutations.push({ url, method: init.method, body })
      if (options.mutationStatus) return response({ error: { code: 'FAILED' } }, options.mutationStatus)
      const number = entity.revisions[0]!.number + 1
      const nextTime = `2026-09-28T00:00:0${number}.000Z`
      if (init.method === 'PATCH') {
        const patch = body as unknown as AdminEntityPatch
        entity = { ...entity, title: patch.title, summary: patch.summary,
          bodyMarkdown: patch.bodyMarkdown, kind: patch.kind, placeKind: patch.placeKind,
          aliases: patch.aliases, tags: patch.tags, visibility: patch.visibility }
      } else if (url.endsWith('/publish')) {
        entity = { ...entity, status: 'PUBLISHED', publishedAt: nextTime }
      } else {
        entity = { ...entity, status: 'PROPOSED', publishedAt: null }
      }
      entity = { ...entity, updatedAt: nextTime, revisions: [{ id: `revision-${number}`, number,
        snapshot: { version: 1, entity: { title: entity.title, status: entity.status } },
        message: init.method === 'PATCH' ? String(body.revisionMessage ?? '')
          : url.endsWith('/publish') ? 'Publication de la fiche' : 'Retrait de publication',
        editorLabel: 'Danny', createdAt: nextTime }, ...entity.revisions] }
      return response(entity)
    }
    return response({}, 404)
  }))
  return { mutations, current: () => entity }
}

beforeEach(() => window.history.replaceState(null, '', '/admin/fiches/barolt'))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/') })

describe('édition et publication admin', () => {
  it('ouvre un formulaire prérempli avec aperçu Markdown, puis annule sans écrire', async () => {
    const user = userEvent.setup()
    const api = mockEditorialApi()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Modifier' }))
    expect((screen.getByRole('textbox', { name: 'Titre' }) as HTMLInputElement).value).toBe('Barolt')
    expect((screen.getByRole('textbox', { name: 'Résumé' }) as HTMLTextAreaElement).value).toBe('Ancien résumé')
    expect(screen.getByRole('heading', { name: 'Aperçu Markdown' })).toBeTruthy()
    expect(screen.getByText('ancien')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(screen.queryByRole('heading', { name: 'Modifier la fiche' })).toBeNull()
    expect(api.mutations).toHaveLength(0)
    const unload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(false)
  })

  it('enregistre le résumé avec expectedUpdatedAt et affiche immédiatement Revision #2', async () => {
    const user = userEvent.setup()
    const api = mockEditorialApi()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Modifier' }))
    await user.clear(screen.getByRole('textbox', { name: 'Résumé' }))
    await user.type(screen.getByRole('textbox', { name: 'Résumé' }), 'Nouveau résumé')
    await user.type(screen.getByRole('textbox', { name: 'Message de révision (facultatif)' }), 'Résumé corrigé')
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))
    expect(await screen.findByText('Nouveau résumé')).toBeTruthy()
    expect(screen.getByText(/Revision #2/)).toBeTruthy()
    expect(api.mutations[0]?.method).toBe('PATCH')
    expect(api.mutations[0]?.body.expectedUpdatedAt).toBe(original.updatedAt)
    expect(api.mutations[0]?.body.revisionMessage).toBe('Résumé corrigé')
    expect(api.current().status).toBe('PROPOSED')
    expect(api.current().visibility).toBe('GM')
    const unload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(false)
  })

  it('transmet les champs éditoriaux, conserve PROPOSED et ne publie pas en sauvegardant', async () => {
    const user = userEvent.setup()
    const api = mockEditorialApi()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Modifier' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type' }), 'PLACE')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sous-type de lieu' }), 'REGION')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Visibilité' }), 'PUBLIC')
    fireEvent.change(screen.getByRole('textbox', { name: 'Alias, séparés par des virgules' }),
      { target: { value: 'Côte d’Azur, L’Étendue' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Tags, séparés par des virgules' }),
      { target: { value: 'géographie, histoire' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Contenu Markdown' }),
      { target: { value: '## Événement\n\n**Première ligne**\n\n- Côte\n- Forêt' } })
    expect(screen.getByText('Première ligne')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))
    expect(await screen.findByRole('button', { name: 'Publier' })).toBeTruthy()
    expect(api.mutations).toHaveLength(1)
    expect(api.mutations[0]?.method).toBe('PATCH')
    expect(api.mutations[0]?.body).toMatchObject({ kind: 'PLACE', placeKind: 'REGION',
      visibility: 'PUBLIC', aliases: ['Côte d’Azur', 'L’Étendue'], tags: ['géographie', 'histoire'] })
    expect(api.current().status).toBe('PROPOSED')
  })

  it('signale un conflit 409 et propose le rechargement', async () => {
    const user = userEvent.setup()
    mockEditorialApi({ mutationStatus: 409 })
    vi.stubGlobal('confirm', vi.fn(() => true))
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Modifier' }))
    await user.type(screen.getByRole('textbox', { name: 'Titre' }), ' nouveau')
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))
    expect(await screen.findByRole('button', { name: 'Recharger la version récente' })).toBeTruthy()
    expect((screen.getByRole('textbox', { name: 'Titre' }) as HTMLInputElement).value).toBe('Barolt nouveau')
    await user.click(screen.getByRole('button', { name: 'Recharger la version récente' }))
    expect(await screen.findByRole('button', { name: 'Modifier' })).toBeTruthy()
  })

  it('confirme distinctement une publication MJ et actualise l’historique', async () => {
    const user = userEvent.setup()
    const api = mockEditorialApi()
    const confirm = vi.fn((message: string) => message.length >= 0)
    vi.stubGlobal('confirm', confirm)
    render(<App />)
    expect(await screen.findByText('Cette fiche sera validée mais restera invisible dans la bibliothèque publique.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Publier' }))
    expect(confirm.mock.calls[0]?.[0]).toContain('restera invisible pour le public')
    expect(await screen.findByRole('button', { name: 'Retirer de la publication' })).toBeTruthy()
    expect(screen.getByText(/Publiée le/)).toBeTruthy()
    expect(screen.getByText(/Revision #2/)).toBeTruthy()
    expect(api.current().visibility).toBe('GM')
  })

  it('confirme une publication publique et son retrait, sans publier les relations', async () => {
    const user = userEvent.setup()
    const api = mockEditorialApi({ entity: { ...original, visibility: 'PUBLIC' } })
    const confirm = vi.fn((message: string) => message.length >= 0)
    vi.stubGlobal('confirm', confirm)
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Publier' }))
    expect(confirm.mock.calls[0]?.[0]).toContain('immédiatement visible')
    expect(await screen.findByRole('button', { name: 'Retirer de la publication' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Retirer de la publication' }))
    expect(confirm.mock.calls[1]?.[0]).toContain('disparaîtra immédiatement')
    expect(await screen.findByRole('button', { name: 'Publier' })).toBeTruthy()
    expect(screen.getByText(/Revision #3/)).toBeTruthy()
    expect(api.mutations.map((item) => item.url)).toEqual([
      '/api/admin/entities/barolt/publish', '/api/admin/entities/barolt/unpublish',
    ])
  })

  it('avertit qu’une modification PUBLISHED + PUBLIC est immédiatement visible', async () => {
    const user = userEvent.setup()
    mockEditorialApi({ entity: { ...original, status: 'PUBLISHED', visibility: 'PUBLIC',
      publishedAt: original.updatedAt } })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Modifier' }))
    expect(screen.getByText(/L’enregistrement modifiera immédiatement sa version visible/)).toBeTruthy()
  })

  it('refuse un lieu sans sous-type avant toute requête', async () => {
    const user = userEvent.setup()
    const api = mockEditorialApi()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Modifier' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type' }), 'PLACE')
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))
    expect(screen.getByRole('alert').textContent).toContain('Choisissez un sous-type de lieu')
    expect(api.mutations).toHaveLength(0)
  })

  it('laisse une fiche archivée consultable sans commandes d’édition ni de publication', async () => {
    mockEditorialApi({ entity: { ...original, status: 'ARCHIVED' } })
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Barolt' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Modifier' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Publier' })).toBeNull()
  })

  it('protège la saisie en cliquant une fiche liée ou le bouton précédent du navigateur', async () => {
    window.history.replaceState(null, '', '/admin')
    window.history.pushState(null, '', '/admin/fiches/barolt')
    const user = userEvent.setup()
    mockEditorialApi({ entity: { ...original, outgoingRelations: [{
      id: 'relation-1', description: null, status: 'PROPOSED', visibility: 'GM', evidence: [],
      relationType: { id: 'type-1', code: 'member_of', label: 'membre de', inverseCode: 'has_member',
        inverseLabel: 'compte parmi ses membres', symmetric: false },
      entity: { id: 'entity-2', slug: 'geirvor', kind: 'PERSON', placeKind: null, title: 'Geirvor',
        summary: null, tags: [], status: 'PROPOSED', visibility: 'GM', updatedAt: original.updatedAt },
    }] } })
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Modifier' }))
    await user.type(screen.getByRole('textbox', { name: 'Titre' }), ' corrigé')
    await user.click(screen.getByRole('link', { name: 'Geirvor' }))
    expect(window.location.pathname).toBe('/admin/fiches/barolt')
    window.history.back()
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(2))
    expect(window.location.pathname).toBe('/admin/fiches/barolt')
    expect((screen.getByRole('textbox', { name: 'Titre' }) as HTMLInputElement).value).toBe('Barolt corrigé')
  })

  it('empêche la perte accidentelle et garde la saisie visible après expiration de session', async () => {
    const user = userEvent.setup()
    mockEditorialApi({ mutationStatus: 401 })
    const confirm = vi.fn(() => false)
    vi.stubGlobal('confirm', confirm)
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Modifier' }))
    await user.type(screen.getByRole('textbox', { name: 'Titre' }), ' corrigé')
    await user.click(screen.getByRole('link', { name: /Tableau de bord/ }))
    expect(window.location.pathname).toBe('/admin/fiches/barolt')
    expect(confirm).toHaveBeenCalled()
    const unload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(unload)
    expect(unload.defaultPrevented).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))
    await waitFor(() => expect(screen.getByRole('link', { name: 'Se reconnecter avec Discord' })).toBeTruthy())
    expect((screen.getByRole('textbox', { name: 'Titre' }) as HTMLInputElement).value).toBe('Barolt corrigé')
    expect((screen.getByRole('button', { name: 'Enregistrer' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('alert').textContent).toContain('Vos modifications restent affichées')
    confirm.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(await screen.findByRole('heading', { name: 'Administration Hesta Codex' })).toBeTruthy()
  })
})
