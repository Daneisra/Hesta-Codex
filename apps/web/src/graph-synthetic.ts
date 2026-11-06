import type { GraphNode, GraphResponse } from '@hesta-codex/shared'

// Technical fixture only: ten disconnected rings with shortcuts, 1,000 nodes / 3,000 relations.
// No lore, external requests, timing assertion or server dependency.
export function syntheticGraph(): GraphResponse {
  return {
    nodes: Array.from({ length: 1_000 }, (_, i) => ({ id: `node-${i}`, slug: `node-${i}`, title: `Fiche ${i}`,
      kind: i % 2 === 0 ? 'PLACE' : 'PERSON', placeKind: i % 2 === 0 ? 'CITY' : null,
      summary: null, aliases: [`Alias ${i}`] })),
    edges: Array.from({ length: 1_000 }, (_, i) => [1, 5, 10].map((offset, j) => ({
      id: `edge-${i}-${j}`, source: `node-${i}`, target: `node-${Math.floor(i / 100) * 100 + (i % 100 + offset) % 100}`,
      type: j === 1 ? 'allied_with' : 'located_in', label: j === 1 ? 'allié à' : 'situé dans',
      inverseLabel: j === 1 ? null : 'contient', symmetric: j === 1,
    }))).flat(),
  }
}

/** Fictional readability fixture: 141 notes, 310 pairs, hubs, satellites and isolated notes. */
export function readabilityGraph(): GraphResponse {
  let seed = 42
  const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32 }
  const nodes: GraphNode[] = Array.from({ length: 141 }, (_, i) => ({ id: `note-${i}`, slug: `note-${i}`,
    title: i < 5 ? `Pôle fictif ${i + 1}` : i % 17 === 0 ? `Un titre fictif plus long pour la lisibilité ${i}` : `Note fictive ${i}`,
    kind: i % 3 === 0 ? 'PLACE' : i % 3 === 1 ? 'PERSON' : 'CONCEPT', placeKind: i % 3 === 0 ? 'CITY' : null, summary: null, aliases: [] }))
  const pairs = new Map<string, GraphResponse['edges'][number]>()
  const add = (a: number, b: number) => {
    if (a > b) [a, b] = [b, a]
    const id = `${a}:${b}`
    pairs.set(id, { id, source: `note-${a}`, target: `note-${b}`, origin: 'OBSIDIAN', type: 'OBSIDIAN_REFERENCE',
      label: 'mentionne', inverseLabel: 'est mentionné par', symmetric: false, occurrences: 1 })
  }
  for (let i = 1; i < 122; i++) add(Math.floor(random() ** 2 * i), i)
  for (let i = 122; i + 1 < 137; i += 2) add(i, i + 1)
  while (pairs.size < 310) { const a = Math.floor(random() ** 2 * 122), b = Math.floor(random() * 122); if (a !== b) add(a, b) }
  return { nodes, edges: [...pairs.values()] }
}
