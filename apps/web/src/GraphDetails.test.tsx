import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GraphEdge, GraphResponse } from '@hesta-codex/shared'
import { GraphDetails } from './GraphDetails'
import { indexGraph } from './graph-model'

afterEach(cleanup)
const nodes: GraphResponse['nodes'] = ['a', 'b'].map(id => ({ id, slug: id, title: `Fiche fictive ${id}`,
  kind: 'OTHER', placeKind: null, summary: null, aliases: [] }))
const reference: GraphEdge = { id: 'ref-a', source: 'a', target: 'b', origin: 'OBSIDIAN', type: 'OBSIDIAN_REFERENCE',
  label: 'Référence Obsidian', inverseLabel: 'Mentionné par', symmetric: false, occurrences: 3 }
const reverse: GraphEdge = { ...reference, id: 'ref-b', source: 'b', target: 'a', occurrences: 5 }
const editorial: GraphEdge = { id: 'relation', source: 'b', target: 'a', type: 'protects', label: 'protège',
  inverseLabel: 'est protégé par', symmetric: false }
function show(data: GraphResponse) {
  render(<GraphDetails data={data} index={indexGraph(data)} totalIndex={indexGraph(data)} focusToken={0} selected={null}
    selectedEdge={data.edges[0]!} onSelectNode={vi.fn()} onOpenNode={vi.fn()} onRecenter={vi.fn()} />)
}

describe('grouped connection details', () => {
  it('lists both directions and every editorial member separately with occurrence counts', () => {
    const data = { nodes, edges: [reference, reverse, editorial] }, before = structuredClone(data)
    show(data)
    expect(screen.getByRole('heading', { name: 'Connexion sélectionnée' })).toBeTruthy()
    expect(screen.getByText('2 références Obsidian · 8 occurrences · 1 relation éditoriale.')).toBeTruthy()
    expect(screen.getByText('Fiche fictive a → Référence Obsidian → Fiche fictive b')).toBeTruthy()
    expect(screen.getByText('Fiche fictive b → Référence Obsidian → Fiche fictive a')).toBeTruthy()
    expect(screen.getByText('Fiche fictive b → protège → Fiche fictive a')).toBeTruthy()
    expect(screen.getAllByText(/Mention textuelle/)).toHaveLength(2)
    expect(data).toEqual(before)
  })

  it('does not recover removed members from the complete index when a filter leaves one reference', () => {
    const data = { nodes, edges: [reference] }, totalIndex = indexGraph({ nodes, edges: [reference, reverse, editorial] })
    render(<GraphDetails data={data} index={indexGraph(data)} totalIndex={totalIndex} focusToken={0} selected={null}
      selectedEdge={reference} onSelectNode={vi.fn()} onOpenNode={vi.fn()} onRecenter={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Référence Obsidian sélectionnée' })).toBeTruthy()
    expect(screen.queryByText(/protège/)).toBeNull()
    expect(screen.getAllByText(/Mention textuelle/)).toHaveLength(1)
  })

  it('keeps all members of the selected connection accessible beyond the node list limit', () => {
    const edges = Array.from({ length: 12 }, (_, index) => ({ ...editorial, id: `relation-${index}`, label: `Lien fictif ${index}` }))
    show({ nodes, edges })
    expect(screen.getByText('Fiche fictive b → Lien fictif 11 → Fiche fictive a')).toBeTruthy()
    expect(screen.getAllByText('Type : protects')).toHaveLength(12)
  })
})
