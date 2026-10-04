import { describe, expect, it } from 'vitest'
import { layoutGraphLabels, shortLabel, type LabelCandidate } from './graph-labels'

const measure = (text: string, font: number) => [...text].length * font / 2
const candidate = (id: string, x: number, y: number, priority = 4): LabelCandidate =>
  ({ node: { id, x, y }, text: 'Titre du Codex', priority, radius: 6 })

describe('graph label readability', () => {
  it('places the selected and hovered names first and prevents collisions with other labels', () => {
    const labels = layoutGraphLabels([candidate('selected', 0, 0, 0), candidate('hovered', 0, 0, 1),
      ...Array.from({ length: 20 }, (_, i) => candidate(String(i), 0, 0))], 1, measure)
    expect([...labels.keys()].slice(0, 2)).toEqual(['selected', 'hovered'])
    for (const [id, a] of labels) for (const [otherId, b] of labels) {
      if (id !== otherId) expect(a.x >= b.x + b.width || b.x >= a.x + a.width ||
        a.y >= b.y + b.height || b.y >= a.y + a.height).toBe(true)
    }
  })

  it('bounds screen text size and drawing work on a thousand candidates at every zoom', () => {
    const candidates = Array.from({ length: 1_000 }, (_, i) => candidate(String(i), i * 1_000, 0, i === 0 ? 0 : 4))
    for (const scale of [.15, 1, 2, 8]) {
      const labels = layoutGraphLabels(candidates, scale, measure)
      expect(labels.has('0')).toBe(true)
      expect(labels.size).toBeGreaterThan(1)
      expect(labels.size).toBeLessThanOrEqual(180)
      for (const label of labels.values()) expect(label.fontSize * scale).toBeLessThanOrEqual(13)
    }
  })

  it('ignores non-finite positions and offscreen candidates; truncates Unicode without splitting pairs', () => {
    expect(layoutGraphLabels([candidate('bad', NaN, 0), candidate('outside', 200, 200)], 1, measure,
      { left: -50, right: 50, top: -50, bottom: 50 }).size).toBe(0)
    expect(layoutGraphLabels([candidate('bad', 0, 0)], 0, measure).size).toBe(0)
    expect(layoutGraphLabels([candidate('extreme', 1e300, 0)], 1, measure).size).toBe(0)
    expect(layoutGraphLabels([candidate('extreme', 0, 0)], 1e-300, measure).size).toBe(0)
    expect(layoutGraphLabels([candidate('extreme', 0, 0)], 1, () => Infinity).size).toBe(0)
    expect(shortLabel('🌊'.repeat(100), 10)).toBe('🌊'.repeat(9) + '…')
    expect(shortLabel('Ville')).toBe('Ville')
  })
})
