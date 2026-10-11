import { useState, type MouseEvent } from 'react'
import type { AdminEntityDetail, ObsidianReferences as References, ReferenceIgnoreRequest } from '@hesta-codex/shared'
import type { ReferenceRelationSeed } from './reference-relation'

export function ObsidianReferences({ references, onNavigate, entity, onDefine, onIgnore, disabled }: {
  references: References
  entity?: AdminEntityDetail
  onDefine?: (seed: ReferenceRelationSeed, fromSlug: string) => void
  onIgnore?: (input: ReferenceIgnoreRequest) => void
  disabled?: boolean
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, path: string) => void
}) {
  const [search, setSearch] = useState('')
  const [pages, setPages] = useState({ outgoing: 1, incoming: 1 })
  const [expanded, setExpanded] = useState<string | null>(null)
  const [sections, setSections] = useState({ outgoing: true, incoming: true })
  const filtered = (direction: 'outgoing' | 'incoming') => references[direction].filter(item =>
    `${item.title} ${item.slug}`.toLocaleLowerCase('fr').includes(search.toLocaleLowerCase('fr')))
  const pageSize = 10
  return <section className="admin-section obsidian-references" aria-label="Références Obsidian">
    <h2>Références Obsidian</h2>
    <p>Mentions textuelles calculées depuis le Markdown ; elles ne définissent aucune relation éditoriale.</p>
    <p>{references.stats.occurrences} occurrences · {references.stats.resolved} références uniques résolues · {references.stats.ambiguous} ambiguës
      {' · '}{references.stats.missing} absentes · {references.stats.unassociated} sans fiche associée · {references.stats.unsupported} non prises en charge</p>
    <label>Rechercher dans les références<input type="search" value={search} maxLength={100}
      onChange={event => { setSearch(event.target.value); setPages({ outgoing: 1, incoming: 1 }) }} /></label>
    {(['outgoing', 'incoming'] as const).map(direction => {
      const list = filtered(direction), page = Math.min(pages[direction], Math.max(1, Math.ceil(list.length / pageSize)))
      return <details key={direction} open={sections[direction]}>
      <summary onClick={event => { event.preventDefault(); setSections(value => ({ ...value, [direction]: !value[direction] })) }}>
        {direction === 'outgoing' ? 'Fiches mentionnées' : 'Fiches qui mentionnent cette fiche'} ({references[direction].length})</summary>
      {sections[direction] && <>
      {list.length ? <ul className="reference-rows">{list.slice((page - 1) * pageSize, page * pageSize).map(connection => {
        const href = `/admin/fiches/${connection.slug}`
        const relations = entity ? [...entity.outgoingRelations, ...entity.incomingRelations]
          .filter(relation => relation.entity.id === connection.id) : []
        const state = connection.qualification?.state ?? (relations.length ? 'QUALIFIED' : 'PENDING')
        const key = `${direction}:${connection.id}`, isExpanded = expanded === key
        const canDefine = entity && onDefine && entity.id !== connection.id && entity.status !== 'ARCHIVED' && !connection.archived
        const define = () => entity && onDefine && onDefine({
          fromId: direction === 'outgoing' ? entity.id : connection.id,
          toId: direction === 'outgoing' ? connection.id : entity.id,
          toSlug: direction === 'outgoing' ? connection.slug : entity.slug,
          returnSlug: entity.slug, returnTitle: entity.title,
        }, direction === 'outgoing' ? entity.slug : connection.slug)
        const decision = (ignore: boolean) => entity && connection.qualification && onIgnore?.({
          fromEntityId: direction === 'outgoing' ? entity.id : connection.id,
          toEntityId: direction === 'outgoing' ? connection.id : entity.id,
          fingerprint: connection.qualification.fingerprint, expectedDecisionRevision: connection.qualification.decisionRevision, ignore,
        })
        return <li key={connection.id}><a href={href} onClick={event => onNavigate(event, href)}>{connection.title}</a>
          {' · '}/{connection.slug} · {connection.occurrences} occurrence{connection.occurrences > 1 ? 's' : ''}
          {' · '}<span className="admin-badge">{state === 'QUALIFIED' ? 'Qualifiée' : state === 'IGNORED' ? 'Ignorée volontairement' : 'À qualifier'}</span>
          {state === 'PENDING' && canDefine && <button type="button" disabled={disabled} onClick={define}>Définir une relation</button>}
          {state === 'IGNORED' && onIgnore && <button type="button" disabled={disabled} onClick={() => decision(false)}>Révoquer l’ignorance</button>}
          <button type="button" aria-expanded={isExpanded} aria-controls={`reference-${direction}-${connection.id}`}
            onClick={() => setExpanded(isExpanded ? null : key)}>Examiner</button>
          {isExpanded && <div id={`reference-${direction}-${connection.id}`}>
          {relations.map(relation => <p className="admin-muted" key={relation.id}>Relation éditoriale existante :
            {' '}{entity?.outgoingRelations.includes(relation) || relation.relationType.symmetric
              ? relation.relationType.label : relation.relationType.inverseLabel ?? relation.relationType.label}
            {' · '}{relation.status} · {relation.visibility}</p>)}
          {connection.origin && <p className="admin-muted">Origine : {connection.origin.path} · Source {connection.origin.sourceId}</p>}
          {connection.qualification?.stale && <p>La référence d’origine a changé : ancienne décision à revoir.</p>}
          {connection.qualification?.ignoredBy && <p>Examinée par {connection.qualification.ignoredBy} · {connection.qualification.ignoredAt}</p>}
          {state !== 'PENDING' && canDefine && <button type="button" disabled={disabled} onClick={define}>Définir une relation</button>}
          {state === 'PENDING' && connection.qualification && onIgnore && <button type="button" disabled={disabled} onClick={() => decision(true)}>Ignorer volontairement</button>}
          {state !== 'IGNORED' && connection.qualification?.decisionRevision && onIgnore &&
            <button type="button" disabled={disabled} onClick={() => decision(false)}>Révoquer l’ignorance</button>}
          </div>}
        </li>
      })}</ul> : <p className="admin-muted">Aucune référence {direction === 'outgoing' ? 'sortante' : 'entrante'}.</p>}
      {list.length > pageSize && <div className="admin-pagination"><button type="button" disabled={page <= 1}
        onClick={() => setPages(value => ({ ...value, [direction]: page - 1 }))}>Précédent</button>
        <span>{list.length} résultat(s) · Page {page}</span><button type="button" disabled={page * pageSize >= list.length}
          onClick={() => setPages(value => ({ ...value, [direction]: page + 1 }))}>Suivant</button></div>}
      </>}
    </details>})}
    {references.diagnostics.length > 0 && <details><summary>Diagnostics ({references.diagnostics.length})</summary>
      <ul>{references.diagnostics.map((diagnostic, index) => <li key={index}>
        <strong>{diagnostic.target || 'Cette note'}{diagnostic.anchor ? `#${diagnostic.anchor}` : ''}</strong>
        {' · '}{diagnostic.message} ({diagnostic.occurrences} occurrence{diagnostic.occurrences > 1 ? 's' : ''})
      </li>)}</ul></details>}
  </section>
}
