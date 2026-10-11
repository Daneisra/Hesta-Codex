import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearPositions, loadPositions, parsePositions, positionStorageKey, savePositions, serializePositions } from './graph-positions'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear() })
const ids = new Set(['a', 'b', 'new', '__proto__'])

describe('local graph positions', () => {
  it('ignores the previous layout generation without touching another scope or stored lore', () => {
    localStorage.setItem('hesta-codex:graph-layout:v1:public', serializePositions(new Map([['a', { x: 999999, y: 999999 }]])))
    expect(loadPositions('public', ids).positions.size).toBe(0)
    expect(positionStorageKey('public')).toBe('hesta-codex:graph-layout:v2:public')
  })
  it('roundtrips ID/coordinates only and ignores deleted nodes while leaving new nodes free', () => {
    const raw = serializePositions(new Map([['a', { x: -123, y: 456 }], ['deleted', { x: 1, y: 2 }]]))
    expect(parsePositions(raw, ids)).toEqual(new Map([['a', { x: -123, y: 456 }]]))
    expect(parsePositions(raw, ids).has('new')).toBe(false)
    expect(JSON.parse(raw)).toEqual({ version: 1, positions: [['a', -123, 456], ['deleted', 1, 2]] })
  })

  it('separates public and admin storage and clears only the current scope', () => {
    expect(savePositions('public', new Map([['a', { x: 1, y: 2 }]]))).toBe(true)
    expect(savePositions('admin', new Map([['a', { x: 3, y: 4 }]]))).toBe(true)
    expect(loadPositions('public', ids).positions.get('a')).toEqual({ x: 1, y: 2 })
    expect(loadPositions('admin', ids).positions.get('a')).toEqual({ x: 3, y: 4 })
    expect(clearPositions('public')).toBe(true)
    expect(localStorage.getItem(positionStorageKey('public'))).toBeNull()
    expect(loadPositions('admin', ids).positions.size).toBe(1)
  })

  it('ignores corrupt, oversized, foreign-version and invalid coordinate data safely', () => {
    for (const raw of ['bad json', 'null', '[]', '{"version":2,"positions":[]}', 'x'.repeat(2_000_001)]) {
      expect(parsePositions(raw, ids).size).toBe(0)
    }
    const raw = JSON.stringify({ version: 1, positions: [['a', 2e6, 0], ['b', '1', 2], ['new', null, 2],
      ['__proto__', 3, 4], ['a', 1, 2], ['b', 1, 2, 3]] })
    expect(parsePositions(raw, ids)).toEqual(new Map([['__proto__', { x: 3, y: 4 }], ['a', { x: 1, y: 2 }]]))
    expect(parsePositions(serializePositions(new Map([['a', { x: NaN, y: Infinity }]])), ids).size).toBe(0)
  })

  it('keeps exploration available when localStorage access is denied or its quota is exhausted', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('quota') }, removeItem: () => { throw new Error('denied') } })
    expect(loadPositions('public', ids)).toEqual({ positions: new Map(), available: false })
    expect(savePositions('public', new Map())).toBe(false)
    expect(clearPositions('public')).toBe(false)
  })
})
