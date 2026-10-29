import { markdownTree } from './obsidian.js'
import type { Nodes } from 'mdast'

export const maxImageBytes = 5 * 1024 * 1024
export const maxEntityImages = 20
export interface UploadedImage { id: string; url: string; width: number; height: number; byteSize: number }
const imagePattern = /^\/api\/images\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/
export const managedImageId = (url: string) => imagePattern.exec(url)?.[1] ?? null

/** Match renderer image nodes, including reference-style images, never examples in code. */
export function referencedImageIds(markdown: string): string[] {
  if (!markdown.includes('/api/images/')) return []
  const tree = markdownTree(markdown), definitions = new Map<string, string>(), ids = new Set<string>()
  function walk(node: Nodes, visit: (node: Nodes) => void) {
    visit(node)
    if ('children' in node) for (const child of node.children) walk(child, visit)
  }
  walk(tree, node => { if (node.type === 'definition' && !definitions.has(node.identifier)) definitions.set(node.identifier, node.url) })
  walk(tree, node => {
    const url = node.type === 'image' ? node.url : node.type === 'imageReference' ? definitions.get(node.identifier) : undefined
    const id = url ? managedImageId(url) : null
    if (id) ids.add(id)
  })
  return [...ids].sort()
}
