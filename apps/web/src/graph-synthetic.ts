import type { GraphResponse } from '@hesta-codex/shared'

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
