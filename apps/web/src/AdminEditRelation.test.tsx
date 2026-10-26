import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { relationTypeDefinitions, type AdminRelation } from '@hesta-codex/shared'
import { AdminEditRelation } from './AdminEditRelation'

const stamp = '2026-01-01T00:00:00.000Z'
const types = relationTypeDefinitions.map(type => ({ ...type, id: type.code }))
const from = { id: 'a', slug: 'fiche-a', title: 'Fiche fictive A', kind: 'PERSON' as const }
const to = { id: 'b', slug: 'fiche-b', title: 'Fiche fictive B', kind: 'PERSON' as const }
const relation: AdminRelation = { id: 'relation', relationType: types.find(type => type.code === 'works_for')!,
  entity: { ...to, placeKind: null, summary: null, tags: [], status: 'PROPOSED', visibility: 'GM', updatedAt: stamp },
  description: 'Description fictive', status: 'PROPOSED', visibility: 'GM', updatedAt: stamp, evidence: [] }
function setup(options: { relation?: AdminRelation; save?: (input: unknown) => Promise<boolean>; disabled?: boolean } = {}) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => types })))
  const onSave = vi.fn(options.save ?? (async () => true)), onCancel = vi.fn(), onDirty = vi.fn()
  const props = { relation: options.relation ?? relation, from, to, onSave, onCancel, onDirty, busy: false, disabled: options.disabled ?? false }
  const view = render(<AdminEditRelation {...props} />)
  return { onSave, onCancel, onDirty, props, ...view }
}
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('correction humaine du type et du sens', () => {
  it('inverts the two fiches only after an explicit before/after confirmation', async () => {
    const user = userEvent.setup(), { onSave } = setup()
    await user.click(screen.getByRole('button', { name: 'Inverser les fiches' }))
    expect(screen.getByRole('status').textContent).toContain('Fiche fictive B travaille pour Fiche fictive A')
    await user.click(screen.getByRole('button', { name: 'Vérifier la modification' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText('Avant : Fiche fictive A travaille pour Fiche fictive B')).toBeTruthy()
    expect(screen.getByText(/Les preuves et les sources sont conservées/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Confirmer la modification' }))
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ description: relation.description, visibility: 'GM',
      expectedUpdatedAt: stamp, relationCode: 'works_for', reverse: true })
  })

  it('uses the existing catalogue and inverse reading, then permits a different type', async () => {
    const user = userEvent.setup(), { onSave } = setup()
    await screen.findByRole('option', { name: 'emploie' })
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type et sens' }), 'employs')
    expect(screen.getByRole('status').textContent).toContain('Fiche fictive B travaille pour Fiche fictive A')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type et sens' }), 'protects')
    expect(screen.getByRole('status').textContent).toContain('Fiche fictive A protège Fiche fictive B')
    await user.click(screen.getByRole('button', { name: 'Vérifier la modification' }))
    await user.click(screen.getByRole('button', { name: 'Confirmer la modification' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ relationCode: 'protects', reverse: false }))
  })

  it('keeps symmetry non-directional and does not request a semantic change for an equivalent double inversion', async () => {
    const user = userEvent.setup(), { onSave } = setup()
    await screen.findByRole('option', { name: 'emploie' })
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type et sens' }), 'employs')
    await user.click(screen.getByRole('button', { name: 'Inverser les fiches' }))
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))
    expect(onSave).toHaveBeenCalledWith({ description: relation.description, visibility: 'GM', expectedUpdatedAt: stamp })
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type et sens' }), 'allied_with')
    expect(screen.getByRole('button', { name: 'Inverser les fiches' })).toHaveProperty('disabled', true)
  })

  it('warns that a published relation returns to proposed and preserves the original optimistic version on refresh', async () => {
    const user = userEvent.setup(), view = setup({ relation: { ...relation, status: 'PUBLISHED' } })
    await user.click(screen.getByRole('button', { name: 'Inverser les fiches' }))
    view.rerender(<AdminEditRelation {...view.props} relation={{ ...relation, status: 'PUBLISHED', updatedAt: '2026-01-02T00:00:00.000Z' }} />)
    await user.click(screen.getByRole('button', { name: 'Vérifier la modification' }))
    expect(screen.getByText(/retirera la relation de la publication/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Confirmer la modification' }))
    expect(view.onSave).toHaveBeenCalledWith(expect.objectContaining({ expectedUpdatedAt: stamp }))
  })

  it('guards against double confirmation and preserves the correction after an API refusal', async () => {
    let resolve!: (value: boolean) => void
    const pending = new Promise<boolean>(done => { resolve = done })
    const user = userEvent.setup(), { onSave } = setup({ save: async () => pending })
    await user.click(screen.getByRole('button', { name: 'Inverser les fiches' }))
    await user.click(screen.getByRole('button', { name: 'Vérifier la modification' }))
    await user.dblClick(screen.getByRole('button', { name: 'Confirmer la modification' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    resolve(false)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmer la modification' })).toHaveProperty('disabled', false))
    await user.click(screen.getByRole('button', { name: 'Revenir à la correction' }))
    expect(screen.getByRole('status').textContent).toContain('Fiche fictive B travaille pour Fiche fictive A')
  })

  it('allows cancellation without a mutation and blocks disabled sessions', async () => {
    const user = userEvent.setup(), view = setup()
    await user.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(view.onCancel).toHaveBeenCalledTimes(1); expect(view.onSave).not.toHaveBeenCalled()
    view.rerender(<AdminEditRelation {...view.props} disabled />)
    expect(screen.getByRole('button', { name: 'Inverser les fiches' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toHaveProperty('disabled', true)
  })

  it('does not require the full catalogue for a safe reversal, and lets an unavailable catalogue be retried', async () => {
    const user = userEvent.setup()
    let failed = true
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: !failed, status: failed ? 503 : 200, json: async () => types })))
    const onSave = vi.fn(async () => false)
    render(<AdminEditRelation relation={relation} from={from} to={to} onSave={onSave} onCancel={vi.fn()} onDirty={vi.fn()} busy={false} disabled={false} />)
    await screen.findByRole('button', { name: 'Recharger les types' })
    await user.click(screen.getByRole('button', { name: 'Inverser les fiches' }))
    failed = false; await user.click(screen.getByRole('button', { name: 'Recharger les types' }))
    await screen.findByRole('option', { name: 'protège' })
    expect(screen.getByRole('status').textContent).toContain('Fiche fictive B travaille pour Fiche fictive A')
  })
})
