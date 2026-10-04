export type GraphScope = 'public' | 'admin'
export type SavedPosition = { x: number; y: number }

const maxEntries = 10_000
const maxCoordinate = 1_000_000
export const positionStorageKey = (scope: GraphScope) => `hesta-codex:graph-layout:v1:${scope}`

export function validPosition(value: SavedPosition): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y) &&
    Math.abs(value.x) <= maxCoordinate && Math.abs(value.y) <= maxCoordinate
}

// Store only IDs and coordinates, never lore or account data. Arrays avoid object-key/prototype hazards.
export function serializePositions(positions: ReadonlyMap<string, SavedPosition>): string {
  return JSON.stringify({ version: 1, positions: [...positions].filter(([id, value]) =>
    id.length > 0 && id.length <= 200 && validPosition(value)).slice(0, maxEntries)
    .map(([id, { x, y }]) => [id, x, y]) })
}

export function parsePositions(raw: string | null, allowedIds: ReadonlySet<string>): Map<string, SavedPosition> {
  const positions = new Map<string, SavedPosition>()
  if (!raw || raw.length > 2_000_000) return positions
  try {
    const data: unknown = JSON.parse(raw)
    if (!data || typeof data !== 'object' || !('version' in data) || data.version !== 1 ||
      !('positions' in data) || !Array.isArray(data.positions) || data.positions.length > maxEntries) return positions
    for (const entry of data.positions) {
      if (!Array.isArray(entry) || entry.length !== 3) continue
      const [id, x, y] = entry as unknown[]
      if (typeof id === 'string' && allowedIds.has(id) && typeof x === 'number' && typeof y === 'number' && validPosition({ x, y })) {
        positions.set(id, { x, y })
      }
    }
  } catch { /* A corrupt cache cannot prevent graph exploration. */ }
  return positions
}

export function loadPositions(scope: GraphScope, allowedIds: ReadonlySet<string>): { positions: Map<string, SavedPosition>; available: boolean } {
  try { return { positions: parsePositions(window.localStorage.getItem(positionStorageKey(scope)), allowedIds), available: true } }
  catch { return { positions: new Map(), available: false } }
}

export function savePositions(scope: GraphScope, positions: ReadonlyMap<string, SavedPosition>): boolean {
  try { window.localStorage.setItem(positionStorageKey(scope), serializePositions(positions)); return true }
  catch { return false }
}

export function clearPositions(scope: GraphScope): boolean {
  try { window.localStorage.removeItem(positionStorageKey(scope)); return true }
  catch { return false }
}
