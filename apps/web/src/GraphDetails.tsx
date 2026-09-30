import type { GraphEdge, GraphNode, GraphResponse } from '@hesta-codex/shared'
import { kindLabels, placeLabels, visibleConnections } from './graph-model'

export function GraphDetails({ data, selected, selectedEdge, onSelectNode, onOpenNode, onRecenter }: {
  data: GraphResponse
  selected: GraphNode | null
  selectedEdge: GraphEdge | null
  onSelectNode: (id: string) => void
  onOpenNode: (slug: string) => void
  onRecenter: () => void
}) {
  const connections = selected ? visibleConnections(data, selected.id) : []
  const outgoing = connections.filter((edge) => edge.direction === 'outgoing').length
  const incoming = connections.filter((edge) => edge.direction === 'incoming').length
  const symmetric = connections.filter((edge) => edge.direction === 'symmetric').length
  const unique = new Set(connections.map((edge) => edge.otherId)).size
  const byId = new Map(data.nodes.map((node) => [node.id, node]))
  const edgeFrom = selectedEdge ? byId.get(selectedEdge.source) : null
  const edgeTo = selectedEdge ? byId.get(selectedEdge.target) : null

  return <aside className="graph-side" aria-label="Détails du graphe">
    <label>Choisir une fiche<select value={selected?.id ?? ''} onChange={(event) => onSelectNode(event.target.value)}>
      <option value="">Sélectionner…</option>
      {data.nodes.map((node) => <option key={node.id} value={node.id}>{node.title} · {node.slug}</option>)}
    </select></label>
    {selectedEdge && edgeFrom && edgeTo && <div className="graph-edge-detail">
      <h2>Relation sélectionnée</h2>
      <p>{edgeFrom.title} {selectedEdge.symmetric ? '↔' : '→'} {selectedEdge.label} {selectedEdge.symmetric ? '↔' : '→'} {edgeTo.title}</p>
      <small>Type : {selectedEdge.type}</small>
    </div>}
    {selected ? <div className="graph-selected"><h2>{selected.title}</h2>
      <p>{kindLabels[selected.kind]}{selected.kind === 'PLACE' && selected.placeKind
        ? ` · ${placeLabels[selected.placeKind]}` : ''} · /{selected.slug}</p>
      {selected.summary && <p className="graph-summary">{selected.summary}</p>}
      {'status' in selected && 'visibility' in selected &&
        <p>Statut : {String(selected.status)} · Visibilité : {String(selected.visibility)}</p>}
      <p>{outgoing} sortante{outgoing > 1 ? 's' : ''} · {incoming} entrante{incoming > 1 ? 's' : ''}
        {symmetric > 0 && ` · ${symmetric} symétrique${symmetric > 1 ? 's' : ''}`}
        {' · '}{unique} fiche{unique > 1 ? 's' : ''} liée{unique > 1 ? 's' : ''}</p>
      {connections.length > 0 ? <ul>{connections.slice(0, 8).map((edge) => <li key={edge.id}>
        <button type="button" onClick={() => onSelectNode(edge.otherId)}>
          {selected.title} {edge.symmetric ? '↔' : '→'} {edge.displayLabel} {edge.symmetric ? '↔' : '→'} {edge.otherTitle}
          {edge.direction === 'incoming' && <small> · sens inverse</small>}
        </button>
      </li>)}</ul> : <p>Aucune relation visible pour cette fiche.</p>}
      {connections.length > 8 && <p>8 connexions affichées sur {connections.length}.</p>}
      <div className="graph-detail-actions">
        <button type="button" className="graph-open" onClick={() => onOpenNode(selected.slug)}>Ouvrir la fiche</button>
        <button type="button" onClick={onRecenter}>Recentrer sur cette fiche</button>
      </div>
    </div> : <p className="graph-hint">Sélectionnez un nœud avec la recherche, la liste ou le graphe.</p>}
  </aside>
}
