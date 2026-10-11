import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AdminEntityDetail, AdminRelation, AdminSource, RelationTypeItem } from '@hesta-codex/shared'
import { App } from './App'
import { AdminCreateRelation } from './AdminCreateRelation'
import { ObsidianReferences } from './ObsidianReferences'
import { existingRelation, referenceProvenance, type ReferenceRelationSeed } from './reference-relation'

const now = '2026-10-11T12:00:00.000Z'
const ownerId = '11111111-1111-4111-8111-111111111111'
const targetId = '22222222-2222-4222-8222-222222222222'
const source: AdminSource = { id: '33333333-3333-4333-8333-333333333333', kind: 'OBSIDIAN',
  label: 'Coffre fictif', externalId: 'synthetic-vault', visibility: 'GM', url: null, authorLabel: null,
  publishedAt: null, updatedAt: now }
const types: RelationTypeItem[] = [
  { id: 'type-place', code: 'located_in', label: 'situé dans', inverseCode: 'contains', inverseLabel: 'contient', symmetric: false },
  { id: 'type-allied', code: 'allied_with', label: 'allié à', inverseCode: null, inverseLabel: null, symmetric: true },
]
const excerpt = 'Une phrase entièrement fictive mentionne [[Dossier/Cible|Alias]].'
const proof = { id: 'proof-origin', claimText: 'Origine fictive', sourceExcerpt: excerpt, locator: 'Dossier/Auteur.md',
  timeStartSeconds: null, timeEndSeconds: null, confidence: null, visibility: 'GM' as const, updatedAt: now, source }
const base: AdminEntityDetail = { id: ownerId, slug: 'auteur', title: 'Homonyme', kind: 'OTHER', placeKind: null,
  summary: null, bodyMarkdown: excerpt, tags: [], aliases: [], status: 'PROPOSED', visibility: 'GM',
  updatedAt: now, createdAt: now, publishedAt: null, evidence: [proof], revisions: [], outgoingRelations: [], incomingRelations: [] }
const connection = { id: targetId, slug: 'cible', title: 'Homonyme', occurrences: 1,
  origin: { sourceId: source.id, path: 'Dossier/Auteur.md', excerpt } }
const owner: AdminEntityDetail = { ...base, obsidianReferences: { updatedAt: now, links: [], outgoing: [connection], incoming: [],
  diagnostics: [{ target: 'Réserve', anchor: '', status: 'UNASSOCIATED', occurrences: 1, message: 'Note sans fiche associée.' }],
  stats: { occurrences: 2, resolved: 1, missing: 0, ambiguous: 0, unassociated: 1, unsupported: 0 } } }
const target: AdminEntityDetail = { ...base, id: targetId, slug: 'cible', bodyMarkdown: '', evidence: [],
  obsidianReferences: { ...owner.obsidianReferences!, outgoing: [], incoming: [{ ...connection, id: ownerId, slug: 'auteur' }], diagnostics: [] } }
const seed: ReferenceRelationSeed = { fromId: ownerId, toId: targetId, toSlug: 'cible', returnSlug: 'auteur', returnTitle: 'Homonyme' }
function relation(type = types[0]!): AdminRelation {
  return { id: 'created-relation', relationType: type, entity: target, status: 'PROPOSED', visibility: 'GM',
    updatedAt: now, description: null, evidence: [{ ...proof, id: 'created-proof' }] }
}
function response(data: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as Response
}
function api(options: { failure?: number | 'network'; existing?: boolean; targetStatus?: 'ARCHIVED'; targetFailure?: number;
  delayed?: Promise<void>; lostResponse?: boolean } = {}) {
  let created = options.existing ?? false
  const calls: { url: string; init?: RequestInit }[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); calls.push({ url, init })
    if (url === '/api/auth/session') return response({ authenticated: true, isAdmin: true,
      user: { username: 'test-editor', displayName: null } })
    if (url === '/api/admin/stats') return response({ byStatus: { DRAFT: 0, PROPOSED: 2, PUBLISHED: 0, ARCHIVED: 0 },
      byVisibility: { PUBLIC: 0, PLAYERS: 0, GM: 2, SECRET: 0 }, sources: 1, relations: created ? 1 : 0 })
    if (url.startsWith('/api/admin/reference-qualifications?')) return response({
      items: created ? [] : [{ id: 'pair', from: owner, to: target, occurrences: 1, state: 'PENDING', fingerprint: 'a'.repeat(64),
        decisionRevision: null, ignoredAt: null, ignoredBy: null, stale: false, relations: [],
        origins: [{ sourceId: source.id, sourceLabel: source.label, path: proof.locator }] }],
      total: created ? 0 : 1, page: 1, pageSize: 50, counts: { total: 1, PENDING: created ? 0 : 1, QUALIFIED: created ? 1 : 0, IGNORED: 0 },
      entities: [owner, target], sources: [source], diagnosticCounts: {}, diagnostics: [], diagnosticTotal: 0,
    })
    if (url === '/api/admin/entities/auteur') return response({ ...owner, outgoingRelations: created ? [relation()] : [] })
    if (url === '/api/admin/entities/cible') return options.targetFailure ? response({}, options.targetFailure)
      : response({ ...target, status: options.targetStatus ?? target.status, incomingRelations: created ? [{ ...relation(), entity: owner }] : [] })
    if (url === '/api/admin/relation-types') return response(types)
    if (url.startsWith('/api/admin/sources?')) return response({ items: [source], total: 1, page: 1, pageSize: 20 })
    if (url.startsWith('/api/admin/entities?')) return response({ items: [owner, target], total: 2, page: 1, pageSize: 50 })
    if (url === '/api/admin/relations' && init?.method === 'POST') {
      await options.delayed
      if (options.lostResponse) {
        if (!created) { created = true; throw new Error('Response lost after commit') }
        return response({ error: { code: 'RELATION_CONFLICT', message: 'Cette relation existe déjà.' } }, 409)
      }
      if (options.failure === 'network') throw new Error('Network unavailable')
      if (options.failure) {
        if (options.failure === 409) created = true
        return response({ error: { code: 'RELATION_CONFLICT', message: 'Cette relation existe déjà.' } }, options.failure)
      }
      created = true
      const body = JSON.parse(String(init.body)) as { fromEntityId: string }
      // Mutation responses intentionally omit derived references, as in the real API.
      return response(body.fromEntityId === ownerId ? { ...base, outgoingRelations: [relation()] }
        : { ...target, obsidianReferences: undefined, incomingRelations: [{ ...relation(), entity: owner }] }, 201)
    }
    return response({}, 404)
  }))
  return calls
}
const posts = (calls: ReturnType<typeof api>) => calls.filter(call => call.init?.method === 'POST' && call.url === '/api/admin/relations')
beforeEach(() => window.history.replaceState(null, '', '/admin/fiches/auteur'))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/') })
async function open(user: ReturnType<typeof userEvent.setup>, incoming = false) {
  if (incoming) window.history.replaceState(null, '', '/admin/fiches/cible')
  render(<App />)
  await user.click(await screen.findByRole('button', { name: 'Examiner' }))
  await user.click(await screen.findByRole('button', { name: 'Définir une relation' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Inverser les fiches' })).not.toHaveProperty('disabled', true))
  await screen.findByRole('option', { name: 'situé dans' })
}
async function review(user: ReturnType<typeof userEvent.setup>, code = 'located_in') {
  await user.selectOptions(screen.getByRole('combobox', { name: 'Type et sens' }), code)
  await user.click(screen.getByRole('button', { name: 'Utiliser cet énoncé' }))
  await user.click(screen.getByRole('button', { name: 'Vérifier la création' }))
}

describe('qualification humaine des références Obsidian', () => {
  it('crée depuis la file centrale avec le formulaire existant et revient aux compteurs actualisés', async () => {
    window.history.replaceState(null, '', '/admin/relations-a-qualifier')
    const calls = api(), user = userEvent.setup(); render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Définir une relation' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Inverser les fiches' })).not.toHaveProperty('disabled', true))
    await screen.findByRole('option', { name: 'situé dans' })
    expect(screen.getByRole('textbox', { name: 'Repère' })).toHaveProperty('value', 'Dossier/Auteur.md')
    expect(screen.getByRole('link', { name: '← Relations à qualifier' })).toHaveProperty('pathname', '/admin/relations-a-qualifier')
    await review(user); await user.click(screen.getByRole('button', { name: 'Créer la relation' }))
    await screen.findByRole('heading', { name: 'Relations à qualifier', level: 1 })
    await waitFor(() => expect(screen.getByLabelText('Compteurs globaux').textContent).toContain('1 qualifiées'))
    expect(window.location.pathname).toBe('/admin/relations-a-qualifier')
    expect(posts(calls)).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Définir une relation' })).toBeNull()
  })
  it.each([false, true])('préremplit la mention sortante/entrante (%s), crée puis conserve les références et revient à la liste', async incoming => {
    const calls = api(); const user = userEvent.setup(); await open(user, incoming)
    expect(window.location.pathname).toBe('/admin/fiches/auteur/nouvelle-relation')
    expect(window.history.state).toBeNull()
    expect(screen.getByRole('combobox', { name: 'Type et sens' })).toHaveProperty('value', '')
    expect(screen.getByRole('textbox', { name: 'Énoncé' })).toHaveProperty('value', '')
    expect(screen.getByRole('textbox', { name: 'Repère' })).toHaveProperty('value', 'Dossier/Auteur.md')
    expect(screen.getByRole('textbox', { name: 'Extrait de la Source' })).toHaveProperty('value', excerpt)
    expect(screen.getByRole('radio', { name: /Coffre fictif/ })).toHaveProperty('checked', true)
    expect(posts(calls)).toHaveLength(0)
    expect(calls.some(call => call.url.startsWith('/api/admin/entities?'))).toBe(false)
    await review(user)
    expect(screen.getByText('PROPOSED · sans publication')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Créer la relation' }))
    await waitFor(() => expect(window.location.pathname).toBe(`/admin/fiches/${incoming ? 'cible' : 'auteur'}`))
    await user.click(await screen.findByRole('button', { name: 'Examiner' }))
    await screen.findByText(/Relation éditoriale existante/)
    expect(screen.getByRole('button', { name: 'Définir une relation' })).toBeTruthy()
    const input = JSON.parse(String(posts(calls)[0]!.init!.body))
    expect(input).toMatchObject({ fromEntityId: ownerId, toEntityId: targetId, relationCode: 'located_in', visibility: 'GM',
      source: { mode: 'existing', sourceId: source.id }, evidence: { locator: 'Dossier/Auteur.md', sourceExcerpt: excerpt, visibility: 'GM' } })
    expect(input).not.toHaveProperty('status')
    expect(calls.filter(call => call.init?.method && call.init.method !== 'GET')).toHaveLength(1)
  })

  it('permet les sens inverses et symétriques sans changer la note utilisée comme Source', async () => {
    const calls = api(); const user = userEvent.setup(); await open(user)
    await user.click(screen.getByRole('button', { name: 'Inverser les fiches' }))
    await review(user, 'contains')
    expect(screen.getByText('Homonyme → located_in → Homonyme')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Corriger' }))
    await review(user, 'allied_with')
    expect(screen.queryAllByRole('option', { name: 'allié à' })).toHaveLength(0) // review replaces the select
    await user.click(screen.getByRole('button', { name: 'Créer la relation' }))
    await screen.findByText('Relation créée en proposition.')
    expect(JSON.parse(String(posts(calls)[0]!.init!.body))).toMatchObject({ fromEntityId: targetId, toEntityId: ownerId,
      relationCode: 'allied_with', source: { sourceId: source.id }, evidence: { locator: 'Dossier/Auteur.md' } })
  })

  it('bloque le doublon connu mais permet de qualifier un autre type', async () => {
    api({ existing: true }); const user = userEvent.setup(); await open(user)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type et sens' }), 'located_in')
    expect(screen.getByText(/Cette relation éditoriale existe déjà/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Vérifier la création' })).toHaveProperty('disabled', true)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type et sens' }), 'allied_with')
    expect(screen.getByRole('button', { name: 'Vérifier la création' })).not.toHaveProperty('disabled', true)
  })

  it('actualise un conflit concurrent sans perdre la saisie ni autoriser un second doublon', async () => {
    const calls = api({ failure: 409 }); const user = userEvent.setup(); await open(user); await review(user)
    await user.click(screen.getByRole('button', { name: 'Créer la relation' }))
    await screen.findByText(/Cette relation éditoriale existe déjà/)
    expect(screen.getByRole('button', { name: 'Créer la relation' })).toHaveProperty('disabled', true)
    await user.click(screen.getByRole('button', { name: 'Corriger' }))
    expect(screen.getByRole('textbox', { name: 'Énoncé' })).toHaveProperty('value', 'Homonyme situé dans Homonyme.')
    expect(screen.getByRole('textbox', { name: 'Extrait de la Source' })).toHaveProperty('value', excerpt)
    expect(posts(calls)).toHaveLength(1)
  })

  it.each([401, 'network'] as const)('conserve la saisie après %s et bloque une session expirée', async failure => {
    api({ failure }); const user = userEvent.setup(); await open(user); await review(user)
    await user.click(screen.getByRole('button', { name: 'Créer la relation' }))
    await screen.findByText(failure === 401 ? /Session expirée\. Vos modifications/ : /Impossible d’enregistrer/)
    await user.click(screen.getByRole('button', { name: 'Corriger' }))
    expect(screen.getByRole('textbox', { name: 'Énoncé' })).toHaveProperty('value', 'Homonyme situé dans Homonyme.')
    expect(screen.getByRole('textbox', { name: 'Repère' })).toHaveProperty('value', 'Dossier/Auteur.md')
    if (failure === 401) expect(screen.getByRole('button', { name: 'Vérifier la création' })).toHaveProperty('disabled', true)
  })

  it('ne soumet qu’une fois malgré les doubles clics et une réponse retardée', async () => {
    let resolve!: () => void
    const delayed = new Promise<void>(done => { resolve = done })
    const calls = api({ delayed }); const user = userEvent.setup(); await open(user); await review(user)
    const create = screen.getByRole('button', { name: 'Créer la relation' })
    fireEvent.click(create); fireEvent.click(create)
    expect(posts(calls)).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Création…' })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('link', { name: '← Homonyme' }))
    expect(window.location.pathname).toBe('/admin/fiches/auteur/nouvelle-relation')
    expect(screen.getByRole('button', { name: 'Se déconnecter' })).toHaveProperty('disabled', true)
    resolve(); await screen.findByText('Relation créée en proposition.')
  })

  it('une relance après réponse perdue reconnaît la création initiale sans dupliquer la relation', async () => {
    const calls = api({ lostResponse: true }); const user = userEvent.setup(); await open(user); await review(user)
    await user.click(screen.getByRole('button', { name: 'Créer la relation' }))
    await screen.findByText(/Impossible d’enregistrer/)
    await user.click(screen.getByRole('button', { name: 'Créer la relation' }))
    await screen.findByText(/Cette relation éditoriale existe déjà/)
    expect(screen.getByRole('button', { name: 'Créer la relation' })).toHaveProperty('disabled', true)
    expect(posts(calls)).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Corriger' }))
    expect(screen.getByRole('textbox', { name: 'Repère' })).toHaveProperty('value', 'Dossier/Auteur.md')
    vi.stubGlobal('confirm', () => true)
    await user.click(screen.getByRole('link', { name: '← Homonyme' }))
    await user.click(await screen.findByRole('button', { name: 'Examiner' }))
    await screen.findByText(/Relation éditoriale existante/)
    expect(window.location.pathname).toBe('/admin/fiches/auteur')
    expect(screen.getByRole('button', { name: 'Définir une relation' })).toBeTruthy()
    expect(posts(calls)).toHaveLength(2)
  })

  it.each([401, 404])('préchargement refusé (%s) : aucune écriture et provenance préservée', async targetFailure => {
    const calls = api({ targetFailure }); const user = userEvent.setup()
    render(<App />); await user.click(await screen.findByRole('button', { name: 'Définir une relation' }))
    await screen.findByRole('button', { name: 'Réessayer' })
    expect(screen.getByRole('button', { name: 'Vérifier la création' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('textbox', { name: 'Repère' })).toHaveProperty('value', 'Dossier/Auteur.md')
    expect(posts(calls)).toHaveLength(0)
  })

  it('refuse une destination archivée pendant le préchargement', async () => {
    const calls = api({ targetStatus: 'ARCHIVED' }); const user = userEvent.setup()
    render(<App />); await user.click(await screen.findByRole('button', { name: 'Définir une relation' }))
    await screen.findByText(/La fiche cible a changé ou est archivée/)
    expect(screen.getByRole('button', { name: 'Vérifier la création' })).toHaveProperty('disabled', true)
    expect(posts(calls)).toHaveLength(0)
  })

  it('aucune action pour les diagnostics, auto-références et destinations archivées', () => {
    const references = { ...owner.obsidianReferences!, outgoing: [
      { ...connection, id: ownerId }, { ...connection, archived: true },
    ] }
    render(<ObsidianReferences references={references} entity={owner} onDefine={vi.fn()} onNavigate={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Définir une relation' })).toBeNull()
    expect(screen.getByText(/Note sans fiche associée/)).toBeTruthy()
  })

  it('sans provenance vérifiable, demande une Source au lieu de deviner depuis le titre', async () => {
    api(); const user = userEvent.setup()
    render(<AdminCreateRelation entity={{ ...owner, evidence: [] }} seed={seed} busy={false} disabled={false} error={null}
      onCreate={vi.fn()} onClearError={vi.fn()} onDirtyChange={vi.fn()} onNavigate={vi.fn()} />)
    await screen.findByRole('option', { name: 'situé dans' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Inverser les fiches' })).not.toHaveProperty('disabled', true))
    expect(screen.getByText(/Source Obsidian non vérifiable/)).toBeTruthy()
    await review(user)
    expect(screen.getByText('Choisissez une Source.')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Vérifier avant création' })).toBeNull()
  })

  it('recharge le catalogue après une erreur réseau sans effacer la provenance', async () => {
    const calls = api()
    const normalFetch = globalThis.fetch
    let failed = false
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === '/api/admin/relation-types' && !failed) {
        failed = true; return Promise.reject(new Error('Network unavailable'))
      }
      return normalFetch(input, init)
    }))
    const user = userEvent.setup()
    render(<App />); await user.click(await screen.findByRole('button', { name: 'Définir une relation' }))
    await user.click(await screen.findByRole('button', { name: 'Recharger le catalogue' }))
    await screen.findByRole('option', { name: 'situé dans' })
    expect(screen.getByRole('textbox', { name: 'Extrait de la Source' })).toHaveProperty('value', excerpt)
    expect(screen.getByRole('textbox', { name: 'Repère' })).toHaveProperty('value', 'Dossier/Auteur.md')
    expect(posts(calls)).toHaveLength(0)
  })

  it('reconnaît les doublons inverses et symétriques, y compris les anciens sens opposés', () => {
    const data = { ...owner, outgoingRelations: [relation()] }
    expect(existingRelation(data, target, types[0], 'contains', true)?.id).toBe('created-relation')
    expect(existingRelation(data, target, types[0], 'contains', false)).toBeUndefined()
    const symmetric = { ...owner, incomingRelations: [{ ...relation(types[1]), entity: target }] }
    expect(existingRelation(symmetric, target, types[1], 'allied_with', false)?.id).toBe('created-relation')
    expect(existingRelation(symmetric, target, types[1], 'allied_with', true)?.id).toBe('created-relation')
  })

  it('ignore une provenance obsolète, une autre Source et les chemins hors limites sans troncature', () => {
    expect(referenceProvenance({ ...owner, updatedAt: '2026-10-12T12:00:00.000Z' }, targetId)).toEqual({ source: null, locator: '', excerpt: '' })
    expect(referenceProvenance({ ...owner, evidence: [{ ...proof, source: { ...source, kind: 'MANUAL' } }] }, targetId).source).toBeNull()
    const data = { ...owner, obsidianReferences: { ...owner.obsidianReferences!, outgoing: [{ ...connection,
      origin: { ...connection.origin, path: `${'x'.repeat(251)}.md` } }] } }
    expect(referenceProvenance(data, targetId).locator).toBe('')
    expect(referenceProvenance(data, targetId).excerpt).toBe(excerpt)
    expect(referenceProvenance({ ...owner, obsidianReferences: { ...owner.obsidianReferences!, outgoing: [{ ...connection,
      origin: { ...connection.origin, path: ' Dossier/Auteur.md' } }] } }, targetId).locator).toBe('')
  })
})
