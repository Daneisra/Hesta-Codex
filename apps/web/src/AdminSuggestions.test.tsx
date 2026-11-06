import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AdminEntityDetail, LinkSuggestionScan } from '@hesta-codex/shared'
import { AdminLinkSuggestions } from './AdminLinkSuggestions'
import { AdminTermSuggestions } from './AdminTermSuggestions'
import { AdminEditor } from './AdminEditor'

const stamp = '2026-10-01T00:00:00.000Z'
const item = { id: 'a'.repeat(64), fingerprint: 'b'.repeat(64), from: { id: 'source', slug: 'depart', title: 'Départ', status: 'PROPOSED' as const, visibility: 'GM' as const },
  to: { id: 'target', slug: 'cible', title: 'Cible', status: 'PROPOSED' as const, visibility: 'GM' as const },
  occurrences: [{ start: 6, end: 11, text: 'Cible', before: 'Vers : ', after: '.', wikilink: '[[/fiches/cible|Cible]]' }] }
const plan: LinkSuggestionScan = { scannedAt: stamp, entities: 130, connections: 1, occurrences: 1, ambiguous: 1, existing: 12, page: 1, pageSize: 30, items: [item],
  ambiguities: [{ from: item.from, text: 'Commun', candidates: ['Ville /a', 'Personne /b'] }] }
const vocabulary = { tags: [{ value: 'Magie', count: 3 }, { value: 'Combat', count: 2 }], aliases: [{ value: 'La Vigie', owners: [{ id: 'autre', slug: 'autre', title: 'Autre fiche' }] }] }
const terms = { aliases: [{ value: 'Tour bleue', reason: 'Nom écrit dans le contenu.', conflicts: [] }], tags: [{ value: 'Magie', reason: 'Tag existant mentionné.', conflicts: [] }] }
const response = (data: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
function scanner() {
  const callbacks = { onNavigate: vi.fn(event => event.preventDefault()), onAccessError: vi.fn(), onPendingChange: vi.fn(), onDirtyChange: vi.fn(), onChanged: vi.fn() }
  return { ...render(<AdminLinkSuggestions {...callbacks} />), ...callbacks }
}
const openReview = async () => { await screen.findByText('130 fiches analysées', { exact: false }); fireEvent.click(screen.getByRole('button', { name: 'Examiner et lier' })) }
const confirm = () => fireEvent.click(screen.getByRole('checkbox', { name: /J’ai vérifié/ }))

describe('scan des connexions', () => {
  it('performs a read-only scan, explains counts and ambiguities, and requires preview plus human confirmation', async () => {
    const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>(async () => response(plan)); vi.stubGlobal('fetch', fetcher); scanner()
    await openReview()
    expect((screen.getByRole('button', { name: 'Ajouter les liens validés' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('[[/fiches/cible|Cible]]', { exact: false })).toBeTruthy()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({ page: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(screen.queryByRole('checkbox', { name: /J’ai vérifié/ })).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('identifies existing wikilinks to repair and previews the replacement without applying it automatically', async () => {
    const repair = { ...item, occurrences: [{ ...item.occurrences[0]!, text: '[[Cible]]', repair: true }] }
    const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>(async () => response({ ...plan, repairs: 1, items: [repair] }))
    vi.stubGlobal('fetch', fetcher); scanner(); await openReview()
    expect(screen.getByText(/1 wikilinks à réparer/)).toBeTruthy()
    expect(screen.getByText(/leur destination sera corrigée/i)).toBeTruthy()
    expect(screen.getByText('Wikilink à réparer 1 : [[Cible]]')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Ajouter les liens validés' }) as HTMLButtonElement).disabled).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('submits the approved fingerprint once despite double clicks, refreshes the scan and reports the revision', async () => {
    let done: ((value: unknown) => void) | undefined, scans = 0
    const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>((url: string) => url.endsWith('/apply') ? new Promise(resolve => { done = resolve }) : Promise.resolve(response(++scans === 1 ? plan : { ...plan, items: [], connections: 0 })))
    vi.stubGlobal('fetch', fetcher); const callbacks = scanner(); await openReview(); confirm()
    const button = screen.getByRole('button', { name: 'Ajouter les liens validés' }); fireEvent.click(button); fireEvent.click(button)
    expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/apply'))).toHaveLength(1)
    expect(JSON.parse((fetcher.mock.calls.find(([url]) => url.endsWith('/apply'))![1] as RequestInit).body as string)).toEqual({ id: item.id, fingerprint: item.fingerprint, confirm: true })
    done!(response({})); await screen.findByText(/avec une nouvelle révision/)
    await waitFor(() => expect(callbacks.onPendingChange).toHaveBeenLastCalledWith(false))
    expect(callbacks.onPendingChange).toHaveBeenCalledWith(true); expect(callbacks.onChanged).toHaveBeenCalledOnce()
  })
  it('rejects stale approval and disables further application until a fresh scan', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => response(url.endsWith('/apply') ? { error: { message: 'Catalogue modifié. Relancez le scan.' } } : plan, url.endsWith('/apply') ? 409 : 200)))
    scanner(); await openReview(); confirm(); fireEvent.click(screen.getByRole('button', { name: 'Ajouter les liens validés' }))
    await screen.findByRole('alert'); expect((screen.getByRole('button', { name: 'Ajouter les liens validés' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Relancer le scan' })); await waitFor(() => expect(screen.queryByRole('checkbox', { name: /J’ai vérifié/ })).toBeNull())
  })
  for (const status of [401, 403]) it(`clears private results after authentication error ${status}`, async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({}, status))); const callbacks = scanner()
    await waitFor(() => expect(callbacks.onAccessError).toHaveBeenCalledWith(status))
    expect(screen.queryByText('Cible')).toBeNull()
  })
  it('shows the public-content warning and hides suggestions only for the current scan', async () => {
    const fetcher = vi.fn(async () => response({ ...plan, items: [{ ...item, from: { ...item.from, status: 'PUBLISHED', visibility: 'PUBLIC' } }] }))
    vi.stubGlobal('fetch', fetcher); scanner(); await openReview()
    expect(screen.getByText(/modifiera immédiatement son contenu visible/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Masquer pour ce scan' })); expect(screen.queryByRole('checkbox')).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('aborts an outstanding read when leaving the scanner', async () => {
    const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>(() => new Promise(() => {})); vi.stubGlobal('fetch', fetcher)
    const view = scanner(); await waitFor(() => expect(fetcher).toHaveBeenCalledOnce()); const signal = (fetcher.mock.calls[0]![1] as RequestInit).signal!
    view.unmount(); expect(signal.aborted).toBe(true)
  })

  const other = { ...item, id: 'c'.repeat(64), to: { ...item.to, id: 'second', title: 'Autre', slug: 'autre' },
    occurrences: [{ ...item.occurrences[0]!, wikilink: '[[/fiches/autre|Autre]]' }] }
  const batchPlan = { ...plan, connections: 2, occurrences: 2, items: [item, other] }
  const selectAll = () => fireEvent.click(screen.getByRole('checkbox', { name: 'Tout sélectionner sur cette page' }))
  const reviewBatch = () => fireEvent.click(screen.getByRole('button', { name: /Examiner la sélection/ }))

  it('selects several connections, previews them together and submits one confirmed request despite double clicks', async () => {
    let done: ((value: unknown) => void) | undefined, scans = 0
    const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>(url => url.endsWith('/apply-batch')
      ? new Promise(resolve => { done = resolve }) : Promise.resolve(response(++scans === 1 ? batchPlan : { ...batchPlan, items: [], connections: 0 })))
    vi.stubGlobal('fetch', fetcher); const callbacks = scanner(); await screen.findByText(/130 fiches analysées/)
    expect((screen.getByRole('button', { name: /Examiner la sélection/ }) as HTMLButtonElement).disabled).toBe(true)
    selectAll(); reviewBatch()
    expect(screen.getByRole('region', { name: 'Validation groupée' })).toBeTruthy()
    expect(screen.getByText('[[/fiches/autre|Autre]]', { exact: false })).toBeTruthy()
    const button = screen.getByRole('button', { name: 'Valider les connexions sélectionnées' })
    expect((button as HTMLButtonElement).disabled).toBe(true); expect(fetcher).toHaveBeenCalledTimes(1)
    confirm(); fireEvent.click(button); fireEvent.click(button)
    const calls = fetcher.mock.calls.filter(([url]) => url.endsWith('/apply-batch'))
    expect(calls).toHaveLength(1)
    expect(JSON.parse(calls[0]![1]!.body as string)).toEqual({ ids: [item.id, other.id], fingerprint: item.fingerprint, confirm: true })
    done!(response({ connections: 2, occurrences: 2, entities: 1 }))
    await screen.findByText(/2 connexion\(s\) validée\(s\)/)
    await waitFor(() => expect(callbacks.onPendingChange).toHaveBeenLastCalledWith(false))
    expect(callbacks.onChanged).toHaveBeenCalledOnce(); expect(screen.queryByRole('region', { name: 'Validation groupée' })).toBeNull()
  })

  it('keeps only checked items and invalidates confirmation whenever selection changes or an item is hidden', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(batchPlan))); scanner(); await screen.findByText(/130 fiches analysées/)
    selectAll(); reviewBatch(); confirm()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Sélectionner Départ → Autre' }))
    expect(screen.queryByRole('region', { name: 'Validation groupée' })).toBeNull()
    expect((screen.getByRole('checkbox', { name: 'Tout sélectionner sur cette page' }) as HTMLInputElement).indeterminate).toBe(true)
    reviewBatch(); expect((screen.getByRole('checkbox', { name: /J’ai vérifié/ }) as HTMLInputElement).checked).toBe(false)
    expect(screen.getByText(/1 connexion\(s\) · 1 mention\(s\) · 1 fiche/)).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Masquer pour ce scan' })[0]!)
    expect((screen.getByRole('button', { name: /Examiner la sélection/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('requires all batch preview pages and warns about public edits and existing wikilinks to repair', async () => {
    const many = { ...item, from: { ...item.from, status: 'PUBLISHED', visibility: 'PUBLIC' }, occurrences: Array.from({ length: 31 }, (_, start) => ({ ...item.occurrences[0]!, start, repair: true })) }
    vi.stubGlobal('fetch', vi.fn(async () => response({ ...plan, items: [many] }))); scanner(); await screen.findByText(/130 fiches analysées/)
    selectAll(); reviewBatch()
    expect(screen.getByText(/modifiera immédiatement leur contenu visible/)).toBeTruthy()
    expect(screen.getByText(/destination sera corrigée après votre confirmation/)).toBeTruthy()
    expect((screen.getByRole('checkbox', { name: /J’ai vérifié/ }) as HTMLInputElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Afficher les mentions suivantes avant validation' }))
    expect((screen.getByRole('checkbox', { name: /J’ai vérifié/ }) as HTMLInputElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' })); expect(screen.queryByRole('region', { name: 'Validation groupée' })).toBeNull()
  })

  it('clears selection on pagination and rescan, and never applies hidden pages', async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => response({ ...batchPlan, connections: 31, page: JSON.parse(init!.body as string).page }))
    vi.stubGlobal('fetch', fetcher); scanner(); await screen.findByText(/130 fiches analysées/)
    selectAll(); fireEvent.click(screen.getByRole('button', { name: 'Suivant' })); await screen.findByText('Page 2')
    expect((screen.getByRole('button', { name: /Examiner la sélection/ }) as HTMLButtonElement).disabled).toBe(true)
    selectAll(); fireEvent.click(screen.getByRole('button', { name: 'Relancer le scan' })); await screen.findByText('Page 1')
    expect((screen.getByRole('checkbox', { name: 'Tout sélectionner sur cette page' }) as HTMLInputElement).checked).toBe(false)
    expect(fetcher.mock.calls).toHaveLength(3)
  })

  for (const status of [409, 500, 401]) it(`requires a fresh scan after batch error ${status} and retains no confirmation`, async () => {
    const fetcher = vi.fn(async (url: string) => response(url.endsWith('/apply-batch') ? { error: { message: 'Erreur de validation.' } } : batchPlan,
      url.endsWith('/apply-batch') ? status : 200))
    vi.stubGlobal('fetch', fetcher); const callbacks = scanner(); await screen.findByText(/130 fiches analysées/)
    selectAll(); reviewBatch(); confirm(); fireEvent.click(screen.getByRole('button', { name: 'Valider les connexions sélectionnées' }))
    await screen.findByRole('alert')
    if (status === 401) { expect(callbacks.onAccessError).toHaveBeenCalledWith(401); expect(screen.queryByRole('region', { name: 'Validation groupée' })).toBeNull() }
    else expect((screen.getByRole('button', { name: 'Valider les connexions sélectionnées' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('suggestions d’alias et de tags', () => {
  const props = { title: 'Tour', bodyMarkdown: 'Surnommée « Tour bleue ». Magie.', aliases: '', tags: '', disabled: false }
  const open = () => fireEvent.click(screen.getByText('Suggestions d’alias et de tags'))
  it('loads vocabulary only when requested, completes a typed tag, and never saves automatically', async () => {
    const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>(async () => response(vocabulary)), onChange = vi.fn(); vi.stubGlobal('fetch', fetcher)
    render(<AdminTermSuggestions {...props} tags="Mag" onChange={onChange} />); expect(fetcher).not.toHaveBeenCalled(); open()
    fireEvent.click(await screen.findByRole('button', { name: 'Compléter le tag Magie' }))
    expect(onChange).toHaveBeenCalledWith('tags', 'Magie'); expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('shows ownership and ambiguity warning before reusing another fiche’s alias', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(vocabulary))); const onChange = vi.fn()
    render(<AdminTermSuggestions {...props} aliases="La V" onChange={onChange} />); open()
    fireEvent.click(await screen.findByRole('button', { name: 'La Vigie' })); expect(onChange).toHaveBeenCalledWith('aliases', 'La Vigie')
    expect(screen.getByText(/rendre les liens ambigus/)).toBeTruthy(); expect(screen.getByText(/utilisé par Autre fiche/)).toBeTruthy()
  })
  it('analyzes the current draft and adds a candidate only on a separate human click', async () => {
    const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>(async (url: string) => response(url.endsWith('/terms') ? terms : vocabulary)), onChange = vi.fn(); vi.stubGlobal('fetch', fetcher)
    render(<AdminTermSuggestions {...props} onChange={onChange} />); open(); fireEvent.click(screen.getByRole('button', { name: 'Analyser le contenu pour des alias et tags' }))
    const choice = await screen.findByRole('button', { name: 'Ajouter l’alias Tour bleue' }); expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(choice); expect(onChange).toHaveBeenCalledWith('aliases', 'Tour bleue')
    const call = fetcher.mock.calls.find(([url]) => url.endsWith('/terms'))!
    expect(JSON.parse((call[1] as RequestInit).body as string).bodyMarkdown).toBe(props.bodyMarkdown)
  })
  it('ignores a delayed analysis after the draft text has changed', async () => {
    let done: ((value: unknown) => void) | undefined
    vi.stubGlobal('fetch', vi.fn((url: string) => url.endsWith('/terms') ? new Promise(resolve => { done = resolve }) : Promise.resolve(response(vocabulary))))
    const view = render(<AdminTermSuggestions {...props} onChange={vi.fn()} />); open(); fireEvent.click(screen.getByRole('button', { name: 'Analyser le contenu pour des alias et tags' }))
    view.rerender(<AdminTermSuggestions {...props} bodyMarkdown="Autre texte" onChange={vi.fn()} />); done!(response(terms))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Analyser le contenu pour des alias et tags' }) as HTMLButtonElement).disabled).toBe(false))
    expect(screen.queryByRole('button', { name: 'Ajouter l’alias Tour bleue' })).toBeNull()
  })
  it('keeps the current edit and its usual save workflow when selecting a proposed tag', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(vocabulary))); const onSave = vi.fn()
    const entity: AdminEntityDetail = { id: '00000000-0000-4000-8000-000000000001', slug: 'tour', kind: 'PLACE', placeKind: 'OTHER', title: 'Tour',
      bodyMarkdown: 'Texte original.', summary: null, aliases: [], tags: [], status: 'PROPOSED', visibility: 'GM', publishedAt: null,
      createdAt: stamp, updatedAt: stamp, evidence: [], revisions: [], outgoingRelations: [], incomingRelations: [] }
    render(<AdminEditor entity={entity} busy={false} saveDisabled={false} error={null} onSave={onSave} onCancel={vi.fn()} onDirtyChange={vi.fn()} />)
    open(); fireEvent.click(await screen.findByRole('button', { name: 'Compléter le tag Magie' })); expect(onSave).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' })); expect(onSave.mock.calls[0]![0].tags).toEqual(['Magie'])
    expect(onSave.mock.calls[0]![0].bodyMarkdown).toBe('Texte original.')
  })
})
