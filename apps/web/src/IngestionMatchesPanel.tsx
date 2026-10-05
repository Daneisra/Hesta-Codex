import type { MouseEvent } from 'react'
import type { IngestionMatchReason, IngestionMatches } from '@hesta-codex/shared'
import { kindLabels, placeLabels } from './graph-model'

const labels = { EXACT: 'Correspondance forte', AMBIGUOUS: 'Plusieurs correspondances possibles',
  POSSIBLE: 'Correspondances possibles', NONE: 'Aucune fiche correspondante détectée' }
const reasons: Record<IngestionMatchReason, string> = {
  SAME_SOURCE_AND_LOCATOR: 'Même Source et repère de provenance exact', EXACT_TITLE: 'Titre identique après normalisation exacte',
  EXACT_ALIAS: 'Alias identique après normalisation exacte', TITLE_TO_SLUG: 'Slug dérivé du titre (accents et ponctuation simplifiés)',
  EXTERNAL_ID_TO_SLUG: 'Slug dérivé du nom de fichier externe', SIMILAR_TITLE: 'Titre proche (similarité ≥ 85 %)',
  SIMILAR_ALIAS: 'Alias proche (similarité ≥ 85 %)',
}
const statuses = { DRAFT: 'Brouillon', PROPOSED: 'Proposition', PUBLISHED: 'Publiée', ARCHIVED: 'Archivée' }
const visibilities = { PUBLIC: 'Public', PLAYERS: 'Joueurs', GM: 'MJ', SECRET: 'Secret' }
type Load = { phase: 'loading' } | { phase: 'error'; status: number | null } | { phase: 'ready'; data: IngestionMatches }
export function IngestionMatchesPanel({ load, onRetry, onNavigate }: {
  load: Load; onRetry: () => void; onNavigate?: (event: MouseEvent<HTMLAnchorElement>, path: string) => void
}) {
  return <section className="ingestion-matches" aria-labelledby="ingestion-matches-heading">
    <h3 id="ingestion-matches-heading">Correspondances dans le Codex</h3>
    <p>Détection informative · aucune association enregistrée. Le score exprime un signal, pas une probabilité.</p>
    {load.phase === 'loading' && <p role="status">Recherche des correspondances…</p>}
    {load.phase === 'error' && <div role="alert"><p>{load.status === 404 ? 'Item ou réception introuvable.' : 'Impossible de charger les correspondances.'}</p>
      <button type="button" onClick={onRetry}>Réessayer les correspondances</button></div>}
    {load.phase === 'ready' && <>
      <p role="status">{labels[load.data.status]}</p>
      {load.data.status === 'AMBIGUOUS' && <p>Plusieurs fiches fortes ou une fiche forte archivée exigent une inspection humaine.</p>}
      {load.data.strongCandidateCount > 1 && <p>{load.data.strongCandidateCount} fiches fortes détectées.</p>}
      {load.data.searchTruncated && <p className="ingestion-match-warning" role="status">Recherche approximative tronquée : plafond de {load.data.searchLimit} fiches atteint. Les correspondances exactes restent vérifiées ; d’autres possibilités peuvent exister.</p>}
      {load.data.candidatesTruncated && <p>Les {load.data.candidateLimit} premiers candidats sont affichés.</p>}
      <ul className="ingestion-match-list">{load.data.candidates.map(candidate => {
        const path = `/admin/fiches/${encodeURIComponent(candidate.slug)}`
        return <li key={candidate.id} className={candidate.status === 'ARCHIVED' ? 'ingestion-match-archived' : undefined}>
          <h4>{candidate.title}</h4>
          <p>{kindLabels[candidate.kind]}{candidate.placeKind ? ` · ${placeLabels[candidate.placeKind]}` : ''}</p>
          <p className="ingestion-match-slug">Slug : {candidate.slug}</p>
          <p><strong>{statuses[candidate.status]}</strong> · {visibilities[candidate.visibility]} · Signal {candidate.score >= 90 ? 'fort' : 'possible'} ({candidate.score}/100)</p>
          {candidate.status === 'ARCHIVED' && <p className="ingestion-match-warning">Fiche archivée : elle peut expliquer un doublon. Inspection nécessaire.</p>}
          {candidate.aliases.length > 0 && <p>Alias rapprochés : {candidate.aliases.join(' · ')}</p>}
          <ul>{candidate.reasons.map(reason => <li key={reason}>{reasons[reason]}</li>)}</ul>
          <a href={path} onClick={event => onNavigate?.(event, path)} aria-label={`Ouvrir la fiche : ${candidate.title}`}>Ouvrir la fiche</a>
        </li>
      })}</ul>
    </>}
  </section>
}
