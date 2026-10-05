import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { IngestionMatchCandidate, IngestionMatches, IngestionMatchStatus } from '@hesta-codex/shared'
import { IngestionMatchesPanel } from './IngestionMatchesPanel'

const candidate: IngestionMatchCandidate = { id: '11111111-1111-4111-8111-111111111111', slug: 'fiche-technique',
  title: 'Fiche technique fictive', kind: 'PLACE', placeKind: 'CITY', aliases: ['Alias technique'], status: 'DRAFT', visibility: 'SECRET',
  score: 90, reasons: ['EXACT_ALIAS', 'TITLE_TO_SLUG'] }
const result = (status: IngestionMatchStatus, candidates = [candidate]): IngestionMatches => ({ status, candidates,
  searchTruncated: false, candidatesTruncated: false, evaluatedCount: candidates.length, searchLimit: 200, candidateLimit: 10,
  exactCandidateCount: candidates.length, strongCandidateCount: candidates.length, approximateEvaluatedCount: 0 })
afterEach(cleanup)
describe('inspection des correspondances privées', () => {
  for (const [status, label] of Object.entries({ EXACT: 'Correspondance forte', POSSIBLE: 'Correspondances possibles',
    AMBIGUOUS: 'Plusieurs correspondances possibles', NONE: 'Aucune fiche correspondante détectée' })) {
    it(`renders ${status} with accessible status and no editorial actions`, () => {
      render(<IngestionMatchesPanel load={{ phase: 'ready', data: result(status as IngestionMatchStatus, status === 'NONE' ? [] : [candidate]) }} onRetry={vi.fn()} />)
      expect(screen.getByRole('status').textContent).toBe(label)
      expect(screen.queryByRole('button', { name: /Fusionner|Associer|Créer|Mettre à jour|Publier/ })).toBeNull()
      if (status !== 'NONE') {
        expect(screen.getByText('Lieu · Ville')).toBeTruthy()
        expect(screen.getByText(/Secret · Signal fort \(90\/100\)/)).toBeTruthy()
        expect(screen.getByText('Alias identique après normalisation exacte')).toBeTruthy()
      }
    })
  }
  it('keeps archived/multiple candidates explicit and warns about both limits even when NONE', () => {
    const data = { ...result('AMBIGUOUS', [candidate, { ...candidate, id: 'second', status: 'ARCHIVED' as const }]), searchTruncated: true, candidatesTruncated: true }
    const { container } = render(<IngestionMatchesPanel load={{ phase: 'ready', data }} onRetry={vi.fn()} />)
    expect(screen.getByText('Archivée')).toBeTruthy()
    expect(container.querySelector('.ingestion-match-archived')).toBeTruthy()
    expect(screen.getByText(/Recherche approximative tronquée/)).toBeTruthy()
    expect(screen.getByText('Les 10 premiers candidats sont affichés.')).toBeTruthy()
    expect(screen.getAllByRole('link')).toHaveLength(2)
    cleanup(); render(<IngestionMatchesPanel load={{ phase: 'ready', data: { ...result('NONE', []), searchTruncated: true } }} onRetry={vi.fn()} />)
    expect(screen.getByText(/d’autres possibilités peuvent exister/)).toBeTruthy()
  })
  it('keeps EXACT when only approximate retrieval was truncated and explains the distinction', () => {
    render(<IngestionMatchesPanel load={{ phase: 'ready', data: { ...result('EXACT'), searchTruncated: true } }} onRetry={vi.fn()} />)
    expect(screen.getByText('Correspondance forte')).toBeTruthy()
    expect(screen.getByText(/Les correspondances exactes restent vérifiées/)).toBeTruthy()
    expect(screen.queryByText(/exigent une inspection humaine/)).toBeNull()
  })
  it('shows loading, generic error, retry and missing receipt states without server error details', async () => {
    const retry = vi.fn(), user = userEvent.setup()
    const { rerender } = render(<IngestionMatchesPanel load={{ phase: 'loading' }} onRetry={retry} />)
    expect(screen.getByRole('status').textContent).toBe('Recherche des correspondances…')
    rerender(<IngestionMatchesPanel load={{ phase: 'error', status: 500 }} onRetry={retry} />)
    expect(screen.getByRole('alert').textContent).toContain('Impossible de charger les correspondances.')
    const button = screen.getByRole('button', { name: 'Réessayer les correspondances' }); button.focus()
    await user.keyboard('{Enter}'); expect(retry).toHaveBeenCalledOnce()
    rerender(<IngestionMatchesPanel load={{ phase: 'error', status: 404 }} onRetry={retry} />)
    expect(screen.getByRole('alert').textContent).toContain('Item ou réception introuvable.')
  })
  it('long and hostile content stays text, with an admin-only keyboard link and no storage/title changes', async () => {
    const title = '<img src=x onerror=alert(1)>' + 'Fiction'.repeat(28), slug = 'f'.repeat(200),
      navigate = vi.fn((event: { preventDefault: () => void }, path: string) => { event.preventDefault(); void path }), user = userEvent.setup()
    const htmlTitle = document.title, path = window.location.href
    const { container } = render(<IngestionMatchesPanel load={{ phase: 'ready', data: result('EXACT', [{ ...candidate, title, slug, aliases: ['a'.repeat(200)] }]) }} onRetry={vi.fn()} onNavigate={navigate} />)
    expect(screen.getByRole('heading', { name: title })).toBeTruthy()
    expect(container.querySelector('img, script')).toBeNull()
    const link = screen.getByRole('link', { name: `Ouvrir la fiche : ${title}` })
    expect(link.getAttribute('href')).toBe(`/admin/fiches/${slug}`)
    link.focus(); await user.keyboard('{Enter}'); expect(navigate).toHaveBeenCalledOnce()
    expect(navigate.mock.calls[0]![1]).toBe(`/admin/fiches/${slug}`)
    expect(document.title).toBe(htmlTitle); expect(window.location.href).toBe(path)
    expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0)
  })
})
