import { memo, useEffect, useMemo, useRef } from 'react'
import type { GraphEdge, GraphNode, GraphResponse } from '@hesta-codex/shared'
import { kindLabels, placeLabels, visibleConnections, type GraphIndex } from './graph-model'

export const GraphDetails = memo(function GraphDetails({ data, index, totalIndex, focusToken, selected, selectedEdge, onSelectNode, onOpenNode, onRecenter }: {
  data: GraphResponse
  index: GraphIndex
  totalIndex: GraphIndex
  focusToken: number
  selected: GraphNode | null
  selectedEdge: GraphEdge | null
  onSelectNode: (id: string, focusDetails?: boolean) => void
  onOpenNode: (slug: string) => void
  onRecenter: () => void
}) {
  const selectedId = selected?.id
  const headingRef = useRef<HTMLHeadingElement>(null)
  const lastFocusToken = useRef(0)
  useEffect(() => {
    if (selectedId && focusToken !== lastFocusToken.current) {
      headingRef.current?.focus()
      lastFocusToken.current = focusToken
    }
  }, [selectedId, focusToken])
  const connections = useMemo(() => selectedId ? visibleConnections(data, selectedId, index) : [], [data, index, selectedId])
  const total = selectedId ? totalIndex.incidentEdges.get(selectedId)?.length ?? 0 : 0
  const referenceCount = selectedId ? totalIndex.incidentEdges.get(selectedId)?.filter(edge => edge.origin === 'OBSIDIAN').length ?? 0 : 0
  const outgoing = connections.filter((edge) => edge.direction === 'outgoing').length
  const incoming = connections.filter((edge) => edge.direction === 'incoming').length
  const symmetric = connections.filter((edge) => edge.direction === 'symmetric').length
  const unique = new Set(connections.map((edge) => edge.otherId)).size
  const edgeFrom = selectedEdge ? index.nodes.get(selectedEdge.source) : null
  const edgeTo = selectedEdge ? index.nodes.get(selectedEdge.target) : null

  return <aside className="graph-side" aria-label="Détails du graphe">
    <label>Choisir une fiche<select value={selected?.id ?? ''} onChange={(event) => onSelectNode(event.target.value)}>
      <option value="">Sélectionner…</option>
      {data.nodes.map((node) => <option key={node.id} value={node.id}>{node.title} · {node.slug}</option>)}
    </select></label>
    {selectedEdge && edgeFrom && edgeTo && <div className="graph-edge-detail">
      <h2>{selectedEdge.origin === 'OBSIDIAN' ? 'Référence Obsidian sélectionnée' : 'Relation sélectionnée'}</h2>
      <p>{edgeFrom.title} {selectedEdge.symmetric ? '↔' : '→'} {selectedEdge.label} {selectedEdge.symmetric ? '↔' : '→'} {edgeTo.title}</p>
      <small>Type : {selectedEdge.type}</small>
      {selectedEdge.origin === 'OBSIDIAN' && <p>Mention textuelle · {selectedEdge.occurrences} occurrences. Aucune relation éditoriale créée.</p>}
    </div>}
    {selected ? <div className="graph-selected"><p className="section-eyebrow">Fiche sélectionnée</p>
      <h2 ref={headingRef} tabIndex={-1}>{selected.title}</h2>
      <p>{kindLabels[selected.kind]}{selected.kind === 'PLACE' && selected.placeKind
        ? ` · ${placeLabels[selected.placeKind]}` : ''} · /{selected.slug}</p>
      {selected.summary && <p className="graph-summary">{selected.summary}</p>}
      {'status' in selected && 'visibility' in selected &&
        <p>Statut : {String(selected.status)} · Visibilité : {String(selected.visibility)}</p>}
      <p><strong>{total} {referenceCount ? `connexion${total > 1 ? 's' : ''}` : `relation${total > 1 ? 's' : ''}`} au total</strong> dans le graphe chargé.
        {total !== connections.length && ` ${connections.length} affichée${connections.length > 1 ? 's' : ''} avec ces filtres.`}</p>
      {referenceCount > 0 && <p>{referenceCount} référence{referenceCount > 1 ? 's' : ''} Obsidian · {total - referenceCount} relations éditoriales.</p>}
      <p>{outgoing} sortante{outgoing > 1 ? 's' : ''} · {incoming} entrante{incoming > 1 ? 's' : ''}
        {symmetric > 0 && ` · ${symmetric} symétrique${symmetric > 1 ? 's' : ''}`}
        {' · '}{unique} fiche{unique > 1 ? 's' : ''} liée{unique > 1 ? 's' : ''}</p>
      {connections.length > 0 ? <ul>{connections.slice(0, 8).map((edge) => <li key={edge.id}>
        <button type="button" onClick={() => onSelectNode(edge.otherId, true)}>
          {selected.title} {edge.symmetric ? '↔' : '→'} {edge.displayLabel} {edge.symmetric ? '↔' : '→'} {edge.otherTitle}
          {edge.direction === 'incoming' && <small> · sens inverse</small>}
        </button>
      </li>)}</ul> : <p>Aucune {referenceCount ? 'connexion' : 'relation'} visible pour cette fiche.</p>}
      {connections.length > 8 && <p>8 connexions affichées sur {connections.length}.</p>}
      <div className="graph-detail-actions">
        <button type="button" className="graph-open" onClick={() => onOpenNode(selected.slug)}>Ouvrir la fiche</button>
        <button type="button" onClick={onRecenter}>Recentrer sur cette fiche</button>
      </div>
    </div> : <p className="graph-hint">Sélectionnez un nœud avec la recherche, la liste ou le graphe.</p>}
  </aside>
})
