export type LabelNode = { id: string; x?: number; y?: number }
export type LabelCandidate = { node: LabelNode; text: string; priority: number; radius: number }
export type LabelBox = { x: number; y: number; width: number; height: number }
export type GraphLabel = LabelBox & { text: string; fontSize: number; important: boolean }
export type GraphBounds = { left: number; right: number; top: number; bottom: number }

export function shortLabel(title: string, limit = 42): string {
  const characters = [...title]
  return characters.length > limit ? `${characters.slice(0, limit - 1).join('')}…` : title
}

function overlaps(a: LabelBox, b: LabelBox): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

// Candidates are sorted once by the component. Only moving geometry is recalculated per painted frame.
// A spatial grid and a label budget avoid pairwise comparisons across the whole graph.
export function layoutGraphLabels(candidates: readonly LabelCandidate[], scale: number,
  measure: (text: string, screenFontSize: number) => number, bounds?: GraphBounds): Map<string, GraphLabel> {
  const placed = new Map<string, GraphLabel>()
  if (!Number.isFinite(scale) || scale < .01 || scale > 100) return placed
  const cell = 80 / scale
  const grid = new Map<string, LabelBox[]>()
  const maxLabels = scale < .7 ? 36 : scale < 1.4 ? 80 : 180
  let ordinary = 0
  const keys = (box: LabelBox): string[] => {
    const cells: string[] = []
    for (let x = Math.floor(box.x / cell); x <= Math.floor((box.x + box.width) / cell); x++) {
      for (let y = Math.floor(box.y / cell); y <= Math.floor((box.y + box.height) / cell); y++) cells.push(`${x}:${y}`)
    }
    return cells
  }
  for (const candidate of candidates) {
    if (placed.size >= maxLabels) break
    const { node, priority, radius, text } = candidate
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y) || !text) continue
    const x = node.x!, y = node.y!
    if (Math.abs(x) > 1_000_000 || Math.abs(y) > 1_000_000 || !Number.isFinite(radius) || radius < 0 || radius > 100) continue
    if (bounds && (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom)) continue
    if (priority >= 4 && scale < 1.4 && ordinary >= (scale < .7 ? 8 : 24)) continue
    const screenFontSize = priority === 0 ? 14 : priority === 1 ? 13 : priority <= 3 ? 12 : 11
    const fontSize = screenFontSize / scale
    const measuredWidth = measure(text, screenFontSize)
    if (!Number.isFinite(measuredWidth) || measuredWidth < 0 || measuredWidth > 10_000) continue
    const width = (measuredWidth + 8) / scale
    const height = (screenFontSize + 6) / scale
    const gap = radius + 4 / scale
    const boxes: LabelBox[] = [
      { x: x - width / 2, y: y + gap, width, height },
      { x: x - width / 2, y: y - gap - height, width, height },
      { x: x + gap, y: y - height / 2, width, height },
      { x: x - gap - width, y: y - height / 2, width, height },
    ]
    const box = boxes.find(box => (!bounds || (box.x >= bounds.left && box.x + box.width <= bounds.right &&
      box.y >= bounds.top && box.y + box.height <= bounds.bottom)) &&
      keys(box).every(key => !(grid.get(key) ?? []).some(other => overlaps(box, other))))
    // The selected fiche must keep a readable name even if every alternative is occupied.
    const chosen = box ?? (priority === 0 ? boxes[0] : undefined)
    if (!chosen) continue
    for (const key of keys(chosen)) {
      const entries = grid.get(key) ?? []
      entries.push(chosen); grid.set(key, entries)
    }
    placed.set(node.id, { ...chosen, text, fontSize, important: priority <= 3 })
    if (priority >= 4) ordinary++
  }
  return placed
}
