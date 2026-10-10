import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import { decodeString } from 'micromark-util-decode-string'
import type { Root, Nodes } from 'mdast'

export interface ObsidianTarget {
  target: string; anchor: string | null; alias: string | null; embed: boolean
}
export interface WikiOccurrence extends ObsidianTarget { start: number; end: number; label: string }
export interface WikiNavigation {
  updatedAt: string
  links: Array<{ start: number; end: number; label: string; href: string | null }>
}
export type WikiStatus = 'RESOLVED' | 'MISSING' | 'AMBIGUOUS' | 'UNASSOCIATED' | 'UNSUPPORTED' | 'OUT_OF_SCOPE'
export interface ReferenceConnection { id: string; slug: string; title: string; occurrences: number }
export interface ReferenceStats {
  occurrences: number; resolved: number; ambiguous: number; missing: number; unassociated: number; unsupported: number
}
export interface ObsidianReferences extends WikiNavigation {
  outgoing: ReferenceConnection[]; incoming: ReferenceConnection[]; stats: ReferenceStats
  diagnostics: Array<{ target: string; anchor: string | null; status: WikiStatus; message: string; occurrences: number }>
}

export function obsidianLinkIndex(paths: string[]) {
  const exact = new Set(paths), names = new Map<string, string[]>()
  for (const path of paths) {
    const name = path.split('/').at(-1)!.replace(/\.md$/i, '')
    const candidates = names.get(name)
    if (candidates) candidates.push(path)
    else names.set(name, [path])
  }
  return { exact, names }
}
function normalizePath(value: string): string {
  const parts: string[] = []
  for (const part of value.split('/')) {
    if (!part || part === '.') continue
    if (part === '..' && parts.length && parts.at(-1) !== '..') parts.pop()
    else parts.push(part)
  }
  const result = parts.join('/') || '.'
  return value.endsWith('/') ? `${result}/` : result
}
export function resolveObsidianPath(target: string, path: string, index: ReturnType<typeof obsidianLinkIndex>): {
  status: 'FOUND' | 'MISSING' | 'AMBIGUOUS' | 'UNSUPPORTED' | 'OUT_OF_SCOPE'; path: string | null
} {
  const normalized = target.replace(/\\/g, '/')
  if (/^(?:[a-z]+:|\/)/i.test(normalized) || /\.(?:png|jpe?g|gif|webp|svg|pdf|canvas|mp[34]|wav|ogg|zip)$/i.test(normalized)) {
    return { status: 'UNSUPPORTED', path: null }
  }
  const root = normalizePath(normalized), local = normalizePath(`${path.split('/').slice(0, -1).join('/')}/${normalized}`)
  const extension = (value: string) => /\.md$/i.test(value) ? value : `${value}.md`
  if (root === '..' || root.startsWith('../')) {
    if (local === '..' || local.startsWith('../')) return { status: 'OUT_OF_SCOPE', path: null }
    return index.exact.has(extension(local)) ? { status: 'FOUND', path: extension(local) } : { status: 'MISSING', path: null }
  }
  if (!target) return { status: 'FOUND', path }
  const candidates = new Set([extension(local), extension(root)].filter(value => index.exact.has(value)))
  if (!normalized.includes('/') && candidates.size < 2) for (const candidate of index.names.get(normalized.replace(/\.md$/i, '')) ?? []) {
    candidates.add(candidate)
    if (candidates.size >= 2) break
  }
  return candidates.size === 1 ? { status: 'FOUND', path: [...candidates][0]! }
    : { status: candidates.size > 1 ? 'AMBIGUOUS' : 'MISSING', path: null }
}

export function parseObsidianTarget(raw: string, embed = false): ObsidianTarget {
  const pipe = raw.indexOf('|'), reference = (pipe < 0 ? raw : raw.slice(0, pipe)).trim(), hash = reference.indexOf('#')
  return { target: (hash < 0 ? reference : reference.slice(0, hash)).trim(), anchor: hash < 0 ? null : reference.slice(hash + 1).trim(),
    alias: pipe < 0 ? null : raw.slice(pipe + 1), embed }
}
export const wikiKey = (value: string) => value.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()
export const decodeMarkdownText = (value: string) => decodeString(value).replace(/\r\n?/g, '\n')
/** Map a source offset to rendered text, accounting for list/blockquote continuation prefixes. */
export function markdownTextOffset(raw: string, value: string, offset: number): number | null {
  const sourceLines = raw.split(/(\r\n|\n|\r)/), textLines = value.split('\n')
  if (Math.ceil(sourceLines.length / 2) !== textLines.length || offset < 0 || offset > raw.length) return null
  let sourceAt = 0, textAt = 0
  for (let i = 0; i < textLines.length; i++) {
    const source = sourceLines[i * 2]!, text = textLines[i]!, decoded = decodeMarkdownText(source)
    if (!decoded.endsWith(text)) return null
    const omitted = decoded.length - text.length
    if (offset <= sourceAt + source.length) {
      const prefix = decodeMarkdownText(source.slice(0, offset - sourceAt)).length
      return prefix >= omitted ? textAt + prefix - omitted : null
    }
    sourceAt += source.length + (sourceLines[i * 2 + 1]?.length ?? 0)
    textAt += text.length + 1
  }
  return null
}
const ignored = new Set(['code', 'inlineCode', 'html', 'link', 'linkReference', 'image', 'imageReference'])
export function walkWikiProse(node: Nodes, visit: (node: Nodes) => void): void {
  if (ignored.has(node.type)) return
  visit(node)
  if ('children' in node) for (const child of node.children) walkWikiProse(child, visit)
}
export function frontmatterEnd(body: string): number {
  return /^(?:\uFEFF)?---[ \t]*(?:\r\n|\n|\r)[\s\S]*?(?:\r\n|\n|\r)(?:---|\.\.\.)[ \t]*(?:(?:\r\n|\n|\r)|$)/.exec(body)?.[0].length ?? 0
}
export function markdownTree(body: string): Root {
  return fromMarkdown(body, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
}
export function wikiOccurrences(body: string, tree: Root = markdownTree(body)): WikiOccurrence[] {
  const result: WikiOccurrence[] = [], frontmatter = frontmatterEnd(body)
  walkWikiProse(tree, node => {
    if (node.type !== 'text' || node.position?.start.offset === undefined || node.position.end.offset === undefined) return
    const offset = node.position.start.offset, raw = body.slice(offset, node.position.end.offset)
    for (const match of raw.matchAll(/(!?)\[\[([^\]\r\n]+)\]\]/g)) {
      const start = offset + match.index!
      if (start < frontmatter) continue
      let escapes = 0
      for (let at = start - 1; at >= 0 && body[at] === '\\'; at--) escapes++
      if (escapes % 2) continue
      // GFM table cells escape the wikilink separator; retain its original source offsets.
      const target = parseObsidianTarget(match[2]!.replace(/\\\|/g, '|'), match[1] === '!')
      result.push({ ...target, start, end: start + match[0].length,
        label: decodeMarkdownText(target.alias ?? (target.target || target.anchor || 'Référence')) })
    }
  })
  return result
}
function headingText(node: Nodes): string {
  if ('value' in node && (node.type === 'text' || node.type === 'inlineCode')) return node.value
  return 'children' in node ? node.children.map(headingText).join('') : ''
}
export function markdownHeadings(body: string, tree: Root = markdownTree(body)) {
  const result: Array<{ start: number; key: string; id: string }> = [], used = new Set<string>(), frontmatter = frontmatterEnd(body)
  walkWikiProse(tree, node => {
    if (node.type !== 'heading' || node.position?.start.offset === undefined || node.position.start.offset < frontmatter) return
    const text = headingText(node), base = `obsidian-${wikiKey(text).replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, '').replace(/\s+/g, '-') || 'section'}`
    let id = base, suffix = 1
    while (used.has(id)) id = `${base}-${suffix++}`
    used.add(id)
    result.push({ start: node.position.start.offset, key: wikiKey(text), id })
  })
  return result
}
