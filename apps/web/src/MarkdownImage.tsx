import { managedImageId } from '@hesta-codex/shared'

export function MarkdownImage({ src, alt, title, admin = false }: { src?: string; alt?: string; title?: string; admin?: boolean }) {
  if (admin && (!src || !managedImageId(src))) return <span className="admin-muted">Image non chargée : {alt || 'sans description'}</span>
  return <img src={src} alt={alt ?? ''} title={title} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
}
