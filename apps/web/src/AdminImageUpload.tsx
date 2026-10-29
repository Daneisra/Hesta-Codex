import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { managedImageId, maxImageBytes, type UploadedImage } from '@hesta-codex/shared'

export function AdminImageUpload({ disabled, onInsert, onPendingChange, onAccessError }: {
  disabled: boolean; onInsert: (markdown: string) => boolean
  onPendingChange: (pending: boolean) => void; onAccessError?: (status: number) => void
}) {
  const [alt, setAlt] = useState(''), [uploading, setUploading] = useState(false), [error, setError] = useState('')
  const [added, setAdded] = useState(false)
  const pending = useRef(false), controller = useRef<AbortController | null>(null)
  const callbacks = useRef({ onInsert, onPendingChange, onAccessError })
  callbacks.current = { onInsert, onPendingChange, onAccessError }
  useEffect(() => () => { controller.current?.abort() }, [])
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget, file = input.files?.[0]
    if (!file || pending.current || disabled) return
    input.value = ''; setError(''); setAdded(false)
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || !file.size || file.size > maxImageBytes) {
      setError('Choisissez une image PNG, JPEG ou WebP fixe de 5 Mio maximum.'); return
    }
    const description = (alt.trim() || 'Illustration').replace(/[\r\n]/g, ' ').replace(/\\/g, '\\\\').replaceAll('[', '\\[').replaceAll(']', '\\]')
    const abort = new AbortController(); controller.current = abort
    pending.current = true; setUploading(true); callbacks.current.onPendingChange(true)
    try {
      const response = await fetch('/api/admin/images', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': file.type, Accept: 'application/json' }, body: file, signal: abort.signal })
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) callbacks.current.onAccessError?.(response.status)
        const payload = await response.json().catch(() => null) as { error?: { message?: unknown } } | null
        throw new Error(response.status === 413 ? 'Image trop volumineuse ou limite Nginx insuffisante (5 Mio requis).' :
          typeof payload?.error?.message === 'string' ? payload.error.message : 'Import refusé. Réessayez.')
      }
      const image = await response.json() as UploadedImage
      if (!image || managedImageId(image.url ?? '') !== image.id) throw new Error('Réponse d’import invalide.')
      if (!abort.signal.aborted && !callbacks.current.onInsert(`![${description}](${image.url})`)) {
        throw new Error('Le contenu dépasserait 100 000 caractères. Libérez de la place avant de réimporter l’image.')
      }
      if (!abort.signal.aborted) { setAlt(''); setAdded(true) }
    } catch (reason) {
      if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : 'Import impossible. Réessayez.')
    } finally {
      pending.current = false; callbacks.current.onPendingChange(false)
      if (!abort.signal.aborted) setUploading(false)
    }
  }
  return <div className="admin-image-upload admin-editor-wide">
    <label>Description de l’image (texte alternatif)<input value={alt} maxLength={200} disabled={disabled || uploading}
      onChange={event => setAlt(event.target.value)} placeholder="Décrire brièvement l’illustration" /></label>
    <label>Importer une image<input type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled || uploading}
      onChange={event => void upload(event)} /></label>
    <p className="admin-muted">PNG, JPEG ou WebP fixe · 5 Mio maximum · 6 000 pixels par côté et 20 millions de pixels.
      L’image est réencodée en WebP sans métadonnées et ajoutée à la fin du contenu.
      20 images maximum par fiche. Enregistrez la fiche pour la conserver (imports non enregistrés : 24 h).</p>
    {uploading && <p role="status">Import de l’image…</p>}
    {added && <p role="status">Image ajoutée au contenu. Enregistrez la fiche pour la conserver.</p>}
    {error && <p role="alert">{error}</p>}
  </div>
}
