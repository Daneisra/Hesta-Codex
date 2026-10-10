import { posix } from 'node:path'
import { obsidianLinkIndex, resolveObsidianPath } from '@hesta-codex/shared'
import { isAlias, isMap, isScalar, isSeq, parseDocument } from 'yaml'
import { editorialBase } from '../admin/validation.js'
import { ingestionSchema, validateIngestionDocument } from './format.js'
import { ObsidianError } from './obsidian-files.js'

export interface WikiLink {
  target: string; anchor: string | null; alias: string | null; embed: boolean
  status: 'FOUND' | 'MISSING' | 'AMBIGUOUS' | 'UNSUPPORTED' | 'OUT_OF_SCOPE'
  path: string | null
}
export const linkIndex = obsidianLinkIndex
export type LinkIndex = ReturnType<typeof linkIndex>

function prose(body: string): string {
  let fence: { char: string; length: number } | null = null
  return body.replace(/<!--[\s\S]*?(?:-->|$)/g, '').split(/\r\n|\n|\r/).map(line => {
    const mark = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (mark && !fence) { fence = { char: mark[1]![0]!, length: mark[1]!.length }; return '' }
    if (fence) {
      if (mark && mark[1]![0] === fence.char && mark[1]!.length >= fence.length && !mark[2]!.trim()) fence = null
      return ''
    }
    if (/^(?: {4}|\t)/.test(line)) return ''
    return line.replace(/(`+)[^`]*?\1/g, '')
  }).join('\n')
}

function links(body: string, path: string, index: LinkIndex): WikiLink[] {
  const results: WikiLink[] = [], text = prose(body)
  for (const match of text.matchAll(/(!?)\[\[([^\]\r\n]+)\]\]/g)) {
    let backslashes = 0
    for (let at = match.index! - 1; at >= 0 && text[at] === '\\'; at--) backslashes++
    if (backslashes % 2) continue
    if (results.length >= 100) throw new ObsidianError('WIKILINK_LIMIT')
    const raw = match[2]!, pipe = raw.indexOf('|'), reference = (pipe < 0 ? raw : raw.slice(0, pipe)).trim()
    const hash = reference.indexOf('#'), target = (hash < 0 ? reference : reference.slice(0, hash)).trim()
    const link: WikiLink = { target, anchor: hash < 0 ? null : reference.slice(hash + 1), alias: pipe < 0 ? null : raw.slice(pipe + 1),
      embed: match[1] === '!', status: 'MISSING', path: null }
    Object.assign(link, resolveObsidianPath(target, path, index))
    results.push(link)
  }
  return results
}

export function extractMarkdown(content: string, path: string, index: LinkIndex) {
  const warnings: string[] = [], metadata: Record<string, unknown> = {}
  let body = content.replace(/^\uFEFF/, ''), title: string | null = null
  const lines = body.split(/\r\n|\n|\r/)
  if (/^---\s*$/.test(lines[0] ?? '')) {
    const end = lines.findIndex((line, i) => i > 0 && /^(?:---|\.\.\.)\s*$/.test(line))
    if (end < 0) throw new ObsidianError('FRONTMATTER_UNCLOSED')
    const document = parseDocument(lines.slice(1, end).join('\n'), {
      schema: 'core', version: '1.2', merge: false, customTags: [], resolveKnownTags: false,
      strict: true, uniqueKeys: true, stringKeys: true, prettyErrors: false, logLevel: 'silent',
    })
    if (document.errors.length || document.warnings.length || (document.contents !== null && !isMap(document.contents))) throw new ObsidianError('FRONTMATTER_INVALID')
    // Bound the AST before conversion; aliases, arbitrary tags and YAML merge keys are refused.
    const pending: Array<{ node: unknown; depth: number }> = [{ node: document.contents, depth: 0 }]
    let count = 0
    while (pending.length) {
      const { node, depth } = pending.pop()!
      if (++count > 1024 || depth > 8) throw new ObsidianError('FRONTMATTER_COMPLEXITY')
      if (isAlias(node) || (node && typeof node === 'object' && 'tag' in node && node.tag)) throw new ObsidianError('FRONTMATTER_UNSUPPORTED_YAML')
      if (isMap(node)) for (const pair of node.items) {
        if (!isScalar(pair.key) || typeof pair.key.value !== 'string' || pair.key.value === '<<') throw new ObsidianError('FRONTMATTER_UNSUPPORTED_YAML')
        pending.push({ node: pair.value, depth: depth + 1 })
      }
      else if (isSeq(node)) for (const child of node.items) pending.push({ node: child, depth: depth + 1 })
    }
    const raw = (document.toJS({ maxAliasCount: 0 }) ?? {}) as Record<string, unknown>
    // Check even unexported properties for forbidden metadata, through the staging validator.
    const checked = validateIngestionDocument({ version: 1, batch: { label: 'Obsidian' }, items: [{
      source: { kind: 'OBSIDIAN', externalId: 'validation', label: 'Obsidian' }, content: 'Validation', metadata: raw,
    }] })
    if (!checked.success) throw new ObsidianError('FRONTMATTER_FORBIDDEN_OR_EXCESSIVE')
    for (const key of Object.keys(raw)) if (!['title', 'aliases', 'tags'].includes(key)) warnings.push('FRONTMATTER_PROPERTY_NOT_EXPORTED')
    if (Object.hasOwn(raw, 'title')) {
      const parsed = ingestionSchema.shape.items.element.shape.title.safeParse(raw.title)
      if (parsed.success && parsed.data) title = parsed.data
      else warnings.push('FRONTMATTER_TITLE_UNUSABLE')
    }
    for (const key of ['aliases', 'tags'] as const) if (Object.hasOwn(raw, key)) {
      const candidate = typeof raw[key] === 'string' ? [raw[key]] : raw[key]
      const parsed = editorialBase.shape[key].safeParse(candidate)
      if (parsed.success) metadata[key] = parsed.data
      else warnings.push(`FRONTMATTER_${key.toUpperCase()}_UNUSABLE`)
    }
    body = lines.slice(end + 1).join('\n')
  }
  const heading = /^ {0,3}#[ \t]+([^\r\n]+)$/m.exec(prose(body))?.[1]
  title ??= heading?.replace(/[ \t]+#+[ \t]*$/, '').trim() || posix.basename(path).replace(/\.md$/i, '')
  const wikilinks = links(body, path, index)
  metadata.obsidian = { wikilinks }
  for (const link of wikilinks) if (link.status !== 'FOUND') warnings.push(`WIKILINK_${link.status}`)
  return { title, metadata, warnings, wikilinks }
}
