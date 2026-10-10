import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { wikiOccurrences, type WikiNavigation, type ObsidianReferences as References } from '@hesta-codex/shared'
import { WikiMarkdown, scrollToWikiAnchor } from './WikiMarkdown'
import { ObsidianReferences } from './ObsidianReferences'
const stamp = '2026-10-01T00:00:00.000Z'
function navigation(body: string, href: string | null = '/admin/fiches/cible'): WikiNavigation {
  return { updatedAt: stamp, links: wikiOccurrences(body).filter(link => !link.embed).map(({ start, end, label }) => ({ start, end, label, href })) }
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/') })

describe('rendu des wikilinks', () => {
  it('renders resolved names, paths, aliases and accents as internal links without rewriting the source', () => {
    const body = '[[Été]] [[Dossier/Été|Un alias]] [[Été#Histoire]]', onNavigate = vi.fn(event => event.preventDefault())
    render(<WikiMarkdown body={body} updatedAt={stamp} navigation={navigation(body)} admin onNavigate={onNavigate} />)
    expect(screen.getAllByRole('link').map(link => link.textContent)).toEqual(['Été', 'Un alias', 'Été'])
    expect(screen.getAllByRole('link').every(link => link.getAttribute('href') === '/admin/fiches/cible')).toBe(true)
    fireEvent.click(screen.getByRole('link', { name: 'Un alias' }))
    expect(onNavigate).toHaveBeenCalledOnce()
    expect(body).toContain('[[Dossier/Été|Un alias]]')
  })
  it('keeps absent or ambiguous destinations readable with no navigable target', () => {
    const body = '[[Absent|Nom lisible]]'
    render(<WikiMarkdown body={body} updatedAt={stamp} navigation={navigation(body, null)} admin onNavigate={vi.fn()} />)
    expect(screen.getByText('Nom lisible')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })
  it('preserves inline and nested fenced code, escaped wikilinks, ordinary links and emphasis', () => {
    const body = '**Avant** &amp; \\[[Littéral]] [[Cible|Lien]] `[[Code]]`\n\n> ```md\n> [[Bloc]]\n> ```\n\n[Classique [[inchangé]]](https://example.test)'
    const { container } = render(<WikiMarkdown body={body} updatedAt={stamp} navigation={navigation(body)} admin onNavigate={vi.fn()} />)
    expect(screen.getByRole('link', { name: 'Lien' }).getAttribute('href')).toBe('/admin/fiches/cible')
    expect(screen.getByRole('link', { name: 'Classique [[inchangé]]' }).getAttribute('href')).toBe('https://example.test')
    expect(container.querySelector('strong')?.textContent).toBe('Avant')
    expect([...container.querySelectorAll('code')].map(code => code.textContent?.trim())).toEqual(['[[Code]]', '[[Bloc]]'])
    expect(container.textContent).toContain('& [[Littéral]] Lien')
    expect(screen.getAllByRole('link')).toHaveLength(2)
  })
  it('handles literal backslashes before a valid link without converting the earlier escaped reference', () => {
    const body = '\\[[Même]] puis \\\\[[Même]]'
    const { container } = render(<WikiMarkdown body={body} updatedAt={stamp} navigation={navigation(body)} admin onNavigate={vi.fn()} />)
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(container.textContent).toBe('[[Même]] puis \\Même')
  })
  it('resolves multiline blockquotes, list continuations and GFM table aliases while preserving their surrounding text', () => {
    const body = '> Début &amp;\n> [[Cible|Citation]]\n\n- Début\n  [[Cible|Liste]]\n\n| Référence |\n|---|\n|[[Cible\\|Tableau]]|'
    const { container } = render(<WikiMarkdown body={body} updatedAt={stamp} navigation={navigation(body)} admin onNavigate={vi.fn()} />)
    expect(screen.getAllByRole('link').map(link => link.textContent)).toEqual(['Citation', 'Liste', 'Tableau'])
    expect(container.querySelector('blockquote')?.textContent).toContain('Début &\nCitation')
    expect(container.querySelector('li')?.textContent).toContain('Début\nListe')
    expect(container.querySelector('td')?.textContent).toBe('Tableau')
  })
  it('creates stable unique heading identifiers and focuses reliable anchors', () => {
    const body = '## Histoire & époque\n\n## Histoire & époque'
    render(<WikiMarkdown body={body} updatedAt={stamp} onNavigate={vi.fn()} />)
    const headings = screen.getAllByRole('heading')
    expect(headings.map(heading => heading.id)).toEqual(['obsidian-histoire-époque', 'obsidian-histoire-époque-1'])
    window.history.replaceState(null, '', '/fiches/cible#obsidian-histoire-%C3%A9poque')
    scrollToWikiAnchor()
    expect(document.activeElement).toBe(headings[0])
  })
  it('restores section focus on same-fiche browser history navigation', async () => {
    render(<WikiMarkdown body={'## Première\n\n## Seconde'} updatedAt={stamp} onNavigate={vi.fn()} />)
    window.history.replaceState(null, '', '/fiches/cible#obsidian-seconde')
    window.dispatchEvent(new PopStateEvent('popstate'))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Seconde' })))
    window.history.replaceState(null, '', '/fiches/cible#obsidian-premi%C3%A8re')
    window.dispatchEvent(new PopStateEvent('popstate'))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Première' })))
  })
  it('does not apply stale navigation offsets to a changed body', () => {
    const body = '[[Cible]]'
    render(<WikiMarkdown body={body} updatedAt="newer" navigation={navigation(body)} admin onNavigate={vi.fn()} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('[[Cible]]')).toBeTruthy()
  })
  it('uses public links only from the public projection and leaves private destinations unlinked', () => {
    const body = '[[Public]] [[Privé]]', nav = navigation(body, '/fiches/cible')
    nav.links[1]!.href = null
    render(<WikiMarkdown body={body} updatedAt={stamp} navigation={nav} onNavigate={vi.fn()} />)
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Public' }).getAttribute('href')).toBe('/fiches/cible')
    expect(screen.getByText('Privé')).toBeTruthy()
  })
  it('preserves safe handling of HTML, dangerous Markdown URLs and administrator remote images', () => {
    const body = '<script>alert(1)</script>\n\n[danger](javascript:alert(1))\n\n![Illustration](https://example.test/image.png)'
    const { container } = render(<WikiMarkdown body={body} updatedAt={stamp} admin onNavigate={vi.fn()} />)
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('a')?.getAttribute('href')).toBe('')
    expect(screen.getByText('Image non chargée : Illustration')).toBeTruthy()
  })
  it('does not convert references in YAML frontmatter or embedded notes', () => {
    const body = '---\naliases: [[Métadonnée]]\n---\n\n![[Inclusion]]\n\n[[Cible]]'
    render(<WikiMarkdown body={body} updatedAt={stamp} navigation={navigation(body)} admin onNavigate={vi.fn()} />)
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.getByRole('link').textContent).toBe('Cible')
  })
})

describe('références administrateur', () => {
  it('distinguishes outgoing and incoming textual mentions from relations and explains unresolved links', () => {
    const refs: References = { updatedAt: stamp, links: [], stats: { occurrences: 4, resolved: 2, ambiguous: 1, missing: 0, unassociated: 1, unsupported: 0 },
      outgoing: [{ id: 'a', slug: 'homonyme-ville', title: 'Homonyme', occurrences: 2 }],
      incoming: [{ id: 'b', slug: 'source', title: 'Source', occurrences: 1 }], diagnostics: [
        { target: 'Vide', anchor: null, status: 'UNASSOCIATED', message: 'Note connue sans fiche associée.', occurrences: 1 },
      ] }
    render(<ObsidianReferences references={refs} onNavigate={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Fiches mentionnées' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Fiches qui mentionnent cette fiche' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Homonyme' }).getAttribute('href')).toBe('/admin/fiches/homonyme-ville')
    expect(screen.getByText(/aucune relation éditoriale/)).toBeTruthy()
    expect(screen.getByText(/Note connue sans fiche associée/)).toBeTruthy()
  })
})
