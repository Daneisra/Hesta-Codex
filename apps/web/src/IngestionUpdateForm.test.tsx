import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { IngestionUpdateApplied, IngestionUpdatePreparation } from '@hesta-codex/shared'
import { IngestionUpdateForm } from './IngestionUpdateForm'
import { IngestionAssociationPanel } from './IngestionAssociationPanel'

const itemId = '00000000-0000-4000-8000-000000000001', receiptId = '00000000-0000-4000-8000-000000000002'
const prepared: IngestionUpdatePreparation = { receiptId, version: 2, contentHash: 'a'.repeat(64), expectedAssociationRevision: 7,
  expectedEntityUpdatedAt: '2026-10-06T10:00:00Z', alreadyApplied: false,
  entity: { id: receiptId, slug: 'fiche-technique', title: 'Titre actuel', kind: 'PERSON', placeKind: null, status: 'PROPOSED', visibility: 'GM', publishedAt: null,
    summary: 'Résumé actuel', bodyMarkdown: 'Contenu actuel œ\n', aliases: ['Alias actuel'], tags: ['actuel'] },
  source: { id: receiptId, label: 'Source fictive', kind: 'OBSIDIAN', visibility: 'SECRET' },
  staging: { title: 'Titre staging', content: '<script>alert(1)</script>\nÉpreuve œ\n', contentType: 'text/markdown', contentSupported: true,
    tags: ['test, intact', 'œ'], tagsAvailable: true, locator: 'fixture.md', observedAt: null },
  evidence: { claimText: 'Énoncé prérempli fictif', sourceExcerpt: ' Épreuve œ\n', locator: ' repère fictif ' }, warnings: [] }
const applied: IngestionUpdateApplied = { entity: { ...prepared.entity, title: prepared.staging.title! }, updatedAt: '2026-10-07T10:00:00Z', revisionNumber: 5 }
const props = { itemId, receiptId, onCancel: vi.fn(), onApplied: vi.fn(), onAccessError: vi.fn() }
const response = (data: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data }) as Response
function api(options: { readStatus?: number; writeStatus?: number; prepare?: IngestionUpdatePreparation } = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return init?.method ? response(options.writeStatus ? { error: { message: 'Private server detail', issues: [{ path: 'entity.title', message: 'Titre invalide.' }] } } : applied, options.writeStatus ?? 200) :
      response(options.prepare ?? prepared, options.readStatus ?? 200)
  }))
  return calls
}
beforeEach(() => { vi.clearAllMocks(); window.history.replaceState(null, '', '/admin/ingestion'); document.title = 'Administration · Hesta Codex'; localStorage.clear(); sessionStorage.clear() })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/') })
async function review(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('heading', { name: 'Préparer une mise à jour depuis le staging' })
  await user.click(screen.getByRole('button', { name: 'Utiliser le titre du staging' }))
  await user.click(screen.getByRole('button', { name: 'Vérifier la mise à jour' }))
  await screen.findByRole('heading', { name: 'Vérifier la mise à jour' })
}
describe('mise à jour humaine depuis une association confirmée', () => {
  it('initializes every final field from the current Entity and separately displays staging without any write', async () => {
    const calls = api(); render(<IngestionUpdateForm {...props} />)
    await screen.findByDisplayValue(prepared.entity.title)
    for (const [label, value] of [['Résumé', prepared.entity.summary], ['Contenu Markdown', prepared.entity.bodyMarkdown], ['Alias 1', 'Alias actuel'], ['Tag 1', 'actuel'], ['Visibilité', 'GM']])
      expect((screen.getByLabelText(label!) as HTMLInputElement).value).toBe(value)
    expect(screen.getByRole('region', { name: 'Proposition du staging' }).textContent).toContain(prepared.staging.content)
    expect(screen.queryByLabelText('Slug')).toBeNull(); expect(screen.queryByLabelText('Statut')).toBeNull()
    expect(screen.getByRole('button', { name: 'Vérifier la mise à jour' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('Aucun changement éditorial à appliquer.')).toBeTruthy(); expect(calls.every(call => !call.init?.method)).toBe(true)
  })
  it('adopts only explicitly selected staging fields, including empty valid tags, and shows exact before/after body', async () => {
    api({ prepare: { ...prepared, staging: { ...prepared.staging, tags: [] } } }); const user = userEvent.setup(); render(<IngestionUpdateForm {...props} />)
    await screen.findByDisplayValue(prepared.entity.title)
    await user.click(screen.getByRole('button', { name: 'Utiliser le contenu du staging' })); await user.click(screen.getByRole('button', { name: 'Utiliser les tags du staging' }))
    expect((screen.getByLabelText('Titre') as HTMLInputElement).value).toBe(prepared.entity.title); expect(screen.queryByLabelText('Tag 1')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Vérifier la mise à jour' }))
    const difference = screen.getByRole('region', { name: 'Modification : Contenu Markdown' })
    expect(difference.textContent).toContain(prepared.entity.bodyMarkdown); expect(difference.textContent).toContain(prepared.staging.content)
    expect(screen.getByText(/Champs inchangés : Titre/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Corriger' })); expect((screen.getByLabelText('Contenu Markdown') as HTMLTextAreaElement).value).toBe(prepared.staging.content)
    await user.click(screen.getByRole('button', { name: 'Retour vers l’item' })); expect(props.onCancel).toHaveBeenCalledOnce(); expect(props.onApplied).not.toHaveBeenCalled()
  })
  it('provenance-only edits and trimmed-equivalent summary do not enable application', async () => {
    api(); render(<IngestionUpdateForm {...props} />); await screen.findByDisplayValue(prepared.entity.title)
    fireEvent.change(screen.getByLabelText('Énoncé de provenance'), { target: { value: 'Autre énoncé fictif' } })
    fireEvent.change(screen.getByLabelText('Résumé'), { target: { value: ` ${prepared.entity.summary} ` } })
    expect(screen.getByRole('button', { name: 'Vérifier la mise à jour' }).hasAttribute('disabled')).toBe(true)
  })
  it('distinguishes array element boundaries, absent values and empty text in the exact comparison', async () => {
    api({ prepare: { ...prepared, entity: { ...prepared.entity, aliases: ['a\nb'], summary: null, bodyMarkdown: '' } } })
    const user = userEvent.setup(); render(<IngestionUpdateForm {...props} />); await screen.findByDisplayValue(prepared.entity.title)
    fireEvent.change(screen.getByLabelText('Alias 1'), { target: { value: 'a' } }); await user.click(screen.getByRole('button', { name: 'Ajouter Alias' }))
    fireEvent.change(screen.getByLabelText('Alias 2'), { target: { value: 'b' } })
    fireEvent.change(screen.getByLabelText('Résumé'), { target: { value: 'Absent (null)' } })
    fireEvent.change(screen.getByLabelText('Contenu Markdown'), { target: { value: 'Texte vide' } })
    await user.click(screen.getByRole('button', { name: 'Vérifier la mise à jour' }))
    expect(screen.getByRole('region', { name: 'Avant : Alias' }).textContent).toBe('[\n  "a\\nb"\n]')
    expect(screen.getByRole('region', { name: 'Après : Alias' }).textContent).toBe('[\n  "a",\n  "b"\n]')
    for (const name of ['Résumé', 'Contenu Markdown']) {
      expect(screen.getByRole('region', { name: `Avant : ${name}` }).querySelector('em')).toBeTruthy()
      expect(screen.getByRole('region', { name: `Après : ${name}` }).querySelector('em')).toBeNull()
    }
  })
  it('requires a second screen and an explicit keyboard final action with frozen identity, exact excerpt and no private persistence', async () => {
    const calls = api(), user = userEvent.setup(), { container } = render(<IngestionUpdateForm {...props} />); await review(user)
    expect(calls.filter(call => call.init?.method)).toHaveLength(0); expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Vérifier la mise à jour' }))
    screen.getByRole('button', { name: 'Appliquer la mise à jour' }).focus(); await user.keyboard('{Enter}')
    await waitFor(() => expect(props.onApplied).toHaveBeenCalledWith(applied))
    const write = calls.find(call => call.init?.method)!, input = JSON.parse(String(write.init?.body))
    expect(input.targetEntityId).toBe(prepared.entity.id); expect(input.receiptId).toBe(receiptId)
    expect(input.expectedAssociationRevision).toBe(7); expect(input.expectedEntityUpdatedAt).toBe(prepared.expectedEntityUpdatedAt)
    expect(input.entity.title).toBe(prepared.staging.title); expect(input.entity.bodyMarkdown).toBe(prepared.entity.bodyMarkdown)
    expect(input.evidence.sourceExcerpt).toBe(prepared.evidence.sourceExcerpt); expect(input.evidence.locator).toBe(prepared.evidence.locator)
    expect(JSON.stringify(input)).not.toMatch(/slug|status|publishedAt|sourceId|evidenceId|editorLabel|contentHash|ingestion/)
    expect(write.init?.cache).toBe('no-store'); expect(write.init?.credentials).toBe('same-origin'); expect(write.init?.signal).toBeInstanceOf(AbortSignal)
    expect(calls.every(call => call.url.startsWith(`/api/admin/ingestion/items/${itemId}/update-proposal`))).toBe(true)
    expect(window.location.search).toBe(''); expect(window.history.state).toBeNull(); expect(document.title).toBe('Administration · Hesta Codex')
    expect(localStorage.length + sessionStorage.length).toBe(0); expect(container.querySelector('script,img')).toBeNull()
  })
  it('local invalid title, PLACE subtype, long body and duplicate aliases focus the first accessible invalid control', async () => {
    api(); const user = userEvent.setup(); render(<IngestionUpdateForm {...props} />); await screen.findByDisplayValue(prepared.entity.title)
    fireEvent.change(screen.getByLabelText('Titre'), { target: { value: '' } }); await user.click(screen.getByRole('button', { name: 'Vérifier la mise à jour' }))
    expect(document.activeElement).toBe(screen.getByLabelText('Titre')); expect(screen.getByLabelText('Titre').getAttribute('aria-invalid')).toBe('true')
    fireEvent.change(screen.getByLabelText('Titre'), { target: { value: 'Titre valide' } }); await user.selectOptions(screen.getByLabelText('Type de fiche'), 'PLACE')
    await user.click(screen.getByRole('button', { name: 'Vérifier la mise à jour' })); expect(document.activeElement).toBe(screen.getByLabelText('Sous-type de lieu'))
    await user.selectOptions(screen.getByLabelText('Sous-type de lieu'), 'CITY'); fireEvent.change(screen.getByLabelText('Contenu Markdown'), { target: { value: 'œ'.repeat(100_001) } })
    await user.click(screen.getByRole('button', { name: 'Vérifier la mise à jour' })); expect(document.activeElement).toBe(screen.getByLabelText('Contenu Markdown'))
    fireEvent.change(screen.getByLabelText('Contenu Markdown'), { target: { value: 'Valide œ' } }); await user.click(screen.getByRole('button', { name: 'Ajouter Alias' }))
    fireEvent.change(screen.getByLabelText('Alias 2'), { target: { value: 'ALIAS ACTUEL' } }); await user.click(screen.getByRole('button', { name: 'Vérifier la mise à jour' }))
    expect(document.activeElement?.id).toBe('update-entity.aliases'); expect(screen.getByLabelText('Alias 2').getAttribute('aria-invalid')).toBe('true')
  })
  it('returning from PLACE to PERSON clears the final subtype without adopting staging', async () => {
    const calls = api({ prepare: { ...prepared, entity: { ...prepared.entity, kind: 'PLACE', placeKind: 'CITY' } } }), user = userEvent.setup()
    render(<IngestionUpdateForm {...props} />); await screen.findByDisplayValue(prepared.entity.title)
    await user.selectOptions(screen.getByLabelText('Type de fiche'), 'PERSON'); await user.click(screen.getByRole('button', { name: 'Vérifier la mise à jour' }))
    await user.click(screen.getByRole('button', { name: 'Appliquer la mise à jour' })); await waitFor(() => expect(props.onApplied).toHaveBeenCalledOnce())
    expect(JSON.parse(String(calls.find(call => call.init?.method)!.init?.body)).entity.placeKind).toBeNull()
  })
  for (const status of [400, 422, 413]) it(`${status} retains all draft input, requires correction/review and never echoes server details`, async () => {
    api({ writeStatus: status }); const user = userEvent.setup(); render(<IngestionUpdateForm {...props} />); await review(user)
    await user.click(screen.getByRole('button', { name: 'Appliquer la mise à jour' })); const alert = await screen.findByRole('alert')
    expect(document.activeElement).toBe(alert); expect(screen.getByDisplayValue(prepared.staging.title!)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Appliquer la mise à jour' })).toBeNull(); expect(screen.queryByText('Private server detail')).toBeNull()
    api(); fireEvent.change(screen.getByLabelText('Titre'), { target: { value: 'Titre corrigé' } })
    expect(screen.queryByRole('alert')).toBeNull(); await user.click(screen.getByRole('button', { name: 'Vérifier la mise à jour' })); await user.click(screen.getByRole('button', { name: 'Appliquer la mise à jour' }))
    await waitFor(() => expect(props.onApplied).toHaveBeenCalledOnce())
  })
  for (const status of [404, 409, 500]) it(`${status} blocks retries and preserves comparison until the user reloads`, async () => {
    const calls = api({ writeStatus: status }), user = userEvent.setup(); render(<IngestionUpdateForm {...props} />); await review(user)
    await user.click(screen.getByRole('button', { name: 'Appliquer la mise à jour' })); await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: 'Appliquer la mise à jour' }).hasAttribute('disabled')).toBe(true)
    expect(screen.queryByText('Private server detail')).toBeNull(); await user.click(screen.getByRole('button', { name: 'Appliquer la mise à jour' }))
    expect(calls.filter(call => call.init?.method)).toHaveLength(1); expect(props.onApplied).not.toHaveBeenCalled()
  })
  for (const status of [401, 403]) it(`${status} clears the draft and private errors on session/whitelist loss`, async () => {
    api({ writeStatus: status }); const user = userEvent.setup(); render(<IngestionUpdateForm {...props} />); await review(user)
    await user.click(screen.getByRole('button', { name: 'Appliquer la mise à jour' })); await waitFor(() => expect(props.onAccessError).toHaveBeenCalledWith(status))
    expect(screen.queryByText(prepared.staging.title!)).toBeNull(); expect(screen.queryByLabelText('Titre')).toBeNull(); expect(screen.queryByRole('alert')).toBeNull()
  })
  for (const status of [401, 403, 404, 409, 500]) it(`preparation ${status} exposes no draft and no write action`, async () => {
    const calls = api({ readStatus: status }); render(<IngestionUpdateForm {...props} />); const alert = await screen.findByRole('alert')
    expect(document.activeElement).toBe(alert)
    expect(screen.queryByLabelText('Titre')).toBeNull(); expect(screen.queryByRole('button', { name: 'Appliquer la mise à jour' })).toBeNull()
    if (status === 401 || status === 403) expect(props.onAccessError).toHaveBeenCalledWith(status)
    expect(calls.every(call => !call.init?.method)).toBe(true)
  })
  it('PUBLISHED comparison is accessible but every adoption/edit/apply action is disabled', async () => {
    const calls = api({ prepare: { ...prepared, entity: { ...prepared.entity, status: 'PUBLISHED', publishedAt: prepared.expectedEntityUpdatedAt } } })
    render(<IngestionUpdateForm {...props} />); expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Cette fiche est publiée. Retirez d’abord sa publication avant d’appliquer une mise à jour issue du staging.')
    expect(screen.getByRole('region', { name: 'Fiche actuelle' })).toBeTruthy(); expect(screen.getByRole('button', { name: 'Utiliser le titre du staging' }).hasAttribute('disabled')).toBe(true)
    expect((screen.getByLabelText('Titre') as HTMLInputElement).disabled || screen.getByLabelText('Titre').closest('fieldset')?.disabled).toBe(true)
    expect(calls.filter(call => call.init?.method)).toHaveLength(0)
  })
  it('already applied receipts and unsupported/invalid staging values cannot be adopted', async () => {
    api({ prepare: { ...prepared, alreadyApplied: true, warnings: ['Réception déjà appliquée.'], staging: { ...prepared.staging, contentSupported: false, tagsAvailable: false } } })
    render(<IngestionUpdateForm {...props} />); await screen.findByDisplayValue(prepared.entity.title)
    for (const name of ['Utiliser le titre du staging', 'Utiliser le contenu du staging', 'Utiliser les tags du staging', 'Vérifier la mise à jour']) expect(screen.getByRole('button', { name }).hasAttribute('disabled')).toBe(true)
  })
  it('a slow double click sends only one POST and never reports success optimistically', async () => {
    api(); const original = fetch, writes: RequestInit[] = [], user = userEvent.setup(); let complete!: (value: Response) => void
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => { if (init?.method) { writes.push(init); return new Promise<Response>(resolve => { complete = resolve }) } return original(url, init) }))
    render(<IngestionUpdateForm {...props} />); await review(user); const save = screen.getByRole('button', { name: 'Appliquer la mise à jour' })
    fireEvent.click(save); fireEvent.click(save); expect(writes).toHaveLength(1); expect(props.onApplied).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Application…' }).hasAttribute('disabled')).toBe(true)
    await act(async () => { complete(response(applied)) }); expect(props.onApplied).toHaveBeenCalledOnce()
  })
  it('unmount aborts preparation and ignores its late response', async () => {
    let complete!: (value: Response) => void, signal!: AbortSignal
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => { signal = init!.signal!; return new Promise<Response>(resolve => { complete = resolve }) }))
    const { unmount } = render(<IngestionUpdateForm {...props} />); unmount(); expect(signal.aborted).toBe(true)
    await act(async () => { complete(response({}, 401)) }); expect(props.onAccessError).not.toHaveBeenCalled(); expect(props.onApplied).not.toHaveBeenCalled()
  })
  it('switching to another keyed item aborts a pending write and ignores both late success and access errors', async () => {
    for (const status of [200, 401]) {
      api(); const original = fetch, user = userEvent.setup(); let complete!: (value: Response) => void, signal!: AbortSignal
      vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => { if (init?.method) { signal = init.signal!; return new Promise<Response>(resolve => { complete = resolve }) } return original(url, init) }))
      const { rerender, unmount } = render(<IngestionUpdateForm key="first" {...props} />); await review(user)
      await user.click(screen.getByRole('button', { name: 'Appliquer la mise à jour' })); rerender(<IngestionUpdateForm key="second" {...props} itemId={receiptId} />)
      expect(signal.aborted).toBe(true); await act(async () => { complete(response(status === 200 ? applied : {}, status)) })
      expect(props.onApplied).not.toHaveBeenCalled(); expect(props.onAccessError).not.toHaveBeenCalled(); unmount()
    }
  })
  it('network uncertainty disables another application and asks to inspect history', async () => {
    api(); const original = fetch, user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => init?.method ? Promise.reject(new Error('Private narrative')) : original(url, init)))
    render(<IngestionUpdateForm {...props} />); await review(user); await user.click(screen.getByRole('button', { name: 'Appliquer la mise à jour' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Mise à jour non confirmée. Vérifiez la fiche et son historique avant toute nouvelle tentative.')
    expect(screen.getByRole('button', { name: 'Appliquer la mise à jour' }).hasAttribute('disabled')).toBe(true)
  })
  for (const status of ['PROPOSED', 'PUBLISHED', 'ARCHIVED', null] as const) it(`offers update only for a valid confirmed ${status ?? 'absent'} target`, async () => {
    const onPrepareUpdate = vi.fn(), user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(async () => response({ revision: 7, scope: 'EXTERNAL_ID', invalid: status === 'ARCHIVED', confirmed: status ? {
      entity: { ...prepared.entity, status }, origin: 'MANUAL', authorLabel: 'Auteur initial', decidedAt: prepared.expectedEntityUpdatedAt } : null,
      rejectedCandidateIds: [], rejectedCount: 0, recentRejections: [] })))
    render(<IngestionAssociationPanel itemId={itemId} receiptId={receiptId} matches={{ phase: 'ready', data: { status: 'NONE', candidates: [], evaluatedCount: 0,
      exactCandidateCount: 0, strongCandidateCount: 0, approximateEvaluatedCount: 0,
      searchTruncated: false, candidatesTruncated: false, searchLimit: 200, candidateLimit: 10 } }} onRetryMatches={vi.fn()} onAccessError={props.onAccessError} onPrepareUpdate={onPrepareUpdate} />)
    await screen.findByRole('heading', { name: 'Association au Codex' }); await waitFor(() => expect(screen.queryByText('Chargement de l’association…')).toBeNull())
    if (status === 'PROPOSED' || status === 'PUBLISHED') { await user.click(screen.getByRole('button', { name: 'Préparer une mise à jour' })); expect(onPrepareUpdate).toHaveBeenCalledOnce() }
    else expect(screen.queryByRole('button', { name: 'Préparer une mise à jour' })).toBeNull()
  })
})
