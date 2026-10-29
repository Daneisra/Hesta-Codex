import { wikiOccurrences, type WikiNavigation } from '@hesta-codex/shared'

/** Public representation only: never disclose a private targeted slug embedded by the scanner. */
export function publicWikiView(bodyMarkdown: string, navigation?: WikiNavigation) {
  const visible = new Map(navigation?.links.map(link => [link.start, link]) ?? [])
  const hidden = wikiOccurrences(bodyMarkdown).filter(link => /^\/fiches\//.test(link.target) && !visible.get(link.start)?.href)
  if (!hidden.length) return { bodyMarkdown, ...(navigation ? { wikiNavigation: navigation } : {}) }
  let body = '', at = 0, delta = 0
  const shifts: Array<{ end: number; delta: number }> = []
  for (const link of hidden) {
    // Preserve readable text as literal Markdown, including punctuation, without its private target.
    const label = link.label.replace(/[\\`*_[\]{}()#+.!<>|~-]/g, '\\$&')
    body += bodyMarkdown.slice(at, link.start) + label; at = link.end
    delta += label.length - (link.end - link.start); shifts.push({ end: link.end, delta })
  }
  body += bodyMarkdown.slice(at)
  const hiddenStarts = new Set(hidden.map(link => link.start))
  let shiftAt = 0, shift = 0
  return { bodyMarkdown: body, ...(navigation ? { wikiNavigation: { ...navigation, links: navigation.links.filter(link => !hiddenStarts.has(link.start)).map(link => {
    while (shiftAt < shifts.length && shifts[shiftAt]!.end <= link.start) shift = shifts[shiftAt++]!.delta
    return { ...link, start: link.start + shift, end: link.end + shift }
  }) } } : {}) }
}
