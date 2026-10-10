import { useEffect, useMemo, type MouseEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  markdownTextOffset, markdownHeadings, walkWikiProse, type WikiNavigation,
} from '@hesta-codex/shared'
import type { Root, Nodes, PhrasingContent } from 'mdast'

export function scrollToWikiAnchor() {
  if (!window.location.hash) return
  try {
    const heading = document.getElementById(decodeURIComponent(window.location.hash.slice(1)))
    heading?.scrollIntoView?.({ block: 'start' })
    heading?.focus({ preventScroll: true })
  } catch { /* Malformed fragment: leave the page usable. */ }
}

/** Transform the renderer AST only. Source Markdown and non-wiki syntax remain untouched. */
export function wikiRemark(body: string, navigation?: WikiNavigation) {
  return function plugin() {
    return function transform(tree: Root) {
      const headings = new Map(markdownHeadings(body, tree).map(heading => [heading.start, heading.id]))
      walkWikiProse(tree, node => {
        if (node.type === 'heading' && node.position?.start.offset !== undefined) {
          const id = headings.get(node.position.start.offset)
          if (id) node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id, tabIndex: -1 } }
        }
      })
      const links = navigation?.links ?? []
      function replace(node: Nodes) {
        if (['link', 'linkReference', 'image', 'imageReference', 'code', 'inlineCode', 'html'].includes(node.type) || !('children' in node)) return
        const children: Nodes[] = []
        for (const child of node.children) {
          if (child.type !== 'text' || child.position?.start.offset === undefined || child.position.end.offset === undefined) {
            replace(child); children.push(child); continue
          }
          const offset = child.position.start.offset, raw = body.slice(offset, child.position.end.offset)
          const matches = links.filter(link => link.start >= offset && link.end <= child.position!.end.offset! && link.start < link.end)
            .sort((a, b) => a.start - b.start)
          const replacement: PhrasingContent[] = []
          let consumed = 0, valid = true
          for (const link of matches) {
            const start = markdownTextOffset(raw, child.value, link.start - offset)
            const end = markdownTextOffset(raw, child.value, link.end - offset)
            if (start === null || end === null || start < consumed || end > child.value.length) { valid = false; break }
            if (start > consumed) replacement.push({ type: 'text', value: child.value.slice(consumed, start) })
            const label = { type: 'text' as const, value: link.label }
            replacement.push(link.href ? { type: 'link', url: link.href, children: [label] } : label)
            consumed = end
          }
          if (!valid || !matches.length) children.push(child)
          else { if (consumed < child.value.length) replacement.push({ type: 'text', value: child.value.slice(consumed) }); children.push(...replacement) }
        }
        // Text and link nodes are valid children wherever a text node originally appeared.
        node.children = children as typeof node.children
      }
      replace(tree)
    }
  }
}

export function WikiMarkdown({ body, updatedAt, navigation, admin = false, onNavigate }: {
  body: string; updatedAt: string; navigation?: WikiNavigation; admin?: boolean
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, href: string) => void
}) {
  const plugin = useMemo(() => wikiRemark(body, navigation?.updatedAt === updatedAt ? navigation : undefined), [body, navigation, updatedAt])
  useEffect(() => {
    let frame = requestAnimationFrame(scrollToWikiAnchor)
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(scrollToWikiAnchor) }
    window.addEventListener('hashchange', schedule)
    window.addEventListener('popstate', schedule)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('hashchange', schedule); window.removeEventListener('popstate', schedule) }
  }, [body, updatedAt])
  return <ReactMarkdown remarkPlugins={[remarkGfm, plugin]} skipHtml components={{
    a: ({ href, title, children }) => {
      let path: string | undefined
      try {
        const url = new URL(href ?? '', window.location.href)
        const pattern = admin ? /^\/admin\/fiches\/[a-z0-9]+(?:-[a-z0-9]+)*\/?$/ : /^\/fiches\/[a-z0-9]+(?:-[a-z0-9]+)*\/?$/
        if (href && !href.startsWith('#') && url.origin === window.location.origin && !url.search &&
          (pattern.test(url.pathname) || (!admin && ['/', '/graphe'].includes(url.pathname)))) path = url.pathname + url.hash
      } catch { /* Ordinary invalid URLs keep the renderer's safe URL handling. */ }
      return <a href={href} title={title} onClick={path ? event => onNavigate(event, path!) : undefined}>{children}</a>
    },
    ...(admin ? { img: ({ alt }: { alt?: string }) => <span className="admin-muted">Image non chargée : {alt || 'sans description'}</span> } : {}),
  }}>{body}</ReactMarkdown>
}
