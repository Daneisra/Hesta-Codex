import { describe, expect, it } from 'vitest'
import { defaultGraphState, graphStateUrl, readGraphState, resolveGraphState } from './graph-url'

const origin = new URL('https://codex.example/graphe')

describe('shareable graph exploration', () => {
  it('reads the full public state and roundtrips selection, depth, isolation, query and filters', () => {
    const search = '?fiche=ville&profondeur=3&isoler=1&q=Cité+du+port&type=PLACE&lieu=CITY&relation=located_in&sans=people,ideas'
    const state = readGraphState(search)
    expect(state).toEqual({ ...defaultGraphState(), slug: 'ville', depth: 3, isolated: true, query: 'Cité du port',
      filters: { ...defaultGraphState().filters, kind: 'PLACE', placeKind: 'CITY', relationType: 'located_in' },
      groups: new Set(['places', 'collectives', 'stories']) })
    expect(readGraphState(graphStateUrl(origin, state).search)).toEqual(state)
  })

  it('reads admin filters but never serializes private selection, search or dependent isolation', () => {
    const state = readGraphState('?fiche=private-entry&q=private-search&profondeur=2&isoler=1&type=PERSON&statut=PROPOSED&visibilite=GM&statut-relation=DRAFT&visibilite-relation=SECRET', true)
    expect(state.slug).toBe('private-entry') // Legacy links are resolved locally and then scrubbed.
    expect(state.query).toBe('')
    expect(state.isolated).toBe(false)
    expect(state.filters).toEqual({ kind: 'PERSON', placeKind: '', relationType: '', nodeStatus: 'PROPOSED',
      nodeVisibility: 'GM', edgeStatus: 'DRAFT', edgeVisibility: 'SECRET' })
    const url = graphStateUrl(new URL('https://codex.example/admin/graphe?token=private#secret'),
      { ...state, query: 'private-search', isolated: true }, true)
    expect(url.href).not.toMatch(/private-entry|private-search|token|secret|fiche|isoler|q=/)
    expect(url.searchParams.get('statut')).toBe('PROPOSED')
    expect(url.searchParams.get('visibilite-relation')).toBe('SECRET')
    expect(readGraphState(url.search, true).depth).toBe(2)
  })

  it('omits defaults, supports old fiche links, preserves the route and removes unknown fields', () => {
    expect(graphStateUrl(new URL('https://codex.example/graphe/?token=sensitive#secret'), defaultGraphState()).href)
      .toBe('https://codex.example/graphe/')
    const legacy = readGraphState('?fiche=%76ille')
    expect(legacy).toEqual({ ...defaultGraphState(), slug: 'ville' })
    expect(graphStateUrl(origin, legacy).search).toBe('?fiche=ville')
    const none = { ...defaultGraphState(), groups: new Set<string>() }
    expect(readGraphState(graphStateUrl(origin, none).search).groups.size).toBe(0)
  })

  it('rejects invalid enums, duplicate keys, oversized/freeform values and unknown categories safely', () => {
    const invalid = '?fiche=../secret&profondeur=9&isoler=true&type=INVALID&lieu=INVALID&relation=%00invalid&sans=places,unknown&statut=ROOT&visibilite=ALL'
    expect(readGraphState(invalid, true)).toEqual(defaultGraphState())
    expect(readGraphState('?fiche=ville&fiche=secret&profondeur=2&profondeur=3&q=a&q=b&sans=places,places'))
      .toEqual(defaultGraphState())
    expect(readGraphState(`?q=${'x'.repeat(201)}`).query).toBe('')
    expect(readGraphState('?q=%00unsafe').query).toBe('')
    expect(readGraphState('?isoler=1').isolated).toBe(false)
    expect(readGraphState('?statut=DRAFT&visibilite=SECRET&statut-relation=DRAFT&visibilite-relation=SECRET').filters)
      .toEqual(defaultGraphState().filters)
  })

  it('drops a relation type absent from the authorized response', () => {
    const state = readGraphState('?relation=unknown_type&fiche=ville')
    expect(resolveGraphState(state, new Set(['located_in'])).filters.relationType).toBe('')
    const known = readGraphState('?relation=located_in')
    expect(resolveGraphState(known, new Set(['located_in']))).toBe(known)
    const custom = readGraphState('?relation=Type-lié')
    expect(resolveGraphState(custom, new Set(['Type-lié']))).toBe(custom)
  })
})
