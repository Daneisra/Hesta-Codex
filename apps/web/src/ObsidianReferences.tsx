import type { MouseEvent } from 'react'
import type { AdminEntityDetail, ObsidianReferences as References } from '@hesta-codex/shared'
import type { ReferenceRelationSeed } from './reference-relation'

export function ObsidianReferences({ references, onNavigate, entity, onDefine, disabled }: {
  references: References
  entity?: AdminEntityDetail
  onDefine?: (seed: ReferenceRelationSeed, fromSlug: string) => void
  disabled?: boolean
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, path: string) => void
}) {
  return <section className="admin-section obsidian-references" aria-label="Références Obsidian">
    <h2>Références Obsidian</h2>
    <p>Mentions textuelles calculées depuis le Markdown ; elles ne définissent aucune relation éditoriale.</p>
    <p>{references.stats.occurrences} occurrences · {references.stats.resolved} références uniques résolues · {references.stats.ambiguous} ambiguës
      {' · '}{references.stats.missing} absentes · {references.stats.unassociated} sans fiche associée · {references.stats.unsupported} non prises en charge</p>
    {(['outgoing', 'incoming'] as const).map(direction => <div key={direction}>
      <h3>{direction === 'outgoing' ? 'Fiches mentionnées' : 'Fiches qui mentionnent cette fiche'}</h3>
      {references[direction].length ? <ul>{references[direction].map(connection => {
        const href = `/admin/fiches/${connection.slug}`
        const relations = entity ? [...entity.outgoingRelations, ...entity.incomingRelations]
          .filter(relation => relation.entity.id === connection.id) : []
        return <li key={connection.id}><a href={href} onClick={event => onNavigate(event, href)}>{connection.title}</a>
          {' · '}/{connection.slug} · {connection.occurrences} occurrence{connection.occurrences > 1 ? 's' : ''}
          {relations.map(relation => <p className="admin-muted" key={relation.id}>Relation éditoriale existante :
            {' '}{entity?.outgoingRelations.includes(relation) || relation.relationType.symmetric
              ? relation.relationType.label : relation.relationType.inverseLabel ?? relation.relationType.label}
            {' · '}{relation.status} · {relation.visibility}</p>)}
          {entity && onDefine && entity.id !== connection.id && entity.status !== 'ARCHIVED' && !connection.archived &&
            <button type="button" disabled={disabled} onClick={() => onDefine({
              fromId: direction === 'outgoing' ? entity.id : connection.id,
              toId: direction === 'outgoing' ? connection.id : entity.id,
              toSlug: direction === 'outgoing' ? connection.slug : entity.slug,
              returnSlug: entity.slug, returnTitle: entity.title,
            }, direction === 'outgoing' ? entity.slug : connection.slug)}>Définir une relation</button>}
        </li>
      })}</ul> : <p className="admin-muted">Aucune référence {direction === 'outgoing' ? 'sortante' : 'entrante'}.</p>}
    </div>)}
    {references.diagnostics.length > 0 && <details><summary>Diagnostics ({references.diagnostics.length})</summary>
      <ul>{references.diagnostics.map((diagnostic, index) => <li key={index}>
        <strong>{diagnostic.target || 'Cette note'}{diagnostic.anchor ? `#${diagnostic.anchor}` : ''}</strong>
        {' · '}{diagnostic.message} ({diagnostic.occurrences} occurrence{diagnostic.occurrences > 1 ? 's' : ''})
      </li>)}</ul></details>}
  </section>
}
