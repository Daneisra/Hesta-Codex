import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AdminEntityDetail } from '@hesta-codex/shared'
import { AdminProvenance } from './AdminProvenance'

const updatedAt = '2026-09-28T12:00:00.000Z'
const expectedUpdatedAt = updatedAt
const entity: AdminEntityDetail = {
  id: 'entity-1', slug: 'barolt', kind: 'PERSON', placeKind: null, title: 'Barolt',
  summary: null, bodyMarkdown: '', aliases: [], tags: [], status: 'PROPOSED', visibility: 'GM',
  createdAt: updatedAt, updatedAt, publishedAt: null, revisions: [],
  evidence: [{ id: 'evidence-1', claimText: 'Énoncé', sourceExcerpt: null, locator: 'p. 2',
    timeStartSeconds: 8072, timeEndSeconds: 8080, confidence: '0.800', visibility: 'GM', updatedAt,
    source: { id: 'source-1', kind: 'MANUAL', label: 'Notes', externalId: 'notes-1', url: null,
      authorLabel: 'MJ', publishedAt: null, visibility: 'GM', updatedAt } }],
  outgoingRelations: [{ id: 'relation-1', description: 'Ancienne description', status: 'PROPOSED',
    visibility: 'GM', updatedAt, relationType: { id: 'type-1', code: 'located_in', label: 'situé dans',
      inverseCode: 'contains', inverseLabel: 'contient', symmetric: false },
    entity: { id: 'entity-2', slug: 'archipel', kind: 'PLACE', placeKind: 'REGION', title: 'Archipel',
      summary: null, tags: [], status: 'PROPOSED', visibility: 'GM', updatedAt }, evidence: [] }],
  incomingRelations: [],
}
function setup(options: { data?: AdminEntityDetail; result?: boolean; disabled?: boolean } = {}) {
  const onMutate = vi.fn(async () => options.result ?? true)
  const onDirtyChange = vi.fn()
  const onEditingChange = vi.fn()
  const onNavigate = vi.fn()
  const view = render(<AdminProvenance entity={options.data ?? entity} onNavigate={onNavigate} onMutate={onMutate}
    onDirtyChange={onDirtyChange} onEditingChange={onEditingChange} busy={false}
    disabled={options.disabled ?? false} error={null} />)
  return { onMutate, onDirtyChange, onEditingChange, setDisabled(disabled: boolean) {
    view.rerender(<AdminProvenance entity={options.data ?? entity} onNavigate={onNavigate} onMutate={onMutate}
      onDirtyChange={onDirtyChange} onEditingChange={onEditingChange} busy={false} disabled={disabled} error={null} />)
  } }
}
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('relations et provenance admin', () => {
  it('affiche le libellé inverse depuis la fiche cible et le libellé direct pour une relation symétrique', () => {
    const directed = { ...entity.outgoingRelations[0]!, id: 'directed-in' }
    const symmetric = { ...directed, id: 'symmetric-in', relationType: {
      id: 'type-2', code: 'allied_with', label: 'allié à', inverseCode: null,
      inverseLabel: null, symmetric: true,
    } }
    setup({ data: { ...entity, outgoingRelations: [], incomingRelations: [directed, symmetric] } })
    expect(screen.getByText('contient')).toBeTruthy()
    expect(screen.getByText('allié à')).toBeTruthy()
    expect(screen.queryByText('situé dans')).toBeNull()
  })

  it('affiche une Source partagée une fois par bloc, avec les preuves de chaque cible', () => {
    const relatedEvidence = { ...entity.evidence[0]!, id: 'evidence-relation', claimText: 'Autre preuve' }
    setup({ data: { ...entity, outgoingRelations: [{ ...entity.outgoingRelations[0]!,
      evidence: [relatedEvidence] }] } })
    expect(screen.getAllByRole('button', { name: 'Modifier la source' })).toHaveLength(2)
    expect(screen.getByText('Autre preuve')).toBeTruthy()
  })

  it('édite seulement la description et la visibilité de la relation avec expectedUpdatedAt', async () => {
    const user = userEvent.setup()
    const { onMutate, onDirtyChange } = setup()
    await user.click(screen.getByRole('button', { name: 'Modifier la relation' }))
    await user.clear(screen.getByRole('textbox', { name: 'Description' }))
    await user.type(screen.getByRole('textbox', { name: 'Description' }), 'Nouvelle description')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Visibilité' }), 'PUBLIC')
    expect(onDirtyChange).toHaveBeenCalledWith(true)
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))
    expect(onMutate).toHaveBeenCalledWith('/api/admin/relations/relation-1', 'PATCH', {
      description: 'Nouvelle description', visibility: 'PUBLIC', expectedUpdatedAt,
    })
  })

  it('publie après confirmation et explique la dépendance aux deux fiches', async () => {
    const user = userEvent.setup()
    const confirm = vi.fn(() => true)
    vi.stubGlobal('confirm', confirm)
    const { onMutate } = setup({ data: { ...entity, outgoingRelations: [{ ...entity.outgoingRelations[0]!,
      visibility: 'PUBLIC', evidence: entity.evidence }] } })
    await user.click(screen.getByRole('button', { name: 'Publier la relation' }))
    expect(confirm).toHaveBeenCalledOnce()
    expect(onMutate).toHaveBeenCalledWith('/api/admin/relations/relation-1/publish', 'POST', { expectedUpdatedAt })
    expect(screen.getByText(/reste invisible dans la bibliothèque publique/)).toBeTruthy()
  })

  it('retire une relation et explique pourquoi une relation publiée peut rester invisible', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('confirm', vi.fn(() => true))
    const { onMutate } = setup({ data: { ...entity, outgoingRelations: [{ ...entity.outgoingRelations[0]!,
      status: 'PUBLISHED', visibility: 'PUBLIC' }] } })
    expect(screen.getByText(/l’une de ses fiches n’est pas publique/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Retirer de la publication' }))
    expect(onMutate).toHaveBeenCalledWith('/api/admin/relations/relation-1/unpublish', 'POST', { expectedUpdatedAt })
  })

  it('corrige la Source sans toucher à metadata ni à sa dérivation', async () => {
    const user = userEvent.setup()
    const { onMutate } = setup()
    await user.click(screen.getByRole('button', { name: 'Modifier la source' }))
    await user.clear(screen.getByRole('textbox', { name: 'Label' }))
    await user.type(screen.getByRole('textbox', { name: 'Label' }), 'Notes vérifiées')
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))
    expect(onMutate).toHaveBeenCalledWith('/api/admin/sources/source-1', 'PATCH', {
      kind: 'MANUAL', label: 'Notes vérifiées', externalId: 'notes-1', url: null, authorLabel: 'MJ',
      publishedAt: null, visibility: 'GM', expectedUpdatedAt,
    })
  })

  it('corrige une Evidence et affiche les secondes en HH:MM:SS', async () => {
    const user = userEvent.setup()
    const { onMutate } = setup()
    expect(screen.getByText(/02:14:32/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Modifier la preuve' }))
    await user.clear(screen.getByRole('textbox', { name: 'Énoncé' }))
    await user.type(screen.getByRole('textbox', { name: 'Énoncé' }), 'Énoncé corrigé')
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))
    expect(onMutate).toHaveBeenCalledWith('/api/admin/evidence/evidence-1', 'PATCH', {
      claimText: 'Énoncé corrigé', sourceExcerpt: null, locator: 'p. 2', timeStartSeconds: 8072,
      timeEndSeconds: 8080, confidence: 0.8, visibility: 'GM', expectedUpdatedAt,
    })
  })

  it('conserve la saisie si le serveur refuse la mutation et bloque la session expirée', async () => {
    const user = userEvent.setup()
    const { onMutate, setDisabled } = setup({ result: false })
    await user.click(screen.getByRole('button', { name: 'Modifier la relation' }))
    await user.type(screen.getByRole('textbox', { name: 'Description' }), ' corrigée')
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))
    expect(onMutate).toHaveBeenCalledOnce()
    expect((screen.getByRole('textbox', { name: 'Description' }) as HTMLTextAreaElement).value).toContain('corrigée')
    setDisabled(true)
    expect(screen.getByRole('button', { name: 'Enregistrer' }).hasAttribute('disabled')).toBe(true)
  })

  it('regroupe plusieurs preuves par Source sur la fiche et sur la relation', () => {
    const second = { ...entity.evidence[0]!, id: 'evidence-2', claimText: 'Autre passage' }
    const relationProof = { ...entity.evidence[0]!, id: 'evidence-3', claimText: 'Preuve du lien',
      source: { ...entity.evidence[0]!.source, id: 'source-2', label: 'Session JDR' } }
    setup({ data: { ...entity, evidence: [entity.evidence[0]!, second],
      outgoingRelations: [{ ...entity.outgoingRelations[0]!, evidence: [relationProof] }] } })
    expect(screen.getByText(/1 source\(s\) · 2 preuve\(s\) directement sur la fiche/)).toBeTruthy()
    expect(screen.getByText(/Preuves de la relation · 1 source\(s\) · 1 preuve\(s\)/)).toBeTruthy()
    expect(screen.getByText('Autre passage')).toBeTruthy()
    expect(screen.getByText('Preuve du lien')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Modifier la source' })).toHaveLength(2)
  })

  it('n’ouvre qu’un seul éditeur pour une Source partagée entre fiche et relation', async () => {
    const user = userEvent.setup()
    setup({ data: { ...entity, outgoingRelations: [{ ...entity.outgoingRelations[0]!, evidence: [
      { ...entity.evidence[0]!, id: 'relation-evidence', claimText: 'Preuve de la relation' },
    ] }] } })
    const buttons = screen.getAllByRole('button', { name: 'Modifier la source' })
    expect(buttons).toHaveLength(2)
    await user.click(buttons[1]!)
    expect(screen.getAllByRole('button', { name: 'Enregistrer' })).toHaveLength(1)
  })

  it('ajoute une preuve à la relation et affiche la confirmation sans modifier la fiche', async () => {
    const user = userEvent.setup()
    const { onMutate } = setup()
    await user.click(screen.getByRole('button', { name: 'Ajouter une preuve' }))
    await user.click(screen.getByRole('radio', { name: 'Nouvelle source' }))
    await user.type(screen.getByRole('textbox', { name: 'Label' }), 'Session JDR')
    await user.type(screen.getByRole('textbox', { name: 'Énoncé' }), 'Le lien est attesté')
    await user.click(screen.getByRole('button', { name: 'Vérifier avant ajout' }))
    expect(screen.getByText(/Barolt.*Archipel/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Ajouter la preuve' }))
    expect(onMutate).toHaveBeenCalledWith('/api/admin/relations/relation-1/evidence', 'POST',
      expect.objectContaining({ evidence: expect.objectContaining({ claimText: 'Le lien est attesté' }) }))
    expect(screen.queryByRole('button', { name: 'Vérifier avant ajout' })).toBeNull()
  })
})
