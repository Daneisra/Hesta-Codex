import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AdminEvidence, AdminEvidenceAddRequest, AdminSource } from '@hesta-codex/shared'
import { AdminAddEvidence } from './AdminAddEvidence'

const source: AdminSource = { id: 'source-1', kind: 'MANUAL', label: 'Chronique', externalId: 'ch-1',
  url: null, authorLabel: 'MJ', publishedAt: null, visibility: 'GM', updatedAt: '2026-09-29T10:00:00.000Z' }
const prior: AdminEvidence = { id: 'evidence-1', claimText: 'Barolt est sur l’archipel', sourceExcerpt: null,
  locator: 'p. 1', timeStartSeconds: null, timeEndSeconds: null, confidence: null, visibility: 'GM',
  updatedAt: '2026-09-29T10:00:00.000Z', source }

function setup(options: { previous?: AdminEvidence[]; busy?: boolean; disabled?: boolean;
  error?: { status: number | null; message: string } | null } = {}) {
  const onSave = vi.fn(async (input: AdminEvidenceAddRequest) => { void input; return true })
  const onCancel = vi.fn()
  const onDirty = vi.fn()
  const props = { targetLabel: 'Barolt', previous: options.previous ?? [], busy: options.busy ?? false,
    disabled: options.disabled ?? false, error: options.error ?? null, onSave, onCancel, onDirty }
  const view = render(<AdminAddEvidence {...props} />)
  return { onSave, onCancel, onDirty, rerender: (error: typeof props.error) =>
    view.rerender(<AdminAddEvidence {...props} error={error} />) }
}
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('ajout de provenance', () => {
  it('sélectionne une Source existante, prévient un doublon probable et envoie un payload sans IDs internes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ items: [source], total: 1, page: 1, pageSize: 20 }) })))
    const user = userEvent.setup()
    const { onSave } = setup({ previous: [prior] })
    await screen.findByText('Chronique')
    await user.click(screen.getByRole('radio', { name: /Chronique/ }))
    await user.type(screen.getByLabelText('Énoncé'), 'Barolt est sur l’archipel')
    await user.type(screen.getByLabelText('Repère'), 'p. 2')
    await user.click(screen.getByRole('button', { name: 'Vérifier avant ajout' }))
    expect(screen.getByText(/Une preuve proche existe déjà/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Ajouter la preuve' }))
    expect(onSave).toHaveBeenCalledOnce()
    expect(onSave.mock.calls[0]?.[0]).toEqual({ source: { mode: 'existing', sourceId: source.id },
      evidence: { claimText: 'Barolt est sur l’archipel', sourceExcerpt: null, locator: 'p. 2',
        timeStartSeconds: null, timeEndSeconds: null, confidence: null, visibility: 'GM' } })
  })

  it('crée une Source et conserve la saisie après 409 ou 401', async () => {
    const user = userEvent.setup()
    const { onSave, rerender } = setup()
    await user.click(screen.getByRole('radio', { name: 'Nouvelle source' }))
    await user.type(screen.getByLabelText('Label'), 'Notes de partie')
    await user.type(screen.getByLabelText('Énoncé'), 'Une preuve nouvelle')
    await user.type(screen.getByLabelText('Début en secondes'), '8072')
    expect(screen.getByText('02:14:32')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Vérifier avant ajout' }))
    expect(screen.getByText('Barolt')).toBeTruthy()
    rerender({ status: 409, message: 'Cette preuve existe déjà.' })
    expect(screen.getByRole('alert').textContent).toContain('Cette preuve existe déjà.')
    await user.click(screen.getByRole('button', { name: 'Ajouter la preuve' }))
    expect(onSave).toHaveBeenCalledOnce()
    rerender({ status: 401, message: 'Session expirée.' })
    expect(screen.getByRole('link', { name: /Se reconnecter/ })).toBeTruthy()
    expect(screen.getByText('Une preuve nouvelle')).toBeTruthy()
  })

  it('refuse une preuve vide et affiche une erreur rattachée au champ', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }) })))
    setup()
    await user.click(screen.getByRole('button', { name: 'Vérifier avant ajout' }))
    expect(screen.getByRole('textbox', { name: /Énoncé/ }).getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText('L’énoncé est requis.')).toBeTruthy()
  })

  it('annule les recherches de Source obsolètes via AbortController', async () => {
    const calls: AbortSignal[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url, init: RequestInit) => {
      calls.push(init.signal!)
      return { ok: true, json: async () => ({ items: [source], total: 1, page: 1, pageSize: 20 }) }
    }))
    const user = userEvent.setup()
    setup()
    await screen.findByText('Chronique')
    await user.type(screen.getByRole('searchbox', { name: 'Rechercher une Source' }), 'autre')
    await waitFor(() => expect(calls.length).toBeGreaterThan(1))
    expect(calls[0]!.aborted).toBe(true)
  })
})
