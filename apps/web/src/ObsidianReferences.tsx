import type { MouseEvent } from 'react'
import type { ObsidianReferences as References } from '@hesta-codex/shared'

export function ObsidianReferences({ references, onNavigate }: {
  references: References
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
        return <li key={connection.id}><a href={href} onClick={event => onNavigate(event, href)}>{connection.title}</a>
          {' · '}/{connection.slug} · {connection.occurrences} occurrence{connection.occurrences > 1 ? 's' : ''}</li>
      })}</ul> : <p className="admin-muted">Aucune référence {direction === 'outgoing' ? 'sortante' : 'entrante'}.</p>}
    </div>)}
    {references.diagnostics.length > 0 && <details><summary>Diagnostics ({references.diagnostics.length})</summary>
      <ul>{references.diagnostics.map((diagnostic, index) => <li key={index}>
        <strong>{diagnostic.target || 'Cette note'}{diagnostic.anchor ? `#${diagnostic.anchor}` : ''}</strong>
        {' · '}{diagnostic.message} ({diagnostic.occurrences} occurrence{diagnostic.occurrences > 1 ? 's' : ''})
      </li>)}</ul></details>}
  </section>
}
