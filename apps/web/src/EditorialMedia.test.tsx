import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AdminEntityDetail } from '@hesta-codex/shared'
import { AdminEditor } from './AdminEditor'
import { AdminCreate } from './AdminCreate'
import { AdminImageUpload } from './AdminImageUpload'
import { WikiMarkdown } from './WikiMarkdown'
import { MarkdownHelp } from './MarkdownHelp'

const stamp = '2026-01-01T00:00:00.000Z'
const image = { id: '00000000-0000-4000-8000-000000000009', url: '/api/images/00000000-0000-4000-8000-000000000009', width: 3, height: 2, byteSize: 80 }
const entity: AdminEntityDetail = { id: 'fiche-fictive', slug: 'fiche-fictive', kind: 'PERSON', placeKind: null, title: 'Fiche fictive', summary: null,
  aliases: [], tags: [], status: 'PROPOSED', visibility: 'GM', bodyMarkdown: 'Texte original.', createdAt: stamp, updatedAt: stamp,
  publishedAt: null, evidence: [], incomingRelations: [], outgoingRelations: [], revisions: [] }
const file = () => new File(['synthetic-image'], 'illustration.png', { type: 'image/png' })
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
function editor() {
  const onSave = vi.fn(), onDirtyChange = vi.fn(), onUploadPending = vi.fn(), onUploadAccessError = vi.fn()
  render(<AdminEditor entity={entity} busy={false} saveDisabled={false} error={null} onSave={onSave} onCancel={vi.fn()}
    onDirtyChange={onDirtyChange} onUploadPending={onUploadPending} onUploadAccessError={onUploadAccessError} />)
  return { onSave, onDirtyChange, onUploadPending, onUploadAccessError }
}
const selectFile = (value = file()) => fireEvent.change(screen.getByLabelText('Importer une image'), { target: { files: [value] } })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('images et aide des formulaires éditoriaux', () => {
  it('propose une aide native repliée par défaut, précise les formats pris en charge et ne déclenche aucune requête', () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    const { container } = render(<MarkdownHelp />)
    const details = container.querySelector('details')!
    expect(details.open).toBe(false)
    fireEvent.click(screen.getByText('Aide Markdown')); expect(details.open).toBe(true)
    expect(screen.getByText('Titres (niveaux 1 à 6)')).toBeTruthy()
    expect(screen.getByText('Tableaux')).toBeTruthy(); expect(screen.getByText('Liens entre fiches Obsidian')).toBeTruthy()
    expect(screen.getByText(/Le HTML brut et les scripts sont ignorés/)).toBeTruthy()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('importe une image dans la modification, conserve le texte et affiche un aperçu puis enregistre le PJ avec son Markdown', async () => {
    const fetcher = vi.fn(async () => response(image, 201)); vi.stubGlobal('fetch', fetcher)
    const { onSave, onUploadPending } = editor()
    fireEvent.change(screen.getByLabelText('Description de l’image (texte alternatif)'), { target: { value: 'Portrait fictif' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Type' }), { target: { value: 'PLAYER_CHARACTER' } })
    selectFile()
    const preview = await screen.findByRole('img', { name: 'Portrait fictif' })
    expect(screen.getByText('Image ajoutée au contenu. Enregistrez la fiche pour la conserver.')).toBeTruthy()
    expect(preview.getAttribute('src')).toBe(image.url)
    expect(fetcher).toHaveBeenCalledWith('/api/admin/images', expect.objectContaining({ method: 'POST', cache: 'no-store', credentials: 'same-origin',
      headers: { 'Content-Type': 'image/png', Accept: 'application/json' }, body: expect.any(File) }))
    const body = `Texte original.\n\n![Portrait fictif](${image.url})\n`
    expect(screen.getByRole('textbox', { name: 'Contenu Markdown' })).toHaveProperty('value', body)
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ kind: 'PLAYER_CHARACTER', bodyMarkdown: body, expectedUpdatedAt: stamp }))
    expect(onUploadPending.mock.calls).toEqual([[true], [false]])
  })

  it('propose la même aide et le même import dans une nouvelle fiche, avec des types PJ/PNJ distincts', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/admin/images' ? response(image, 201) : response({ items: [], total: 0, page: 1, pageSize: 20 })))
    render(<AdminCreate busy={false} disabled={false} error={null} onCreate={vi.fn()} onClearError={vi.fn()} onDirtyChange={vi.fn()} onNavigate={vi.fn()} />)
    expect(screen.getByText('Aide Markdown')).toBeTruthy()
    expect(screen.getByRole('option', { name: 'PERSON (PNJ)' })).toHaveProperty('value', 'PERSON')
    expect(screen.getByRole('option', { name: 'PLAYER_CHARACTER (PJ)' })).toHaveProperty('value', 'PLAYER_CHARACTER')
    selectFile()
    await screen.findByRole('img', { name: 'Illustration' })
    expect(screen.getByRole('textbox', { name: 'Contenu Markdown' })).toHaveProperty('value', `![Illustration](${image.url})\n`)
  })

  it('désactive la validation et l’annulation pendant l’import et insère dans le texte récent sans écraser une saisie concurrente', async () => {
    let done!: (value: ReturnType<typeof response>) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<ReturnType<typeof response>>(resolve => { done = resolve })))
    const { onSave } = editor(); selectFile()
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Annuler' })).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByRole('textbox', { name: 'Contenu Markdown' }), { target: { value: 'Texte récent.' } })
    done(response(image, 201))
    await screen.findByRole('img')
    expect(screen.getByRole('textbox', { name: 'Contenu Markdown' })).toHaveProperty('value', `Texte récent.\n\n![Illustration](${image.url})\n`)
    expect(onSave).not.toHaveBeenCalled()
  })

  it.each([401, 403, 413, 429, 500])('conserve le Markdown et permet de réessayer après refus HTTP %s', async status => {
    const fetcher = vi.fn(async () => response({ error: { message: 'Refus fictif' } }, status)); vi.stubGlobal('fetch', fetcher)
    const { onSave, onUploadAccessError } = editor(); selectFile()
    await screen.findByRole('alert')
    expect(screen.getByRole('textbox', { name: 'Contenu Markdown' })).toHaveProperty('value', entity.bodyMarkdown)
    expect(onSave).not.toHaveBeenCalled()
    if (status === 401 || status === 403) expect(onUploadAccessError).toHaveBeenCalledWith(status)
    expect(screen.getByLabelText('Importer une image')).toHaveProperty('disabled', false)
  })

  it('refuse les SVG et fichiers trop gros avant toute requête', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); editor()
    selectFile(new File(['<svg/>'], 'image.svg', { type: 'image/svg+xml' }))
    expect(screen.getByRole('alert').textContent).toContain('5 Mio')
    selectFile(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }))
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('échappe le texte alternatif et ne charge aucune image externe dans les aperçus administrateur', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(image, 201))); editor()
    fireEvent.change(screen.getByRole('textbox', { name: 'Contenu Markdown' }), { target: { value: '![Externe](https://example.test/private.png)' } })
    expect(screen.queryByRole('img')).toBeNull()
    fireEvent.change(screen.getByLabelText('Description de l’image (texte alternatif)'), { target: { value: 'A](/evil)![B' } })
    selectFile(); await screen.findByRole('img', { name: 'A](/evil)![B' })
    expect(screen.getAllByRole('img')).toHaveLength(1)
    expect(screen.queryByRole('link', { name: 'A' })).toBeNull()
  })

  it('affiche les images gérées sur les fiches publiques et admin, en gardant les protections du rendu HTML', () => {
    const body = `![Portrait](${image.url})\n\n<script>alert(1)</script>`
    const view = render(<WikiMarkdown body={body} updatedAt={stamp} admin onNavigate={vi.fn()} />)
    expect(screen.getByRole('img', { name: 'Portrait' }).getAttribute('src')).toBe(image.url)
    expect(view.container.querySelector('script')).toBeNull()
    view.rerender(<WikiMarkdown body={body} updatedAt={stamp} onNavigate={vi.fn()} />)
    expect(screen.getByRole('img', { name: 'Portrait' }).getAttribute('loading')).toBe('lazy')
  })

  it('annule la requête au démontage et ne réinjecte jamais une image dans un formulaire abandonné', async () => {
    let done!: (value: ReturnType<typeof response>) => void
    let signal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => { signal = init.signal as AbortSignal; return new Promise(resolve => { done = resolve }) }))
    const onInsert = vi.fn(), onPendingChange = vi.fn()
    const view = render(<AdminImageUpload disabled={false} onInsert={onInsert} onPendingChange={onPendingChange} />)
    selectFile(); view.unmount(); expect(signal?.aborted).toBe(true)
    done(response(image, 201))
    await waitFor(() => expect(onPendingChange).toHaveBeenLastCalledWith(false))
    expect(onInsert).not.toHaveBeenCalled()
  })
})
